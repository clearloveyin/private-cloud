import os
import shutil
import socket
import hashlib
import subprocess
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

import yaml
from fastapi import FastAPI, HTTPException, Depends, UploadFile, File, Form, Request
from fastapi.responses import HTMLResponse, FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError
from passlib.hash import pbkdf2_sha256
import uvicorn

CONFIG_PATH = Path(__file__).parent / "config.yaml"

with open(CONFIG_PATH) as f:
    config = yaml.safe_load(f)

SECRET_KEY = config["auth"].get("secret_key") or uuid.uuid4().hex
ALGORITHM = "HS256"
TOKEN_EXPIRE = timedelta(hours=config["auth"].get("token_expire_hours", 168))
ROOT_DIR = Path(config["storage"]["root_dir"]).expanduser().resolve()
ROOT_DIR.mkdir(parents=True, exist_ok=True)
for d in ["图片", "视频", "其它"]:
    (ROOT_DIR / d).mkdir(parents=True, exist_ok=True)

THUMB_DIR = ROOT_DIR / ".thumbnails"
THUMB_DIR.mkdir(exist_ok=True)

with open(CONFIG_PATH) as f:
    raw_config = yaml.safe_load(f)

if not raw_config["auth"].get("secret_key"):
    raw_config["auth"]["secret_key"] = SECRET_KEY
    with open(CONFIG_PATH, "w") as f:
        yaml.dump(raw_config, f, allow_unicode=True, default_flow_style=False)

password = config["auth"]["password"]
PASSWORD_HASH = pbkdf2_sha256.hash(password)

app = FastAPI(title="YunPan", docs_url=None, redoc_url=None)

BASE_DIR = Path(__file__).parent
app.mount("/static", StaticFiles(directory=str(BASE_DIR / "static")), name="static")

templates = Jinja2Templates(directory=str(BASE_DIR / "templates"))
security = HTTPBearer(auto_error=False)


def create_token() -> str:
    expire = datetime.utcnow() + TOKEN_EXPIRE
    return jwt.encode({"exp": expire, "sub": "user"}, SECRET_KEY, algorithm=ALGORITHM)


def get_current_user(credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)):
    if credentials is None:
        raise HTTPException(status_code=401)
    try:
        jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        raise HTTPException(status_code=401)
    return True


def get_optional_user(credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)):
    if credentials is None:
        return None
    try:
        jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        return None
    return True


def safe_path(rel: str) -> Path:
    full = (ROOT_DIR / rel.lstrip("/")).resolve()
    if not str(full).startswith(str(ROOT_DIR)):
        raise HTTPException(status_code=403)
    return full


def fmt_size(size: int) -> str:
    for unit in ["B", "KB", "MB", "GB", "TB"]:
        if size < 1024:
            return f"{int(size)} {unit}" if unit == "B" else f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} PB"


def fmt_ts(ts: float) -> str:
    return datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M")


@app.get("/login", response_class=HTMLResponse)
async def login_page(request: Request):
    return templates.TemplateResponse("login.html", {"request": request})


