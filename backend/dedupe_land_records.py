"""一次性:清掉同一份土地謄本被重複匯入產生的重複 land_records。

判斷「重複」的依據是同一個案件裡,(地號數字、登記次序數字、landowner_id) 完全相同的
好幾筆——這只會發生在同一份謄本被送出匯入精靈兩次以上時(見 ocr_wizard.js 的匯入邏輯:
每次送出都是直接新增,不會檢查是否已存在同一筆)。每組重複只留 created_at 最新的一筆,
其餘刪除;刪除前會先把任何指到被刪那筆的 building_records.land_record_id 轉接到留下來的
那一筆,避免建物斷了跟地號的關聯。

用法:
    # 先看會刪哪些、留哪些(不寫入)
    python dedupe_land_records.py <project_id>

    # 確認無誤後實際刪除
    python dedupe_land_records.py <project_id> --commit
"""

import re
import sys
from collections import defaultdict

from sqlalchemy import select, update

from database import SessionLocal
from models.building_record import BuildingRecord
from models.land_record import LandRecord


def _digits(s) -> str:
    return re.sub(r"\D", "", str(s or ""))


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if not args:
        print("用法: python dedupe_land_records.py <project_id> [--commit]")
        sys.exit(1)
    project_id = int(args[0])
    commit = "--commit" in sys.argv

    db = SessionLocal()
    try:
        records = db.scalars(
            select(LandRecord).where(LandRecord.project_id == project_id).order_by(LandRecord.created_at)
        ).all()
        print(f"案件 {project_id} 土地登記總筆數:{len(records)}")

        groups: dict[tuple[str, str, int | None], list[LandRecord]] = defaultdict(list)
        for r in records:
            key = (_digits(r.parcel_number), _digits(r.registration_order), r.landowner_id)
            groups[key].append(r)

        to_delete: list[LandRecord] = []
        to_keep_by_group: dict[tuple, LandRecord] = {}
        for key, rows in groups.items():
            if len(rows) <= 1:
                continue
            survivor = max(rows, key=lambda r: r.created_at)
            to_keep_by_group[key] = survivor
            for r in rows:
                if r.id != survivor.id:
                    to_delete.append(r)

        print(f"重複的組數:{len(to_keep_by_group)}")
        print(f"將刪除筆數:{len(to_delete)}")
        for r in to_delete:
            survivor = to_keep_by_group[(_digits(r.parcel_number), _digits(r.registration_order), r.landowner_id)]
            print(f"  刪 id={r.id}(地號 {r.parcel_number} 登記次序 {r.registration_order} created_at={r.created_at})"
                  f" -> 留 id={survivor.id}(created_at={survivor.created_at})")

        if not to_delete:
            print("沒有重複,不需要動作。")
            return

        if commit:
            delete_ids = [r.id for r in to_delete]
            for r in to_delete:
                survivor = to_keep_by_group[(_digits(r.parcel_number), _digits(r.registration_order), r.landowner_id)]
                # 建物若掛在被刪那筆土地底下,先轉接到留下來的那一筆,避免斷連結。
                db.execute(
                    update(BuildingRecord)
                    .where(BuildingRecord.land_record_id == r.id)
                    .values(land_record_id=survivor.id)
                )
            db.execute(LandRecord.__table__.delete().where(LandRecord.id.in_(delete_ids)))
            db.commit()
            print("已刪除。")
        else:
            print("(dry-run,未刪除;確認無誤後加 --commit 執行)")
    finally:
        db.close()


if __name__ == "__main__":
    main()
