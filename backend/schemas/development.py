from datetime import datetime
from typing import Any

from pydantic import BaseModel


class DevelopmentStatusResponse(BaseModel):
    project_id: int
    current_stage: int
    stages: dict[str, Any]
    history: list[dict[str, Any]] = []
    updated_at: datetime


class DevelopmentStageDef(BaseModel):
    name: str


class DevelopmentStageFlowRequest(BaseModel):
    stages: list[DevelopmentStageDef]


class DevelopmentCompleteRequest(BaseModel):
    reason: str | None = None


class DevelopmentStageMetaUpdate(BaseModel):
    # 都留 None = 不更新那個欄位,PATCH 語意,只更新有帶的。
    department: str | None = None
    description: str | None = None
    required_docs: str | None = None
    due_date: str | None = None
    progress_pct: int | None = None


class DevelopmentHistoryEntryCreate(BaseModel):
    event_date: str
    title: str
    note: str | None = None
