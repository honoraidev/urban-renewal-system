from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from database import get_db
from deps import require_project_staff_viewer
from models.building_record import BuildingRecord
from models.calendar_event import CalendarEvent
from models.document import Document
from models.land_record import LandRecord
from models.landowner import Landowner
from models.project import Project
from routers.contacts import _last_contact_result_by_landowner
from routers.documents import DOC_TYPE_LABELS_MAP
from routers.sop import (
    CONTACT_RATE_KEYS,
    CONTACT_RATE_THRESHOLD,
    DUAL_GATE_KEYS,
    STAGE_CHECKLIST_REQUIREMENTS,
    _resolved_stages,
    get_or_create_sop,
)
from utils.consent_ratio import calculate_consent_ratio

router = APIRouter(prefix="/projects/{project_id}/overview", tags=["project-overview"])


# 內建關卡的「待辦項目」清單(label 跟前端 sop.js 的 SOP_STAGE_CHECKLISTS 同一份文案):
# kind = doc(要有該類型文件)/ land、building(要有匯入的登記資料)/ manual(要在 SOP 頁
# 手動確認)/ phone(至少一位地主有電話)/ contact_rate、ratio(達門檻,見 sop.py)。
_BUILTIN_STAGE_TASKS: dict[str, list[dict]] = {
    "initial_approval": [{"kind": "doc", "doc_type": "roi_report", "label": "上傳投報表"}],
    "ocr_roster": [
        {"kind": "doc", "doc_type": "cadastral_map", "label": "上傳地籍圖"},
        {"kind": "land", "label": "上傳土地謄本PDF"},
        {"kind": "building", "label": "上傳建物謄本PDF"},
        {"kind": "manual", "key": "landowner_roster_confirmed", "label": "確認地主清冊正確"},
    ],
    "contact_rate": [
        {"kind": "phone", "label": "地主聯絡方式建立"},
        {"kind": "contact_rate", "threshold": CONTACT_RATE_THRESHOLD, "label": "達到95%聯絡門檻"},
    ],
    "briefing_1": [
        {"kind": "doc", "doc_type": "briefing_material", "label": "上傳說明會簡報"},
        {"kind": "manual", "key": "briefing_reviewed_3", "label": "主管審核通過"},
    ],
    "consent_dual_1": [{"kind": "ratio", "threshold": 0.8, "label": "達到同意度雙門檻(人數與面積皆 ≥ 80%)"}],
    "consultant_review": [
        {"kind": "doc", "doc_type": "consultant_document", "label": "上傳顧問文件"},
        {"kind": "manual", "key": "consultant_reviewed", "label": "主管審核通過"},
    ],
    "briefing_2": [
        {"kind": "doc", "doc_type": "briefing_material", "label": "上傳說明會簡報"},
        {"kind": "doc", "doc_type": "consent_form_template", "label": "上傳同意書範本"},
        {"kind": "doc", "doc_type": "contract_template", "label": "上傳合約範本"},
        {"kind": "manual", "key": "briefing_reviewed_6", "label": "主管審核通過"},
    ],
    "briefing_3": [
        {"kind": "doc", "doc_type": "briefing_material", "label": "上傳說明會簡報"},
        {"kind": "manual", "key": "briefing_reviewed_7", "label": "主管審核通過"},
    ],
    "consent_dual_2": [{"kind": "ratio", "threshold": 0.8, "label": "達到同意度雙門檻(人數與面積皆 ≥ 80%)"}],
    "consent_final": [{"kind": "ratio", "threshold": 0.8, "label": "達到同意度雙門檻(人數與面積皆 ≥ 80%)"}],
}


