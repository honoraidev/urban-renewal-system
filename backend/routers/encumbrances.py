from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from database import get_db
from deps import require_project_editor, require_project_viewer
from models.encumbrance import Encumbrance
from models.project import Project
from schemas.encumbrance import EncumbranceCreate, EncumbranceRead, EncumbranceUpdate

router = APIRouter(prefix="/projects/{project_id}/encumbrances", tags=["encumbrances"])


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
    project: Project = Depends(require_project_viewer),
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
    encumbrance = Encumbrance(project_id=project.id, **payload.model_dump())
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
