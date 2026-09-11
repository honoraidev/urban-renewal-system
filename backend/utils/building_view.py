import re

# Maps single/compound Chinese numeral characters (traditional) to their integer value,
# covering the small range actual floor labels use (there's no realistic "五十樓" case
# here). Handles "十" as both 10 and the tens-digit prefix in "十一".."十九".
_CHINESE_DIGIT = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8, "九": 9}


def _parse_chinese_floor_number(text: str) -> int | None:
    """Parses a Chinese-numeral floor label ("三樓"/"十二層"/"B1"/"地下一樓") into a
    signed int (basements negative), or None if unrecognized. Floor text comes straight
    from OCR and is frequently noisy - this is used to sort/label rows in the building
    view grid, not for anything that needs to be authoritative."""
    if not text:
        return None
    text = text.strip()
    basement = text.startswith("地下") or text.upper().startswith("B")
    core = re.sub(r"^(地下|B)", "", text, flags=re.IGNORECASE)
    core = re.sub(r"(樓|層|F)$", "", core, flags=re.IGNORECASE).strip()
    if not core:
        # 沒帶數字的「地下層」/「地下」當地下一層 —— 不然會被丟到 -10000 的
        # catch-all,在樓棟視圖裡自成一列、和「B1」分開。上面沒帶數字就維持 None。
        return -1 if basement else None
    if core.isdigit():
        n = int(core)
        return -n if basement else n
    if core == "十":
        n = 10
    elif len(core) == 2 and core[0] == "十" and core[1] in _CHINESE_DIGIT:
        n = 10 + _CHINESE_DIGIT[core[1]]
    elif len(core) == 2 and core[1] == "十" and core[0] in _CHINESE_DIGIT:
        n = _CHINESE_DIGIT[core[0]] * 10
    elif len(core) == 1 and core in _CHINESE_DIGIT:
        n = _CHINESE_DIGIT[core]
    else:
        return None
    return -n if basement else n


def is_shared_building_record(b) -> bool:
    """共有部分 / 公設 / 純地下室 —— 不是任何人的區分所有建物,樓棟視圖不該把它
    當成一戶。OCR 常把每位區分所有權人的「共有部分:XXXX建號」誤存成掛在該人
    底下的一筆 building_record(同一個地下停車場建號會重複幾十列),不濾掉的話
    那一格就會出現「×50」這種假的共有人頭數。地主清冊匯出也做同樣的剔除。"""
    if (getattr(b, "main_use", None) or "").strip() == "共有部分":
        return True
    if getattr(b, "common_part_shares", None):
        return True
    addr = getattr(b, "address", "") or ""
    return "房屋地下" in addr or "共同使用" in addr


# 「16號」-> 16;「16之2號」/「16號之2」-> 16 之 2(獨立門牌,跟 16 號同一側)
_DOOR_NUMBER_RE = re.compile(r"^(.*?)(\d+)(?:\s*之\s*(\d+))?\s*號(?:\s*之\s*(\d+))?")


def parse_address(address: str | None) -> tuple[str, int, int] | None:
    """Splits an address into (street, door_number, door_sub) for building-view grouping - e.g.
    "信義路五段150巷335弄15號二樓" -> ("信義路五段150巷335弄", 15, 0),
    "內湖路一段47巷8弄16之2號" -> ("內湖路一段47巷8弄", 16, 2). Anything after the
    door number (a floor suffix, room number, etc.) is dropped; floor comes from the
    building record's own `floor` field instead. Returns None if no "<number>號" pattern
    is found (the address is missing or doesn't look like a street address)."""
    if not address:
        return None
    m = _DOOR_NUMBER_RE.match(address.strip())
    if not m:
        return None
    street = m.group(1).strip()
    if not street:
        return None
    return street, int(m.group(2)), int(m.group(3) or m.group(4) or 0)


def floor_sort_key_and_label(floor_text: str | None) -> tuple[int, str]:
    """Returns (sort_key, display_label) for a building record's floor text. Unparseable
    text still gets a stable (very negative) sort key and the raw text as its label,
    rather than being dropped - a garbled OCR floor is still a real unit that needs to
    show up in the grid."""
    n = _parse_chinese_floor_number(floor_text or "")
    if n is None:
        return (-10_000, (floor_text or "?").strip())
    return (n, f"{n}F" if n > 0 else f"B{-n}")


def _door_key(door_number: int, door_sub: int):
    return f"{door_number}之{door_sub}" if door_sub else door_number


def group_building_records(records: list[dict]) -> list[dict]:
    """Groups building-view rows (each a dict with address/floor/owners) by street and
    odd/even door-number side - one card per street side, mirroring how a scanned
    door-to-door canvass sheet is usually organized (e.g. "OO街 奇數側 1-13號"); a long
    side scrolls horizontally inside its card instead of being split into several cards.
    「16之2號」 gets its own column right after 16號 (same side as 16). Records whose
    address doesn't parse into a street+door number are returned separately under an
    "地址待確認" catch-all so they aren't silently dropped.

    Each input record must have: street, door_number, door_sub (0 if none), floor_sort,
    floor_label, owners. Returns a list of group dicts: {key, title, doors: [int | "N之M"],
    floors: [{sort,label}], cells: {"<floor_sort>|<door>": {status, owners}}}."""
    by_street_side: dict[tuple[str, int], list[dict]] = {}
    for r in records:
        if r.get("street") is None or r.get("door_number") is None:
            continue
        side = r["door_number"] % 2
        by_street_side.setdefault((r["street"], side), []).append(r)

    groups: list[dict] = []
    for (street, side), items in sorted(by_street_side.items(), key=lambda kv: (kv[0][0], kv[0][1])):
        doors = [
            _door_key(n, s) for n, s in sorted({(r["door_number"], r.get("door_sub") or 0) for r in items})
        ]
        floors_seen: dict[int, str] = {}
        cells: dict[str, dict] = {}
        for r in items:
            floors_seen[r["floor_sort"]] = r["floor_label"]
            cell_key = f"{r['floor_sort']}|{_door_key(r['door_number'], r.get('door_sub') or 0)}"
            cell = cells.setdefault(cell_key, {"owners": []})
            cell["owners"].extend(r["owners"])
        floors = [{"sort": s, "label": floors_seen[s]} for s in sorted(floors_seen.keys(), reverse=True)]
        side_label = "奇數側" if side == 1 else "偶數側"
        mains = sorted({r["door_number"] for r in items})
        groups.append(
            {
                # 維持「街::側::第一個門牌」格式,之前拖曳排好的卡片順序不會亂掉
                "key": f"{street}::{side}::{doors[0]}",
                "title": f"{street} {side_label} {mains[0]}-{mains[-1]}號",
                "doors": doors,
                "floors": floors,
                "cells": cells,
            }
        )

    unmatched = [r for r in records if r.get("street") is None]
    if unmatched:
        floors_seen = {}
        cells = {}
        for i, r in enumerate(unmatched):
            floors_seen[r["floor_sort"]] = r["floor_label"]
            cell_key = f"{r['floor_sort']}|{i}"
            cells[cell_key] = {"owners": r["owners"]}
        groups.append(
            {
                "key": "unmatched",
                "title": "地址待確認",
                "doors": list(range(len(unmatched))),
                "floors": [{"sort": s, "label": floors_seen[s]} for s in sorted(floors_seen.keys(), reverse=True)],
                "cells": cells,
            }
        )
    return groups