def _generic_stage_tasks(requirements: dict) -> list[dict]:
    """自訂關卡流程的 requirements(見 sop.py _assert_generic_requirements)轉成同樣格式。"""
    tasks: list[dict] = []
    if requirements.get("document_required"):
        doc_type = requirements.get("document_type")
        tasks.append({"kind": "doc", "doc_type": doc_type, "label": f"上傳{DOC_TYPE_LABELS_MAP.get(doc_type, doc_type or '文件')}"})
    if requirements.get("contact_rate_required"):
        threshold = requirements.get("contact_rate_threshold") or 0.95
        tasks.append({"kind": "contact_rate", "threshold": threshold, "label": f"達到聯絡率門檻({round(threshold * 100)}%)"})
    if requirements.get("ratio_required"):
        threshold = requirements.get("ratio_threshold") or 0.8
        tasks.append({"kind": "ratio", "threshold": threshold, "label": f"達到同意度雙門檻(人數與面積皆 ≥ {round(threshold * 100)}%)"})
    if requirements.get("manual_required"):
        tasks.append({"kind": "manual", "key": "manual_confirmed", "label": requirements.get("manual_label") or "人工確認"})
    return tasks


def _stage_tasks(db: Session, project_id: int, idx_str: str, entry: dict) -> list[dict]:
    """單一關卡過關需要做的事,每項帶 done 狀態 - 案件總覽「待辦事項」的「這階段/下階段」
    區塊用。判斷邏輯跟 sop.py 的 _assert_gate_passed 同一套(自訂 requirements 優先)。"""
    data = entry.get("data") or {}
    requirements = data.get("requirements")
    templates = (
        _generic_stage_tasks(requirements)
        if requirements is not None
        else _BUILTIN_STAGE_TASKS.get(entry.get("key"), [])
    )
    checklist = data.get("checklist") or {}
    stage_index = int(idx_str)

    def _landowner_counts() -> tuple[int, int]:
        total = db.scalar(select(func.count(Landowner.id)).where(Landowner.project_id == project_id)) or 0
        reached = db.scalar(
            select(func.count(Landowner.id)).where(
                Landowner.project_id == project_id, Landowner.contact_status != "not_contacted"
            )
        ) or 0
        return total, reached

    tasks = []
    for t in templates:
        kind = t["kind"]
        if kind == "doc":
            done = bool(t.get("doc_type")) and db.scalar(
                select(Document.id).where(Document.project_id == project_id, Document.doc_type == t["doc_type"]).limit(1)
            ) is not None
        elif kind == "land":
            done = db.scalar(select(LandRecord.id).where(LandRecord.project_id == project_id).limit(1)) is not None
        elif kind == "building":
            done = db.scalar(select(BuildingRecord.id).where(BuildingRecord.project_id == project_id).limit(1)) is not None
        elif kind == "manual":
            done = t["key"] in checklist
        elif kind == "phone":
            done = db.scalar(
                select(Landowner.id)
                .where(
                    Landowner.project_id == project_id,
                    (func.coalesce(func.trim(Landowner.phone_landline), "") != "")
                    | (func.coalesce(func.trim(Landowner.phone_mobile), "") != ""),
                )
                .limit(1)
            ) is not None
        elif kind == "contact_rate":
            total, reached = _landowner_counts()
            done = total > 0 and reached / total >= t["threshold"]
        else:  # ratio
            done = calculate_consent_ratio(db, project_id, stage_index, threshold=t["threshold"])["dual_gate_passed"]
        tasks.append({"label": t["label"], "done": bool(done)})
    return tasks


def _stage_task_block(db: Session, project_id: int, stages: dict, idx: int | None) -> dict | None:
    if idx is None or str(idx) not in stages:
        return None
    entry = stages[str(idx)]
    return {
        "index": idx,
        "name": entry.get("name"),
        "status": entry.get("status") or "pending",
        "tasks": _stage_tasks(db, project_id, str(idx), entry),
    }


