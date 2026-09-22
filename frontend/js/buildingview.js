"use strict";

// Per-group "flip axes" toggle (doors-as-rows instead of floors-as-rows) - in-memory
// only, not worth persisting across page loads.
const buildingViewFlippedGroups = new Set();

function buildingViewGroupOrderKey(pid) {
  return `buildingViewGroupOrder:${pid}`;
}

function loadBuildingViewGroupOrder(pid) {
  try {
    return JSON.parse(localStorage.getItem(buildingViewGroupOrderKey(pid)) || "[]");
  } catch (e) {
    return [];
  }
}

function saveBuildingViewGroupOrder(pid, orderedKeys) {
  try {
    localStorage.setItem(buildingViewGroupOrderKey(pid), JSON.stringify(orderedKeys));
  } catch (e) { }
}

function applyBuildingViewSavedOrder(pid, groups) {
  const savedOrder = loadBuildingViewGroupOrder(pid);
  if (!savedOrder.length) return groups;
  const byKey = new Map(groups.map((g) => [g.key, g]));
  const ordered = savedOrder.filter((k) => byKey.has(k)).map((k) => byKey.get(k));
  const remaining = groups.filter((g) => !savedOrder.includes(g.key));
  return [...ordered, ...remaining];
}

// 簽約 / 拜訪狀態在樓棟視圖直接顯示、點擊切換(整合清冊與登記清冊不再顯示)。
const BUILDING_VIEW_TOGGLES = {
  agreement_status: { on: "signed", off: "not_signed", labels: AGREEMENT_STATUS_LABEL },
  visit_status: { on: "visited", off: "not_visited", labels: VISIT_STATUS_LABEL },
};
// landowner_id -> { agreement_status, visit_status };同一位地主可能出現在好幾格,切換後每格都要一致。
let buildingViewOwnerStatus = new Map();

// 簽約/拜訪狀態純顯示,不能直接在格子上點著改 - 要改請點格子開「編輯地主」視窗,
// 裡面按「✏️ 編輯」才能改資料(見 landowners.js openEditLandownerModal),避免在
// 樓棟視圖上滑鼠不小心點到就誤動到真實資料。
function buildingViewStatusChipsHtml(o) {
  const current = buildingViewOwnerStatus.get(o.landowner_id) || o;
  return Object.entries(BUILDING_VIEW_TOGGLES)
    .map(([field, t]) => {
      const on = current[field] === t.on;
      const label = escapeHtml(t.labels[on ? t.on : t.off]);
      return `<span class="mini-badge ${on ? "gate-ok" : ""}">${label}</span>`;
    })
    .join("");
}

// 格子 hover 提示 —— 姓名/電話/地址不在格子本身顯示(只顯示門牌號 + 簽約狀態底
// 色),滑鼠停在格子上用原生 title 屬性補上,不用另外點進編輯視窗才看得到。多位
// 共有人時逐位換行列出。
function buildingViewCellTooltip(cell) {
  const lines = cell.owners.map((o) => {
    const parts = [o.name || "(未填姓名)"];
    if (o.phone_mobile) parts.push(`📱${o.phone_mobile}`);
    if (o.phone_landline) parts.push(`☎${o.phone_landline}`);
    if (o.building_address) parts.push(`🏠謄本門牌:${o.building_address}${o.building_number ? `(建號${o.building_number})` : ""}`);
    if (o.address) parts.push(`戶籍:${o.address}`);
    parts.push(o.last_contact_result ? CONTACT_RESULT_LABEL[o.last_contact_result] || o.last_contact_result : "尚無聯絡紀錄");
    return parts.join(" · ");
  });
  if (cell.owners.length > 1) {
    const total = cell.owners.length;
    const agreedCount = Math.round((cell.agreed_ratio || 0) * total);
    const opposedCount = Math.round((cell.opposed_ratio || 0) * total);
    const otherCount = total - agreedCount - opposedCount;
    lines.unshift(`同意 ${agreedCount} ・ 反對 ${opposedCount} ・ 其他 ${otherCount}(共 ${total} 人)`);
  }
  return lines.join("\n");
}