@app.get("/", response_class=HTMLResponse)
async def index_page(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


@app.post("/api/token")
async def login(password: str = Form(...)):
    if not pbkdf2_sha256.verify(password, PASSWORD_HASH):
        raise HTTPException(status_code=401)
    return {"access_token": create_token(), "token_type": "bearer"}


@app.get("/api/files")
async def list_files(path: str = "", user=Depends(get_current_user)):
    target = safe_path(path)
    if not target.exists():
        raise HTTPException(status_code=404)
    if not target.is_dir():
        raise HTTPException(status_code=400)

    items = []
    for entry in sorted(target.iterdir(), key=lambda e: (not e.is_dir(), e.name.lower())):
        if entry.name.startswith("."):
            continue
        st = entry.stat()
        is_dir = entry.is_dir()
        file_count = 0
        if is_dir:
            file_count = len([e for e in entry.iterdir() if not e.name.startswith(".")])
        items.append({
            "name": entry.name,
            "type": "folder" if is_dir else "file",
            "size": st.st_size if not is_dir else 0,
            "size_display": fmt_size(st.st_size) if not is_dir else "",
            "modified": fmt_ts(st.st_mtime),
            "file_count": file_count if is_dir else 0,
        })

    rel = str(target.relative_to(ROOT_DIR))
    rel = "" if rel == "." else rel
    if target == ROOT_DIR:
        parent_rel = None
    else:
        parent_rel = str(target.parent.relative_to(ROOT_DIR))
        parent_rel = "" if parent_rel == "." else parent_rel
    return {
        "path": rel,
        "parent": parent_rel,
        "items": items,
    }


@app.post("/api/upload")
async def upload(
    path: str = Form(""),
    files: list[UploadFile] = File(...),
    user=Depends(get_current_user),
):
    target = safe_path(path)
    if not target.is_dir():
        raise HTTPException(status_code=400)

    uploaded = []
    for f in files:
        dest = target / f.filename
        with open(dest, "wb") as buf:
            while chunk := await f.read(8 * 1024 * 1024):
                buf.write(chunk)
        uploaded.append(f.filename)

    return {"uploaded": uploaded}


@app.get("/api/download")
async def download(
    path: str = "",
    token: str = "",
    dl: bool = False,
    user=Depends(get_optional_user),
):
    if not user and not token:
        raise HTTPException(status_code=401)
    if token and not user:
        try:
            jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        except JWTError:
            raise HTTPException(status_code=401)
    target = safe_path(path)
    if not target.exists():
        raise HTTPException(status_code=404)
    if target.is_dir():
        raise HTTPException(status_code=400)
    if dl:
        return FileResponse(target, filename=target.name)
    return FileResponse(target)


VIDEO_EXTS = {".mp4", ".mov", ".avi", ".mkv", ".wmv", ".flv", ".webm", ".m4v", ".3gp", ".mpg", ".mpeg", ".ts", ".rmvb", ".ogv", ".mts"}


@app.get("/api/thumbnail")
async def thumbnail(
    path: str = "",
    token: str = "",
    user=Depends(get_optional_user),
):
    if not user and not token:
        raise HTTPException(status_code=401)
    if token and not user:
        try:
            jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        except JWTError:
            raise HTTPException(status_code=401)

    target = safe_path(path)
    if not target.exists():
        raise HTTPException(status_code=404)
    if not target.is_file():
        raise HTTPException(status_code=400)

    cache_key = hashlib.md5(str(target.resolve()).encode()).hexdigest() + ".jpg"
    cache_path = THUMB_DIR / cache_key

    if cache_path.exists():
        return FileResponse(cache_path, media_type="image/jpeg")

    try:
        from imageio_ffmpeg import get_ffmpeg_exe
        ffmpeg = get_ffmpeg_exe()
    except Exception:
        raise HTTPException(status_code=500, detail="ffmpeg not available")

    try:
        result = subprocess.run(
            [
                ffmpeg,
                "-ss", "1",
                "-i", str(target),
                "-vframes", "1",
                "-vf", "scale=512:-1",
                "-f", "image2pipe",
                "-vcodec", "mjpeg",
                "-",
            ],
            capture_output=True,
            timeout=30,
        )
        if result.returncode != 0 or not result.stdout:
            raise HTTPException(status_code=500, detail="Cannot generate thumbnail")
        cache_path.write_bytes(result.stdout)
        return FileResponse(cache_path, media_type="image/jpeg")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=500, detail="Cannot generate thumbnail")


@app.delete("/api/files")
async def delete(path: str = "", user=Depends(get_current_user)):
    target = safe_path(path)
    if not target.exists():
        raise HTTPException(status_code=404)
    if target == ROOT_DIR:
        raise HTTPException(status_code=400)

    if target.is_dir():
        shutil.rmtree(target)
    else:
        target.unlink()

    return {"deleted": str(target.relative_to(ROOT_DIR))}


@app.post("/api/mkdir")
async def mkdir(path: str = Form(""), name: str = Form(...), user=Depends(get_current_user)):
    target = safe_path(path) / name
    if target.exists():
        raise HTTPException(status_code=400)
    target.mkdir(parents=True)
    return {"created": str(target.relative_to(ROOT_DIR))}


@app.get("/api/disk")
async def disk(user=Depends(get_current_user)):
    usage = shutil.disk_usage(ROOT_DIR)
    return {
        "total": fmt_size(usage.total),
        "used": fmt_size(usage.used),
        "free": fmt_size(usage.free),
        "root": str(ROOT_DIR),
    }


def get_local_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"


def print_qrcode(url: str):
    try:
        import qrcode
        qr = qrcode.QRCode(border=1)
        qr.add_data(url)
        qr.make(fit=True)
        matrix = qr.get_matrix()
        for row in matrix:
            print("    " + "".join("██" if cell else "  " for cell in row))
        print()
    except Exception:
        print(f"\n    {url}\n")


def start():
    host = config["server"]["host"]
    port = config["server"]["port"]
    local_ip = get_local_ip()
    local_url = f"http://{local_ip}:{port}"

    print(f"""
  ╔══════════════════════════════════════════╗
  ║           ☁️  YunPan 云盘                 ║
  ╠══════════════════════════════════════════╣
  ║  Local:   http://localhost:{port:<5}        ║
  ║  Network: {local_url:<35}║
  ║  Root:    {str(ROOT_DIR):<35}║
  ╚══════════════════════════════════════════╝
""")
    print("  📱 手机浏览器打开上方 Network 地址即可访问\n")

    try:
        print_qrcode(local_url)
    except Exception:
        pass

    uvicorn.run(app, host=host, port=port, log_level="warning")


if __name__ == "__main__":
    start()
