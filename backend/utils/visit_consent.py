from datetime import date, datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from models.building_record import BuildingRecord
from models.consent_snapshot import ConsentSnapshot
from models.land_record import LandRecord
from models.landowner import Landowner
from models.project import Project
from routers.contacts import _last_contact_result_by_landowner

# BuildingRecord 沒有 DB 算好的持分面積欄位(不像 LandRecord.owned_area_sqm),
# 跟 utils/consent_ratio.py 的 _OWNED_BUILDING_AREA 同一招自己乘出來。
_OWNED_BUILDING_AREA = BuildingRecord.total_area_sqm * BuildingRecord.ownership_share_pct / 100


def compute_visit_breakdown(db: Session, project_id: int, before: datetime | None = None) -> dict:
    """依「每位地主最新一次拜訪結果」(contact_logs,不是 SOP 關卡用的嚴格雙門檻
    定義)把地主分成同意/反對/其他三類,算人數與持分面積 —— 案件卡片的三色圓餅圖
    跟本週/上週比較都是用這份資料,跟 utils/consent_ratio.py 的
    calculate_consent_ratio(SOP 雙門檻關卡湊關用,要求電訪同意「且」已簽約)是兩套
    獨立定義,不要混用。"""
    results = _last_contact_result_by_landowner(db, project_id, before)
    landowner_ids = set(db.scalars(select(Landowner.id).where(Landowner.project_id == project_id)).all())
    agreed_ids = {lid for lid in landowner_ids if results.get(lid) == "agreed"}
    opposed_ids = {lid for lid in landowner_ids if results.get(lid) == "opposed"}

    def _sum_land(ids: set[int]) -> float:
        if not ids:
            return 0.0
        return float(
            db.scalar(
                select(func.coalesce(func.sum(LandRecord.owned_area_sqm), 0)).where(
                    LandRecord.project_id == project_id, LandRecord.landowner_id.in_(ids)
                )
            )
            or 0
        )

    def _sum_building(ids: set[int]) -> float:
        if not ids:
            return 0.0
        return float(
            db.scalar(
                select(func.coalesce(func.sum(_OWNED_BUILDING_AREA), 0)).where(
                    BuildingRecord.project_id == project_id, BuildingRecord.landowner_id.in_(ids)
                )
            )
            or 0
        )

    return {
        "headcount_total": len(landowner_ids),
        "headcount_agreed": len(agreed_ids),
        "headcount_opposed": len(opposed_ids),
        "land_total_sqm": _sum_land(landowner_ids),
        "land_agreed_sqm": _sum_land(agreed_ids),
        "land_opposed_sqm": _sum_land(opposed_ids),
        "building_total_sqm": _sum_building(landowner_ids),
        "building_agreed_sqm": _sum_building(agreed_ids),
        "building_opposed_sqm": _sum_building(opposed_ids),
    }


def compute_visit_activity(db: Session, project_id: int, start: datetime, end: datetime | None = None) -> dict:
    """某一週區間 [start, end)(end 為 None = 到現在)「有拜訪紀錄的地主」人數:每位地主只算他在這個
    區間內最後一次的拜訪結果,分成同意 / 反對 / 其他。案件卡片「本週 vs 上週」用這個 - 看的是每週的
    拜訪成果,不是累計狀態(累計狀態是 compute_visit_breakdown,圓餅圖用);這週沒有新拜訪就是 0。
    headcount_total = 該區間內有被拜訪的地主數,其他 = total - 同意 - 反對。"""
    from models.contact_log import ContactLog

    stmt = select(ContactLog).where(ContactLog.project_id == project_id, ContactLog.contact_date >= start)
    if end is not None:
        stmt = stmt.where(ContactLog.contact_date < end)
    logs = db.scalars(stmt.order_by(ContactLog.contact_date.asc(), ContactLog.id.asc())).all()
    landowner_ids = set(db.scalars(select(Landowner.id).where(Landowner.project_id == project_id)).all())
    latest: dict[int, str] = {}
    for log in logs:
        if log.landowner_id in landowner_ids:
            latest[log.landowner_id] = log.contact_result
    return {
        "headcount_total": len(latest),
        "headcount_agreed": sum(1 for r in latest.values() if r == "agreed"),
        "headcount_opposed": sum(1 for r in latest.values() if r == "opposed"),
    }


