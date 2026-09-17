from datetime import date, datetime

from pydantic import BaseModel, Field


class ProjectCreate(BaseModel):
    project_code: str = Field(min_length=1, max_length=50)
    name: str = Field(min_length=1, max_length=255)
    address: str | None = None
    city: str | None = None
    district: str | None = None
    case_type: str | None = None
    description: str | None = None
    summary: str | None = None
    expected_completion_date: date | None = None


class ProjectUpdate(BaseModel):
    project_code: str | None = Field(default=None, min_length=1, max_length=50)
    name: str | None = None
    address: str | None = None
    city: str | None = None
    district: str | None = None
    case_type: str | None = None
    status: str | None = Field(default=None, pattern="^(active|closed|suspended)$")
    description: str | None = None
    summary: str | None = None
    expected_completion_date: date | None = None


class ProjectRead(BaseModel):
    id: int
    project_code: str
    name: str
    address: str | None = None
    city: str | None = None
    district: str | None = None
    case_type: str | None = None
    status: str
    current_stage: int
    is_force_closed: bool
    description: str | None = None
    summary: str | None = None
    has_cover_image: bool = False
    expected_completion_date: date | None = None
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
    expected_completion_date: date | None = None
    updated_at: datetime
    land_record_count: int
    building_record_count: int
    # None when the project has no OCR import job yet (e.g. all-manual data entry).
    latest_ocr_job_status: str | None = None
    # True when the most recent OCR job carries a non-fatal warning (e.g. a page whose
    # area_sqm extraction failed even after high-accuracy retry) - see OcrJob.error_message.
    latest_ocr_job_has_warning: bool = False
    current_stage: int
    headcount_ratio: float
    land_share_ratio: float
    building_share_ratio: float
    # 目前算「同意」的地主姓名清單(依最新一次聯絡結果=agreed 判定,見
    # utils/consent_ratio.py) - 總覽卡片同意度環的 hover 提示用。
    agreed_landowner_names: list[str] = []
    # Contact follow-up tiers by days overdue - see _alert_tier_counts in routers/projects.py.
    reminder_count: int
    warning_count: int
    urgent_count: int
    # First case_staff/case_owner and first manager/sys_admin assigned to this project
    # (by assigned_at) - display-only "who's on this case", not an access-control list.
    case_handler_name: str | None = None
    case_manager_name: str | None = None
    # 依「拜訪結果」算的同意/反對/其他統計(跟上面 headcount_ratio 等嚴格雙門檻定義
    # 是兩套獨立資料,見 utils/visit_consent.py) - 案件卡片三色圓餅圖用。
    visit_breakdown: dict | None = None
    # 7 天前最接近的一筆快照,沒有資料(還沒累積滿一週)就是 None,前端顯示「尚無
    # 上週資料」,不用假數字湊。
    last_week_breakdown: dict | None = None


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
    building_share_total_sqm: float
    building_share_agreed_sqm: float
    building_share_ratio: float
    dual_gate_passed: bool
