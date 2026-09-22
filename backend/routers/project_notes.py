from datetime import date, datetime, time, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from database import get_db
from deps import MANAGE_ROLES, get_current_user, require_project_editor, require_project_staff_viewer
from models.activity_log import ActivityLog
from models.calendar_event import CalendarEvent
from models.project import Project
from models.project_note import ProjectNote
from models.user import User
from schemas.dashboard import CalendarEventItem
from schemas.project_note import ActivityFeedItem, ProjectNoteCreate, ProjectNoteRead

router = APIRouter(prefix="/projects/{project_id}/notes", tags=["project-notes"])
feed_router = APIRouter(prefix="/projects/{project_id}/activity-feed", tags=["project-notes"])
calendar_today_router = APIRouter(prefix="/projects/{project_id}/calendar-today", tags=["project-notes"])


def _with_author_names(db: Session, notes: list[ProjectNote]) -> list[ProjectNoteRead]:
    author_ids = {n.author_id for n in notes if n.author_id}
    names = (
        {u.id: u.display_name for u in db.scalars(select(User).where(User.id.in_(author_ids)))}
        if author_ids
        else {}
    )
    out = []
    for n in notes:
        r = ProjectNoteRead.model_validate(n)
        r.author_name = names.get(n.author_id)
        out.append(r)
    return out


@router.get("", response_model=list[ProjectNoteRead])
def list_notes(
    db: Session = Depends(get_db),
    project: Project = Depends(require_project_staff_viewer),
):
    """公告面板裡「手動補充」那一半 — 使用者自己填的跟進事項,自訂時間。"""
    notes = db.scalars(
        select(ProjectNote).where(ProjectNote.project_id == project.id).order_by(ProjectNote.occurred_at.desc())
    ).all()
    return _with_author_names(db, notes)


@router.post("", response_model=ProjectNoteRead, status_code=status.HTTP_201_CREATED)
def create_note(
    payload: ProjectNoteCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    project: Project = Depends(require_project_editor),
):
    note = ProjectNote(
        project_id=project.id,
        author_id=current_user.id,
        occurred_at=payload.occurred_at or datetime.now(timezone.utc),
        content=payload.content.strip(),
    )
    if not note.content:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="請輸入內容")
    db.add(note)
    db.commit()
    db.refresh(note)
    result = ProjectNoteRead.model_validate(note)
    result.author_name = current_user.display_name
    return result


@router.delete("/{note_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_note(
    note_id: int,
    db: Session = Depends(get_db),
    project: Project = Depends(require_project_editor),
):
    note = db.scalar(
        select(ProjectNote).where(ProjectNote.id == note_id, ProjectNote.project_id == project.id)
    )
    if note is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Note not found")
    db.delete(note)
    db.commit()
    return  # 204


@feed_router.get("", response_model=list[ActivityFeedItem])
def list_activity_feed(
    db: Session = Depends(get_db),
    project: Project = Depends(require_project_staff_viewer),
):
    """公告面板裡「系統自動記錄」那一半 —— activity_logs 裡凡是動到這個案件的地主/
    屋主資料、文件、費用、他項權利、土地建物標示等異動,通通在這裡顯示,最新 200 筆。
    action 欄位在寫入當下(見 main.py 的 ActivityLogMiddleware)就已經把地主姓名併進
    標籤(例如「修改地主資料 — 陳大文」),這裡只需要再補上操作者姓名。"""
    logs = db.scalars(
        select(ActivityLog)
        .where(ActivityLog.project_id == project.id)
        .order_by(ActivityLog.created_at.desc())
        .limit(200)
    ).all()
    user_ids = {l.user_id for l in logs if l.user_id}
    names = (
        {u.id: u.display_name for u in db.scalars(select(User).where(User.id.in_(user_ids)))}
        if user_ids
        else {}
    )
    return [
        ActivityFeedItem(
            id=l.id,
            action=l.action,
            user_name=names.get(l.user_id),
            created_at=l.created_at,
        )
        for l in logs
    ]


@calendar_today_router.get("", response_model=list[CalendarEventItem])
def list_calendar_today(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    project: Project = Depends(require_project_staff_viewer),
):
    """案件頁「公告/進度通知」卡片用 —— 不再合併活動紀錄/手動公告的時間軸,改成只顯示
    今天、屬於這個案件的行事曆提醒(跟工作看板行事曆同一份 calendar_events 資料,
    project_id 篩成這個案件、event_date 篩成今天)。有填時間的排前面依時間排序,
    沒填時間的排最後。"""
    today = date.today()
    events = list(
        db.scalars(
            select(CalendarEvent).where(
                CalendarEvent.project_id == project.id, CalendarEvent.event_date == today
            )
        ).all()
    )
    events.sort(key=lambda e: (e.event_time is None, e.event_time or time.min, e.id))
    creator_ids = {e.created_by for e in events if e.created_by}
    names = (
        {u.id: u.display_name for u in db.scalars(select(User).where(User.id.in_(creator_ids)))}
        if creator_ids
        else {}
    )
    is_manager = current_user.role in MANAGE_ROLES
    return [
        CalendarEventItem(
            id=e.id,
            event_date=e.event_date,
            event_time=e.event_time,
            content=e.content,
            is_important=e.is_important,
            project_id=e.project_id,
            project_name=project.name,
            created_by=e.created_by,
            created_by_name=names.get(e.created_by),
            can_edit=is_manager or e.created_by == current_user.id,
        )
        for e in events
    ]