def phase_of_stage(current_stage: int) -> str:
    """案件卡片 / 關鍵指標依目前關卡切換統計:第0~2關 = visit(地主拜訪)、第3~4關 = willingness
    (第4關意願書簽署)、第5關起 = contract(第8關合約簽約)。"""
    return "contract" if current_stage >= 5 else "willingness" if current_stage >= 3 else "visit"


def compute_phase_activity(db: Session, project_id: int, phase: str, start: datetime, end: datetime | None = None) -> dict:
    """意願書 / 合約階段的「某一週」統計(區間 [start, end),end=None 到現在):
    new_signed = 這週新簽的人數、cum_signed = 到區間結束為止累計已簽、unsigned = 到區間結束為止還沒簽、total = 地主總數。
    意願書:每位地主「第一份意願書的上傳時間」當作簽署時間。合約:SOP 第8關「簽約階段」同意記錄
    (consent_records,sop_stage=8、狀態=agreed)的記錄時間當作簽約時間(地主資料頁直接改簽約狀態
    不會留時間,所以不算在週統計裡)。"""
    from models.consent_record import ConsentRecord
    from models.document import Document

    ids = set(db.scalars(select(Landowner.id).where(Landowner.project_id == project_id)).all())
    first: dict[int, datetime] = {}
    if phase == "willingness":
        rows = db.execute(
            select(Document.landowner_id, func.min(Document.uploaded_at)).where(
                Document.project_id == project_id, Document.doc_type == "willingness_form", Document.landowner_id.isnot(None)
            ).group_by(Document.landowner_id)
        ).all()
    else:
        rows = db.execute(
            select(ConsentRecord.landowner_id, func.min(ConsentRecord.recorded_at)).where(
                ConsentRecord.project_id == project_id, ConsentRecord.sop_stage == 8, ConsentRecord.consent_status == "agreed"
            ).group_by(ConsentRecord.landowner_id)
        ).all()
    for lid, t in rows:
        if lid in ids and t is not None:
            first[lid] = t
    new_signed = sum(1 for t in first.values() if t >= start and (end is None or t < end))
    cum = sum(1 for t in first.values() if end is None or t < end)
    return {"phase": phase, "new_signed": new_signed, "cum_signed": cum, "unsigned": len(ids) - cum, "total": len(ids)}


def week_activity_for_stage(db: Session, project_id: int, current_stage: int, start: datetime, end: datetime | None = None) -> dict:
    phase = phase_of_stage(current_stage)
    if phase == "visit":
        return {**compute_visit_activity(db, project_id, start, end), "phase": "visit"}
    return compute_phase_activity(db, project_id, phase, start, end)


def take_daily_consent_snapshots(db: Session) -> int:
    """替每個案件存一筆「今天」的拜訪同意快照,同一天同案件已經存過就跳過(idempotent,
    背景排程每天觸發、重跑或手動補跑都不會存出重複的一天)。給案件卡片「本週 vs
    上週」比較用 - 沒有這張表就沒有真正的歷史資料可比,不能用回推算的假裝。回傳
    這次新增了幾筆。"""
    today = date.today()
    created = 0
    for project_id in db.scalars(select(Project.id)).all():
        exists = db.scalar(
            select(ConsentSnapshot.id).where(
                ConsentSnapshot.project_id == project_id, ConsentSnapshot.snapshot_date == today
            )
        )
        if exists:
            continue
        breakdown = compute_visit_breakdown(db, project_id)
        db.add(ConsentSnapshot(project_id=project_id, snapshot_date=today, **breakdown))
        created += 1
    if created:
        db.commit()
    return created
