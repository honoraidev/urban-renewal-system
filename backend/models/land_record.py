from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Integer, Numeric, String, func
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
    ltt_current_value: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)
    ltt_holding_years: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # 台灣地區消費者物價總指數(以前次移轉/原規定地價那期為基期 100)。漲價總數額 =
    # 申報現值 − 原地價 × 指數/100。未填時視為 100(不調整)。
    ltt_cpi_index: Mapped[float | None] = mapped_column(Numeric(8, 2), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    landowner: Mapped["Landowner"] = relationship(back_populates="land_records")
