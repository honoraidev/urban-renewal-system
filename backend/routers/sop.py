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
    SopStatusResponse,
    StageFormRequest,
)
from utils.consent_ratio import calculate_consent_ratio

router = APIRouter(prefix="/projects/{project_id}/sop", tags=["sop"])

STAGE_DEFINITIONS: list[tuple[str, dict]] = [
    ("第0關:初始核定立案", {}),
    ("第1關:謄本OCR/地主清冊", {}),
    ("第2關:聯絡率>95%", {"contact_rate_threshold": 0.95}),
    ("第3關:說明會#1", {}),
    ("第4關:同意度>80%(雙門檻)", {"headcount_threshold": 0.8, "land_share_threshold": 0.8}),
    ("第5關:顧問文件主管審核", {}),
    ("第6關:說明會#2(圖面發布)", {}),
    ("第7關:說明會#3(合約Q&A)", {}),
    ("第8關:說明會#4同意度>80%", {"headcount_threshold": 0.8, "land_share_threshold": 0.8}),
    ("第9關:雙門檻同意>80%", {"headcount_threshold": 0.8, "land_share_threshold": 0.8}),
]

DUAL_GATE_STAGES = {4, 8, 9}
CONTACT_RATE_STAGE = 2
CONTACT_RATE_THRESHOLD = 0.95
FINAL_STAGE = 9

# Real, checkable completion requirements for stages that aren't already covered by
# _assert_gate_passed's ratio checks - mirrors the frontend's SOP_STAGE_CHECKLISTS
# (same doc_type/manual-key names) so "完成本關卡" actually enforces what the checklist
# UI shows, instead of any editor being able to click past unfinished items.
# `checklist_keys` entries must have been confirmed via POST /{stage}/checklist first.
STAGE_CHECKLIST_REQUIREMENTS: dict[int, dict] = {
    0: {"doc_types": ["dev_letter_template", "willingness_form_template", "consent_form_template", "contract_template"]},
    1: {"doc_types": ["cadastral_map"], "checklist_keys": ["landowner_roster_confirmed"], "needs_land": True, "needs_building": True},
    3: {"doc_types": ["briefing_material"], "checklist_keys": ["briefing_reviewed_3"]},
    5: {"doc_types": ["consultant_document"], "checklist_keys": ["consultant_reviewed"]},
    6: {"doc_types": ["briefing_material"], "checklist_keys": ["briefing_reviewed_6"]},
    7: {"doc_types": ["briefing_material"], "checklist_keys": ["briefing_reviewed_7"]},
}


def build_initial_stage_data() -> dict:
    return {
        "stages": {
            str(i): {
                "name": name,
                "status": "pending",
                "data": dict(extra),
            }
            for i, (name, extra) in enumerate(STAGE_DEFINITIONS)
        },
        "final": {"status": "pending", "force_closed": False, "closed_at": None, "closed_by": None},
    }


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
    stages = (sop.stage_data or {}).get("stages") or {}
    entry = stages.get("1") or {}
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
    stage_entry = dict(all_stages["1"])
    entry_data = dict(stage_entry.get("data") or {})
    new_checklist = dict(entry_data.get("checklist") or {})
    new_checklist.pop("landowner_roster_confirmed", None)
    entry_data["checklist"] = new_checklist
    stage_entry["data"] = entry_data
    all_stages["1"] = stage_entry
    stage_data["stages"] = all_stages
    sop.stage_data = stage_data
    db.commit()
    db.refresh(sop)
    return True


def _status_response(project_id: int, sop: SopStage) -> SopStatusResponse:
    return SopStatusResponse(
        project_id=project_id,
        current_stage=sop.current_stage,
        stages=sop.stage_data["stages"],
        final=sop.stage_data["final"],
        updated_at=sop.updated_at,
    )


def _assert_checklist_passed(db: Session, project_id: int, stage: int, sop: SopStage) -> None:
    requirements = STAGE_CHECKLIST_REQUIREMENTS.get(stage)
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
    if stage == 1:
        total = db.scalar(select(func.count(Landowner.id)).where(Landowner.project_id == project_id)) or 0
        if total < 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Stage 1 requires at least one landowner record",
            )
    elif stage == CONTACT_RATE_STAGE:
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
    elif stage in DUAL_GATE_STAGES:
        ratio = calculate_consent_ratio(db, project_id, stage)
        if not ratio["dual_gate_passed"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Dual-gate not met: headcount {ratio['headcount_ratio']:.1%}, "
                    f"land share {ratio['land_share_ratio']:.1%} (need >= 80% both)"
                ),
            )
    # stages 0, 3, 5, 6, 7 have no automated gate - manual milestone confirmation only.


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
    sop.current_stage = min(stage + 1, FINAL_STAGE)

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

    if not (0 <= stage <= FINAL_STAGE):
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
        if stage == 1 and _sync_roster_confirmation(db, project_id, sop):
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
        sop.current_stage = min(stage + 1, FINAL_STAGE)

    sop.stage_data = stage_data
    project.current_stage = sop.current_stage

    if stage == FINAL_STAGE and stage_entry["status"] in ("completed", "force_closed"):
        _maybe_auto_close(db, project, sop, stage_data)

    db.commit()
    db.refresh(sop)
    return _status_response(project_id, sop)


def _maybe_auto_close(db: Session, project, sop: SopStage, stage_data: dict) -> None:
    ratio = calculate_consent_ratio(db, project.id, FINAL_STAGE)
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

    if not (0 <= stage <= FINAL_STAGE):
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

    if not (0 <= stage <= FINAL_STAGE):
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
