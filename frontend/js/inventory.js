"use strict";

// 部門物品管制表 — 依 department 欄位分部門檢視的單一清單。
// 所有登入者皆可新增/編輯/刪除(後端用 get_current_user)。

let inventoryCache = [];
let inventoryCurDept = "全部";
let inventorySearchQuery = "";

const INVENTORY_STATUS_OPTIONS = ["正常", "報修", "報廢", "外借"];
const INVENTORY_UNIT_OPTIONS = ["個", "台", "支", "組", "套", "箱", "包", "捲", "張", "本", "條", "副", "部", "顆", "瓶", "桶", "雙", "面", "塊", "公斤", "公尺"];

// 部門候選:通用部門清單(members.js 的 DEPARTMENT_OPTIONS)+ 目前資料裡出現過的
function _invDeptOptions() {
  const canon = typeof DEPARTMENT_OPTIONS !== "undefined" ? DEPARTMENT_OPTIONS : [];
  const known = inventoryCache.map((i) => (i.department || "").trim()).filter(Boolean);
  return [...new Set([...canon, ...known])];
}
// 保管人 / 使用部門:部門清單 + 資料裡出現過的保管人
function _invCustodianOptions() {
  const known = inventoryCache.map((i) => (i.custodian || "").trim()).filter(Boolean);
  return [...new Set([..._invDeptOptions(), ...known])];
}
const INVENTORY_STATUS_STYLE = {
  正常: "background:#dcfce7;color:#15803d;border:1px solid #bbf7d0",
  報修: "background:#fef3c7;color:#b45309;border:1px solid #fde68a",
  報廢: "background:#fee2e2;color:#b91c1c;border:1px solid #fecaca",
  外借: "background:#e0f2fe;color:#0369a1;border:1px solid #bae6fd",
};

const INVENTORY_FIELDS = [
  { key: "department", label: "部門", required: true, type: "dropdown", opts: _invDeptOptions },
  { key: "name", label: "物品名稱", required: true },
  { key: "category", label: "分類" },
  { key: "quantity", label: "數量", type: "number" },
  { key: "unit", label: "單位", type: "dropdown", opts: () => INVENTORY_UNIT_OPTIONS },
  { key: "location", label: "存放位置" },
  { key: "status", label: "狀態", type: "select", options: INVENTORY_STATUS_OPTIONS },
  { key: "custodian", label: "保管人 / 使用部門", type: "dropdown", opts: _invCustodianOptions },
  { key: "asset_no", label: "財產編號" },
  { key: "acquired_date", label: "取得日期", type: "date" },
  { key: "unit_price", label: "單價 / 金額", type: "number" },
  { key: "borrower", label: "領用人", section: "領用 / 歸還" },
  { key: "issued_date", label: "領用日期", type: "date" },
  { key: "expected_return_date", label: "預計歸還", type: "date" },
  { key: "returned_date", label: "實際歸還", type: "date" },
  { key: "notes", label: "備註", type: "textarea" },
];

