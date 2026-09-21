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

// 格子底色依「最新一次聯絡結果」上色(見 backend/routers/building_view.py 的
// _cell_status),不是正式的簽約/同意狀態 - 跟首頁案件卡片、案件總覽頁關鍵指標
// 同一套三分類(同意=綠/反對=紅/其他=白,其他=需回電+未接聽+未決定+完全沒聯絡
// 過)。共有多人時不是「誰的狀態最搶眼就整格蓋成那色」,而是依三種人數比例畫
// 漸層,一次呈現真實分佈(見 buildingViewCellFillStyle)。
function buildingViewLegendHtml() {
  const items = [
    { cls: "bv-cell-agreed", label: "同意" },
    { cls: "bv-cell-opposed", label: "反對" },
    { cls: "bv-cell-pending", label: "其他(未決定/需回電/未接聽/未聯絡)" },
    // 圖例的漸層範例格固定給一組示意比例(同意 40% / 反對 30% / 其他 30%),純粹
    // 展示這是三色漸層,不代表任何一格的真實數字。
    { cls: "bv-cell-mixed", label: "共有人意見不一(比例漸層)", style: ` style="--bv-agreed-end:40%;--bv-opposed-end:70%"` },
  ];
  const legendItems = items
    .map((it) => `<span class="bv-legend-item"><span class="bv-legend-swatch ${it.cls}"${it.style || ""}></span>${it.label}</span>`)
    .join("");
  // 「×N」角標 = 這格有多位共同持分人(常見於依持分比例登記的地下室/車位建號),
  // 邊框改用紫色跟一般聯絡狀態的格子區分開,並在圖例文字說明清楚,避免被誤會成
  // OCR 又重複匯入。
  const sharedLegend = `<span class="bv-legend-item"><span class="bv-legend-swatch bv-cell-shared-swatch"></span>多位共有</span>`;
  return legendItems + sharedLegend;
}

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

function buildingViewGroupCardHtml(g) {
  const flipped = buildingViewFlippedGroups.has(g.key);
  const unitCount = Object.keys(g.cells).length;
  const agreedCount = Object.values(g.cells).filter((c) => c.status === "agreed").length;

  const rows = flipped ? g.doors.map((d) => ({ key: d, label: String(d) })) : g.floors.map((f) => ({ key: f.sort, label: f.label }));
  const cols = flipped ? g.floors.map((f) => ({ key: f.sort, label: f.label })) : g.doors.map((d) => ({ key: d, label: String(d) }));

  // A plain HTML table for this turned out to be a dead end - border-collapse,
  // row-height rounding, and the global `table { overflow: hidden }` rule kept eating a
  // sliver off the last row's cell borders no matter how that was patched. CSS grid
  // sidesteps all of that: every cell is sized/positioned independently, so there's no
  // table-layout box for a border to get clipped against.
  // 「16之1」「34之2」這種帶「之」的門牌比純數字寬,固定 34px 方格會把文字擠到
  // 換行(「16之」斷成兩行);這種格子改窄字級 + 不換行,寧可格子本身變寬一點。
  const wideCls = (label) => (String(label).includes("之") ? " bv-cell-wide" : "");
  const cornerHtml = `<div class="bv-grid-corner"></div>`;
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
          if (!cell) return `<div class="bv-cell bv-cell-empty${wide}">${escapeHtml(String(cellLabel))}</div>`;
          const multiOwner = cell.owners.length > 1;
          // 紫色「共有」樣式只給地下層(floorSort < 0,B1/B2...)用 —— 地上樓層本來就
          // 可能是好幾位家人共同繼承同一戶,不是「依持分比例登記的地下室/車位」那種
          // 特殊情況,不該也套紫色框,不然會被誤會成同一種東西。地上樓層多共有人還是
          // 照舊顯示×N角標,只是用預設(非紫)顏色。
          const basement = floorSort < 0;
          const shared = multiOwner && basement;
          const badge = multiOwner ? `<span class="bv-cell-badge${shared ? " bv-cell-badge-shared" : ""}">×${cell.owners.length}</span>` : "";
          const sharedCls = shared ? " bv-cell-shared" : "";
          const fillStyle = buildingViewCellFillStyle(cell);
          return `<div class="bv-cell${wide}${sharedCls} ${buildingViewCellClass(cell.status)}"${fillStyle} data-bv-cell="${floorSort}|${door}" data-bv-group="${g.key}" title="${escapeHtml(buildingViewCellTooltip(cell))}"><span class="bv-cell-label">${escapeHtml(String(cellLabel))}</span>${badge}</div>`;
        })
        .join("");
      return rowLabelHtml + cellsHtml;
    })
    .join("");

  return `
    <div class="card bv-group${!flipped && cols.length > 8 ? " bv-group-wide" : ""}" draggable="true" data-bv-group-key="${g.key}">
      <div class="bv-group-header">
        <span class="bv-drag-handle" title="拖曳調整順序">⠿</span>
        <span class="bv-group-title">🏢 ${escapeHtml(g.title)}</span>
        <span class="bv-group-meta">${unitCount} 戶 · 已簽 ${agreedCount}</span>
        <button type="button" class="btn-secondary btn-sm bv-flip-btn" data-bv-flip="${g.key}">${flipped ? "樓層→" : "號碼→"}</button>
      </div>
      <div class="bv-grid-wrap">
        <div class="bv-grid" style="grid-template-columns:auto repeat(${cols.length}, auto)">
          ${cornerHtml}${headerCellsHtml}${bodyHtml}
        </div>
      </div>
    </div>`;
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
  return `
    <div class="bv-owner-row">
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
    <div class="card bv-group" style="margin-top:16px">
      <div class="bv-group-header">
        <span class="bv-group-title">🗺️ 純土地地主(無建物登記)</span>
        <span class="bv-group-meta">${owners.length} 人</span>
      </div>
      <div class="bv-owner-list" style="padding:12px 16px">
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

  el.innerHTML = `
    <div class="section-toolbar">
      <h3>樓棟視圖</h3>
      <span class="helper-text">💡 拖曳區塊可調整順序;點格子開地主編輯視窗</span>
    </div>
    <div class="bv-legend">${buildingViewLegendHtml()}</div>
    <div id="bv-groups" class="bv-groups-grid">${groups.map(buildingViewGroupCardHtml).join("")}</div>
    ${buildingViewLandOnlySectionHtml(landOnlyOwners)}
  `;
  wireLandOnlyOwnerLinks(el);

  const groupsByKey = new Map(groups.map((g) => [g.key, g]));
  const container = document.getElementById("bv-groups");

  const rerenderGroup = (key) => {
    const card = container.querySelector(`[data-bv-group-key="${CSS.escape(key)}"]`);
    if (!card) return;
    card.outerHTML = buildingViewGroupCardHtml(groupsByKey.get(key));
    wireGroupCard(key);
  };

  function wireGroupCard(key) {
    const card = container.querySelector(`[data-bv-group-key="${CSS.escape(key)}"]`);
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

  groups.forEach((g) => wireGroupCard(g.key));
}

