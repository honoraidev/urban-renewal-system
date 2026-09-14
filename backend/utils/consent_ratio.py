from sqlalchemy import func, select
from sqlalchemy.orm import Session

from models.building_record import BuildingRecord
from models.contact_log import ContactLog
from models.land_record import LandRecord
from models.landowner import Landowner

# BuildingRecord has no DB-generated owned-area column (unlike LandRecord.owned_area_sqm)
# - total_area_sqm is the whole unit's floor area and ownership_share_pct is this one
# registration's numerator/denominator*100 (see _compute_building_totals in
# routers/landowners.py), so this owner's actual owned floor area is their product.
_OWNED_BUILDING_AREA = BuildingRecord.total_area_sqm * BuildingRecord.ownership_share_pct / 100


def _agreed_landowner_ids(db: Session, project_id: int) -> set[int]:
    """A landowner counts as "agreed" for the consent ratio (dashboard rings + the
    dual-gate check at SOP stages 4/8/9 - see DUAL_GATE_STAGES in routers/sop.py) when
    their MOST RECENT contact_logs entry has contact_result == "agreed" - changed 2026-09
    per request to track live 聯絡結果 instead of the formal 同意書/已簽約 flow, so the
    ring moves the moment a call is logged as 同意, not only once paperwork is in."""
    latest_result_by_landowner: dict[int, str] = {}
    for landowner_id, contact_result in db.execute(
        select(ContactLog.landowner_id, ContactLog.contact_result)
        .where(ContactLog.project_id == project_id)
        .order_by(ContactLog.contact_date.asc())
    ).all():
        # 依 contact_date 升冪跑過一輪,同一位地主後面的紀錄會覆蓋前面的,最後留下來
        # 的就是最新一筆 - 跟 routers/contacts.py 的 _last_contact_result_by_landowner
        # 同一招。
        latest_result_by_landowner[landowner_id] = contact_result
    return {lo_id for lo_id, result in latest_result_by_landowner.items() if result == "agreed"}


def agreed_landowner_names(db: Session, project_id: int) -> list[str]:
    """姓名清單版的 _agreed_landowner_ids - 給總覽卡片同意度環的 hover 提示用,列出
    「目前算誰同意」,不用另外點進案件才看得到是哪幾位。"""
    ids = _agreed_landowner_ids(db, project_id)
    if not ids:
        return []
    return list(db.scalars(select(Landowner.name).where(Landowner.id.in_(ids)).order_by(Landowner.name)).all())


def calculate_consent_ratio(db: Session, project_id: int, stage: int, threshold: float = 0.8) -> dict:
    headcount_total = db.scalar(
        select(func.count(Landowner.id)).where(Landowner.project_id == project_id)
    ) or 0

    agreed_ids = _agreed_landowner_ids(db, project_id)
    headcount_agreed = len(agreed_ids)

    land_share_total_sqm = float(
        db.scalar(
            select(func.coalesce(func.sum(LandRecord.owned_area_sqm), 0)).where(
                LandRecord.project_id == project_id
            )
        )
        or 0
    )

    land_share_agreed_sqm = (
        float(
            db.scalar(
                select(func.coalesce(func.sum(LandRecord.owned_area_sqm), 0)).where(
                    LandRecord.project_id == project_id,
                    LandRecord.landowner_id.in_(agreed_ids),
                )
            )
            or 0
        )
        if agreed_ids
        else 0.0
    )

    building_share_total_sqm = float(
        db.scalar(select(func.coalesce(func.sum(_OWNED_BUILDING_AREA), 0)).where(BuildingRecord.project_id == project_id))
        or 0
    )

    building_share_agreed_sqm = (
        float(
            db.scalar(
                select(func.coalesce(func.sum(_OWNED_BUILDING_AREA), 0)).where(
                    BuildingRecord.project_id == project_id,
                    BuildingRecord.landowner_id.in_(agreed_ids),
                )
            )
            or 0
        )
        if agreed_ids
        else 0.0
    )

    headcount_ratio = headcount_agreed / headcount_total if headcount_total > 0 else 0.0
    land_share_ratio = land_share_agreed_sqm / land_share_total_sqm if land_share_total_sqm > 0 else 0.0
    building_share_ratio = building_share_agreed_sqm / building_share_total_sqm if building_share_total_sqm > 0 else 0.0

    return {
        "stage": stage,
        "headcount_total": headcount_total,
        "headcount_agreed": headcount_agreed,
        "headcount_ratio": headcount_ratio,
        "land_share_total_sqm": land_share_total_sqm,
        "land_share_agreed_sqm": land_share_agreed_sqm,
        "land_share_ratio": land_share_ratio,
        "building_share_total_sqm": building_share_total_sqm,
        "building_share_agreed_sqm": building_share_agreed_sqm,
        "building_share_ratio": building_share_ratio,
        "dual_gate_passed": headcount_ratio >= threshold and land_share_ratio >= threshold,
    }
