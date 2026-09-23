from datetime import datetime
from typing import Any

from pydantic import BaseModel


class SopStatusResponse(BaseModel):
    project_id: int
    current_stage: int
    stages: dict[str, Any]
    final: dict[str, Any]
    updated_at: datetime


class StageRequirements(BaseModel):
    """任何一關(不管是內建關卡還是自訂關卡)都能自己勾選/設定要求,取代原本綁死在
    key 上的固定邏輯 - 有給這個欄位,gate 檢查就完全以這裡為準,不再看 key。"""
    document_required: bool = False
    document_type: str | None = None  # models.document.Document.doc_type 的既有分類值
    ratio_required: bool = False  # 同意度雙門檻(人數 + 面積同時達標)
    ratio_threshold: float = 0.8
    contact_rate_required: bool = False
    contact_rate_threshold: float = 0.95
    manual_required: bool = False
    manual_label: str | None = None


class SopStageDef(BaseModel):
    # key=None 代表使用者自訂的關卡;key 給內建代碼(如 "consent_dual_1")的話,沒有
    # 額外指定 requirements 時會沿用該內建關卡原本的自動門檻邏輯與門檻參數。
    # requirements 有指定的話(不管 key 是不是內建),一律以 requirements 為準。
    key: str | None = None
    name: str
    requirements: StageRequirements | None = None


class SopStageFlowRequest(BaseModel):
    stages: list[SopStageDef]


class SopStageMetaUpdate(BaseModel):
    # 都留 None = 不更新那個欄位(PATCH 語意,只更新有帶的)。due_date 是 ISO 日期字串
    # (YYYY-MM-DD);要清空某欄位傳空字串/空陣列,不要整個不帶。
    due_date: str | None = None
    notes: str | None = None
    assignee_id: int | None = None
    departments: list[str] | None = None


class SopCompleteRequest(BaseModel):
    force: bool = False
    reason: str | None = None


class ChecklistRejectRequest(BaseModel):
    # 只用於「主管審核通過」這類 managerOnly 項目(見 backend/routers/sop.py
    # MANAGER_ONLY_CHECKLIST_KEYS) - 駁回時要留原因,案件負責人才知道要改什麼。
    key: str
    reason: str


class ChecklistConfirmRequest(BaseModel):
    # Free-form key naming a checklist item within one SOP stage (e.g.
    # "landowner_roster_confirmed") - not an enum, since which items exist per stage is
    # defined entirely on the frontend (see SOP_STAGE_1_CHECKLIST and friends); the
    # backend just durably stores whichever key/timestamp/user a staff member confirmed.
    key: str
    confirmed: bool = True


class StageTodoCreate(BaseModel):
    # 使用者在關卡自己手動加的待辦事項(跟系統認得的上傳/匯入/門檻需求是分開的兩件事)—
    # 存在 stage.data.custom_todos,不會計進「完成本階段」的門檻判斷,純粹給團隊自己
    # 記事、打勾用。
    content: str


class StageTodoUpdate(BaseModel):
    # 都留 None = 不更新那個欄位。只給 done 就是打勾/取消勾,只給 content 就是改文字。
    done: bool | None = None
    content: str | None = None


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
