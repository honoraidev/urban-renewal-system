from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session, selectinload

from database import get_db
from deps import EDIT_ROLES, LANDOWNER_ROLE, get_current_user, require_project_editor, require_project_viewer
from models.building_record import BuildingRecord
from models.consent_record import ConsentRecord
from models.contact_log import ContactLog
from models.document import Document
from models.land_record import LandRecord
from models.landowner import Landowner
from models.project import Project
from models.user import User
from routers.sop import try_auto_complete_stage
from schemas.landowner import (
    BuildingRecordCreate,
    BuildingRecordRead,
    BuildingRecordUpdate,
    LandownerCreate,
    LandownerMergeRequest,
    LandownerRead,
    LandownerUpdate,
    LandRecordCreate,
    LandRecordRead,
    LandRecordUpdate,
)

router = APIRouter(prefix="/projects/{project_id}/landowners", tags=["landowners"])


def _with_records(stmt):
    return stmt.options(selectinload(Landowner.land_records), selectinload(Landowner.building_records))


def get_landowner_or_404(db: Session, project_id: int, landowner_id: int) -> Landowner:
    landowner = db.scalar(
        _with_records(
            select(Landowner).where(Landowner.id == landowner_id, Landowner.project_id == project_id)
        )
    )
    if landowner is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Landowner not found")
    return landowner


def _compute_building_totals(record: BuildingRecord) -> None:
    record.total_area_sqm = (
        float(record.structure_area_sqm) + float(record.auxiliary_area_sqm) + float(record.common_area_sqm)
    )
    record.ownership_share_pct = (
        record.ownership_numerator / record.ownership_denominator * 100 if record.ownership_denominator else 0
    )


@router.get("", response_model=list[LandownerRead])
def list_landowners(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    project: Project = Depends(require_project_viewer),
):
    stmt = _with_records(select(Landowner).where(Landowner.project_id == project.id))
    if current_user.role == LANDOWNER_ROLE:
        # 地主帳號:清單只回自己被綁定的那些列
        stmt = stmt.where(Landowner.user_id == current_user.id)
    return db.scalars(stmt).all()


def _assert_landowner_self(current_user: User, landowner: Landowner) -> None:
    """地主帳號只能存取 user_id = 自己 的那筆 Landowner;其他角色不受限。"""
    if current_user.role == LANDOWNER_ROLE and landowner.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your own record")


@router.get("/account-options")
def list_landowner_account_options(
    db: Session = Depends(get_db),
    project: Project = Depends(require_project_editor),
):
    """給「編輯地主 → 綁定登入帳號」下拉用:所有 role=landowner 且啟用中的使用者。"""
    rows = db.scalars(
        select(User)
        .where(User.role == LANDOWNER_ROLE, User.is_active == True)  # noqa: E712
        .order_by(User.display_name)
    ).all()
    return [{"id": u.id, "display_name": u.display_name, "username": u.username} for u in rows]


@router.post("", response_model=LandownerRead, status_code=status.HTTP_201_CREATED)
def create_landowner(
    payload: LandownerCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    project: Project = Depends(require_project_editor),
):
    project_id = project.id
    data = payload.model_dump(exclude={"land_records", "building_records"})
    # Display code only (not a uniqueness constraint) - a straight count-based sequence
    # is good enough here, scoped to the project (the project itself is already shown on
    # the roster page, so repeating project_code in every row's code just wrapped the
    # cell onto two lines for no added information).
    existing_count = db.scalar(select(func.count()).select_from(Landowner).where(Landowner.project_id == project_id)) or 0
    data["roster_code"] = f"{existing_count + 1:03d}"
    landowner = Landowner(project_id=project_id, **data)
    db.add(landowner)
    db.flush()

    for land_payload in payload.land_records:
        db.add(LandRecord(project_id=project_id, landowner_id=landowner.id, **land_payload.model_dump()))

    for building_payload in payload.building_records:
        record = BuildingRecord(project_id=project_id, landowner_id=landowner.id, **building_payload.model_dump())
        _compute_building_totals(record)
        db.add(record)

    # Adding the first landowner satisfies stage 1's gate (謄本OCR/地主清冊) -
    # auto-advance the SOP instead of requiring a separate manual "complete" click.
    try_auto_complete_stage(db, project_id, stage=1, current_user=current_user)

    db.commit()
    return get_landowner_or_404(db, project_id, landowner.id)


@router.get("/{landowner_id}", response_model=LandownerRead)
def get_landowner(
    landowner_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    project: Project = Depends(require_project_viewer),
):
    landowner = get_landowner_or_404(db, project.id, landowner_id)
    _assert_landowner_self(current_user, landowner)
    return landowner


@router.patch("/{landowner_id}", response_model=LandownerRead)
def update_landowner(
    landowner_id: int,
    payload: LandownerUpdate,
    db: Session = Depends(get_db),
    project: Project = Depends(require_project_editor),
):
    landowner = get_landowner_or_404(db, project.id, landowner_id)
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(landowner, field, value)
    db.commit()
    return get_landowner_or_404(db, project.id, landowner_id)


@router.delete("/{landowner_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_landowner(
    landowner_id: int,
    db: Session = Depends(get_db),
    project: Project = Depends(require_project_editor),
):
    landowner = get_landowner_or_404(db, project.id, landowner_id)
    db.delete(landowner)
    db.commit()


