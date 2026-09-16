from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from database import get_db
from deps import (
    MANAGE_ROLES,
    get_current_user,
    require_project_editor,
    require_project_manager,
    require_project_staff_viewer,
    require_project_viewer,
)
from models.building_record import BuildingRecord
from models.consent_record import ConsentRecord
from models.document import Document
from models.land_record import LandRecord
from models.landowner import Landowner
from models.project import Project
from models.sop import SopStage
from models.user import User
from routers.projects import get_project_or_404
from schemas.sop import (
    ChecklistConfirmRequest,
    ConsentRecordRead,
    ConsentUpsertRequest,
    SopCompleteRequest,
    SopStageFlowRequest,
    SopStatusResponse,
    StageFormRequest,
)
from utils.consent_ratio import calculate_consent_ratio

router = APIRouter(prefix="/projects/{project_id}/sop", tags=["sop"])

# 每個「內建」關卡都有一個穩定不變的 key,自動門檻(_assert_gate_passed)靠 key 找,不
# 再靠陣列位置(position)找 - 這樣客製化流程時關卡可以自由重新排序/改名,門檻邏輯
# 還是能認得出「這是原本第幾關」。key 是 None 的關卡代表使用者自己新增的自訂關卡,
# 沒有自動門檻,只能人工按「完成本關卡」過關。
STAGE_DEFINITIONS: list[dict] = [
    {"key": "initial_approval", "name": "初始核定立案", "extra": {}},
    {"key": "ocr_roster", "name": "籌備階段", "extra": {}},
    {"key": "contact_rate", "name": "意願調查", "extra": {"contact_rate_threshold": 0.95}},
    {"key": "briefing_1", "name": "都更說明會", "extra": {}},
    {"key": "consent_dual_1", "name": "同意書簽署(第一輪)", "extra": {"headcount_threshold": 0.8, "land_share_threshold": 0.8}},
    {"key": "consultant_review", "name": "都更規劃與估價", "extra": {}},
    {"key": "briefing_2", "name": "事業計畫說明會", "extra": {}},
    {"key": "briefing_3", "name": "權利變換說明會", "extra": {}},
    {"key": "consent_dual_2", "name": "同意書補強(第二輪)", "extra": {"headcount_threshold": 0.8, "land_share_threshold": 0.8}},
    {"key": "consent_final", "name": "送件審查", "extra": {"headcount_threshold": 0.8, "land_share_threshold": 0.8}},
]
STAGE_DEF_BY_KEY: dict[str, dict] = {d["key"]: d for d in STAGE_DEFINITIONS}
DEFAULT_KEY_BY_INDEX: dict[int, str] = {i: d["key"] for i, d in enumerate(STAGE_DEFINITIONS)}

DUAL_GATE_KEYS = {"consent_dual_1", "consent_dual_2", "consent_final"}
CONTACT_RATE_KEYS = {"contact_rate"}
CONTACT_RATE_THRESHOLD = 0.95

# Real, checkable completion requirements for stages that aren't already covered by
# _assert_gate_passed's ratio checks - mirrors the frontend's SOP_STAGE_CHECKLISTS
# (same doc_type/manual-key names) so "完成本關卡" actually enforces what the checklist
# UI shows, instead of any editor being able to click past unfinished items.
# `checklist_keys` entries must have been confirmed via POST /{stage}/checklist first.
STAGE_CHECKLIST_REQUIREMENTS: dict[str, dict] = {
    "initial_approval": {"doc_types": ["roi_report"]},
    "ocr_roster": {"doc_types": ["cadastral_map"], "checklist_keys": ["landowner_roster_confirmed"], "needs_land": True, "needs_building": True},
    "briefing_1": {"doc_types": ["briefing_material"], "checklist_keys": ["briefing_reviewed_3"]},
    "consultant_review": {"doc_types": ["consultant_document"], "checklist_keys": ["consultant_reviewed"]},
    "briefing_2": {"doc_types": ["briefing_material", "consent_form_template", "contract_template"], "checklist_keys": ["briefing_reviewed_6"]},
    "briefing_3": {"doc_types": ["briefing_material"], "checklist_keys": ["briefing_reviewed_7"]},
}


def build_initial_stage_data(custom_flow: list[dict] | None = None) -> dict:
    """custom_flow(若有給)是 [{key, name, extra}, ...] 的有序清單,來自 PUT .../sop/stages
    自訂關卡流程;不給的話用系統預設的 10 關(STAGE_DEFINITIONS)。"""
    defs = custom_flow if custom_flow is not None else STAGE_DEFINITIONS
    return {
        "stages": {
            str(i): {
                "key": d["key"],
                "name": d["name"],
                "status": "pending",
                "data": dict(d.get("extra") or {}),
            }
            for i, d in enumerate(defs)
        },
        "final": {"status": "pending", "force_closed": False, "closed_at": None, "closed_by": None},
    }


