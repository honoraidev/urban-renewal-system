"""一次性:把已匯入的土地登記(land_records)裡缺的「前次移轉現值或原規定地價」全部歷史
記錄(ltt_original_value_history),從當初匯入時來源的謄本辨識結果(ocr_match_results.
extracted_data)回補回來。

只處理有掛 source_ocr_job_id、且 ltt_original_value_history 還是空的 land_records - 比對
方式是在該筆謄本辨識結果的 land_parcels 裡找地號相同的 parcel,再用「登記次序」比對出同一
位所有權人,取其 transfer_history 換算成跟建立時一樣的格式(單價 × 這筆的持分面積 = 總額)。
找不到對應資料的筆數會列出來,不會報錯中斷。

已有 ltt_original_value_history 的筆數(表示是這次修改之後新匯入的)一律跳過,可重複執行。

用法:
    # 先看會回補幾筆、比對不到的有幾筆(不寫入)
    python backfill_ltt_history.py

    # 確認無誤後實際寫入
    python backfill_ltt_history.py --commit
"""

import sys

from sqlalchemy import select

from database import SessionLocal
from models.land_record import LandRecord
from models.ocr import OcrMatchResult


def _digits(s) -> str:
    return "".join(ch for ch in str(s or "") if ch.isdigit())


def _find_owner(data: dict, parcel_number: str, registration_order: str, owner_name: str, id_number: str):
    target_pn = _digits(parcel_number)
    target_order = _digits(registration_order)
    candidates = []
    for parcel in data.get("land_parcels") or []:
        if _digits(parcel.get("parcel_number")) != target_pn:
            continue
        candidates.extend(parcel.get("owners") or [])
    if not candidates:
        return None
    if target_order:
        for o in candidates:
            if _digits(o.get("registration_order")) == target_order:
                return o
    if id_number:
        for o in candidates:
            if (o.get("id_number") or "").strip() == id_number.strip():
                return o
    if owner_name:
        for o in candidates:
            if (o.get("owner_name") or "").strip() == owner_name.strip():
                return o
    return None


def main() -> None:
    commit = "--commit" in sys.argv
    db = SessionLocal()
    try:
        records = db.scalars(
            select(LandRecord).where(
                LandRecord.source_ocr_job_id.is_not(None),
                LandRecord.ltt_original_value_history.is_(None),
            )
        ).all()
        print(f"待檢查筆數:{len(records)}")

        filled = 0
        skipped_no_extraction = 0
        skipped_no_match = 0
        skipped_no_history = 0

        job_data_cache: dict[int, dict | None] = {}

        for r in records:
            job_id = r.source_ocr_job_id
            if job_id not in job_data_cache:
                match = db.scalars(
                    select(OcrMatchResult)
                    .where(OcrMatchResult.ocr_job_id == job_id)
                    .order_by(OcrMatchResult.created_at.desc())
                ).first()
                job_data_cache[job_id] = match.extracted_data if match else None
            data = job_data_cache[job_id]
            if not data:
                skipped_no_extraction += 1
                continue

            owner_name = r.landowner.name if r.landowner else ""
            id_number = r.landowner.id_number if r.landowner else ""
            owner = _find_owner(data, r.parcel_number, r.registration_order, owner_name, id_number)
            if owner is None:
                skipped_no_match += 1
                continue

            history = owner.get("transfer_history") or []
            if not history:
                skipped_no_history += 1
                continue

            owned_area_sqm = float(r.owned_area_sqm or 0)
            new_history = [
                {
                    "period": h.get("period"),
                    "value_per_sqm": h.get("value"),
                    "value": round(float(h["value"]) * owned_area_sqm) if h.get("value") is not None else None,
                }
                for h in history
            ]
            r.ltt_original_value_history = new_history
            filled += 1

        print(f"可回補:{filled}")
        print(f"跳過(找不到當初的辨識結果):{skipped_no_extraction}")
        print(f"跳過(比對不到對應所有權人):{skipped_no_match}")
        print(f"跳過(該所有權人原本就沒有歷史記錄):{skipped_no_history}")

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
