"use strict";

const CATEGORY_COLORS = {
  "說明會費用": "#3b82f6",
  "估價師": "#10b981",
  "建築師": "#f97316",
  "顧問公司": "#8b5cf6",
  "調閱謄本": "#ef4444",
  "應酬費": "#84cc16",
  "代書": "#14b8a6",
  "鑑界費": "#ec4899",
};

function getCategoryColor(name) {
  if (!name) return "#9ca3af";
  if (CATEGORY_COLORS[name]) return CATEGORY_COLORS[name];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 70%, 50%)`;
}

let activeExpenseCategoryFilter = null;
let activeExpenseMonthFilter = "";

async function renderExpensesTab(el) {
  const pid = state.currentProjectId;
  if (!pid) {
    el.innerHTML = `<div class="empty-state">請先選擇案件</div>`;
    return;
  }
  if (!state.projectCache) state.projectCache = {};
  if (!state.projectCache[pid]) state.projectCache[pid] = {};

  let expenses = [];
  let categories = [];
  try {
    const res = await Promise.all([
      api(`/projects/${pid}/expenses`).catch((e) => []),
      api(`/expense-categories`).catch((e) => []),
    ]);
    expenses = Array.isArray(res[0]) ? res[0] : [];
    categories = Array.isArray(res[1]) ? res[1] : [];
  } catch (err) {
    console.error("Failed loading expenses:", err);
  }

  state.projectCache[pid].categories = categories;
  const catById = Object.fromEntries(categories.map((c) => [c.id, c.name]));

  // Get unique months for filter dropdown
  const months = [...new Set(expenses.map((ex) => (ex.expense_date ? String(ex.expense_date).slice(0, 7) : "")))].filter(Boolean).sort().reverse();

  // Current month string
  const nowMonth = new Date().toISOString().slice(0, 7);
  const currentMonthTotal = expenses
    .filter((ex) => ex.expense_date && String(ex.expense_date).slice(0, 7) === nowMonth)
    .reduce((sum, ex) => sum + (Number(ex.amount) || 0), 0);

  // Filtered expenses
  const filteredExpenses = expenses.filter((ex) => {
    if (activeExpenseMonthFilter && String(ex.expense_date).slice(0, 7) !== activeExpenseMonthFilter) return false;
    if (activeExpenseCategoryFilter !== null && ex.category_id !== activeExpenseCategoryFilter) return false;
    return true;
  });

  const filteredTotal = filteredExpenses.reduce((sum, ex) => sum + (Number(ex.amount) || 0), 0);

  // Find top category by total amount
  const catTotals = {};
  filteredExpenses.forEach((ex) => {
    const cName = catById[ex.category_id] || "未分類";
    catTotals[cName] = (catTotals[cName] || 0) + (Number(ex.amount) || 0);
  });
  let topCategoryName = "-";
  let maxCatAmount = -1;
  Object.entries(catTotals).forEach(([cName, amt]) => {
    if (amt > maxCatAmount) {
      maxCatAmount = amt;
      topCategoryName = cName;
    }
  });

  el.innerHTML = `
    <!-- Top 4 Summary Cards Grid -->
    <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));gap:16px;margin-bottom:20px">
      <!-- Card 1: 篩選範圍合計 -->
      <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:14px;padding:18px 20px;display:flex;align-items:center;gap:16px;box-shadow:0 2px 8px rgba(0,0,0,0.04)">
        <div style="width:52px;height:52px;border-radius:14px;background:#fef3c7;display:flex;align-items:center;justify-content:center;font-size:26px">💰</div>
        <div>
          <div style="font-size:22px;font-weight:800;color:var(--text-main);line-height:1.2">NT$${fmtMoney(filteredTotal)}</div>
          <div style="font-size:13px;color:var(--text-muted);margin-top:4px">篩選範圍合計</div>
        </div>
      </div>

      <!-- Card 2: 本月支出 -->
      <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:14px;padding:18px 20px;display:flex;align-items:center;gap:16px;box-shadow:0 2px 8px rgba(0,0,0,0.04)">
        <div style="width:52px;height:52px;border-radius:14px;background:#fee2e2;display:flex;align-items:center;justify-content:center;font-size:26px">📅</div>
        <div>
          <div style="font-size:22px;font-weight:800;color:var(--text-main);line-height:1.2">NT$${fmtMoney(currentMonthTotal)}</div>
          <div style="font-size:13px;color:var(--text-muted);margin-top:4px">本月支出</div>
        </div>
      </div>

      <!-- Card 3: 支出筆數 -->
      <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:14px;padding:18px 20px;display:flex;align-items:center;gap:16px;box-shadow:0 2px 8px rgba(0,0,0,0.04)">
        <div style="width:52px;height:52px;border-radius:14px;background:#f3f4f6;display:flex;align-items:center;justify-content:center;font-size:26px">📋</div>
        <div>
          <div style="font-size:22px;font-weight:800;color:var(--text-main);line-height:1.2">${filteredExpenses.length}</div>
          <div style="font-size:13px;color:var(--text-muted);margin-top:4px">支出筆數</div>
        </div>
      </div>

      <!-- Card 4: 最大費用類別 -->
      <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:14px;padding:18px 20px;display:flex;align-items:center;gap:16px;box-shadow:0 2px 8px rgba(0,0,0,0.04)">
        <div style="width:52px;height:52px;border-radius:14px;background:#fef9c3;display:flex;align-items:center;justify-content:center;font-size:26px">🏆</div>
        <div>
          <div style="font-size:20px;font-weight:800;color:var(--text-main);line-height:1.2">${escapeHtml(topCategoryName)}</div>
          <div style="font-size:13px;color:var(--text-muted);margin-top:4px">最大費用類別</div>
        </div>
      </div>
    </div>

    <!-- Filter & Toolbar Bar -->
    <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:14px;padding:12px 18px;margin-bottom:20px;display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;box-shadow:0 2px 8px rgba(0,0,0,0.02)">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <!-- Month Filter -->
        <div style="position:relative;display:inline-flex;align-items:center">
          <span style="position:absolute;left:10px;font-size:14px;pointer-events:none">📅</span>
          <select id="expense-month-select" style="padding:7px 14px 7px 32px;border:1px solid var(--border);border-radius:20px;background:var(--bg-card);font-size:13px;font-weight:600;cursor:pointer;outline:none">
            <option value="" ${activeExpenseMonthFilter === "" ? "selected" : ""}>全部月份</option>
            ${months.map((m) => `<option value="${m}" ${activeExpenseMonthFilter === m ? "selected" : ""}>${m}</option>`).join("")}
          </select>
        </div>

        <!-- Category Pills -->
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <button type="button" class="btn-cat-pill" data-cat-id="all" style="padding:6px 14px;border-radius:20px;border:none;font-size:13px;font-weight:600;cursor:pointer;transition:all 0.15s;${activeExpenseCategoryFilter === null ? "background:#0d9488;color:#fff" : "background:var(--bg-subtle);color:var(--text-main)"}">全部</button>
          ${categories.map((cat) => {
            const isActive = activeExpenseCategoryFilter === cat.id;
            const color = getCategoryColor(cat.name);
            return `
              <button type="button" class="btn-cat-pill" data-cat-id="${cat.id}" style="padding:6px 14px;border-radius:20px;border:none;font-size:13px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:6px;transition:all 0.15s;${isActive ? "background:#0d9488;color:#fff" : "background:var(--bg-subtle);color:var(--text-main)"}">
                <span style="width:8px;height:8px;border-radius:50%;background:${color}"></span>
                ${escapeHtml(cat.name)}
              </button>`;
          }).join("")}
        </div>
      </div>

      <!-- Action Buttons -->
      <div style="display:flex;align-items:center;gap:8px">
        ${isManager() ? `<button class="btn-secondary btn-sm" id="manage-categories-btn" style="border-radius:20px">管理類別</button>` : ""}
        ${isEditor() ? `<button class="btn-primary btn-sm" id="add-expense-btn" style="background:#0d9488;border-color:#0d9488;border-radius:20px;padding:7px 16px;font-size:13px;font-weight:600">+ 記錄支出</button>` : ""}
      </div>
    </div>

    <!-- Expenses Data Table -->
    <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:14px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.02)">
      ${filteredExpenses.length ? `
        <div class="table-wrap" style="margin:0">
          <table style="width:100%;border-collapse:collapse">
            <thead>
              <tr style="background:var(--bg-subtle);border-bottom:1px solid var(--border);color:var(--text-muted);font-size:13px">
                <th style="padding:12px 16px;text-align:left">日期</th>
                <th style="padding:12px 16px;text-align:left">類別</th>
                <th style="padding:12px 16px;text-align:left">金額 (元)</th>
                <th style="padding:12px 16px;text-align:left">說明</th>
                <th style="padding:12px 16px;text-align:left">收據編號</th>
                <th style="padding:12px 16px;text-align:left">登記人</th>
                ${isEditor() ? `<th style="padding:12px 16px;text-align:center">操作</th>` : ""}
              </tr>
            </thead>
            <tbody>
              ${filteredExpenses.map((ex) => {
                const cName = catById[ex.category_id] || "未分類";
                const cColor = getCategoryColor(cName);
                const creator = ex.creator_name || "陳建宏";
                return `
                  <tr style="border-bottom:1px solid var(--border);font-size:14px">
                    <td style="padding:14px 16px;color:var(--text-muted)">${fmtDate(ex.expense_date)}</td>
                    <td style="padding:14px 16px">
                      <span style="display:inline-flex;align-items:center;gap:6px;font-weight:600">
                        <span style="width:8px;height:8px;border-radius:50%;background:${cColor}"></span>
                        ${escapeHtml(cName)}
                      </span>
                    </td>
                    <td style="padding:14px 16px;font-weight:800;color:var(--text-main)">$${fmtMoney(ex.amount)}</td>
                    <td style="padding:14px 16px">${escapeHtml(ex.description) || "-"}</td>
                    <td style="padding:14px 16px;color:var(--text-muted)">${escapeHtml(ex.receipt_number) || "-"}</td>
                    <td style="padding:14px 16px">${escapeHtml(creator)}</td>
                    ${isEditor() ? `
                      <td style="padding:14px 16px;text-align:center">
                        <div style="display:flex;gap:6px;justify-content:center">
                          <button class="btn-secondary btn-sm" data-edit-expense="${ex.id}" style="border-radius:12px;padding:3px 10px;font-size:12px">編輯</button>
                          <button class="btn-danger btn-sm" data-delete-expense="${ex.id}" style="border-radius:12px;padding:3px 10px;font-size:12px">刪除</button>
                        </div>
                      </td>` : ""}
                  </tr>`;
              }).join("")}
            </tbody>
          </table>
        </div>
        <div style="padding:12px 18px;background:var(--bg-subtle);border-top:1px solid var(--border);display:flex;justify-content:flex-end;align-items:center;gap:16px;font-size:13px;color:var(--text-muted)">
          <span>共 <strong style="color:var(--text-main)">${filteredExpenses.length}</strong> 筆</span>
          <span>合計 <strong style="color:#0d9488;font-size:15px">NT$${fmtMoney(filteredTotal)}</strong></span>
        </div>
      ` : `<div class="empty-state" style="padding:40px 0;text-align:center">尚無符合條件的支出紀錄</div>`}
    </div>
  `;

  // Month filter change
  const monthSel = document.getElementById("expense-month-select");
  if (monthSel) {
    monthSel.addEventListener("change", (e) => {
      activeExpenseMonthFilter = e.target.value;
      renderExpensesTab(el);
    });
  }

  // Category pill clicks
  el.querySelectorAll(".btn-cat-pill").forEach((btn) => {
    btn.addEventListener("click", () => {
      const catId = btn.dataset.catId;
      activeExpenseCategoryFilter = catId === "all" ? null : Number(catId);
      renderExpensesTab(el);
    });
  });

  // Action button listeners
  el.querySelectorAll("[data-delete-expense]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("確定要刪除此筆支出嗎?")) return;
      try {
        await api(`/projects/${pid}/expenses/${btn.dataset.deleteExpense}`, { method: "DELETE" });
        toast("已刪除", "success");
        renderTab("expenses");
      } catch (err) { }
    });
  });

  el.querySelectorAll("[data-edit-expense]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const ex = expenses.find((x) => x.id === Number(btn.dataset.editExpense));
      if (ex) openEditExpenseModal(ex, categories);
    });
  });

  const addBtn = document.getElementById("add-expense-btn");
  if (addBtn) addBtn.addEventListener("click", () => openAddExpenseModal(categories));

  const manageBtn = document.getElementById("manage-categories-btn");
  if (manageBtn) manageBtn.addEventListener("click", () => openManageCategoriesModal(categories));
}

// ---- 發票辨識(拍照 → 後端 AI OCR)-------------------------------------------

const INVOICE_TYPE_LABEL = {
  electronic: "電子發票",
  triplicate: "統一發票三聯式",
  duplicate: "統一發票二聯式",
  unknown: "",
};

let _invoiceScanStream = null;
let _invoiceAutoTimer = null;
let _invoiceAutoAttempts = 0;
const INVOICE_AUTO_MAX_ATTEMPTS = 5;

// 累積這次掃描 session 抓到的發票(拍照連拍 + 選相片/選檔案 都往同一個佇列加),
// 「完成」或選完檔案時再一次決定:只有 1 筆就直接帶入表單(維持原本手感),
// 多筆就切到審核表一次建立多筆支出 —— 不用再另外開一個「批次匯入」按鈕/彈窗。
let _invoiceQueue = [];

function stopInvoiceScan() {
  if (_invoiceAutoTimer) {
    clearTimeout(_invoiceAutoTimer);
    _invoiceAutoTimer = null;
  }
  _invoiceAutoAttempts = 0;
  _invoiceQueue = [];
  if (_invoiceScanStream) {
    _invoiceScanStream.getTracks().forEach((t) => t.stop());
    _invoiceScanStream = null;
  }
  const stage = document.getElementById("invoice-scan-stage");
  if (stage) stage.classList.add("hidden");
}

function invoiceScanEnsureStyle() {
  if (document.getElementById("invoice-scan-style")) return;
  const s = document.createElement("style");
  s.id = "invoice-scan-style";
  s.textContent = `
    #invoice-scan-stage { position:relative; width:100%; border-radius:12px; overflow:hidden; background:#000; }
    #invoice-scan-video { width:100%; display:block; max-height:64vh; object-fit:cover; }
    .isc-box { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%);
      width:86%; height:70%; box-shadow:0 0 0 100vmax rgba(0,0,0,.45); border-radius:14px; }
    .isc-c { position:absolute; width:26px; height:26px; border:3px solid #34d399; }
    .isc-c.tl { top:-2px; left:-2px; border-right:0; border-bottom:0; border-top-left-radius:12px; }
    .isc-c.tr { top:-2px; right:-2px; border-left:0; border-bottom:0; border-top-right-radius:12px; }
    .isc-c.bl { bottom:-2px; left:-2px; border-right:0; border-top:0; border-bottom-left-radius:12px; }
    .isc-c.br { bottom:-2px; right:-2px; border-left:0; border-top:0; border-bottom-right-radius:12px; }
    .isc-c.live { border-color:#facc15; animation: isc-pulse 1s ease-in-out infinite; }
    @keyframes isc-pulse { 0%,100% { opacity:1; } 50% { opacity:.35; } }
    #scan-invoice-btn { width:100%; display:flex; align-items:center; justify-content:center; gap:8px;
      padding:13px 16px; font-size:15px; font-weight:700; border-radius:12px;
      background:#0d9488; color:#fff; border:none; margin-bottom:10px; }
    #scan-invoice-btn:hover { background:#0b7d73; opacity:1; }
    #invoice-scan-menu { display:grid; grid-template-columns:repeat(3, 1fr); gap:8px; margin-bottom:14px; }
    .isc-menu-btn { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:4px;
      padding:12px 6px; border-radius:12px; border:1px solid var(--border); background:var(--surface);
      color:var(--text); font-size:12.5px; font-weight:600; cursor:pointer; }
    .isc-menu-btn span { font-size:22px; }
    .isc-menu-btn:hover { border-color:#0d9488; background:rgba(13,148,136,.06); opacity:1; }
    #invoice-scan-panel { padding:12px; margin-bottom:16px; }
    #invoice-scan-hint { font-size:13px; color:var(--text-muted); margin-bottom:8px; min-height:18px; }
    .isc-loading { display:flex; flex-direction:column; align-items:center; justify-content:center;
      gap:12px; padding:26px 12px 10px; font-size:14.5px; font-weight:700; color:var(--text); text-align:center; }
    .isc-spinner { width:30px; height:30px; border:3px solid rgba(13,148,136,.18);
      border-top-color:#0d9488; border-radius:50%; animation:isc-spin .8s linear infinite; }
    @keyframes isc-spin { to { transform:rotate(360deg); } }
    .exp-sec { border:1px solid var(--border); border-radius:12px; padding:14px 16px 4px; margin-bottom:14px; background:var(--surface); }
    .exp-sec-title { font-size:12px; font-weight:800; color:var(--brand-dark, #0d9488); letter-spacing:.03em; margin-bottom:10px; }
    .exp-sec .field-row { flex-wrap:wrap; }
    .exp-sec .field-row > .field { min-width:130px; }
    .exp-amount-field input { font-size:20px; font-weight:800; }
    .qrow-error td { background:rgba(239,68,68,.06); }
    #invoice-review-wrap table input, #invoice-review-wrap table select { padding:5px 7px; font-size:12.5px; }
  `;
  document.head.appendChild(s);
}

// 綁定發票辨識按鈕。整張發票拍照後交後端 OCR/AI 辨識,categories 給逐筆表單的
// 類別下拉選單用。拍照可連續拍好幾張、選相片/選檔案也都能一次選多個(或一份多頁
// PDF)—— 全部併成同一個佇列,「完成」後一律走 renderQueueStepper() 逐筆帶入表單、
// 按「建立並下一筆」確認,不論這次掃了 1 張還是好幾張,介面都一樣。
function wireInvoiceScanner(formId, categories) {
  const btn = document.getElementById("scan-invoice-btn");
  const menu = document.getElementById("invoice-scan-menu");
  const panel = document.getElementById("invoice-scan-panel");
  const normalWrap = document.getElementById("invoice-scan-normal");
  const reviewWrap = document.getElementById("invoice-review-wrap");
  const video = document.getElementById("invoice-scan-video");
  const photoInput = document.getElementById("invoice-photo-input");
  const fileInput = document.getElementById("invoice-file-input");
  const closeBtn = document.getElementById("invoice-scan-close");
  const shotBtn = document.getElementById("invoice-shot-btn");
  const finishBtn = document.getElementById("invoice-finish-btn");
  const hint = document.getElementById("invoice-scan-hint");
  const extra = document.getElementById("invoice-scan-extra");
  const actionsRow = document.getElementById("invoice-scan-actions");
  const underForm = document.getElementById(formId);
  if (!btn || !panel) return;
  invoiceScanEnsureStyle();

  const closeMenu = () => menu && menu.classList.add("hidden");
  const showNormalMode = () => {
    if (normalWrap) normalWrap.classList.remove("hidden");
    if (reviewWrap) {
      reviewWrap.classList.add("hidden");
      reviewWrap.innerHTML = "";
    }
    if (actionsRow) actionsRow.style.justifyContent = "";
  };
  // 掃描面板(拍照 / 逐筆審核)跟底下手動填寫的表單只留一個 —— 面板開著就把原本的
  // 表單藏起來,不然畫面上會同時看到兩份「支出資訊」,使用者搞不清楚要填哪個。
  const showPanel = () => {
    panel.classList.remove("hidden");
    if (underForm) underForm.classList.add("hidden");
  };
  const hidePanel = () => {
    panel.classList.add("hidden");
    if (underForm) underForm.classList.remove("hidden");
  };

  // LINE 內建瀏覽器等 in-app webview 常在切換畫面(例如按下快門的瞬間)把相機串流
  // 暫停,這時 video.videoWidth 可能還是 0 —— 不要直接放棄,輪詢等一下再試。
  async function waitForVideoReady(maxMs = 1500) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      if (video.videoWidth && video.readyState >= 2) return true;
      await new Promise((r) => setTimeout(r, 100));
    }
    return video.videoWidth > 0;
  }

  async function grabStill() {
    const ready = await waitForVideoReady();
    if (!ready || !video.videoWidth) return null;
    const c = document.createElement("canvas");
    c.width = video.videoWidth;
    c.height = video.videoHeight;
    c.getContext("2d").drawImage(video, 0, 0);
    // 0.85 而非 0.92:上傳檔案小一截、編碼也快一點,發票是印刷大字,文字辨識不受影響。
    return new Promise((res) => c.toBlob((b) => res(b), "image/jpeg", 0.85));
  }

  function updateQueueStatus() {
    const n = _invoiceQueue.length;
    if (finishBtn) {
      finishBtn.classList.toggle("hidden", n === 0);
      finishBtn.textContent = `✅ 完成(共 ${n} 張)`;
    }
    if (shotBtn) shotBtn.textContent = n > 0 ? "📸 拍下一張" : "📸 立即拍照";
    if (extra) extra.textContent = n > 0 ? `已加入 ${n} 張,可繼續拍下一張,或按「完成」建立支出。` : "";
  }

  // 拍一張、辨識、成功就加進佇列。回傳是否成功 —— 讓自動連拍迴圈知道要不要重試。
  // 拍到之後「不會」自動連拍下一張:停下來等使用者按「拍下一張」或「完成」,避免
  // 鏡頭沒移開就一直對著同一張發票重複辨識、疊出好幾筆一樣的資料。
  async function captureAndQueue({ auto }) {
    const blob = await grabStill();
    if (!blob) {
      if (!auto) {
        if (extra) extra.textContent = "沒有抓到畫面,請再按一次,或改用「選擇相片 / 選擇檔案」。";
        toast("沒有抓到相機畫面,請再試一次或改用上傳照片", "error");
      }
      return false;
    }
    const pid = state.currentProjectId;
    if (!pid) {
      toast("請先進入案件", "error");
      return false;
    }
    if (extra) extra.textContent = auto ? `自動辨識中…(第 ${_invoiceAutoAttempts} 次)` : "辨識中…";
    if (shotBtn) shotBtn.disabled = true;
    const fd = new FormData();
    fd.append("file", blob, "invoice.jpg");
    try {
      const r = await api(`/projects/${pid}/expenses/scan-invoice`, { method: "POST", body: fd, isForm: true });
      if (!r.invoice_number && !r.invoice_date && r.total_amount == null) {
        if (!auto && extra) extra.textContent = "沒有讀到發票欄位,請拍清楚一點(對正、光線足、填滿框)再試";
        return false;
      }
      r.source_filename = "拍照";
      _invoiceQueue.push(r);
      updateQueueStatus();
      return true;
    } catch (e) {
      if (extra) extra.textContent = "辨識失敗:" + (e && e.message ? e.message : e);
      return false;
    } finally {
      if (shotBtn) shotBtn.disabled = false;
    }
  }

  // 開鏡頭後不用手動按快門 — 對到焦就自動拍照+辨識一張,拍到有讀到欄位為止(最多
  // INVOICE_AUTO_MAX_ATTEMPTS 次重試)。手動「拍照 / 拍下一張」按鈕觸發同一套邏輯。
  async function autoCaptureLoop() {
    _invoiceAutoTimer = null;
    if (!_invoiceScanStream) return;
    _invoiceAutoAttempts++;
    const ok = await captureAndQueue({ auto: true });
    if (!ok && _invoiceScanStream) {
      if (_invoiceAutoAttempts < INVOICE_AUTO_MAX_ATTEMPTS) {
        _invoiceAutoTimer = setTimeout(autoCaptureLoop, 500);
      } else if (extra) {
        extra.textContent = _invoiceQueue.length
          ? "自動掃描沒讀到下一張,請按「拍下一張」重試,或按「完成」結束。"
          : "自動掃描沒讀到欄位,請按「拍照」重試,並確認發票對正、填滿框、光線充足。";
      }
    }
  }

  async function openCamera() {
    const stage = document.getElementById("invoice-scan-stage");
    if (stage) stage.classList.remove("hidden");
    hint.textContent = "把整張發票放進框內、對正、填滿框 — 對到焦會自動拍照辨識,可連續拍好幾張。";
    try {
      // 1280x720 就夠讀發票印刷字了 — 比 1920x1080 少快 60% 的像素,拍照編碼、上傳、
      // 伺服器端 OCR 都跟著變快,肉眼看不出解析度差異。
      _invoiceScanStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      video.srcObject = _invoiceScanStream;
      video.setAttribute("playsinline", "");
      await video.play();
      if (_invoiceAutoTimer) clearTimeout(_invoiceAutoTimer);
      _invoiceAutoAttempts = 0;
      _invoiceAutoTimer = setTimeout(autoCaptureLoop, 350); // 給一點時間讓相機自動對焦
    } catch (e) {
      hint.textContent = "無法開啟相機(需 HTTPS 並允許權限):" + ((e && e.name) || e) + "。可改用「選擇相片 / 選擇檔案」。";
      if (stage) stage.classList.add("hidden");
    }
  }

  // 佇列收尾:不論辨識到 1 張還是多張,一律走同一套逐筆帶入表單、按「建立並下一
  // 筆」的流程 —— 介面只有一種,不用先猜使用者這次掃了幾張。
  function finalizeQueue() {
    const queue = _invoiceQueue.slice();
    stopInvoiceScan(); // 停相機、清計時器,也會清空 _invoiceQueue —— 所以先複製一份
    if (!queue.length) {
      hidePanel();
      closeMenu();
      return;
    }
    renderQueueStepper(queue);
  }

  // 多筆(或含錯誤)辨識結果:逐筆把欄位帶進跟「記錄支出」一模一樣的表單裡,整個
  // 佇列都在瀏覽器端本機編輯(上一筆/下一筆/新增一筆/刪除此筆都不碰資料庫)——
  // 跟謄本匯入精靈同一套模式,所以「上一筆」回頭改欄位不會造成同一筆被建立兩次;
  // 真正寫進資料庫是在最後一筆按「完成」的時候才一次送出整批。
  function renderQueueStepper(initialQueue) {
    if (normalWrap) normalWrap.classList.add("hidden");
    if (!reviewWrap) return;
    reviewWrap.classList.remove("hidden");

    const catOptions =
      `<option value="">— 未分類 —</option>` +
      (categories || []).map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");

    const toEntry = (r) => ({
      invoice_date: r.invoice_date || new Date().toISOString().slice(0, 10),
      category_id: "",
      untaxed_amount: r.untaxed_amount ?? "",
      tax_amount: r.tax_amount ?? "",
      description: "",
      seller_tax_id: r.seller_tax_id || "",
      buyer_tax_id: r.buyer_tax_id || "",
      receipt_number: r.invoice_number || "",
      src: r.error
        ? `${r.source_filename || "拍照"}${r.page ? ` #${r.page}` : ""}・讀不到內容(${r.error}),請手動輸入或刪除此筆`
        : `${r.source_filename || "拍照"}${r.page ? ` #${r.page}` : ""}${INVOICE_TYPE_LABEL[r.invoice_type] ? "・" + INVOICE_TYPE_LABEL[r.invoice_type] : ""}・${r.source === "qr" ? "QR" : r.source === "gemini" ? "AI" : "OCR"}`,
    });
    const blankEntry = () => ({
      invoice_date: new Date().toISOString().slice(0, 10),
      category_id: "", untaxed_amount: "", tax_amount: "", description: "",
      seller_tax_id: "", buyer_tax_id: "", receipt_number: "", src: "手動新增",
    });
    const sumAmount = (e) => {
      const u = e.untaxed_amount === "" ? null : Number(e.untaxed_amount);
      const t = e.tax_amount === "" ? null : Number(e.tax_amount);
      return u == null && t == null ? "" : (u || 0) + (t || 0);
    };

    const queue = initialQueue.map(toEntry);
    let idx = 0;

    const saveCurrentForm = () => {
      const form = document.getElementById("q-step-form");
      if (!form) return;
      const fd = new FormData(form);
      Object.assign(queue[idx], {
        invoice_date: fd.get("expense_date") || "",
        category_id: fd.get("category_id") || "",
        description: fd.get("description") || "",
        untaxed_amount: fd.get("untaxed_amount") || "",
        tax_amount: fd.get("tax_amount") || "",
        seller_tax_id: fd.get("seller_tax_id") || "",
        buyer_tax_id: fd.get("buyer_tax_id") || "",
        receipt_number: fd.get("receipt_number") || "",
      });
    };

    const createAll = async () => {
      let created = 0;
      let failed = 0;
      for (const e of queue) {
        const amount = sumAmount(e);
        if (!amount) {
          failed++;
          continue;
        }
        try {
          await api(`/projects/${state.currentProjectId}/expenses`, {
            method: "POST",
            silent: true,
            body: {
              category_id: e.category_id ? Number(e.category_id) : null,
              amount: Number(amount),
              expense_date: e.invoice_date || new Date().toISOString().slice(0, 10),
              description: e.description || null,
              receipt_number: e.receipt_number || null,
              untaxed_amount: e.untaxed_amount ? Number(e.untaxed_amount) : null,
              tax_amount: e.tax_amount ? Number(e.tax_amount) : null,
              seller_tax_id: e.seller_tax_id || null,
              buyer_tax_id: e.buyer_tax_id || null,
            },
          });
          created++;
        } catch (err) {
          failed++;
        }
      }
      closeModal();
      const parts = [`已建立 ${created} 筆`];
      if (failed) parts.push(`${failed} 筆未填金額或建立失敗`);
      toast(parts.join("・"), created ? "success" : "error");
      renderTab("expenses");
    };

    const paint = () => {
      const e = queue[idx];
      const isLast = idx === queue.length - 1;

      reviewWrap.innerHTML = `
        <div class="helper-text" style="margin-bottom:8px">第 ${idx + 1} 筆・共 ${queue.length} 筆・來源:${escapeHtml(e.src)}</div>
        <form id="q-step-form">
          <div class="exp-sec">
            <div class="exp-sec-title">支出資訊</div>
            <div class="field-row">
              <div class="field"><label>日期</label><input type="date" name="expense_date" value="${escapeHtml(e.invoice_date)}" required></div>
              <div class="field"><label>費用類別</label><select name="category_id">${catOptions}</select></div>
            </div>
            <div class="field exp-amount-field"><label>總金額(含稅,新臺幣)</label><input type="number" name="amount" id="q-step-amount" value="${sumAmount(e)}" placeholder="由未稅金額+稅額自動加總" readonly required style="background:var(--surface-2);cursor:not-allowed"></div>
            <div class="field"><label>說明</label><input name="description" value="${escapeHtml(e.description)}" placeholder="例: 第一次說明會場地費"></div>
          </div>
          <div class="exp-sec">
            <div class="exp-sec-title">發票明細(掃描後自動帶入)</div>
            <div class="field-row">
              <div class="field"><label>未稅金額</label><input type="number" name="untaxed_amount" id="q-step-untaxed" step="1" value="${escapeHtml(e.untaxed_amount)}"></div>
              <div class="field"><label>稅額</label><input type="number" name="tax_amount" id="q-step-tax" step="1" value="${escapeHtml(e.tax_amount)}"></div>
            </div>
            <div class="field-row">
              <div class="field"><label>賣方統編</label><input name="seller_tax_id" value="${escapeHtml(e.seller_tax_id)}" placeholder="8 碼"></div>
              <div class="field"><label>買方統編</label><input name="buyer_tax_id" value="${escapeHtml(e.buyer_tax_id)}" placeholder="8 碼"></div>
            </div>
            <div class="field"><label>發票號碼</label><input name="receipt_number" value="${escapeHtml(e.receipt_number)}" placeholder="例: AX00123456"></div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn-secondary btn-sm" id="q-step-add" style="margin-right:auto">+ 新增一筆</button>
            <button type="button" class="btn-danger btn-sm" id="q-step-delete">刪除此筆</button>
            ${idx > 0 ? `<button type="button" class="btn-secondary btn-sm" id="q-step-prev">上一筆</button>` : ""}
            <button type="submit" class="btn-primary btn-sm" style="background:#0d9488;border-color:#0d9488">${isLast ? "完成,建立全部支出" : "下一筆 →"}</button>
          </div>
        </form>`;

      const form = document.getElementById("q-step-form");
      const amountInput = document.getElementById("q-step-amount");
      const recalc = () => {
        const u = document.getElementById("q-step-untaxed").value;
        const t = document.getElementById("q-step-tax").value;
        amountInput.value = sumAmount({ untaxed_amount: u, tax_amount: t });
      };
      document.getElementById("q-step-untaxed").addEventListener("input", recalc);
      document.getElementById("q-step-tax").addEventListener("input", recalc);

      document.getElementById("q-step-add").addEventListener("click", () => {
        saveCurrentForm();
        queue.splice(idx + 1, 0, blankEntry());
        idx++;
        paint();
      });
      document.getElementById("q-step-delete").addEventListener("click", () => {
        if (queue.length === 1) {
          closeModal();
          toast("已取消,尚未建立任何支出", "success");
          return;
        }
        queue.splice(idx, 1);
        if (idx >= queue.length) idx = queue.length - 1;
        paint();
      });
      const prevBtn = document.getElementById("q-step-prev");
      if (prevBtn) {
        prevBtn.addEventListener("click", () => {
          saveCurrentForm();
          idx--;
          paint();
        });
      }
      form.addEventListener("submit", (ev) => {
        ev.preventDefault();
        saveCurrentForm();
        if (isLast) {
          createAll();
        } else {
          idx++;
          paint();
        }
      });
    };

    paint();
  }

  // 主按鈕:面板開著就整個收起來;沒開就彈出「拍照 / 選擇相片 / 選擇檔案」三選一選單。
  btn.addEventListener("click", () => {
    if (!panel.classList.contains("hidden")) {
      stopInvoiceScan();
      hidePanel();
      closeMenu();
      showNormalMode();
      return;
    }
    menu.classList.toggle("hidden");
  });

  const startCamera = async () => {
    closeMenu();
    showNormalMode();
    if (shotBtn) {
      shotBtn.classList.remove("hidden");
      shotBtn.textContent = "📸 立即拍照";
    }
    if (finishBtn) finishBtn.classList.add("hidden");
    showPanel();
    if (extra) extra.textContent = "";
    await openCamera();
  };

  const runFromFiles = async (fileList) => {
    closeMenu();
    const files = Array.from(fileList || []);
    if (!files.length) return;
    showNormalMode();
    showPanel();
    if (shotBtn) shotBtn.classList.add("hidden"); // 靜態圖片/PDF,沒有相機快門可按
    if (finishBtn) finishBtn.classList.add("hidden");
    const stage = document.getElementById("invoice-scan-stage");
    if (stage) stage.classList.add("hidden");
    const loadingMsg = files.length > 1 ? `已選擇 ${files.length} 個檔案,辨識中…` : "已選擇檔案,辨識中…";
    hint.innerHTML = `<div class="isc-loading"><span class="isc-spinner"></span>${escapeHtml(loadingMsg)}</div>`;
    if (actionsRow) actionsRow.style.justifyContent = "center";
    if (extra) extra.textContent = "";
    const pid = state.currentProjectId;
    if (!pid) {
      toast("請先進入案件", "error");
      hidePanel();
      return;
    }
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f, f.name));
    let results = [];
    try {
      const r = await api(`/projects/${pid}/expenses/scan-invoice-batch`, { method: "POST", body: fd, isForm: true });
      results = r.results || [];
    } catch (e) {
      hidePanel();
      return;
    }
    if (!results.length) {
      toast("沒有辨識出任何發票", "error");
      hidePanel();
      return;
    }
    _invoiceQueue.push(...results);
    finalizeQueue();
  };

  const menuCamera = document.getElementById("invoice-menu-camera");
  const menuPhoto = document.getElementById("invoice-menu-photo");
  const menuFile = document.getElementById("invoice-menu-file");
  if (menuCamera) menuCamera.addEventListener("click", startCamera);
  if (menuPhoto) menuPhoto.addEventListener("click", () => photoInput && photoInput.click());
  if (menuFile) menuFile.addEventListener("click", () => fileInput && fileInput.click());

  if (photoInput)
    photoInput.addEventListener("change", () => {
      runFromFiles(photoInput.files);
      photoInput.value = "";
    });
  if (fileInput)
    fileInput.addEventListener("change", () => {
      runFromFiles(fileInput.files);
      fileInput.value = "";
    });

  if (shotBtn)
    shotBtn.addEventListener("click", async () => {
      if (_invoiceAutoTimer) {
        clearTimeout(_invoiceAutoTimer);
        _invoiceAutoTimer = null;
      }
      if (!_invoiceScanStream) {
        await openCamera();
        return;
      }
      _invoiceAutoAttempts = 0;
      autoCaptureLoop();
    });

  if (finishBtn) finishBtn.addEventListener("click", finalizeQueue);

  if (closeBtn)
    closeBtn.addEventListener("click", () => {
      stopInvoiceScan();
      hidePanel();
      closeMenu();
    });
}

const INVOICE_SCAN_HTML = `
  <button type="button" id="scan-invoice-btn">📷 掃描發票</button>
  <div id="invoice-scan-menu" class="hidden">
    <button type="button" class="isc-menu-btn" id="invoice-menu-camera"><span>📸</span>拍照</button>
    <button type="button" class="isc-menu-btn" id="invoice-menu-photo"><span>🖼️</span>選擇相片</button>
    <button type="button" class="isc-menu-btn" id="invoice-menu-file"><span>📁</span>選擇檔案</button>
  </div>
  <input type="file" id="invoice-photo-input" accept="image/*" multiple style="display:none">
  <input type="file" id="invoice-file-input" accept="image/*,application/pdf" multiple style="display:none">
  <div id="invoice-scan-panel" class="hidden">
    <div id="invoice-scan-normal">
      <div id="invoice-scan-hint">把整張發票放進框內、對正、填滿框 — 對到焦會自動拍照辨識,可連續拍好幾張。</div>
      <div id="invoice-scan-stage" class="hidden">
        <video id="invoice-scan-video" playsinline muted></video>
        <div class="isc-box">
          <span class="isc-c tl live"></span><span class="isc-c tr live"></span>
          <span class="isc-c bl live"></span><span class="isc-c br live"></span>
        </div>
      </div>
      <div id="invoice-scan-actions" style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
        <button type="button" class="btn-primary btn-sm" id="invoice-shot-btn" style="background:#0d9488;border-color:#0d9488">📸 立即拍照</button>
        <button type="button" class="btn-primary btn-sm hidden" id="invoice-finish-btn" style="background:#0d9488;border-color:#0d9488">✅ 完成</button>
        <button type="button" class="btn-secondary btn-sm" id="invoice-scan-close">關閉</button>
      </div>
      <div id="invoice-scan-extra" class="helper-text" style="margin-top:6px"></div>
    </div>
    <div id="invoice-review-wrap" class="hidden"></div>
  </div>`;

function openAddExpenseModal(categories) {
  openModal(
    "記錄支出",
    `
    ${INVOICE_SCAN_HTML}
    <form id="expense-form">
      <div class="exp-sec">
        <div class="exp-sec-title">支出資訊</div>
        <div class="field-row">
          <div class="field"><label>日期</label><input type="date" name="expense_date" value="${new Date().toISOString().slice(0, 10)}" required></div>
          <div class="field"><label>費用類別</label>
            <select name="category_id">
              <option value="">— 未分類 —</option>
              ${categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("")}
            </select>
          </div>
        </div>
        <div class="field exp-amount-field"><label>總金額(含稅,新臺幣)</label><input type="number" name="amount" step="1" placeholder="例: 85000" required></div>
        <div class="field"><label>說明</label><input name="description" placeholder="例: 第一次說明會場地費"></div>
      </div>
      <div class="exp-sec">
        <div class="exp-sec-title">發票明細(掃描後自動帶入)</div>
        <div class="field-row">
          <div class="field"><label>未稅金額</label><input type="number" name="untaxed_amount" step="1" placeholder="辨識後自動帶入"></div>
          <div class="field"><label>稅額</label><input type="number" name="tax_amount" step="1" placeholder="辨識後自動帶入"></div>
        </div>
        <div class="field-row">
          <div class="field"><label>賣方統編</label><input name="seller_tax_id" placeholder="8 碼"></div>
          <div class="field"><label>買方統編</label><input name="buyer_tax_id" placeholder="8 碼"></div>
        </div>
        <div class="field"><label>發票號碼</label><input name="receipt_number" placeholder="例: AX00123456"></div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn-secondary" onclick="stopInvoiceScan();closeModal()">取消</button>
        <button type="submit" class="btn-primary">儲存</button>
      </div>
    </form>`
  );

  wireInvoiceScanner("expense-form", categories);

  document.getElementById("expense-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = Object.fromEntries(fd.entries());
    const payload = {
      category_id: data.category_id ? Number(data.category_id) : null,
      amount: Number(data.amount),
      expense_date: data.expense_date,
      description: data.description || null,
      receipt_number: data.receipt_number || null,
      untaxed_amount: data.untaxed_amount ? Number(data.untaxed_amount) : null,
      tax_amount: data.tax_amount ? Number(data.tax_amount) : null,
      seller_tax_id: data.seller_tax_id || null,
      buyer_tax_id: data.buyer_tax_id || null,
    };
    try {
      await api(`/projects/${state.currentProjectId}/expenses`, { method: "POST", body: payload });
      stopInvoiceScan();
      closeModal();
      toast("支出已新增", "success");
      renderTab("expenses");
    } catch (err) { }
  });
}

function openEditExpenseModal(expense, categories) {
  openModal(
    "編輯支出記錄",
    `
    ${INVOICE_SCAN_HTML}
    <form id="expense-edit-form">
      <div class="exp-sec">
        <div class="exp-sec-title">支出資訊</div>
        <div class="field-row">
          <div class="field"><label>日期</label><input type="date" name="expense_date" value="${fmtDate(expense.expense_date)}" required></div>
          <div class="field"><label>費用類別</label>
            <select name="category_id">
              <option value="">— 未分類 —</option>
              ${categories.map((c) => `<option value="${c.id}" ${expense.category_id === c.id ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}
            </select>
          </div>
        </div>
        <div class="field exp-amount-field"><label>總金額(含稅,新臺幣)</label><input type="number" name="amount" step="1" value="${expense.amount}" required></div>
        <div class="field"><label>說明</label><input name="description" value="${escapeHtml(expense.description) || ""}" placeholder="例: 第一次說明會場地費"></div>
      </div>
      <div class="exp-sec">
        <div class="exp-sec-title">發票明細(掃描後自動帶入)</div>
        <div class="field-row">
          <div class="field"><label>未稅金額</label><input type="number" name="untaxed_amount" step="1" value="${expense.untaxed_amount ?? ""}"></div>
          <div class="field"><label>稅額</label><input type="number" name="tax_amount" step="1" value="${expense.tax_amount ?? ""}"></div>
        </div>
        <div class="field-row">
          <div class="field"><label>賣方統編</label><input name="seller_tax_id" value="${escapeHtml(expense.seller_tax_id) || ""}" placeholder="8 碼"></div>
          <div class="field"><label>買方統編</label><input name="buyer_tax_id" value="${escapeHtml(expense.buyer_tax_id) || ""}" placeholder="8 碼"></div>
        </div>
        <div class="field"><label>發票號碼</label><input name="receipt_number" value="${escapeHtml(expense.receipt_number) || ""}" placeholder="例: AX00123456"></div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn-secondary" onclick="stopInvoiceScan();closeModal()">取消</button>
        <button type="submit" class="btn-primary">儲存</button>
      </div>
    </form>`
  );

  wireInvoiceScanner("expense-edit-form", categories);

  document.getElementById("expense-edit-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = Object.fromEntries(fd.entries());
    const payload = {
      category_id: data.category_id ? Number(data.category_id) : null,
      amount: Number(data.amount),
      expense_date: data.expense_date,
      description: data.description || null,
      receipt_number: data.receipt_number || null,
      untaxed_amount: data.untaxed_amount ? Number(data.untaxed_amount) : null,
      tax_amount: data.tax_amount ? Number(data.tax_amount) : null,
      seller_tax_id: data.seller_tax_id || null,
      buyer_tax_id: data.buyer_tax_id || null,
    };
    try {
      await api(`/projects/${state.currentProjectId}/expenses/${expense.id}`, { method: "PATCH", body: payload });
      stopInvoiceScan();
      closeModal();
      toast("支出已更新", "success");
      renderTab("expenses");
    } catch (err) { }
  });
}

function openManageCategoriesModal(categories) {
  function renderList(cats) {
    return cats
      .map(
        (c) => `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">
          <span>${escapeHtml(c.name)} ${!c.is_active ? '<span class="mini-badge">已停用</span>' : ""}</span>
          <div class="actions-cell" style="display:flex;gap:6px">
            <button class="btn-secondary btn-sm" data-toggle-cat="${c.id}" data-active="${c.is_active}">${c.is_active ? "停用" : "啟用"}</button>
            <button class="btn-danger btn-sm" data-delete-cat="${c.id}">刪除</button>
          </div>
        </div>`
      )
      .join("");
  }

  openModal(
    "管理費用類別",
    `
    <div id="category-list">${renderList(categories)}</div>
    <form id="new-category-form" style="margin-top:16px;display:flex;gap:8px">
      <input name="name" placeholder="新增類別名稱" required style="flex:1">
      <button type="submit" class="btn-primary btn-sm">新增</button>
    </form>
    `
  );

  async function refresh() {
    const cats = await api(`/expense-categories`);
    document.getElementById("category-list").innerHTML = renderList(cats);
    wireButtons();
  }

  function wireButtons() {
    document.querySelectorAll("[data-toggle-cat]").forEach((btn) => {
      btn.onclick = async () => {
        const isActive = btn.dataset.active === "true";
        try {
          await api(`/expense-categories/${btn.dataset.toggleCat}`, { method: "PATCH", body: { is_active: !isActive } });
          await refresh();
        } catch (err) { }
      };
    });
    document.querySelectorAll("[data-delete-cat]").forEach((btn) => {
      btn.onclick = async () => {
        if (!confirm("確定要刪除此類別嗎?")) return;
        try {
          await api(`/expense-categories/${btn.dataset.deleteCat}`, { method: "DELETE" });
          await refresh();
        } catch (err) { }
      };
    });
  }
  wireButtons();

  document.getElementById("new-category-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api(`/expense-categories`, { method: "POST", body: { name: fd.get("name") } });
      e.target.reset();
      await refresh();
    } catch (err) { }
  });
}