async function goToInventory() {
  setActiveNav("inventory");
  showView("view-inventory");
  inventorySearchQuery = "";
  const searchInput = document.getElementById("inventory-search-input");
  if (searchInput) searchInput.value = "";
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

  const depts = [...new Set(inventoryCache.map((i) => (i.department || "").trim()).filter(Boolean))].sort();
  if (inventoryCurDept !== "全部" && !depts.includes(inventoryCurDept)) inventoryCurDept = "全部";
  const bar = document.getElementById("inventory-dept-bar");
  if (bar) {
    bar.innerHTML = ["全部", ...depts]
      .map(
        (d) =>
          `<button class="fb ${inventoryCurDept === d ? "act" : ""}" data-inv-dept="${escapeHtml(d)}">${escapeHtml(
            d
          )}${d === "全部" ? "" : ` (${inventoryCache.filter((i) => (i.department || "").trim() === d).length})`}</button>`
      )
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

function renderInventoryTable() {
  const wrap = document.getElementById("inventory-table-wrap");
  if (!wrap) return;
  const q = (inventorySearchQuery || "").toLowerCase().trim();
  const showDeptCol = inventoryCurDept === "全部";

  const rows = inventoryCache.filter((i) => {
    if (inventoryCurDept !== "全部" && (i.department || "").trim() !== inventoryCurDept) return false;
    if (!q) return true;
    return [i.name, i.category, i.location, i.custodian, i.asset_no, i.borrower, i.notes]
      .map((v) => (v || "").toLowerCase())
      .some((v) => v.includes(q));
  });

  if (!rows.length) {
    wrap.innerHTML = `<div class="empty-state">${inventoryCache.length ? "尚無符合條件的物品" : "尚無物品，點右上角「+ 新增物品」開始建立"}</div>`;
    return;
  }

  const th = (t) => `<th style="white-space:nowrap">${t}</th>`;
  const td = (v) => `<td>${escapeHtml(v == null || v === "" ? "-" : String(v))}</td>`;

  wrap.innerHTML = `
    <div class="table-wrap" style="overflow-x:auto">
      <table>
        <thead><tr>
          ${showDeptCol ? th("部門") : ""}
          ${th("物品名稱")}${th("分類")}${th("數量")}${th("單位")}${th("存放位置")}${th("狀態")}
          ${th("保管人")}${th("財產編號")}${th("領用人")}${th("領用日期")}${th("預計歸還")}${th("實際歸還")}${th("備註")}${th("操作")}
        </tr></thead>
        <tbody>
          ${rows
      .map((i) => {
        const stStyle = INVENTORY_STATUS_STYLE[i.status] || INVENTORY_STATUS_STYLE["正常"];
        return `<tr>
              ${showDeptCol ? td(i.department) : ""}
              <td style="font-weight:600;white-space:nowrap">${escapeHtml(i.name || "-")}</td>
              ${td(i.category)}${td(i.quantity)}${td(i.unit)}${td(i.location)}
              <td><span style="display:inline-block;padding:2px 10px;border-radius:6px;font-size:12px;font-weight:600;${stStyle}">${escapeHtml(i.status || "正常")}</span></td>
              ${td(i.custodian)}${td(i.asset_no)}${td(i.borrower)}${td(i.issued_date)}${td(i.expected_return_date)}${td(i.returned_date)}
              <td style="max-width:200px;white-space:pre-wrap">${escapeHtml(i.notes || "-")}</td>
              <td class="actions-cell" style="white-space:nowrap">
                <button class="btn-secondary btn-sm" data-edit-inv="${i.id}">編輯</button>
                <button class="btn-danger btn-sm" data-del-inv="${i.id}">刪除</button>
              </td>
            </tr>`;
      })
      .join("")}
        </tbody>
      </table>
    </div>`;

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
      const cur = f.key === "department" ? val || curDeptDefault : val;
      const all = [...new Set([...(cur ? [cur] : []), ...optList])];
      input = `<select name="${f.key}" ${f.required ? "required" : ""}>
        ${f.required ? "" : `<option value="" ${cur === "" ? "selected" : ""}>（未指定）</option>`}
        ${all.map((o) => `<option value="${escapeHtml(o)}" ${cur === o ? "selected" : ""}>${escapeHtml(o)}</option>`).join("")}
        <option value="__new__">＋ 其他…</option>
      </select>`;
    } else {
      const type = f.type === "date" ? "date" : f.type === "number" ? "number" : "text";
      const step = f.key === "unit_price" ? ' step="0.01"' : "";
      input = `<input type="${type}"${step} name="${f.key}" ${f.required ? "required" : ""} value="${escapeHtml(val)}">`;
    }
    return `<div class="field" style="flex:1 1 220px"><label>${f.label}${f.required ? " *" : ""}</label>${input}</div>`;
  };

  let body = `<form id="inventory-form"><div style="display:flex;flex-wrap:wrap;gap:12px">`;
  INVENTORY_FIELDS.forEach((f) => {
    if (f.section) body += `</div><div style="font-weight:700;font-size:13px;color:var(--text-muted);margin:8px 0 4px">${f.section}</div><div style="display:flex;flex-wrap:wrap;gap:12px">`;
    body += fieldHtml(f);
  });
  body += `</div>
      <div class="modal-footer">
        <button type="button" class="btn-secondary" onclick="closeModal()">取消</button>
        <button type="submit" class="btn-primary">儲存</button>
      </div>
    </form>`;

  openModal(title, body, { width: "720px" });

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
}
