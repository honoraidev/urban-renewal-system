from datetime import datetime

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserInfo(BaseModel):
    id: int
    username: str
    display_name: str
    role: str
    email: str | None = None
    phone: str | None = None
    avatar: str | None = None

    model_config = {"from_attributes": True}


class ProfileUpdate(BaseModel):
    display_name: str | None = Field(default=None, min_length=1, max_length=100)
    email: str | None = None
    phone: str | None = None
    current_password: str | None = None
    new_password: str | None = Field(default=None, min_length=1, max_length=128)
    # data:image/* base64 URI(前端壓縮後);傳空字串 "" 代表清除改回預設頭像
    avatar: str | None = Field(default=None, max_length=700_000)


class LoginLogRead(BaseModel):
    id: int
    user_id: int
    username: str
    display_name: str
    role: str
    action: str
    occurred_at: datetime
    ip_address: str | None = None

    model_config = {"from_attributes": True}
