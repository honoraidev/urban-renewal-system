from datetime import datetime

from pydantic import BaseModel


class DocumentRead(BaseModel):
    id: int
    project_id: int
    landowner_id: int | None = None
    folder_id: int | None = None
    doc_type: str
    file_name: str
    file_size_bytes: int
    mime_type: str | None = None
    uploaded_by: int | None = None
    uploaded_at: datetime
    description: str | None = None

    model_config = {"from_attributes": True}


class DocumentFolderRead(BaseModel):
    id: int
    project_id: int
    parent_id: int | None = None
    name: str
    code: str | None = None
    sort_order: int

    model_config = {"from_attributes": True}


class DocumentFolderCreate(BaseModel):
    name: str
    parent_id: int | None = None


class DocumentFolderUpdate(BaseModel):
    name: str | None = None
    parent_id: int | None = None
    sort_order: int | None = None
