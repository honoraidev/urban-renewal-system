from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from database import get_db
from deps import require_project_viewer
from models.building_record import BuildingRecord
from models.consent_record import ConsentRecord
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
    project: Project = Depends(require_project_viewer),
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

    return {"stage": effective_stage, "groups": groups}
