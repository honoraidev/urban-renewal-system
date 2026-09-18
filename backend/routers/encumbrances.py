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
    建號,不補的話這欄永遠是空的)。applies_to_parcels 常常是「主建號/地號 + 共同擔保
    的其他建號」用空白隔開(見 utils/ocr.py _normalize_applies_to_parcels),逐一比對
    每個 token,不能整串當一筆比對(空白隔開的多筆一定比對不到)。"""
    value = (applies_to_parcels or "").strip()
    if not value:
        return None, None
    for token in value.split():
        building = db.scalar(
            select(BuildingRecord).where(BuildingRecord.project_id == project_id, BuildingRecord.building_number == token)
        )
        if building:
            return "building", building
    for token in value.split():
        if db.scalar(
            select(LandRecord.id).where(LandRecord.project_id == project_id, LandRecord.parcel_number == token)
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
    門牌地址(連同建號)列出來給地號分頁的他項權利顯示,不然這欄永遠是空的。每筆
    建物編碼成「地址::建號」,用「、」分隔多筆;前端比照整合清冊的門牌欄再各自
    簡化、標示地下持分,同時把建號一起標出來。"""
    value = (parcel_number or "").strip()
    if not value:
        return None
    # 同一筆他項權利常常「共同擔保」好幾個地號,applies_to_parcels 是空白隔開的多筆
    # (見 utils/ocr.py _normalize_applies_to_parcels),要逐一比對,不能整串當一筆。
    tokens = value.split()
    buildings = db.scalars(
        select(BuildingRecord).where(
            BuildingRecord.project_id == project_id,
            BuildingRecord.parcel_number.in_(tokens),
            BuildingRecord.address.isnot(None),
        )
    ).all()
    seen = set()
    parts = []
    for b in buildings:
        key = (b.address, b.building_number)
        if key in seen:
            continue
        seen.add(key)
        parts.append(f"{b.address}::{b.building_number or ''}")
    return "、".join(parts) or None


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
        if enc.property_address:
            continue
        if enc.parcel_kind == "building":
            # 建物分頁本身「對應建號」就是這棟建物,直接拿它自己的門牌 - 不用像地號
            # 分頁那樣反查,這欄本來就該只有一筆,不用「地址::建號」編碼(建號已經是
            # 這一列自己的「建號」欄,不用在門牌地址欄重複標一次)。applies_to_parcels
            # 常常是「主建號 + 共同擔保的公設建號」用空白隔開(見 OCR
            # _normalize_applies_to_parcels),逐一比對到有門牌的那個為止,不能整串
            # 當一個建號比對(會永遠比對不到)。
            building = None
            for token in (enc.applies_to_parcels or "").split():
                candidate = db.scalar(
                    select(BuildingRecord).where(
                        BuildingRecord.project_id == project.id,
                        BuildingRecord.building_number == token,
                    )
                )
                if candidate and candidate.address:
                    building = candidate
                    break
            if building:
                enc.property_address = building.address
        else:
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