const _bvSvg = (body, size = 18, sw = 2) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const BV_ICON = {
  building: `<svg viewBox="0 0 48 48" width="52" height="52" aria-hidden="true"><rect x="4" y="22" width="14" height="22" rx="1.5" fill="#5b7aa8"/><rect x="14" y="4" width="26" height="40" rx="2" fill="#1f3a8a"/><g fill="#ffffff" opacity=".9"><rect x="19" y="10" width="4" height="4" rx=".8"/><rect x="26" y="10" width="4" height="4" rx=".8"/><rect x="33" y="10" width="4" height="4" rx=".8"/><rect x="19" y="18" width="4" height="4" rx=".8"/><rect x="26" y="18" width="4" height="4" rx=".8"/><rect x="33" y="18" width="4" height="4" rx=".8"/><rect x="19" y="26" width="4" height="4" rx=".8"/><rect x="26" y="26" width="4" height="4" rx=".8"/><rect x="33" y="26" width="4" height="4" rx=".8"/></g><rect x="22" y="35" width="10" height="9" rx="1" fill="#dbe7f7"/><g fill="#dbe7f7"><rect x="7" y="27" width="3" height="3" rx=".6"/><rect x="12" y="27" width="3" height="3" rx=".6"/><rect x="7" y="34" width="3" height="3" rx=".6"/><rect x="12" y="34" width="3" height="3" rx=".6"/></g></svg>`,
  search: _bvSvg(`<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>`, 20, 2.1),
  grid: _bvSvg(`<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>`, 20),
  list: _bvSvg(`<path d="M8.5 6.5H20M8.5 12H20M8.5 17.5H20"/><path d="M4 6.5h.01M4 12h.01M4 17.5h.01" stroke-width="3"/>`, 20),
  map: _bvSvg(`<path d="M9 4L3 6.5v13L9 17l6 3 6-2.5v-13L15 7z"/><path d="M9 4v13M15 7v13"/>`, 20, 1.8),
  check: _bvSvg(`<circle cx="12" cy="12" r="9.5"/><path d="M7.8 12.4l3 3 5.4-6"/>`, 20, 2.1),
  alert: _bvSvg(`<circle cx="12" cy="12" r="9.5"/><path d="M12 7.5v5.5"/><path d="M12 16.6h.01" stroke-width="3"/>`, 20, 2.1),
  dots: _bvSvg(`<circle cx="12" cy="12" r="9.5"/><path d="M8 12h.01M12 12h.01M16 12h.01" stroke-width="3"/>`, 20, 2.1),
  pie: `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="12" cy="12" r="9.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2.5a9.5 9.5 0 0 1 0 19z" fill="currentColor" opacity=".85"/></svg>`,
  users: _bvSvg(`<circle cx="9" cy="8.5" r="3.2"/><path d="M3 19.5c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5"/><circle cx="17" cy="9.5" r="2.5"/><path d="M17.5 14.2c2.4.2 4 1.9 4 4.3"/>`, 20, 1.9),
  arrow: _bvSvg(`<path d="M5 12h14M13 6l6 6-6 6"/>`, 16, 2.2),
  flip: _bvSvg(`<path d="M7 4L3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7"/>`, 15, 2),
};

// 格子/統計用的「狀態類別」,彼此互斥(每一戶只落在一類),讓各區塊的總戶數對得起來:
// 多位共有(地下層共有)優先 > 同意 > 反對 > 意見不一 > 其他。
function buildingViewCategory(cell, floorSort) {
  if (!cell || !cell.owners.length) return "empty";
  if (cell.owners.length > 1 && floorSort < 0) return "shared";
  if (cell.status === "agreed") return "agreed";
  if (cell.status === "opposed") return "opposed";
  if (cell.status === "mixed") return "mixed";
  return "other"; // none / undecided / 需回電…
}

const BV_CATEGORY_LABEL = { agreed: "已整合", opposed: "反對", other: "待整合", mixed: "意見不一", shared: "多位共有" };
const BV_CELL_ICON = { agreed: BV_ICON.check, opposed: BV_ICON.alert, mixed: BV_ICON.pie, shared: BV_ICON.users };

