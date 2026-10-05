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
    dual-gate check at the project's consent_dual_1/consent_dual_2/consent_final stages
    - see DUAL_GATE_KEYS in routers/sop.py) only when BOTH are true - changed 2026-09 per
    request:
      - their MOST RECENT contact_logs entry has contact_result == "agreed" (電話同意), AND
      - Landowner.agreement_status == "signed" (已簽約 - 編輯地主視窗的「拜訪/簽約
        狀態」勾選,上傳意願書時一起 PATCH 成 signed,見 landowners.js) - a phone "同意"
        alone is not enough, but conversely being 已簽約 with no matching phone
        agreement (or a since-changed 反對/需回電) doesn't count either. Use
        agreement_status rather than checking for an uploaded document directly - the
        「取消」button only flips agreement_status back to not_signed and does NOT
        delete the document row, so a doc-existence check would keep counting someone
        after they'd been un-signed."""
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
    phone_agreed_ids = {lo_id for lo_id, result in latest_result_by_landowner.items() if result == "agreed"}

    signed_ids = set(
        db.scalars(
            select(Landowner.id).where(
                Landowner.project_id == project_id,
                Landowner.agreement_status == "signed",
            )
        ).all()
    )

    return phone_agreed_ids & signed_ids


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

    # ---- 樓棟視圖口徑(SOP 同意率面板 / 雙門檻實際使用)----
    # 人數:跟整合清冊「已/未聯絡」統計同一套 —— 名下沒有建物(只有土地)或至少有一筆「非公設」
    # 建物的地主才算;名下建物全是共有部分/公設的人樓棟視圖畫不出一格,不計入。
    # 面積:只加總「非公設」建物登記的持分樓地板面積(= 樓棟視圖每一格的面積),同意者那幾位的部分
    # 當分子。完全沒有建物資料(純土地案件)時退回用土地持分面積。
    from utils.building_view import is_shared_building_record

    bld_rows = db.execute(
        select(
            BuildingRecord.landowner_id,
            BuildingRecord.main_use,
            BuildingRecord.common_part_shares,
            BuildingRecord.address,
            BuildingRecord.total_area_sqm,
            BuildingRecord.ownership_share_pct,
        ).where(BuildingRecord.project_id == project_id)
    ).all()
    owner_ids_all = set(db.scalars(select(Landowner.id).where(Landowner.project_id == project_id)).all())
    has_any: set[int] = set()
    has_real: set[int] = set()
    bv_area_total = 0.0
    bv_area_agreed = 0.0
    for lid, main_use, cps, addr, total_area, share in bld_rows:
        if lid is None:
            continue
        has_any.add(lid)
        rec = type("R", (), {"main_use": main_use, "common_part_shares": cps, "address": addr})()
        if is_shared_building_record(rec):
            continue
        has_real.add(lid)
        owned = float(total_area or 0) * float(share or 0) / 100
        bv_area_total += owned
        if lid in agreed_ids:
            bv_area_agreed += owned
    bv_owner_ids = {lid for lid in owner_ids_all if lid not in has_any or lid in has_real}
    bv_headcount_total = len(bv_owner_ids)
    bv_headcount_agreed = len(agreed_ids & bv_owner_ids)
    bv_headcount_ratio = bv_headcount_agreed / bv_headcount_total if bv_headcount_total > 0 else 0.0
    if bv_area_total > 0:
        bv_area_ratio = bv_area_agreed / bv_area_total
    else:
        bv_area_total, bv_area_agreed = land_share_total_sqm, land_share_agreed_sqm
        bv_area_ratio = (land_share_agreed_sqm / land_share_total_sqm if land_share_total_sqm > 0 else 0.0)

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
        "bv_headcount_total": bv_headcount_total,
        "bv_headcount_agreed": bv_headcount_agreed,
        "bv_headcount_ratio": bv_headcount_ratio,
        "bv_area_total_sqm": bv_area_total,
        "bv_area_agreed_sqm": bv_area_agreed,
        "bv_area_ratio": bv_area_ratio,
        "dual_gate_passed": bv_headcount_ratio >= threshold and bv_area_ratio >= threshold,
    }
