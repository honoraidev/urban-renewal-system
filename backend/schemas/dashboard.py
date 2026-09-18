from datetime import date, datetime

from pydantic import BaseModel, Field


class TodayFollowUpItem(BaseModel):
    project_id: int
    project_name: str
    landowner_id: int
    landowner_name: str
    staff_name: str | None = None  # 只在 scope=team 時填,personal 不需要顯示是誰做的


class TodayActivityItem(BaseModel):
    # "auto" = activity_logs 系統自動記錄;"note" = project_notes 手動補充的公告/跟進
    # 事項 —— 跟案件頁「公告/進度通知」卡片同一套資料,合併在同一份時間軸裡。
    kind: str = "auto"
    id: int
    action: str
    method: str | None = None
    path: str | None = None
    project_id: int | None = None
    project_name: str | None = None
    created_at: datetime
    user_name: str | None = None  # 只在 scope=team 時填,personal 不需要顯示是誰做的
    can_delete: bool = False  # 只有 kind="note" 且使用者對該案件有編輯權時才 true


class CalendarEventItem(BaseModel):
    id: int
    event_date: date
    content: str
    is_important: bool = False
    project_id: int | None = None
    project_name: str | None = None
    created_by: int | None = None
    created_by_name: str | None = None
    can_edit: bool


class ProjectOption(BaseModel):
    id: int
    name: str


class MyWorkResponse(BaseModel):
    today: date
    today_followup_count: int
    today_followups: list[TodayFollowUpItem]
    today_activities: list[TodayActivityItem]
    calendar_month: str
    calendar_events: list[CalendarEventItem]
    project_options: list[ProjectOption]


class CalendarEventCreate(BaseModel):
    event_date: date
    content: str = Field(min_length=1, max_length=2000)
    project_id: int | None = None
    is_important: bool = False


class CalendarEventUpdate(BaseModel):
    content: str | None = Field(default=None, min_length=1, max_length=2000)
    event_date: date | None = None
    is_important: bool | None = None


class TodayImportantItem(BaseModel):
    id: int
    content: str
    project_id: int | None = None
    project_name: str | None = None