function buildingViewStats(groups) {
  const s = { agreed: 0, opposed: 0, other: 0, mixed: 0, shared: 0, total: 0 };
  groups.forEach((g) =>
    Object.entries(g.cells).forEach(([k, cell]) => {
      const cat = buildingViewCategory(cell, Number(k.split("|")[0]));
      if (cat === "empty") return;
      s[cat] += 1;
      s.total += 1;
    })
  );
  s.pct = s.total ? Math.round((s.agreed / s.total) * 100) : 0;
  return s;
}

// 格子底色依「最新一次聯絡結果」上色(見 backend/routers/building_view.py 的
// _cell_status),不是正式的簽約/同意狀態 - 跟首頁案件卡片、案件總覽頁關鍵指標
// 同一套三分類(同意=綠/反對=紅/其他=白,其他=需回電+未接聽+未決定+完全沒聯絡
// 過)。共有多人時不是「誰的狀態最搶眼就整格蓋成那色」,而是依三種人數比例畫
// 漸層,一次呈現真實分佈(見 buildingViewCellFillStyle)。
function buildingViewCellClass(status) {
  if (status === "agreed") return "bv-cell-agreed";
  if (status === "opposed") return "bv-cell-opposed";
  if (status === "none" || status === "undecided") return "bv-cell-pending";
  if (status === "empty") return "bv-cell-empty";
  return "bv-cell-mixed";
}

// 三色(同意/反對/其他)比例漸層的背景 - 只有「不是單一類別 100%」的格子才需要
// inline gradient(其餘用 CSS class 的純色就好,少一層 inline style 好讀)。
function buildingViewCellFillStyle(cell) {
  if (cell.status !== "mixed") return "";
  const agreedEnd = Math.round((cell.agreed_ratio || 0) * 100);
  const opposedEnd = agreedEnd + Math.round((cell.opposed_ratio || 0) * 100);
  return ` style="--bv-agreed-end:${agreedEnd}%;--bv-opposed-end:${opposedEnd}%"`;
}

// 頁首下方的總覽列:兼圖例(每個圖示對應格子上的顏色)+ 全案各類戶數。
function buildingViewSummaryHtml(stats) {
  const chip = (tone, icon, label, n, tip) =>
    `<div class="bv-chip bv-chip-${tone}"${tip ? ` title="${escapeHtml(tip)}"` : ""}><span class="bv-chip-ic">${icon}</span><span class="bv-chip-label">${label}</span><span class="bv-chip-n">${n}</span></div>`;
  return `
    <div class="bv-summary">
      <div class="bv-chips">
        ${chip("agreed", BV_ICON.check, "同意 (已整合)", stats.agreed)}
        ${chip("opposed", BV_ICON.alert, "反對", stats.opposed)}
        ${chip("other", BV_ICON.dots, "其他 (未決定/需回電/未接聽/未聯絡)", stats.other)}
        ${chip("mixed", BV_ICON.pie, "<small>共有人意見不一(比例漸層)</small>", stats.mixed, "同一戶有多位共有人,同意/反對/其他都有,格子底色依人數比例畫漸層")}
        ${chip("shared", BV_ICON.users, "多位共有", stats.shared, "多位共同持分的地下層戶(常見於依持分比例登記的地下室/車位建號),紫色格子")}
      </div>
      <div class="bv-tip">💡 拖曳區塊可調整順序;點格子開地主編輯視窗</div>
    </div>`;
}

function buildingViewDonutHtml(pct) {
  const r = 32;
  const c = 2 * Math.PI * r;
  return `
    <div class="bv-donut" title="同意(已整合)戶數 ÷ 總戶數">
      <div class="bv-donut-ring">
        <svg viewBox="0 0 80 80" width="84" height="84" aria-hidden="true">
          <circle cx="40" cy="40" r="${r}" fill="none" class="bv-donut-track" stroke-width="9"/>
          <circle cx="40" cy="40" r="${r}" fill="none" class="bv-donut-arc" stroke-width="9" stroke-linecap="round"
            stroke-dasharray="${((pct / 100) * c).toFixed(2)} ${c.toFixed(2)}" transform="rotate(-90 40 40)"/>
        </svg>
        <b>${pct}%</b>
      </div>
      <span>整合率</span>
    </div>`;
}

