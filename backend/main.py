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


def _auto_migrate() -> None:
    """Best-effort schema top-ups for existing databases. Must NEVER raise - a failure
    here previously crashed lifespan and made every request (incl. login) hang."""
    try:
        models.ActivityLog.__table__.create(bind=engine, checkfirst=True)
        models.CalendarEvent.__table__.create(bind=engine, checkfirst=True)
    except Exception as exc:
        print(f"[auto_migrate] table create skipped: {exc}", flush=True)

    from sqlalchemy import text as _sql_text

    # Drop the FKs that deadlock login(): login_logs / activity_logs INSERTs take a
    # shared lock on the users row that races with `UPDATE users SET last_login_at`
    # (MySQL error 1213). Both are append-only audit logs - no FK needed.
    for _tbl in ("login_logs", "activity_logs"):
        try:
            with engine.connect() as _conn:
                _names = [
                    r[0]
                    for r in _conn.execute(
                        _sql_text(
                            "SELECT constraint_name FROM information_schema.key_column_usage "
                            "WHERE table_schema = DATABASE() AND table_name = :t "
                            "AND referenced_table_name = 'users'"
                        ),
                        {"t": _tbl},
                    )
                ]
                for _fk in _names:
                    _conn.execute(_sql_text(f"ALTER TABLE {_tbl} DROP FOREIGN KEY `{_fk}`"))
                _conn.commit()
                if _names:
                    print(f"[auto_migrate] dropped FK on {_tbl}: {_names}", flush=True)
        except Exception as exc:
            print(f"[auto_migrate] DROP FK on {_tbl} skipped: {exc}", flush=True)

    for _col, _ddl in (
        ("untaxed_amount", "DECIMAL(12,2) NULL"),
        ("tax_amount", "DECIMAL(12,2) NULL"),
        ("seller_tax_id", "VARCHAR(20) NULL"),
        ("buyer_tax_id", "VARCHAR(20) NULL"),
    ):
        try:
            with engine.connect() as _conn:
                _conn.execute(
                    _sql_text(f"ALTER TABLE expenses ADD COLUMN IF NOT EXISTS {_col} {_ddl}")
                )
                _conn.commit()
        except Exception as exc:
            print(f"[auto_migrate] ALTER expenses {_col} skipped: {exc}", flush=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    wait_for_db()
    try:
        _auto_migrate()
    except Exception as exc:
        print(f"[lifespan] _auto_migrate failed (ignored): {exc}", flush=True)
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
