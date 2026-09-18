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
from routers.contacts import _last_contact_result_by_landowner
from utils.building_view import (
    floor_sort_key_and_label,
    group_building_records,
    is_shared_building_record,
    parse_address,
)

router = APIRouter(prefix="/projects/{project_id}/building-view", tags=["building-view"])

# 格子底色依「最新一次聯絡結果」(contact_logs.contact_result)上色,不是正式的
# SOP 關卡同意紀錄(consent_status)——現場人員要的是「這戶最近聯絡起來反應怎樣」
# 的即時提醒。改成跟首頁案件卡片、案件總覽頁關鍵指標同一套三分類統計(同意/反對/
# 其他,其他=需回電+未接聽+未決定+完全沒聯絡過),同一格好幾位共有人時,不再是
# 「誰的狀態最需要注意就整格蓋成那個顏色」(以前反對 1 人就蓋掉另外 4 位已同意的
# 事實),改成三色比例漸層一次呈現全部人的真實分佈,前端依 agreed_ratio/
# opposed_ratio/other_ratio 畫漸層背景。
def _cell_status(owners: list[dict]) -> dict:
    total = len(owners)
    if total == 0:
        return {"status": "empty", "agreed_ratio": 0.0, "opposed_ratio": 0.0, "other_ratio": 0.0}
    agreed = sum(1 for o in owners if o.get("last_contact_result") == "agreed")
    opposed = sum(1 for o in owners if o.get("last_contact_result") == "opposed")
    other = total - agreed - opposed
    agreed_ratio = agreed / total
    opposed_ratio = opposed / total
    other_ratio = other / total
    if agreed == total:
        status = "agreed"
    elif opposed == total:
        status = "opposed"
    elif other == total:
        status = "none"
    else:
        status = "mixed"
    return {
        "status": status,
        "agreed_ratio": agreed_ratio,
        "opposed_ratio": opposed_ratio,
        "other_ratio": other_ratio,
    }


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
    # 剔除共有部分 / 純地下室建號(OCR 一位共有人一列,不濾會出現「×50」假人頭)。
    records = [r for r in records if not is_shared_building_record(r)]

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

    last_contact_result_by_landowner = _last_contact_result_by_landowner(db, project_id)

    rows: list[dict] = []
    for r in records:
        parsed = parse_address(r.address)
        floor_sort, floor_label = floor_sort_key_and_label(r.floor)
        owner = {
            "landowner_id": r.landowner_id,
            "name": r.landowner.name if r.landowner else "",
            "phone_landline": r.landowner.phone_landline if r.landowner else None,
            "phone_mobile": r.landowner.phone_mobile if r.landowner else None,
            "address": r.landowner.address if r.landowner else None,
            "consent_status": consent_by_landowner.get(r.landowner_id, "pending"),
            "agreement_status": r.landowner.agreement_status if r.landowner else "not_signed",
            "visit_status": r.landowner.visit_status if r.landowner else "not_visited",
            "last_contact_result": last_contact_result_by_landowner.get(r.landowner_id),
        }
        rows.append(
            {
                "street": parsed[0] if parsed else None,
                "door_number": parsed[1] if parsed else None,
                "door_sub": parsed[2] if parsed else 0,
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
            cell.update(_cell_status(cell["owners"]))

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
                "phone_landline": r.landowner.phone_landline if r.landowner else None,
                "phone_mobile": r.landowner.phone_mobile if r.landowner else None,
                "consent_status": consent_by_landowner.get(r.landowner_id, "pending"),
                "agreement_status": r.landowner.agreement_status if r.landowner else "not_signed",
                "visit_status": r.landowner.visit_status if r.landowner else "not_visited",
                "last_contact_result": last_contact_result_by_landowner.get(r.landowner_id),
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
