import json

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from deps import get_current_user
from models.user import User
from models.user_pref import UserPref

router = APIRouter(prefix="/me/prefs", tags=["prefs"])

# 只允許這幾個 key,避免被拿來當任意儲存空間
ALLOWED_KEYS = {"bellReadIds", "bellHiddenIds", "faqAiHistory", "annReadIds"}
MAX_BYTES = 300_000


class PrefBody(BaseModel):
    value: object


def _check_key(key: str) -> None:
    if key not in ALLOWED_KEYS:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unknown pref key")


@router.get("/{key}")
def get_pref(key: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _check_key(key)
    row = db.get(UserPref, (current_user.id, key))
    if row is None:
        return {"value": None, "updated_at": None}
    try:
        value = json.loads(row.value)
    except ValueError:
        value = None
    return {"value": value, "updated_at": row.updated_at.isoformat() if row.updated_at else None}


@router.put("/{key}")
def put_pref(key: str, body: PrefBody, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _check_key(key)
    text = json.dumps(body.value, ensure_ascii=False)
    if len(text.encode("utf-8")) > MAX_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Pref value too large")
    row = db.get(UserPref, (current_user.id, key))
    if row is None:
        db.add(UserPref(user_id=current_user.id, pref_key=key, value=text))
    else:
        row.value = text
    db.commit()
    return {"ok": True}