function buildingViewGroupCardHtml(g) {
  // 預設翻轉(戶別優先):行是戶別、列是樓層。點翻轉按鈕時改為樓層優先(行樓層、列戶別)
  const flipped = !buildingViewFlippedGroups.has(g.key);
  const st = buildingViewStats([g]);

  const rows = flipped ? g.doors.map((d) => ({ key: d, label: String(d) })) : g.floors.map((f) => ({ key: f.sort, label: f.label }));
  const cols = flipped ? g.floors.map((f) => ({ key: f.sort, label: f.label })) : g.doors.map((d) => ({ key: d, label: String(d) }));

  // A plain HTML table for this turned out to be a dead end - border-collapse,
  // row-height rounding, and the global `table { overflow: hidden }` rule kept eating a
  // sliver off the last row's cell borders no matter how that was patched. CSS grid
  // sidesteps all of that: every cell is sized/positioned independently, so there's no
  // table-layout box for a border to get clipped against.
  // 「16之1」「34之2」這種帶「之」的門牌比純數字寬,圖示改放文字左邊(整組一起換,不然同一列
  // 有的圖示在上有的在左會很亂)。
  const wideCls = (label) => (String(label).includes("之") ? " bv-cell-wide" : "");
  const inline = cols.some((c) => wideCls(c.label));
  const headerCellsHtml = cols
    .map((c) => `<div class="bv-col-label${wideCls(c.label)}">${escapeHtml(c.label)}</div>`)
    .join("");
  const bodyHtml = rows
    .map((r) => {
      const rowLabelHtml = `<div class="bv-row-label">${escapeHtml(r.label)}</div>`;
      const cellsHtml = cols
        .map((c) => {
          const floorSort = flipped ? c.key : r.key;
          const door = flipped ? r.key : c.key;
          const cell = g.cells[`${floorSort}|${door}`];
          const cellLabel = flipped ? g.floors.find((f) => f.sort === c.key)?.label : door;
          const wide = wideCls(cellLabel);
          if (!cell) return `<div class="bv-cell bv-cell-empty${wide}"><span class="bv-cell-label">${escapeHtml(String(cellLabel))}</span></div>`;
          const multiOwner = cell.owners.length > 1;
          const cat = buildingViewCategory(cell, floorSort);
          // 紫色「共有」樣式只給地下層(floorSort < 0,B1/B2...)用 —— 地上樓層本來就
          // 可能是好幾位家人共同繼承同一戶,不是「依持分比例登記的地下室/車位」那種
          // 特殊情況,不該也套紫色框,不然會被誤會成同一種東西。地上樓層多共有人還是
          // 照舊顯示×N角標,只是用預設(非紫)顏色。
          const shared = cat === "shared";
          const badge = multiOwner ? `<span class="bv-cell-badge${shared ? " bv-cell-badge-shared" : ""}">× ${cell.owners.length}</span>` : "";
          const sharedCls = shared ? " bv-cell-shared" : "";
          const fillStyle = buildingViewCellFillStyle(cell);
          const floorLabel = g.floors.find((f) => f.sort === floorSort)?.label || "";
          const hay = [String(door), floorLabel, g.title, ...cell.owners.flatMap((o) => [o.name, o.phone_mobile, o.phone_landline, o.building_address, o.address])]
            .filter(Boolean)
            .join(" ")
            .toLowerCase();
          return `<div class="bv-cell${wide}${sharedCls} ${buildingViewCellClass(cell.status)}"${fillStyle} data-bv-cell="${floorSort}|${door}" data-bv-group="${g.key}" data-bv-hay="${escapeHtml(hay)}" title="${escapeHtml(buildingViewCellTooltip(cell))}"><span class="bv-cell-ic">${BV_CELL_ICON[cat] || ""}</span><span class="bv-cell-label">${escapeHtml(String(cellLabel))}</span>${badge}</div>`;
        })
        .join("");
      return rowLabelHtml + cellsHtml;
    })
    .join("");

  const tile = (tone, label, n) => `<div class="bv-tile bv-tile-${tone}"><span>${label}</span><b>${n}</b></div>`;
  const statRow = (tone, label, n) => `<div class="bv-stat-row"><span class="bv-dot bv-dot-${tone}"></span><span class="bv-stat-label">${label}</span><b class="bv-stat-n bv-stat-n-${tone}">${n}</b></div>`;

  return `
    <div class="bv-group" draggable="true" data-bv-group-key="${g.key}" data-bv-title="${escapeHtml(String(g.title).toLowerCase())}">
      <div class="bv-group-head">
        <span class="bv-drag-handle" title="拖曳調整順序">⠿</span>
        <div class="bv-group-titlebox">
          <span class="bv-group-title">🏢 ${escapeHtml(g.title)}</span>
          <span class="bv-group-meta">${st.total} 戶</span>
          <button type="button" class="bv-flip-btn" data-bv-flip="${g.key}" title="行列互換">${BV_ICON.flip}${flipped ? "樓層→" : "號碼→"}</button>
        </div>
        <div class="bv-tiles">
          ${tile("agreed", "已整合", st.agreed)}${tile("other", "待整合", st.other + st.mixed)}${tile("opposed", "反對", st.opposed)}${tile("shared", "多位共有", st.shared)}
        </div>
        ${buildingViewDonutHtml(st.pct)}
        <button type="button" class="bv-detail-btn" data-bv-detail="${g.key}">樓棟詳情 ${BV_ICON.arrow}</button>
      </div>
      <div class="bv-body">
        <div class="bv-grid-wrap">
          <div class="bv-grid${inline ? " bv-inline" : ""}" style="grid-template-columns:auto repeat(${cols.length}, auto)">
            <div class="bv-grid-corner"></div>${headerCellsHtml}${bodyHtml}
          </div>
        </div>
        <aside class="bv-statpanel">
          <div class="bv-stat-title">戶別狀態統計</div>
          ${statRow("agreed", "同意 (已整合)", st.agreed)}
          ${statRow("opposed", "反對", st.opposed)}
          ${statRow("other", "其他 (未決定/需回電/未接聽/未聯絡)", st.other)}
          ${statRow("mixed", "共有人意見不一(比例漸層)", st.mixed)}
          ${statRow("shared", "多位共有", st.shared)}
          <div class="bv-stat-total"><span>總戶數</span><b>${st.total}</b></div>
        </aside>
      </div>
    </div>`;
}

