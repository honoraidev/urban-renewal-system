"use strict";

// 部門物品管制表 — 依 department 欄位分部門檢視的單一清單。
// 所有登入者皆可新增/編輯/刪除(後端用 get_current_user)。

let inventoryCache = [];
let inventoryCurDept = "全部";
let inventorySearchQuery = "";
let inventoryUserDir = {}; // { 部門名稱: [員工姓名, ...] } — 保管人/領用人選單用
let inventoryViewMode = "list"; // list | grid
let inventorySortMode = "created_desc"; // created_desc | created_asc | name_asc
let inventoryStatusFilter = new Set(); // 空集合 = 不篩選狀態

const INVENTORY_STATUS_OPTIONS = ["正常", "報修", "報廢", "外借"];
// 部門候選:通用部門清單 + 員工名冊裡的部門 + 目前資料裡出現過的
function _invDeptOptions() {
  const canon = typeof DEPARTMENT_OPTIONS !== "undefined" ? DEPARTMENT_OPTIONS : [];
  const dir = Object.keys(inventoryUserDir);
  const known = inventoryCache.flatMap((i) => [i.department, i.custodian_dept, i.borrower_dept]).map((s) => (s || "").trim()).filter(Boolean);
  return [...new Set([...canon, ...dir, ...known])];
}
// 某部門的人:員工名冊為主,加上資料裡出現過、掛在這個部門的保管人/領用人
function _invPeopleOf(dept) {
  const d = (dept || "").trim();
  const fromDir = inventoryUserDir[d] || [];
  const fromData = inventoryCache
    .flatMap((i) => [[i.custodian_dept, i.custodian], [i.borrower_dept, i.borrower]])
    .filter(([dd, nn]) => (dd || "").trim() === d && (nn || "").trim())
    .map(([, nn]) => nn.trim());
  return [...new Set([...fromDir, ...fromData])];
}
const INVENTORY_STATUS_STYLE = {
  正常: "background:#dcfce7;color:#15803d;border:1px solid #bbf7d0",
  報修: "background:#fef3c7;color:#b45309;border:1px solid #fde68a",
  報廢: "background:#fee2e2;color:#b91c1c;border:1px solid #fecaca",
  外借: "background:#e0f2fe;color:#0369a1;border:1px solid #bae6fd",
};