@router.get("/todos")
def get_project_todos(
    project_id: int,
    db: Session = Depends(get_db),
    project: Project = Depends(require_project_staff_viewer),
):
    """案件總覽頁「待辦事項」卡片用 - 這個案件底下的行事曆備註(跟工作看板行事曆
    同一份 calendar_events 資料,只是這裡篩成單一案件),依日期由近到遠排序,今天
    以前的過期項目排最後面(還是要看得到,只是優先權比較低)。sop_stage 是這筆待辦
    歸在哪一關(沒指定 = null,前端歸在「這階段」)。"""
    today = date.today()
    events = db.scalars(
        select(CalendarEvent)
        .where(CalendarEvent.project_id == project_id)
        .order_by(CalendarEvent.event_date)
    ).all()
    upcoming = sorted((e for e in events if e.event_date >= today), key=lambda e: e.event_date)
    overdue = sorted((e for e in events if e.event_date < today), key=lambda e: e.event_date, reverse=True)
    ordered = upcoming + overdue
    return [
        {
            "id": e.id,
            "event_date": e.event_date,
            "content": e.content,
            "is_important": e.is_important,
            "sop_stage": e.sop_stage,
            "is_overdue": e.event_date < today,
        }
        for e in ordered
    ]


def _headcount_detail(db: Session, project_id: int, before: datetime | None = None) -> dict:
    """依「每位地主最新一次拜訪結果」把人數同意拆成同意/反對/未決定/未回覆四類 —— 跟
    utils/visit_consent.py 同一份資料源,只是這裡多拆出「未決定」跟「未回覆」兩類
    (未決定=標記未決定或需回電;未回覆=標記未接聽或完全沒聯絡過)。案件總覽卡片
    的人數同意細項用,不是 SOP 關卡用的嚴格雙門檻定義。"""
    # before 有值 = 還原那個時間點當下的狀態(關鍵指標「本週 vs 上週」用,見 projects.py)。
    results = _last_contact_result_by_landowner(db, project_id, before)
    landowner_ids = db.scalars(select(Landowner.id).where(Landowner.project_id == project_id)).all()
    agreed = opposed = undecided = no_response = 0
    for lid in landowner_ids:
        r = results.get(lid)
        if r == "agreed":
            agreed += 1
        elif r == "opposed":
            opposed += 1
        elif r in ("undecided", "callback_needed"):
            undecided += 1
        else:
            no_response += 1
    return {
        "total": len(landowner_ids),
        "agreed": agreed,
        "opposed": opposed,
        "undecided": undecided,
        "no_response": no_response,
    }


def _stage_progress_pct(db: Session, project_id: int, idx_str: str, entry: dict) -> int:
    """單一關卡的進度%,不編假數字 —— 已完成/強制結案的關卡算 100%,還沒輪到的關卡
    算 0%,「進行中」的那一關則盡量沿用它自己既有的自動門檻邏輯反推一個真實比例
    (雙門檻同意度取兩者較低者、意願調查看聯絡率、有清冊要求的關卡看文件/checklist
    完成比例),完全沒有量化訊號的關卡(如純人工確認的說明會)就先算 0%,不硬湊。"""
    status_ = entry.get("status") or "pending"
    if status_ in ("completed", "force_closed"):
        return 100
    if status_ != "in_progress":
        return 0

    key = entry.get("key")
    stage_index = int(idx_str)

    if key in DUAL_GATE_KEYS:
        ratio = calculate_consent_ratio(db, project_id, stage_index)
        return round(min(ratio["headcount_ratio"], ratio["land_share_ratio"]) * 100)

    if key in CONTACT_RATE_KEYS:
        total = db.scalar(select(func.count(Landowner.id)).where(Landowner.project_id == project_id)) or 0
        if total == 0:
            return 0
        reached = db.scalar(
            select(func.count(Landowner.id)).where(
                Landowner.project_id == project_id, Landowner.contact_status != "not_contacted"
            )
        ) or 0
        ratio = reached / total
        return round(min(100, ratio / CONTACT_RATE_THRESHOLD * 100))

    reqs = STAGE_CHECKLIST_REQUIREMENTS.get(key)
    if reqs:
        checklist = (entry.get("data") or {}).get("checklist") or {}
        doc_types = reqs.get("doc_types", [])
        checklist_keys = reqs.get("checklist_keys", [])
        total_items = len(doc_types) + len(checklist_keys)
        if total_items == 0:
            return 0
        done_items = 0
        for doc_type in doc_types:
            if db.scalar(select(Document.id).where(Document.project_id == project_id, Document.doc_type == doc_type)):
                done_items += 1
        for ck in checklist_keys:
            if checklist.get(ck):
                done_items += 1
        return round(done_items / total_items * 100)

    return 0