// 列表檢視 / 樓棟詳情視窗共用:一戶一列。
function buildingViewListRows(groups) {
  const rows = [];
  groups.forEach((g) =>
    g.floors.forEach((f) =>
      g.doors.forEach((d) => {
        const cell = g.cells[`${f.sort}|${d}`];
        if (!cell || !cell.owners.length) return;
        rows.push({ g, floor: f.label, door: String(d), cell, cat: buildingViewCategory(cell, f.sort) });
      })
    )
  );
  return rows;
}

function buildingViewListTableHtml(rows, { showGroup = true } = {}) {
  if (!rows.length) return `<div class="empty-state">沒有戶別資料</div>`;
  const body = rows
    .map((r) => {
      const owners = r.cell.owners;
      const phones = [...new Set(owners.map((o) => o.phone_mobile || o.phone_landline).filter(Boolean))].join("、");
      const hay = [r.door, r.floor, r.g.title, ...owners.flatMap((o) => [o.name, o.phone_mobile, o.phone_landline, o.building_address, o.address])]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      const ids = owners.map((o) => o.landowner_id).join(",");
      return `<tr class="bv-list-row" data-bv-ids="${ids}" data-bv-hay="${escapeHtml(hay)}">
        ${showGroup ? `<td>${escapeHtml(r.g.title)}</td>` : ""}
        <td>${escapeHtml(r.floor)}</td>
        <td><b>${escapeHtml(r.door)}</b></td>
        <td>${owners.map((o) => escapeHtml(o.name) || "(未填姓名)").join("、")}${owners.length > 1 ? ` <span class="mini-badge">× ${owners.length}</span>` : ""}</td>
        <td>${phones ? escapeHtml(phones) : `<span class="helper-text">-</span>`}</td>
        <td><span class="bv-status-pill bv-status-${r.cat}">${BV_CATEGORY_LABEL[r.cat]}</span></td>
      </tr>`;
    })
    .join("");
  return `<div class="table-wrap"><table class="bv-list-table">
    <thead><tr>${showGroup ? "<th>樓棟</th>" : ""}<th>樓層</th><th>戶別</th><th>所有權人</th><th>電話</th><th>狀態</th></tr></thead>
    <tbody>${body}</tbody></table></div>`;
}

