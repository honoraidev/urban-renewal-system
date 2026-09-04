from datetime import datetime

from pydantic import BaseModel


class MyWorkProjectItem(BaseModel):
    id: int
    name: str
    project_code: str
    city: str | None = None
    district: str | None = None
    status: str
    current_stage: int
    headcount_ratio: float
    land_share_ratio: float
    building_share_ratio: float
    reminder_count: int
    warning_count: int
    urgent_count: int


class MyWorkFollowUpItem(BaseModel):
    project_id: int
    project_name: str
    landowner_id: int
    landowner_name: str
    phone: str | None = None
    contact_status: str
    last_contact_date: datetime | None = None
    days_since_last_contact: int | None = None


class MyWorkRecentContactItem(BaseModel):
    project_id: int
    project_name: str
    landowner_id: int
    landowner_name: str
    contact_date: datetime
    contact_method: str
    contact_result: str
    notes: str | None = None


class MyWorkStats(BaseModel):
    project_count: int
    follow_up_count: int
    reminder_count: int
    warning_count: int
    urgent_count: int
    pending_ai_review_count: int


class MyWorkResponse(BaseModel):
    stats: MyWorkStats
    projects: list[MyWorkProjectItem]
    follow_ups: list[MyWorkFollowUpItem]
    recent_contacts: list[MyWorkRecentContactItem]
