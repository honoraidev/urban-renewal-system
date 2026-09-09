from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ProjectNoteCreate(BaseModel):
    content: str
    occurred_at: datetime | None = None  # 不填就用現在時間


class ProjectNoteRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    project_id: int
    author_id: int | None = None
    author_name: str | None = None
    occurred_at: datetime
    content: str
    created_at: datetime


class ActivityFeedItem(BaseModel):
    """公告面板裡「系統自動記錄」那一半 — 讀 activity_logs,不寫入。"""

    id: int
    action: str
    user_name: str | None = None
    created_at: datetime
