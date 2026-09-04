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

// ---- 台灣電子發票 QR / 條碼掃描 -------------------------------------------------

let _invoiceScanStream = null;
let _invoiceScanRAF = null;

function stopInvoiceScan() {
  if (_invoiceScanRAF) cancelAnimationFrame(_invoiceScanRAF);
  _invoiceScanRAF = null;
  if (_invoiceScanStream) {
    _invoiceScanStream.getTracks().forEach((t) => t.stop());
    _invoiceScanStream = null;
  }
  const stage = document.getElementById("invoice-scan-stage");
  if (stage) stage.classList.add("hidden");
}

// 財政部電子發票 QR（左方）固定欄位:
//  0-9   發票字軌號碼      10-16 開立日期(民國年3+月2+日2)
//  17-20 隨機碼            21-28 銷售額(未稅,16進位)
//  29-36 總計額(含稅,16進位)
// 一維條碼(Code39): 期別(民國yyymm,5) + 發票號碼(10) + 隨機碼(4)
function parseTwInvoice(raw) {
  if (!raw) return null;
  const s = String(raw).trim();

  // QR: 前 10 碼為 2 英文 + 8 數字
  if (/^[A-Z]{2}\d{8}/.test(s) && s.length >= 37) {
    const rocY = parseInt(s.slice(10, 13), 10);
    const mm = s.slice(13, 15);
    const dd = s.slice(15, 17);
    let dateStr = "";
    if (rocY > 0 && /^\d\d$/.test(mm) && /^\d\d$/.test(dd)) {
      dateStr = `${rocY + 1911}-${mm}-${dd}`;
    }
    let amount = parseInt(s.slice(29, 37), 16);
    if (!Number.isFinite(amount) || amount <= 0) amount = null;
    return { invoice_number: s.slice(0, 10), expense_date: dateStr || null, amount };
  }

  // Code39 一維條碼
  const m = /^(\d{5})([A-Z]{2}\d{8})(\d{4})$/.exec(s);
  if (m) {
    const rocY = parseInt(m[1].slice(0, 3), 10);
    const mm = m[1].slice(3, 5);
    return {
      invoice_number: m[2],
      expense_date: rocY > 0 ? `${rocY + 1911}-${mm}-01` : null,
      amount: null,
    };
  }
  return null;
}

function applyInvoiceToForm(formId, parsed) {
  const form = document.getElementById(formId);
  if (!form || !parsed) return;
  if (parsed.expense_date) form.querySelector('[name="expense_date"]').value = parsed.expense_date;
  if (parsed.amount != null) form.querySelector('[name="amount"]').value = parsed.amount;
  if (parsed.invoice_number) form.querySelector('[name="receipt_number"]').value = parsed.invoice_number;
}

