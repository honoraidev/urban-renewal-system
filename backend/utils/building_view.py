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
        return None
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


_DOOR_NUMBER_RE = re.compile(r"^(.*?)(\d+)\s*號")


def parse_address(address: str | None) -> tuple[str, int] | None:
    """Splits an address into (street, door_number) for building-view grouping - e.g.
    "信義路五段150巷335弄15號二樓" -> ("信義路五段150巷335弄", 15). Anything after the
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
    return street, int(m.group(2))


def floor_sort_key_and_label(floor_text: str | None) -> tuple[int, str]:
    """Returns (sort_key, display_label) for a building record's floor text. Unparseable
    text still gets a stable (very negative) sort key and the raw text as its label,
    rather than being dropped - a garbled OCR floor is still a real unit that needs to
    show up in the grid."""
    n = _parse_chinese_floor_number(floor_text or "")
    if n is None:
        return (-10_000, (floor_text or "?").strip())
    return (n, f"{n}F" if n > 0 else f"B{-n}")


# A single group card gets unwieldy past this many door-number columns (the reference
# design shows ~7), so a long street/side is split into several group cards instead of
# one very wide table.
MAX_DOORS_PER_GROUP = 8


def group_building_records(records: list[dict]) -> list[dict]:
    """Groups building-view rows (each a dict with address/floor/owners) by street and
    odd/even door-number side, chunked to MAX_DOORS_PER_GROUP columns per group - mirrors
    how a scanned door-to-door canvass sheet is usually organized (e.g. "OO街 奇數側
    1-13號"). Records whose address doesn't parse into a street+door number are returned
    separately under an "地址待確認" catch-all so they aren't silently dropped.

    Each input record must have: street, door_number, floor_sort, floor_label, owners.
    Returns a list of group dicts: {key, title, doors: [int], floors: [{sort,label}],
    cells: {"<floor_sort>|<door>": {status, owners}}}."""
    by_street_side: dict[tuple[str, int], list[dict]] = {}
    for r in records:
        if r.get("street") is None or r.get("door_number") is None:
            continue
        side = r["door_number"] % 2
        by_street_side.setdefault((r["street"], side), []).append(r)

    groups: list[dict] = []
    for (street, side), items in sorted(by_street_side.items(), key=lambda kv: (kv[0][0], kv[0][1])):
        doors_sorted = sorted({r["door_number"] for r in items})
        for chunk_start in range(0, len(doors_sorted), MAX_DOORS_PER_GROUP):
            chunk_doors = doors_sorted[chunk_start : chunk_start + MAX_DOORS_PER_GROUP]
            chunk_items = [r for r in items if r["door_number"] in chunk_doors]
            floors_seen: dict[int, str] = {}
            cells: dict[str, dict] = {}
            for r in chunk_items:
                floors_seen[r["floor_sort"]] = r["floor_label"]
                cell_key = f"{r['floor_sort']}|{r['door_number']}"
                cell = cells.setdefault(cell_key, {"owners": []})
                cell["owners"].extend(r["owners"])
            floors = [{"sort": s, "label": floors_seen[s]} for s in sorted(floors_seen.keys(), reverse=True)]
            side_label = "奇數側" if side == 1 else "偶數側"
            groups.append(
                {
                    "key": f"{street}::{side}::{chunk_doors[0]}",
                    "title": f"{street} {side_label} {chunk_doors[0]}-{chunk_doors[-1]}號",
                    "doors": chunk_doors,
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
