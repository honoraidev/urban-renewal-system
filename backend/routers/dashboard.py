from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from config import settings
from database import get_db
from deps import MANAGE_ROLES, LANDOWNER_ROLE, get_current_user
from models.contact_log import ContactLog
from models.landowner import Landowner
from models.ocr import OcrJob
from models.project import Project, ProjectMember
from models.user import User
from routers.contacts import (
    _contactable_landowners_with_last_contact,
    _is_overdue,
    _normalize_datetime,
)
from routers.projects import _alert_tier_counts
from schemas.dashboard import (
    MyWorkFollowUpItem,
    MyWorkProjectItem,
    MyWorkRecentContactItem,
    MyWorkResponse,
    MyWorkStats,
)
from utils.consent_ratio import calculate_consent_ratio

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


def _visible_projects(db: Session, user: User) -> list[Project]:
    """L1/L2 see every project; L3-L6 only the ones they're assigned to. 地主(L7) get
    nothing here - this board is a staff work queue, not a landowner-facing view."""
    if user.role == LANDOWNER_ROLE:
        return []
    stmt = select(Project).order_by(Project.created_at.desc())
    if user.role not in MANAGE_ROLES:
        member_ids = db.scalars(
            select(ProjectMember.project_id).where(ProjectMember.user_id == user.id)
        ).all()
        if not member_ids:
            return []
        stmt = (
            select(Project)
            .where(Project.id.in_(member_ids))
            .order_by(Project.created_at.desc())
        )
    return list(db.scalars(stmt))


@router.get("/my-work", response_model=MyWorkResponse)
def get_my_work(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    projects = _visible_projects(db, current_user)
    project_ids = [p.id for p in projects]
    project_name_by_id = {p.id: p.name for p in projects}

    project_items: list[MyWorkProjectItem] = []
    follow_ups: list[MyWorkFollowUpItem] = []
    totals = {"reminder": 0, "warning": 0, "urgent": 0}
    now = datetime.now(timezone.utc)

    for p in projects:
        ratio = calculate_consent_ratio(db, p.id, p.current_stage)
        tiers = _alert_tier_counts(db, p.id)
        for key in totals:
            totals[key] += tiers[key]
        project_items.append(
            MyWorkProjectItem(
                id=p.id,
                name=p.name,
                project_code=p.project_code,
                city=p.city,
                district=p.district,
                status=p.status,
                current_stage=p.current_stage,
                headcount_ratio=ratio["headcount_ratio"],
                land_share_ratio=ratio["land_share_ratio"],
                building_share_ratio=ratio["building_share_ratio"],
                reminder_count=tiers["reminder"],
                warning_count=tiers["warning"],
                urgent_count=tiers["urgent"],
            )
        )

        landowners, last_contact_by_landowner = _contactable_landowners_with_last_contact(db, p.id)
        for owner in landowners:
            last_contact = _normalize_datetime(last_contact_by_landowner.get(owner.id))
            if not _is_overdue(owner, last_contact):
                continue
            days = (now - last_contact).days if last_contact is not None else None
            follow_ups.append(
                MyWorkFollowUpItem(
                    project_id=p.id,
                    project_name=p.name,
                    landowner_id=owner.id,
                    landowner_name=owner.name,
                    phone=owner.phone,
                    contact_status=owner.contact_status,
                    last_contact_date=last_contact,
                    days_since_last_contact=days,
                )
            )

    # Never-contacted first, then longest-overdue first.
    follow_ups.sort(key=lambda f: (f.days_since_last_contact is not None, -(f.days_since_last_contact or 0)))
    follow_ups = follow_ups[:30]

    recent_rows = db.execute(
        select(ContactLog, Landowner.name)
        .join(Landowner, Landowner.id == ContactLog.landowner_id)
        .where(ContactLog.staff_id == current_user.id, ContactLog.project_id.in_(project_ids))
        .order_by(ContactLog.contact_date.desc())
        .limit(12)
    ).all() if project_ids else []
    recent_contacts = [
        MyWorkRecentContactItem(
            project_id=log.project_id,
            project_name=project_name_by_id.get(log.project_id, ""),
            landowner_id=log.landowner_id,
            landowner_name=owner_name,
            contact_date=log.contact_date,
            contact_method=log.contact_method,
            contact_result=log.contact_result,
            notes=log.notes,
        )
        for log, owner_name in recent_rows
    ]

    pending_ai = (
        db.scalar(
            select(func.count(OcrJob.id)).where(
                OcrJob.project_id.in_(project_ids),
                or_(
                    OcrJob.status == "failed",
                    (OcrJob.status == "completed") & OcrJob.error_message.isnot(None),
                ),
            )
        )
        or 0
    ) if project_ids else 0

    return MyWorkResponse(
        stats=MyWorkStats(
            project_count=len(projects),
            follow_up_count=len(follow_ups),
            reminder_count=totals["reminder"],
            warning_count=totals["warning"],
            urgent_count=totals["urgent"],
            pending_ai_review_count=pending_ai,
        ),
        projects=project_items,
        follow_ups=follow_ups,
        recent_contacts=recent_contacts,
    )
