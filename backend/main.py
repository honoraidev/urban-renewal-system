from contextlib import asynccontextmanager

import anyio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from database import SessionLocal, engine, wait_for_db
import models  # noqa: F401 - ensures all models are registered with SQLAlchemy
from models.activity_log import ActivityLog
from routers import auth, building_view, contacts, dashboard, documents, encumbrances, expenses, landowners, ocr, ocr_intake, project_notes, projects, resources, sop, sso, users
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
        models.InventoryItem.__table__.create(bind=engine, checkfirst=True)
        models.ProjectNote.__table__.create(bind=engine, checkfirst=True)
        models.DocumentFolder.__table__.create(bind=engine, checkfirst=True)
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

    for _tbl, _col, _ddl in (
        ("expenses", "untaxed_amount", "DECIMAL(12,2) NULL"),
        ("expenses", "tax_amount", "DECIMAL(12,2) NULL"),
        ("expenses", "seller_tax_id", "VARCHAR(20) NULL"),
        ("expenses", "buyer_tax_id", "VARCHAR(20) NULL"),
        ("building_records", "main_use", "VARCHAR(50) NULL"),
        ("building_records", "common_part_shares", "JSON NULL"),
        ("users", "departments", "JSON NULL"),
        ("users", "titles", "JSON NULL"),
        ("users", "title", "VARCHAR(100) NULL"),
        ("landowners", "visit_status", "VARCHAR(20) NOT NULL DEFAULT 'not_visited'"),
        ("landowners", "reply_status", "VARCHAR(20) NOT NULL DEFAULT 'not_replied'"),
        ("inventory_items", "custodian_dept", "VARCHAR(100) NULL"),
        ("inventory_items", "borrower_dept", "VARCHAR(100) NULL"),
        ("documents", "folder_id", "INT NULL"),
        ("encumbrances", "secured_amount", "BIGINT NULL"),
        ("building_records", "related_encumbrance_orders", "VARCHAR(255) NULL"),
    ):
        try:
            with engine.connect() as _conn:
                # 若某條長交易正鎖著這張表,ALTER 會卡到 lock timeout(預設 50s)並拖住
                # 整個啟動;設短一點,卡住就跳過(欄位多半早就存在,IF NOT EXISTS 是 no-op)。
                _conn.execute(_sql_text("SET SESSION innodb_lock_wait_timeout = 5"))
                _conn.execute(
                    _sql_text(f"ALTER TABLE {_tbl} ADD COLUMN IF NOT EXISTS {_col} {_ddl}")
                )
                _conn.commit()
        except Exception as exc:
            print(f"[auto_migrate] ALTER {_tbl} {_col} skipped: {exc}", flush=True)

    # documents.doc_type ENUM: 拿掉已停用的 dev_letter_template / willingness_form_template,
    # 加入 roi_report(投報表)、willingness_form(地主編輯視窗「已拜訪」上傳的意願書,跟
    # 已移除的 willingness_form_template 是不同東西 - 那是公司文件範本庫的分類,這個是
    # 每位地主自己的一份意願書)。只有在定義真的不一致時才 MODIFY(MODIFY 會重建整張表);
    # 若還有列在用舊值就跳過不動(收窄 ENUM 會把那些列變成空字串)。
    _DOCTYPE_ENUM = (
        "ENUM('property_register','building_register','consent_form','briefing_material',"
        "'contract','photo','other','consent_form_template','contract_template',"
        "'cadastral_map','consultant_document','roi_report','willingness_form')"
    )
    try:
        with engine.connect() as _conn:
            _cur_type = _conn.execute(
                _sql_text(
                    "SELECT COLUMN_TYPE FROM information_schema.columns "
                    "WHERE table_schema = DATABASE() AND table_name = 'documents' "
                    "AND column_name = 'doc_type'"
                )
            ).scalar() or ""
            _want = _DOCTYPE_ENUM.lower().replace(" ", "")
            if _cur_type.lower().replace(" ", "") != _want:
                _stale = _conn.execute(
                    _sql_text(
                        "SELECT COUNT(*) FROM documents "
                        "WHERE doc_type IN ('dev_letter_template','willingness_form_template')"
                    )
                ).scalar()
                if _stale:
                    print(
                        f"[auto_migrate] doc_type ENUM narrow skipped: {_stale} row(s) still use "
                        "dev_letter_template/willingness_form_template",
                        flush=True,
                    )
                else:
                    _conn.execute(_sql_text("SET SESSION innodb_lock_wait_timeout = 5"))
                    _conn.execute(
                        _sql_text(
                            f"ALTER TABLE documents MODIFY COLUMN doc_type {_DOCTYPE_ENUM} "
                            "NOT NULL DEFAULT 'other'"
                        )
                    )
                    _conn.commit()
                    print("[auto_migrate] documents.doc_type ENUM updated (+roi_report)", flush=True)
    except Exception as exc:
        print(f"[auto_migrate] doc_type ENUM update skipped: {exc}", flush=True)

    # 謄本辨識現在跑在背景執行緒;若上次是重啟中斷,job 會永遠停在 processing。
    # 開機時把卡超過 30 分鐘的 processing job 標成 failed,前端輪詢才不會一直等。
    try:
        with engine.connect() as _conn:
            _conn.execute(
                _sql_text(
                    "UPDATE ocr_jobs SET status='failed', "
                    "error_message='伺服器重啟中斷,請重新匯入', completed_at=NOW() "
                    "WHERE status='processing' AND started_at < NOW() - INTERVAL 30 MINUTE"
                )
            )
            _conn.commit()
    except Exception as exc:
        print(f"[auto_migrate] stale ocr_jobs sweep skipped: {exc}", flush=True)

    # documents.folder_id -> document_folders FK (the ALTER loop above only adds the
    # column). Best-effort: skip if it's already there or the table is locked.
    try:
        with engine.connect() as _conn:
            _exists = _conn.execute(
                _sql_text(
                    "SELECT 1 FROM information_schema.table_constraints "
                    "WHERE table_schema = DATABASE() AND table_name = 'documents' "
                    "AND constraint_name = 'fk_documents_folder'"
                )
            ).first()
            if not _exists:
                _conn.execute(_sql_text("SET SESSION innodb_lock_wait_timeout = 5"))
                _conn.execute(
                    _sql_text(
                        "ALTER TABLE documents ADD CONSTRAINT fk_documents_folder "
                        "FOREIGN KEY (folder_id) REFERENCES document_folders(id) ON DELETE SET NULL"
                    )
                )
                _conn.commit()
                print("[auto_migrate] added FK fk_documents_folder", flush=True)
    except Exception as exc:
        print(f"[auto_migrate] add FK fk_documents_folder skipped: {exc}", flush=True)

    # Seed the standard 案件資料 folder tree for every existing project, and file any
    # documents that still have no folder into the folder their legacy doc_type maps to.
    try:
        from utils.document_folders import folder_id_for_doc_type, seed_project_folders

        _db = SessionLocal()
        try:
            _project_ids = [r[0] for r in _db.execute(_sql_text("SELECT id FROM projects"))]
            for _pid in _project_ids:
                _fmap = seed_project_folders(_db, _pid)
                _db.flush()
                _rows = _db.execute(
                    _sql_text(
                        "SELECT id, doc_type FROM documents "
                        "WHERE project_id = :pid AND folder_id IS NULL"
                    ),
                    {"pid": _pid},
                ).all()
                for _doc_id, _doc_type in _rows:
                    _fid = folder_id_for_doc_type(_fmap, _doc_type)
                    if _fid:
                        _db.execute(
                            _sql_text("UPDATE documents SET folder_id = :fid WHERE id = :id"),
                            {"fid": _fid, "id": _doc_id},
                        )
            _db.commit()
        finally:
            _db.close()
    except Exception as exc:
        print(f"[auto_migrate] document folder seed/backfill skipped: {exc}", flush=True)


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


