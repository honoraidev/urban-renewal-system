"""一次性:把整理好的都更/危老時事新聞,加進「工具與資源 → 新聞」清單(news_items)。

news_items 原本的設計是「L1/L2 自己在畫面上新增真實連結」,不由程式碼預先塞可能過時
的網址(見 models/news_item.py 的說明)。這支腳本是例外:內容是使用者要求整理進來的
真實新聞(標題、原文網址、摘要都來自實際查到的報導,不是編造的),等同於「幫忙先手動
新增這幾筆」,不是长期自動化 seed。

用網址(url)判斷是否已存在,已存在就跳過,不會重複新增 → 可重複執行。

用法:
    python seed_urban_renewal_news.py            # 先看會新增哪些(不寫入)
    python seed_urban_renewal_news.py --commit    # 確認無誤後實際寫入
"""

import sys

from database import SessionLocal
from models.news_item import NewsItem

NEWS = [
    {
        "category": "都更政策",
        "name": "都更推不動、拆除重建緩不濟急,「老宅延壽」成居住新顯學(內政部砸50億推補助)",
        "url": "https://cdnfinance.technews.tw/2026/04/12/5-billion-old-house-lifespan-extension-subsidy-booming-faces-human-funding-challenges-long-term-renovation-mechanism/",
        "description": (
            "內政部推出「老宅延壽機能復新計畫」,編列50億元,補助屋齡逾30年的4至6層公寓、"
            "6層以下全棟持有透天厝增設電梯、立面修繕與管線更新,5月底開放申請。全台逾30年"
            "住宅已達554萬戶(占58%),但都更僅1,291件、危老僅4,838件,整合推動緩慢。"
        ),
    },
    {
        "category": "法規異動",
        "name": "經發會期許都更、危老擴大內需 內政部修法鬆綁、老宅延壽補助額度出爐",
        "url": "https://fwnews.com.tw/%E7%B6%93%E7%99%BC%E6%9C%83%E6%9C%9F%E8%A8%B1%E9%83%BD%E6%9B%B4%E3%80%81%E5%8D%B1%E8%80%81%E6%93%B4%E5%A4%A7%E5%85%A7%E9%9C%80-%E5%85%A7%E6%94%BF%E9%83%A8%E7%A0%94%E6%93%AC%E4%BF%AE%E6%B3%95%E3%80%81/",
        "description": (
            "內政部修正草案已送立法院審議:老宅延壽法制化、刪除條例期限、精進重建適用範圍、"
            "新增公益設施容積獎勵與稅減優惠。老宅延壽補助額度:公寓公共空間每棟最高960萬元、"
            "私人空間每戶最高30萬元。近年都更危老投資金額累計達1.84兆元。"
        ),
    },
    {
        "category": "市場動態",
        "name": "2026第八屆都更+危老博覽會9月登場 首增社宅、老宅延壽、淨零三大專區",
        "url": "https://wooostock.com/design/1570",
        "description": (
            "2026/9/19-20 於台北圓山花博爭艷館舉行,《財訊》雙週刊主辦,內政部及北、新、桃"
            "三市政府指導。首度新增「社宅與包租代管」「老宅延壽與整維」「淨零與綠建築」三大"
            "專區,呼應全台逾30年住宅已超過500萬戶的更新需求。"
        ),
    },
]


def main() -> None:
    commit = "--commit" in sys.argv
    db = SessionLocal()
    try:
        existing_urls = {u for (u,) in db.query(NewsItem.url).all()}
        to_add = [n for n in NEWS if n["url"] not in existing_urls]

        print(f"清單共 {len(NEWS)} 筆,已存在 {len(NEWS) - len(to_add)} 筆,將新增 {len(to_add)} 筆:")
        for n in to_add:
            print(f"  [{n['category']}] {n['name']}")

        if not to_add:
            print("沒有新的要加,不需要動作。")
            return

        if commit:
            for n in to_add:
                db.add(NewsItem(category=n["category"], name=n["name"], url=n["url"], description=n["description"]))
            db.commit()
            print("已寫入。")
        else:
            print("\n(dry-run,未寫入;確認無誤後加 --commit 執行)")
    finally:
        db.close()


if __name__ == "__main__":
    main()
