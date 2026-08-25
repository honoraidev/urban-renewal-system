from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from config import settings
from database import get_db
from deps import get_current_user, require_project_editor, require_project_viewer
from models.contact_log import ContactLog
from models.landowner import Landowner
from models.project import Project
from models.user import User
from schemas.contact import AlertItem, ContactLogCreate, ContactLogRead

router = APIRouter(tags=["contacts"])


@router.get("/projects/{project_id}/landowners/{landowner_id}/contacts", response_model=list[ContactLogRead])
def list_contacts(
    landowner_id: int,
    db: Session = Depends(get_db),
    project: Project = Depends(require_project_viewer),
):
    project_id = project.id
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

    if payload.contact_result in ("agreed", "opposed"):
        landowner.contact_status = payload.contact_result
    elif landowner.contact_status == "not_contacted":
        landowner.contact_status = "contacted"

    db.commit()
    db.refresh(contact)
    return contact


@router.get("/projects/{project_id}/alerts", response_model=list[AlertItem])
def list_alerts(
    db: Session = Depends(get_db),
    project: Project = Depends(require_project_viewer),
):
    project_id = project.id
    landowners = db.scalars(select(Landowner).where(Landowner.project_id == project_id)).all()

    last_contact_stmt = (
        select(ContactLog.landowner_id, func.max(ContactLog.contact_date).label("last_contact"))
        .where(ContactLog.project_id == project_id)
        .group_by(ContactLog.landowner_id)
    )
    last_contact_by_landowner = {row.landowner_id: row.last_contact for row in db.execute(last_contact_stmt)}

    now = datetime.now(timezone.utc)
    alerts: list[AlertItem] = []
    for owner in landowners:
        last_contact = last_contact_by_landowner.get(owner.id)
        days_since = None
        if last_contact is not None:
            days_since = (now - last_contact.replace(tzinfo=timezone.utc)).days

        is_overdue = owner.contact_status == "not_contacted" or (
            days_since is not None and days_since >= settings.ALERT_UNCONTACTED_DAYS
        )
        if is_overdue:
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
