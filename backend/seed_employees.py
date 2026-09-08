"""一次性:把 chengshi-appraisal.chengshi_employees 的 96 位員工建成本系統帳號。

  username     = 工號 (SYS-001 … SYS-096)
  password     = 工號本身  ← 上線後務必要求員工首次登入改密碼
  display_name = 姓名
  role         = 依職稱對應 L1–L6 (見 role_for())
  email        = 無 (來源表沒有)

已存在的 username 一律跳過,不覆蓋 → 可重複執行。

用法 (在能連到本系統資料庫的環境,例如 NAS 容器內):

    # 先看會建哪些、對到什麼角色 (不寫入)
    python seed_employees.py

    # 確認無誤後實際寫入
    python seed_employees.py --commit

來源資料庫連線可用環境變數覆蓋:
    SRC_DB_HOST SRC_DB_PORT SRC_DB_USER SRC_DB_PASSWORD SRC_DB_NAME
"""

import os
import sys

import pymysql

from database import SessionLocal
from models.user import User

try:
    from security import hash_password as _hash_password
except Exception:  # noqa: BLE001
    _hash_password = None


def hash_password(plain: str) -> str:
    """優先用系統的 security.hash_password;某些環境(Windows dev venv)passlib+bcrypt
    版本不合會炸,退回直接呼叫 bcrypt 產生標準 $2b$ hash(NAS 的 passlib 可正常驗證)。"""
    if _hash_password is not None:
        try:
            return _hash_password(plain)
        except Exception:  # noqa: BLE001
            pass
    import bcrypt

    return bcrypt.hashpw(plain.encode("utf-8")[:72], bcrypt.gensalt(rounds=12)).decode("ascii")

SRC = dict(
    host=os.environ.get("SRC_DB_HOST", ""),
    port=int(os.environ.get("SRC_DB_PORT", "3306")),
    user=os.environ.get("SRC_DB_USER", ""),
    password=os.environ.get("SRC_DB_PASSWORD", ""),
    database=os.environ.get("SRC_DB_NAME", "chengshi-appraisal"),
    charset="utf8mb4",
)

_LEAD_KEYWORDS = ("經理", "副理", "襄理", "協理", "主任", "組長", "主委", "副所長")


def role_for(employee_no: str, company_id: str, title: str, is_hr_admin: int) -> str:
    """職稱 → 系統角色。規則見上方說明表。"""
    try:
        n = int(employee_no.split("-")[1])
    except (IndexError, ValueError):
        n = -1

    if employee_no == "SYS-001":            # 董事長
        return "sys_admin"
    if employee_no in ("SYS-002", "SYS-010", "SYS-036", "SYS-079") or is_hr_admin:
        return "manager"                     # 董事長特助 / 都更事業處執行長 / 數位管理部經理 / 人資
    # 與都更無關 → 只給檢視:大可廣告(co3)全部、司機、誠泰園藝(SYS-085~096)
    if company_id == "co3" or employee_no == "SYS-004" or 85 <= n <= 96:
        return "viewer"
    # 都更 / 土地開發 相關職務(含高級專員)一律 L3;高立瑜(AI負責人)個別指定 L3
    if employee_no == "SYS-006" or "都更" in title or "土地開發" in title:
        return "case_owner"
    if any(k in title for k in _LEAD_KEYWORDS):
        return "case_owner"                  # 各級幹部
    return "case_staff"                      # 其餘營造/行政/財會…的專員、工程師、行政…


def main() -> None:
    commit = "--commit" in sys.argv

    conn = pymysql.connect(**SRC)
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            cur.execute(
                "SELECT employee_no, name, title, company_id, is_hr_admin "
                "FROM chengshi_employees ORDER BY employee_no"
            )
            employees = cur.fetchall()
    finally:
        conn.close()

    db = SessionLocal()
    created = skipped = 0
    by_role: dict[str, int] = {}
    try:
        for e in employees:
            username = (e["employee_no"] or "").strip()
            if not username:
                continue
            role = role_for(username, e["company_id"], e["title"] or "", e["is_hr_admin"])
            by_role[role] = by_role.get(role, 0) + 1

            exists = db.query(User).filter(User.username == username).first()
            if exists is not None:
                skipped += 1
                print(f"  skip  {username:10} {e['name']}  (帳號已存在)")
                continue

            print(f"  new   {username:10} {e['name']:6} {e['title']:14} -> {role}")
            if commit:
                db.add(
                    User(
                        username=username,
                        password_hash=hash_password(username),
                        display_name=e["name"],
                        role=role,
                        is_active=True,
                    )
                )
                created += 1

        if commit:
            db.commit()
    finally:
        db.close()

    print("\n角色分布:", ", ".join(f"{k}={v}" for k, v in sorted(by_role.items())))
    if commit:
        print(f"完成:新增 {created} 筆、跳過 {skipped} 筆(已存在)。")
    else:
        print(f"(預覽)將新增約 {len(employees) - skipped} 筆、跳過 {skipped} 筆。加 --commit 才會實際寫入。")


if __name__ == "__main__":
    main()
