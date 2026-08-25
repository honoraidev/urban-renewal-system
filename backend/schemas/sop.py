from datetime import datetime
from typing import Any

from pydantic import BaseModel


class SopStatusResponse(BaseModel):
    project_id: int
    current_stage: int
    stages: dict[str, Any]
    final: dict[str, Any]
    updated_at: datetime


class SopCompleteRequest(BaseModel):
    force: bool = False
    reason: str | None = None


class ChecklistConfirmRequest(BaseModel):
    # Free-form key naming a checklist item within one SOP stage (e.g.
    # "landowner_roster_confirmed") - not an enum, since which items exist per stage is
    # defined entirely on the frontend (see SOP_STAGE_1_CHECKLIST and friends); the
    # backend just durably stores whichever key/timestamp/user a staff member confirmed.
    key: str
    confirmed: bool = True


class ConsentUpsertRequest(BaseModel):
    landowner_id: int
    consent_status: str
    notes: str | None = None


class ConsentRecordRead(BaseModel):
    id: int
    landowner_id: int
    sop_stage: int
    consent_status: str
    recorded_at: datetime
    recorded_by: int | None = None
    notes: str | None = None

    model_config = {"from_attributes": True}
