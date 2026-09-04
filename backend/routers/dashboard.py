from datetime import date, datetime, time, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from database import get_db
from deps import MANAGE_ROLES, LANDOWNER_ROLE, get_current_user
from models.activity_log import ActivityLog
from models.calendar_event import CalendarEvent
from models.contact_log import ContactLog
from models.landowner import Landowner
from models.project import Project, ProjectMember
from models.user import User
from schemas.dashboard import (
    CalendarEventCreate,
    CalendarEventItem,
    CalendarEventUpdate,
    MyWorkResponse,
    ProjectOption,
    TodayActivityItem,
    TodayFollowUpItem,
)

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


def _visible_project_ids(db: Session, user: User) -> list[int]:
    if user.role == LANDOWNER_ROLE:
        return []
    if user.role in MANAGE_ROLES:
        return list(db.scalars(select(Project.id)))
    return list(
        db.scalars(select(ProjectMember.project_id).where(ProjectMember.user_id == user.id))
    )


def _month_bounds(month: str | None) -> tuple[str, date, date]:
    """(normalised 'YYYY-MM', first day, first day of next month)."""
    today = datetime.utcnow().date()
    if month:
        try:
            y, m = (int(x) for x in month.split("-"))
            first = date(y, m, 1)
        except (ValueError, TypeError):
            first = today.replace(day=1)
    else:
        first = today.replace(day=1)
    nxt = date(first.year + 1, 1, 1) if first.month == 12 else date(first.year, first.month + 1, 1)
    return f"{first.year:04d}-{first.month:02d}", first, nxt


@router.get("/my-work", response_model=MyWorkResponse)
def get_my_work(
    month: str | None = Query(default=None, description="YYYY-MM, defaults to current month"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project_ids = _visible_project_ids(db, current_user)
    project_name_by_id = dict(
        db.execute(select(Project.id, Project.name).where(Project.id.in_(project_ids))).all()
    ) if project_ids else {}

    now = datetime.utcnow()
    day_start = datetime.combine(now.date(), time.min)
    day_end = day_start + timedelta(days=1)

    # --- 今日跟進地主 (distinct landowners this user logged a contact for today) ---
    followup_rows = db.execute(
        select(ContactLog.landowner_id, Landowner.name, Landowner.project_id)
        .join(Landowner, Landowner.id == ContactLog.landowner_id)
        .where(
            ContactLog.staff_id == current_user.id,
            ContactLog.contact_date >= day_start,
            ContactLog.contact_date < day_end,
        )
    ).all()
    seen: set[int] = set()
    today_followups: list[TodayFollowUpItem] = []
    for lid, lname, pid in followup_rows:
        if lid in seen:
            continue
        seen.add(lid)
        today_followups.append(
            TodayFollowUpItem(
                project_id=pid,
                project_name=project_name_by_id.get(pid, ""),
                landowner_id=lid,
                landowner_name=lname,
            )
        )

    # --- 今日操作紀錄 ---
    activity_rows = db.scalars(
        select(ActivityLog)
        .where(
            ActivityLog.user_id == current_user.id,
            ActivityLog.created_at >= day_start,
            ActivityLog.created_at < day_end,
        )
        .order_by(ActivityLog.created_at.desc())
        .limit(200)
    ).all()
    today_activities = [
        TodayActivityItem(
            id=a.id,
            action=a.action,
            method=a.method,
            path=a.path,
            project_id=a.project_id,
            project_name=project_name_by_id.get(a.project_id) if a.project_id else None,
            created_at=a.created_at,
        )
        for a in activity_rows
    ]

    # --- 行事曆 (this month) ---
    norm_month, first_day, next_month = _month_bounds(month)
    ev_filter = CalendarEvent.created_by == current_user.id
    if project_ids:
        ev_filter = ev_filter | CalendarEvent.project_id.in_(project_ids)
    events = db.scalars(
        select(CalendarEvent)
        .where(
            CalendarEvent.event_date >= first_day,
            CalendarEvent.event_date < next_month,
            ev_filter,
        )
        .order_by(CalendarEvent.event_date, CalendarEvent.id)
    ).all()
    creator_names = dict(
        db.execute(
            select(User.id, User.display_name).where(
                User.id.in_({e.created_by for e in events if e.created_by})
            )
        ).all()
    )
    is_manager = current_user.role in MANAGE_ROLES
    calendar_events = [
        CalendarEventItem(
            id=e.id,
            event_date=e.event_date,
            content=e.content,
            project_id=e.project_id,
            project_name=project_name_by_id.get(e.project_id) if e.project_id else None,
            created_by=e.created_by,
            created_by_name=creator_names.get(e.created_by),
            can_edit=is_manager or e.created_by == current_user.id,
        )
        for e in events
    ]

    project_options = [
        ProjectOption(id=pid, name=project_name_by_id.get(pid, str(pid)))
        for pid in project_ids
        if pid in project_name_by_id
    ]
    project_options.sort(key=lambda p: p.name)

    return MyWorkResponse(
        today=now.date(),
        today_followup_count=len(today_followups),
        today_followups=today_followups,
        today_activities=today_activities,
        calendar_month=norm_month,
        calendar_events=calendar_events,
        project_options=project_options,
    )


def _get_event_or_404(db: Session, event_id: int) -> CalendarEvent:
    ev = db.get(CalendarEvent, event_id)
    if ev is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="行事曆備註不存在")
    return ev


def _assert_can_use_project(db: Session, user: User, project_id: int) -> None:
    if user.role in MANAGE_ROLES:
        if db.get(Project, project_id) is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="案件不存在")
        return
    member = db.scalar(
        select(ProjectMember.id).where(
            ProjectMember.project_id == project_id, ProjectMember.user_id == user.id
        )
    )
    if member is None:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="非此案件成員")


