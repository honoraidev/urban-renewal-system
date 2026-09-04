from contextlib import asynccontextmanager

import anyio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from database import SessionLocal, engine, wait_for_db
import models  # noqa: F401 - ensures all models are registered with SQLAlchemy
from models.activity_log import ActivityLog
from routers import auth, building_view, contacts, dashboard, documents, encumbrances, expenses, landowners, ocr, ocr_intake, projects, resources, sop, users
from seed import ensure_admin_account
from security import decode_access_token
from utils.activity import describe_request

_MUTATING_METHODS = {"POST", "PATCH", "PUT", "DELETE"}


@asynccontextmanager
async def lifespan(app: FastAPI):
    wait_for_db()
    # schema.sql is applied manually, but these two newer tables self-create so the
    # 個人工作看板 works without a manual migration step on existing databases.
    models.ActivityLog.__table__.create(bind=engine, checkfirst=True)
    models.CalendarEvent.__table__.create(bind=engine, checkfirst=True)
    db = SessionLocal()
    try:
        ensure_admin_account(db)
    finally:
        db.close()
    # Deliberately NOT eagerly loading the PaddleOCR engine here at startup - lazily
    # loading on first OCR call (see _get_paddle_ocr_engine in utils/ocr.py) prevents
    # memory pressure on limited RAM systems while preserving optimal inference speed.
    yield


app = FastAPI(title="Urban Renewal Management System API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def _write_activity(user_id, project_id, method, path, label, status_code):
    db = SessionLocal()
    try:
        db.add(
            ActivityLog(
                user_id=user_id,
                project_id=project_id,
                method=method,
                path=path[:500],
                action=label[:120],
                status_code=status_code,
            )
        )
        db.commit()
    finally:
        db.close()


class ActivityLogMiddleware:
    """Pure-ASGI (not BaseHTTPMiddleware) so it never buffers/blocks the response.
    Records every successful mutating request into activity_logs, keyed to the caller
    from their JWT. Best-effort: any failure here must never affect the response."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope.get("method") not in _MUTATING_METHODS:
            await self.app(scope, receive, send)
            return

        status_code = 500

        async def send_wrapper(message):
            nonlocal status_code
            if message["type"] == "http.response.start":
                status_code = message["status"]
            await send(message)

        await self.app(scope, receive, send_wrapper)

        try:
            if status_code >= 400:
                return
            headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers", [])}
            auth = headers.get("authorization", "")
            if not auth.lower().startswith("bearer "):
                return
            try:
                payload = decode_access_token(auth[7:])
                user_id = int(payload["sub"]) if payload.get("sub") else None
            except Exception:
                return
            if user_id is None:
                return
            label, project_id = describe_request(scope["method"], scope["path"])
            if label is None:
                return
            await anyio.to_thread.run_sync(
                _write_activity, user_id, project_id, scope["method"], scope["path"], label, status_code
            )
        except Exception:
            pass


app.add_middleware(ActivityLogMiddleware)

app.include_router(auth.router)
app.include_router(projects.router)
app.include_router(dashboard.router)
app.include_router(landowners.router)
app.include_router(contacts.router)
app.include_router(sop.router)
app.include_router(documents.router)
app.include_router(expenses.router)
app.include_router(expenses.category_router)
app.include_router(users.router)
app.include_router(ocr.router)
app.include_router(ocr_intake.router)
app.include_router(encumbrances.router)
app.include_router(resources.router)
app.include_router(building_view.router)


@app.get("/health")
def health():
    return {"ok": True}