def _final_stage_index(sop: SopStage) -> int:
    return len(sop.stage_data.get("stages") or {}) - 1


def _stage_key(sop: SopStage, stage_index: int) -> str | None:
    entry = (sop.stage_data.get("stages") or {}).get(str(stage_index)) or {}
    return entry.get("key", DEFAULT_KEY_BY_INDEX.get(stage_index))


def _find_stage_index_by_key(sop: SopStage, key: str) -> str | None:
    """客製化流程後,内建關卡不一定還在原本的位置(甚至可能被刪掉了) - 要找「地主
    清冊確認」這種跟特定內建關卡綁定的邏輯,得先用 key 找出它現在在第幾關。"""
    stages = sop.stage_data.get("stages") or {}
    for idx_str, entry in stages.items():
        entry_key = entry.get("key", DEFAULT_KEY_BY_INDEX.get(int(idx_str)))
        if entry_key == key:
            return idx_str
    return None


def get_or_create_sop(db: Session, project_id: int) -> SopStage:
    sop = db.scalar(select(SopStage).where(SopStage.project_id == project_id))
    if sop is None:
        sop = SopStage(project_id=project_id, stage_data=build_initial_stage_data(), current_stage=0)
        db.add(sop)
        db.commit()
        db.refresh(sop)
    return sop


def _roster_counts(db: Session, project_id: int) -> dict[str, int]:
    return {
        "land_count": db.scalar(
            select(func.count(LandRecord.id)).where(LandRecord.project_id == project_id)
        )
        or 0,
        "building_count": db.scalar(
            select(func.count(BuildingRecord.id)).where(BuildingRecord.project_id == project_id)
        )
        or 0,
    }


def _sync_roster_confirmation(db: Session, project_id: int, sop: SopStage) -> bool:
    """第1關「確認地主清冊正確」是對「當下的土地/建物登記」做的確認。之後若又匯入 /
    編輯 / 刪除土地或建物登記,筆數會變,原本的確認就過期了 - 這裡自動撤銷,讓
    「產生地主清冊 Excel」按鈕跟著隱藏,必須重新確認。回傳是否有撤銷。"""
    idx = _find_stage_index_by_key(sop, "ocr_roster")
    if idx is None:
        return False
    stages = (sop.stage_data or {}).get("stages") or {}
    entry = stages.get(idx) or {}
    checklist = (entry.get("data") or {}).get("checklist") or {}
    confirmed = checklist.get("landowner_roster_confirmed")
    if not confirmed:
        return False
    now = _roster_counts(db, project_id)
    if (
        confirmed.get("land_count") == now["land_count"]
        and confirmed.get("building_count") == now["building_count"]
    ):
        return False

    stage_data = dict(sop.stage_data)
    all_stages = dict(stage_data["stages"])
    stage_entry = dict(all_stages[idx])
    entry_data = dict(stage_entry.get("data") or {})
    new_checklist = dict(entry_data.get("checklist") or {})
    new_checklist.pop("landowner_roster_confirmed", None)
    entry_data["checklist"] = new_checklist
    stage_entry["data"] = entry_data
    all_stages[idx] = stage_entry
    stage_data["stages"] = all_stages
    sop.stage_data = stage_data
    db.commit()
    db.refresh(sop)
    return True


def _resolved_stages(sop: SopStage) -> dict:
    """回傳 stages,每一關保證帶有解析後的 key(舊資料沒存 key 的話,用陣列位置回推
    是原本第幾個內建關卡)- 前端靠 key 而不是位置去對 checklist/雙門檻設定。"""
    stages = sop.stage_data.get("stages") or {}
    out = {}
    for idx_str, entry in stages.items():
        e = dict(entry)
        if "key" not in e:
            e["key"] = DEFAULT_KEY_BY_INDEX.get(int(idx_str))
        out[idx_str] = e
    return out


def _status_response(project_id: int, sop: SopStage) -> SopStatusResponse:
    return SopStatusResponse(
        project_id=project_id,
        current_stage=sop.current_stage,
        stages=_resolved_stages(sop),
        final=sop.stage_data["final"],
        updated_at=sop.updated_at,
    )


