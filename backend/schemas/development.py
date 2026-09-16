from datetime import datetime
from typing import Any

from pydantic import BaseModel


class DevelopmentStatusResponse(BaseModel):
    project_id: int
    current_stage: int
    stages: dict[str, Any]
    updated_at: datetime


class DevelopmentStageDef(BaseModel):
    name: str


class DevelopmentStageFlowRequest(BaseModel):
    stages: list[DevelopmentStageDef]


class DevelopmentCompleteRequest(BaseModel):
    reason: str | None = None
