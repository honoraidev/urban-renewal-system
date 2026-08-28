"use strict";

function escapeHtml(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtDateTime(iso) {
  if (!iso) return "-";
  const isoWithZone = /[Zz]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso}Z`;
  const d = new Date(isoWithZone);
  if (isNaN(d)) return iso;
  return d.toLocaleString("zh-TW", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function fmtDate(iso) {
  if (!iso) return "-";
  return String(iso).slice(0, 10);
}

function fmtPct(ratio) {
  return (ratio * 100).toFixed(1) + "%";
}

function fmtMoney(n) {
  return Number(n).toLocaleString("zh-TW", { maximumFractionDigits: 0 });
}

function formatMonthToMinguo(val) {
  if (!val) return "";
  const s = String(val).trim();
  if (!s) return "";
  
  // Western YYYY-MM (e.g. 1997-01)
  const gMatch = /^(\d{4})[-/.]?(\d{1,2})$/.exec(s);
  if (gMatch) {
    const rocYear = Number(gMatch[1]) - 1911;
    const month = String(gMatch[2]).padStart(2, "0");
    if (rocYear > 0) return `${rocYear}年${month}月`;
  }
  
  // Minguo format e.g. 86-01, 86/01, 86.01, 86年1月, 086年01月
  const mMatch = /^(\d{2,3})[年/.-]?\s*(\d{1,2})月?$/.exec(s);
  if (mMatch) {
    const mYear = mMatch[1];
    const month = String(mMatch[2]).padStart(2, "0");
    return `${mYear}年${month}月`;
  }
  
  return s;
}

function formatMinguoToMonth(minguoStr) {
  if (!minguoStr) return "";
  const match = /(\d{2,3})\s*年\s*(\d{1,2})\s*月/.exec(String(minguoStr).trim());
  if (match) {
    const yyyy = Number(match[1]) + 1911;
    const mm = String(match[2]).padStart(2, "0");
    return `${yyyy}-${mm}`;
  }
  return minguoStr;
}

// A native <input type="month"> is Gregorian-only, but the values here (地價年月) are
// always printed on deeds/tax notices as Minguo year (民國), e.g. "114年01月" - a
// Gregorian<->Minguo conversion would need to round-trip through a real date parser,
// adding exactly the kind of misread-year risk this field already avoids by staying
// plain text (see land_record.py's ltt_original_value_period comment). This renders a
// button that pops open a small year+month-only panel (no day grid, since the value
// never has a day component) - see wireYearMonthPickers for the popup behavior.
function minguoYearMonthPickerHtml(namePrefix, value) {
  // Not anchored/exact-format on purpose - OCR extraction sometimes prefixes this with
  // "民國" (e.g. "民國114年01月" instead of the expected plain "114年01月"), and an
  // anchored ^...$ regex would silently fail to parse that, leaving a value that's
  // genuinely there in the data invisible in the picker (shows the "選擇年月"
  // placeholder even though declared_value_period is populated).
  const match = /(\d{2,3})\s*年\s*(\d{1,2})\s*月/.exec((value || "").trim());
  const selectedYear = match ? Number(match[1]) : null;
  const selectedMonth = match ? Number(match[2]) : null;
  const label = selectedYear && selectedMonth ? `${selectedYear}年${String(selectedMonth).padStart(2, "0")}月` : "選擇年月";
  return `
    <span class="ymp" data-ymp-name="${namePrefix}" data-ymp-year="${selectedYear || ""}" data-ymp-month="${selectedMonth || ""}">
      <button type="button" class="ymp-trigger"><span class="ymp-trigger-label">${label}</span></button>
      <input type="hidden" name="${namePrefix}_year" value="${selectedYear || ""}">
      <input type="hidden" name="${namePrefix}_month" value="${selectedMonth || ""}">
    </span>`;
}

function readMinguoYearMonth(fd, namePrefix) {
  const year = fd.get(`${namePrefix}_year`);
  const month = fd.get(`${namePrefix}_month`);
  if (!year || !month) return "";
  return `${year}年${String(month).padStart(2, "0")}月`;
}

// Call once after inserting any minguoYearMonthPickerHtml() markup into the DOM (safe to
// call repeatedly - each .ymp only gets wired once). A single shared popup panel is
// reused across every picker on the page rather than one pre-built per picker, since
// only one can ever be open at a time.
let ympPanelEl = null;

function wireYearMonthPickers(container) {
  container.querySelectorAll(".ymp:not([data-ymp-wired])").forEach((wrap) => {
    wrap.setAttribute("data-ymp-wired", "1");
    wrap.querySelector(".ymp-trigger").addEventListener("click", (e) => {
      e.stopPropagation();
      openYearMonthPanel(wrap);
    });
  });
}

function closeYearMonthPanel() {
  if (ympPanelEl) {
    ympPanelEl.remove();
    ympPanelEl = null;
    document.removeEventListener("click", closeYearMonthPanel);
  }
}

function openYearMonthPanel(wrap) {
  closeYearMonthPanel();
  const currentMinguoYear = new Date().getFullYear() - 1911;
  let year = Number(wrap.dataset.ympYear) || currentMinguoYear;
  const selectedMonth = Number(wrap.dataset.ympMonth) || null;
  let decadeView = false;
  let decadeStart = Math.floor((year - 1) / 12) * 12 + 1;

  const panel = document.createElement("div");
  panel.className = "ymp-panel";
  const render = () => {
    if (decadeView) {
      panel.innerHTML = `
        <div class="ymp-panel-header">
          <span class="ymp-panel-title">民國${decadeStart}—${decadeStart + 11}年</span>
          <div class="ymp-nav-arrows">
            <button type="button" class="ymp-nav-btn" data-ymp-decade-prev title="上一批">↑</button>
            <button type="button" class="ymp-nav-btn" data-ymp-decade-next title="下一批">↓</button>
          </div>
        </div>
        <div class="ymp-month-grid">
          ${Array.from({ length: 12 }, (_, i) => decadeStart + i)
          .map(
            (y) =>
              `<button type="button" class="ymp-month-btn ${y === year ? "selected" : ""}" data-ymp-year-pick="${y}">${y}</button>`
          )
          .join("")}
        </div>`;
      panel.querySelector("[data-ymp-decade-prev]").addEventListener("click", (e) => {
        e.stopPropagation();
        decadeStart -= 12;
        render();
      });
      panel.querySelector("[data-ymp-decade-next]").addEventListener("click", (e) => {
        e.stopPropagation();
        decadeStart += 12;
        render();
      });
      panel.querySelectorAll("[data-ymp-year-pick]").forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          year = Number(btn.dataset.ympYearPick);
          decadeView = false;
          render();
        });
      });
      return;
    }
    panel.innerHTML = `
      <div class="ymp-panel-header">
        <span class="ymp-panel-title" data-ymp-open-decade>民國${year}年 <span class="ymp-panel-title-caret">▾</span></span>
        <div class="ymp-nav-arrows">
          <button type="button" class="ymp-nav-btn" data-ymp-prev title="上一年">↑</button>
          <button type="button" class="ymp-nav-btn" data-ymp-next title="下一年">↓</button>
        </div>
      </div>
      <div class="ymp-month-grid">
        ${Array.from({ length: 12 }, (_, i) => i + 1)
        .map(
          (m) =>
            `<button type="button" class="ymp-month-btn ${year === Number(wrap.dataset.ympYear) && m === selectedMonth ? "selected" : ""}" data-ymp-month="${m}">${String(m).padStart(2, "0")}月</button>`
        )
        .join("")}
      </div>
      <div class="ymp-panel-footer">
        <button type="button" class="ymp-panel-link" data-ymp-clear>清除</button>
        <button type="button" class="ymp-panel-link" data-ymp-today>本月</button>
      </div>`;
    panel.querySelector("[data-ymp-open-decade]").addEventListener("click", (e) => {
      e.stopPropagation();
      decadeStart = Math.floor((year - 1) / 12) * 12 + 1;
      decadeView = true;
      render();
    });
    panel.querySelector("[data-ymp-prev]").addEventListener("click", (e) => {
      e.stopPropagation();
      year -= 1;
      render();
    });
    panel.querySelector("[data-ymp-next]").addEventListener("click", (e) => {
      e.stopPropagation();
      year += 1;
      render();
    });
    panel.querySelectorAll("[data-ymp-month]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const month = Number(btn.dataset.ympMonth);
        wrap.dataset.ympYear = String(year);
        wrap.dataset.ympMonth = String(month);
        wrap.querySelector(`input[name$="_year"]`).value = String(year);
        wrap.querySelector(`input[name$="_month"]`).value = String(month);
        wrap.querySelector(".ymp-trigger-label").textContent = `${year}年${String(month).padStart(2, "0")}月`;
        closeYearMonthPanel();
      });
    });
    panel.querySelector("[data-ymp-clear]").addEventListener("click", (e) => {
      e.stopPropagation();
      wrap.dataset.ympYear = "";
      wrap.dataset.ympMonth = "";
      wrap.querySelector(`input[name$="_year"]`).value = "";
      wrap.querySelector(`input[name$="_month"]`).value = "";
      wrap.querySelector(".ymp-trigger-label").textContent = "選擇年月";
      closeYearMonthPanel();
    });
    panel.querySelector("[data-ymp-today]").addEventListener("click", (e) => {
      e.stopPropagation();
      const now = new Date();
      year = now.getFullYear() - 1911;
      render();
    });
  };
  render();

  document.body.appendChild(panel);
  const rect = wrap.getBoundingClientRect();
  panel.style.top = `${rect.bottom + window.scrollY + 4}px`;
  panel.style.left = `${rect.left + window.scrollX}px`;
  ympPanelEl = panel;
  setTimeout(() => document.addEventListener("click", closeYearMonthPanel), 0);
  panel.addEventListener("click", (e) => e.stopPropagation());
}

// L1-L4: general case-data editing (landowners/contacts/expenses/encumbrances/SOP).
function isEditor() {
  return state.user && ["sys_admin", "manager", "case_owner", "case_staff"].includes(state.user.role);
}

// L1/L2: full cross-project management (delete/force actions, expense categories, member assignment).
function isManager() {
  return state.user && ["sys_admin", "manager"].includes(state.user.role);
}

// L1 only: user account management, login logs.
function isSystemAdmin() {
  return state.user && state.user.role === "sys_admin";
}

// L1-L5: OCR/document-upload functionality.
function canOcr() {
  return state.user && ["sys_admin", "manager", "case_owner", "case_staff", "ocr_staff"].includes(state.user.role);
}

// L1-L3: can create a new project.
function canCreateProject() {
  return state.user && ["sys_admin", "manager", "case_owner"].includes(state.user.role);
}
