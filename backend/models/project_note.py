from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class ProjectNote(Base):
    """手動補充的案件公告/跟進事項 — 案件標題旁「公告」面板裡,使用者自己填的那一半
    (另一半是 activity_logs 自動記錄的地主/文件/費用等異動)。author_id 跟
    ActivityLog.user_id 一樣刻意不設外鍵,理由相同(見 activity_log.py)。"""

    __tablename__ = "project_notes"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    author_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    occurred_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
