from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class ActivityLog(Base):
    """Audit trail of every mutating request (POST/PATCH/PUT/DELETE) that succeeded -
    written by the activity-logging middleware, not by individual endpoints. Backs the
    personal work board's 今日操作紀錄 feed ("which button changed what today")."""

    __tablename__ = "activity_logs"

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    project_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    method: Mapped[str] = mapped_column(String(10), nullable=False)
    path: Mapped[str] = mapped_column(String(500), nullable=False)
    action: Mapped[str] = mapped_column(String(120), nullable=False)
    status_code: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
