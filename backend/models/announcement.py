from datetime import datetime

from sqlalchemy import Boolean, DateTime, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class Announcement(Base):
    """系統公告(伺服器維修、功能異動...),由 L0 系統管理員在工作看板發布,所有登入者可見。
    故意不對 users 加外鍵(同 login_logs / user_prefs 的理由),發布者姓名直接存字串。"""

    __tablename__ = "announcements"

    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(120), nullable=False)
    content: Mapped[str | None] = mapped_column(Text, nullable=True)
    level: Mapped[str] = mapped_column(String(10), nullable=False, default="info")  # info / warning / urgent
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # 系統維護(選填):maint_start 到了且公告仍上架 → 非系統管理員不能登入;maint_end 只是「預計」結束時間,
    # 不會自動解除,要由管理員下架/刪除這則公告才恢復。
    maint_start: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    maint_end: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_by_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