// 部門頁籤圖示(線條 SVG)+ 代表色 — 依常見部門關鍵字比對,自訂部門名稱沒對到就用通用圖示 + 依名稱挑一個顏色。
const _ivSvg = (body) =>
  `<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const IV_ICON_ALL = _ivSvg('<g fill="currentColor" stroke="none"><rect x="4" y="4" width="4" height="4" rx="1"/><rect x="10" y="4" width="4" height="4" rx="1"/><rect x="16" y="4" width="4" height="4" rx="1"/><rect x="4" y="10" width="4" height="4" rx="1"/><rect x="10" y="10" width="4" height="4" rx="1"/><rect x="16" y="10" width="4" height="4" rx="1"/><rect x="4" y="16" width="4" height="4" rx="1"/><rect x="10" y="16" width="4" height="4" rx="1"/><rect x="16" y="16" width="4" height="4" rx="1"/></g>');
const IV_ICON_RULES = [
  { test: /行政|總務|人資|秘書|董事長|顧問/, icon: _ivSvg('<rect x="6" y="3" width="12" height="18" rx="2"/><path d="M9 3v2h6V3M9 9h6M9 13h6M9 17h4"/>'), tone: "#0d9488" },
  { test: /工務|工程|機電|營建|建管/, icon: _ivSvg('<path d="M3 13a9 9 0 0 1 18 0Z"/><path d="M3 13h18v3H3z"/><path d="M12 4v3"/>'), tone: "#ea580c" },
  { test: /業務|行銷|開發|銷售/, icon: _ivSvg('<circle cx="9" cy="8" r="3.4"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.8a3.4 3.4 0 0 1 0 6.4M18.5 14.2a6.5 6.5 0 0 1 3 5.8"/>'), tone: "#2563eb" },
  { test: /財務|會計|採購|成本/, icon: _ivSvg('<circle cx="12" cy="7" r="4.2"/><path d="M5 21c0-3.9 3.1-7 7-7s7 3.1 7 7"/><path d="M12 5.2v3.6M10.5 8.4h3"/>'), tone: "#ca8a04" },
  { test: /資訊|數位|IT|AI/i, icon: _ivSvg('<rect x="3" y="4.5" width="18" height="12" rx="1.6"/><path d="M8 20h8M12 16.5V20"/>'), tone: "#7c3aed" },
  { test: /其他|雜項/, icon: _ivSvg('<circle cx="6" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="1.4" fill="currentColor" stroke="none"/>'), tone: "#64748b" },
];
const IV_ICON_DEFAULT = _ivSvg('<path d="M21 8l-9-5-9 5 9 5 9-5Z"/><path d="M3 8v8l9 5 9-5V8M12 13v8"/>');
const IV_TONE_FALLBACK = ["#db2777", "#0891b2", "#16a34a", "#4f46e5", "#c2410c"];

function _ivDeptIcon(dept) {
  const rule = IV_ICON_RULES.find((r) => r.test.test(dept || ""));
  return rule ? rule.icon : IV_ICON_DEFAULT;
}
function _ivTone(dept) {
  const rule = IV_ICON_RULES.find((r) => r.test.test(dept || ""));
  if (rule) return rule.tone;
  let h = 0;
  for (const ch of dept || "") h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return IV_TONE_FALLBACK[h % IV_TONE_FALLBACK.length];
}

const INVENTORY_FIELDS = [
  { key: "custodian_dept", label: "保管人部門", type: "dropdown", opts: _invDeptOptions, section: "保管 / 取得" },
  { key: "custodian", label: "保管人", type: "person", deptField: "custodian_dept" },
  { key: "asset_no", label: "財產編號" },
  { key: "acquired_date", label: "取得日期", type: "date" },
  { key: "unit_price", label: "單價 / 金額", type: "number" },
  { key: "name", label: "物品名稱", required: true, section: "基本資料 / 領用歸還" },
  { key: "category", label: "分類" },
  { key: "quantity", label: "數量", type: "number" },
  { key: "location", label: "存放位置" },
  { key: "status", label: "狀態", type: "select", options: INVENTORY_STATUS_OPTIONS },
  { key: "borrower_dept", label: "領用人部門", type: "dropdown", opts: _invDeptOptions },
  { key: "borrower", label: "領用人", type: "person", deptField: "borrower_dept" },
  { key: "issued_date", label: "領用日期", type: "date" },
  { key: "expected_return_date", label: "預計歸還", type: "date" },
  { key: "returned_date", label: "實際歸還", type: "date" },
  { key: "notes", label: "備註", type: "textarea", section: "備註", full: true },
];

async function goToInventory() {
  setActiveNav("inventory");
  showView("view-inventory");
  inventorySearchQuery = "";
  inventoryStatusFilter = new Set();
  document.getElementById("inv-filter-panel")?.classList.add("hidden");
  const searchInput = document.getElementById("inventory-search-input");
  if (searchInput) searchInput.value = "";
  // 新增 / 編輯 / 刪除限 L0~L2(管理層);其餘唯讀
  document.getElementById("new-inventory-btn")?.classList.toggle("hidden", !isManager());
  await loadInventory();
}

async function loadInventory() {
  const wrap = document.getElementById("inventory-table-wrap");
  if (!wrap) return;
  wrap.innerHTML = `<div class="empty-state">載入中...</div>`;
  try {
    inventoryCache = (await api("/inventory-items")) || [];
  } catch (err) {
    wrap.innerHTML = `<div class="empty-state">載入失敗</div>`;
    return;
  }
  try {
    const dir = (await api("/users/directory", { silent: true })) || [];
    inventoryUserDir = {};
    dir.forEach((u) => {
      (u.departments || []).forEach((d) => {
        const k = (d || "").trim();
        if (!k) return;
        (inventoryUserDir[k] = inventoryUserDir[k] || []).push(u.display_name);
      });
    });
  } catch (e) {
    inventoryUserDir = {};
  }

  const _dep = (i) => (i.custodian_dept || "").trim();
  const depts = [...new Set(inventoryCache.map(_dep).filter(Boolean))].sort();
  if (inventoryCurDept !== "全部" && inventoryCurDept !== "未分部門" && !depts.includes(inventoryCurDept)) inventoryCurDept = "全部";
  const hasUnassigned = inventoryCache.some((i) => !_dep(i));
  const bar = document.getElementById("inventory-dept-bar");
  if (bar) {
    bar.innerHTML = ["全部", ...depts, ...(hasUnassigned ? ["未分部門"] : [])]
      .map((d) => {
        const cnt = inventoryCache.filter((i) => (d === "全部" ? true : d === "未分部門" ? !_dep(i) : _dep(i) === d)).length;
        const icon = d === "全部" ? IV_ICON_ALL : _ivDeptIcon(d);
        const tone = d === "全部" ? "var(--brand)" : _ivTone(d);
        return `<button type="button" class="iv-tab ${inventoryCurDept === d ? "act" : ""}" data-inv-dept="${escapeHtml(d)}" style="--tone:${tone}">
          <span class="iv-tab-ic">${icon}</span>
          <span class="iv-tab-text"><span class="iv-tab-name">${escapeHtml(d)}</span><span class="iv-tab-n">${cnt}</span></span>
        </button>`;
      })
      .join("");
    bar.querySelectorAll("[data-inv-dept]").forEach((btn) => {
      btn.addEventListener("click", () => {
        inventoryCurDept = btn.dataset.invDept;
        bar.querySelectorAll("[data-inv-dept]").forEach((b) => b.classList.toggle("act", b.dataset.invDept === inventoryCurDept));
        renderInventoryTable();
      });
    });
  }

  const searchInput = document.getElementById("inventory-search-input");
  if (searchInput) {
    searchInput.oninput = (e) => {
      inventorySearchQuery = e.target.value;
      renderInventoryTable();
    };
  }

  renderInventoryTable();
}

function _ivSortRows(rows) {
  const sorted = [...rows];
  if (inventorySortMode === "name_asc") {
    sorted.sort((a, b) => (a.name || "").localeCompare(b.name || "", "zh-Hant"));
  } else if (inventorySortMode === "created_asc") {
    sorted.sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0));
  } else {
    sorted.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  }
  return sorted;
}

function _ivFilteredRows() {
  const q = (inventorySearchQuery || "").toLowerCase().trim();
  const rows = inventoryCache.filter((i) => {
    const dep = (i.custodian_dept || "").trim();
    if (inventoryCurDept === "未分部門" && dep) return false;
    if (inventoryCurDept !== "全部" && inventoryCurDept !== "未分部門" && dep !== inventoryCurDept) return false;
    if (inventoryStatusFilter.size && !inventoryStatusFilter.has(i.status || "正常")) return false;
    if (!q) return true;
    return [i.name, i.category, i.location, i.custodian, i.asset_no, i.borrower, i.notes]
      .map((v) => (v || "").toLowerCase())
      .some((v) => v.includes(q));
  });
  return _ivSortRows(rows);
}

function _ivEmptyHtml() {
  const hasAnyData = inventoryCache.length > 0;
  if (!hasAnyData) {
    return `
      <div class="iv-empty">
        <div class="iv-empty-icon">📦</div>
        <h3 class="iv-empty-title">尚無物品資料</h3>
        <p class="iv-empty-sub">開始建立公司物品清單,方便管理與追蹤。</p>
        ${isManager() ? `<button type="button" class="btn-primary iv-empty-btn" id="inv-empty-add-btn">+ 新增物品</button>` : ""}
      </div>
      <div class="iv-tips">
        <div class="iv-tip"><div class="iv-tip-icon">📦</div><div class="iv-tip-title">建立物品</div><div class="iv-tip-desc">新增物品資訊<br>包含名稱、型號等</div></div>
        <div class="iv-tip"><div class="iv-tip-icon">👤</div><div class="iv-tip-title">指定保管人</div><div class="iv-tip-desc">分配保管人員<br>明確責任歸屬</div></div>
        <div class="iv-tip"><div class="iv-tip-icon">🏷️</div><div class="iv-tip-title">設定財產編號</div><div class="iv-tip-desc">建立唯一編號<br>便於追蹤管理</div></div>
        <div class="iv-tip"><div class="iv-tip-icon">📊</div><div class="iv-tip-title">掌握使用狀況</div><div class="iv-tip-desc">即時查看各部門<br>物品數量與狀態</div></div>
      </div>`;
  }
  return `
    <div class="iv-empty">
      <div class="iv-empty-icon">🔍</div>
      <h3 class="iv-empty-title">尚無符合條件的物品</h3>
      <p class="iv-empty-sub">試著調整搜尋關鍵字、部門或篩選條件。</p>
    </div>`;
}

function renderInventoryTable() {
  const wrap = document.getElementById("inventory-table-wrap");
  if (!wrap) return;
  const showDeptCol = inventoryCurDept === "全部";
  const rows = _ivFilteredRows();

  const titleEl = document.getElementById("inv-list-title");
  if (titleEl) titleEl.textContent = `物品列表(${rows.length})`;
  const badge = document.getElementById("inv-filter-badge");
  if (badge) {
    badge.textContent = String(inventoryStatusFilter.size);
    badge.classList.toggle("hidden", inventoryStatusFilter.size === 0);
  }

  if (!rows.length) {
    wrap.innerHTML = _ivEmptyHtml();
    wrap.querySelector("#inv-empty-add-btn")?.addEventListener("click", () => openInventoryFormModal("新增物品", null));
    return;
  }

  wrap.innerHTML = inventoryViewMode === "grid" ? _ivGridHtml(rows) : _ivListHtml(rows, showDeptCol);
  _ivBindRowActions(wrap);
}

function _ivListHtml(rows, showDeptCol) {
  const th = (t) => `<th style="white-space:nowrap">${t}</th>`;
  const td = (v) => `<td>${escapeHtml(v == null || v === "" ? "-" : String(v))}</td>`;
  return `
    <div class="table-wrap" style="overflow-x:auto">
      <table>
        <thead><tr>
          ${showDeptCol ? th("保管人部門") : ""}
          ${th("物品名稱")}${th("分類")}${th("數量")}${th("存放位置")}${th("狀態")}
          ${th("保管人")}${th("財產編號")}${th("領用人")}${th("領用日期")}${th("預計歸還")}${th("實際歸還")}${th("備註")}${isManager() ? th("操作") : ""}
        </tr></thead>
        <tbody>
          ${rows
      .map((i) => {
        const stStyle = INVENTORY_STATUS_STYLE[i.status] || INVENTORY_STATUS_STYLE["正常"];
        return `<tr>
              ${showDeptCol ? td(i.custodian_dept) : ""}
              <td style="font-weight:600;white-space:nowrap">${escapeHtml(i.name || "-")}</td>
              ${td(i.category)}${td(i.quantity)}${td(i.location)}
              <td><span style="display:inline-block;padding:2px 10px;border-radius:6px;font-size:12px;font-weight:600;${stStyle}">${escapeHtml(i.status || "正常")}</span></td>
              ${td(i.custodian)}${td(i.asset_no)}${td(i.borrower)}${td(i.issued_date)}${td(i.expected_return_date)}${td(i.returned_date)}
              <td style="max-width:200px;white-space:pre-wrap">${escapeHtml(i.notes || "-")}</td>
              ${isManager() ? `<td class="actions-cell" style="white-space:nowrap">
                <button class="btn-secondary btn-sm" data-edit-inv="${i.id}">編輯</button>
                <button class="btn-danger btn-sm" data-del-inv="${i.id}">刪除</button>
              </td>` : ""}
            </tr>`;
      })
      .join("")}
        </tbody>
      </table>
    </div>`;
}

function _ivGridHtml(rows) {
  return `<div class="iv-grid-list">${rows
    .map((i) => {
      const stStyle = INVENTORY_STATUS_STYLE[i.status] || INVENTORY_STATUS_STYLE["正常"];
      return `<div class="iv-item-card">
        <div class="iv-item-card-head">
          <div class="iv-item-name">${escapeHtml(i.name || "-")}</div>
          <span style="display:inline-block;flex:0 0 auto;padding:2px 10px;border-radius:6px;font-size:11.5px;font-weight:700;${stStyle}">${escapeHtml(i.status || "正常")}</span>
        </div>
        <div class="iv-item-row"><b>部門</b>${escapeHtml(i.custodian_dept || "-")}</div>
        <div class="iv-item-row"><b>保管人</b>${escapeHtml(i.custodian || "-")}</div>
        <div class="iv-item-row"><b>財產編號</b>${escapeHtml(i.asset_no || "-")}</div>
        <div class="iv-item-row"><b>存放位置</b>${escapeHtml(i.location || "-")}</div>
        ${isManager() ? `<div class="iv-item-actions">
          <button class="btn-secondary btn-sm" data-edit-inv="${i.id}">編輯</button>
          <button class="btn-danger btn-sm" data-del-inv="${i.id}">刪除</button>
        </div>` : ""}
      </div>`;
    })
    .join("")}</div>`;
}

function _ivBindRowActions(wrap) {
  wrap.querySelectorAll("[data-edit-inv]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = inventoryCache.find((x) => x.id === Number(btn.dataset.editInv));
      openInventoryFormModal("編輯物品", item);
    });
  });
  wrap.querySelectorAll("[data-del-inv]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const item = inventoryCache.find((x) => x.id === Number(btn.dataset.delInv));
      if (!confirm(`確定要刪除「${item ? item.name : ""}」這筆物品嗎?`)) return;
      try {
        await api(`/inventory-items/${btn.dataset.delInv}`, { method: "DELETE" });
        toast("已刪除", "success");
        loadInventory();
      } catch (err) { }
    });
  });
}

// 匯出目前篩選/排序後的清單為 CSV(Excel 可直接開,加 BOM 避免中文亂碼)。
function _ivExportCsv() {
  const rows = _ivFilteredRows();
  if (!rows.length) {
    toast("目前沒有可匯出的物品", "error");
    return;
  }
  const cols = [
    ["custodian_dept", "保管人部門"], ["name", "物品名稱"], ["category", "分類"], ["quantity", "數量"],
    ["location", "存放位置"], ["status", "狀態"], ["custodian", "保管人"], ["asset_no", "財產編號"],
    ["borrower", "領用人"], ["issued_date", "領用日期"], ["expected_return_date", "預計歸還"],
    ["returned_date", "實際歸還"], ["notes", "備註"],
  ];
  const esc = (v) => `"${String(v == null ? "" : v).replace(/"/g, '""')}"`;
  const lines = [cols.map((c) => esc(c[1])).join(",")];
  rows.forEach((i) => lines.push(cols.map((c) => esc(i[c[0]])).join(",")));
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `部門物品清單_${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function openInventoryFormModal(title, item) {
  const curDeptDefault = item ? item.department || "" : inventoryCurDept === "全部" ? "" : inventoryCurDept;

  const fieldHtml = (f) => {
    const v = item ? item[f.key] : f.key === "status" ? "正常" : f.key === "quantity" ? 1 : "";
    const val = v == null ? "" : String(v);
    let input;
    if (f.type === "textarea") {
      input = `<textarea name="${f.key}" rows="3">${escapeHtml(val)}</textarea>`;
    } else if (f.type === "select") {
      input = `<select name="${f.key}">${f.options
        .map((o) => `<option value="${escapeHtml(o)}" ${val === o ? "selected" : ""}>${escapeHtml(o)}</option>`)
        .join("")}</select>`;
    } else if (f.type === "dropdown") {
      const optList = typeof f.opts === "function" ? f.opts() : f.opts || [];
      const cur = f.key === "custodian_dept" ? val || curDeptDefault : val;
      const all = [...new Set([...(cur ? [cur] : []), ...optList])];
      input = `<select name="${f.key}" ${f.required ? "required" : ""}>
        ${f.required ? "" : `<option value="" ${cur === "" ? "selected" : ""}>(未指定)</option>`}
        ${all.map((o) => `<option value="${escapeHtml(o)}" ${cur === o ? "selected" : ""}>${escapeHtml(o)}</option>`).join("")}
        <option value="__new__">＋ 其他…</option>
      </select>`;
    } else if (f.type === "person") {
      const dept = item ? item[f.deptField] || "" : "";
      const people = _invPeopleOf(dept);
      const all = [...new Set([...(val ? [val] : []), ...people])];
      input = `<select name="${f.key}" data-person-of="${f.deptField}">
        <option value="" ${val === "" ? "selected" : ""}>(無指定人)</option>
        ${all.map((o) => `<option value="${escapeHtml(o)}" ${val === o ? "selected" : ""}>${escapeHtml(o)}</option>`).join("")}
        <option value="__new__">＋ 其他…</option>
      </select>`;
    } else {
      const type = f.type === "date" ? "date" : f.type === "number" ? "number" : "text";
      const step = f.key === "unit_price" ? ' step="0.01"' : "";
      input = `<input type="${type}"${step} name="${f.key}" ${f.required ? "required" : ""} value="${escapeHtml(val)}">`;
    }
    return `<div class="field inv-field${f.full ? " inv-field-full" : ""}"><label>${f.label}${f.required ? " *" : ""}</label>${input}</div>`;
  };

  // 依 section 分組
  const sections = [];
  INVENTORY_FIELDS.forEach((f) => {
    if (f.section || !sections.length) sections.push({ title: f.section || "", fields: [] });
    sections[sections.length - 1].fields.push(f);
  });

  const body = `
    <style>
      #inventory-form .inv-sec { background:var(--bg-subtle,#f8fafc); border:1px solid var(--border); border-radius:12px; padding:14px 16px 4px; margin-bottom:14px; }
      #inventory-form .inv-sec-title { font-weight:700; font-size:13px; color:var(--brand,#0d9488); margin:0 0 10px; letter-spacing:.02em; }
      #inventory-form .inv-grid { display:grid; grid-template-columns:1fr 1fr; gap:12px 16px; }
      #inventory-form .inv-field { margin:0 0 12px; }
      #inventory-form .inv-field-full { grid-column:1 / -1; }
      #inventory-form .inv-field label { display:block; font-size:12.5px; font-weight:600; color:var(--text-muted); margin-bottom:5px; }
      #inventory-form .inv-field input, #inventory-form .inv-field select, #inventory-form .inv-field textarea {
        width:100%; box-sizing:border-box; padding:8px 10px; border:1px solid var(--border); border-radius:8px;
        font-size:14px; background:var(--surface); transition:border-color .12s, box-shadow .12s;
      }
      #inventory-form .inv-field input:focus, #inventory-form .inv-field select:focus, #inventory-form .inv-field textarea:focus {
        outline:none; border-color:var(--brand,#0d9488); box-shadow:0 0 0 3px rgba(13,148,136,.12);
      }
      @media (max-width:560px){ #inventory-form .inv-grid { grid-template-columns:1fr; } }
    </style>
    <form id="inventory-form">
      ${sections
        .map(
          (s) => `<div class="inv-sec">
            ${s.title ? `<p class="inv-sec-title">${escapeHtml(s.title)}</p>` : ""}
            <div class="inv-grid">${s.fields.map(fieldHtml).join("")}</div>
          </div>`
        )
        .join("")}
      <div class="modal-footer">
        <button type="button" class="btn-secondary" onclick="closeModal()">取消</button>
        <button type="submit" class="btn-primary">儲存</button>
      </div>
    </form>`;

  openModal(title, body, { width: "680px" });

  // 保管人/領用人:改部門就重建「該部門的人」下拉(保留「(無指定人)」)
  document.querySelectorAll('#inventory-form select[data-person-of]').forEach((psel) => {
    const dsel = document.querySelector(`#inventory-form select[name="${psel.dataset.personOf}"]`);
    if (!dsel) return;
    dsel.addEventListener("change", () => {
      const cur = psel.value;
      const people = _invPeopleOf(dsel.value === "__new__" ? "" : dsel.value);
      psel.innerHTML =
        `<option value="">(無指定人)</option>` +
        people.map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join("") +
        `<option value="__new__">＋ 其他…</option>`;
      psel.value = people.includes(cur) ? cur : "";
    });
  });

  // 下拉選「＋ 其他…」→ 輸入新值,塞成選項並選起來
  document.querySelectorAll("#inventory-form select").forEach((sel) => {
    let prev = sel.value;
    sel.addEventListener("change", () => {
      if (sel.value === "__new__") {
        const name = (prompt("輸入新項目:") || "").trim();
        if (name) {
          const opt = document.createElement("option");
          opt.value = name;
          opt.textContent = name;
          sel.insertBefore(opt, sel.querySelector('option[value="__new__"]'));
          sel.value = name;
        } else {
          sel.value = prev;
        }
      }
      prev = sel.value;
    });
  });

  document.getElementById("inventory-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = {};
    for (const f of INVENTORY_FIELDS) {
      let raw = (fd.get(f.key) ?? "").toString().trim();
      if (raw === "__new__") raw = "";
      if (f.type === "number") {
        payload[f.key] = raw === "" ? (f.key === "quantity" ? 1 : null) : Number(raw);
      } else {
        payload[f.key] = raw;
      }
    }
    try {
      if (item) {
        await api(`/inventory-items/${item.id}`, { method: "PATCH", body: payload });
      } else {
        await api("/inventory-items", { method: "POST", body: payload });
      }
      closeModal();
      toast("已儲存", "success");
      loadInventory();
    } catch (err) { }
  });
}

