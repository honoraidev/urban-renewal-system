from datetime import datetime

from pydantic import BaseModel


class ObligorEntry(BaseModel):
    name: str
    numerator: str | None = None
    denominator: str | None = None


class EncumbranceCreate(BaseModel):
    applies_to_parcels: str | None = None
    parcel_kind: str | None = None  # "land" | "building" | None
    property_address: str | None = None
    registration_order: str | None = None
    right_type: str | None = None
    right_holder: str | None = None
    # debtor_info:舊式單一整體比例文字 - OCR 謄本匯入精靈(見 ocr_wizard.js
    # readEncumbranceRows)還在用這個欄位,沒有人名可對,保留讓那條路徑繼續能用。
    # 有名字的義務人一律走 obligors。
    debtor_info: str | None = None
    obligors: list[ObligorEntry] | None = None
    secured_amount: int | None = None


class EncumbranceUpdate(BaseModel):
    applies_to_parcels: str | None = None
    parcel_kind: str | None = None
    property_address: str | None = None
    registration_order: str | None = None
    right_type: str | None = None
    right_holder: str | None = None
    debtor_info: str | None = None
    obligors: list[ObligorEntry] | None = None
    secured_amount: int | None = None


class EncumbranceRead(BaseModel):
    id: int
    project_id: int
    applies_to_parcels: str | None = None
    parcel_kind: str | None = None
    property_address: str | None = None
    registration_order: str | None = None
    right_type: str | None = None
    right_holder: str | None = None
    debtor_info: str | None = None
    obligors: list[ObligorEntry] | None = None
    secured_amount: int | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
