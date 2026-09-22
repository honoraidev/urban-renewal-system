"""一次性:把 land_records.ltt_original_value / ltt_current_value 從「這筆持分的總金額」
換算回「謄本上印的單價(元/平方公尺)」。

背景:這兩個欄位原本的設計是「總金額」,OCR 匯入時把謄本單價 × 這位所有權人的持分面積
(owned_area_sqm)存進去,方便直接對比正式土增稅稅單上的總額寫法。但地主清冊「新增地號」
表單(parcelOwnerRowHtml)一直把這兩個欄位當「單價」處理(標籤寫「元/m²」、送出時不乘面積),
兩邊假設互相矛盾 - 使用者編輯畫面看到的數字因此常常跟謄本原文對不起來。

改成統一存「謄本原始單價」,土增稅試算需要的總額由「土增稅」頁自己拿單價 × owned_area_sqm
現算(見 frontend/js/land_value_tax.js 的 landValueTaxRowResult),基礎資料欄位不用預先
綁死持分面積怎麼算 - 之後持分比例被編輯改動,金額也不會因為換算過一次而卡住不同步。

這支腳本只處理**這次改版之前既有的舊資料**(那時候存的還是總額)。部署新版程式碼之後,
OCR 匯入 / 新增地號表單都會直接存單價,不需要、也不能再對新資料跑這支腳本 - owned_area_sqm
拿新資料的單價再除一次面積,會把單價換算成荒謬的極小數字。只能執行一次,執行前先確認
NAS 已經部署了這次連同這支腳本一起 git pull 下來的新程式碼、且還沒有人用新版重新匯入
過任何謄本。

用法:
    # 先看會換算幾筆、owned_area_sqm 缺失跳過的有幾筆(不寫入)
    python backfill_ltt_unit_price.py

    # 確認無誤後實際寫入
    python backfill_ltt_unit_price.py --commit
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

        converted = 0
        skipped_no_area = 0

        for r in records:
            owned_area = float(r.owned_area_sqm or 0)
            if owned_area <= 0:
                skipped_no_area += 1
                continue

            touched = False
            if r.ltt_original_value is not None:
                r.ltt_original_value = round(float(r.ltt_original_value) / owned_area, 2)
                touched = True
            if r.ltt_current_value is not None:
                r.ltt_current_value = round(float(r.ltt_current_value) / owned_area, 2)
                touched = True
            if touched:
                converted += 1

        print(f"已換算(總額 → 單價):{converted}")
        print(f"跳過(owned_area_sqm 缺失或為 0,無法反推):{skipped_no_area}")

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
