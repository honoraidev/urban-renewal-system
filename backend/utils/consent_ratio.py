from sqlalchemy import func, select
from sqlalchemy.orm import Session

from models.building_record import BuildingRecord
from models.consent_record import ConsentRecord
from models.land_record import LandRecord
from models.landowner import Landowner

# BuildingRecord has no DB-generated owned-area column (unlike LandRecord.owned_area_sqm)
# - total_area_sqm is the whole unit's floor area and ownership_share_pct is this one
# registration's numerator/denominator*100 (see _compute_building_totals in
# routers/landowners.py), so this owner's actual owned floor area is their product.
_OWNED_BUILDING_AREA = BuildingRecord.total_area_sqm * BuildingRecord.ownership_share_pct / 100


def calculate_consent_ratio(db: Session, project_id: int, stage: int, threshold: float = 0.8) -> dict:
    headcount_total = db.scalar(
        select(func.count(Landowner.id)).where(Landowner.project_id == project_id)
    ) or 0

    headcount_agreed = db.scalar(
        select(func.count(func.distinct(ConsentRecord.landowner_id)))
        .where(
            ConsentRecord.project_id == project_id,
            ConsentRecord.sop_stage == stage,
            ConsentRecord.consent_status == "agreed",
        )
    ) or 0

    land_share_total_sqm = float(
        db.scalar(
            select(func.coalesce(func.sum(LandRecord.owned_area_sqm), 0)).where(
                LandRecord.project_id == project_id
            )
        )
        or 0
    )

    land_share_agreed_sqm = float(
        db.scalar(
            select(func.coalesce(func.sum(LandRecord.owned_area_sqm), 0))
            .join(Landowner, LandRecord.landowner_id == Landowner.id)
            .join(
                ConsentRecord,
                (ConsentRecord.landowner_id == Landowner.id) & (ConsentRecord.sop_stage == stage),
            )
            .where(
                LandRecord.project_id == project_id,
                ConsentRecord.consent_status == "agreed",
            )
        )
        or 0
    )

    building_share_total_sqm = float(
        db.scalar(select(func.coalesce(func.sum(_OWNED_BUILDING_AREA), 0)).where(BuildingRecord.project_id == project_id))
        or 0
    )

    building_share_agreed_sqm = float(
        db.scalar(
            select(func.coalesce(func.sum(_OWNED_BUILDING_AREA), 0))
            .join(Landowner, BuildingRecord.landowner_id == Landowner.id)
            .join(
                ConsentRecord,
                (ConsentRecord.landowner_id == Landowner.id) & (ConsentRecord.sop_stage == stage),
            )
            .where(
                BuildingRecord.project_id == project_id,
                ConsentRecord.consent_status == "agreed",
            )
        )
        or 0
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
