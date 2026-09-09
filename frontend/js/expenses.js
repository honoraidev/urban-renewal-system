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
        ${isEditor() ? `<button class="btn-secondary btn-sm" id="batch-import-btn" style="border-radius:20px">📥 批次匯入發票</button>` : ""}
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

  const batchBtn = document.getElementById("batch-import-btn");
  if (batchBtn) batchBtn.addEventListener("click", () => openBatchInvoiceModal(categories));
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

function stopInvoiceScan() {
  if (_invoiceAutoTimer) {
    clearTimeout(_invoiceAutoTimer);
    _invoiceAutoTimer = null;
  }
  _invoiceAutoAttempts = 0;
  if (_invoiceScanStream) {
    _invoiceScanStream.getTracks().forEach((t) => t.stop());
    _invoiceScanStream = null;
  }
  const stage = document.getElementById("invoice-scan-stage");
  if (stage) stage.classList.add("hidden");
}

function applyInvoiceToForm(formId, parsed) {
  const form = document.getElementById(formId);
  if (!form || !parsed) return;
  const set = (name, val) => {
    const el = form.querySelector(`[name="${name}"]`);
    if (el && val != null && val !== "") el.value = val;
  };
  set("expense_date", parsed.expense_date);
  set("amount", parsed.amount);
  set("receipt_number", parsed.invoice_number);
  set("untaxed_amount", parsed.untaxed_amount);
  set("tax_amount", parsed.tax_amount);
  set("seller_tax_id", parsed.seller_tax_id);
  set("buyer_tax_id", parsed.buyer_tax_id);
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
      background:#0d9488; color:#fff; border:none; margin-bottom:14px; }
    #scan-invoice-btn:hover { background:#0b7d73; opacity:1; }
    #invoice-scan-panel { border:1px solid var(--border); border-radius:12px; padding:12px;
      margin-bottom:16px; background:var(--bg-subtle); }
    #invoice-scan-hint { font-size:13px; color:var(--text-muted); margin-bottom:8px; min-height:18px; }
    .exp-sec { border:1px solid var(--border); border-radius:12px; padding:14px 16px 4px; margin-bottom:14px; background:var(--surface); }
    .exp-sec-title { font-size:12px; font-weight:800; color:var(--brand-dark, #0d9488); letter-spacing:.03em; margin-bottom:10px; }
    .exp-sec .field-row { flex-wrap:wrap; }
    .exp-sec .field-row > .field { min-width:130px; }
    .exp-amount-field input { font-size:20px; font-weight:800; }
    .batch-queue-grid { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:4px; }
    .batch-thumb { position:relative; width:76px; height:76px; border-radius:8px; overflow:hidden;
      border:1px solid var(--border); background:var(--surface-2); display:flex; align-items:center; justify-content:center; }
    .batch-thumb img { width:100%; height:100%; object-fit:cover; }
    .batch-thumb-name { font-size:10px; color:var(--text-muted); padding:2px; text-align:center; word-break:break-all; }
    .batch-thumb-x { position:absolute; top:2px; right:2px; width:18px; height:18px; border-radius:50%;
      border:none; background:rgba(0,0,0,.6); color:#fff; font-size:12px; line-height:1; cursor:pointer; padding:0; }
    .batch-row-error td { background:rgba(239,68,68,.06); }
    #batch-step-review table input, #batch-step-review table select { padding:5px 7px; font-size:12.5px; }
  `;
  document.head.appendChild(s);
}

// 綁定發票辨識按鈕。formId = 該表單 id,用來回填欄位。整張發票拍照後交後端本機 OCR 辨識。
function wireInvoiceScanner(formId) {
  const btn = document.getElementById("scan-invoice-btn");
  const panel = document.getElementById("invoice-scan-panel");
  const video = document.getElementById("invoice-scan-video");
  const fileInput = document.getElementById("invoice-scan-file");
  const closeBtn = document.getElementById("invoice-scan-close");
  const shotBtn = document.getElementById("invoice-shot-btn");
  const hint = document.getElementById("invoice-scan-hint");
  const extra = document.getElementById("invoice-scan-extra");
  if (!btn || !panel) return;
  invoiceScanEnsureStyle();

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

  // 回傳是否成功帶入欄位 — 讓自動連拍迴圈知道要不要再拍一次。
  async function aiRecognize(blob, { auto = false } = {}) {
    if (!blob) {
      if (!auto) {
        if (extra) extra.textContent = "沒有抓到畫面,請再按一次「立即拍照」,或改用「上傳發票照片 / PDF」。";
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
      const parsed = {
        invoice_number: r.invoice_number || null,
        expense_date: r.invoice_date || null,
        amount: r.total_amount != null ? r.total_amount : null,
        untaxed_amount: r.untaxed_amount != null ? r.untaxed_amount : null,
        tax_amount: r.tax_amount != null ? r.tax_amount : null,
        seller_tax_id: r.seller_tax_id || null,
        buyer_tax_id: r.buyer_tax_id || null,
      };
      if (!parsed.invoice_number && !parsed.expense_date && parsed.amount == null) {
        if (!auto && extra) extra.textContent = "沒有讀到發票欄位,請拍清楚一點(對正、光線足、填滿框)再試";
        return false;
      }
      applyInvoiceToForm(formId, parsed);
      stopInvoiceScan();
      panel.classList.add("hidden");
      const src = r.source === "qr" ? "QR" : r.source === "gemini" ? "AI" : "OCR";
      const typeLabel = INVOICE_TYPE_LABEL[r.invoice_type] || "";
      toast(
        `已由 ${src} 帶入${typeLabel ? `(${typeLabel})` : ""}${r.total_amount != null ? " · 總計 $" + r.total_amount : ""},請確認`,
        "success"
      );
      return true;
    } catch (e) {
      if (extra) extra.textContent = "辨識失敗:" + (e && e.message ? e.message : e);
      return false;
    } finally {
      if (shotBtn) shotBtn.disabled = false;
    }
  }

  // 開鏡頭後不用手動按快門 — 對到焦就自動連拍+辨識,拍到有讀到欄位為止(最多
  // INVOICE_AUTO_MAX_ATTEMPTS 次)。手動「立即拍照」可隨時插隊、跳過等待。
  async function autoCaptureLoop() {
    _invoiceAutoTimer = null;
    if (!_invoiceScanStream) return;
    _invoiceAutoAttempts++;
    const blob = await grabStill();
    if (!blob) {
      if (_invoiceAutoAttempts < INVOICE_AUTO_MAX_ATTEMPTS) {
        _invoiceAutoTimer = setTimeout(autoCaptureLoop, 250);
      } else if (extra) {
        extra.textContent = "沒有抓到相機畫面,請按「立即拍照」再試,或改用上傳照片。";
      }
      return;
    }
    const ok = await aiRecognize(blob, { auto: true });
    if (!ok && _invoiceScanStream) {
      if (_invoiceAutoAttempts < INVOICE_AUTO_MAX_ATTEMPTS) {
        _invoiceAutoTimer = setTimeout(autoCaptureLoop, 500);
      } else if (extra) {
        extra.textContent = "自動掃描沒讀到欄位,請按「立即拍照」重試,並確認發票對正、填滿框、光線充足。";
      }
    }
  }

  async function openCamera() {
    const stage = document.getElementById("invoice-scan-stage");
    if (stage) stage.classList.remove("hidden");
    hint.textContent = "把整張發票放進框內、對正、填滿框 — 對到焦會自動拍照辨識,不用按快門。";
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
      hint.textContent = "無法開啟相機(需 HTTPS 並允許權限):" + ((e && e.name) || e) + "。可改用「上傳發票照片」。";
      if (stage) stage.classList.add("hidden");
    }
  }

  btn.addEventListener("click", async () => {
    panel.classList.toggle("hidden");
    if (panel.classList.contains("hidden")) {
      stopInvoiceScan();
      return;
    }
    if (extra) extra.textContent = "";
    await openCamera();
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
      const blob = await grabStill();
      const ok = await aiRecognize(blob, { auto: false });
      // 手動這次沒抓到也沒關係,自動連拍繼續接手,不用使用者一直按
      if (!ok && _invoiceScanStream && _invoiceAutoAttempts < INVOICE_AUTO_MAX_ATTEMPTS) {
        _invoiceAutoTimer = setTimeout(autoCaptureLoop, 500);
      }
    });

  if (closeBtn)
    closeBtn.addEventListener("click", () => {
      stopInvoiceScan();
      panel.classList.add("hidden");
    });

  if (fileInput)
    fileInput.addEventListener("change", () => {
      const f = fileInput.files && fileInput.files[0];
      if (f) aiRecognize(f);
      fileInput.value = "";
    });
}

const INVOICE_SCAN_HTML = `
  <button type="button" id="scan-invoice-btn">📷 掃描發票 — 對準鏡頭自動辨識</button>
  <div id="invoice-scan-panel" class="hidden">
    <div id="invoice-scan-hint">把整張發票放進框內、對正、填滿框 — 對到焦會自動拍照辨識,不用按快門。</div>
    <div id="invoice-scan-stage" class="hidden">
      <video id="invoice-scan-video" playsinline muted></video>
      <div class="isc-box">
        <span class="isc-c tl live"></span><span class="isc-c tr live"></span>
        <span class="isc-c bl live"></span><span class="isc-c br live"></span>
      </div>
    </div>
    <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
      <button type="button" class="btn-primary btn-sm" id="invoice-shot-btn" style="background:#0d9488;border-color:#0d9488">📸 立即拍照</button>
      <label class="btn-secondary btn-sm" style="cursor:pointer">上傳發票照片 / PDF<input type="file" accept="image/*,application/pdf" id="invoice-scan-file" style="display:none"></label>
      <button type="button" class="btn-secondary btn-sm" id="invoice-scan-close">關閉</button>
    </div>
    <div id="invoice-scan-extra" class="helper-text" style="margin-top:6px"></div>
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

  wireInvoiceScanner("expense-form");

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

  wireInvoiceScanner("expense-edit-form");

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

// ---- 批次匯入發票(多張照片 / 多個檔案 / 一份多頁 PDF 一次辨識,審核後一次儲存) ----

let _batchQueue = []; // [{blob, name, previewUrl}]
let _batchCameraStream = null;
let _batchCategories = [];

function batchInvoiceEnsureStyle() {
  invoiceScanEnsureStyle(); // 共用同一份 style,batch 的規則已併進去
}

function _batchStopCamera() {
  if (_batchCameraStream) {
    _batchCameraStream.getTracks().forEach((t) => t.stop());
    _batchCameraStream = null;
  }
}

function _batchRenderQueue() {
  const wrap = document.getElementById("batch-queue-list");
  const countEl = document.getElementById("batch-queue-count");
  const scanBtn = document.getElementById("batch-scan-btn");
  if (!wrap) return;
  wrap.innerHTML = _batchQueue
    .map((item, i) => {
      const isImg = (item.blob.type || "").startsWith("image/");
      return `<div class="batch-thumb" title="${escapeHtml(item.name)}">
        ${isImg
          ? `<img src="${item.previewUrl}" alt="">`
          : `<div class="batch-thumb-name">📄<br>${escapeHtml(item.name.slice(0, 14))}</div>`}
        <button type="button" class="batch-thumb-x" data-batch-remove="${i}">×</button>
      </div>`;
    })
    .join("");
  if (countEl) countEl.textContent = _batchQueue.length;
  if (scanBtn) scanBtn.disabled = _batchQueue.length === 0;
  wrap.querySelectorAll("[data-batch-remove]").forEach((b) => {
    b.addEventListener("click", () => {
      const idx = Number(b.dataset.batchRemove);
      if (_batchQueue[idx].previewUrl) URL.revokeObjectURL(_batchQueue[idx].previewUrl);
      _batchQueue.splice(idx, 1);
      _batchRenderQueue();
    });
  });
}

function _batchAddFile(blob, name) {
  const isImg = (blob.type || "").startsWith("image/");
  _batchQueue.push({
    blob,
    name: name || blob.name || `invoice_${_batchQueue.length + 1}.jpg`,
    previewUrl: isImg ? URL.createObjectURL(blob) : "",
  });
  _batchRenderQueue();
}

async function _batchOpenCamera() {
  const stage = document.getElementById("batch-cam-stage");
  const video = document.getElementById("batch-cam-video");
  if (!stage || !video) return;
  stage.classList.remove("hidden");
  try {
    _batchCameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    video.srcObject = _batchCameraStream;
    video.setAttribute("playsinline", "");
    await video.play();
  } catch (e) {
    toast("無法開啟相機(需 HTTPS 並允許權限):" + ((e && e.name) || e), "error");
    stage.classList.add("hidden");
  }
}

function _batchGrabStill(video) {
  if (!video || !video.videoWidth) return Promise.resolve(null);
  const c = document.createElement("canvas");
  c.width = video.videoWidth;
  c.height = video.videoHeight;
  c.getContext("2d").drawImage(video, 0, 0);
  return new Promise((res) => c.toBlob((b) => res(b), "image/jpeg", 0.85));
}

function openBatchInvoiceModal(categories) {
  _batchQueue = [];
  _batchCategories = categories || [];
  batchInvoiceEnsureStyle();

  openModal(
    "批次匯入發票",
    `
    <div id="batch-step-collect">
      <div class="helper-text" style="margin-bottom:10px">
        拍照或選多張發票照片 / PDF 加入清單(一份 PDF 裡有好幾頁發票、或一張照片拍了好幾張電子發票 QR 都會自動拆開),
        加完按「開始辨識」,辨識完再一次確認金額、一次儲存。
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">
        <button type="button" class="btn-secondary btn-sm" id="batch-cam-btn">📷 拍照加入</button>
        <label class="btn-secondary btn-sm" style="cursor:pointer">📁 選擇多個檔案(可複選)
          <input type="file" id="batch-file-input" accept="image/*,application/pdf" multiple style="display:none">
        </label>
      </div>
      <div id="batch-cam-stage" class="hidden" style="margin-bottom:10px">
        <video id="batch-cam-video" playsinline muted style="width:100%;border-radius:12px;max-height:50vh;object-fit:cover;background:#000;display:block"></video>
        <div style="display:flex;gap:8px;margin-top:8px">
          <button type="button" class="btn-primary btn-sm" id="batch-cam-shot" style="background:#0d9488;border-color:#0d9488">📸 拍照加入(可連續拍)</button>
          <button type="button" class="btn-secondary btn-sm" id="batch-cam-close">關閉相機</button>
        </div>
      </div>
      <div id="batch-queue-list" class="batch-queue-grid"></div>
      <div class="modal-footer">
        <span class="helper-text" style="margin-right:auto">已加入 <strong id="batch-queue-count">0</strong> 個檔案</span>
        <button type="button" class="btn-secondary" id="batch-cancel-btn">取消</button>
        <button type="button" class="btn-primary" id="batch-scan-btn" disabled style="background:#0d9488;border-color:#0d9488">開始辨識</button>
      </div>
    </div>
    <div id="batch-step-review" class="hidden"></div>
    `,
    { width: "760px" }
  );

  _batchRenderQueue();

  document.getElementById("batch-cam-btn").addEventListener("click", _batchOpenCamera);
  document.getElementById("batch-cam-close").addEventListener("click", () => {
    _batchStopCamera();
    document.getElementById("batch-cam-stage").classList.add("hidden");
  });
  document.getElementById("batch-cam-shot").addEventListener("click", async () => {
    const video = document.getElementById("batch-cam-video");
    const blob = await _batchGrabStill(video);
    if (blob) _batchAddFile(blob, `拍照_${_batchQueue.length + 1}.jpg`);
    else toast("沒抓到畫面,請再試一次", "error");
  });
  document.getElementById("batch-file-input").addEventListener("change", (e) => {
    [...e.target.files].forEach((f) => _batchAddFile(f, f.name));
    e.target.value = "";
  });
  document.getElementById("batch-cancel-btn").addEventListener("click", () => {
    _batchStopCamera();
    closeModal();
  });
  document.getElementById("batch-scan-btn").addEventListener("click", _batchRunScan);
}

async function _batchRunScan() {
  _batchStopCamera();
  const stage = document.getElementById("batch-cam-stage");
  if (stage) stage.classList.add("hidden");
  const pid = state.currentProjectId;
  const scanBtn = document.getElementById("batch-scan-btn");
  scanBtn.disabled = true;
  const oldLabel = scanBtn.textContent;
  scanBtn.textContent = `辨識中…請稍候(共 ${_batchQueue.length} 個檔案)`;
  const fd = new FormData();
  _batchQueue.forEach((item) => fd.append("files", item.blob, item.name));
  let results = [];
  try {
    const r = await api(`/projects/${pid}/expenses/scan-invoice-batch`, { method: "POST", body: fd, isForm: true });
    results = r.results || [];
  } catch (e) {
    scanBtn.disabled = false;
    scanBtn.textContent = oldLabel;
    return;
  }
  if (!results.length) {
    toast("沒有辨識出任何發票", "error");
    scanBtn.disabled = false;
    scanBtn.textContent = oldLabel;
    return;
  }
  _batchRenderReview(results);
}

function _batchRenderReview(results) {
  document.getElementById("batch-step-collect").classList.add("hidden");
  const stepReview = document.getElementById("batch-step-review");
  stepReview.classList.remove("hidden");

  const catOptions = (selectedId) =>
    `<option value="">— 未分類 —</option>` +
    _batchCategories.map((c) => `<option value="${c.id}" ${selectedId === c.id ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("");

  const rowsHtml = results
    .map((r, i) => {
      const hasError = !!r.error;
      const src = `${escapeHtml(r.source_filename || "")}${r.page ? ` #${r.page}` : ""}`;
      if (hasError) {
        return `<tr data-batch-row="${i}" class="batch-row-error">
          <td><input type="checkbox" class="batch-row-check" disabled></td>
          <td class="helper-text" style="white-space:nowrap">${src}</td>
          <td colspan="6" style="color:var(--danger)">${escapeHtml(r.error)}</td>
        </tr>`;
      }
      const typeLabel = INVOICE_TYPE_LABEL[r.invoice_type] || "";
      const srcTag = r.source === "qr" ? "QR" : r.source === "gemini" ? "AI" : "OCR";
      return `<tr data-batch-row="${i}">
        <td><input type="checkbox" class="batch-row-check" checked></td>
        <td class="helper-text" style="white-space:nowrap">${src}<br>${typeLabel} · ${srcTag}</td>
        <td><input type="date" class="b-date" value="${escapeHtml(r.invoice_date) || ""}" style="width:130px"></td>
        <td><select class="b-cat" style="min-width:110px">${catOptions(null)}</select></td>
        <td><input type="number" class="b-amount" value="${r.total_amount ?? ""}" style="width:90px" required></td>
        <td><input class="b-desc" placeholder="說明" style="width:130px"></td>
        <td><input class="b-receipt" value="${escapeHtml(r.invoice_number) || ""}" style="width:110px"></td>
        <td><button type="button" class="btn-secondary btn-sm" data-batch-drop="${i}">移除</button></td>
      </tr>`;
    })
    .join("");

  stepReview.innerHTML = `
    <div class="helper-text" style="margin-bottom:8px">請確認每筆金額 / 類別再儲存;讀不到的行(紅底)不會被儲存,可以直接移除。</div>
    <div class="table-wrap" style="max-height:48vh;overflow:auto">
      <table style="width:100%">
        <thead><tr><th></th><th>來源</th><th>日期</th><th>類別</th><th>金額</th><th>說明</th><th>發票號碼</th><th></th></tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>
    </div>
    <div class="modal-footer">
      <span class="helper-text" style="margin-right:auto" id="batch-review-summary"></span>
      <button type="button" class="btn-secondary" id="batch-review-back">上一步</button>
      <button type="button" class="btn-primary" id="batch-save-all" style="background:#0d9488;border-color:#0d9488">全部儲存</button>
    </div>
  `;

  const updateSummary = () => {
    const rows = [...stepReview.querySelectorAll("tr[data-batch-row]")];
    let n = 0;
    let total = 0;
    rows.forEach((tr) => {
      const chk = tr.querySelector(".batch-row-check");
      if (chk && chk.checked && !chk.disabled) {
        n++;
        total += Number(tr.querySelector(".b-amount")?.value) || 0;
      }
    });
    const el = document.getElementById("batch-review-summary");
    if (el) el.textContent = `已選 ${n} 筆・合計 NT$${fmtMoney(total)}`;
  };
  stepReview.addEventListener("input", updateSummary);
  stepReview.addEventListener("change", updateSummary);
  updateSummary();

  stepReview.querySelectorAll("[data-batch-drop]").forEach((btn) => {
    btn.addEventListener("click", () => {
      btn.closest("tr")?.remove();
      updateSummary();
    });
  });

  document.getElementById("batch-review-back").addEventListener("click", () => {
    stepReview.classList.add("hidden");
    stepReview.innerHTML = "";
    document.getElementById("batch-step-collect").classList.remove("hidden");
    const scanBtn = document.getElementById("batch-scan-btn");
    scanBtn.disabled = _batchQueue.length === 0;
    scanBtn.textContent = "開始辨識";
  });

  document.getElementById("batch-save-all").addEventListener("click", async () => {
    const saveBtn = document.getElementById("batch-save-all");
    const rows = [...stepReview.querySelectorAll("tr[data-batch-row]")].filter((tr) => {
      const chk = tr.querySelector(".batch-row-check");
      return chk && chk.checked && !chk.disabled;
    });
    if (!rows.length) {
      toast("沒有勾選要儲存的項目", "error");
      return;
    }
    saveBtn.disabled = true;
    let ok = 0;
    let fail = 0;
    for (const tr of rows) {
      const amount = Number(tr.querySelector(".b-amount")?.value);
      if (!amount) {
        fail++;
        continue;
      }
      const payload = {
        category_id: tr.querySelector(".b-cat")?.value ? Number(tr.querySelector(".b-cat").value) : null,
        amount,
        expense_date: tr.querySelector(".b-date")?.value || new Date().toISOString().slice(0, 10),
        description: tr.querySelector(".b-desc")?.value || null,
        receipt_number: tr.querySelector(".b-receipt")?.value || null,
      };
      saveBtn.textContent = `儲存中…(${ok + fail + 1}/${rows.length})`;
      try {
        await api(`/projects/${state.currentProjectId}/expenses`, { method: "POST", body: payload, silent: true });
        ok++;
      } catch (e) {
        fail++;
      }
    }
    closeModal();
    toast(fail ? `已儲存 ${ok} 筆,${fail} 筆失敗` : `已儲存 ${ok} 筆支出`, fail ? "error" : "success");
    renderTab("expenses");
  });
}
