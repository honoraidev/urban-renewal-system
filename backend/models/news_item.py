from datetime import datetime

from sqlalchemy import DateTime, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class NewsItem(Base):
    """A manageable link entry for 工具與資源 → 新聞 - same shape/rationale as
    Regulation/Website: starts empty, L1/L2 add real links themselves rather than the
    app seeding possibly-stale/wrong URLs."""

    __tablename__ = "news_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    category: Mapped[str | None] = mapped_column(String(100), nullable=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    # 1000 不是 500 - Google 新聞 RSS 的轉址連結常常超過 500 字(見 utils/news_fetch.py),
    # 存不下會被截斷成打不開的網址,還會讓兩篇不同文章的截斷結果巧合相同、去重誤判。
    url: Mapped[str] = mapped_column(String(1000), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