@router.post("/{landowner_id}/merge", response_model=LandownerRead)
def merge_landowners(
    landowner_id: int,
    payload: LandownerMergeRequest,
    db: Session = Depends(get_db),
    project: Project = Depends(require_project_editor),
):
    """Merges one or more duplicate landowner records into `landowner_id` (the
    survivor): every land/building record, consent record, contact log, and document
    reference that pointed at a source landowner is re-pointed at the survivor, then the
    now-empty source rows are deleted. Needed because landowner de-duplication during OCR
    import matches by exact name string - a residual simplified-character or OCR misread
    that slips past that matching silently creates a second landowner instead of merging
    into the existing one, and this is the cleanup path for when that already happened."""
    project_id = project.id
    survivor = get_landowner_or_404(db, project_id, landowner_id)

    if landowner_id in payload.source_ids:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="不能將地主合併到自己")

    sources = db.scalars(
        select(Landowner).where(Landowner.id.in_(payload.source_ids), Landowner.project_id == project_id)
    ).all()
    if len(sources) != len(set(payload.source_ids)):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="部分地主不存在")

    source_ids = [source.id for source in sources]
    for model in (LandRecord, BuildingRecord, ConsentRecord, ContactLog, Document):
        db.execute(update(model).where(model.landowner_id.in_(source_ids)).values(landowner_id=landowner_id))

    for source in sources:
        db.delete(source)

    db.commit()
    return get_landowner_or_404(db, project_id, survivor.id)


def get_land_record_or_404(db: Session, project_id: int, landowner_id: int, record_id: int) -> LandRecord:
    record = db.scalar(
        select(LandRecord).where(
            LandRecord.id == record_id, LandRecord.project_id == project_id, LandRecord.landowner_id == landowner_id
        )
    )
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Land record not found")
    return record


@router.post("/{landowner_id}/land-records", response_model=LandRecordRead, status_code=status.HTTP_201_CREATED)
def create_land_record(
    landowner_id: int,
    payload: LandRecordCreate,
    db: Session = Depends(get_db),
    project: Project = Depends(require_project_editor),
):
    get_landowner_or_404(db, project.id, landowner_id)
    record = LandRecord(project_id=project.id, landowner_id=landowner_id, **payload.model_dump())
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


_LTT_FIELDS = {
    "ltt_original_value",
    "ltt_original_value_period",
    "ltt_current_value",
    "ltt_holding_years",
    "ltt_cpi_index",
}


@router.patch("/{landowner_id}/land-records/{record_id}", response_model=LandRecordRead)
def update_land_record(
    landowner_id: int,
    record_id: int,
    payload: LandRecordUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    project: Project = Depends(require_project_viewer),
):
    record = get_land_record_or_404(db, project.id, landowner_id, record_id)
    data = payload.model_dump(exclude_unset=True)

    if current_user.role in EDIT_ROLES:
        pass  # 一般編輯者:全欄位可改
    elif current_user.role == LANDOWNER_ROLE:
        # 地主帳號:只能改「自己那筆」的土增稅試算欄位,其他一律擋
        owner = db.get(Landowner, landowner_id)
        if owner is None or owner.user_id != current_user.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not your own record")
        bad = set(data) - _LTT_FIELDS
        if bad:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"地主帳號僅能修改土增稅試算欄位")
    else:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Editor role required")

    for field, value in data.items():
        setattr(record, field, value)
    db.commit()
    db.refresh(record)
    return record


@router.delete("/{landowner_id}/land-records/{record_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_land_record(
    landowner_id: int,
    record_id: int,
    db: Session = Depends(get_db),
    project: Project = Depends(require_project_editor),
):
    record = get_land_record_or_404(db, project.id, landowner_id, record_id)
    db.delete(record)
    db.commit()


def get_building_record_or_404(db: Session, project_id: int, landowner_id: int, record_id: int) -> BuildingRecord:
    record = db.scalar(
        select(BuildingRecord).where(
            BuildingRecord.id == record_id,
            BuildingRecord.project_id == project_id,
            BuildingRecord.landowner_id == landowner_id,
        )
    )
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Building record not found")
    return record


@router.post(
    "/{landowner_id}/building-records", response_model=BuildingRecordRead, status_code=status.HTTP_201_CREATED
)
def create_building_record(
    landowner_id: int,
    payload: BuildingRecordCreate,
    db: Session = Depends(get_db),
    project: Project = Depends(require_project_editor),
):
    get_landowner_or_404(db, project.id, landowner_id)
    if payload.land_record_id is not None:
        get_land_record_or_404(db, project.id, landowner_id, payload.land_record_id)
    record = BuildingRecord(project_id=project.id, landowner_id=landowner_id, **payload.model_dump())
    _compute_building_totals(record)
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


@router.patch("/{landowner_id}/building-records/{record_id}", response_model=BuildingRecordRead)
def update_building_record(
    landowner_id: int,
    record_id: int,
    payload: BuildingRecordUpdate,
    db: Session = Depends(get_db),
    project: Project = Depends(require_project_editor),
):
    record = get_building_record_or_404(db, project.id, landowner_id, record_id)
    updates = payload.model_dump(exclude_unset=True)
    if updates.get("land_record_id") is not None:
        get_land_record_or_404(db, project.id, landowner_id, updates["land_record_id"])
    for field, value in updates.items():
        setattr(record, field, value)
    _compute_building_totals(record)
    db.commit()
    db.refresh(record)
    return record


@router.delete("/{landowner_id}/building-records/{record_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_building_record(
    landowner_id: int,
    record_id: int,
    db: Session = Depends(get_db),
    project: Project = Depends(require_project_editor),
):
    record = get_building_record_or_404(db, project.id, landowner_id, record_id)
    db.delete(record)
    db.commit()
