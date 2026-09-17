from datetime import date, datetime

from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, Text, Boolean, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class Project(Base):
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_code: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    address: Mapped[str | None] = mapped_column(String(255), nullable=True)
    city: Mapped[str | None] = mapped_column(String(50), nullable=True)
    district: Mapped[str | None] = mapped_column(String(100), nullable=True)
    # 案件類型(如「都市更新(權利變換)」「都市更新(協議合建)」「危老重建」) - 純標記
    # 顯示用,不影響任何流程邏輯。給「開發流程」頁頂部的案件資訊列用。
    case_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="active")
    current_stage: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    is_force_closed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 案件總覽頁的簡介段落 - 跟上面 description(標題列後面的短標籤)是不同東西,
    # 這個是給總覽頁「案件簡介」卡片用的多行文字。
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 案件總覽頁封面圖的磁碟路徑(跟 Document.file_path 同一套存法,見
    # utils/file_storage.py) - None 代表沒上傳過封面圖。
    cover_image_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # 手動填寫的預計完成日 - 沒有任何自動排程或關卡日期資料可推算,純粹讓承辦人自己
    # 估一個日期,供進度報表的簡化時程進度條跟「預計完成日」欄位使用。
    expected_completion_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    members: Mapped[list["ProjectMember"]] = relationship(back_populates="project", cascade="all, delete-orphan")

    @property
    def has_cover_image(self) -> bool:
        """ProjectRead(from_attributes=True) 讀這個 property 算出 has_cover_image,
        不直接把磁碟路徑(cover_image_path)曝露給前端 - 前端只需要知道「有沒有」,
        真正的圖用 GET /projects/{id}/cover-image 拿。"""
        return self.cover_image_path is not None


class ProjectMember(Base):
    __tablename__ = "project_members"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id", ondelete="CASCADE"), nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    role_in_project: Mapped[str] = mapped_column(String(50), nullable=False, default="case_staff")
    assigned_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    project: Mapped["Project"] = relationship(back_populates="members")
