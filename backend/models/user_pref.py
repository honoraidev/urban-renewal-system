from datetime import datetime

from sqlalchemy import DateTime, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class UserPref(Base):
    """每位使用者的小型偏好 / 個人狀態(鈴鐺已讀與刪除清單、知識庫 AI 問答對話記錄...),
    存 JSON 文字。故意不對 users 加外鍵(跟 login_logs 同樣理由:避免併發寫入時的鎖等待),
    使用者被刪除後留下的孤兒列無害。"""

    __tablename__ = "user_prefs"

    user_id: Mapped[int] = mapped_column(primary_key=True)
    pref_key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