function initInventory() {
  document.getElementById("new-inventory-btn")?.addEventListener("click", () => {
    openInventoryFormModal("新增物品", null);
  });
  document.getElementById("inv-crumb-home")?.addEventListener("click", (e) => {
    e.preventDefault();
    goToDashboard();
  });
  document.getElementById("inv-export-btn")?.addEventListener("click", _ivExportCsv);
  document.getElementById("inv-search-btn")?.addEventListener("click", () => {
    inventorySearchQuery = document.getElementById("inventory-search-input")?.value || "";
    renderInventoryTable();
  });

  // 清單 / 卡片檢視切換
  document.getElementById("inv-view-toggle")?.querySelectorAll("[data-inv-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      inventoryViewMode = btn.dataset.invView;
      document.querySelectorAll("#inv-view-toggle [data-inv-view]").forEach((b) => b.classList.toggle("act", b === btn));
      renderInventoryTable();
    });
  });

  // 排序
  document.getElementById("inv-sort-select")?.addEventListener("change", (e) => {
    inventorySortMode = e.target.value;
    renderInventoryTable();
  });

  // 進階篩選(狀態多選)面板
  const filterBtn = document.getElementById("inv-filter-btn");
  const filterPanel = document.getElementById("inv-filter-panel");
  const statusWrap = document.getElementById("inv-filter-status");
  if (statusWrap) {
    statusWrap.innerHTML = INVENTORY_STATUS_OPTIONS
      .map((s) => `<button type="button" class="iv-filter-chip" data-inv-status="${escapeHtml(s)}">${escapeHtml(s)}</button>`)
      .join("");
    statusWrap.querySelectorAll("[data-inv-status]").forEach((chip) => {
      chip.addEventListener("click", () => {
        const s = chip.dataset.invStatus;
        if (inventoryStatusFilter.has(s)) inventoryStatusFilter.delete(s);
        else inventoryStatusFilter.add(s);
        chip.classList.toggle("act", inventoryStatusFilter.has(s));
        renderInventoryTable();
      });
    });
  }
  filterBtn?.addEventListener("click", (e) => {
    e.stopPropagation();
    filterPanel?.classList.toggle("hidden");
  });
  filterPanel?.addEventListener("click", (e) => e.stopPropagation());
  document.getElementById("inv-filter-clear")?.addEventListener("click", () => {
    inventoryStatusFilter.clear();
    statusWrap?.querySelectorAll("[data-inv-status]").forEach((c) => c.classList.remove("act"));
    renderInventoryTable();
  });
  document.addEventListener("click", () => filterPanel?.classList.add("hidden"));
}
