from datetime import date, datetime, time, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from database import get_db
from deps import MANAGE_ROLES, LANDOWNER_ROLE, get_current_user
from models.calendar_event import CalendarEvent, normalize_event_time
from models.contact_log import ContactLog
from models.landowner import Landowner
from models.project import Project, ProjectMember
from models.sop import SopStage
from models.user import User
from routers.project_overview import _stage_task_block, urgent_sop_bell_items
from routers.sop import _resolved_stages, pending_manager_review_bell_items, rejected_checklist_bell_items
from utils.todo_priority import DUE_URGENT_DAYS, todo_priority
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

    # --- 今日提醒公告(改成只看「今天」的行事曆備註,不再是活動紀錄+手動公告的
    # 合併時間軸)---
    # 原本這裡合併 activity_logs(系統自動記錄)+ project_notes(手動公告),不限
    # 日期、越滾越長。改成直接呈現今天的行事曆待辦(calendar_events),例如行事曆
    # 填了「9/22 須聯絡林屋主 14:00」,今天(9/22)這裡就顯示「聯絡林屋主 14:00」。
    # team 模式看所有看得到案件今天的提醒;personal 只看自己建立的(含個人專屬 +
    # 自己在案件上建的)。
    today_date = now.date()
    calendar_today_query = select(CalendarEvent).where(CalendarEvent.event_date == today_date)
    if is_team:
        calendar_today_query = calendar_today_query.where(CalendarEvent.project_id.in_(project_ids))
    else:
        calendar_today_query = calendar_today_query.where(CalendarEvent.created_by == current_user.id)
    today_events = [(e, normalize_event_time(e.event_time)) for e in db.scalars(calendar_today_query).all()]
    today_events.sort(key=lambda pair: (pair[1] is None, pair[1] or time.min, pair[0].id))

    feed_user_ids = {e.created_by for e, _ in today_events if e.created_by}
    feed_user_names = dict(
        db.execute(select(User.id, User.display_name).where(User.id.in_(feed_user_ids))).all()
    ) if feed_user_ids else {}

    today_activities = [
        TodayActivityItem(
            kind="calendar",
            id=e.id,
            action=e.content,
            event_time=et,
            is_important=e.is_important,
            project_id=e.project_id,
            project_name=project_name_by_id.get(e.project_id) if e.project_id else None,
            created_at=datetime.combine(e.event_date, et or time.min),
            user_name=feed_user_names.get(e.created_by),
        )
        for e, et in today_events
    ]

    # --- 各案件「這階段」待辦事項(SOP 檢核清單還沒完成的項目)---
    # 一個案件彙整成一則「第N階段『XX』還有 K 項未完成」,不像案件總覽頁待辦事項
    # 卡片那樣逐筆列出 —— 工作看板是跨案件總覽,展開到每個案件每一筆待辦會太長。
    # 跟 urgent_sop_bell_items(全站鈴鐺用)是同一套邏輯,但不做「延遲/快到期」篩選,
    # 這裡要看的是「現在進度到哪」而不是「快出事了」。
    # personal:只看自己是建立人/成員的案件;team:看得到的所有案件(跟上面
    # project_ids、今日提醒公告同一套範圍)。
    if is_team:
        sop_project_ids = project_ids
    elif project_ids:
        sop_project_ids = list(
            db.scalars(
                select(Project.id)
                .outerjoin(ProjectMember, ProjectMember.project_id == Project.id)
                .where(
                    Project.id.in_(project_ids),
                    or_(Project.created_by == current_user.id, ProjectMember.user_id == current_user.id),
                )
                .distinct()
            )
        )
    else:
        sop_project_ids = []
    if sop_project_ids:
        for p in db.scalars(select(Project).where(Project.id.in_(sop_project_ids))):
            sop = db.scalar(select(SopStage).where(SopStage.project_id == p.id))
            if sop is None or sop.stage_data["final"]["status"] != "pending":
                continue
            stages = _resolved_stages(sop)
            block = _stage_task_block(db, p.id, stages, sop.current_stage, True, p)
            if not block:
                continue
            pending = [t for t in block["tasks"] if not t["done"]]
            if not pending:
                continue
            today_activities.append(
                TodayActivityItem(
                    kind="sop",
                    id=-p.id,  # 負數 = 不是行事曆備註(SOP 彙整項),避免跟 calendar_events.id 撞
                    action=f"第{block['index']}階段「{block['name']}」還有 {len(pending)} 項未完成",
                    project_id=p.id,
                    project_name=p.name,
                    created_at=now,
                )
            )

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
            event_time=normalize_event_time(e.event_time),
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
    """全站頂端鈴鐺用(個人的 + 看得到的案件共用的都算,跟工作看板行事曆同一份資料,
    同一套 _visible_project_ids 可見範圍)。會出現的有五種:
      1. 自動判斷「緊急且重要」的待辦(逾期 30 天內 ~ 2 天內到期;規則見 utils/todo_priority.py)
      2. 案件已延遲/快到期、這階段還有未完成 SOP 項目的案件(彙整成一則)
      3. 今天、手動標「重要」的待辦(即使還沒到緊急)
      4. 「主管審核通過」被駁回、還沒回應的案件(案件相關人員都看得到,不限管理層)
      5. 「主管審核通過」對應文件已上傳、待審核的案件(只有管理層看得到)"""
    project_ids = _visible_project_ids(db, current_user)
    today = datetime.utcnow().date()
    ev_filter = CalendarEvent.created_by == current_user.id
    if project_ids:
        ev_filter = ev_filter | CalendarEvent.project_id.in_(project_ids)
    events = db.scalars(
        select(CalendarEvent)
        .where(
            CalendarEvent.event_date >= today - timedelta(days=30),
            CalendarEvent.event_date <= today + timedelta(days=DUE_URGENT_DAYS),
            ev_filter,
        )
        .order_by(CalendarEvent.event_date, CalendarEvent.id)
    ).all()
    projects = list(db.scalars(select(Project).where(Project.id.in_(project_ids)))) if project_ids else []
    project_name_by_id = {p.id: p.name for p in projects}

    def _todo_item(e: CalendarEvent, reason: str) -> TodayImportantItem:
        return TodayImportantItem(
            id=e.id,
            content=e.content,
            project_id=e.project_id,
            project_name=project_name_by_id.get(e.project_id) if e.project_id else None,
            reason=reason,
        )

    items: list[TodayImportantItem] = []
    seen: set[int] = set()
    for e in events:
        urgent, important = todo_priority(e.event_date, e.content, e.is_important, today)
        # 鈴鐺是「推播」,todo_priority 的「緊急」定義(含未來2天內到期)是給列表排序/
        # 上色用的,提早推播會讓使用者在事發前2天就被打擾。鈴鐺這裡只認「已逾期」或
        # 「今天到期」(event_date <= today),真的還沒到期的不推。
        if urgent and important and e.event_date <= today:
            items.append(_todo_item(e, "、".join(urgent)))
            seen.add(e.id)
    items += [TodayImportantItem(**it) for it in urgent_sop_bell_items(db, projects)]
    items += [TodayImportantItem(**it) for it in rejected_checklist_bell_items(db, projects)]
    if current_user.role in MANAGE_ROLES:
        items += [TodayImportantItem(**it) for it in pending_manager_review_bell_items(db, projects)]
    for e in events:
        if e.event_date == today and e.is_important and e.id not in seen:
            items.append(_todo_item(e, "今天標為重要"))
    return items


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
        event_time=payload.event_time,
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
        event_time=normalize_event_time(ev.event_time),
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
    if payload.clear_event_time:
        ev.event_time = None
    elif payload.event_time is not None:
        ev.event_time = payload.event_time
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
        event_time=normalize_event_time(ev.event_time),
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
