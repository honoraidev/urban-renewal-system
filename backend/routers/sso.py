"""統一登入(company-sso)OIDC 客戶端。

  GET  /auth/sso/enabled     前端問「要不要顯示 SSO 登入按鈕」
  GET  /auth/sso/login       產生 state + PKCE,導去 company-sso 的 /oauth/authorize
  GET  /auth/sso/callback    拿 code 換 token、驗簽、對到本地 user、發本系統 JWT
  POST /auth/sso/backchannel company-sso 通知角色變更 / 停權(HMAC 簽章)

SSO_ENABLED=false(預設)時全部回 404,原本的帳密登入完全不受影響。
本地 users.username == company-sso 的 employee_no(都是 chengshi_employees 的工號)。
role 直接吃 company-sso access_token 的 roles claim(角色代碼與本系統 enum 一致)。
"""
import base64
import hashlib
import hmac
import json
import secrets
import time
from datetime import datetime, timezone
from urllib.parse import urlencode

import httpx
import jwt
from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse, RedirectResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from config import settings
from database import get_db
from models.user import User
from security import create_access_token, hash_password

router = APIRouter(prefix="/auth/sso", tags=["sso"])

_TX_COOKIE = "sso_tx"
# 由高權限到低權限;roles claim 可能有多個,取最高的那個對到本系統的單一 role
_ROLE_PRIORITY = ["sys_admin", "manager", "ocr_staff", "case_owner", "case_staff", "viewer", "landowner"]
_jwks_client: jwt.PyJWKClient | None = None


def _enabled() -> bool:
    return bool(settings.SSO_ENABLED and settings.SSO_ISSUER and settings.SSO_CLIENT_ID)


def _jwks() -> jwt.PyJWKClient:
    global _jwks_client
    if _jwks_client is None:
        _jwks_client = jwt.PyJWKClient(f"{settings.SSO_ISSUER}/.well-known/jwks.json")
    return _jwks_client


def _s256(v: str) -> str:
    return base64.urlsafe_b64encode(hashlib.sha256(v.encode()).digest()).rstrip(b"=").decode()


def _bounce(fragment: str):
    return RedirectResponse(f"{settings.SSO_POST_LOGIN_URL}#{fragment}", status_code=302)


@router.get("/enabled")
def sso_enabled():
    return {"enabled": _enabled()}


@router.get("/login")
def sso_login():
    if not _enabled():
        return JSONResponse({"detail": "sso_disabled"}, status_code=404)
    state = secrets.token_urlsafe(16)
    verifier = secrets.token_urlsafe(48)
    tx = jwt.encode(
        {"st": state, "cv": verifier, "exp": int(time.time()) + 300},
        settings.JWT_SECRET, algorithm="HS256",
    )
    params = {
        "response_type": "code",
        "client_id": settings.SSO_CLIENT_ID,
        "redirect_uri": settings.SSO_REDIRECT_URI,
        "scope": "openid profile urban_renewal",
        "state": state,
        "code_challenge": _s256(verifier),
        "code_challenge_method": "S256",
    }
    resp = RedirectResponse(
        f"{settings.SSO_ISSUER}/oauth/authorize?{urlencode(params)}", status_code=302
    )
    resp.set_cookie(_TX_COOKIE, tx, max_age=300, httponly=True, samesite="lax", path="/")
    return resp


@router.get("/callback")
def sso_callback(request: Request, db: Session = Depends(get_db)):
    if not _enabled():
        return JSONResponse({"detail": "sso_disabled"}, status_code=404)

    if request.query_params.get("error"):
        return _bounce("sso_error=" + request.query_params["error"])

    code = request.query_params.get("code")
    state = request.query_params.get("state")
    tx_raw = request.cookies.get(_TX_COOKIE)
    if not code or not tx_raw:
        return _bounce("sso_error=missing_code")
    try:
        tx = jwt.decode(tx_raw, settings.JWT_SECRET, algorithms=["HS256"])
    except jwt.PyJWTError:
        return _bounce("sso_error=bad_tx")
    if tx.get("st") != state:
        return _bounce("sso_error=state_mismatch")

    try:
        r = httpx.post(
            f"{settings.SSO_ISSUER}/oauth/token",
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": settings.SSO_REDIRECT_URI,
                "client_id": settings.SSO_CLIENT_ID,
                "client_secret": settings.SSO_CLIENT_SECRET,
                "code_verifier": tx["cv"],
            },
            timeout=10,
        )
    except httpx.HTTPError:
        return _bounce("sso_error=token_endpoint_unreachable")
    if r.status_code != 200:
        return _bounce("sso_error=token_exchange_failed")
    tok = r.json()

    try:
        id_claims = jwt.decode(
            tok["id_token"],
            _jwks().get_signing_key_from_jwt(tok["id_token"]).key,
            algorithms=["RS256"], audience=settings.SSO_CLIENT_ID, issuer=settings.SSO_ISSUER,
        )
        at_claims = jwt.decode(
            tok["access_token"],
            _jwks().get_signing_key_from_jwt(tok["access_token"]).key,
            algorithms=["RS256"], audience="urban_renewal", issuer=settings.SSO_ISSUER,
        )
    except (jwt.PyJWTError, KeyError):
        return _bounce("sso_error=token_verify_failed")

    employee_no = id_claims.get("employee_no")
    roles = at_claims.get("roles") or []
    role = next((x for x in _ROLE_PRIORITY if x in roles), None)
    if not employee_no or role is None:
        return _bounce("sso_error=no_role")

    user = db.scalar(select(User).where(User.username == employee_no))
    if user is None:
        user = User(
            username=employee_no,
            password_hash=hash_password(secrets.token_urlsafe(16)),  # 佔位,SSO 帳號不走密碼
            display_name=id_claims.get("name") or employee_no,
            role=role,
            is_active=True,
        )
        db.add(user)
    else:
        user.role = role
        if id_claims.get("name"):
            user.display_name = id_claims["name"]
        user.is_active = True
    user.last_login_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(user)

    app_token = create_access_token(user.id, user.role)
    resp = _bounce("sso_token=" + app_token)
    resp.delete_cookie(_TX_COOKIE, path="/")
    return resp


@router.post("/backchannel")
async def sso_backchannel(request: Request, db: Session = Depends(get_db)):
    if not _enabled():
        return JSONResponse({"detail": "sso_disabled"}, status_code=404)
    raw = await request.body()
    # TODO: 改用 register-client 發的專用簽章金鑰;目前 HMAC key = client_id
    expect = "sha256=" + hmac.new(settings.SSO_CLIENT_ID.encode(), raw, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(request.headers.get("X-SSO-Signature", ""), expect):
        return JSONResponse({"detail": "bad_signature"}, status_code=403)

    ev = json.loads(raw or b"{}")
    emp, typ = ev.get("employee_no"), ev.get("type")
    if not emp:
        return {"ok": True}
    user = db.scalar(select(User).where(User.username == emp))
    if user is None:
        return {"ok": True}

    if typ == "roles_changed":
        roles = ev.get("roles") or []
        r = next((x for x in _ROLE_PRIORITY if x in roles), None)
        if r:
            user.role = r
        else:
            user.is_active = False  # 這系統的角色被清光 = 停用
    elif typ == "user_suspended":
        user.is_active = False
    elif typ == "user_reactivated":
        user.is_active = True
    db.commit()
    return {"ok": True}
