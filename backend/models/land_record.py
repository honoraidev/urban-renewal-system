from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, Numeric, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base

if TYPE_CHECKING:
    from models.landowner import Landowner


class LandRecord(Base):
    __tablename__ = "land_records"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    landowner_id: Mapped[int | None] = mapped_column(ForeignKey("landowners.id", ondelete="SET NULL"), nullable=True)
    source_ocr_job_id: Mapped[int | None] = mapped_column(ForeignKey("ocr_jobs.id", ondelete="SET NULL"), nullable=True)
    parcel_number: Mapped[str] = mapped_column(String(100), nullable=False)
    township: Mapped[str | None] = mapped_column(String(50), nullable=True)
    section: Mapped[str | None] = mapped_column(String(100), nullable=True)
    subsection: Mapped[str | None] = mapped_column(String(100), nullable=True)
    registration_order: Mapped[str | None] = mapped_column(String(50), nullable=True)
    # 「相關他項權利登記次序」printed under this owner in the 所有權部 (comma-separated,
    # e.g. "0004-000"). Empty/NULL means this owner carries no 他項權利, so the roster
    # export leaves their 土地他項權利部 columns blank instead of copying the parcel's.
    related_encumbrance_orders: Mapped[str | None] = mapped_column(String(255), nullable=True)
    total_area_sqm: Mapped[float] = mapped_column(Numeric(12, 2), nullable=False, default=0)
    ownership_numerator: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    ownership_denominator: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    # DB-generated (GENERATED ALWAYS AS ... STORED in schema.sql). Never assign these from
    # application code - MariaDB rejects any explicit value (including NULL) for such columns.
    owned_area_sqm: Mapped[float] = mapped_column(Numeric(14, 4), nullable=True)
    ownership_share_pct: Mapped[float] = mapped_column(Numeric(12, 6), nullable=True)
    # Inputs for the 土增稅(land value increment tax) general-rate estimate - both are
    # total NT$ amounts (not per-sqm unit prices), matching how they're written on an
    # official tax notice, so staff can copy them in directly without doing their own
    # area math first. See utils/land_value_tax.py for the calculation itself.
    ltt_original_value: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)
    # Free text as printed on the deed (usually Minguo calendar, e.g. "113年01月") -
    # not parsed into a real date, since OCR only ever has the printed string to go on
    # and a wrong calendar-conversion guess would be worse than just keeping the text.
    ltt_original_value_period: Mapped[str | None] = mapped_column(String(50), nullable=True)
    # 謄本上「前次移轉現值或原規定地價」原始的全部歷史記錄(同一筆地,每次移轉都會多一筆),
    # 例如 [{"period": "090年05月", "value_per_sqm": 113000, "value": 24567800}, ...]。
    # ltt_original_value/_period 只存系統挑出的最新一筆(供土增稅試算用);這個欄位純粹是
    # 給編輯畫面顯示參考、供人工核對系統挑的是不是真的最新一筆,不參與稅額計算。
    ltt_original_value_history: Mapped[list | None] = mapped_column(JSON, nullable=True)
    ltt_current_value: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)
    # 當期公告土地現值的年期標籤(如「115年」),純顯示用,跟 ltt_original_value_period
    # 是同樣的自由文字慣例 - 填了 ltt_current_value 之後,「土增稅」頁的「本月申報移轉
    # 現值」就直接讀這裡,不用在稅額試算頁另外手打一次。
    ltt_current_value_period: Mapped[str | None] = mapped_column(String(50), nullable=True)
    ltt_holding_years: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # 台灣地區消費者物價總指數(以前次移轉/原規定地價那期為基期 100)。漲價總數額 =
    # 申報現值 − 原地價 × 指數/100。未填時視為 100(不調整)。
    ltt_cpi_index: Mapped[float | None] = mapped_column(Numeric(8, 2), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    landowner: Mapped["Landowner"] = relationship(back_populates="land_records")
