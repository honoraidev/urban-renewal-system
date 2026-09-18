from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from config import settings
from database import get_db
from deps import LANDOWNER_ROLE, get_current_user, require_project_editor, require_project_viewer
from models.contact_log import ContactLog
from models.landowner import Landowner
from models.project import Project
from models.user import User
from schemas.contact import AlertItem, ContactLogCreate, ContactLogRead, ContactSummaryItem

router = APIRouter(tags=["contacts"])


@router.get("/projects/{project_id}/landowners/{landowner_id}/contacts", response_model=list[ContactLogRead])
def list_contacts(
    landowner_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    project: Project = Depends(require_project_viewer),
):
    project_id = project.id
    if current_user.role == LANDOWNER_ROLE:
        owner = db.get(Landowner, landowner_id)
        if owner is None or owner.project_id != project_id or owner.user_id != current_user.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your own record")
    return db.scalars(
        select(ContactLog)
        .where(ContactLog.project_id == project_id, ContactLog.landowner_id == landowner_id)
        .order_by(ContactLog.contact_date.desc())
    ).all()


@router.post(
    "/projects/{project_id}/landowners/{landowner_id}/contacts",
    response_model=ContactLogRead,
    status_code=status.HTTP_201_CREATED,
)
def create_contact(
    landowner_id: int,
    payload: ContactLogCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    project: Project = Depends(require_project_editor),
):
    project_id = project.id
    landowner = db.get(Landowner, landowner_id)
    if landowner is None or landowner.project_id != project_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Landowner not found in this project")

    contact = ContactLog(
        project_id=project_id,
        landowner_id=landowner_id,
        staff_id=current_user.id,
        **payload.model_dump(exclude={"landowner_id"}),
    )
    db.add(contact)

    # landowners.contact_status 的 ENUM 值是 not_contacted/contacted/declined/agreed -
    # 跟 contact_logs.contact_result 的 opposed 對不起來(歷史命名不同),直接把
    # payload.contact_result 塞進去在 contact_result="opposed" 時會踩到 DB 的 ENUM
    # 限制丟 1265 Data truncated,整支 API 500(建立拜訪紀錄選「反對」永遠失敗、
    # 前端看起來像按鈕沒反應)。要對到 "declined" 才存得進去。
    if payload.contact_result == "agreed":
        landowner.contact_status = "agreed"
    elif payload.contact_result == "opposed":
        landowner.contact_status = "declined"
    elif landowner.contact_status == "not_contacted":
        landowner.contact_status = "contacted"

    # 拜訪結果只要不是「未接聽」(沒真的聯絡到人),就代表這次真的有拜訪到 - 樓棟
    # 視圖編輯地主視窗的「拜訪/簽約狀態」未拜訪 chip 自動翻成已拜訪,不用使用者
    # 自己手動再點一次(建立拜訪紀錄跟勾「已拜訪」是兩個分開的手動動作,很容易漏勾)。
    if payload.contact_result != "no_answer" and landowner.visit_status == "not_visited":
        landowner.visit_status = "visited"

    db.commit()
    db.refresh(contact)
    return contact


def _normalize_datetime(val: datetime | str | None) -> datetime | None:
    if val is None:
        return None
    if isinstance(val, str):
        try:
            val = datetime.fromisoformat(val)
        except ValueError:
            return None
    if isinstance(val, datetime) and val.tzinfo is None:
        val = val.replace(tzinfo=timezone.utc)
    return val


def _contactable_landowners_with_last_contact(db: Session, project_id: int):
    """Shared by /alerts and /contact-summary: landowners who actually own a stake in
    the case (land or building - a Landowner row that only exists as an encumbrance's
    right_holder isn't someone to contact), paired with their last contact_logs date."""
    all_landowners = db.scalars(
        select(Landowner)
        .options(selectinload(Landowner.land_records), selectinload(Landowner.building_records))
        .where(Landowner.project_id == project_id)
    ).all()
    landowners = [o for o in all_landowners if o.land_records or o.building_records]

    last_contact_stmt = (
        select(ContactLog.landowner_id, func.max(ContactLog.contact_date).label("last_contact"))
        .where(ContactLog.project_id == project_id)
        .group_by(ContactLog.landowner_id)
    )
    last_contact_by_landowner = {}
    for row in db.execute(last_contact_stmt):
        dt = _normalize_datetime(row.last_contact)
        if dt is not None:
            last_contact_by_landowner[row.landowner_id] = dt

    return landowners, last_contact_by_landowner


def _last_contact_result_by_landowner(db: Session, project_id: int) -> dict[int, str]:
    """Latest contact_logs row per landowner (by contact_date), just the result field -
    separate from _contactable_landowners_with_last_contact's max(date) query since that
    one doesn't tell us which row the max date actually came from. Backs the roster
    table's 聯絡結果 column (replaced the old reply_status field there)."""
    result: dict[int, str] = {}
    logs = db.scalars(
        select(ContactLog).where(ContactLog.project_id == project_id).order_by(ContactLog.contact_date.asc())
    ).all()
    for log in logs:
        result[log.landowner_id] = log.contact_result
    return result


def _is_overdue(owner: Landowner, last_contact: datetime | None) -> bool:
    # A landowner who has already signed (意願狀態 = 已簽約) no longer needs follow-up.
    if owner.agreement_status == "signed":
        return False
    if owner.contact_status == "not_contacted":
        return True
    last_contact = _normalize_datetime(last_contact)
    if last_contact is None:
        return False
    days_since = (datetime.now(timezone.utc) - last_contact).days
    return days_since >= settings.ALERT_UNCONTACTED_DAYS


@router.get("/projects/{project_id}/alerts", response_model=list[AlertItem])
def list_alerts(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    project: Project = Depends(require_project_viewer),
):
    if current_user.role == LANDOWNER_ROLE:
        return []
    landowners, last_contact_by_landowner = _contactable_landowners_with_last_contact(db, project.id)

    now = datetime.now(timezone.utc)
    alerts: list[AlertItem] = []
    for owner in landowners:
        last_contact = _normalize_datetime(last_contact_by_landowner.get(owner.id))
        days_since = (now - last_contact).days if last_contact is not None else None

        if _is_overdue(owner, last_contact):
            alerts.append(
                AlertItem(
                    landowner_id=owner.id,
                    landowner_name=owner.name,
                    contact_status=owner.contact_status,
                    last_contact_date=last_contact,
                    days_since_last_contact=days_since,
                )
            )

    return alerts


@router.get("/projects/{project_id}/contact-summary", response_model=list[ContactSummaryItem])
def list_contact_summary(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    project: Project = Depends(require_project_viewer),
):
    """Every contactable landowner's last contact date + overdue flag (unlike /alerts,
    which only returns the overdue ones) - backs the roster table's 最近聯繫/聯繫狀態 columns."""
    landowners, last_contact_by_landowner = _contactable_landowners_with_last_contact(db, project.id)
    if current_user.role == LANDOWNER_ROLE:
        landowners = [o for o in landowners if o.user_id == current_user.id]
    last_result_by_landowner = _last_contact_result_by_landowner(db, project.id)
    return [
        ContactSummaryItem(
            landowner_id=owner.id,
            last_contact_date=last_contact_by_landowner.get(owner.id),
            last_contact_result=last_result_by_landowner.get(owner.id),
            is_overdue=_is_overdue(owner, last_contact_by_landowner.get(owner.id)),
        )
        for owner in landowners
    ]
