"""一次性:找出「同一個真人被拆成兩筆 landowners」的重複,合併成一筆。

成因:OCR 精靈比對地主時(見 ocr_wizard.js 的 findOrCreateLandownerByOwner),遇到第二類謄本
(統編、姓名都被遮罩成「A220*****1」「陳＊＊」這種格式)時,姓名和統編都不可靠,只能再加比
對「戶籍地址是否完全相同」才敢判定是同一人。但同一個真人的土地謄本跟建物謄本常常是不同時間
列印的,地址可能因為行政區改制(桃園縣中壢市 -> 桃園市中壢區、台北縣板橋市 -> 台北市板橋區等
2010年後的縣市改制)而字面上不同,導致地址比對失敗、被誤判成兩個不同人,各自建立一筆
landowner ——一筆掛著土地登記、另一筆掛著建物登記,兩邊都「看得到資料」但互相不知道對方存在
(整合清冊/純土地地主清單因此顯示出「明明有建物卻被歸類成純土地地主」的怪狀況)。

判斷「同一組重複」的依據:同一案件裡,統編(遮罩後的字串)完全相同 + 姓名完全相同,才視為候選；
其中地址在「去除縣/市/鎮/鄉/區這類行政區劃字」後仍完全相同的,才算高信心可以自動合併(絕大部分
就是縣市改制造成的假差異);地址規一化後仍不同的,一律只列出來讓人工核對,不自動合併——因為
遮罩後的統編理論上撞號機率不低(遮罩只留頭尾兩碼),曾抓到過統編、姓氏都一樣但其實是完全不同
兩個人、住在不同地方的真實案例(project 327,A123*****0)。

合併時把「輸家」(loser)底下的 land_records / building_records / consent_records /
contact_logs / documents 全部轉接到「贏家」(keeper,取 created_at 較早的那筆)身上,
consent_records 若跟 keeper 既有的 (landowner_id, sop_stage) 撞到唯一鍵,輸家那筆直接丟棄
(不覆蓋 keeper 既有的同意紀錄)。keeper 缺 phone/notes 而 loser 有的話,順便補上。最後刪除
loser 那筆 landowners。

用法:
    # 只看報告,不寫入 —— 列出所有案件裡的重複組,分「可自動合併」與「需人工核對」
    python merge_duplicate_landowners.py

    # 只看單一案件
    python merge_duplicate_landowners.py --project 330

    # 實際合併「可自動合併」的那些組(需人工核對的組不會被動到)
    python merge_duplicate_landowners.py --commit

    # 連「需人工核對」的組也一併合併(先看過報告、確認每組都真的是同一人再用)
    python merge_duplicate_landowners.py --commit --include-manual
"""

import re
import sys
from collections import defaultdict

from sqlalchemy import func, select, update

from database import SessionLocal
from models.building_record import BuildingRecord
from models.consent_record import ConsentRecord
from models.contact_log import ContactLog
from models.document import Document
from models.land_record import LandRecord
from models.landowner import Landowner

_REGION_CHARS = re.compile(r"[縣市鎮鄉區]")


def _normalize_region(addr: str) -> str:
    # 行政區劃字通常只出現在地址開頭(省/縣市 + 鄉鎮市區)那一小段,只處理前 8 個字,
    # 避免把後面路名/巷弄裡剛好出現的「市」字也一起吃掉。
    addr = addr or ""
    head, rest = addr[:8], addr[8:]
    return _REGION_CHARS.sub("", head) + rest


