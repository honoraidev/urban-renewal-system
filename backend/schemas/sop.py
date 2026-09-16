from datetime import datetime
from typing import Any

from pydantic import BaseModel


class SopStatusResponse(BaseModel):
    project_id: int
    current_stage: int
    stages: dict[str, Any]
    final: dict[str, Any]
    updated_at: datetime


class SopStageDef(BaseModel):
    # key=None 代表使用者自訂的關卡(沒有自動門檻,人工完成);key 給內建代碼(如
    # "consent_dual_1")的話會沿用該內建關卡原本的自動門檻邏輯與門檻參數。
    key: str | None = None
    name: str


class SopStageFlowRequest(BaseModel):
    stages: list[SopStageDef]


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


class StageFormRequest(BaseModel):
    # doc_type names which 範本 checklist item this online form belongs to
    # (e.g. "consent_form_template"); form_data is the free-form field bag the
    # frontend collected (案件名稱 / 實施單位 / 文件狀態 …). Passing form_data=None
    # clears a previously submitted form.
    doc_type: str
    form_data: dict[str, Any] | None = None


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
