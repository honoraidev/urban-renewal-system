from datetime import date, datetime

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, Text, func
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
    # 標記「重要」的待辦才會出現在全站頂端的鈴鐺提醒(見 routers/dashboard.py
    # get_today_important) - 一般行事曆備註太多了,全部推播會沒人想看。
    is_important: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # 案件總覽「待辦事項」歸在哪一關(SOP 關卡編號,絕對值) - NULL = 沒指定,歸在「這階段」。
    sop_stage: Mapped[int | None] = mapped_column(Integer, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