def main() -> None:
    project_arg = None
    for i, a in enumerate(sys.argv):
        if a == "--project" and i + 1 < len(sys.argv):
            project_arg = int(sys.argv[i + 1])
    commit = "--commit" in sys.argv
    include_manual = "--include-manual" in sys.argv

    db = SessionLocal()
    try:
        q = select(Landowner).where(Landowner.id_number.isnot(None), Landowner.id_number != "")
        if project_arg is not None:
            q = q.where(Landowner.project_id == project_arg)
        owners = db.scalars(q).all()

        groups: dict[tuple[int, str], list[Landowner]] = defaultdict(list)
        for o in owners:
            groups[(o.project_id, o.id_number)].append(o)

        auto_pairs: list[tuple[Landowner, Landowner]] = []
        manual_pairs: list[tuple[Landowner, Landowner]] = []

        for (project_id, id_number), members in groups.items():
            if len(members) < 2:
                continue
            if len(members) > 2 or len({m.name for m in members}) != 1:
                print(f"[跳過,需人工檢查] project={project_id} id_number={id_number} "
                      f"共 {len(members)} 筆,姓名不完全一致或超過兩筆: "
                      f"{[(m.id, m.name, m.address) for m in members]}")
                continue
            a, b = sorted(members, key=lambda m: m.created_at)
            if _normalize_region(a.address) == _normalize_region(b.address):
                auto_pairs.append((a, b))
            else:
                manual_pairs.append((a, b))

        def _describe(a: Landowner, b: Landowner) -> str:
            n_land_a = db.scalar(select(func.count()).select_from(LandRecord).where(LandRecord.landowner_id == a.id))
            n_bld_a = db.scalar(select(func.count()).select_from(BuildingRecord).where(BuildingRecord.landowner_id == a.id))
            n_land_b = db.scalar(select(func.count()).select_from(LandRecord).where(LandRecord.landowner_id == b.id))
            n_bld_b = db.scalar(select(func.count()).select_from(BuildingRecord).where(BuildingRecord.landowner_id == b.id))
            return (
                f"  留 id={a.id}(土地{n_land_a}/建物{n_bld_a}) 地址={a.address}\n"
                f"  併 id={b.id}(土地{n_land_b}/建物{n_bld_b}) 地址={b.address}"
            )

        print(f"=== 可自動合併(地址去除縣市區劃字後完全一致,判定為行政區改制造成的假差異):{len(auto_pairs)} 組 ===")
        for a, b in auto_pairs:
            print(f"project={a.project_id} name={a.name} id_number={a.id_number}")
            print(_describe(a, b))

        print(f"\n=== 需人工核對(地址規一化後仍不同,無法自動判定是不是同一人):{len(manual_pairs)} 組 ===")
        for a, b in manual_pairs:
            print(f"project={a.project_id} name={a.name} id_number={a.id_number}")
            print(_describe(a, b))

        to_merge = list(auto_pairs)
        if include_manual:
            to_merge += manual_pairs

        if not commit:
            print(f"\n(dry-run,未寫入;確認無誤後加 --commit 執行"
                  f"{'(含需人工核對的組)' if include_manual else '(只合併可自動合併的組;需人工核對的組要加 --include-manual)'})")
            return

        merged = 0
        for a, b in to_merge:
            db.execute(update(LandRecord).where(LandRecord.landowner_id == b.id).values(landowner_id=a.id))
            db.execute(update(BuildingRecord).where(BuildingRecord.landowner_id == b.id).values(landowner_id=a.id))
            db.execute(update(Document).where(Document.landowner_id == b.id).values(landowner_id=a.id))

            existing_stages = {
                s for (s,) in db.execute(
                    select(ConsentRecord.sop_stage).where(ConsentRecord.landowner_id == a.id)
                ).all()
            }
            for cr in db.scalars(select(ConsentRecord).where(ConsentRecord.landowner_id == b.id)).all():
                if cr.sop_stage in existing_stages:
                    db.delete(cr)
                else:
                    cr.landowner_id = a.id

            db.execute(update(ContactLog).where(ContactLog.landowner_id == b.id).values(landowner_id=a.id))

            if not a.phone and b.phone:
                a.phone = b.phone
            if not a.phone_landline and b.phone_landline:
                a.phone_landline = b.phone_landline
            if not a.phone_mobile and b.phone_mobile:
                a.phone_mobile = b.phone_mobile
            if not a.notes and b.notes:
                a.notes = b.notes

            db.flush()
            db.delete(b)
            merged += 1

        db.commit()
        print(f"\n已合併 {merged} 組。")
    finally:
        db.close()


if __name__ == "__main__":
    main()
