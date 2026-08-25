from datetime import datetime

from pydantic import BaseModel


class CompanyDocumentRead(BaseModel):
    id: int
    category: str | None = None
    file_name: str
    file_size_bytes: int
    mime_type: str | None = None
    uploaded_by: int | None = None
    uploaded_by_name: str | None = None
    uploaded_at: datetime
    description: str | None = None

    model_config = {"from_attributes": True}


class RegulationCreate(BaseModel):
    category: str | None = None
    name: str
    url: str
    description: str | None = None


class RegulationUpdate(BaseModel):
    category: str | None = None
    name: str | None = None
    url: str | None = None
    description: str | None = None


class RegulationRead(BaseModel):
    id: int
    category: str | None = None
    name: str
    url: str
    description: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class WebsiteCreate(BaseModel):
    category: str | None = None
    name: str
    url: str
    description: str | None = None


class WebsiteUpdate(BaseModel):
    category: str | None = None
    name: str | None = None
    url: str | None = None
    description: str | None = None


class WebsiteRead(BaseModel):
    id: int
    category: str | None = None
    name: str
    url: str
    description: str | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class FaqItemCreate(BaseModel):
    category: str | None = None
    question: str
    answer: str


class FaqItemUpdate(BaseModel):
    category: str | None = None
    question: str | None = None
    answer: str | None = None


class FaqItemRead(BaseModel):
    id: int
    category: str | None = None
    question: str
    answer: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
