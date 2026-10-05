from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from database import get_db
from deps import get_current_user, require_sys_admin
from models.announcement import Announcement
from models.user import User

router = APIRouter(prefix="/announcements", tags=["announcements"])


class AnnouncementIn(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    content: str | None = Field(default=None, max_length=4000)
    level: Literal["info", "warning", "urgent"] = "info"
    expires_at: datetime | None = None


class AnnouncementPatch(BaseModel):
    is_active: bool | None = None


def _out(a: Announcement) -> dict:
    return {
        "id": a.id,
        "title": a.title,
        "content": a.content,
        "level": a.level,
        "is_active": a.is_active,
        "expires_at": a.expires_at.isoformat() if a.expires_at else None,
        "created_by_name": a.created_by_name,
        "created_at": a.created_at.isoformat() if a.created_at else None,
    }


def _naive_utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


@router.get("")
def list_active(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """所有登入者:目前有效(啟用且未過期)的公告,新的在前。"""
    now = _naive_utc_now()
    rows = db.scalars(
        select(Announcement)
        .where(Announcement.is_active.is_(True), or_(Announcement.expires_at.is_(None), Announcement.expires_at > now))
        .order_by(Announcement.created_at.desc(), Announcement.id.desc())
    ).all()
    return [_out(a) for a in rows]


@router.get("/all")
def list_all(db: Session = Depends(get_db), _: User = Depends(require_sys_admin)):
    rows = db.scalars(select(Announcement).order_by(Announcement.created_at.desc(), Announcement.id.desc()).limit(100)).all()
    return [_out(a) for a in rows]


@router.post("", status_code=status.HTTP_201_CREATED)
def create(body: AnnouncementIn, db: Session = Depends(get_db), user: User = Depends(require_sys_admin)):
    exp = body.expires_at
    if exp is not None and exp.tzinfo is not None:
        exp = exp.astimezone(timezone.utc).replace(tzinfo=None)
    a = Announcement(
        title=body.title.strip(),
        content=(body.content or "").strip() or None,
        level=body.level,
        expires_at=exp,
        created_by_name=user.display_name,
    )
    db.add(a)
    db.commit()
    db.refresh(a)
    return _out(a)


@router.patch("/{ann_id}")
def patch(ann_id: int, body: AnnouncementPatch, db: Session = Depends(get_db), _: User = Depends(require_sys_admin)):
    a = db.get(Announcement, ann_id)
    if a is None:
        raise HTTPException(status_code=404, detail="找不到公告")
    if body.is_active is not None:
        a.is_active = body.is_active
    db.commit()
    db.refresh(a)
    return _out(a)


@router.delete("/{ann_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete(ann_id: int, db: Session = Depends(get_db), _: User = Depends(require_sys_admin)):
    a = db.get(Announcement, ann_id)
    if a is None:
        raise HTTPException(status_code=404, detail="找不到公告")
    db.delete(a)
    db.commit()
