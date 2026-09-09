from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from database import get_db
from deps import require_project_staff_viewer
from models.building_record import BuildingRecord
from models.consent_record import ConsentRecord
from models.land_record import LandRecord
from models.landowner import Landowner
from models.project import Project
from utils.building_view import floor_sort_key_and_label, group_building_records, parse_address

router = APIRouter(prefix="/projects/{project_id}/building-view", tags=["building-view"])


def _cell_status(owners: list[dict]) -> str:
    statuses = {o["consent_status"] for o in owners}
    if not owners:
        return "empty"
    if "opposed" in statuses:
        return "opposed"
    if statuses == {"agreed"}:
        return "agreed"
    return "pending"


@router.get("")
def get_building_view(
    project_id: int,
    stage: int | None = Query(None, description="SOP stage to read consent status from; defaults to the project's current stage"),
    db: Session = Depends(get_db),
    project: Project = Depends(require_project_staff_viewer),
):
    effective_stage = stage if stage is not None else project.current_stage

    records = db.scalars(
        select(BuildingRecord)
        .options(selectinload(BuildingRecord.landowner))
        .where(BuildingRecord.project_id == project_id, BuildingRecord.landowner_id.isnot(None))
    ).all()

    landowner_ids = {r.landowner_id for r in records}
    consent_by_landowner: dict[int, str] = {}
    if landowner_ids:
        for lo_id, status_value in db.execute(
            select(ConsentRecord.landowner_id, ConsentRecord.consent_status).where(
                ConsentRecord.project_id == project_id,
                ConsentRecord.sop_stage == effective_stage,
                ConsentRecord.landowner_id.in_(landowner_ids),
            )
        ).all():
            consent_by_landowner[lo_id] = status_value

    rows: list[dict] = []
    for r in records:
        parsed = parse_address(r.address)
        floor_sort, floor_label = floor_sort_key_and_label(r.floor)
        owner = {
            "landowner_id": r.landowner_id,
            "name": r.landowner.name if r.landowner else "",
            "phone": r.landowner.phone if r.landowner else None,
            "consent_status": consent_by_landowner.get(r.landowner_id, "pending"),
        }
        rows.append(
            {
                "street": parsed[0] if parsed else None,
                "door_number": parsed[1] if parsed else None,
                "floor_sort": floor_sort,
                "floor_label": floor_label,
                "owners": [owner],
            }
        )

    groups = group_building_records(rows)
    for g in groups:
        for cell in g["cells"].values():
            # Multiple building_records can point at the same landowner (e.g. a
            # multi-parcel OCR merge) - collapse to one owner entry per landowner so a
            # co-owned unit's headcount badge reflects real people, not raw rows.
            by_id: dict[int, dict] = {}
            for o in cell["owners"]:
                by_id[o["landowner_id"]] = o
            cell["owners"] = list(by_id.values())
            cell["status"] = _cell_status(cell["owners"])

    # 純土地地主(有土地登記,但沒有任何建物登記)——樓棟視圖整個是用建物門牌分格
    # 的,這種地主原本完全不會出現在畫面上任何地方,容易被忽略掉。額外列一份清單。
    building_landowner_ids = landowner_ids  # 上面已經算出「有建物」的地主集合
    land_records = db.scalars(
        select(LandRecord)
        .options(selectinload(LandRecord.landowner))
        .where(LandRecord.project_id == project_id, LandRecord.landowner_id.isnot(None))
    ).all()
    land_only_by_owner: dict[int, dict] = {}
    for r in land_records:
        if r.landowner_id in building_landowner_ids:
            continue
        entry = land_only_by_owner.setdefault(
            r.landowner_id,
            {
                "landowner_id": r.landowner_id,
                "name": r.landowner.name if r.landowner else "",
                "phone": r.landowner.phone if r.landowner else None,
                "consent_status": consent_by_landowner.get(r.landowner_id, "pending"),
                "parcels": [],
            },
        )
        entry["parcels"].append(r.parcel_number)

    # 純土地地主不在任何一關的「同意書」流程裡(那套是跟著建物門牌走的),但意願
    # 狀態(agreement_status)一樣有意義,一併查出來給前端顯示,比固定顯示「待確認」
    # 更準確。
    if land_only_by_owner:
        for lo_id, agreement_status in db.execute(
            select(Landowner.id, Landowner.agreement_status).where(
                Landowner.id.in_(land_only_by_owner.keys())
            )
        ).all():
            land_only_by_owner[lo_id]["consent_status"] = (
                "agreed" if agreement_status == "signed" else "pending"
            )

    land_only_owners = sorted(land_only_by_owner.values(), key=lambda o: o["name"] or "")

    return {"stage": effective_stage, "groups": groups, "land_only_owners": land_only_owners}
