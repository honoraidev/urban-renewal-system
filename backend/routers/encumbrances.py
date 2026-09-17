from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from database import get_db
from deps import require_project_editor, require_project_staff_viewer
from models.building_record import BuildingRecord
from models.encumbrance import Encumbrance
from models.land_record import LandRecord
from models.project import Project
from schemas.encumbrance import EncumbranceCreate, EncumbranceRead, EncumbranceUpdate

router = APIRouter(prefix="/projects/{project_id}/encumbrances", tags=["encumbrances"])


def _infer_parcel_kind(db: Session, project_id: int, applies_to_parcels: str | None) -> str | None:
    """他項權利部分「地號/建號」兩個分頁本來要人工選,OCR匯入/手動新增常常沒填 -
    用「對應地號/建號」去比對這個案件既有的土地/建物登記,能對上哪邊就自動歸類到
    哪邊,對不上就維持 None(前端照舊 fallback 顯示在地號分頁)。"""
    value = (applies_to_parcels or "").strip()
    if not value:
        return None
    if db.scalar(
        select(BuildingRecord.id).where(BuildingRecord.project_id == project_id, BuildingRecord.building_number == value)
    ):
        return "building"
    if db.scalar(
        select(LandRecord.id).where(LandRecord.project_id == project_id, LandRecord.parcel_number == value)
    ):
        return "land"
    return None


def get_encumbrance_or_404(db: Session, project_id: int, encumbrance_id: int) -> Encumbrance:
    encumbrance = db.scalar(
        select(Encumbrance).where(Encumbrance.id == encumbrance_id, Encumbrance.project_id == project_id)
    )
    if encumbrance is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Encumbrance not found")
    return encumbrance


@router.get("", response_model=list[EncumbranceRead])
def list_encumbrances(
    db: Session = Depends(get_db),
    project: Project = Depends(require_project_staff_viewer),
):
    return db.scalars(
        select(Encumbrance).where(Encumbrance.project_id == project.id).order_by(Encumbrance.created_at)
    ).all()


@router.post("", response_model=EncumbranceRead, status_code=status.HTTP_201_CREATED)
def create_encumbrance(
    payload: EncumbranceCreate,
    db: Session = Depends(get_db),
    project: Project = Depends(require_project_editor),
):
    data = payload.model_dump()
    if not data.get("parcel_kind"):
        data["parcel_kind"] = _infer_parcel_kind(db, project.id, data.get("applies_to_parcels"))
    encumbrance = Encumbrance(project_id=project.id, **data)
    db.add(encumbrance)
    db.commit()
    db.refresh(encumbrance)
    return encumbrance


@router.patch("/{encumbrance_id}", response_model=EncumbranceRead)
def update_encumbrance(
    encumbrance_id: int,
    payload: EncumbranceUpdate,
    db: Session = Depends(get_db),
    project: Project = Depends(require_project_editor),
):
    encumbrance = get_encumbrance_or_404(db, project.id, encumbrance_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(encumbrance, field, value)
    db.commit()
    db.refresh(encumbrance)
    return encumbrance


@router.delete("/{encumbrance_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_encumbrance(
    encumbrance_id: int,
    db: Session = Depends(get_db),
    project: Project = Depends(require_project_editor),
):
    encumbrance = get_encumbrance_or_404(db, project.id, encumbrance_id)
    db.delete(encumbrance)
    db.commit()