def _write_activity(user_id, project_id, landowner_id, method, path, label, status_code):
    db = SessionLocal()
    try:
        # 有 landowner_id 的話,把地主姓名併進標籤(在寫入當下,不是讀取當下 - 保留
        # 「當時是誰」的歷史紀錄,就算之後這位地主改名也不影響舊紀錄的可讀性),
        # 案件公告面板才看得出來是「誰」的資料被改了,不只是「地主資料被改了」。
        if landowner_id:
            try:
                owner = db.get(models.Landowner, landowner_id)
                if owner and owner.name:
                    label = f"{label} — {owner.name}"
            except Exception:
                pass
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
        _maybe_notify(db, user_id, project_id, label)
    finally:
        db.close()


def _maybe_notify(db, user_id, project_id, label):
    """案件內有寫入 → 推 LINE 給案件成員 + 主管。best-effort。"""
    try:
        from utils.sso_notify import enabled as _on, send as _send

        if not (_on() and project_id and label):
            return
        from models.project import Project, ProjectMember
        from models.user import User

        proj = db.get(Project, project_id)
        actor = db.get(User, user_id) if user_id else None
        emps = [
            u for (u,) in db.query(User.username)
            .join(ProjectMember, ProjectMember.user_id == User.id)
            .filter(ProjectMember.project_id == project_id)
            .all()
        ]
        pcode = proj.project_code if proj else project_id
        pname = proj.name if proj else ""
        text = f"【都更】{pname}({pcode})\n{label}"
        if actor:
            text += f"\n經手:{actor.display_name}"
        link = None
        if settings.NOTIFY_LINK_BASE:
            link = f"{settings.NOTIFY_LINK_BASE.rstrip('/')}/projects/{project_id}"
        _send({
            "employee_nos": emps,
            "roles": ["manager"],
            "exclude_employee_nos": [actor.username] if actor else [],
            "text": text,
            "link": link,
        })
    except Exception:  # noqa: BLE001
        pass


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
            label, project_id, landowner_id = describe_request(scope["method"], scope["path"])
            if label is None:
                return
            await anyio.to_thread.run_sync(
                _write_activity, user_id, project_id, landowner_id, scope["method"], scope["path"], label, status_code
            )
        except Exception:
            pass


app.add_middleware(ActivityLogMiddleware)

app.include_router(auth.router)
app.include_router(sso.router)
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
app.include_router(project_notes.router)
app.include_router(project_notes.feed_router)


@app.get("/health")
def health():
    return {"ok": True}
