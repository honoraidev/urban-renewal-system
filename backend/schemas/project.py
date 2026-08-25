from datetime import datetime

from pydantic import BaseModel, Field


class ProjectCreate(BaseModel):
    project_code: str = Field(min_length=1, max_length=50)
    name: str = Field(min_length=1, max_length=255)
    address: str | None = None
    city: str | None = None
    district: str | None = None
    description: str | None = None


class ProjectUpdate(BaseModel):
    name: str | None = None
    address: str | None = None
    city: str | None = None
    district: str | None = None
    status: str | None = Field(default=None, pattern="^(active|closed|suspended)$")
    description: str | None = None


class ProjectRead(BaseModel):
    id: int
    project_code: str
    name: str
    address: str | None = None
    city: str | None = None
    district: str | None = None
    status: str
    current_stage: int
    is_force_closed: bool
    description: str | None = None
    created_by: int | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class BatchDeleteRequest(BaseModel):
    project_ids: list[int] = Field(min_length=1)
    admin_username: str
    admin_password: str


class BatchDeleteResult(BaseModel):
    deleted_ids: list[int]
    not_found_ids: list[int]


class ProjectMemberCreate(BaseModel):
    user_id: int


class ProjectMemberRead(BaseModel):
    id: int
    user_id: int
    username: str
    display_name: str
    role_in_project: str
    assigned_at: datetime

    model_config = {"from_attributes": True}


class DashboardProjectItem(BaseModel):
    id: int
    name: str
    project_code: str
    city: str | None = None
    district: str | None = None
    status: str
    land_record_count: int
    building_record_count: int
    # None when the project has no OCR import job yet (e.g. all-manual data entry).
    latest_ocr_job_status: str | None = None
    # True when the most recent OCR job carries a non-fatal warning (e.g. a page whose
    # area_sqm extraction failed even after high-accuracy retry) - see OcrJob.error_message.
    latest_ocr_job_has_warning: bool = False


class DashboardSummary(BaseModel):
    project_count: int
    land_record_count: int
    building_record_count: int
    # Real signal only: OCR jobs that are status="failed", or status="completed" with a
    # non-fatal warning still attached - both genuinely need a human to look at them.
    # Not a fabricated "AI confidence" metric.
    pending_ai_review_count: int
    ai_online: bool
    projects: list[DashboardProjectItem]


class ConsentRatio(BaseModel):
    stage: int
    headcount_total: int
    headcount_agreed: int
    headcount_ratio: float
    land_share_total_sqm: float
    land_share_agreed_sqm: float
    land_share_ratio: float
    dual_gate_passed: bool
