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


def _agreed_landowner_ids(db: Session, project_id: int, stage: int) -> set[int]:
    """A landowner counts as "agreed" for the consent ratio if EITHER:
      - they have a formal 同意書 (ConsentRecord) marked agreed for this SOP stage, OR
      - their 意願狀態 (Landowner.agreement_status) is "signed".
    The second path lets the dashboard rings move as staff mark 已簽約 during 意願調查,
    before the formal per-stage 同意書 process starts, without weakening the legal gate
    (a real ConsentRecord still always counts)."""
    consent_ids = set(
        db.scalars(
            select(ConsentRecord.landowner_id).where(
                ConsentRecord.project_id == project_id,
                ConsentRecord.sop_stage == stage,
                ConsentRecord.consent_status == "agreed",
            )
        ).all()
    )
    signed_ids = set(
        db.scalars(
            select(Landowner.id).where(
                Landowner.project_id == project_id,
                Landowner.agreement_status == "signed",
            )
        ).all()
    )
    return {i for i in (consent_ids | signed_ids) if i is not None}


def calculate_consent_ratio(db: Session, project_id: int, stage: int, threshold: float = 0.8) -> dict:
    headcount_total = db.scalar(
        select(func.count(Landowner.id)).where(Landowner.project_id == project_id)
    ) or 0

    agreed_ids = _agreed_landowner_ids(db, project_id, stage)
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
