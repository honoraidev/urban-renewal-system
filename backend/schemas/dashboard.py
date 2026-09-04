from datetime import date, datetime

from pydantic import BaseModel, Field


class TodayFollowUpItem(BaseModel):
    project_id: int
    project_name: str
    landowner_id: int
    landowner_name: str


class TodayActivityItem(BaseModel):
    id: int
    action: str
    method: str
    path: str
    project_id: int | None = None
    project_name: str | None = None
    created_at: datetime


class CalendarEventItem(BaseModel):
    id: int
    event_date: date
    content: str
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


class CalendarEventUpdate(BaseModel):
    content: str | None = Field(default=None, min_length=1, max_length=2000)
    event_date: date | None = None
