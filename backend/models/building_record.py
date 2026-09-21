from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, Numeric, String, event, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base

if TYPE_CHECKING:
    from models.landowner import Landowner


class BuildingRecord(Base):
    __tablename__ = "building_records"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    landowner_id: Mapped[int | None] = mapped_column(ForeignKey("landowners.id", ondelete="SET NULL"), nullable=True)
    land_record_id: Mapped[int | None] = mapped_column(ForeignKey("land_records.id", ondelete="SET NULL"), nullable=True)
    source_ocr_job_id: Mapped[int | None] = mapped_column(ForeignKey("ocr_jobs.id", ondelete="SET NULL"), nullable=True)
    building_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # 主要用途(建物標示部)。"共有部分" 代表這是一筆共有部分建號(樓梯間/公設),
    # 沒有建物所有權部、landowner_id 為 NULL,持分靠 common_part_shares 分給各主建物。
    main_use: Mapped[str | None] = mapped_column(String(50), nullable=True)
    # 只在 main_use=="共有部分" 的 record 上有值:這筆共有部分被哪些主建物分持。
    # [{"building_number": "01899-000", "numerator": 1252, "denominator": 10000}, …]
    common_part_shares: Mapped[list | None] = mapped_column(JSON, nullable=True)
    # 建物坐落地號 (from the deed's 「建物坐落地號」) - kept on the record itself so the
    # 地主清冊 can join a building to the right 地號 row even when land_record_id wasn't
    # resolved at import time.
    parcel_number: Mapped[str | None] = mapped_column(String(100), nullable=True)
    address: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # 「原謄本門牌地址」— 謄本匯入時的門牌,之後就算有人改了上面的 address 也不會跟著變
    # (見檔尾兩個 event:新增時自動帶入 address;address 第一次被改掉時把舊值存下來)。
    # 舊資料這欄是 NULL,顯示端一律 `original_address or address`。
    original_address: Mapped[str | None] = mapped_column(String(255), nullable=True)
    floor: Mapped[str | None] = mapped_column(String(20), nullable=True)
    total_floors: Mapped[str | None] = mapped_column(String(50), nullable=True)
    registration_order: Mapped[str | None] = mapped_column(String(50), nullable=True)
    # 建物所有權部「相關他項權利登記次序」(逗號分隔);空 = 這位所有權人沒有他項權利
    related_encumbrance_orders: Mapped[str | None] = mapped_column(String(255), nullable=True)
    structure_area_sqm: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    auxiliary_area_sqm: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    common_area_sqm: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    # Computed by application code at write time (not a SQL GENERATED column).
    total_area_sqm: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    ownership_numerator: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    ownership_denominator: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    ownership_share_pct: Mapped[float] = mapped_column(Numeric(12, 6), nullable=False, default=0)
    # Per-floor / per-accessory breakdown straight from the deed's 建物標示部, so the
    # 地主清冊 can drop each area into its own column (層次面積 1F..7F, 附屬建物 平台/陽臺…).
    # [{"floor": "二層", "area_sqm": 94.46}, …] / [{"use": "陽臺", "area_sqm": 14.45}, …]
    floors_detail: Mapped[list | None] = mapped_column(JSON, nullable=True)
    accessories_detail: Mapped[list | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    landowner: Mapped["Landowner"] = relationship(back_populates="building_records")


@event.listens_for(BuildingRecord, "before_insert")
def _fill_original_address(mapper, connection, target):
    if target.original_address is None and target.address:
        target.original_address = target.address


@event.listens_for(BuildingRecord.address, "set", active_history=True)
def _keep_original_address(target, value, oldvalue, initiator):
    # 已存在的紀錄第一次被改地址:把改之前的值(= 謄本原本的門牌)留下來。
    if target.original_address is None and isinstance(oldvalue, str) and oldvalue and oldvalue != value:
        target.original_address = oldvalue