def _risk_and_delay(project: Project) -> tuple[str, int]:
    """風險等級/延遲天數不是獨立欄位,系統裡也沒有排程資料可推算真正的風險模型 —
    唯一能拿來判斷的是案件自己填的「預計完成日」。已結案/強制結案的案件不評風險。
    延遲天數 = 今天已經超過預計完成日多少天(還沒到期就是 0)。"""
    if project.status == "closed" or project.is_force_closed:
        return "-", 0
    if not project.expected_completion_date:
        return "未設定", 0
    days_left = (project.expected_completion_date - date.today()).days
    if days_left < 0:
        return "high", -days_left
    if days_left <= 30:
        return "medium", 0
    return "low", 0


@router.get("")
def get_project_overview(
    project_id: int,
    db: Session = Depends(get_db),
    project: Project = Depends(require_project_staff_viewer),
):
    sop = get_or_create_sop(db, project_id)
    stages = _resolved_stages(sop)

    stage_list = []
    for idx_str in sorted(stages.keys(), key=int):
        entry = stages[idx_str]
        stage_list.append(
            {
                "index": int(idx_str),
                "key": entry.get("key"),
                "name": entry.get("name"),
                "status": entry.get("status") or "pending",
                "pct": _stage_progress_pct(db, project_id, idx_str, entry),
            }
        )
    overall_pct = round(sum(s["pct"] for s in stage_list) / len(stage_list)) if stage_list else 0

    risk_level, delay_days = _risk_and_delay(project)
    next_milestone = next((s for s in stage_list if s["status"] in ("pending", "in_progress")), None)

    consent = calculate_consent_ratio(db, project_id, sop.current_stage)

    # 「上週」= 上週結束(本週一 00:00)當下的狀態,做法同 projects.py 案件卡片的本週 vs 上週。
    this_monday = date.today() - timedelta(days=date.today().weekday())
    last_week_end = datetime.combine(this_monday, datetime.min.time())

    all_done = sop.stage_data["final"]["status"] != "pending"
    current_idx = None if all_done else sop.current_stage
    next_idx = current_idx + 1 if current_idx is not None else None

    return {
        "stage_tasks": {
            "current": _stage_task_block(db, project_id, stages, current_idx),
            "next": _stage_task_block(db, project_id, stages, next_idx),
        },
        "overall_progress_pct": overall_pct,
        "stages": stage_list,
        "case_status": {
            "status": project.status,
            "is_force_closed": project.is_force_closed,
            "risk_level": risk_level,
            "delay_days": delay_days,
            "next_milestone_name": next_milestone["name"] if next_milestone else None,
            "expected_completion_date": project.expected_completion_date,
            "updated_at": project.updated_at,
        },
        "key_metrics": {
            "headcount_ratio": consent["headcount_ratio"],
            "headcount_agreed": consent["headcount_agreed"],
            "headcount_total": consent["headcount_total"],
            "headcount_detail": _headcount_detail(db, project_id),
            "headcount_detail_last_week": _headcount_detail(db, project_id, last_week_end),
            "last_week_date": (this_monday - timedelta(days=1)).isoformat(),
            "land_share_ratio": consent["land_share_ratio"],
            "land_share_agreed_sqm": consent["land_share_agreed_sqm"],
            "land_share_total_sqm": consent["land_share_total_sqm"],
            "building_share_ratio": consent["building_share_ratio"],
            "building_share_agreed_sqm": consent["building_share_agreed_sqm"],
            "building_share_total_sqm": consent["building_share_total_sqm"],
        },
    }