def _assert_checklist_passed(db: Session, project_id: int, stage: int, sop: SopStage) -> None:
    key = _stage_key(sop, stage)
    requirements = STAGE_CHECKLIST_REQUIREMENTS.get(key)
    if not requirements:
        return

    for doc_type in requirements.get("doc_types", []):
        exists = db.scalar(
            select(Document.id).where(Document.project_id == project_id, Document.doc_type == doc_type)
        )
        if not exists:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Stage {stage} requires a '{doc_type}' document to be uploaded first",
            )

    if requirements.get("needs_land"):
        exists = db.scalar(select(LandRecord.id).where(LandRecord.project_id == project_id))
        if not exists:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail=f"Stage {stage} requires at least one land record"
            )

    if requirements.get("needs_building"):
        exists = db.scalar(select(BuildingRecord.id).where(BuildingRecord.project_id == project_id))
        if not exists:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST, detail=f"Stage {stage} requires at least one building record"
            )

    stage_entry = sop.stage_data["stages"].get(str(stage)) or {}
    checklist = (stage_entry.get("data") or {}).get("checklist") or {}
    for key in requirements.get("checklist_keys", []):
        if key not in checklist:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Stage {stage} requires checklist item '{key}' to be confirmed first",
            )


def _assert_gate_passed(db: Session, project_id: int, stage: int, sop: SopStage) -> None:
    _assert_checklist_passed(db, project_id, stage, sop)
    key = _stage_key(sop, stage)
    if key == "ocr_roster":
        total = db.scalar(select(func.count(Landowner.id)).where(Landowner.project_id == project_id)) or 0
        if total < 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Stage 1 requires at least one landowner record",
            )
    elif key in CONTACT_RATE_KEYS:
        total = db.scalar(select(func.count(Landowner.id)).where(Landowner.project_id == project_id)) or 0
        reached = db.scalar(
            select(func.count(Landowner.id)).where(
                Landowner.project_id == project_id, Landowner.contact_status != "not_contacted"
            )
        ) or 0
        ratio = reached / total if total > 0 else 0.0
        if ratio < CONTACT_RATE_THRESHOLD:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Contact rate {ratio:.1%} is below the {CONTACT_RATE_THRESHOLD:.0%} threshold",
            )
    elif key in DUAL_GATE_KEYS:
        ratio = calculate_consent_ratio(db, project_id, stage)
        if not ratio["dual_gate_passed"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Dual-gate not met: headcount {ratio['headcount_ratio']:.1%}, "
                    f"land share {ratio['land_share_ratio']:.1%} (need >= 80% both)"
                ),
            )
    # Other built-in keys (initial_approval/briefing_*/consultant_review) and any
    # custom (key=None) stage have no automated ratio/count gate - manual milestone
    # confirmation (+ the checklist check above) only.


def try_auto_complete_stage(db: Session, project_id: int, stage: int, current_user: User) -> None:
    """Best-effort: marks `stage` completed (without committing - the caller's own
    commit covers it) if it's still the project's current pending stage and its gate
    condition is already satisfied. Used to auto-advance the SOP when underlying data
    crosses a gate threshold outside of an explicit "complete stage" action - e.g.
    creating the first landowner clears stage 1's gate. Silently no-ops otherwise."""
    sop = get_or_create_sop(db, project_id)
    if sop.current_stage != stage:
        return
    stage_key = str(stage)
    stage_entry = sop.stage_data["stages"].get(stage_key)
    if not stage_entry or stage_entry["status"] != "pending":
        return
    try:
        _assert_gate_passed(db, project_id, stage, sop)
    except HTTPException:
        return

    stage_data = dict(sop.stage_data)
    stages = dict(stage_data["stages"])
    entry = dict(stages[stage_key])
    entry["status"] = "completed"
    entry["completed_at"] = datetime.now(timezone.utc).isoformat()
    entry["completed_by"] = current_user.id
    stages[stage_key] = entry
    stage_data["stages"] = stages
    sop.stage_data = stage_data
    sop.current_stage = min(stage + 1, _final_stage_index(sop))

    project = get_project_or_404(db, project_id)
    project.current_stage = sop.current_stage


@router.get("", response_model=SopStatusResponse)
def get_sop_status(
    db: Session = Depends(get_db),
    project: Project = Depends(require_project_viewer),
):
    sop = get_or_create_sop(db, project.id)
    _sync_roster_confirmation(db, project.id, sop)
    return _status_response(project.id, sop)


@router.get("/stage-defaults")
def get_stage_defaults(current_user: User = Depends(get_current_user)):
    """內建關卡代碼清單,給「建立案件」與案件內的 SOP 客製化編輯器當預設值/可選清單
    用(選了某個內建 key 就會沿用該關卡原本的自動門檻)。"""
    return {"stages": [{"key": d["key"], "name": d["name"]} for d in STAGE_DEFINITIONS]}