@router.post("/calendar", response_model=CalendarEventItem, status_code=status.HTTP_201_CREATED)
def create_calendar_event(
    payload: CalendarEventCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if current_user.role == LANDOWNER_ROLE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="地主帳號不可使用")
    if payload.project_id is not None:
        _assert_can_use_project(db, current_user, payload.project_id)
    ev = CalendarEvent(
        created_by=current_user.id,
        project_id=payload.project_id,
        event_date=payload.event_date,
        content=payload.content.strip(),
    )
    db.add(ev)
    db.commit()
    db.refresh(ev)
    project_name = None
    if ev.project_id:
        p = db.get(Project, ev.project_id)
        project_name = p.name if p else None
    return CalendarEventItem(
        id=ev.id,
        event_date=ev.event_date,
        content=ev.content,
        project_id=ev.project_id,
        project_name=project_name,
        created_by=ev.created_by,
        created_by_name=current_user.display_name,
        can_edit=True,
    )


@router.patch("/calendar/{event_id}", response_model=CalendarEventItem)
def update_calendar_event(
    event_id: int,
    payload: CalendarEventUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ev = _get_event_or_404(db, event_id)
    if current_user.role not in MANAGE_ROLES and ev.created_by != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="只能修改自己建立的備註")
    if payload.content is not None:
        ev.content = payload.content.strip()
    if payload.event_date is not None:
        ev.event_date = payload.event_date
    db.commit()
    db.refresh(ev)
    project_name = None
    if ev.project_id:
        p = db.get(Project, ev.project_id)
        project_name = p.name if p else None
    creator = db.get(User, ev.created_by) if ev.created_by else None
    return CalendarEventItem(
        id=ev.id,
        event_date=ev.event_date,
        content=ev.content,
        project_id=ev.project_id,
        project_name=project_name,
        created_by=ev.created_by,
        created_by_name=creator.display_name if creator else None,
        can_edit=True,
    )


@router.delete("/calendar/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_calendar_event(
    event_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    ev = _get_event_or_404(db, event_id)
    if current_user.role not in MANAGE_ROLES and ev.created_by != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="只能刪除自己建立的備註")
    db.delete(ev)
    db.commit()
