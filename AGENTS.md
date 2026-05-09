# AGENTS.md — 私人云

## Quick start

```bash
pip3 install -r requirements.txt   # brackets matter: uvicorn[standard]
python3 server.py                   # not `uvicorn server:app` — run.sh does the same
```

## Architecture

- **Single-file backend**: `server.py` — FastAPI app, all routes, and the `start()` entrypoint.
- **Vanilla frontend**: `templates/` (Jinja2 HTML) + `static/` (no framework, no build step, no package.json).
- **Config**: `config.yaml` is auto-modified on first run — a `secret_key` is generated and written back to the file.
- **Storage root**: `storage.root_dir` in config; `~` is expanded. Auto-creates `图片/`, `视频/`, `其它/`, and `.thumbnails/` subdirectories.

## Commands

```bash
python3 server.py      # start the server
pip3 install -r requirements.txt  # install deps (pip3, not pip)
```

There are no tests, no linter, no typecheck, no CI, and no build step.

## Auth model

- Password-based login at `POST /api/token` returns a JWT (HS256).
- Most API routes require `Authorization: Bearer <token>`.
- `GET /api/download` and `GET /api/thumbnail` also accept a `?token=` query param (for `<img>` / `<video>` embedding).

## Key quirks

- **`config.yaml` is auto-written** on first run to persist the generated `secret_key`. If you run without a config file, it will create the key section.
- **`uvicorn[standard]`** — the `[standard]` extra is in `requirements.txt`; dropping the brackets breaks things.
- **`pip3`** on macOS (not `pip`).
- Hidden entries (prefix `.`) are excluded from file listings and thumbnail caching is in `.thumbnails/`.
- Video thumbnails use `imageio-ffmpeg` which bundles an FFmpeg binary — no system FFmpeg required.
- File listing sorts folders-first, then by name (case-insensitive).
