from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from database import get_db
from deps import get_current_user, require_project_editor, require_project_manager, require_project_staff_viewer
from models.development_stage import DevelopmentStage
from models.project import Project
from models.user import User
from routers.sop import get_or_create_sop
from schemas.development import (
    DevelopmentCompleteRequest,
    DevelopmentHistoryEntryCreate,
    DevelopmentStageFlowRequest,
    DevelopmentStageMetaUpdate,
    DevelopmentStatusResponse,
)

router = APIRouter(prefix="/projects/{project_id}/development", tags=["development"])

# 都市更新結案後常見的開發流程,給新案件當預設值用 - 跟自訂關卡一樣完全是人工推進,
# 沒有自動門檻;L2 以上還是可以在案件還沒開始跑這個流程前用「編輯流程」自行增刪/
# 改名/排序,這份只是省去每個案件都要從零開始手動建立的麻煩。
DEFAULT_DEVELOPMENT_STAGES: list[str] = [
    "事業計畫核定",
    "權利變換計畫",
    "拆除作業",
    "開工申報",
    "興建施工",
    "交屋與成果",
]


def _default_stage_data() -> dict:
    return {"stages": {str(i): {"name": n, "status": "pending"} for i, n in enumerate(DEFAULT_DEVELOPMENT_STAGES)}}


def _assert_sop_done(db: Session, project_id: int) -> None:
    """後續開發流程(事業計畫核定...)整組鎖在「案件同意度通過」之前 - 要 SOP 進度
    10 個關卡的 final gate 通過(100% 同意結案,或 L1/L2 強制結案)才解鎖,不是前端
    單純不給點而已,直接呼叫這幾支 API 也一樣會被擋,不然繞過 UI 就能在 SOP 都還
    沒跑完時把開發流程往前推。"""
    sop = get_or_create_sop(db, project_id)
    if sop.stage_data["final"]["status"] == "pending":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="SOP 進度尚未完成(案件同意度通過待完成),無法操作後續開發流程",
        )


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
        history=dev.stage_data.get("history") or [],
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
    _assert_sop_done(db, project.id)
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
    _assert_sop_done(db, project.id)
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


@router.patch("/{stage}/meta", response_model=DevelopmentStatusResponse)
def update_development_stage_meta(
    stage: int,
    payload: DevelopmentStageMetaUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    project: Project = Depends(require_project_editor),
):
    """關卡的負責單位/辦理內容/所需文件/預計完成日/本階段進度% - 跟關卡流程結構
    (名稱/順序)是分開的,案件開始跑之後也能隨時改。"""
    _assert_sop_done(db, project.id)
    dev = get_or_create_dev(db, project.id)
    if not (0 <= stage <= _final_stage_index(dev)):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid stage number")

    stage_data = dict(dev.stage_data)
    stages = dict(stage_data["stages"])
    stage_key = str(stage)
    entry = dict(stages[stage_key])

    updates = payload.model_dump(exclude_unset=True)
    if "progress_pct" in updates and updates["progress_pct"] is not None:
        updates["progress_pct"] = max(0, min(100, updates["progress_pct"]))
    entry.update(updates)
    entry["meta_updated_at"] = datetime.now(timezone.utc).isoformat()
    entry["meta_updated_by"] = current_user.id
    stages[stage_key] = entry
    stage_data["stages"] = stages
    dev.stage_data = stage_data

    db.commit()
    db.refresh(dev)
    return _status_response(project.id, dev)


@router.post("/history", response_model=DevelopmentStatusResponse, status_code=status.HTTP_201_CREATED)
def add_development_history_entry(
    payload: DevelopmentHistoryEntryCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    project: Project = Depends(require_project_editor),
):
    """階段歷程時間軸 - 案件層級的里程碑紀錄,不綁定單一關卡(一筆事件常常橫跨/
    對應到某個關卡的某個動作,例如「第1次審查會議」),純人工新增,不是自動產生。"""
    _assert_sop_done(db, project.id)
    title = (payload.title or "").strip()
    if not title:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="標題不可空白")

    dev = get_or_create_dev(db, project.id)
    stage_data = dict(dev.stage_data)
    history = list(stage_data.get("history") or [])
    next_id = (stage_data.get("history_seq") or 0) + 1
    history.append({
        "id": next_id,
        "event_date": payload.event_date,
        "title": title,
        "note": payload.note or None,
        "created_by": current_user.id,
        "created_at": datetime.now(timezone.utc).isoformat(),
    })
    # 依日期新到舊排序,新增的事件不一定是最新日期(可能補記較早的里程碑)。
    history.sort(key=lambda h: h.get("event_date") or "", reverse=True)
    stage_data["history"] = history
    stage_data["history_seq"] = next_id
    dev.stage_data = stage_data

    db.commit()
    db.refresh(dev)
    return _status_response(project.id, dev)


@router.delete("/history/{entry_id}", response_model=DevelopmentStatusResponse)
def delete_development_history_entry(
    entry_id: int,
    db: Session = Depends(get_db),
    project: Project = Depends(require_project_editor),
):
    dev = get_or_create_dev(db, project.id)
    stage_data = dict(dev.stage_data)
    history = [h for h in (stage_data.get("history") or []) if h.get("id") != entry_id]
    stage_data["history"] = history
    dev.stage_data = stage_data

    db.commit()
    db.refresh(dev)
    return _status_response(project.id, dev)
