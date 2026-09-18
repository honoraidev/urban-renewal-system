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


def _match_building_or_land(db: Session, project_id: int, applies_to_parcels: str | None) -> tuple[str | None, BuildingRecord | None]:
    """他項權利部「地號/建號」分類本來要人工選,OCR匯入/手動新增常常沒填 - 用「對應
    地號/建號」去比對這個案件既有的土地/建物登記,能對上哪邊就自動歸類到哪邊,對不上
    就維持 None(前端照舊 fallback 顯示在地號分頁)。比對到建號的話一併把該筆建物登記
    傳回去,拿它的門牌地址補到 property_address(謄本上他項權利本來就不會印門牌,只印
    建號,不補的話這欄永遠是空的)。"""
    value = (applies_to_parcels or "").strip()
    if not value:
        return None, None
    building = db.scalar(
        select(BuildingRecord).where(BuildingRecord.project_id == project_id, BuildingRecord.building_number == value)
    )
    if building:
        return "building", building
    if db.scalar(
        select(LandRecord.id).where(LandRecord.project_id == project_id, LandRecord.parcel_number == value)
    ):
        return "land", None
    return None, None


def get_encumbrance_or_404(db: Session, project_id: int, encumbrance_id: int) -> Encumbrance:
    encumbrance = db.scalar(
        select(Encumbrance).where(Encumbrance.id == encumbrance_id, Encumbrance.project_id == project_id)
    )
    if encumbrance is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Encumbrance not found")
    return encumbrance


def _building_addresses_for_parcel(db: Session, project_id: int, parcel_number: str | None) -> str | None:
    """地號本身沒有門牌 - 用建物標示部的「建物坐落地號」(BuildingRecord.parcel_number,
    謄本上就是印這個,不必先解出 land_record_id)反查蓋在這塊地上的建物,把它們的
    門牌地址列出來給地號分頁的他項權利顯示,不然這欄永遠是空的。用「、」分隔,前端
    比照整合清冊的門牌欄再各自簡化、標示地下持分。"""
    value = (parcel_number or "").strip()
    if not value:
        return None
    addresses = db.scalars(
        select(BuildingRecord.address).where(
            BuildingRecord.project_id == project_id,
            BuildingRecord.parcel_number == value,
            BuildingRecord.address.isnot(None),
        )
    ).all()
    return "、".join(dict.fromkeys(a for a in addresses if a)) or None


@router.get("", response_model=list[EncumbranceRead])
def list_encumbrances(
    db: Session = Depends(get_db),
    project: Project = Depends(require_project_staff_viewer),
):
    encumbrances = db.scalars(
        select(Encumbrance).where(Encumbrance.project_id == project.id).order_by(Encumbrance.created_at)
    ).all()
    # 地號本身查不到門牌就補算給前端顯示 - 只改回傳值,不寫回 DB(這個 request 沒有
    # db.commit(),session 結束就丟掉,不會把算出來的地址誤存成這筆他項權利自己的
    # property_address 欄位)。
    for enc in encumbrances:
        if not enc.property_address and enc.parcel_kind != "building":
            computed = _building_addresses_for_parcel(db, project.id, enc.applies_to_parcels)
            if computed:
                enc.property_address = computed
    return encumbrances


@router.post("", response_model=EncumbranceRead, status_code=status.HTTP_201_CREATED)
def create_encumbrance(
    payload: EncumbranceCreate,
    db: Session = Depends(get_db),
    project: Project = Depends(require_project_editor),
):
    data = payload.model_dump()
    if not data.get("parcel_kind") or not data.get("property_address"):
        kind, building = _match_building_or_land(db, project.id, data.get("applies_to_parcels"))
        if not data.get("parcel_kind"):
            data["parcel_kind"] = kind
        if not data.get("property_address") and building and building.address:
            data["property_address"] = building.address
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
