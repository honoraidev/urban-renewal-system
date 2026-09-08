from datetime import datetime

from sqlalchemy import DateTime, Integer, Numeric, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class InventoryItem(Base):
    """部門物品管制表的一筆物品。依 department 欄位分部門檢視,不另建部門實體。
    日期一律存字串 (YYYY-MM-DD 或空字串),避免 MySQL 空日期 / 時區處理的雜訊。"""

    __tablename__ = "inventory_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    department: Mapped[str] = mapped_column(String(100), nullable=False, default="")
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    category: Mapped[str | None] = mapped_column(String(100), nullable=True)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    unit: Mapped[str | None] = mapped_column(String(20), nullable=True)
    location: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="正常")

    custodian: Mapped[str | None] = mapped_column(String(100), nullable=True)
    asset_no: Mapped[str | None] = mapped_column(String(100), nullable=True)
    acquired_date: Mapped[str | None] = mapped_column(String(20), nullable=True)
    unit_price: Mapped[float | None] = mapped_column(Numeric(12, 2), nullable=True)

    borrower: Mapped[str | None] = mapped_column(String(100), nullable=True)
    issued_date: Mapped[str | None] = mapped_column(String(20), nullable=True)
    expected_return_date: Mapped[str | None] = mapped_column(String(20), nullable=True)
    returned_date: Mapped[str | None] = mapped_column(String(20), nullable=True)

    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