@router.put("/stages", response_model=SopStatusResponse)
def set_stage_flow(
    payload: SopStageFlowRequest,
    db: Session = Depends(get_db),
    project: Project = Depends(require_project_manager),
):
    """自訂這個案件的關卡流程(新增/刪除/改名/重新排序)- 只有案件還沒開始跑(第0關
    仍是 pending,沒有任何一關動過)才准改,避免已經在跑的案件因為關卡被搬動/刪掉
    而讓進度/門檻資料對不起來。權限比照建案:L0/L1/L2(require_project_manager)。"""
    sop = get_or_create_sop(db, project.id)
    stages_now = (sop.stage_data or {}).get("stages") or {}
    started = sop.current_stage != 0 or any(
        (entry.get("status") or "pending") != "pending" for entry in stages_now.values()
    )
    if started:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="案件已經開始跑關,無法再調整關卡流程",
        )
    if not payload.stages:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="至少要保留一關")

    seen_keys: set[str] = set()
    defs: list[dict] = []
    for s in payload.stages:
        name = (s.name or "").strip()
        if not name:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="關卡名稱不可空白")
        extra: dict = {}
        if s.key is not None:
            if s.key not in STAGE_DEF_BY_KEY:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"未知的關卡代碼 '{s.key}'")
            if s.key in seen_keys:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"關卡代碼 '{s.key}' 不能重複使用")
            seen_keys.add(s.key)
            extra = dict(STAGE_DEF_BY_KEY[s.key].get("extra") or {})
        defs.append({"key": s.key, "name": name, "extra": extra})

    sop.stage_data = build_initial_stage_data(defs)
    sop.current_stage = 0
    project.current_stage = 0

    db.commit()
    db.refresh(sop)
    return _status_response(project.id, sop)


@router.post("/{stage}/complete", response_model=SopStatusResponse)
def complete_stage(
    stage: int,
    payload: SopCompleteRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    project: Project = Depends(require_project_editor),
):
    project_id = project.id
    sop = get_or_create_sop(db, project_id)
    final_stage = _final_stage_index(sop)

    if not (0 <= stage <= final_stage):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid stage number")

    if payload.force and current_user.role not in MANAGE_ROLES:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only L1/L2 can force-complete a stage")

    if stage != sop.current_stage and not payload.force:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Stage {stage} is not the current stage ({sop.current_stage})",
        )

    stage_data = dict(sop.stage_data)
    stages = dict(stage_data["stages"])
    stage_key = str(stage)
    stage_entry = dict(stages[stage_key])

    if payload.force:
        stage_entry["status"] = "force_closed"
        stage_entry["forced_reason"] = payload.reason
    else:
        if _stage_key(sop, stage) == "ocr_roster" and _sync_roster_confirmation(db, project_id, sop):
            stage_data = dict(sop.stage_data)
            stages = dict(stage_data["stages"])
            stage_entry = dict(stages[stage_key])
        _assert_gate_passed(db, project_id, stage, sop)
        stage_entry["status"] = "completed"

    stage_entry["completed_at"] = datetime.now(timezone.utc).isoformat()
    stage_entry["completed_by"] = current_user.id
    stages[stage_key] = stage_entry
    stage_data["stages"] = stages

    if stage == sop.current_stage:
        sop.current_stage = min(stage + 1, final_stage)

    sop.stage_data = stage_data
    project.current_stage = sop.current_stage

    if stage == final_stage and stage_entry["status"] in ("completed", "force_closed"):
        _maybe_auto_close(db, project, sop, stage_data)

    db.commit()
    db.refresh(sop)
    return _status_response(project_id, sop)


def _maybe_auto_close(db: Session, project, sop: SopStage, stage_data: dict) -> None:
    ratio = calculate_consent_ratio(db, project.id, _final_stage_index(sop))
    if ratio["headcount_total"] > 0 and ratio["headcount_ratio"] >= 1.0:
        stage_data["final"] = {
            "status": "completed",
            "force_closed": False,
            "closed_at": datetime.now(timezone.utc).isoformat(),
            "closed_by": None,
        }
        sop.stage_data = stage_data
        project.status = "closed"


@router.post("/force-close", response_model=SopStatusResponse)
def force_close_project(
    payload: SopCompleteRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    project: Project = Depends(require_project_manager),
):
    project_id = project.id
    sop = get_or_create_sop(db, project_id)

    stage_data = dict(sop.stage_data)
    stage_data["final"] = {
        "status": "force_closed",
        "force_closed": True,
        "closed_at": datetime.now(timezone.utc).isoformat(),
        "closed_by": current_user.id,
        "reason": payload.reason,
    }
    sop.stage_data = stage_data
    project.status = "closed"
    project.is_force_closed = True

    db.commit()
    db.refresh(sop)
    return _status_response(project_id, sop)


