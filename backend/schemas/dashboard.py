from datetime import date, datetime, time

from pydantic import BaseModel, Field


class TodayFollowUpItem(BaseModel):
    project_id: int
    project_name: str
    landowner_id: int
    landowner_name: str
    staff_name: str | None = None  # 只在 scope=team 時填,personal 不需要顯示是誰做的


class TodayActivityItem(BaseModel):
    # kind 固定 "calendar" —— 「公告/進度通知」卡片改成只顯示今天的行事曆待辦
    # (calendar_events),不再是 activity_logs/project_notes 的合併時間軸。
    kind: str = "calendar"
    id: int
    action: str
    event_time: time | None = None
    is_important: bool = False
    method: str | None = None
    path: str | None = None
    project_id: int | None = None
    project_name: str | None = None
    created_at: datetime
    user_name: str | None = None
    can_delete: bool = False


class CalendarEventItem(BaseModel):
    id: int
    event_date: date
    event_time: time | None = None
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
    event_time: time | None = None
    content: str = Field(min_length=1, max_length=2000)
    project_id: int | None = None
    is_important: bool = False
    sop_stage: int | None = Field(default=None, ge=0, le=99)


class CalendarEventUpdate(BaseModel):
    content: str | None = Field(default=None, min_length=1, max_length=2000)
    event_date: date | None = None
    is_important: bool | None = None
    event_time: time | None = None
    # event_time 要能「清空」(選填欄位,使用者填了又想清掉),用 exclude_unset 分辨
    # 「沒傳這個欄位」跟「傳了 null 要清空」——沒傳就不動,傳了 null 就真的清成 NULL。
    clear_event_time: bool = False


class TodayImportantItem(BaseModel):
    id: int
    content: str
    project_id: int | None = None
    project_name: str | None = None
    # todo = 行事曆備註;sop = 案件這階段未完成項目的彙整(id 為負數,見 project_overview.urgent_sop_bell_items)
    kind: str = "todo"
    # 為什麼會出現在鈴鐺(自動判斷的緊急原因,或「今天標了重要」)
    reason: str | None = None
    # kind 開頭是 sop 時,點鈴鐺項目要跳到的關卡編號(可能不是案件目前所在的關卡 -
    # 例如駁回意見卡在已強制完成的舊關卡裡),前端據此開對應案件的 SOP 分頁並選好關卡。
    stage: int | None = None
