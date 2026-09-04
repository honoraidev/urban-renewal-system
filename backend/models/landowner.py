from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base

if TYPE_CHECKING:
    from models.building_record import BuildingRecord
    from models.land_record import LandRecord


class Landowner(Base):
    __tablename__ = "landowners"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    id_number: Mapped[str | None] = mapped_column(String(20), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(30), nullable=True)
    address: Mapped[str | None] = mapped_column(String(255), nullable=True)
    contact_status: Mapped[str] = mapped_column(String(20), nullable=False, default="not_contacted")
    # Independent from contact_status (聯絡狀態 tracks "did we reach them", this tracks
    # "did they actually sign") - a landowner can be contacted/agreed verbally long before
    # a contract is signed, or vice versa in an edge case, so these shouldn't be the same field.
    agreement_status: Mapped[str] = mapped_column(String(20), nullable=False, default="not_signed")
    # Human-facing display code (e.g. "2026-001-003") - assigned once at creation from a
    # per-project counter, stored rather than computed on the fly so it stays stable even
    # if earlier landowners in the project are later deleted (no renumbering).
    roster_code: Mapped[str | None] = mapped_column(String(50), nullable=True)
    is_representative: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # 綁定的登入帳號(限 role=landowner)。地主帳號登入後只能看到 user_id = 自己 的
    # 那些 Landowner 列。由 L1~L4 於編輯地主時指定;可多對一(共有、跨案)。
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    land_records: Mapped[list["LandRecord"]] = relationship(back_populates="landowner")
    building_records: Mapped[list["BuildingRecord"]] = relationship(back_populates="landowner")
