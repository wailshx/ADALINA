# ADALINA Project Rules

## Deployment Workflow (MANDATORY)

**Always verify before committing and pushing.** The server lifecycle rule:

1. **Syntax check** — Verify all modified files compile/lint without errors (Python: `py_compile`, JS: `node --check`, CSS/HTML: brace/tag balance)
2. **Local server test** — Start all 3 processes (`bash start.sh`), verify HTTP status codes (main: 302, admin: 200)
3. **Commit** — Stage only intended files, write a concise commit message
4. **Push** — Push to origin/main
5. **Verify live** — Wait for Render to redeploy (~15s), then confirm the live site loads without errors (HTTP 200/302, CSS served, no stale references)

**Never skip verification steps.** If a step fails, fix the issue before proceeding to the next step.

## Project Architecture

- Three-process architecture: `server.py` (port 3000), `admin/app.py` (port 5000), `proxy.py` (port 8080)
- All launched by `start.sh`
- Python 3.14 stdlib-only backend, vanilla HTML/CSS/JS frontend, SQLite DB
- Deployed on Render (free tier — no persistent disk)

## Environment

- `CORS_ORIGIN` defaults to `https://adalina-v2.onrender.com`
- Persistent disk mount: `/opt/render/project/src/data` (only on paid instances)
- Admin auth: cookie-based session (not JWT)

## Code Conventions

- SQL placeholders: `%s` -> `?` for SQLite
- No hardcoded category names — use `size_system` column on categories table
- No comments in code unless explicitly requested
- Follow existing code style and patterns
