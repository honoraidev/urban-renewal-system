from datetime import datetime

from sqlalchemy import BigInteger, Boolean, DateTime, Integer, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class CompanyDocument(Base):
    """Company-wide document templates, not tied to any single project - see
    models/document.py's Document for the per-project equivalent."""

    __tablename__ = "company_documents"

    id: Mapped[int] = mapped_column(primary_key=True)
    category: Mapped[str | None] = mapped_column(String(100), nullable=True)
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_path: Mapped[str] = mapped_column(String(500), nullable=False)
    file_size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    mime_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    uploaded_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 適用分部:all(兩邊共用,舊文件預設)/ taoyuan(桃園)/ taipei(台北)。NULL 視同 all。
    # 版本:同一個檔名(分部-分類名稱)重複上傳時,新檔成為目前版本(is_latest=1),舊檔保留為歷史版本(is_latest=0)
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    is_latest: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    branch: Mapped[str | None] = mapped_column(String(10), nullable=True, default="all")