// 綁定「掃描發票」按鈕。formId = 該表單 id,用來回填欄位。
// 優先用瀏覽器內建 BarcodeDetector(可讀 QR + 一維條碼);不支援時(iOS Safari、
// Firefox)退回打包在專案內的 jsQR,只讀 QR,但電子發票主要就是 QR。
function wireInvoiceScanner(formId) {
  const btn = document.getElementById("scan-invoice-btn");
  const panel = document.getElementById("invoice-scan-panel");
  const video = document.getElementById("invoice-scan-video");
  const fileInput = document.getElementById("invoice-scan-file");
  const closeBtn = document.getElementById("invoice-scan-close");
  const hint = document.getElementById("invoice-scan-hint");
  if (!btn || !panel) return;
  invoiceScanEnsureStyle();

  let detector = null;
  if ("BarcodeDetector" in window) {
    try {
      detector = new BarcodeDetector({ formats: ["qr_code", "code_39"] });
    } catch (e) {
      detector = null;
    }
  }
  const hasJsQR = typeof jsQR === "function";
  const canScan = detector || hasJsQR;
  let canvas = null;
  let frames = 0;

  // 一律先把(可裁切的)區域畫到 canvas,再交給 BarcodeDetector / jsQR。
  // crop = {sx,sy,sw,sh} 只掃該區域(定位框內),大幅提高發票小 QR 的成功率。
  async function scanFrom(source, w, h, crop) {
    const r = crop || { sx: 0, sy: 0, sw: w, sh: h };
    if (!r.sw || !r.sh) return { raw: null, parsed: null };
    const maxW = 1600;
    const scale = r.sw > maxW ? maxW / r.sw : 1;
    const cw = Math.max(1, Math.round(r.sw * scale));
    const ch = Math.max(1, Math.round(r.sh * scale));
    if (!canvas) canvas = document.createElement("canvas");
    canvas.width = cw;
    canvas.height = ch;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    try {
      ctx.drawImage(source, r.sx, r.sy, r.sw, r.sh, 0, 0, cw, ch);
    } catch (e) {
      return { raw: null, parsed: null };
    }
    let raw = null;
    if (detector) {
      try {
        const codes = await detector.detect(canvas);
        if (codes && codes.length) raw = codes[0].rawValue;
      } catch (e) {}
    }
    if (!raw && hasJsQR) {
      try {
        const img = ctx.getImageData(0, 0, cw, ch);
        const q = jsQR(img.data, cw, ch, { inversionAttempts: "attemptBoth" });
        if (q && q.data) raw = q.data;
      } catch (e) {}
    }
    return { raw, parsed: raw ? parseTwInvoice(raw) : null };
  }

  const finish = (res, quiet) => {
    if (res && res.parsed) {
      applyInvoiceToForm(formId, res.parsed);
      stopInvoiceScan();
      panel.classList.add("hidden");
      toast("已帶入發票資料，請確認金額與日期", "success");
      return true;
    }
    if (res && res.raw) {
      hint.textContent = "掃到的不是電子發票 QR:" + String(res.raw).slice(0, 60);
    } else if (!quiet) {
      toast("沒有辨識到 QR,請拍近一點、只框住 QR", "error");
    }
    return false;
  };

  btn.addEventListener("click", async () => {
    panel.classList.toggle("hidden");
    if (panel.classList.contains("hidden")) {
      stopInvoiceScan();
      return;
    }
    if (!canScan) {
      hint.textContent = "此瀏覽器無法掃描,請手動輸入。";
      video.classList.add("hidden");
      return;
    }
    hint.innerHTML = "把發票<strong>左方 QR code</strong>對進框內。";
    const stage = document.getElementById("invoice-scan-stage");
    if (stage) stage.classList.remove("hidden");
    try {
      _invoiceScanStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });
      video.srcObject = _invoiceScanStream;
      video.classList.remove("hidden");
      video.setAttribute("playsinline", "");
      await video.play();
      frames = 0;
      const tick = async () => {
        if (!_invoiceScanStream) return;
        if (video.readyState >= 2 && video.videoWidth) {
          frames++;
          const vw = video.videoWidth;
          const vh = video.videoHeight;
          const side = Math.floor(Math.min(vw, vh) * 0.82);
          const crop = {
            sx: Math.floor((vw - side) / 2),
            sy: Math.floor((vh - side) / 2),
            sw: side,
            sh: side,
          };
          const res = await scanFrom(video, vw, vh, crop);
          if (res.parsed && finish(res)) return;
          if (res.raw) finish(res); // 顯示掃到什麼,但繼續掃
          else if (frames % 20 === 0) hint.textContent = "掃描中…請讓 QR 填滿定位框、對到焦";
        }
        _invoiceScanRAF = requestAnimationFrame(tick);
      };
      _invoiceScanRAF = requestAnimationFrame(tick);
    } catch (e) {
      hint.textContent = "無法開啟相機(需 HTTPS 並允許權限):" + (e && e.name || e);
      video.classList.add("hidden");
    }
  });

  const aiBtn = document.getElementById("invoice-ai-btn");
  const extra = document.getElementById("invoice-scan-extra");

  // 把 blob 送後端 AI 辨識,成功就帶入欄位。
  async function aiRecognize(blob) {
    if (!blob) return;
    const pid = state.currentProjectId;
    if (!pid) {
      toast("請先進入案件", "error");
      return;
    }
    if (extra) extra.textContent = "AI 辨識中…約需 3~10 秒";
    const fd = new FormData();
    fd.append("file", blob, "invoice.jpg");
    try {
      const r = await api(`/projects/${pid}/expenses/scan-invoice`, { method: "POST", body: fd, isForm: true });
      const parsed = {
        invoice_number: r.invoice_number || null,
        expense_date: r.invoice_date || null,
        amount: r.total_amount != null ? r.total_amount : null,
      };
      if (!parsed.invoice_number && !parsed.expense_date && parsed.amount == null) {
        if (extra) extra.textContent = "AI 沒有從這張照片讀到發票欄位,請拍清楚一點或手動輸入";
        return;
      }
      applyInvoiceToForm(formId, parsed);
      stopInvoiceScan();
      panel.classList.add("hidden");
      const bits = [];
      if (r.seller_name) bits.push(r.seller_name);
      if (r.total_amount != null) bits.push("$" + r.total_amount);
      toast("AI 已帶入" + (bits.length ? "(" + bits.join(" / ") + ")" : "") + ",請確認", "success");
    } catch (e) {
      if (extra) extra.textContent = "AI 辨識失敗:" + (e && e.message ? e.message : e);
    }
  }

  // 從目前相機畫面截一張圖
  function grabStill() {
    if (!video.videoWidth) return null;
    const c = document.createElement("canvas");
    c.width = video.videoWidth;
    c.height = video.videoHeight;
    c.getContext("2d").drawImage(video, 0, 0);
    return new Promise((res) => c.toBlob((b) => res(b), "image/jpeg", 0.9));
  }

  if (aiBtn)
    aiBtn.addEventListener("click", async () => {
      if (panel.classList.contains("hidden")) panel.classList.remove("hidden");
      if (_invoiceScanStream) {
        const blob = await grabStill();
        if (blob) return aiRecognize(blob);
      }
      // 沒有開相機 → 讓使用者選檔,再走 AI
      fileInput.dataset.mode = "ai";
      fileInput.click();
    });

  if (closeBtn)
    closeBtn.addEventListener("click", () => {
      stopInvoiceScan();
      panel.classList.add("hidden");
    });

  if (fileInput)
    fileInput.addEventListener("change", async () => {
      const f = fileInput.files && fileInput.files[0];
      if (!f) return;
      const mode = fileInput.dataset.mode;
      fileInput.dataset.mode = "";
      if (mode === "ai") return aiRecognize(f);

      // 一般上傳:先試 QR,讀不到再自動轉 AI
      if (canScan) {
        try {
          const bitmap = await createImageBitmap(f);
          const res = await scanFrom(bitmap, bitmap.width, bitmap.height);
          if (bitmap.close) bitmap.close();
          if (res.parsed) return finish(res);
        } catch (e) {}
      }
      if (extra) extra.textContent = "沒讀到發票 QR,改用 AI 辨識…";
      aiRecognize(f);
    });
}

