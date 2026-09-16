from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class Document(Base):
    __tablename__ = "documents"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    landowner_id: Mapped[int | None] = mapped_column(ForeignKey("landowners.id", ondelete="SET NULL"), nullable=True)
    folder_id: Mapped[int | None] = mapped_column(
        ForeignKey("document_folders.id", ondelete="SET NULL"), nullable=True
    )
    # SOP 關卡的「相關檔案」一般附件區用(跟靠 doc_type 比對的關卡自動門檻文件是
    # 兩回事,見 routers/sop.py)- 存關卡在 stage_data.stages 裡的陣列位置(int)。
    sop_stage: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # 開發流程(結案後的後續開發關卡,見 routers/development.py)的「相關文件」一般
    # 附件區用,跟 sop_stage 是兩個獨立的標記,分別對應 SOP 跟開發流程各自的關卡。
    dev_stage: Mapped[int | None] = mapped_column(Integer, nullable=True)
    doc_type: Mapped[str] = mapped_column(String(30), nullable=False, default="other")
    file_name: Mapped[str] = mapped_column(String(255), nullable=False)
    file_path: Mapped[str] = mapped_column(String(500), nullable=False)
    file_size_bytes: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    mime_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    uploaded_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
