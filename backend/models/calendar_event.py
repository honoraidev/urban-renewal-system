from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Integer, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class CalendarEvent(Base):
    """A dated note on the work-board calendar ("on day X, do Y"). project_id NULL =
    private to its creator; project_id set = shared with everyone on that project."""

    __tablename__ = "calendar_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    project_id: Mapped[int | None] = mapped_column(
        ForeignKey("projects.id", ondelete="CASCADE"), nullable=True
    )
    event_date: Mapped[date] = mapped_column(Date, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
