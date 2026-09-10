from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class DocumentFolder(Base):
    """One node in a project's 案件資料 folder tree. ``parent_id`` is NULL for a
    top-level folder. Seeded standard folders carry a stable ``code`` (see
    utils/document_folders.py); folders a user adds by hand have ``code = None`` and can
    be renamed/moved/deleted freely."""

    __tablename__ = "document_folders"
    __table_args__ = (
        UniqueConstraint("project_id", "code", name="uq_document_folders_project_code"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    parent_id: Mapped[int | None] = mapped_column(
        ForeignKey("document_folders.id", ondelete="CASCADE"), nullable=True
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    code: Mapped[str | None] = mapped_column(String(50), nullable=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