@router.post("/{stage}/checklist", response_model=SopStatusResponse)
def confirm_checklist_item(
    stage: int,
    payload: ChecklistConfirmRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    project: Project = Depends(require_project_editor),
):
    """Durably records a manual confirmation for one checklist item within a stage (e.g.
    第1關's "確認地主清冊正確") - a real staff action with a real timestamp/user, not a
    fabricated per-item progress tracker. Which items exist and what they mean is defined
    entirely on the frontend; this just stores whatever key it's told against the stage's
    own `data.checklist` dict."""
    project_id = project.id
    sop = get_or_create_sop(db, project_id)

    if not (0 <= stage <= _final_stage_index(sop)):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid stage number")

    stage_data = dict(sop.stage_data)
    stages = dict(stage_data["stages"])
    stage_key = str(stage)
    stage_entry = dict(stages[stage_key])
    entry_data = dict(stage_entry.get("data") or {})
    checklist = dict(entry_data.get("checklist") or {})

    if payload.confirmed:
        entry = {
            "confirmed_at": datetime.now(timezone.utc).isoformat(),
            "confirmed_by": current_user.id,
        }
        if payload.key == "landowner_roster_confirmed":
            entry.update(_roster_counts(db, project_id))
        checklist[payload.key] = entry
    else:
        checklist.pop(payload.key, None)

    entry_data["checklist"] = checklist
    stage_entry["data"] = entry_data
    stages[stage_key] = stage_entry
    stage_data["stages"] = stages
    sop.stage_data = stage_data

    db.commit()
    db.refresh(sop)
    return _status_response(project_id, sop)


@router.post("/{stage}/form", response_model=SopStatusResponse)
def save_stage_form(
    stage: int,
    payload: StageFormRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    project: Project = Depends(require_project_editor),
):
    """Stores an online-filled form for one stage checklist item (第0關 範本項目) in the
    stage's own `data.forms[<doc_type>]` dict. A submitted form counts as completing that
    checklist item, so the frontend gate treats it the same as an uploaded file.
    Re-posting overwrites (edit); form_data=None removes it."""
    project_id = project.id
    sop = get_or_create_sop(db, project_id)

    if not (0 <= stage <= _final_stage_index(sop)):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid stage number")

    stage_data = dict(sop.stage_data)
    stages = dict(stage_data["stages"])
    stage_key = str(stage)
    stage_entry = dict(stages[stage_key])
    entry_data = dict(stage_entry.get("data") or {})
    forms = dict(entry_data.get("forms") or {})

    if payload.form_data is None:
        forms.pop(payload.doc_type, None)
    else:
        prev = forms.get(payload.doc_type) or {}
        forms[payload.doc_type] = {
            "fields": payload.form_data,
            "submitted_at": datetime.now(timezone.utc).isoformat(),
            "submitted_by": current_user.id,
            "created_at": prev.get("created_at") or datetime.now(timezone.utc).isoformat(),
        }

    entry_data["forms"] = forms
    stage_entry["data"] = entry_data
    stages[stage_key] = stage_entry
    stage_data["stages"] = stages
    sop.stage_data = stage_data

    db.commit()
    db.refresh(sop)
    return _status_response(project_id, sop)


@router.get("/{stage}/consent", response_model=list[ConsentRecordRead])
def list_consent_records(
    stage: int,
    db: Session = Depends(get_db),
    project: Project = Depends(require_project_staff_viewer),
):
    return db.scalars(
        select(ConsentRecord).where(ConsentRecord.project_id == project.id, ConsentRecord.sop_stage == stage)
    ).all()


@router.post("/{stage}/consent", response_model=ConsentRecordRead, status_code=status.HTTP_201_CREATED)
def upsert_consent_record(
    stage: int,
    payload: ConsentUpsertRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    project: Project = Depends(require_project_editor),
):
    project_id = project.id
    landowner = db.get(Landowner, payload.landowner_id)
    if landowner is None or landowner.project_id != project_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Landowner not found in this project")

    record = db.scalar(
        select(ConsentRecord).where(
            ConsentRecord.landowner_id == payload.landowner_id, ConsentRecord.sop_stage == stage
        )
    )
    if record is None:
        record = ConsentRecord(project_id=project_id, landowner_id=payload.landowner_id, sop_stage=stage)
        db.add(record)

    record.consent_status = payload.consent_status
    record.notes = payload.notes
    record.recorded_by = current_user.id

    db.commit()
    db.refresh(record)
    return record
