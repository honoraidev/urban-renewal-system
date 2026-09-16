from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, JSON, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class Encumbrance(Base):
    __tablename__ = "encumbrances"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    applies_to_parcels: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # "land"(地號)或 "building"(建號) - 分辨 applies_to_parcels 存的是哪一種;
    # 舊資料沒有這欄,顯示時不分類。
    parcel_kind: Mapped[str | None] = mapped_column(String(20), nullable=True)
    property_address: Mapped[str | None] = mapped_column(String(255), nullable=True)
    registration_order: Mapped[str | None] = mapped_column(String(50), nullable=True)
    right_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    right_holder: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # 舊資料的單一整體債務額比例(如「3分之1」,沒有對應人名) - 新資料改用 obligors
    # 存多位義務人各自的比例,這欄保留供舊紀錄顯示,新建/編輯不再寫入。
    debtor_info: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 義務人(提供擔保的人,通常是地主/債務人本人) - 一筆他項權利可能有多位共同擔保,
    # 每位各自的債務額比例不同。[{"name": str, "numerator": str, "denominator": str}]
    obligors: Mapped[list | None] = mapped_column(JSON, nullable=True)
    # 擔保債權總金額(新臺幣元)
    secured_amount: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
