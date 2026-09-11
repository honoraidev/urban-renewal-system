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

const BUILDING_VIEW_STATUS_LABEL = { agreed: "同意", opposed: "反對", pending: "待確認" };

// 簽約 / 拜訪狀態在樓棟視圖直接顯示、點擊切換(整合清冊與登記清冊不再顯示)。
const BUILDING_VIEW_TOGGLES = {
  agreement_status: { on: "signed", off: "not_signed", labels: AGREEMENT_STATUS_LABEL },
  visit_status: { on: "visited", off: "not_visited", labels: VISIT_STATUS_LABEL },
};
// landowner_id -> { agreement_status, visit_status };同一位地主可能出現在好幾格,切換後每格都要一致。
let buildingViewOwnerStatus = new Map();

function buildingViewStatusChipsHtml(o) {
  const current = buildingViewOwnerStatus.get(o.landowner_id) || o;
  return Object.entries(BUILDING_VIEW_TOGGLES)
    .map(([field, t]) => {
      const on = current[field] === t.on;
      const label = escapeHtml(t.labels[on ? t.on : t.off]);
      return isEditor()
        ? `<button type="button" class="mini-badge bv-status-chip ${on ? "gate-ok" : ""}" data-bv-toggle="${field}" data-bv-owner="${o.landowner_id}" title="點擊切換">${label}</button>`
        : `<span class="mini-badge ${on ? "gate-ok" : ""}">${label}</span>`;
    })
    .join("");
}

function wireBuildingViewStatusChips(root) {
  if (!root) return;
  root.querySelectorAll("[data-bv-toggle]").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (btn.disabled) return;
      const field = btn.dataset.bvToggle;
      const id = Number(btn.dataset.bvOwner);
      const t = BUILDING_VIEW_TOGGLES[field];
      const pid = state.currentProjectId;
      const current = buildingViewOwnerStatus.get(id) || {};
      const next = current[field] === t.on ? t.off : t.on;
      btn.disabled = true;
      try {
        await api(`/projects/${pid}/landowners/${id}`, { method: "PATCH", body: { [field]: next } });
        buildingViewOwnerStatus.set(id, { ...current, [field]: next });
        const cached = (state.projectCache[pid]?.landowners || []).find((x) => x.id === id);
        if (cached) cached[field] = next;
        btn.classList.toggle("gate-ok", next === t.on);
        btn.textContent = t.labels[next];
        syncProjectAggregates();
      } catch (err) {
      } finally {
        btn.disabled = false;
      }
    });
  });
}

function buildingViewCellClass(status) {
  if (status === "agreed") return "bv-cell-agreed";
  if (status === "opposed") return "bv-cell-opposed";
  if (status === "pending") return "bv-cell-pending";
  return "bv-cell-empty";
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
  const cornerHtml = `<div class="bv-grid-corner"></div>`;
  const headerCellsHtml = cols.map((c) => `<div class="bv-col-label">${escapeHtml(c.label)}</div>`).join("");
  const bodyHtml = rows
    .map((r) => {
      const rowLabelHtml = `<div class="bv-row-label">${escapeHtml(r.label)}</div>`;
      const cellsHtml = cols
        .map((c) => {
          const floorSort = flipped ? c.key : r.key;
          const door = flipped ? r.key : c.key;
          const cell = g.cells[`${floorSort}|${door}`];
          const cellLabel = flipped ? g.floors.find((f) => f.sort === c.key)?.label : door;
          if (!cell) return `<div class="bv-cell bv-cell-empty">${escapeHtml(String(cellLabel))}</div>`;
          const badge = cell.owners.length > 1 ? `<span class="bv-cell-badge">×${cell.owners.length}</span>` : "";
          return `<div class="bv-cell ${buildingViewCellClass(cell.status)}" data-bv-cell="${floorSort}|${door}" data-bv-group="${g.key}"><span class="bv-cell-label">${escapeHtml(String(cellLabel))}</span>${badge}</div>`;
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
  const phone = (o.phone || "").trim();
  const parcels = [...new Set(o.parcels || [])].join("、") || "-";
  return `
    <div class="bv-owner-row">
      <span class="bv-owner-avatar">${escapeHtml(initial)}</span>
      <div class="bv-owner-main">
        <a href="#" data-bv-open-owner="${o.landowner_id}" class="bv-owner-name">${nm}<span class="bv-owner-go">查看 ›</span></a>
        <div class="bv-owner-phone ${phone ? "" : "is-empty"}">🗺️ 地號:${escapeHtml(parcels)}</div>
        <div class="bv-owner-phone ${phone ? "" : "is-empty"}">${phone ? `📞 ${escapeHtml(phone)}` : "尚未提供電話"}</div>
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
  wireBuildingViewStatusChips(el);
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
      <div class="section-toolbar"><h3>樓棟視圖</h3></div>
      <div class="empty-state">尚無建物地址資料可供產生樓棟視圖,請先於「登記資料 → 建物登記」匯入建物資料</div>
      ${buildingViewLandOnlySectionHtml(landOnlyOwners)}
    `;
    wireLandOnlyOwnerLinks(el);
    return;
  }

  el.innerHTML = `
    <div class="section-toolbar">
      <h3>樓棟視圖</h3>
      <span class="helper-text">💡 拖曳區塊可調整順序</span>
    </div>
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
        openBuildingViewCellModal(cell);
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

function openBuildingViewCellModal(cell) {
  if (!cell || !cell.owners.length) return;
  const rowsHtml = cell.owners
    .map((o) => {
      const nm = escapeHtml(o.name) || "-";
      const initial = (o.name || "?").trim().charAt(0) || "?";
      const st = o.consent_status === "agreed" ? "status-active" : o.consent_status === "opposed" ? "status-suspended" : "status-closed";
      const phone = (o.phone || "").trim();
      return `
      <div class="bv-owner-row">
        <span class="bv-owner-avatar">${escapeHtml(initial)}</span>
        <div class="bv-owner-main">
          <a href="#" data-bv-open-owner="${o.landowner_id}" class="bv-owner-name">${nm}<span class="bv-owner-go">查看 ›</span></a>
          <div class="bv-owner-phone ${phone ? "" : "is-empty"}">${phone ? `📞 ${escapeHtml(phone)}` : "尚未提供電話"}</div>
        </div>
        <span class="bv-status-chips">${buildingViewStatusChipsHtml(o)}</span>
        <span class="status-badge ${st}">${BUILDING_VIEW_STATUS_LABEL[o.consent_status] || o.consent_status}</span>
      </div>`;
    })
    .join("");
  const title = cell.label || cell.address ? `此門牌共有人 · ${escapeHtml(cell.label || cell.address)}` : "此門牌共有人";
  openModal(title, `<div class="bv-owner-list">${rowsHtml}</div>`, { width: "480px" });
  wireBuildingViewStatusChips(document.getElementById("modal-root"));
  document.querySelectorAll("[data-bv-open-owner]").forEach((a) => {
    a.addEventListener("click", async (e) => {
      e.preventDefault();
      const landownerId = Number(a.dataset.bvOpenOwner);
      const pid = state.currentProjectId;
      if (!state.projectCache[pid].landowners) {
        state.projectCache[pid].landowners = await api(`/projects/${pid}/landowners`);
      }
      closeModal();
      openEditLandownerModal(landownerId);
    });
  });
}