// 純土地地主(有土地登記、沒有任何建物登記)——樓棟視圖是照建物門牌分格畫的,這種
// 地主原本完全不會出現在畫面任何地方。跟門牌格子共用同一套「共有人」列樣式
// (.bv-owner-row 等),差別是多顯示地號、且點名字一樣能開他的編輯視窗。
function buildingViewLandOnlyOwnerRowHtml(o) {
  const nm = escapeHtml(o.name) || "-";
  const initial = (o.name || "?").trim().charAt(0) || "?";
  const mobile = (o.phone_mobile || "").trim();
  const landline = (o.phone_landline || "").trim();
  const phoneText = [mobile && `📱${mobile}`, landline && `☎${landline}`].filter(Boolean).join(" · ");
  const parcels = [...new Set(o.parcels || [])].join("、") || "-";
  const hay = [o.name, mobile, landline, parcels].filter(Boolean).join(" ").toLowerCase();
  return `
    <div class="bv-owner-row" data-bv-hay="${escapeHtml(hay)}">
      <span class="bv-owner-avatar">${escapeHtml(initial)}</span>
      <div class="bv-owner-main">
        <a href="#" data-bv-open-owner="${o.landowner_id}" class="bv-owner-name">${nm}<span class="bv-owner-go">查看 ›</span></a>
        <div class="bv-owner-phone">🗺️ 地號:${escapeHtml(parcels)}</div>
        <div class="bv-owner-phone ${phoneText ? "" : "is-empty"}">${phoneText ? escapeHtml(phoneText) : "尚未提供電話"}</div>
      </div>
      <span class="bv-status-chips">${buildingViewStatusChipsHtml(o)}</span>
    </div>`;
}

function buildingViewLandOnlySectionHtml(owners) {
  if (!owners || !owners.length) return "";
  return `
    <div class="bv-group" id="bv-landonly" style="margin-top:16px">
      <div class="bv-group-header">
        <span class="bv-group-title">🗺️ 純土地地主(無建物登記)</span>
        <span class="bv-group-meta">${owners.length} 人</span>
      </div>
      <div class="bv-owner-list" style="padding:4px 0 0">
        ${owners.map(buildingViewLandOnlyOwnerRowHtml).join("")}
      </div>
    </div>`;
}

function wireLandOnlyOwnerLinks(el) {
  el.querySelectorAll("[data-bv-open-owner]").forEach((a) => {
    a.addEventListener("click", async (e) => {
      e.preventDefault();
      const landownerId = Number(a.dataset.bvOpenOwner);
      const pid = state.currentProjectId;
      if (!state.projectCache[pid].landowners) {
        state.projectCache[pid].landowners = await api(`/projects/${pid}/landowners`);
      }
      openEditLandownerModal(landownerId);
    });
  });
}

// 搜尋/顯示模式只存在記憶體:重整這個分頁(例如在編輯視窗裡新增拜訪紀錄後背景重畫)時
// 不要被重置成空白/預設,不然使用者正在看的東西會被打斷。
let buildingViewMode = "grid";
let buildingViewQuery = "";

// 搜尋:格子/列/純土地地主依「門牌、戶別、樓層、所有權人、電話、地址」比對 —
// 樓棟視圖裡沒命中的格子淡化、命中的加外框,整個樓棟都沒命中就先收起來。
function buildingViewApplySearch(root) {
  const q = buildingViewQuery.trim().toLowerCase();
  let hits = 0;
  root.querySelectorAll(".bv-group[data-bv-group-key]").forEach((card) => {
    let any = false;
    card.querySelectorAll("[data-bv-cell]").forEach((c) => {
      const hit = !q || (c.dataset.bvHay || "").includes(q);
      c.classList.toggle("bv-dim", !!q && !hit);
      c.classList.toggle("bv-hit", !!q && hit);
      if (hit) any = true;
    });
    const titleHit = !!q && (card.dataset.bvTitle || "").includes(q);
    card.classList.toggle("hidden", !!q && !any && !titleHit);
    if (!card.classList.contains("hidden")) hits += 1;
  });
  root.querySelectorAll("tr[data-bv-hay]").forEach((tr) => {
    const hit = !q || tr.dataset.bvHay.includes(q);
    tr.classList.toggle("hidden", !hit);
    if (hit) hits += 1;
  });
  let landHits = 0;
  root.querySelectorAll(".bv-owner-row[data-bv-hay]").forEach((row) => {
    const hit = !q || row.dataset.bvHay.includes(q);
    row.classList.toggle("hidden", !hit);
    if (hit) landHits += 1;
  });
  const land = root.querySelector("#bv-landonly");
  if (land) land.classList.toggle("hidden", !!q && !landHits);
  const noResult = root.querySelector("#bv-noresult");
  if (noResult) noResult.classList.toggle("hidden", !q || hits > 0 || landHits > 0);
}