function invoiceScanEnsureStyle() {
  if (document.getElementById("invoice-scan-style")) return;
  const s = document.createElement("style");
  s.id = "invoice-scan-style";
  s.textContent = `
    #invoice-scan-stage { position:relative; width:100%; border-radius:12px; overflow:hidden; background:#000; }
    #invoice-scan-video { width:100%; display:block; max-height:64vh; object-fit:cover; }
    .isc-box { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%);
      width:78%; aspect-ratio:1/1; box-shadow:0 0 0 100vmax rgba(0,0,0,.5);
      border-radius:16px; }
    .isc-c { position:absolute; width:26px; height:26px; border:3px solid #34d399; }
    .isc-c.tl { top:-2px; left:-2px; border-right:0; border-bottom:0; border-top-left-radius:14px; }
    .isc-c.tr { top:-2px; right:-2px; border-left:0; border-bottom:0; border-top-right-radius:14px; }
    .isc-c.bl { bottom:-2px; left:-2px; border-right:0; border-top:0; border-bottom-left-radius:14px; }
    .isc-c.br { bottom:-2px; right:-2px; border-left:0; border-top:0; border-bottom-right-radius:14px; }
    .isc-line { position:absolute; left:6%; right:6%; height:2px; background:#34d399;
      box-shadow:0 0 8px #34d399; animation:isc-scan 2s linear infinite; }
    @keyframes isc-scan { 0%{top:6%} 50%{top:94%} 100%{top:6%} }
  `;
  document.head.appendChild(s);
}

const INVOICE_SCAN_HTML = `
  <button type="button" class="btn-secondary btn-sm" id="scan-invoice-btn" style="margin-bottom:10px">📷 掃描發票 QR / 條碼自動帶入</button>
  <div id="invoice-scan-panel" class="hidden" style="border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:14px;background:var(--bg-subtle)">
    <div id="invoice-scan-hint" style="font-size:13px;color:var(--text-muted);margin-bottom:8px">把發票<strong>左方 QR code</strong>對進框內。</div>
    <div id="invoice-scan-stage" class="hidden">
      <video id="invoice-scan-video" playsinline muted></video>
      <div class="isc-box">
        <span class="isc-c tl"></span><span class="isc-c tr"></span>
        <span class="isc-c bl"></span><span class="isc-c br"></span>
        <span class="isc-line"></span>
      </div>
    </div>
    <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
      <button type="button" class="btn-primary btn-sm" id="invoice-ai-btn" style="background:#0d9488;border-color:#0d9488">🤖 拍這張用 AI 辨識</button>
      <label class="btn-secondary btn-sm" style="cursor:pointer">上傳發票照片<input type="file" accept="image/*" id="invoice-scan-file" style="display:none"></label>
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
      <div class="field-row">
        <div class="field"><label>日期</label><input type="date" name="expense_date" value="${new Date().toISOString().slice(0, 10)}" required></div>
        <div class="field"><label>費用類別</label>
          <select name="category_id">
            <option value="">— 未分類 —</option>
            ${categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="field"><label>金額(新臺幣)</label><input type="number" name="amount" step="1" placeholder="例: 85000" required></div>
      <div class="field"><label>說明</label><input name="description" placeholder="例: 第一次說明會場地費"></div>
      <div class="field"><label>收據/發票號碼(選填)</label><input name="receipt_number" placeholder="例: AX-00123"></div>
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
      <div class="field-row">
        <div class="field"><label>日期</label><input type="date" name="expense_date" value="${fmtDate(expense.expense_date)}" required></div>
        <div class="field"><label>費用類別</label>
          <select name="category_id">
            <option value="">— 未分類 —</option>
            ${categories.map((c) => `<option value="${c.id}" ${expense.category_id === c.id ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="field"><label>金額(新臺幣)</label><input type="number" name="amount" step="1" value="${expense.amount}" required></div>
      <div class="field"><label>說明</label><input name="description" value="${escapeHtml(expense.description) || ""}" placeholder="例: 第一次說明會場地費"></div>
      <div class="field"><label>收據/發票號碼(選填)</label><input name="receipt_number" value="${escapeHtml(expense.receipt_number) || ""}" placeholder="例: AX-00123"></div>
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
