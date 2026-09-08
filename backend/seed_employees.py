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

_LEAD_KEYWORDS = ("經理", "副理", "襄理", "協理", "主任", "組長", "主委", "副所長", "所長")

# chengshi_employees.department_id → 部門名稱(來源表只有 id,名稱取自組織清單)。
DEPT_NAMES = {
    "co1-d01": "董事長室", "co1-d02": "顧問室", "co1-d03": "AI部", "co1-d04": "都更事業處",
    "co1-d05": "都更部", "co1-d06": "整合行銷部", "co1-d07": "業務開發處", "co1-d08": "業務部",
    "co1-d09": "售後服務部", "co1-d10": "財務會計處", "co1-d11": "人資部與法務部",
    "co1-d12": "總務部與資訊部", "co1-d13": "數位管理部",
    "co2-d14": "採購發包部", "co2-d15": "成本控制部", "co2-d16": "機電部",
    "co2-d17": "工務部（43工務組）", "co2-d18": "圖說管理部",
    "co3-d19": "甜點餐飲處", "co3-d20": "吧檯部", "co3-d21": "甜點部", "co3-d22": "銷售處",
    "co3-d23": "70銷售組", "co3-d24": "43銷售組", "co3-d25": "900銷售組",
    "co4-d26": "桃園都更事業處", "co4-d27": "園藝顧問室", "co4-d28": "園藝部",
}


def role_for(employee_no: str, company_id: str, title: str, is_hr_admin: int) -> str:
    """職稱 → 系統角色(內部代號)。對應:
        sys_admin  = L0 系統管理員(DEMO)  ← 只有 admin 帳號,員工不會是這個
        manager    = L1 管理層            董事長 / 董事長特助 / 秘書
        ocr_staff  = L2 都更主管          都更事業處執行長
        case_owner = L3 案件負責人        都更高級專員 / 土地開發高級專員
        case_staff = L4 案件工作人員      其他主管級(經理/副理/襄理/協理/主任/組長/主委/所長)
        viewer     = L5 查詢/檢視人員     其餘所有員工
    """
    if employee_no in ("SYS-001", "SYS-002", "SYS-003"):   # 董事長 / 特助 / 秘書
        return "manager"                                    # L1 管理層
    if "都更事業處執行長" in title or title == "執行長":
        return "ocr_staff"                                  # L2 都更主管
    if "都更高級專員" in title or "土地開發高級專員" in title or employee_no == "SYS-006":
        return "case_owner"                                 # L3 案件負責人
    if any(k in title for k in _LEAD_KEYWORDS):
        return "case_staff"                                 # L4 其他主管級
    return "viewer"                                         # L5 剩餘員工


def main() -> None:
    commit = "--commit" in sys.argv
    # 一次性:把既有 SYS-* 帳號的 role 依 role_for 重新套用(角色分層改制時用)。
    # 不會動到非 SYS-* 帳號(admin 等)。
    reassign = "--reassign-roles" in sys.argv

    conn = pymysql.connect(**SRC)
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cur:
            cur.execute(
                "SELECT employee_no, name, title, company_id, department_id, is_hr_admin "
                "FROM chengshi_employees ORDER BY employee_no"
            )
            employees = cur.fetchall()
    finally:
        conn.close()

    db = SessionLocal()
    created = updated = 0
    by_role: dict[str, int] = {}
    try:
        for e in employees:
            username = (e["employee_no"] or "").strip()
            if not username:
                continue
            role = role_for(username, e["company_id"], e["title"] or "", e["is_hr_admin"])
            by_role[role] = by_role.get(role, 0) + 1
            dept = DEPT_NAMES.get(e["department_id"])
            depts = [dept] if dept else None
            titles = [e["title"]] if e["title"] else None

            exists = db.query(User).filter(User.username == username).first()
            if exists is not None:
                # 已存在:補「部門 / 職位」,不動密碼 / 顯示名稱。role 只在 --reassign-roles 時才覆蓋。
                changed = []
                if reassign and exists.role != role:
                    changed.append(f"角色 {exists.role}→{role}")
                    exists.role = role
                if not exists.departments and depts:
                    exists.departments = depts
                    changed.append(f"部門={dept}")
                if not exists.titles and titles:
                    exists.titles = titles
                    changed.append(f"職位={titles[0]}")
                if changed:
                    updated += 1
                    print(f"  upd   {username:10} {e['name']:6} {', '.join(changed)}")
                else:
                    print(f"  skip  {username:10} {e['name']}  (已有部門/職位)")
                continue

            print(f"  new   {username:10} {e['name']:6} {(e['title'] or ''):14} {dept or '-':10} -> {role}")
            if commit:
                db.add(
                    User(
                        username=username,
                        password_hash=hash_password(username),
                        display_name=e["name"],
                        role=role,
                        departments=depts,
                        titles=titles,
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
        print(f"完成:新增 {created} 筆、補部門/職位 {updated} 筆。")
    else:
        print("(預覽)未寫入。加 --commit 才會實際寫入。")


if __name__ == "__main__":
    main()