function openBuildingDetailModal(g) {
  const rows = buildingViewListRows([g]);
  const st = buildingViewStats([g]);
  openModal(
    `🏢 ${escapeHtml(g.title)} · 樓棟詳情`,
    `<div class="helper-text" style="margin-bottom:10px">共 ${st.total} 戶 · 已整合 ${st.agreed} · 待整合 ${st.other + st.mixed} · 反對 ${st.opposed} · 多位共有 ${st.shared}(整合率 ${st.pct}%)。點任一列開地主編輯視窗。</div>${buildingViewListTableHtml(rows, { showGroup: false })}`,
    { width: "860px" }
  );
  document.querySelectorAll("#modal-root .bv-list-row").forEach((tr) => {
    tr.addEventListener("click", () => {
      const ids = tr.dataset.bvIds.split(",").map(Number);
      openEditLandownerModal(ids[0], ids);
    });
  });
}

async function renderBuildingViewTab(el) {
  const pid = state.currentProjectId;
  let payload;
  try {
    payload = await api(`/projects/${pid}/building-view`);
  } catch (err) {
    el.innerHTML = `<div class="empty-state">載入失敗</div>`;
    return;
  }
  const groups = applyBuildingViewSavedOrder(pid, payload.groups || []);
  const landOnlyOwners = payload.land_only_owners || [];
  buildingViewOwnerStatus = new Map(
    [...groups.flatMap((g) => Object.values(g.cells).flatMap((c) => c.owners)), ...landOnlyOwners].map((o) => [
      o.landowner_id,
      { agreement_status: o.agreement_status, visit_status: o.visit_status },
    ])
  );

  if (!groups.length) {
    el.innerHTML = `
      <div class="section-toolbar">
        <h3>樓棟視圖</h3>
      </div>
      <div class="empty-state">尚無建物地址資料可供產生樓棟視圖,請先於「登記資料 → 建物登記」匯入建物資料</div>
      ${buildingViewLandOnlySectionHtml(landOnlyOwners)}
    `;
    wireLandOnlyOwnerLinks(el);
    return;
  }

  const stats = buildingViewStats(groups);
  el.innerHTML = `
    <div class="bv-page">
      <div class="bv-head">
        <div class="bv-head-title">
          <span class="bv-head-icon">${BV_ICON.building}</span>
          <div>
            <h2 class="bv-title">樓棟視圖</h2>
            <p class="bv-sub">以樓層與戶別檢視地主整合狀態,點選戶別可查看地主與權屬詳情。</p>
          </div>
        </div>
        <div class="bv-head-tools">
          <div class="bv-search">${BV_ICON.search}<input type="search" id="bv-q" placeholder="搜尋門牌 / 戶別 / 所有權人..." autocomplete="off" value="${escapeHtml(buildingViewQuery)}"></div>
          <div class="bv-viewtoggle" role="group" aria-label="檢視方式">
            <button type="button" data-bv-mode="grid">${BV_ICON.grid}樓棟視圖</button>
            <button type="button" data-bv-mode="list">${BV_ICON.list}列表檢視</button>
            <button type="button" disabled title="尚未提供地圖檢視">${BV_ICON.map}地圖檢視</button>
          </div>
        </div>
      </div>
      ${buildingViewSummaryHtml(stats)}
      <div id="bv-body"></div>
      <div id="bv-noresult" class="empty-state hidden">找不到符合「搜尋」的門牌 / 戶別 / 所有權人</div>
    </div>
  `;

  const bodyEl = el.querySelector("#bv-body");
  const groupsByKey = new Map(groups.map((g) => [g.key, g]));

  const syncModeButtons = () =>
    el.querySelectorAll("[data-bv-mode]").forEach((b) => b.classList.toggle("active", b.dataset.bvMode === buildingViewMode));

  const renderBody = () => {
    syncModeButtons();
    if (buildingViewMode === "list") {
      bodyEl.innerHTML = `${buildingViewListTableHtml(buildingViewListRows(groups))}${buildingViewLandOnlySectionHtml(landOnlyOwners)}`;
      bodyEl.querySelectorAll(".bv-list-row").forEach((tr) => {
        tr.addEventListener("click", () => {
          const ids = tr.dataset.bvIds.split(",").map(Number);
          openEditLandownerModal(ids[0], ids);
        });
      });
    } else {
      bodyEl.innerHTML = `<div id="bv-groups" class="bv-groups-grid">${groups.map(buildingViewGroupCardHtml).join("")}</div>${buildingViewLandOnlySectionHtml(landOnlyOwners)}`;
      groups.forEach((g) => wireGroupCard(g.key));
    }
    wireLandOnlyOwnerLinks(bodyEl);
    buildingViewApplySearch(el);
  };

  const rerenderGroup = (key) => {
    const card = bodyEl.querySelector(`[data-bv-group-key="${CSS.escape(key)}"]`);
    if (!card) return;
    card.outerHTML = buildingViewGroupCardHtml(groupsByKey.get(key));
    wireGroupCard(key);
    buildingViewApplySearch(el);
  };

  function wireGroupCard(key) {
    const container = bodyEl.querySelector("#bv-groups");
    const card = container && container.querySelector(`[data-bv-group-key="${CSS.escape(key)}"]`);
    if (!card) return;
    card.querySelectorAll("[data-bv-cell]").forEach((td) => {
      td.addEventListener("click", () => {
        const cell = groupsByKey.get(td.dataset.bvGroup).cells[td.dataset.bvCell];
        if (!cell || !cell.owners.length) return;
        // 這格只有一位就直接開編輯;好幾位共有人時帶上整組 id,編輯視窗裡用上下鍵切換,
        // 不再多一層「此門牌共有人」清單視窗。
        const ids = cell.owners.map((o) => o.landowner_id);
        openEditLandownerModal(ids[0], ids);
      });
    });
    const flipBtn = card.querySelector("[data-bv-flip]");
    if (flipBtn) {
      flipBtn.addEventListener("click", () => {
        if (buildingViewFlippedGroups.has(key)) buildingViewFlippedGroups.delete(key);
        else buildingViewFlippedGroups.add(key);
        rerenderGroup(key);
      });
    }
    const detailBtn = card.querySelector("[data-bv-detail]");
    if (detailBtn) detailBtn.addEventListener("click", () => openBuildingDetailModal(groupsByKey.get(key)));
    card.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", key);
      card.classList.add("bv-dragging");
    });
    card.addEventListener("dragend", () => card.classList.remove("bv-dragging"));
    card.addEventListener("dragover", (e) => e.preventDefault());
    card.addEventListener("drop", (e) => {
      e.preventDefault();
      const draggedKey = e.dataTransfer.getData("text/plain");
      if (!draggedKey || draggedKey === key) return;
      const cards = [...container.children];
      const draggedEl = container.querySelector(`[data-bv-group-key="${CSS.escape(draggedKey)}"]`);
      const targetIndex = cards.indexOf(card);
      if (!draggedEl) return;
      container.insertBefore(draggedEl, cards.indexOf(draggedEl) < targetIndex ? card.nextSibling : card);
      saveBuildingViewGroupOrder(
        pid,
        [...container.children].map((c) => c.dataset.bvGroupKey)
      );
    });
  }

  el.querySelectorAll("[data-bv-mode]").forEach((b) =>
    b.addEventListener("click", () => {
      buildingViewMode = b.dataset.bvMode;
      renderBody();
    })
  );
  el.querySelector("#bv-q").addEventListener("input", (e) => {
    buildingViewQuery = e.target.value;
    buildingViewApplySearch(el);
  });

  renderBody();
}
