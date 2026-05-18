# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
python3 server.py                     # start the server
pip3 install -r requirements.txt     # install deps (pip3, not pip; brackets matter: uvicorn[standard])
```

There are no tests, no linter, no typecheck, no CI, and no build step.

## Architecture

- **Single-file backend**: `server.py` — FastAPI app, all routes, auth, and the `start()` entrypoint.
- **Vanilla frontend**: `templates/` (Jinja2 HTML) + `static/css/style.css` + `static/js/app.js` — no framework, no build step, no package.json.
- **Config**: `config.yaml` — auto-modified on first run to generate and persist a `secret_key`. `storage.root_dir` uses `~` expansion. Auto-creates `图片/`, `视频/`, `其它/`, and `.thumbnails/` subdirectories on startup.

### API routes (all in server.py)

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/login` | none | Login page |
| GET | `/` | token | Main app page |
| POST | `/api/token` | password | Returns JWT |
| GET | `/api/files` | token | List directory; sorts folders-first, case-insensitive name |
| POST | `/api/upload` | token | Multipart upload |
| GET | `/api/download` | token or `?token=` | Serves file; query param token for `<img>`/`<video>` embedding |
| GET | `/api/thumbnail` | token or `?token=` | Video first-frame thumbnail via ffmpeg; cached in `.thumbnails/` |
| DELETE | `/api/files` | token | Delete file or directory tree |
| POST | `/api/mkdir` | token | Create directory |
| GET | `/api/disk` | token | Disk usage stats |

### Auth model

- Password login at `POST /api/token` returns HS256 JWT.
- `HTTPBearer` on most routes; `get_optional_user` allows token-as-query-param for download/thumbnail (media embedding).
- `get_current_user` raises 401; `get_optional_user` returns `None` instead.

### Frontend structure

- `app.js` is a single IIFE that branches on `window.location.pathname` (`/login` vs `/`).
- Token stored in `localStorage` with in-memory fallback (`_m` object) for localStorage failures.
- Upload uses `XMLHttpRequest` (not `fetch`) to avoid FormData issues; groups files by category (`图片`/`视频`/`其它`) and uploads 3 parallel requests.
- Gallery mode activates when browsing `图片/` or `视频/` directories — switches to image grid with lightbox (arrows, swipe, keyboard nav).
- Lightbox supports both images and video; video thumbnails are generated server-side via ffmpeg on first access.

## Key quirks

- **`config.yaml` is auto-written** on first run to persist the generated `secret_key`. Always read it to understand current state.
- **`uvicorn[standard]`** — `requirements.txt` has the `[standard]` extra; dropping the brackets breaks install on some shells.
- **`pip3`** on macOS (not `pip`).
- Hidden entries (prefix `.`) are excluded from file listings; thumbnail cache lives in `.thumbnails/`.
- Video thumbnails use `imageio-ffmpeg` which bundles an FFmpeg binary — no system FFmpeg required.
- File listing sorts folders-first, then by name (case-insensitive).
- `safe_path()` uses `.resolve()` + prefix check to prevent path traversal.
