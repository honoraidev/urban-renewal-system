from datetime import datetime

from sqlalchemy import DateTime
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class NewsSyncState(Base):
    """單一列(固定 id=1)記錄「每日新聞抓取」上次實際執行的時間,給新聞頁面右上角
    顯示同步時間用。fetch_and_store_news 每次執行完(不管有沒有抓到新資料)都會更新
    這一列,所以這個時間代表「最後一次嘗試同步」,不是「最後一次抓到新聞」。"""

    __tablename__ = "news_sync_state"

    id: Mapped[int] = mapped_column(primary_key=True)
    last_synced_at: Mapped[datetime] = mapped_column(DateTime, nullable=False)
