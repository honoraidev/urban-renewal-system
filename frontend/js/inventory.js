"use strict";

// 部門物品管制表 — 依 department 欄位分部門檢視的單一清單。
// 所有登入者皆可新增/編輯/刪除(後端用 get_current_user)。

let inventoryCache = [];
let inventoryCurDept = "全部";
let inventorySearchQuery = "";
let inventoryUserDir = {}; // { 部門名稱: [員工姓名, ...] } — 保管人/領用人選單用

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
        const cnt = d === "全部" ? "" : ` (${inventoryCache.filter((i) => (d === "未分部門" ? !_dep(i) : _dep(i) === d)).length})`;
        return `<button class="fb ${inventoryCurDept === d ? "act" : ""}" data-inv-dept="${escapeHtml(d)}">${escapeHtml(d)}${cnt}</button>`;
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

function renderInventoryTable() {
  const wrap = document.getElementById("inventory-table-wrap");
  if (!wrap) return;
  const q = (inventorySearchQuery || "").toLowerCase().trim();
  const showDeptCol = inventoryCurDept === "全部";

  const rows = inventoryCache.filter((i) => {
    const dep = (i.custodian_dept || "").trim();
    if (inventoryCurDept === "未分部門" && dep) return false;
    if (inventoryCurDept !== "全部" && inventoryCurDept !== "未分部門" && dep !== inventoryCurDept) return false;
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
      const cur = f.key === "custodian_dept" ? val || curDeptDefault : val;
      const all = [...new Set([...(cur ? [cur] : []), ...optList])];
      input = `<select name="${f.key}" ${f.required ? "required" : ""}>
        ${f.required ? "" : `<option value="" ${cur === "" ? "selected" : ""}>（未指定）</option>`}
        ${all.map((o) => `<option value="${escapeHtml(o)}" ${cur === o ? "selected" : ""}>${escapeHtml(o)}</option>`).join("")}
        <option value="__new__">＋ 其他…</option>
      </select>`;
    } else if (f.type === "person") {
      const dept = item ? item[f.deptField] || "" : "";
      const people = _invPeopleOf(dept);
      const all = [...new Set([...(val ? [val] : []), ...people])];
      input = `<select name="${f.key}" data-person-of="${f.deptField}">
        <option value="" ${val === "" ? "selected" : ""}>（無指定人）</option>
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
        font-size:14px; background:var(--bg-card,#fff); transition:border-color .12s, box-shadow .12s;
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

  // 保管人/領用人:改部門就重建「該部門的人」下拉(保留「（無指定人）」)
  document.querySelectorAll('#inventory-form select[data-person-of]').forEach((psel) => {
    const dsel = document.querySelector(`#inventory-form select[name="${psel.dataset.personOf}"]`);
    if (!dsel) return;
    dsel.addEventListener("change", () => {
      const cur = psel.value;
      const people = _invPeopleOf(dsel.value === "__new__" ? "" : dsel.value);
      psel.innerHTML =
        `<option value="">（無指定人）</option>` +
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
}
