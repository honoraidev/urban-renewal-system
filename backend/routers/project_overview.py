from datetime import date

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from database import get_db
from deps import require_project_staff_viewer
from models.document import Document
from models.landowner import Landowner
from models.project import Project
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

    return {
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
            "land_share_ratio": consent["land_share_ratio"],
            "land_share_agreed_sqm": consent["land_share_agreed_sqm"],
            "land_share_total_sqm": consent["land_share_total_sqm"],
            "building_share_ratio": consent["building_share_ratio"],
            "building_share_agreed_sqm": consent["building_share_agreed_sqm"],
            "building_share_total_sqm": consent["building_share_total_sqm"],
        },
    }
