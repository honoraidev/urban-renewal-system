from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, JSON, func
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class DevelopmentStage(Base):
    """同意度100%通過、案件結案之後的都更後續開發流程(事業計畫核定、權利變換、拆除、
    開工、交屋這類)- 跟 SopStage 是分開的兩件事,不影響 SOP 的結案判定。完全自訂,
    沒有預設關卡、沒有自動門檻,純人工按「完成本關卡」推進 - 見 routers/development.py。"""

    __tablename__ = "development_stages"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), unique=True, nullable=False)
    stage_data: Mapped[dict] = mapped_column(JSON, nullable=False)
    current_stage: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
