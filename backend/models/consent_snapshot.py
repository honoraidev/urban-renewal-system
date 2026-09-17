from datetime import date, datetime

from sqlalchemy import Date, DateTime, Float, ForeignKey, Integer, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class ConsentSnapshot(Base):
    """案件卡片「本週 vs 上週」比較用的每日快照 —— 依樓棟視圖的拜訪結果(見
    utils/visit_consent.py,不是 SOP 關卡用的嚴格雙門檻 calculate_consent_ratio)算
    出來的同意/反對人數與持分面積,每個案件每天存一筆,由 main.py 的背景排程每天
    存一次(同一天同案件只存一筆,重跑不會重複)。"""

    __tablename__ = "consent_snapshots"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    snapshot_date: Mapped[date] = mapped_column(Date, nullable=False)
    headcount_total: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    headcount_agreed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    headcount_opposed: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    land_total_sqm: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    land_agreed_sqm: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    land_opposed_sqm: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    building_total_sqm: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    building_agreed_sqm: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    building_opposed_sqm: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    __table_args__ = (UniqueConstraint("project_id", "snapshot_date", name="uq_consent_snapshot_project_date"),)
