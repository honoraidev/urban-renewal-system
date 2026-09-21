from datetime import date, datetime, time, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from database import get_db
from deps import EDIT_ROLES, MANAGE_ROLES, LANDOWNER_ROLE, get_current_user
from models.activity_log import ActivityLog
from models.calendar_event import CalendarEvent
from models.contact_log import ContactLog
from models.landowner import Landowner
from models.project import Project, ProjectMember
from models.project_note import ProjectNote
from models.user import User
from schemas.dashboard import (
    CalendarEventCreate,
    CalendarEventItem,
    CalendarEventUpdate,
    MyWorkResponse,
    ProjectOption,
    TodayActivityItem,
    TodayFollowUpItem,
    TodayImportantItem,
)

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


def _visible_project_ids(db: Session, user: User) -> list[int]:
    # 跟 deps._has_project_access 同一套規則:L0~L2 全站可見;L3~L5 只看得到自己
    # 建立、或被加入成員名單的案件;地主完全不算(工作看板本來就不給地主用)。
    if user.role == LANDOWNER_ROLE:
        return []
    if user.role in MANAGE_ROLES:
        return list(db.scalars(select(Project.id)))
    return list(
        db.scalars(
            select(Project.id)
            .outerjoin(ProjectMember, ProjectMember.project_id == Project.id)
            .where(or_(Project.created_by == user.id, ProjectMember.user_id == user.id))
            .distinct()
        )
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
    scope: str = Query(default="personal", pattern="^(personal|team)$"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    project_ids = _visible_project_ids(db, current_user)
    project_name_by_id = dict(
        db.execute(select(Project.id, Project.name).where(Project.id.in_(project_ids))).all()
    ) if project_ids else {}
    is_team = scope == "team"

    now = datetime.utcnow()
    day_start = datetime.combine(now.date(), time.min)
    day_end = day_start + timedelta(days=1)

    # --- 今日跟進地主 ---
    # personal:只看自己今天記錄的聯絡;team:看得到的所有案件、所有人今天記錄的聯絡
    # (見 _visible_project_ids —— 全站權限模型下這就是「所有案件」)。
    followup_query = (
        select(ContactLog.landowner_id, Landowner.name, Landowner.project_id, User.display_name)
        .join(Landowner, Landowner.id == ContactLog.landowner_id)
        .join(User, User.id == ContactLog.staff_id)
        .where(ContactLog.contact_date >= day_start, ContactLog.contact_date < day_end)
    )
    if is_team:
        # .in_([]) 就是永遠不成立,project_ids 空的時候(地主帳號)自然回傳 0 筆。
        followup_query = followup_query.where(Landowner.project_id.in_(project_ids))
    else:
        followup_query = followup_query.where(ContactLog.staff_id == current_user.id)
    followup_rows = db.execute(followup_query).all()
    seen: set[int] = set()
    today_followups: list[TodayFollowUpItem] = []
    for lid, lname, pid, staff_name in followup_rows:
        if lid in seen:
            continue
        seen.add(lid)
        today_followups.append(
            TodayFollowUpItem(
                project_id=pid,
                project_name=project_name_by_id.get(pid, ""),
                landowner_id=lid,
                landowner_name=lname,
                staff_name=staff_name if is_team else None,
            )
        )

    # --- 操作紀錄(不再限「今天」,跟案件頁「公告/進度通知」卡片一樣看得到過去的) ---
    # 系統自動記錄(activity_logs)+ 手動補充的公告(project_notes)合併成同一條時間軸。
    # team 模式只看跟案件有關的動作/公告(project_id 不為空),帳號設定這類非案件操作
    # 不算「團隊」的事;personal 維持原本(自己做的/自己寫的,不限案件)。
    activity_query = select(ActivityLog)
    if is_team:
        activity_query = activity_query.where(ActivityLog.project_id.in_(project_ids))
    else:
        activity_query = activity_query.where(ActivityLog.user_id == current_user.id)
    activity_rows = db.scalars(activity_query.order_by(ActivityLog.created_at.desc()).limit(200)).all()

    notes_query = select(ProjectNote)
    if is_team:
        notes_query = notes_query.where(ProjectNote.project_id.in_(project_ids))
    else:
        notes_query = notes_query.where(ProjectNote.author_id == current_user.id)
    note_rows = db.scalars(notes_query.order_by(ProjectNote.occurred_at.desc()).limit(200)).all()

    feed_user_ids = {a.user_id for a in activity_rows if a.user_id} | {n.author_id for n in note_rows if n.author_id}
    feed_user_names = dict(
        db.execute(select(User.id, User.display_name).where(User.id.in_(feed_user_ids))).all()
    ) if feed_user_ids else {}
    can_delete_notes = current_user.role in EDIT_ROLES

    feed_items = [
        TodayActivityItem(
            kind="auto",
            id=a.id,
            action=a.action,
            method=a.method,
            path=a.path,
            project_id=a.project_id,
            project_name=project_name_by_id.get(a.project_id) if a.project_id else None,
            created_at=a.created_at,
            user_name=feed_user_names.get(a.user_id) if is_team else None,
        )
        for a in activity_rows
    ] + [
        TodayActivityItem(
            kind="note",
            id=n.id,
            action=n.content,
            project_id=n.project_id,
            project_name=project_name_by_id.get(n.project_id),
            created_at=n.occurred_at,
            user_name=feed_user_names.get(n.author_id) if is_team else None,
            can_delete=can_delete_notes,
        )
        for n in note_rows
    ]
    feed_items.sort(key=lambda item: item.created_at, reverse=True)
    today_activities = feed_items[:200]

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
            is_important=e.is_important,
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


@router.get("/today-important", response_model=list[TodayImportantItem])
def get_today_important(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """全站頂端鈴鐺用 - 今天、標「重要」的待辦,個人的 + 看得到的案件共用的都算
    (跟工作看板行事曆同一份資料,同一套 _visible_project_ids 可見範圍)。"""
    project_ids = _visible_project_ids(db, current_user)
    today = datetime.utcnow().date()
    ev_filter = CalendarEvent.created_by == current_user.id
    if project_ids:
        ev_filter = ev_filter | CalendarEvent.project_id.in_(project_ids)
    events = db.scalars(
        select(CalendarEvent)
        .where(CalendarEvent.event_date == today, CalendarEvent.is_important.is_(True), ev_filter)
        .order_by(CalendarEvent.id)
    ).all()
    project_name_by_id = dict(
        db.execute(select(Project.id, Project.name).where(Project.id.in_(project_ids))).all()
    ) if project_ids else {}
    return [
        TodayImportantItem(
            id=e.id,
            content=e.content,
            project_id=e.project_id,
            project_name=project_name_by_id.get(e.project_id) if e.project_id else None,
        )
        for e in events
    ]


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
        is_important=payload.is_important,
        sop_stage=payload.sop_stage if payload.project_id is not None else None,
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
        is_important=ev.is_important,
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
    if payload.is_important is not None:
        ev.is_important = payload.is_important
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
        is_important=ev.is_important,
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
