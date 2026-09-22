"""一次性:backfill_ltt_unit_price.py 反推出來的單價帶著四捨五入誤差殘留的小數
(例如 86900.1、237000.25) - 原因是原本存的總額本身就是「單價 × 持分面積」四捨五入
過的整數,除回單價時這個誤差就會冒出來。謄本上印的公告現值/移轉現值本來就是整數
(元/平方公尺),這支腳本把 ltt_original_value / ltt_current_value 四捨五入成整數,
不做除法、不動 owned_area_sqm,只能在 backfill_ltt_unit_price.py --commit 執行過
之後跑,執行完再跑第二次也不會有問題(整數再四捨五入還是自己)。

用法:
    python round_ltt_unit_price.py        # 先看會清理幾筆(不寫入)
    python round_ltt_unit_price.py --commit   # 確認無誤後實際寫入
"""

import sys

from sqlalchemy import select

from database import SessionLocal
from models.land_record import LandRecord


def main() -> None:
    commit = "--commit" in sys.argv
    db = SessionLocal()
    try:
        records = db.scalars(
            select(LandRecord).where(
                (LandRecord.ltt_original_value.is_not(None)) | (LandRecord.ltt_current_value.is_not(None))
            )
        ).all()
        print(f"待檢查筆數:{len(records)}")

        rounded = 0
        for r in records:
            touched = False
            if r.ltt_original_value is not None:
                new_val = round(float(r.ltt_original_value))
                if new_val != r.ltt_original_value:
                    r.ltt_original_value = new_val
                    touched = True
            if r.ltt_current_value is not None:
                new_val = round(float(r.ltt_current_value))
                if new_val != r.ltt_current_value:
                    r.ltt_current_value = new_val
                    touched = True
            if touched:
                rounded += 1

        print(f"已四捨五入成整數:{rounded}")

        if commit:
            db.commit()
            print("已寫入。")
        else:
            db.rollback()
            print("(dry-run,未寫入;確認無誤後加 --commit 執行)")
    finally:
        db.close()


if __name__ == "__main__":
    main()
