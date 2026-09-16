from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from database import get_db
from deps import get_current_user, require_project_editor, require_project_manager, require_project_staff_viewer
from models.development_stage import DevelopmentStage
from models.project import Project
from models.user import User
from schemas.development import (
    DevelopmentCompleteRequest,
    DevelopmentStageFlowRequest,
    DevelopmentStatusResponse,
)

router = APIRouter(prefix="/projects/{project_id}/development", tags=["development"])

# 都市更新結案後常見的開發流程,給新案件當預設值用 - 跟自訂關卡一樣完全是人工推進,
# 沒有自動門檻;L2 以上還是可以在案件還沒開始跑這個流程前用「編輯流程」自行增刪/
# 改名/排序,這份只是省去每個案件都要從零開始手動建立的麻煩。
DEFAULT_DEVELOPMENT_STAGES: list[str] = [
    "事業計畫報核",
    "權利變換計畫報核",
    "都市更新審議",
    "建造執照申請",
    "拆除既有建物",
    "開工興建",
    "使用執照核發",
    "交屋",
]


def _default_stage_data() -> dict:
    return {"stages": {str(i): {"name": n, "status": "pending"} for i, n in enumerate(DEFAULT_DEVELOPMENT_STAGES)}}


def get_or_create_dev(db: Session, project_id: int) -> DevelopmentStage:
    dev = db.scalar(select(DevelopmentStage).where(DevelopmentStage.project_id == project_id))
    if dev is None:
        dev = DevelopmentStage(project_id=project_id, stage_data=_default_stage_data(), current_stage=0)
        db.add(dev)
        db.commit()
        db.refresh(dev)
    return dev


def _final_stage_index(dev: DevelopmentStage) -> int:
    return len(dev.stage_data.get("stages") or {}) - 1


def _status_response(project_id: int, dev: DevelopmentStage) -> DevelopmentStatusResponse:
    return DevelopmentStatusResponse(
        project_id=project_id,
        current_stage=dev.current_stage,
        stages=dev.stage_data.get("stages") or {},
        updated_at=dev.updated_at,
    )


@router.get("", response_model=DevelopmentStatusResponse)
def get_development_status(
    db: Session = Depends(get_db),
    project: Project = Depends(require_project_staff_viewer),
):
    dev = get_or_create_dev(db, project.id)
    return _status_response(project.id, dev)


@router.put("/stages", response_model=DevelopmentStatusResponse)
def set_development_flow(
    payload: DevelopmentStageFlowRequest,
    db: Session = Depends(get_db),
    project: Project = Depends(require_project_manager),
):
    """自訂這個案件的後續開發流程(事業計畫核定/權利變換/拆除/開工/交屋這類,完全
    自訂、沒有預設關卡)- 權限跟 SOP 的自訂關卡流程一樣是 L0/L1/L2。跟 SOP 一樣只有
    流程「還沒開始跑」才准改,避免動到已經在推進中的資料。"""
    dev = get_or_create_dev(db, project.id)
    stages_now = dev.stage_data.get("stages") or {}
    started = dev.current_stage != 0 or any(
        (entry.get("status") or "pending") != "pending" for entry in stages_now.values()
    )
    if started:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="流程已經開始跑,無法再調整關卡")

    names = [(s.name or "").strip() for s in payload.stages]
    if any(not n for n in names):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="關卡名稱不可空白")

    dev.stage_data = {"stages": {str(i): {"name": n, "status": "pending"} for i, n in enumerate(names)}}
    dev.current_stage = 0
    db.commit()
    db.refresh(dev)
    return _status_response(project.id, dev)


@router.post("/{stage}/complete", response_model=DevelopmentStatusResponse)
def complete_development_stage(
    stage: int,
    payload: DevelopmentCompleteRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    project: Project = Depends(require_project_editor),
):
    dev = get_or_create_dev(db, project.id)
    final_stage = _final_stage_index(dev)
    if final_stage < 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="尚未建立任何關卡")
    if stage != dev.current_stage:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Stage {stage} is not the current stage ({dev.current_stage})",
        )

    stage_data = dict(dev.stage_data)
    stages = dict(stage_data["stages"])
    stage_key = str(stage)
    entry = dict(stages[stage_key])
    entry["status"] = "completed"
    entry["completed_at"] = datetime.now(timezone.utc).isoformat()
    entry["completed_by"] = current_user.id
    entry["note"] = payload.reason
    stages[stage_key] = entry
    stage_data["stages"] = stages
    dev.stage_data = stage_data
    dev.current_stage = min(stage + 1, final_stage + 1)

    db.commit()
    db.refresh(dev)
    return _status_response(project.id, dev)


@router.post("/{stage}/reopen", response_model=DevelopmentStatusResponse)
def reopen_development_stage(
    stage: int,
    db: Session = Depends(get_db),
    project: Project = Depends(require_project_editor),
):
    """撤銷「完成」,給手滑點錯用 - 只能重開最後一個已完成的關卡,維持循序推進、
    不支援任意跳關重開。"""
    dev = get_or_create_dev(db, project.id)
    stages = dev.stage_data.get("stages") or {}
    if stage != dev.current_stage - 1 or str(stage) not in stages:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="只能重開最後一個已完成的關卡")

    stage_data = dict(dev.stage_data)
    all_stages = dict(stage_data["stages"])
    stage_key = str(stage)
    entry = dict(all_stages[stage_key])
    entry["status"] = "pending"
    entry.pop("completed_at", None)
    entry.pop("completed_by", None)
    entry.pop("note", None)
    all_stages[stage_key] = entry
    stage_data["stages"] = all_stages
    dev.stage_data = stage_data
    dev.current_stage = stage

    db.commit()
    db.refresh(dev)
    return _status_response(project.id, dev)
