
import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timedelta

import anyio
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import settings
from database import SessionLocal, engine, wait_for_db
import models  # noqa: F401 - ensures all models are registered with SQLAlchemy
from models.activity_log import ActivityLog
from routers import auth, building_view, case_lookup, contacts, dashboard, development, documents, encumbrances, expenses, landowners, ocr, ocr_intake, project_notes, projects, resources, sop, sso, users
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
        models.NewsItem.__table__.create(bind=engine, checkfirst=True)
        models.DevelopmentStage.__table__.create(bind=engine, checkfirst=True)
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
        ("projects", "expected_completion_date", "DATE NULL"),
        ("encumbrances", "secured_amount", "BIGINT NULL"),
        ("encumbrances", "property_address", "VARCHAR(255) NULL"),
        ("encumbrances", "obligors", "JSON NULL"),
        ("encumbrances", "parcel_kind", "VARCHAR(20) NULL"),
        ("landowners", "line_id", "VARCHAR(100) NULL"),
        ("landowners", "email", "VARCHAR(255) NULL"),
        ("documents", "sop_stage", "INT NULL"),
        ("building_records", "related_encumbrance_orders", "VARCHAR(255) NULL"),
        ("land_records", "ltt_original_value_history", "JSON NULL"),
        ("news_items", "published_at", "DATETIME NULL"),
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

    # news_items.url 原本是 VARCHAR(500),但 Google 新聞 RSS 的轉址連結常常超過 500 字
    # (實測看過將近 900 字),存進去會被截斷成打不開的網址,還會讓不同文章的截斷結果
    # 剛好前綴相同、去重比對打架誤判成新資料。加大到 VARCHAR(1000)。
    try:
        with engine.connect() as _conn:
            _conn.execute(_sql_text("SET SESSION innodb_lock_wait_timeout = 5"))
            _conn.execute(_sql_text("ALTER TABLE news_items MODIFY COLUMN url VARCHAR(1000) NOT NULL"))
            _conn.commit()
    except Exception as exc:
        print(f"[auto_migrate] news_items.url widen skipped: {exc}", flush=True)

    # news_sync_state:記錄「每日新聞抓取」上次執行時間的單列表(給新聞頁面右上角
    # 顯示同步時間用),舊資料庫沒有這張表,補建起來。
    try:
        with engine.connect() as _conn:
            _conn.execute(_sql_text("SET SESSION innodb_lock_wait_timeout = 5"))
            _conn.execute(
                _sql_text(
                    "CREATE TABLE IF NOT EXISTS news_sync_state ("
                    "id INT PRIMARY KEY, last_synced_at DATETIME NOT NULL"
                    ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
                )
            )
            _conn.commit()
    except Exception as exc:
        print(f"[auto_migrate] news_sync_state create skipped: {exc}", flush=True)

    # documents.doc_type ENUM: 拿掉已停用的 dev_letter_template / willingness_form_template,
    # 加入 roi_report(投報表)、willingness_form(地主編輯視窗「已拜訪」上傳的意願書,跟
    # 已移除的 willingness_form_template 是不同東西 - 那是公司文件範本庫的分類,這個是
    # 每位地主自己的一份意願書)、landowner_roster(下載地主清冊 Excel 時自動存進文件分頁
    # 的那份)。只有在定義真的不一致時才 MODIFY(MODIFY 會重建整張表);若還有列在用舊值
    # 就跳過不動(收窄 ENUM 會把那些列變成空字串)。
    _DOCTYPE_ENUM = (
        "ENUM('property_register','building_register','consent_form','briefing_material',"
        "'contract','photo','other','consent_form_template','contract_template',"
        "'cadastral_map','consultant_document','roi_report','willingness_form','landowner_roster')"
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

    try:
        # 舊的 sop_stages 資料列(客製化關卡流程功能上線前建的案件)每一關沒有存
        # "key" 欄位 - 補上去,並把舊的技術性關卡名稱("第0關:初始核定立案")換成
        # 現在前端統一顯示用的短標籤,讓所有案件(不管新舊)顯示邏輯一致。
        from sqlalchemy import select as _select

        from models.sop import SopStage
        from routers.sop import DEFAULT_KEY_BY_INDEX, STAGE_DEF_BY_KEY

        rows = db_session_for_migrate = SessionLocal()
        try:
            sops = rows.scalars(_select(SopStage)).all()
            changed = False
            for sop in sops:
                stages = (sop.stage_data or {}).get("stages") or {}
                if not stages or all("key" in (entry or {}) for entry in stages.values()):
                    continue
                stage_data = dict(sop.stage_data)
                new_stages = {}
                for idx_str, entry in stages.items():
                    e = dict(entry)
                    if "key" not in e:
                        key = DEFAULT_KEY_BY_INDEX.get(int(idx_str))
                        e["key"] = key
                        if key:
                            e["name"] = STAGE_DEF_BY_KEY[key]["name"]
                    new_stages[idx_str] = e
                stage_data["stages"] = new_stages
                sop.stage_data = stage_data
                changed = True
            if changed:
                rows.commit()
        finally:
            db_session_for_migrate.close()
    except Exception as exc:
        print(f"[auto_migrate] sop stage key backfill skipped: {exc}", flush=True)

    try:
        # 開發流程功能上線初期預設是空白(要 L2 以上自己建),後來改成有預設關卡 -
        # 把還沒被動過(沒有任何關卡、current_stage 還是 0)的舊資料列補上預設關卡,
        # 新案件則是 get_or_create_dev 建立當下就直接帶預設值,不用等這裡補。
        from sqlalchemy import select as _select3

        from models.development_stage import DevelopmentStage
        from routers.development import _default_stage_data

        _dev_db = SessionLocal()
        try:
            devs = _dev_db.scalars(_select3(DevelopmentStage)).all()
            changed = False
            for dev in devs:
                stages = (dev.stage_data or {}).get("stages") or {}
                if not stages and dev.current_stage == 0:
                    dev.stage_data = _default_stage_data()
                    changed = True
            if changed:
                _dev_db.commit()
        finally:
            _dev_db.close()
    except Exception as exc:
        print(f"[auto_migrate] development default stages backfill skipped: {exc}", flush=True)


async def _daily_news_fetch_loop() -> None:
    """背景常駐迴圈:每天本機時間 9:00 抓一次都更/危老新聞(見 utils/news_fetch)。單次
    失敗只印警告,不能讓這個迴圈掛掉 - 掛掉就永遠不會再排下一次。"""
    from utils.news_fetch import fetch_and_store_news

    while True:
        now = datetime.now()
        target = now.replace(hour=9, minute=0, second=0, microsecond=0)
        if target <= now:
            target += timedelta(days=1)
        await asyncio.sleep((target - now).total_seconds())
        try:
            db = SessionLocal()
            try:
                created = fetch_and_store_news(db)
                print(f"[news_fetch] daily run added {len(created)} item(s)", flush=True)
            finally:
                db.close()
        except Exception as exc:
            print(f"[news_fetch] daily run failed (ignored): {exc}", flush=True)


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
    news_task = asyncio.create_task(_daily_news_fetch_loop())
    yield
    news_task.cancel()


app = FastAPI(title="Urban Renewal Management System API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# 依標籤裡的關鍵字挑一個代表圖示，讓 LINE 通知卡片一眼就能分辨動作種類，
# 不用每個 endpoint 自己指定 —— 跟 utils/activity.py 一樣走「規則表」路線。
_ICON_RULES: list[tuple[str, str]] = [
    ("刪除", "🗑️"), ("移除", "🗑️"),
    ("上傳", "📄"),
    ("OCR", "🔍"),
    ("費用", "💰"),
    ("同意書", "📝"),
    ("SOP", "✅"), ("過關", "✅"), ("結案", "✅"),
    ("地主", "👤"),
    ("成員", "👥"),
    ("新增", "➕"), ("建立", "➕"),
    ("修改", "✏️"), ("編輯", "✏️"),
]


def _icon_for_label(label: str) -> str:
    for kw, icon in _ICON_RULES:
        if kw in label:
            return icon
    return "🔔"


def _write_activity(user_id, project_id, landowner_id, method, path, label, status_code, detail=None):
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
        # detail 是端點自己塞進 request.state 的補充資訊(目前只有上傳文件的檔名),
        # 跟 landowner 姓名一樣,併進同一個 label 字串,活動紀錄跟 LINE 通知都吃得到。
        if detail:
            label = f"{label}：{detail}"
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
        case_value = f"{pname}（{pcode}）" if pname else str(pcode)
        text = f"【都更】{pname}({pcode})\n{label}"
        if actor:
            text += f"\n經手:{actor.display_name}"
        link = None
        if settings.NOTIFY_LINK_BASE:
            link = f"{settings.NOTIFY_LINK_BASE.rstrip('/')}/projects/{project_id}"
        meta = [{"label": "案件", "value": case_value}]
        if proj and proj.district:
            meta.append({"label": "行政區", "value": proj.district})
        meta.append({"label": "動作", "value": label})
        if actor:
            meta.append({"label": "經手", "value": actor.display_name})
        _send({
            "employee_nos": emps,
            "roles": ["manager"],
            "text": text,
            "link": link,
            "action_icon": _icon_for_label(label),
            "meta": meta,
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
            # request.state 底層就是 scope["state"](Starlette Request 只是包了一層讀寫介面),
            # 跟這個中介層共用同一份 scope dict,所以端點在 sync def 裡設的值,就算是在
            # threadpool 執行、離開後 contextvar 不會回傳,這條路徑還是讀得到。
            state = scope.get("state") or {}
            detail = state.get("activity_detail")
            # 「建立案件」是 POST /projects,路徑本身不帶 id,上面的路徑正則抓不到
            # project_id —— 用端點自己塞回來的剛建好的 id 補上,新案件才能觸發通知。
            if project_id is None:
                project_id = state.get("activity_project_id")
            await anyio.to_thread.run_sync(
                _write_activity, user_id, project_id, landowner_id, scope["method"], scope["path"], label,
                status_code, detail,
            )
        except Exception:
            pass


app.add_middleware(ActivityLogMiddleware)

app.include_router(auth.router)
app.include_router(sso.router)
app.include_router(case_lookup.router)
app.include_router(projects.router)
app.include_router(dashboard.router)
app.include_router(landowners.router)
app.include_router(contacts.router)
app.include_router(sop.router)
app.include_router(development.router)
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
