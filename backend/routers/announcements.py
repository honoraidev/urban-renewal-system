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
    maint_start: datetime | None = None
    maint_end: datetime | None = None


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
        "maint_start": a.maint_start.isoformat() if a.maint_start else None,
        "maint_end": a.maint_end.isoformat() if a.maint_end else None,
        "created_by_name": a.created_by_name,
        "created_at": a.created_at.isoformat() if a.created_at else None,
    }


def _naive_utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _to_naive_utc(dt: datetime | None) -> datetime | None:
    if dt is not None and dt.tzinfo is not None:
        return dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt


def active_maintenance(db: Session) -> dict | None:
    """目前生效中的系統維護:公告仍上架、沒過「顯示到」、且 maint_start 已到。maint_end 只是預計時間,
    不會自動解除維護(完成時間不一定)。回傳最新開始的那一筆,沒有就 None。登入端用它擋非系統管理員。"""
    now = _naive_utc_now()
    a = db.scalars(
        select(Announcement)
        .where(
            Announcement.is_active.is_(True),
            Announcement.maint_start.isnot(None),
            Announcement.maint_start <= now,
            or_(Announcement.expires_at.is_(None), Announcement.expires_at > now),
        )
        .order_by(Announcement.maint_start.desc())
    ).first()
    if a is None:
        return None
    return {
        "maintenance": True,
        "title": a.title,
        "message": a.content,
        "start": a.maint_start.isoformat() + "Z",
        "end": (a.maint_end.isoformat() + "Z") if a.maint_end else None,
    }


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
    exp = _to_naive_utc(body.expires_at)
    m_start = _to_naive_utc(body.maint_start)
    m_end = _to_naive_utc(body.maint_end)
    if m_end is not None and m_start is None:
        raise HTTPException(status_code=400, detail="請先設定維護開始時間")
    if m_start is not None and m_end is not None and m_end <= m_start:
        raise HTTPException(status_code=400, detail="預計結束時間必須晚於維護開始時間")
    a = Announcement(
        title=body.title.strip(),
        content=(body.content or "").strip() or None,
        level=body.level,
        expires_at=exp,
        maint_start=m_start,
        maint_end=m_end,
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
