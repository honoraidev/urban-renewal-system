"""給 line-gateway 的 LIFF「系統快速查看」打的內部唯讀 API - 不吃使用者 JWT
(LIFF 那端認證的是 LINE 身分，不是本系統的帳密登入)，改用 X-Api-Key 這把共用金鑰，
再用呼叫端帶來的 employee_no 對回本系統的 User，套用跟一般登入一樣的權限規則。

CASE_LOOKUP_ENABLED=false（預設）時整組端點回 404，不影響其他功能。
"""
import hmac
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from config import settings
from database import get_db
from deps import MANAGE_ROLES
from models.project import Project, ProjectMember
from models.user import User
from routers.projects import _alert_tier_counts
from routers.sop import _final_stage_index, _resolved_stages, get_or_create_sop
from utils.visit_consent import compute_visit_breakdown

router = APIRouter(prefix="/internal/case-lookup", tags=["case-lookup"])


def _guard(request: Request):
    if not settings.CASE_LOOKUP_ENABLED or not settings.CASE_LOOKUP_API_KEY:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    if not hmac.compare_digest(request.headers.get("X-Api-Key", ""), settings.CASE_LOOKUP_API_KEY):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="bad api key")


def _employee_user(db: Session, employee_no: str) -> User:
    user = db.scalar(select(User).where(User.username == employee_no))
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="employee_not_found")
    return user


def _visible_projects_stmt(user: User):
    if user.role in MANAGE_ROLES:
        return select(Project).order_by(Project.created_at.desc())
    return (
        select(Project)
        .outerjoin(ProjectMember, ProjectMember.project_id == Project.id)
        .where(or_(Project.created_by == user.id, ProjectMember.user_id == user.id))
        .distinct()
        .order_by(Project.created_at.desc())
    )


def _stage_name(stage: int, sop) -> str:
    """關卡流程現在可能被客製化過(見 routers/sop.py 的自訂關卡流程),不能再假設每個
    案件都是同一份固定的 STAGE_DEFINITIONS - 要拿這個案件自己的 SopStage 來對名稱。"""
    entry = _resolved_stages(sop).get(str(stage))
    if entry:
        return entry["name"]
    return f"第{stage}關"


@router.get("/projects")
def list_my_projects(employee_no: str, request: Request, db: Session = Depends(get_db)):
    _guard(request)
    user = _employee_user(db, employee_no)
    projects = db.scalars(_visible_projects_stmt(user)).all()
    result = []
    for p in projects:
        sop = get_or_create_sop(db, p.id)
        result.append({
            "id": p.id,
            "project_code": p.project_code,
            "name": p.name,
            "district": p.district,
            "current_stage": p.current_stage,
            "final_stage": _final_stage_index(sop),
            "stage_name": _stage_name(p.current_stage, sop),
        })
    return {"projects": result}


@router.get("/projects/{project_id}/summary")
def project_summary(project_id: int, employee_no: str, request: Request, db: Session = Depends(get_db)):
    _guard(request)
    user = _employee_user(db, employee_no)
    project = db.get(Project, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    if project.id not in {p.id for p in db.scalars(_visible_projects_stmt(user)).all()}:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)

    sop = get_or_create_sop(db, project.id)
    # 跟網頁「案件卡片 / 關鍵指標」同一套定義(最新一次拜訪結果),不是 SOP 關卡
    # 湊關用的嚴格版(電訪同意 + 已簽約)——兩套刻意不同,詳見 utils/visit_consent.py
    # 開頭的說明,這裡要跟使用者平常在網頁上看到的數字一致。
    v = compute_visit_breakdown(db, project.id)
    headcount_ratio = v["headcount_agreed"] / v["headcount_total"] if v["headcount_total"] else 0.0
    land_ratio = v["land_agreed_sqm"] / v["land_total_sqm"] if v["land_total_sqm"] else 0.0
    building_ratio = v["building_agreed_sqm"] / v["building_total_sqm"] if v["building_total_sqm"] else 0.0
    consent = {
        "headcount_total": v["headcount_total"],
        "headcount_agreed": v["headcount_agreed"],
        "headcount_opposed": v["headcount_opposed"],
        "headcount_ratio": headcount_ratio,
        "land_share_ratio": land_ratio,
        "building_share_ratio": building_ratio,
        "dual_gate_passed": headcount_ratio >= 0.8 and land_ratio >= 0.8,
    }
    alert_tiers = _alert_tier_counts(db, project.id)

    return {
        "id": project.id,
        "project_code": project.project_code,
        "name": project.name,
        "district": project.district,
        "current_stage": project.current_stage,
        "final_stage": _final_stage_index(sop),
        "stage_name": _stage_name(project.current_stage, sop),
        "consent": consent,
        "alert_tiers": alert_tiers,
        "as_of": datetime.now(timezone.utc).isoformat(),
    }
