from datetime import datetime

from sqlalchemy import DateTime, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class LoginLog(Base):
    __tablename__ = "login_logs"

    # user_id has deliberately NO foreign key: an FK to users(id) makes every
    # login_logs INSERT take a shared lock on that user's row, which races with the
    # `UPDATE users SET last_login_at` in login() and deadlocks (error 1213) when the
    # same user logs in concurrently. Append-only log; a dangling user_id is harmless.
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(Integer, nullable=False)
    action: Mapped[str] = mapped_column(String(10), nullable=False)
    occurred_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    ip_address: Mapped[str | None] = mapped_column(String(45), nullable=True)
