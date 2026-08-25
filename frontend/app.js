"use strict";

const API_BASE = "/api";

const state = {
  token: sessionStorage.getItem("token") || null,
  user: null,
  currentProjectId: null,
  currentProject: null,
  activeTab: "sop",
  projectCache: {},
};

/* ================= API helper ================= */

async function api(path, { method = "GET", body, isForm = false, params, silent = false } = {}) {
  let url = API_BASE + path;
  if (params) {
    const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "");
    if (entries.length) url += "?" + new URLSearchParams(entries).toString();
  }
  const headers = {};
  if (state.token) headers["Authorization"] = "Bearer " + state.token;
  let fetchBody;
  if (isForm) {
    fetchBody = body;
  } else if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    fetchBody = JSON.stringify(body);
  }

  let res;
  try {
    res = await fetch(url, { method, headers, body: fetchBody });
  } catch (err) {
    toast("無法連線到伺服器", "error");
    throw err;
  }

  if (res.status === 401) {
    if (!silent) toast("登入已逾期,請重新登入", "error");
    doLogout();
    throw new Error("unauthorized");
  }

  if (!res.ok) {
    let detail = res.statusText;
    try {
      const data = await res.json();
      detail = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail || data);
    } catch (e) {}
    if (!silent) toast(detail, "error");
    throw new Error(detail);
  }

  if (res.status === 204) return null;
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json();
  return res;
}

/* ================= Toast ================= */

function toast(message, type = "info") {
  const container = document.getElementById("toast-container");
  const el = document.createElement("div");
  el.className = `toast toast-${type}`;
  el.textContent = message;
  container.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 300);
  }, 3500);
}

/* ================= Modal ================= */

function openModal(title, bodyHtml, { width = "480px" } = {}) {
  const root = document.getElementById("modal-root");
  root.innerHTML = `
    <div class="modal-overlay" id="modal-overlay">
      <div class="modal-dialog" style="max-width:${width}">
        <div class="modal-header">
          <h3>${title}</h3>
          <button class="modal-close" id="modal-close-btn" type="button">&times;</button>
        </div>
        <div class="modal-body">${bodyHtml}</div>
      </div>
    </div>`;
  root.querySelector("#modal-close-btn").onclick = closeModal;
  // Deliberately no click-outside-to-close: multi-step flows (batch import, scanned
  // deed wizard) can represent several minutes of uploads/OCR/review, and a stray click
  // just outside the dialog edge was silently discarding all of it. Closing now always
  // requires an explicit action (X button, or a Cancel/上一步 button in the dialog body).
  return root;
}

function closeModal() {
  document.getElementById("modal-root").innerHTML = "";
}

/* ================= Formatting helpers ================= */

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
  // The backend stores/serializes timestamps as naive UTC (no "Z"/offset suffix) - JS's
  // Date parser treats a timezone-less ISO string as already being in the browser's
  // local time, so without this it silently skipped the UTC->local conversion entirely
  // and displayed the raw UTC value as if it were local (e.g. an upload at 12:21 local
  // Taipei time showed as "04:21" - off by exactly the UTC+8 offset).
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

const CONTACT_STATUS_LABEL = { not_contacted: "未聯絡", contacted: "已聯絡", declined: "婉拒", agreed: "同意" };
const CONSENT_STATUS_LABEL = { pending: "待確認", agreed: "同意", opposed: "反對" };
const PROJECT_STATUS_LABEL = { active: "進行中", closed: "已結案", suspended: "暫停" };
const TAIWAN_CITIES = [
  "臺北市", "新北市", "桃園市", "臺中市", "臺南市", "高雄市",
  "基隆市", "新竹市", "新竹縣", "苗栗縣", "彰化縣", "南投縣",
  "雲林縣", "嘉義市", "嘉義縣", "屏東縣", "宜蘭縣", "花蓮縣",
  "臺東縣", "澎湖縣", "金門縣", "連江縣",
];
const DOC_TYPE_LABEL = {
  property_register: "土地登記謄本", building_register: "建物登記謄本", consent_form: "同意書", briefing_material: "說明會資料",
  contract: "合約", photo: "照片", other: "其他",
  dev_letter_template: "開發信", willingness_form_template: "意願書",
  consent_form_template: "同意書", contract_template: "合約",
  cadastral_map: "地籍圖", consultant_document: "顧問文件",
};

const DOC_TYPE_KEYWORDS = {
  dev_letter_template: ["開發信", "致住戶", "說明信", "開發", "letter", "dev"],
  willingness_form_template: ["意願書", "意願", "參與意願", "意願調查", "willingness", "willing"],
  consent_form_template: ["同意書", "都更同意", "更新同意", "consent"],
  consent_form: ["同意書", "都更同意", "更新同意", "consent"],
  contract_template: ["合約", "契約", "協議書", "合約範本", "contract", "agreement"],
  contract: ["合約", "契約", "協議書", "contract", "agreement"],
  property_register: ["土地登記", "土地謄本", "第一類謄本", "第二類謄本", "第三類謄本", "地號", "land", "deed"],
  building_register: ["建物登記", "建物謄本", "建號謄本", "建號", "building"],
  cadastral_map: ["地籍圖", "地籍", "圖資", "cadastral", "map"],
  consultant_document: ["顧問文件", "顧問", "評估", "報告", "規劃", "建築師", "估價", "consultant", "report"],
  briefing_material: ["說明會", "簡報", "簡報資料", "會議記錄", "briefing", "presentation"],
};

function verifyDocumentFileType(file, docType) {
  if (!file || !docType) return { matched: true };

  const fileName = (file.name || "").toLowerCase();
  const normalizedFileName = fileName.replace(/\s+/g, "");
  const expectedKeywords = DOC_TYPE_KEYWORDS[docType];
  const targetLabel = DOC_TYPE_LABEL[docType] || docType;

  if (!expectedKeywords || expectedKeywords.length === 0) {
    return { matched: true, targetLabel };
  }

  // Direct keyword match
  const hasDirectMatch = expectedKeywords.some((kw) => {
    const kwLower = kw.toLowerCase();
    return fileName.includes(kwLower) || normalizedFileName.includes(kwLower.replace(/\s+/g, ""));
  });
  if (hasDirectMatch) {
    return { matched: true, targetLabel };
  }

  // Check if filename strongly matches a DIFFERENT document type
  let detectedOtherLabel = null;
  for (const [typeKey, keywords] of Object.entries(DOC_TYPE_KEYWORDS)) {
    if (typeKey === docType) continue;
    const matchedOtherKw = keywords.find((kw) => {
      const kwLower = kw.toLowerCase();
      return fileName.includes(kwLower) || normalizedFileName.includes(kwLower.replace(/\s+/g, ""));
    });
    if (matchedOtherKw) {
      detectedOtherLabel = DOC_TYPE_LABEL[typeKey] || typeKey;
      break;
    }
  }

  if (detectedOtherLabel) {
    return {
      matched: false,
      targetLabel,
      detectedOtherLabel,
      fileName: file.name,
    };
  }

  return { matched: true, targetLabel };
}

async function inspectAndConfirmDocumentUpload(file, docType) {
  if (!file || !docType || docType === "other" || docType === "photo") return true;

  const pid = state.currentProjectId;
  const clientCheck = verifyDocumentFileType(file, docType);

  let inspectResult = null;
  if (pid) {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("doc_type", docType);
    try {
      inspectResult = await api(`/projects/${pid}/documents/inspect`, {
        method: "POST",
        body: fd,
        isForm: true,
        silent: true,
      });
    } catch (err) {
      inspectResult = null;
    }
  }

  const isMismatch = (inspectResult && !inspectResult.matched) || (!inspectResult && !clientCheck.matched);
  if (!isMismatch) return true;

  const targetLabel = (inspectResult && inspectResult.target_label) || clientCheck.targetLabel || docType;
  const detectedOtherLabel = (inspectResult && inspectResult.detected_other_label) || clientCheck.detectedOtherLabel;
  const detectedTitle = inspectResult && inspectResult.detected_title ? inspectResult.detected_title.trim() : "";

  return new Promise((resolve) => {
    const modalHtml = `
      <div style="text-align:center;padding:8px 0">
        <div style="font-size:42px;margin-bottom:10px">⚠️</div>
        <h3 style="margin-bottom:12px;color:var(--text-primary)">檔案內容 / 類型可能不符</h3>
        <p style="color:var(--text-secondary);font-size:14px;line-height:1.6;margin-bottom:12px">
          上傳目標位置：<strong style="color:var(--primary-color)">【${escapeHtml(targetLabel)}】</strong><br>
          選擇的檔案名稱：<code style="background:var(--bg-tertiary);padding:4px 8px;border-radius:4px;color:var(--text-primary);display:inline-block;margin-top:4px;word-break:break-all">${escapeHtml(file.name)}</code>
        </p>
        ${
          detectedTitle
            ? `<div style="background:var(--bg-secondary);border:1px solid var(--border-color);padding:10px 14px;border-radius:6px;text-align:left;font-size:13px;margin-bottom:14px">
                <span style="color:var(--text-tertiary);display:block;font-size:12px;margin-bottom:4px">📄 檔案內文檢測到的標題 / 開頭文字：</span>
                <strong style="color:var(--text-primary);font-size:14px">「${escapeHtml(detectedTitle)}」</strong>
               </div>`
            : ""
        }
        ${
          detectedOtherLabel
            ? `<div style="background:rgba(239, 68, 68, 0.1);color:#ef4444;border:1px solid rgba(239, 68, 68, 0.2);font-size:13px;padding:8px 12px;border-radius:6px;display:inline-block;margin-bottom:16px">
                ⚡ 系統分析內容檔名較符合：「<strong>${escapeHtml(detectedOtherLabel)}</strong>」
               </div>`
            : ""
        }
        <p style="color:var(--text-tertiary);font-size:13px;margin-bottom:24px">
          請問您是否選擇了錯誤的檔案？
        </p>
        <div style="display:flex;gap:12px;justify-content:center">
          <button type="button" class="btn-secondary" id="confirm-upload-cancel-btn" style="flex:1">重新選擇檔案</button>
          <button type="button" class="btn-primary" id="confirm-upload-proceed-btn" style="flex:1">確認仍要上傳</button>
        </div>
      </div>`;

    const root = openModal("文件比對提醒", modalHtml, { width: "450px" });

    root.querySelector("#confirm-upload-cancel-btn").onclick = () => {
      closeModal();
      resolve(false);
    };
    root.querySelector("#confirm-upload-proceed-btn").onclick = () => {
      closeModal();
      resolve(true);
    };
  });
}
const CONTACT_METHOD_LABEL = { phone: "電話", visit: "訪視", mail: "郵寄", email: "電子郵件", briefing: "說明會", other: "其他" };
const CONTACT_RESULT_LABEL = { no_answer: "未接聽", agreed: "同意", opposed: "反對", undecided: "未決定", callback_needed: "需回電" };

const ROLE_LABEL = {
  sys_admin: "L1 系統管理員",
  manager: "L2 都更主管",
  case_owner: "L3 案件負責人",
  case_staff: "L4 案件工作人員",
  ocr_staff: "L5 資料/OCR人員",
  viewer: "L6 查詢/檢視人員",
};

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

/* ================= Theme ================= */

const SUN_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>`;
const MOON_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;

function getEffectiveTheme() {
  const stored = localStorage.getItem("theme");
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function renderThemeToggle() {
  const btn = document.getElementById("theme-toggle-btn");
  if (!btn) return;
  // Icon shown = the mode a click will switch TO.
  btn.innerHTML = getEffectiveTheme() === "dark" ? SUN_ICON : MOON_ICON;
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("theme", theme);
  renderThemeToggle();
}

document.getElementById("theme-toggle-btn").addEventListener("click", () => {
  applyTheme(getEffectiveTheme() === "dark" ? "light" : "dark");
});

renderThemeToggle();

/* ================= Auth ================= */

async function doLogin(username, password) {
  const data = await api("/auth/login", { method: "POST", body: { username, password } });
  state.token = data.access_token;
  sessionStorage.setItem("token", state.token);
  await loadCurrentUser();
}

async function loadCurrentUser() {
  const user = await api("/auth/me");
  state.user = user;
  renderNavUser();
  showApp();
  goToDashboard();
}

let loggingOut = false;

async function doLogout() {
  // Reentrancy guard: if the token is already invalid, the /auth/logout call below
  // also gets a 401, whose handler calls doLogout() again - without this guard that
  // recurses (throttled only by network round-trips) instead of terminating.
  if (loggingOut) return;
  loggingOut = true;
  try {
    if (state.token) {
      await api("/auth/logout", { method: "POST", silent: true });
    }
  } catch (err) {
    /* still log out client-side even if the server call fails */
  }
  state.token = null;
  state.user = null;
  state.currentProjectId = null;
  state.projectCache = {};
  sessionStorage.removeItem("token");
  document.getElementById("app").classList.add("hidden");
  document.getElementById("view-login").classList.remove("hidden");
  loggingOut = false;
}

function showApp() {
  document.getElementById("view-login").classList.add("hidden");
  document.getElementById("app").classList.remove("hidden");
  document.getElementById("nav-users-btn").classList.toggle("hidden", !isSystemAdmin());
  document.getElementById("nav-loginlogs-btn").classList.toggle("hidden", !isSystemAdmin());
  document.getElementById("new-project-btn").classList.toggle("hidden", !canCreateProject());
}

function renderNavUser() {
  document.getElementById("dropdown-user-name").textContent = state.user.display_name;
  document.getElementById("avatar-btn").textContent = (state.user.display_name || "?").trim().charAt(0).toUpperCase();
  const roleLabel = ROLE_LABEL[state.user.role] || state.user.role;
  const badge = document.getElementById("nav-user-role");
  badge.textContent = roleLabel;
  badge.className = "role-badge " + state.user.role;
}

function closeAvatarDropdown() {
  document.getElementById("avatar-dropdown").classList.add("hidden");
  document.getElementById("avatar-btn").setAttribute("aria-expanded", "false");
}

document.getElementById("avatar-btn").addEventListener("click", (e) => {
  e.stopPropagation();
  const dropdown = document.getElementById("avatar-dropdown");
  const isOpen = !dropdown.classList.contains("hidden");
  dropdown.classList.toggle("hidden", isOpen);
  document.getElementById("avatar-btn").setAttribute("aria-expanded", String(!isOpen));
});

document.getElementById("avatar-dropdown").addEventListener("click", (e) => e.stopPropagation());

document.addEventListener("click", closeAvatarDropdown);

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = document.getElementById("login-username").value.trim();
  const password = document.getElementById("login-password").value;
  const btn = e.target.querySelector("button");
  btn.disabled = true;
  try {
    await doLogin(username, password);
  } catch (err) {
    /* toast already shown by api() */
  } finally {
    btn.disabled = false;
  }
});

document.getElementById("logout-btn").addEventListener("click", () => {
  closeAvatarDropdown();
  doLogout();
});

/* ================= Nav ================= */

document.querySelectorAll(".nav-link").forEach((btn) => {
  btn.addEventListener("click", () => {
    closeAvatarDropdown();
    const target = btn.dataset.nav;
    if (target === "dashboard") goToDashboard();
    if (target === "users") goToUsers();
    if (target === "loginlogs") goToLoginLogs();
    if (target === "companydocs") goToCompanyDocs();
    if (target === "regulations") goToRegulations();
    if (target === "websites") goToWebsites();
    if (target === "faq") goToFaq();
  });
});

function setActiveNav(name) {
  document.querySelectorAll(".nav-link").forEach((b) => b.classList.toggle("active", b.dataset.nav === name));
  document.querySelectorAll(".sb-case-item").forEach((b) => b.classList.remove("active"));
}

const expandedSidebarCities = new Set();
let sidebarCitiesInitialized = false;

function renderSidebarProjects(projects) {
  const wrap = document.getElementById("sb-cases");
  if (!wrap) return;

  const byCity = {};
  (projects || []).forEach((p) => {
    const city = p.city || "未分類";
    (byCity[city] = byCity[city] || []).push(p);
  });

  if (!sidebarCitiesInitialized) {
    Object.keys(byCity).forEach((city) => expandedSidebarCities.add(city));
    sidebarCitiesInitialized = true;
  }

  wrap.innerHTML = Object.entries(byCity)
    .map(([city, cases]) => {
      const open = expandedSidebarCities.has(city);
      return `
        <div class="sb-cg">
          <div class="sb-cg-head" data-city="${escapeHtml(city)}">
            <span class="sb-cg-name">${escapeHtml(city)}</span>
            <span class="sb-cg-count">${cases.length}</span>
            <span class="sb-cg-arrow ${open ? "open" : ""}">▶</span>
          </div>
          <div class="sb-cg-items ${open ? "open" : ""}">
            ${cases
              .map(
                (p) =>
                  `<div class="sb-case-item" data-project-id="${p.id}">${escapeHtml(p.name)}</div>`
              )
              .join("")}
          </div>
        </div>`;
    })
    .join("");

  wrap.querySelectorAll(".sb-cg-head").forEach((el) => {
    el.addEventListener("click", () => {
      const city = el.dataset.city;
      if (expandedSidebarCities.has(city)) expandedSidebarCities.delete(city);
      else expandedSidebarCities.add(city);
      renderSidebarProjects(projects);
    });
  });
  wrap.querySelectorAll(".sb-case-item").forEach((el) => {
    el.addEventListener("click", () => openProject(Number(el.dataset.projectId)));
  });
}

function setActiveSidebarCase(projectId) {
  document.querySelectorAll(".nav-link").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll(".sb-case-item").forEach((b) =>
    b.classList.toggle("active", Number(b.dataset.projectId) === Number(projectId))
  );
}

function showView(id) {
  [
    "view-dashboard",
    "view-new-project",
    "view-project-detail",
    "view-ocr-batch",
    "view-users",
    "view-loginlogs",
    "view-companydocs",
    "view-regulations",
    "view-websites",
    "view-faq",
  ].forEach((v) => {
    document.getElementById(v).classList.toggle("hidden", v !== id);
  });
}

/* ================= Dashboard ================= */

let selectedProjectIds = new Set();
let dashboardProjectsById = {};

function donutSvg(pct, size = 62) {
  const r = size / 2 - 6;
  const c = size / 2;
  const circumference = 2 * Math.PI * r;
  const filled = (Math.max(0, Math.min(100, pct)) / 100) * circumference;
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="var(--surface-2)" stroke-width="6"/>
    <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="var(--brand)" stroke-width="6"
      stroke-dasharray="${filled} ${circumference - filled}" stroke-linecap="round"
      transform="rotate(-90 ${c} ${c})"/>
  </svg>`;
}

function alertTiers(alerts) {
  const tiers = { warn: 0, alert: 0, urgent: 0 };
  (alerts || []).forEach((a) => {
    const days = a.days_since_last_contact;
    if (days == null || days >= 30) tiers.urgent++;
    else if (days >= 14) tiers.alert++;
    else tiers.warn++;
  });
  return tiers;
}

async function goToDashboard() {
  setActiveNav("dashboard");
  showView("view-dashboard");
  await loadDashboard();
}

// Maps a project's latest_ocr_job_status/latest_ocr_job_has_warning (real fields from
// GET /projects/dashboard-summary) to a status badge. A project with no OCR job yet
// (latest_ocr_job_status === null) gets no badge - there's nothing to report on.
function ocrStatusBadge(item) {
  if (!item.latest_ocr_job_status) return "";
  if (item.latest_ocr_job_status === "processing") return `<span class="status-badge status-ocr-processing">OCR 中</span>`;
  if (item.latest_ocr_job_status === "failed") return `<span class="status-badge status-ocr-failed">辨識失敗</span>`;
  if (item.latest_ocr_job_status === "completed") {
    return item.latest_ocr_job_has_warning
      ? `<span class="status-badge status-ocr-review">AI 校正中</span>`
      : `<span class="status-badge status-ocr-complete">完成</span>`;
  }
  return "";
}

async function loadDashboard() {
  selectedProjectIds = new Set();
  dashboardProjectsById = {};
  updateBatchDeleteBar();

  const statRow = document.getElementById("dashboard-stat-row");
  const aiBadge = document.getElementById("ai-online-badge");
  const grid = document.getElementById("project-grid");
  statRow.innerHTML = `<div class="empty-state">載入中...</div>`;
  grid.innerHTML = `<div class="empty-state">載入中...</div>`;

  let summary;
  try {
    summary = await api("/projects/dashboard-summary");
  } catch (e) {
    statRow.innerHTML = "";
    grid.innerHTML = `<div class="empty-state">載入失敗</div>`;
    return;
  }

  aiBadge.textContent = summary.ai_online ? "AI Online" : "AI Offline";
  aiBadge.className = `status-badge ${summary.ai_online ? "status-active" : "status-closed"}`;

  statRow.innerHTML = `
    <div class="dashboard-stat-item accent-brand">
      <div class="dashboard-stat-icon">📁</div>
      <div><div class="dashboard-stat-num">${summary.project_count}</div><div class="dashboard-stat-lbl">案件</div></div>
    </div>
    <div class="dashboard-stat-item accent-success">
      <div class="dashboard-stat-icon">🌐</div>
      <div><div class="dashboard-stat-num">${summary.land_record_count}</div><div class="dashboard-stat-lbl">地號</div></div>
    </div>
    <div class="dashboard-stat-item accent-info">
      <div class="dashboard-stat-icon">🏢</div>
      <div><div class="dashboard-stat-num">${summary.building_record_count}</div><div class="dashboard-stat-lbl">建號</div></div>
    </div>
    <div class="dashboard-stat-item accent-danger">
      <div class="dashboard-stat-icon">⚠</div>
      <div><div class="dashboard-stat-num">${summary.pending_ai_review_count}</div><div class="dashboard-stat-lbl">待 AI 校正</div></div>
    </div>
  `;

  renderSidebarProjects(summary.projects);

  const addProjectTileHtml = canCreateProject()
    ? `<div class="card project-card project-card-add" id="add-project-tile">
        <span class="project-card-add-icon">+</span>
        <span>新增案件</span>
      </div>`
    : "";

  if (!summary.projects.length) {
    grid.innerHTML = addProjectTileHtml || `<div class="empty-state">目前沒有可查看的案件</div>`;
    document.getElementById("add-project-tile")?.addEventListener("click", goToNewProject);
    return;
  }

  summary.projects.forEach((p) => (dashboardProjectsById[p.id] = p));

  grid.innerHTML = addProjectTileHtml + summary.projects
    .map(
      (p) => `
        <div class="card project-card" data-project-id="${p.id}">
          <div class="project-card-top">
            ${
              isManager()
                ? `<input type="checkbox" class="project-select-checkbox" data-select-project="${p.id}" ${selectedProjectIds.has(p.id) ? "checked" : ""}>`
                : ""
            }
            <h3 style="flex:1">${escapeHtml(p.name)}</h3>
            ${ocrStatusBadge(p)}
          </div>
          <div class="project-code">${escapeHtml(p.project_code)}${p.city || p.district ? " · " + escapeHtml([p.city, p.district].filter(Boolean).join("")) : ""}</div>
          <div class="project-card-counts">
            <span>地號 ${p.land_record_count} 筆</span>
            <span>建號 ${p.building_record_count} 筆</span>
          </div>
          ${
            isManager()
              ? `<div style="text-align:right"><button type="button" class="btn-link" style="color:var(--danger)" data-delete-project="${p.id}">刪除案件</button></div>`
              : ""
          }
        </div>`
    )
    .join("");

  grid.querySelectorAll(".project-card[data-project-id]").forEach((card) => {
    card.addEventListener("click", () => openProject(Number(card.dataset.projectId)));
  });
  document.getElementById("add-project-tile")?.addEventListener("click", goToNewProject);

  grid.querySelectorAll("[data-delete-project]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const target = summary.projects.find((x) => x.id === Number(btn.dataset.deleteProject));
      if (target) openDeleteProjectModal(target);
    });
  });

  grid.querySelectorAll("[data-select-project]").forEach((checkbox) => {
    checkbox.addEventListener("click", (e) => e.stopPropagation());
    checkbox.addEventListener("change", () => {
      const id = Number(checkbox.dataset.selectProject);
      if (checkbox.checked) selectedProjectIds.add(id);
      else selectedProjectIds.delete(id);
      updateBatchDeleteBar();
    });
  });
}

function updateBatchDeleteBar() {
  const btn = document.getElementById("batch-delete-btn");
  const countEl = document.getElementById("batch-select-count");
  const selectAllWrap = document.getElementById("batch-select-all-wrap");
  const selectAllCheckbox = document.getElementById("batch-select-all");
  const total = Object.keys(dashboardProjectsById).length;
  const show = isManager() && selectedProjectIds.size > 0;

  btn.classList.toggle("hidden", !show);
  countEl.classList.toggle("hidden", !show);
  selectAllWrap.classList.toggle("hidden", !show);
  if (show) countEl.textContent = `已選取 ${selectedProjectIds.size} 個案件`;

  selectAllCheckbox.checked = total > 0 && selectedProjectIds.size === total;
  selectAllCheckbox.indeterminate = selectedProjectIds.size > 0 && selectedProjectIds.size < total;
}

function toggleSelectAllProjects(checked) {
  if (checked) Object.keys(dashboardProjectsById).forEach((id) => selectedProjectIds.add(Number(id)));
  else selectedProjectIds.clear();
  document.querySelectorAll("[data-select-project]").forEach((checkbox) => {
    checkbox.checked = selectedProjectIds.has(Number(checkbox.dataset.selectProject));
  });
  updateBatchDeleteBar();
}

document.getElementById("batch-select-all").addEventListener("change", (e) => toggleSelectAllProjects(e.target.checked));

function openBatchDeleteModal() {
  const ids = [...selectedProjectIds];
  const selectedProjects = ids.map((id) => dashboardProjectsById[id]).filter(Boolean);
  openModal(
    "批量刪除案件",
    `
    <p style="margin-top:0">此操作將永久刪除以下 ${selectedProjects.length} 個案件及其底下所有地主、土地/建物資料、聯絡紀錄、文件、費用與 SOP 進度,且<strong style="color:var(--danger)">無法復原</strong>:</p>
    <ul style="margin:0 0 14px;padding-left:20px">
      ${selectedProjects.map((p) => `<li>${escapeHtml(p.name)}(${escapeHtml(p.project_code)})</li>`).join("")}
    </ul>
    <p>請輸入管理者帳號密碼以確認刪除:</p>
    <form id="batch-delete-form">
      <div class="field"><label>管理者帳號</label><input name="admin_username" autocomplete="off" required></div>
      <div class="field"><label>管理者密碼</label><input name="admin_password" type="password" autocomplete="off" required></div>
      <div class="modal-footer">
        <button type="button" class="btn-secondary" onclick="closeModal()">取消</button>
        <button type="submit" class="btn-danger">永久刪除 ${selectedProjects.length} 個案件</button>
      </div>
    </form>`
  );
  document.getElementById("batch-delete-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const submitBtn = e.target.querySelector("button[type=submit]");
    submitBtn.disabled = true;
    try {
      const result = await api("/projects/batch-delete", {
        method: "POST",
        body: {
          project_ids: ids,
          admin_username: fd.get("admin_username"),
          admin_password: fd.get("admin_password"),
        },
      });
      closeModal();
      toast(
        result.not_found_ids.length
          ? `已刪除 ${result.deleted_ids.length} 個案件,${result.not_found_ids.length} 個案件已不存在`
          : `已刪除 ${result.deleted_ids.length} 個案件`,
        "success"
      );
      await loadDashboard();
    } catch (err) {
      submitBtn.disabled = false;
    }
  });
}

document.getElementById("batch-delete-btn").addEventListener("click", openBatchDeleteModal);

function openDeleteProjectModal(project) {
  openModal(
    "刪除案件",
    `
    <p style="margin-top:0">此操作將永久刪除案件「${escapeHtml(project.name)}」及其底下所有地主、土地/建物資料、聯絡紀錄、文件、費用與 SOP 進度,且<strong style="color:var(--danger)">無法復原</strong>。</p>
    <p>請輸入案件代碼 <code style="background:var(--bg);padding:2px 6px;border-radius:4px">${escapeHtml(project.project_code)}</code> 以確認刪除:</p>
    <form id="delete-project-form">
      <div class="field"><input name="confirm_code" autocomplete="off" required></div>
      <div class="modal-footer">
        <button type="button" class="btn-secondary" onclick="closeModal()">取消</button>
        <button type="submit" class="btn-danger">永久刪除</button>
      </div>
    </form>`
  );
  document.getElementById("delete-project-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    if (fd.get("confirm_code") !== project.project_code) {
      toast("輸入的案件代碼不符,請重新確認", "error");
      return;
    }
    try {
      await api(`/projects/${project.id}`, { method: "DELETE" });
      closeModal();
      toast("案件已刪除", "success");
      loadDashboard();
    } catch (err) {}
  });
}

async function suggestNextProjectCode() {
  const year = new Date().getFullYear();
  let maxSeq = 0;
  try {
    const projects = await api("/projects", { silent: true });
    const prefix = `${year}-`;
    projects.forEach((p) => {
      if (p.project_code && p.project_code.startsWith(prefix)) {
        const seq = Number(p.project_code.slice(prefix.length));
        if (Number.isFinite(seq) && seq > maxSeq) maxSeq = seq;
      }
    });
  } catch (e) {}
  return `${year}-${String(maxSeq + 1).padStart(3, "0")}`;
}

document.getElementById("new-project-btn").addEventListener("click", goToNewProject);

async function goToNewProject() {
  setActiveNav("");
  document.querySelectorAll(".sb-case-item").forEach((b) => b.classList.remove("active"));
  showView("view-new-project");

  const citySelect = document.getElementById("np-city");
  citySelect.innerHTML =
    `<option value="">請選擇</option>` + TAIWAN_CITIES.map((c) => `<option value="${c}">${c}</option>`).join("");

  const form = document.getElementById("project-form");
  form.reset();
  document.getElementById("np-code").value = await suggestNextProjectCode();
}

document.getElementById("cancel-new-project-btn").addEventListener("click", goToDashboard);
document.getElementById("back-to-dashboard-from-new-project").addEventListener("click", goToDashboard);

document.getElementById("project-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const payload = Object.fromEntries(fd.entries());
  try {
    const project = await api("/projects", { method: "POST", body: payload });
    toast("案件已建立", "success");
    await loadDashboard();
    await openProject(project.id);
  } catch (err) {}
});

/* ================= Batch import: split a mixed batch into 都更案件 first ================= */

let caseSplitWizard = null;

function renderCaseSplitStep0() {
  openModal(
    "批次匯入(自動分案件)",
    `
    <div class="helper-text" style="margin-bottom:10px">
      上傳全部地號的謄本檔案。系統會依每頁標題偵測到的地號,自動
      分成每一個案件,審核調整後再分別建立/歸入案件;實際的所有權人明細,建案後還是要各自進到案件裡用
      「掃描謄本匯入」處理。
    </div>
    <div class="field">
      <label>選擇謄本圖片或 PDF</label>
      <input type="file" id="case-split-file-input" accept="image/*,application/pdf" multiple>
    </div>
    <div id="case-split-file-list" style="margin-top:10px"></div>
    <div id="case-split-progress-wrap" style="display:none;margin-top:14px">
      <div class="progress-bar-track"><div class="progress-bar-fill" id="case-split-progress-fill" style="width:0%"></div></div>
      <div class="helper-text" id="case-split-progress-label" style="margin-top:4px;text-align:center"></div>
    </div>
    <div class="modal-footer">
      <button type="button" class="btn-secondary" onclick="closeModal()">取消</button>
      <button type="button" class="btn-primary" id="case-split-detect-btn">偵測案件分組</button>
    </div>`,
    { width: "600px" }
  );

  renderCaseSplitFileList();

  document.getElementById("case-split-file-input").addEventListener("change", (e) => {
    caseSplitWizard.files.push(...Array.from(e.target.files));
    e.target.value = "";
    renderCaseSplitFileList();
  });
  document.getElementById("case-split-detect-btn").addEventListener("click", runDetectCases);
}

function renderCaseSplitFileList() {
  const wrap = document.getElementById("case-split-file-list");
  if (!caseSplitWizard.files.length) {
    wrap.innerHTML = `<div class="helper-text">尚未選擇檔案</div>`;
    return;
  }
  wrap.innerHTML = caseSplitWizard.files
    .map(
      (f, i) => `
      <div class="record-row" style="display:flex;align-items:center;gap:8px;padding:8px 10px;margin-bottom:6px">
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${i + 1}. ${escapeHtml(f.name)}</span>
        <button type="button" class="btn-danger btn-sm" data-remove-file="${i}">移除</button>
      </div>`
    )
    .join("");
  wrap.querySelectorAll("[data-remove-file]").forEach((btn) => {
    btn.addEventListener("click", () => {
      caseSplitWizard.files.splice(Number(btn.dataset.removeFile), 1);
      renderCaseSplitFileList();
    });
  });
}

// The backend detect steps are a single blocking request, not a pollable background
// job, so there's no real "% of pages done" to report. This fakes a progress bar that
// eases toward (but never quite reaches) 92% on an exponential curve while waiting,
// then snaps to 100% the moment the request actually resolves - same idea as the
// progress bars YouTube/most upload UIs show for a step whose real completion time
// isn't known in advance, so it never looks "stuck" at a fixed number.
function startFakeProgress(wrapId, fillId, labelId, tauSeconds = 20, labelPrefix = "偵測中") {
  const wrap = document.getElementById(wrapId);
  const fill = document.getElementById(fillId);
  const label = document.getElementById(labelId);
  const startedAt = Date.now();
  wrap.style.display = "";
  const timer = setInterval(() => {
    const elapsed = (Date.now() - startedAt) / 1000;
    const pct = 92 * (1 - Math.exp(-elapsed / tauSeconds));
    fill.style.width = `${pct}%`;
    label.textContent = `${labelPrefix}...已等待 ${Math.floor(elapsed)} 秒,頁數多可能需要數分鐘`;
  }, 250);
  return {
    finish() {
      clearInterval(timer);
      fill.style.width = "100%";
      label.textContent = "完成";
      setTimeout(() => {
        wrap.style.display = "none";
      }, 400);
    },
    stop() {
      clearInterval(timer);
      wrap.style.display = "none";
    },
  };
}

async function runDetectCases() {
  if (!caseSplitWizard.files.length) {
    toast("請先選擇至少一個檔案", "error");
    return;
  }
  const btn = document.getElementById("case-split-detect-btn");
  btn.disabled = true;
  btn.textContent = "偵測中...";
  const progress = startFakeProgress("case-split-progress-wrap", "case-split-progress-fill", "case-split-progress-label");
  try {
    const fd = new FormData();
    caseSplitWizard.files.forEach((f) => fd.append("files", f));
    const result = await api("/ocr/detect-cases", { method: "POST", body: fd, isForm: true });
    if (result.warning) toast(result.warning, "error");
    caseSplitWizard.pages = result.pages.map((p) => ({ ...p, group: p.suggested_case_group || 1 }));

    caseSplitWizard.groupMeta = {};
    const detectedGroupNumbers = [...new Set(caseSplitWizard.pages.map((p) => p.group))];
    detectedGroupNumbers.forEach((g) => {
      // Vote across every page in the group instead of trusting whichever page happens
      // to appear first - a single misread digit on the first page (e.g. AI reading
      // "0229-0002" as "0236-0000") would otherwise silently become the suggested code
      // even though the rest of the group's pages agree on the correct value.
      const votes = new Map();
      caseSplitWizard.pages
        .filter((p) => p.group === g)
        .forEach((p) => {
          if (!p.case_label || !p.sample_number) return;
          const key = `${p.case_label} ${p.sample_number}`;
          votes.set(key, (votes.get(key) || 0) + 1);
        });
      let bestKey = "";
      let bestCount = 0;
      votes.forEach((count, key) => {
        if (count > bestCount) {
          bestCount = count;
          bestKey = key;
        }
      });
      const [label, sampleNumber] = bestKey ? bestKey.split(" ") : ["", ""];
      caseSplitWizard.groupMeta[g] = {
        name: label || `未命名案件${g}`,
        code: sampleNumber || "",
        mode: "new",
        existingProjectId: "",
      };
    });

    progress.finish();
    await renderCaseSplitReview();
  } catch (err) {
    progress.stop();
    btn.disabled = false;
    btn.textContent = "偵測案件分組";
  }
}

async function renderCaseSplitReview() {
  let existingProjects = [];
  try {
    existingProjects = await api("/projects", { silent: true });
  } catch (e) {}

  const groupNumbers = [...new Set(caseSplitWizard.pages.map((p) => p.group))].sort((a, b) => a - b);

  // Auto-match a group's suggested code against an existing project's project_code,
  // same as the building batch import already does - without this, a group whose
  // detected 地號 happens to already have a project (re-importing the same 地號, or
  // this batch containing a case that was created some other way) stays defaulted to
  // "建立新案件" and 409s on confirm instead of quietly offering to file into it. Only
  // touches groups still on their untouched "new" default so it doesn't override a
  // choice the user already made.
  groupNumbers.forEach((g) => {
    const meta = caseSplitWizard.groupMeta[g];
    if (!meta || meta.mode !== "new" || meta.existingProjectId) return;
    const code = (meta.code || "").trim();
    if (!code) return;
    const matched = existingProjects.find((p) => p.project_code === code);
    if (matched) {
      meta.mode = "existing";
      meta.existingProjectId = matched.id;
    }
  });

  openModal(
    "批次匯入(自動分案件)· 審核分組",
    `
    <div class="final-banner warning" style="margin-bottom:14px">⚠ AI 判斷不一定準確,請逐頁核對「案件分組編號」,有錯直接改編號</div>
    <div id="case-split-page-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:10px;max-height:280px;overflow-y:auto;padding:4px;margin-bottom:16px"></div>
    <div id="case-split-group-meta"></div>
    <div class="modal-footer">
      <button type="button" class="btn-secondary" onclick="renderCaseSplitStep0()">上一步</button>
      <button type="button" class="btn-primary" id="case-split-confirm-btn">確認建立</button>
    </div>`,
    { width: "760px" }
  );

  const grid = document.getElementById("case-split-page-grid");
  grid.innerHTML = caseSplitWizard.pages
    .map(
      (p, i) => `
      <div class="record-row" style="padding:6px;text-align:center">
        <img src="data:${p.mime_type};base64,${p.image_base64}" data-page-index="${i}" style="width:100%;height:110px;object-fit:cover;border-radius:4px;border:1px solid var(--border)">
        <div class="helper-text" style="margin:4px 0 2px">第 ${p.page_number} 頁</div>
        <input type="number" min="1" value="${p.group}" data-case-page-group="${i}" style="width:100%;text-align:center" autocomplete="off">
      </div>`
    )
    .join("");
  wireThumbnailLightbox(grid, caseSplitWizard.pages);
  grid.querySelectorAll("[data-case-page-group]").forEach((input) => {
    input.addEventListener("change", () => {
      const i = Number(input.dataset.casePageGroup);
      caseSplitWizard.pages[i].group = Math.max(1, Number(input.value) || 1);
      input.value = caseSplitWizard.pages[i].group;
    });
  });

  const metaWrap = document.getElementById("case-split-group-meta");
  metaWrap.innerHTML = groupNumbers
    .map((g) => {
      const meta = caseSplitWizard.groupMeta[g] || { name: `未命名案件${g}`, code: "", mode: "new", existingProjectId: "" };
      const pageCount = caseSplitWizard.pages.filter((p) => p.group === g).length;
      return `
      <div class="record-row" style="padding:12px;margin-bottom:10px">
        <div class="helper-text" style="font-weight:600;margin-bottom:8px">第 ${g} 組(${pageCount} 頁)</div>
        <div class="field-row">
          <div class="field"><label>案件名稱</label><input data-group-name="${g}" value="${escapeHtml(meta.name)}" autocomplete="off"></div>
          <div class="field">
            <label>案件代碼(新案件用,依偵測到的地號建議,留空則自動編號)</label>
            <input data-group-code="${g}" value="${escapeHtml(meta.code)}" placeholder="自動編號" autocomplete="off">
          </div>
        </div>
        <div class="field-row">
          <div class="field">
            <label>建立方式</label>
            <select data-group-mode="${g}">
              <option value="new" ${meta.mode === "new" ? "selected" : ""}>建立新案件</option>
              <option value="existing" ${meta.mode === "existing" ? "selected" : ""}>加入既有案件</option>
            </select>
          </div>
        </div>
        <div class="field" data-existing-wrap="${g}" style="${meta.mode === "existing" ? "" : "display:none"}">
          <label>選擇既有案件</label>
          <select data-group-existing="${g}">
            <option value="">請選擇</option>
            ${existingProjects
              .map((p) => `<option value="${p.id}" ${String(meta.existingProjectId) === String(p.id) ? "selected" : ""}>${escapeHtml(p.name)}(${escapeHtml(p.project_code)})</option>`)
              .join("")}
          </select>
        </div>
      </div>`;
    })
    .join("");

  groupNumbers.forEach((g) => {
    const nameInput = metaWrap.querySelector(`[data-group-name="${g}"]`);
    const codeInput = metaWrap.querySelector(`[data-group-code="${g}"]`);
    const modeSelect = metaWrap.querySelector(`[data-group-mode="${g}"]`);
    const existingWrap = metaWrap.querySelector(`[data-existing-wrap="${g}"]`);
    const existingSelect = metaWrap.querySelector(`[data-group-existing="${g}"]`);
    nameInput.addEventListener("input", () => {
      caseSplitWizard.groupMeta[g] = caseSplitWizard.groupMeta[g] || {};
      caseSplitWizard.groupMeta[g].name = nameInput.value;
    });
    codeInput.addEventListener("input", () => {
      caseSplitWizard.groupMeta[g] = caseSplitWizard.groupMeta[g] || {};
      caseSplitWizard.groupMeta[g].code = codeInput.value;
    });
    modeSelect.addEventListener("change", () => {
      caseSplitWizard.groupMeta[g] = caseSplitWizard.groupMeta[g] || {};
      caseSplitWizard.groupMeta[g].mode = modeSelect.value;
      existingWrap.style.display = modeSelect.value === "existing" ? "" : "none";
    });
    existingSelect.addEventListener("change", () => {
      caseSplitWizard.groupMeta[g] = caseSplitWizard.groupMeta[g] || {};
      caseSplitWizard.groupMeta[g].existingProjectId = existingSelect.value;
    });
  });

  document.getElementById("case-split-confirm-btn").addEventListener("click", runConfirmCaseSplit);
}

async function runConfirmCaseSplit() {
  const btn = document.getElementById("case-split-confirm-btn");
  btn.disabled = true;
  btn.textContent = "建立中...";

  const groupNumbers = [...new Set(caseSplitWizard.pages.map((p) => p.group))].sort((a, b) => a - b);

  try {
    for (const g of groupNumbers) {
      const meta = caseSplitWizard.groupMeta[g] || { name: `未命名案件${g}`, code: "", mode: "new", existingProjectId: "" };
      const groupPages = caseSplitWizard.pages.filter((p) => p.group === g);
      let project;
      // A previous click of this button may have already created/found this group's
      // project before failing partway through a later group - createdProjectId marks
      // that so a retry resumes instead of trying to create the same 案件 code again
      // (which 409s with "project_code already exists" since it's already there).
      if (meta.createdProjectId) {
        project = await api(`/projects/${meta.createdProjectId}`);
      } else if (meta.mode === "existing" && meta.existingProjectId) {
        project = await api(`/projects/${meta.existingProjectId}`);
        meta.createdProjectId = project.id;
      } else {
        const code = (meta.code || "").trim() || (await suggestNextProjectCode());
        try {
          project = await api("/projects", {
            method: "POST",
            body: { project_code: code, name: meta.name || code, district: "", address: "" },
          });
        } catch (err) {
          toast(`第 ${g} 組(代碼 ${code})建立失敗,前面已成功的組別不會重複建立,修正後可直接再按一次「確認建立」繼續`, "error");
          throw err;
        }
        meta.createdProjectId = project.id;
      }
      // Save this group's source pages as a merged PDF document on the project right
      // away - otherwise they only exist in this browser tab's memory and are lost once
      // this modal closes.
      try {
        const fd = new FormData();
        groupPages.forEach((p, i) => fd.append("files", base64ToBlob(p.image_base64, p.mime_type), `page-${i + 1}.jpg`));
        fd.append("file_name", `${project.project_code || meta.name || project.name}.pdf`);
        fd.append("description", "批次匯入原始掃描檔");
        await api(`/projects/${project.id}/documents/from-images`, { method: "POST", body: fd, isForm: true });
      } catch (err) {}
    }

    closeModal();
    toast("案件已建立/歸入完成", "success");
    await loadDashboard();
  } catch (err) {
    btn.disabled = false;
    btn.textContent = "確認建立";
  }
}

/* ================= Batch import: building deeds, auto-matched to existing 地號 cases ================= */

let buildingBatchWizard = null;

function renderBuildingBatchStep0() {
  openModal(
    "批次匯入建物謄本(自動比對案件)",
    `
    <div class="helper-text" style="margin-bottom:10px">
      上傳一整份建物謄本(可涵蓋多筆建號)。系統會依每頁「頁次」自動拆成一筆一筆建號,讀出每筆的「建物坐落地號」,
      拿去比對現有案件的案件代碼——比對到的會自動預選對應案件,比對不到的請在下一步手動選擇。這一步只用本地 OCR
      判斷,不會呼叫 AI,速度快也不花費 API 額度。確認歸檔只會把每組原始掃描頁存成 PDF 放進對應案件的「文件」分頁;
      所有權人/建物等詳細資料要另外再進到各案件用「掃描謄本匯入」精靈辨識確認。
    </div>
    <div class="field">
      <label>選擇建物謄本圖片或 PDF</label>
      <input type="file" id="building-batch-file-input" accept="image/*,application/pdf" multiple>
    </div>
    <div id="building-batch-file-list" style="margin-top:10px"></div>
    <div id="building-batch-progress-wrap" style="display:none;margin-top:14px">
      <div class="progress-bar-track"><div class="progress-bar-fill" id="building-batch-progress-fill" style="width:0%"></div></div>
      <div class="helper-text" id="building-batch-progress-label" style="margin-top:4px;text-align:center"></div>
    </div>
    <div class="modal-footer">
      <button type="button" class="btn-secondary" onclick="closeModal()">取消</button>
      <button type="button" class="btn-primary" id="building-batch-detect-btn">偵測建號並比對案件</button>
    </div>`,
    { width: "600px" }
  );

  renderBuildingBatchFileList();

  document.getElementById("building-batch-file-input").addEventListener("change", (e) => {
    buildingBatchWizard.files.push(...Array.from(e.target.files));
    e.target.value = "";
    renderBuildingBatchFileList();
  });
  document.getElementById("building-batch-detect-btn").addEventListener("click", runDetectBuildingCases);
}

function renderBuildingBatchFileList() {
  const wrap = document.getElementById("building-batch-file-list");
  if (!buildingBatchWizard.files.length) {
    wrap.innerHTML = `<div class="helper-text">尚未選擇檔案</div>`;
    return;
  }
  wrap.innerHTML = buildingBatchWizard.files
    .map(
      (f, i) => `
      <div class="record-row" style="display:flex;align-items:center;gap:8px;padding:8px 10px;margin-bottom:6px">
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${i + 1}. ${escapeHtml(f.name)}</span>
        <button type="button" class="btn-danger btn-sm" data-remove-file="${i}">移除</button>
      </div>`
    )
    .join("");
  wrap.querySelectorAll("[data-remove-file]").forEach((btn) => {
    btn.addEventListener("click", () => {
      buildingBatchWizard.files.splice(Number(btn.dataset.removeFile), 1);
      renderBuildingBatchFileList();
    });
  });
}

async function runDetectBuildingCases() {
  if (!buildingBatchWizard.files.length) {
    toast("請先選擇至少一個檔案", "error");
    return;
  }
  const btn = document.getElementById("building-batch-detect-btn");
  btn.disabled = true;
  btn.textContent = "偵測比對中...";
  const progress = startFakeProgress("building-batch-progress-wrap", "building-batch-progress-fill", "building-batch-progress-label");
  try {
    const fd = new FormData();
    buildingBatchWizard.files.forEach((f) => fd.append("files", f));
    const result = await api("/ocr/detect-building-cases", { method: "POST", body: fd, isForm: true });
    if (result.warning) toast(result.warning, "error");
    buildingBatchWizard.groups = result.groups.map((g) => ({ ...g, selectedProjectId: g.matched_project_id || "" }));
    progress.finish();
    await renderBuildingBatchReview();
  } catch (err) {
    progress.stop();
    btn.disabled = false;
    btn.textContent = "偵測建號並比對案件";
  }
}

async function renderBuildingBatchReview() {
  let existingProjects = [];
  try {
    existingProjects = await api("/projects", { silent: true });
  } catch (e) {}

  openModal(
    "批次匯入建物謄本 · 審核比對結果",
    `
    <div class="final-banner warning" style="margin-bottom:14px">⚠ 比對結果不一定準確,請逐筆核對「歸入案件」,沒有比對到(標示待確認)的一定要手動選擇</div>
    <div id="building-batch-group-list"></div>
    <div class="modal-footer">
      <button type="button" class="btn-secondary" onclick="renderBuildingBatchStep0()">上一步</button>
      <button type="button" class="btn-primary" id="building-batch-confirm-btn">確認歸檔</button>
    </div>`,
    { width: "760px" }
  );

  const wrap = document.getElementById("building-batch-group-list");
  wrap.innerHTML = buildingBatchWizard.groups
    .map((g, i) => {
      const b = g.building || {};
      const matched = !!g.matched_project_id;
      return `
      <div class="record-row" style="padding:12px;margin-bottom:10px">
        <div style="display:flex;gap:12px;align-items:flex-start">
          <img src="data:${g.pages[0].mime_type};base64,${g.pages[0].image_base64}" data-page-index="${i}"
               style="width:90px;height:90px;object-fit:cover;border-radius:4px;border:1px solid var(--border);flex-shrink:0">
          <div style="flex:1">
            <div style="font-weight:700">建號 ${escapeHtml(b.building_number || "-")}(${g.pages.length} 頁)</div>
            <div class="helper-text" style="margin-top:2px">建物坐落地號:${escapeHtml(b.parcel_number || "(未讀到)")} · 所有權人等詳細資料請至各案件用「掃描謄本匯入」另外辨識</div>
            <div class="helper-text" style="margin-top:4px">${matched ? `✅ 已比對到案件:${escapeHtml(g.matched_project_name)}(${escapeHtml(g.matched_project_code)})` : "⚠ 未比對到現有案件,請手動選擇"}</div>
          </div>
          <button type="button" class="btn-danger btn-sm" data-remove-group="${i}" style="flex-shrink:0">移除</button>
        </div>
        <div class="field" style="margin-top:8px">
          <label>歸入案件</label>
          <select data-group-project="${i}">
            <option value="">請選擇</option>
            ${existingProjects
              .map(
                (p) =>
                  `<option value="${p.id}" ${String(g.selectedProjectId) === String(p.id) ? "selected" : ""}>${escapeHtml(p.name)}(${escapeHtml(p.project_code)})</option>`
              )
              .join("")}
          </select>
        </div>
      </div>`;
    })
    .join("");

  wireThumbnailLightbox(
    wrap,
    buildingBatchWizard.groups.map((g) => g.pages[0])
  );
  wrap.querySelectorAll("[data-group-project]").forEach((select) => {
    select.addEventListener("change", () => {
      buildingBatchWizard.groups[Number(select.dataset.groupProject)].selectedProjectId = select.value;
    });
  });
  wrap.querySelectorAll("[data-remove-group]").forEach((btn) => {
    btn.addEventListener("click", () => {
      buildingBatchWizard.groups.splice(Number(btn.dataset.removeGroup), 1);
      renderBuildingBatchReview();
    });
  });

  document.getElementById("building-batch-confirm-btn").addEventListener("click", runConfirmBuildingBatchImport);
}

async function runConfirmBuildingBatchImport() {
  const groups = buildingBatchWizard.groups;
  if (!groups.length) {
    toast("沒有可匯入的建號,請先上一步重新選擇檔案", "error");
    return;
  }
  if (groups.some((g) => !g.selectedProjectId)) {
    toast("有建號還沒選擇要歸入哪個案件,請確認每一筆都已選擇", "error");
    return;
  }

  const btn = document.getElementById("building-batch-confirm-btn");
  btn.disabled = true;

  // AI extraction (所有權人/面積/地址 etc.) and the landowner/building-record creation
  // that depends on it are deliberately skipped here for now - this step only archives
  // each group's original scan pages as a merged PDF into its matched case's 文件 分頁.
  // Confirming owner/building details is done later, per case, via that case's own
  // 「掃描謄本匯入」精靈.
  try {
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      const pid = Number(g.selectedProjectId);
      const b = g.building || {};
      btn.textContent = `存檔中(第 ${i + 1}/${groups.length} 筆)...`;

      try {
        const fd = new FormData();
        g.pages.forEach((p, j) => fd.append("files", base64ToBlob(p.image_base64, p.mime_type), `page-${j + 1}.jpg`));
        fd.append("file_name", `建號${b.building_number || g.group}.pdf`);
        fd.append("description", "批次匯入建物謄本原始掃描檔");
        await api(`/projects/${pid}/documents/from-images`, { method: "POST", body: fd, isForm: true });
      } catch (e) {
        toast(`建號${b.building_number || g.group}的原始掃描檔存檔失敗`, "error");
      }
    }

    closeModal();
    toast("建物謄本已存檔到對應案件", "success");
    buildingBatchWizard = null;
  } catch (err) {
    btn.disabled = false;
    btn.textContent = "確認歸檔";
  }
}

document.getElementById("back-to-dashboard").addEventListener("click", goToDashboard);

/* ================= Project detail ================= */

async function openProject(id) {
  state.currentProjectId = id;
  state.projectCache[id] = state.projectCache[id] || {};
  state.sopSelectedStage = null;
  setActiveSidebarCase(id);
  showView("view-project-detail");

  try {
    const project = await api(`/projects/${id}`);
    state.currentProject = project;
    renderProjectHeader(project);
  } catch (e) {
    goToDashboard();
    return;
  }

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === "sop");
  });
  document.getElementById("tab-btn-members").classList.toggle("hidden", !isManager());
  state.activeTab = "sop";
  await Promise.all([renderTab(state.activeTab), renderSopSummary()]);
}

function renderProjectHeader(p) {
  document.getElementById("pd-name").textContent = `${p.name} (${p.project_code})`;
  document.getElementById("pd-sub").textContent = [p.district, p.address].filter(Boolean).join(" · ") || "—";
  document.getElementById("pd-status-badge").innerHTML =
    `<span class="status-badge status-${p.status}">${PROJECT_STATUS_LABEL[p.status] || p.status}</span>` +
    (p.is_force_closed ? ` <span class="mini-badge alert">強制結案</span>` : "");
}

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", async () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b === btn));
    state.activeTab = btn.dataset.tab;
    await renderTab(btn.dataset.tab);
  });
});

async function renderTab(tab) {
  const el = document.getElementById("tab-content");
  el.innerHTML = `<div class="empty-state">載入中...</div>`;
  const renderers = {
    sop: renderSopTab,
    landowners: (el) => renderLandownersTypeTab(el, "land"),
    buildings: (el) => renderLandownersTypeTab(el, "building"),
    relations: renderRelationsTab,
    contacts: renderContactsTab,
    documents: renderDocumentsTab,
    encumbrances: renderEncumbrancesTab,
    expenses: renderExpensesTab,
    members: renderMembersTab,
  };
  try {
    await renderers[tab](el);
  } catch (e) {
    el.innerHTML = `<div class="empty-state">載入失敗</div>`;
  }
}

/* ================= Tabs: Land registry / Building registry ================= */

// The 地主清冊 UI used to be one combined tab (regardless of whether a landowner had
// land records, building records, or both) - now split into two: 「土地登記」 only lists
// owners with at least one land record, 「建物登記」 only lists owners with at least one
// building record. Same underlying landowner CRUD (name/phone/contact status are
// landowner-level, not land/building-specific) and detail expansion either way - just
// which owners show up in the top-level list, and which "+ 匯入/新增" shortcut is on
// the toolbar, differ by type.
async function renderLandownersTypeTab(el, type) {
  const pid = state.currentProjectId;
  const allLandowners = await api(`/projects/${pid}/landowners`);
  state.projectCache[pid].landowners = allLandowners;

  const isLand = type === "land";
  const landowners = allLandowners.filter((o) => (isLand ? o.land_records : o.building_records).length > 0);

  el.innerHTML = `
    <div class="section-toolbar">
      <h3>${isLand ? "土地登記清冊" : "建物登記清冊"} (${landowners.length})</h3>
      ${
        isEditor() || canOcr()
          ? `<div style="display:flex;gap:8px">
              ${isEditor() ? `<button class="btn-secondary btn-sm" id="merge-landowners-btn" disabled>合併選取的地主</button>` : ""}
              ${canOcr() ? `<button class="btn-secondary btn-sm" id="scan-title-deed-btn">${isLand ? "土地登記匯入" : "建物登記匯入"}</button>` : ""}
              ${isEditor() ? `<button class="btn-primary btn-sm" id="add-landowner-btn">+ 新增地主</button>` : ""}
            </div>`
          : ""
      }
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr>
          ${isEditor() ? "<th></th>" : ""}
          <th>姓名</th><th>身分證字號</th><th>電話</th><th>聯絡狀態</th><th>代表人</th><th>${isLand ? "土地" : "建物"}</th>
          ${isEditor() ? "<th>操作</th>" : ""}
        </tr></thead>
        <tbody>
          ${landowners
            .map(
              (o) => `
            <tr>
              ${isEditor() ? `<td><input type="checkbox" class="merge-select-cb" value="${o.id}"></td>` : ""}
              <td>${escapeHtml(o.name)}</td>
              <td>${escapeHtml(o.id_number) || "-"}</td>
              <td>${escapeHtml(o.phone) || "-"}</td>
              <td><span class="contact-status-badge cs-${o.contact_status}">${CONTACT_STATUS_LABEL[o.contact_status]}</span></td>
              <td>${o.is_representative ? "是" : "-"}</td>
              <td>${(isLand ? o.land_records : o.building_records).length} 筆
                <div><button class="btn-link btn-sm" data-detail="${o.id}">查看明細</button></div>
              </td>
              ${
                isEditor()
                  ? `<td class="actions-cell">
                      <button class="btn-secondary btn-sm" data-edit="${o.id}">編輯</button>
                      <button class="btn-danger btn-sm" data-delete="${o.id}">刪除</button>
                    </td>`
                  : ""
              }
            </tr>
            <tr class="detail-row hidden" id="detail-row-${o.id}"><td colspan="10">
              <div class="sub-detail">
                <div class="section-toolbar" style="margin-bottom:8px">
                  <strong>土地資料</strong>
                  ${isEditor() ? `<button class="btn-secondary btn-sm" data-add-land="${o.id}">+ 新增土地</button>` : ""}
                </div>
                ${
                  o.land_records.length
                    ? `<table>
                        <thead><tr><th>地號</th><th>地段</th><th>面積</th><th>持分</th><th>持有面積</th>${isEditor() ? "<th>操作</th>" : ""}</tr></thead>
                        <tbody>
                          ${o.land_records
                            .map(
                              (lr) => `<tr>
                                <td>${escapeHtml(lr.parcel_number)}</td>
                                <td>${escapeHtml(lr.section) || "-"}</td>
                                <td>${lr.total_area_sqm}m²</td>
                                <td>${lr.ownership_numerator}/${lr.ownership_denominator}</td>
                                <td>${lr.owned_area_sqm ?? "-"}m² (${lr.ownership_share_pct ?? "-"}%)</td>
                                ${
                                  isEditor()
                                    ? `<td class="actions-cell">
                                        <button class="btn-secondary btn-sm" data-edit-land="${lr.id}" data-owner="${o.id}">編輯</button>
                                        <button class="btn-danger btn-sm" data-delete-land="${lr.id}" data-owner="${o.id}">刪除</button>
                                      </td>`
                                    : ""
                                }
                              </tr>`
                            )
                            .join("")}
                        </tbody>
                      </table>`
                    : `<div class="helper-text">尚無土地資料</div>`
                }
                <div class="section-toolbar" style="margin:16px 0 8px">
                  <strong>建物資料</strong>
                  ${isEditor() ? `<button class="btn-secondary btn-sm" data-add-building="${o.id}">+ 新增建物</button>` : ""}
                </div>
                ${
                  o.building_records.length
                    ? `<table>
                        <thead><tr><th>建號</th><th>座落地號</th><th>樓層</th><th>面積</th><th>持分</th>${isEditor() ? "<th>操作</th>" : ""}</tr></thead>
                        <tbody>
                          ${o.building_records
                            .map(
                              (br) => `<tr>
                                <td>${escapeHtml(br.building_number) || "-"}</td>
                                <td>${escapeHtml((o.land_records.find((lr) => lr.id === br.land_record_id) || {}).parcel_number) || "-"}</td>
                                <td>${escapeHtml(br.floor) || "-"}</td>
                                <td>${br.total_area_sqm}m²</td>
                                <td>${br.ownership_numerator}/${br.ownership_denominator} (${br.ownership_share_pct}%)</td>
                                ${
                                  isEditor()
                                    ? `<td class="actions-cell">
                                        <button class="btn-secondary btn-sm" data-edit-building="${br.id}" data-owner="${o.id}">編輯</button>
                                        <button class="btn-danger btn-sm" data-delete-building="${br.id}" data-owner="${o.id}">刪除</button>
                                      </td>`
                                    : ""
                                }
                              </tr>`
                            )
                            .join("")}
                        </tbody>
                      </table>`
                    : `<div class="helper-text">尚無建物資料</div>`
                }
              </div>
            </td></tr>
          `
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;

  if (!landowners.length) {
    el.querySelector(".table-wrap").outerHTML = `<div class="empty-state">${isLand ? "尚無土地登記資料" : "尚無建物登記資料"}</div>`;
  }

  el.querySelectorAll("[data-detail]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.getElementById(`detail-row-${btn.dataset.detail}`).classList.toggle("hidden");
    });
  });
  el.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", () => openEditLandownerModal(Number(btn.dataset.edit)));
  });
  el.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", () => deleteLandowner(Number(btn.dataset.delete)));
  });
  const addBtn = document.getElementById("add-landowner-btn");
  if (addBtn) addBtn.addEventListener("click", openAddLandownerModal);
  const scanBtn = document.getElementById("scan-title-deed-btn");
  if (scanBtn) scanBtn.addEventListener("click", isLand ? openTitleDeedWizard : openBuildingTitleDeedWizard);

  const mergeBtn = document.getElementById("merge-landowners-btn");
  const mergeCheckboxes = el.querySelectorAll(".merge-select-cb");
  const updateMergeBtnState = () => {
    if (!mergeBtn) return;
    const checkedCount = el.querySelectorAll(".merge-select-cb:checked").length;
    mergeBtn.disabled = checkedCount < 2;
  };
  mergeCheckboxes.forEach((cb) => cb.addEventListener("change", updateMergeBtnState));
  if (mergeBtn) {
    mergeBtn.addEventListener("click", () => {
      const selectedIds = Array.from(el.querySelectorAll(".merge-select-cb:checked")).map((cb) => Number(cb.value));
      const selectedOwners = landowners.filter((o) => selectedIds.includes(o.id));
      openMergeLandownersModal(selectedOwners);
    });
  }

  el.querySelectorAll("[data-add-land]").forEach((btn) => {
    btn.addEventListener("click", () => openAddLandRecordModal(Number(btn.dataset.addLand)));
  });
  el.querySelectorAll("[data-add-building]").forEach((btn) => {
    btn.addEventListener("click", () => openAddBuildingRecordModal(Number(btn.dataset.addBuilding)));
  });
  el.querySelectorAll("[data-edit-land]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const owner = landowners.find((o) => o.id === Number(btn.dataset.owner));
      const record = owner?.land_records.find((r) => r.id === Number(btn.dataset.editLand));
      if (record) openEditLandRecordModal(owner.id, record);
    });
  });
  el.querySelectorAll("[data-delete-land]").forEach((btn) => {
    btn.addEventListener("click", () => deleteLandRecord(Number(btn.dataset.owner), Number(btn.dataset.deleteLand)));
  });
  el.querySelectorAll("[data-edit-building]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const owner = landowners.find((o) => o.id === Number(btn.dataset.owner));
      const record = owner?.building_records.find((r) => r.id === Number(btn.dataset.editBuilding));
      if (record) openEditBuildingRecordModal(owner.id, record);
    });
  });
  el.querySelectorAll("[data-delete-building]").forEach((btn) => {
    btn.addEventListener("click", () =>
      deleteBuildingRecord(Number(btn.dataset.owner), Number(btn.dataset.deleteBuilding))
    );
  });
}

function landRecordRowHtml() {
  return `
    <div class="field-row">
      <div class="field"><label>地號</label><input class="lr-parcel"></div>
      <div class="field"><label>地段</label><input class="lr-section"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>總面積(m²)</label><input class="lr-area" type="number" step="0.01"></div>
      <div class="field"><label>持分(分子/分母)</label>
        <div style="display:flex;gap:6px">
          <input class="lr-num" type="number" placeholder="分子" value="1">
          <input class="lr-den" type="number" placeholder="分母" value="1">
        </div>
      </div>
    </div>
    <button type="button" class="btn-link btn-sm remove-row-btn">刪除此筆</button>`;
}

function buildingRecordRowHtml() {
  return `
    <div class="field-row">
      <div class="field"><label>建號</label><input class="br-number"></div>
      <div class="field"><label>樓層</label><input class="br-floor"></div>
    </div>
    <div class="field"><label>建物地址</label><input class="br-address"></div>
    <div class="field-row">
      <div class="field"><label>主建物面積(m²)</label><input class="br-structure" type="number" step="0.01" value="0"></div>
      <div class="field"><label>附屬建物面積(m²)</label><input class="br-auxiliary" type="number" step="0.01" value="0"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>共有部分面積(m²)</label><input class="br-common" type="number" step="0.01" value="0"></div>
      <div class="field"><label>持分(分子/分母)</label>
        <div style="display:flex;gap:6px">
          <input class="br-num" type="number" placeholder="分子" value="1">
          <input class="br-den" type="number" placeholder="分母" value="1">
        </div>
      </div>
    </div>
    <button type="button" class="btn-link btn-sm remove-row-btn">刪除此筆</button>`;
}

function addLandRecordRow(container, prefill = {}) {
  const row = document.createElement("div");
  row.className = "record-row";
  row.style.cssText = "border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:8px";
  row.innerHTML = landRecordRowHtml();
  if (prefill.parcel_number) row.querySelector(".lr-parcel").value = prefill.parcel_number;
  if (prefill.section) row.querySelector(".lr-section").value = prefill.section;
  if (prefill.total_area_sqm) row.querySelector(".lr-area").value = prefill.total_area_sqm;
  if (prefill.ownership_numerator) row.querySelector(".lr-num").value = prefill.ownership_numerator;
  if (prefill.ownership_denominator) row.querySelector(".lr-den").value = prefill.ownership_denominator;
  row.querySelector(".remove-row-btn").addEventListener("click", () => row.remove());
  container.appendChild(row);
  return row;
}

function addBuildingRecordRow(container, prefill = {}) {
  const row = document.createElement("div");
  row.className = "record-row";
  row.style.cssText = "border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:8px";
  row.innerHTML = buildingRecordRowHtml();
  if (prefill.building_number) row.querySelector(".br-number").value = prefill.building_number;
  if (prefill.floor) row.querySelector(".br-floor").value = prefill.floor;
  if (prefill.address) row.querySelector(".br-address").value = prefill.address;
  if (prefill.structure_area_sqm) row.querySelector(".br-structure").value = prefill.structure_area_sqm;
  if (prefill.auxiliary_area_sqm) row.querySelector(".br-auxiliary").value = prefill.auxiliary_area_sqm;
  if (prefill.common_area_sqm) row.querySelector(".br-common").value = prefill.common_area_sqm;
  if (prefill.ownership_numerator) row.querySelector(".br-num").value = prefill.ownership_numerator;
  if (prefill.ownership_denominator) row.querySelector(".br-den").value = prefill.ownership_denominator;
  row.querySelector(".remove-row-btn").addEventListener("click", () => row.remove());
  container.appendChild(row);
  return row;
}

function readLandRecordRows(container) {
  return [...container.querySelectorAll(".record-row")]
    .map((row) => ({
      parcel_number: row.querySelector(".lr-parcel").value.trim(),
      section: row.querySelector(".lr-section").value.trim() || null,
      total_area_sqm: Number(row.querySelector(".lr-area").value) || 0,
      ownership_numerator: Number(row.querySelector(".lr-num").value) || 1,
      ownership_denominator: Number(row.querySelector(".lr-den").value) || 1,
    }))
    .filter((r) => r.parcel_number);
}

function readBuildingRecordRows(container) {
  return [...container.querySelectorAll(".record-row")]
    .map((row) => ({
      building_number: row.querySelector(".br-number").value.trim() || null,
      floor: row.querySelector(".br-floor").value.trim() || null,
      address: row.querySelector(".br-address").value.trim() || null,
      structure_area_sqm: Number(row.querySelector(".br-structure").value) || 0,
      auxiliary_area_sqm: Number(row.querySelector(".br-auxiliary").value) || 0,
      common_area_sqm: Number(row.querySelector(".br-common").value) || 0,
      ownership_numerator: Number(row.querySelector(".br-num").value) || 1,
      ownership_denominator: Number(row.querySelector(".br-den").value) || 1,
    }))
    .filter((r) => r.building_number || r.address);
}

function openAddLandownerModal() {
  openModal(
    "新增地主",
    `
    <form id="landowner-form">
      <div class="field-row">
        <div class="field"><label>姓名</label><input name="name" required></div>
        <div class="field"><label>身分證字號</label><input name="id_number"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>電話</label><input name="phone"></div>
        <div class="field"><label>地址</label><input name="address"></div>
      </div>
      <label><input type="checkbox" name="is_representative" style="width:auto;display:inline-block;margin-right:6px"> 為土地/建物代表人</label>
      <div class="field" style="margin-top:10px"><label>備註</label><textarea name="notes" rows="2"></textarea></div>
      <fieldset>
        <legend>土地資料(選填,可新增多筆)</legend>
        <div id="land-records-list"></div>
        <button type="button" class="btn-secondary btn-sm" id="add-land-row-btn">+ 新增一筆土地</button>
      </fieldset>
      <fieldset>
        <legend>建物資料(選填,可新增多筆)</legend>
        <div id="building-records-list"></div>
        <button type="button" class="btn-secondary btn-sm" id="add-building-row-btn">+ 新增一筆建物</button>
      </fieldset>
      <div class="modal-footer">
        <button type="button" class="btn-secondary" onclick="closeModal()">取消</button>
        <button type="submit" class="btn-primary">建立</button>
      </div>
    </form>`
  );

  const landList = document.getElementById("land-records-list");
  const buildingList = document.getElementById("building-records-list");
  addLandRecordRow(landList);

  document.getElementById("add-land-row-btn").addEventListener("click", () => addLandRecordRow(landList));
  document.getElementById("add-building-row-btn").addEventListener("click", () => addBuildingRecordRow(buildingList));

  document.getElementById("landowner-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = Object.fromEntries(fd.entries());
    const payload = {
      name: data.name,
      id_number: data.id_number || null,
      phone: data.phone || null,
      address: data.address || null,
      is_representative: fd.has("is_representative"),
      notes: data.notes || null,
      land_records: readLandRecordRows(landList),
      building_records: readBuildingRecordRows(buildingList),
    };
    try {
      await api(`/projects/${state.currentProjectId}/landowners`, { method: "POST", body: payload });
      closeModal();
      toast("地主已新增", "success");
      renderTab(state.activeTab);
    } catch (err) {}
  });
}

function openEditLandownerModal(landownerId) {
  const owner = state.projectCache[state.currentProjectId].landowners.find((o) => o.id === landownerId);
  if (!owner) return;
  openModal(
    "編輯地主",
    `
    <form id="landowner-edit-form">
      <div class="field-row">
        <div class="field"><label>姓名</label><input name="name" value="${escapeHtml(owner.name)}" required></div>
        <div class="field"><label>身分證字號</label><input name="id_number" value="${escapeHtml(owner.id_number) || ""}"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>電話</label><input name="phone" value="${escapeHtml(owner.phone) || ""}"></div>
        <div class="field"><label>聯絡狀態</label>
          <select name="contact_status">
            ${Object.entries(CONTACT_STATUS_LABEL)
              .map(([k, v]) => `<option value="${k}" ${owner.contact_status === k ? "selected" : ""}>${v}</option>`)
              .join("")}
          </select>
        </div>
      </div>
      <div class="field"><label>地址</label><input name="address" value="${escapeHtml(owner.address) || ""}"></div>
      <div class="field"><label>備註</label><textarea name="notes" rows="2">${escapeHtml(owner.notes) || ""}</textarea></div>
      <div class="modal-footer">
        <button type="button" class="btn-secondary" onclick="closeModal()">取消</button>
        <button type="submit" class="btn-primary">儲存</button>
      </div>
    </form>`
  );
  document.getElementById("landowner-edit-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = Object.fromEntries(fd.entries());
    try {
      await api(`/projects/${state.currentProjectId}/landowners/${landownerId}`, { method: "PATCH", body: payload });
      closeModal();
      toast("已更新", "success");
      renderTab(state.activeTab);
    } catch (err) {}
  });
}

async function deleteLandowner(id) {
  if (!confirm("確定要刪除此地主嗎?")) return;
  try {
    await api(`/projects/${state.currentProjectId}/landowners/${id}`, { method: "DELETE" });
    toast("已刪除", "success");
    renderTab(state.activeTab);
  } catch (err) {}
}

function openMergeLandownersModal(owners) {
  openModal(
    "合併地主",
    `<p class="helper-text">選擇要保留的地主,其他被選取的地主的土地/建物/聯絡紀錄會全部併入保留的這筆,其餘資料則會被刪除。</p>
    <form id="merge-landowner-form">
      ${owners
        .map(
          (o, i) => `<label style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border)">
            <input type="radio" name="survivor" value="${o.id}" ${i === 0 ? "checked" : ""}>
            <span>${escapeHtml(o.name)}${o.id_number ? ` (${escapeHtml(o.id_number)})` : ""} - 土地 ${o.land_records.length} 筆 / 建物 ${o.building_records.length} 筆</span>
          </label>`
        )
        .join("")}
      <div class="modal-footer">
        <button type="button" class="btn-secondary" onclick="closeModal()">取消</button>
        <button type="submit" class="btn-primary">確認合併</button>
      </div>
    </form>`
  );
  document.getElementById("merge-landowner-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const survivorId = Number(new FormData(e.target).get("survivor"));
    const sourceIds = owners.map((o) => o.id).filter((id) => id !== survivorId);
    try {
      await api(`/projects/${state.currentProjectId}/landowners/${survivorId}/merge`, {
        method: "POST",
        body: { source_ids: sourceIds },
      });
      closeModal();
      toast("已合併地主", "success");
      renderTab(state.activeTab);
    } catch (err) {}
  });
}

/* ---- Land / building records (per-landowner, added after creation) ---- */

function landRecordFormFields(record) {
  const r = record || {};
  return `
    <div class="field-row">
      <div class="field"><label>地號</label><input name="parcel_number" value="${escapeHtml(r.parcel_number) || ""}" required></div>
      <div class="field"><label>地段</label><input name="section" value="${escapeHtml(r.section) || ""}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>總面積(m²)</label><input name="total_area_sqm" type="number" step="0.01" value="${r.total_area_sqm ?? 0}"></div>
      <div class="field"><label>持分(分子/分母)</label>
        <div style="display:flex;gap:6px">
          <input name="ownership_numerator" type="number" value="${r.ownership_numerator ?? 1}">
          <input name="ownership_denominator" type="number" value="${r.ownership_denominator ?? 1}">
        </div>
      </div>
    </div>`;
}

function readLandRecordForm(fd) {
  const data = Object.fromEntries(fd.entries());
  return {
    parcel_number: data.parcel_number,
    section: data.section || null,
    total_area_sqm: Number(data.total_area_sqm) || 0,
    ownership_numerator: Number(data.ownership_numerator) || 1,
    ownership_denominator: Number(data.ownership_denominator) || 1,
  };
}

function openAddLandRecordModal(landownerId) {
  openModal(
    "新增土地資料",
    `<form id="land-record-form">
      ${landRecordFormFields()}
      <div class="modal-footer">
        <button type="button" class="btn-secondary" onclick="closeModal()">取消</button>
        <button type="submit" class="btn-primary">新增</button>
      </div>
    </form>`
  );
  document.getElementById("land-record-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api(`/projects/${state.currentProjectId}/landowners/${landownerId}/land-records`, {
        method: "POST",
        body: readLandRecordForm(new FormData(e.target)),
      });
      closeModal();
      toast("土地資料已新增", "success");
      renderTab(state.activeTab);
    } catch (err) {}
  });
}

function openEditLandRecordModal(landownerId, record) {
  openModal(
    "編輯土地資料",
    `<form id="land-record-edit-form">
      ${landRecordFormFields(record)}
      <div class="modal-footer">
        <button type="button" class="btn-secondary" onclick="closeModal()">取消</button>
        <button type="submit" class="btn-primary">儲存</button>
      </div>
    </form>`
  );
  document.getElementById("land-record-edit-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api(`/projects/${state.currentProjectId}/landowners/${landownerId}/land-records/${record.id}`, {
        method: "PATCH",
        body: readLandRecordForm(new FormData(e.target)),
      });
      closeModal();
      toast("已更新", "success");
      renderTab(state.activeTab);
    } catch (err) {}
  });
}

async function deleteLandRecord(landownerId, recordId) {
  if (!confirm("確定要刪除此筆土地資料嗎?")) return;
  try {
    await api(`/projects/${state.currentProjectId}/landowners/${landownerId}/land-records/${recordId}`, { method: "DELETE" });
    toast("已刪除", "success");
    renderTab(state.activeTab);
  } catch (err) {}
}

function buildingRecordFormFields(record) {
  const r = record || {};
  return `
    <div class="field-row">
      <div class="field"><label>建號</label><input name="building_number" value="${escapeHtml(r.building_number) || ""}"></div>
      <div class="field"><label>樓層</label><input name="floor" value="${escapeHtml(r.floor) || ""}"></div>
    </div>
    <div class="field"><label>建物地址</label><input name="address" value="${escapeHtml(r.address) || ""}"></div>
    <div class="field-row">
      <div class="field"><label>主建物面積(m²)</label><input name="structure_area_sqm" type="number" step="0.01" value="${r.structure_area_sqm ?? 0}"></div>
      <div class="field"><label>附屬建物面積(m²)</label><input name="auxiliary_area_sqm" type="number" step="0.01" value="${r.auxiliary_area_sqm ?? 0}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>共有部分面積(m²)</label><input name="common_area_sqm" type="number" step="0.01" value="${r.common_area_sqm ?? 0}"></div>
      <div class="field"><label>持分(分子/分母)</label>
        <div style="display:flex;gap:6px">
          <input name="ownership_numerator" type="number" value="${r.ownership_numerator ?? 1}">
          <input name="ownership_denominator" type="number" value="${r.ownership_denominator ?? 1}">
        </div>
      </div>
    </div>`;
}

function readBuildingRecordForm(fd) {
  const data = Object.fromEntries(fd.entries());
  return {
    building_number: data.building_number || null,
    floor: data.floor || null,
    address: data.address || null,
    structure_area_sqm: Number(data.structure_area_sqm) || 0,
    auxiliary_area_sqm: Number(data.auxiliary_area_sqm) || 0,
    common_area_sqm: Number(data.common_area_sqm) || 0,
    ownership_numerator: Number(data.ownership_numerator) || 1,
    ownership_denominator: Number(data.ownership_denominator) || 1,
  };
}

function openAddBuildingRecordModal(landownerId) {
  openModal(
    "新增建物資料",
    `<form id="building-record-form">
      ${buildingRecordFormFields()}
      <div class="modal-footer">
        <button type="button" class="btn-secondary" onclick="closeModal()">取消</button>
        <button type="submit" class="btn-primary">新增</button>
      </div>
    </form>`
  );
  document.getElementById("building-record-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api(`/projects/${state.currentProjectId}/landowners/${landownerId}/building-records`, {
        method: "POST",
        body: readBuildingRecordForm(new FormData(e.target)),
      });
      closeModal();
      toast("建物資料已新增", "success");
      renderTab(state.activeTab);
    } catch (err) {}
  });
}

function openEditBuildingRecordModal(landownerId, record) {
  openModal(
    "編輯建物資料",
    `<form id="building-record-edit-form">
      ${buildingRecordFormFields(record)}
      <div class="modal-footer">
        <button type="button" class="btn-secondary" onclick="closeModal()">取消</button>
        <button type="submit" class="btn-primary">儲存</button>
      </div>
    </form>`
  );
  document.getElementById("building-record-edit-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api(`/projects/${state.currentProjectId}/landowners/${landownerId}/building-records/${record.id}`, {
        method: "PATCH",
        body: readBuildingRecordForm(new FormData(e.target)),
      });
      closeModal();
      toast("已更新", "success");
      renderTab(state.activeTab);
    } catch (err) {}
  });
}

async function deleteBuildingRecord(landownerId, recordId) {
  if (!confirm("確定要刪除此筆建物資料嗎?")) return;
  try {
    await api(`/projects/${state.currentProjectId}/landowners/${landownerId}/building-records/${recordId}`, { method: "DELETE" });
    toast("已刪除", "success");
    renderTab(state.activeTab);
  } catch (err) {}
}

/* ================= Title deed OCR wizard ================= */

const PING_PER_SQM = 0.3025;
let titleDeedWizard = null;

function openTitleDeedWizard() {
  // The 地主清冊 tab's 「土地登記匯入」button is always used to import 土地謄本 - fixing
  // this to "land" instead of showing the type dropdown keeps the common path simple
  // and avoids someone accidentally leaving it on "both"/"building" here. Building
  // deeds have their own separate entry point - see openBuildingTitleDeedWizard().
  titleDeedWizard = { files: [], pages: [], step: 0, data: null, activeType: null, activeIndex: null, recordType: "land", lockRecordType: true };
  renderWizardStep0();
}

function openBuildingTitleDeedWizard() {
  // Same idea as openTitleDeedWizard() but for the 「建物登記匯入」button - locked to
  // "building" so this can be run directly from the 地主清冊 tab, not just via the
  // land-import follow-up prompt (see offerBuildingImportFollowUp()), for a case where
  // the land data was already handled some other way and only the building deed needs
  // scanning now.
  titleDeedWizard = { files: [], pages: [], step: 0, data: null, activeType: null, activeIndex: null, recordType: "building", lockRecordType: true };
  renderWizardStep0();
}

function wizardProgressHtml(label) {
  return `<div class="wizard-progress-label">📝 ${escapeHtml(label)}</div>`;
}

function normalizeTitleDeedData(raw) {
  raw = raw || {};
  const toLandOwnerRow = (o) => {
    o = o || {};
    return {
      registration_order: o.registration_order || "",
      owner_name: o.owner_name || "",
      id_number: o.id_number || "",
      ownership_numerator: o.ownership_numerator || 1,
      ownership_denominator: o.ownership_denominator || 1,
      address: o.address || "",
    };
  };
  const toBuildingOwnerRow = (o) => {
    o = o || {};
    return {
      registration_order: o.registration_order || "",
      owner_name: o.owner_name || "",
      ownership_numerator: o.ownership_numerator || 1,
      ownership_denominator: o.ownership_denominator || 1,
      address: o.address || "",
    };
  };

  const toEncumbranceRow = (e) => {
    e = e || {};
    return {
      registration_order: e.registration_order || "",
      applies_to_parcels: e.applies_to_parcels || "",
      right_type: e.right_type || "",
      right_holder: e.right_holder || "",
      debtor_info: e.debtor_info || "",
    };
  };

  const parcels = (raw.land_parcels || []).map((p) => ({
    township: p.township || "",
    section: p.section || "",
    subsection: p.subsection || "",
    parcel_number: p.parcel_number || "",
    area_sqm: p.area_sqm ?? "",
    owners: (p.owners || []).map(toLandOwnerRow),
    encumbrances: (p.encumbrances || []).map(toEncumbranceRow),
  }));

  const buildings = (raw.buildings || []).map((b) => ({
    building_number: b.building_number || "",
    building_address: b.building_address || "",
    parcel_number: b.parcel_number || "",
    total_floors: b.total_floors || "",
    floor: b.floor || "",
    total_area_sqm: b.total_area_sqm ?? "",
    floor_area_sqm: b.floor_area_sqm ?? "",
    owners: (b.owners || []).map(toBuildingOwnerRow),
  }));

  const encumbrances = (raw.encumbrances || []).map(toEncumbranceRow);

  return { parcels, buildings, encumbrances };
}

// Jumps straight from the confirm screen's summary card back into a specific
// parcel/building's owners sub-step, instead of making the user click "上一步"
// repeatedly through every record to reach the one the 100% ownership-share warning
// flagged.
function jumpToWizardRecordOwners(type, idx) {
  titleDeedWizard.activeType = type;
  titleDeedWizard.activeIndex = idx;
  if (type === "parcel") {
    titleDeedWizard.parcelSubStep = 1;
    titleDeedWizard.step = 2;
  } else {
    titleDeedWizard.buildingSubStep = 1;
    titleDeedWizard.step = 3;
  }
  renderWizardStep();
}

function renderWizardStep() {
  const steps = {
    2: renderWizardStepParcelEditor,
    3: renderWizardStepBuildingEditor,
    4: renderWizardStepConfirm,
  };
  steps[titleDeedWizard.step]();
}

// Routes to the first thing the user needs to review after OCR completes: walk through
// detected 地號 one at a time, then 建號 one at a time, straight to the final confirm
// screen once both are exhausted - there's no "總覽" list screen or separate 他項權利
// catch-all step to land on first (each 地號's own 他項權利 is reviewed as part of its
// own sub-steps; anything AI put in the cross-parcel/全部 bucket still shows up in the
// confirm screen's summary).
function startWizardReview() {
  const d = titleDeedWizard.data;
  titleDeedWizard.parcelSubStep = 0;
  titleDeedWizard.buildingSubStep = 0;
  if (d.parcels.length) {
    titleDeedWizard.activeType = "parcel";
    titleDeedWizard.activeIndex = 0;
    titleDeedWizard.step = 2;
  } else if (d.buildings.length) {
    titleDeedWizard.activeType = "building";
    titleDeedWizard.activeIndex = 0;
    titleDeedWizard.step = 3;
  } else {
    titleDeedWizard.step = 4;
  }
  renderWizardStep();
}

/* ---- Step 0: upload + reorder ---- */

const WIZARD_RECORD_TYPE_LABEL = { both: "土地+建物謄本混合", land: "土地謄本(地號)", building: "建物謄本(建號)" };

function renderWizardStep0() {
  const recordTypeField = titleDeedWizard.lockRecordType
    ? `<div class="field">
        <label>這次上傳的是</label>
        <div class="helper-text" style="font-weight:600">${WIZARD_RECORD_TYPE_LABEL[titleDeedWizard.recordType]}</div>
      </div>`
    : `<div class="field">
        <label>這次上傳的是</label>
        <select id="wizard-record-type">
          <option value="both" ${titleDeedWizard.recordType === "both" ? "selected" : ""}>土地+建物謄本混合(不確定就選這個)</option>
          <option value="land" ${titleDeedWizard.recordType === "land" ? "selected" : ""}>只有土地謄本(只抓地號,不會冒出建號資料)</option>
          <option value="building" ${titleDeedWizard.recordType === "building" ? "selected" : ""}>只有建物謄本(只抓建號,不會冒出地號資料)</option>
        </select>
      </div>`;
  openModal(
    "掃描謄本匯入",
    `
    ${recordTypeField}
    <div class="field">
      <label>選擇謄本圖片或 PDF(可多選;拍照多張時請依謄本頁面順序選取)</label>
      <input type="file" id="wizard-file-input" accept="image/*,application/pdf" multiple>
    </div>
    <div style="margin:-4px 0 10px">
      <button type="button" class="btn-link" id="wizard-pick-document-btn">或從本案件已上傳的文件選擇,不用重新下載再上傳</button>
    </div>
    <div id="wizard-file-list"></div>
    <div class="helper-text">若有多張照片或多頁,請用下方的 ▲▼ 調整順序,順序需與謄本頁面順序一致</div>
    <div id="wizard-ocr-progress-wrap" style="display:none;margin-top:14px">
      <div class="progress-bar-track"><div class="progress-bar-fill" id="wizard-ocr-progress-fill" style="width:0%"></div></div>
      <div class="helper-text" id="wizard-ocr-progress-label" style="margin-top:4px;text-align:center"></div>
    </div>
    <div class="modal-footer">
      <button type="button" class="btn-secondary" onclick="closeModal()">取消</button>
      <button type="button" class="btn-primary" id="wizard-start-ocr-btn">開始辨識</button>
    </div>`,
    { width: "560px" }
  );

  renderWizardFileList();

  document.getElementById("wizard-file-input").addEventListener("change", (e) => {
    titleDeedWizard.files.push(...Array.from(e.target.files));
    e.target.value = "";
    renderWizardFileList();
  });
  const recordTypeSelect = document.getElementById("wizard-record-type");
  if (recordTypeSelect) {
    recordTypeSelect.addEventListener("change", (e) => {
      titleDeedWizard.recordType = e.target.value;
    });
  }
  document.getElementById("wizard-pick-document-btn").addEventListener("click", openWizardDocumentPicker);
  document.getElementById("wizard-start-ocr-btn").addEventListener("click", runTitleDeedOcr);
}

async function openWizardDocumentPicker() {
  let documents;
  try {
    documents = await api(`/projects/${state.currentProjectId}/documents`);
  } catch (e) {
    return;
  }
  documents = documents.filter((d) => (d.mime_type || "").startsWith("image/") || d.mime_type === "application/pdf");

  openModal(
    "從本案件文件選擇",
    `
    ${documents.length ? `<div class="helper-text" style="margin-bottom:10px">可勾選多個文件一次加入</div>` : ""}
    <div id="wizard-document-picker-list">
      ${
        documents.length
          ? documents
              .map(
                (d) => `
              <label class="record-row" style="display:flex;align-items:center;gap:8px;padding:8px 10px;margin-bottom:6px;cursor:pointer">
                <input type="checkbox" class="wizard-document-checkbox" value="${d.id}" style="width:auto;flex-shrink:0">
                <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(d.file_name)}${d.description ? ` · ${escapeHtml(d.description)}` : ""}</span>
              </label>`
              )
              .join("")
          : `<div class="helper-text">本案件尚未有可選擇的圖片或 PDF 文件</div>`
      }
    </div>
    <div class="modal-footer">
      <button type="button" class="btn-secondary" onclick="renderWizardStep0()">返回</button>
      ${documents.length ? `<button type="button" class="btn-primary" id="wizard-document-picker-confirm-btn">加入選取的文件</button>` : ""}
    </div>`,
    { width: "560px" }
  );

  const confirmBtn = document.getElementById("wizard-document-picker-confirm-btn");
  if (confirmBtn) {
    confirmBtn.addEventListener("click", async () => {
      const checked = Array.from(document.querySelectorAll(".wizard-document-checkbox:checked"));
      if (!checked.length) {
        toast("請至少勾選一個文件", "error");
        return;
      }
      confirmBtn.disabled = true;
      confirmBtn.textContent = "載入中...";
      try {
        // Sequential, not parallel - keeps the added files in the same order the user
        // checked them in, matching how manually-selected files already preserve
        // selection order, instead of resolving in whatever order the downloads happen
        // to finish.
        for (const checkbox of checked) {
          const doc = documents.find((d) => d.id === Number(checkbox.value));
          const res = await api(`/projects/${state.currentProjectId}/documents/${doc.id}/download`);
          const blob = await res.blob();
          const file = new File([blob], doc.file_name, { type: doc.mime_type });
          // Marks this page as already archived, so runTitleDeedOcr() can tell the
          // backend to link the existing document instead of re-saving these same
          // bytes as a brand new one - see source_document_ids on /ocr/title-deed.
          file.sourceDocumentId = doc.id;
          titleDeedWizard.files.push(file);
        }
        renderWizardStep0();
      } catch (e) {
        confirmBtn.disabled = false;
        confirmBtn.textContent = "加入選取的文件";
      }
    });
  }
}

function renderWizardFileList() {
  const wrap = document.getElementById("wizard-file-list");
  if (!titleDeedWizard.files.length) {
    wrap.innerHTML = `<div class="helper-text">尚未選擇檔案</div>`;
    return;
  }
  wrap.innerHTML = titleDeedWizard.files
    .map(
      (f, i) => `
      <div class="record-row" style="display:flex;align-items:center;gap:8px;padding:8px 10px;margin-bottom:6px">
        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${i + 1}. ${escapeHtml(f.name)}</span>
        <button type="button" class="btn-secondary btn-sm" data-move-up="${i}" ${i === 0 ? "disabled" : ""}>▲</button>
        <button type="button" class="btn-secondary btn-sm" data-move-down="${i}" ${
        i === titleDeedWizard.files.length - 1 ? "disabled" : ""
      }>▼</button>
        <button type="button" class="btn-danger btn-sm" data-remove-file="${i}">移除</button>
      </div>`
    )
    .join("");

  wrap.querySelectorAll("[data-move-up]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.moveUp);
      [titleDeedWizard.files[i - 1], titleDeedWizard.files[i]] = [titleDeedWizard.files[i], titleDeedWizard.files[i - 1]];
      renderWizardFileList();
    });
  });
  wrap.querySelectorAll("[data-move-down]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.moveDown);
      [titleDeedWizard.files[i + 1], titleDeedWizard.files[i]] = [titleDeedWizard.files[i], titleDeedWizard.files[i + 1]];
      renderWizardFileList();
    });
  });
  wrap.querySelectorAll("[data-remove-file]").forEach((btn) => {
    btn.addEventListener("click", () => {
      titleDeedWizard.files.splice(Number(btn.dataset.removeFile), 1);
      renderWizardFileList();
    });
  });
}

async function runTitleDeedOcr() {
  if (!titleDeedWizard.files.length) {
    toast("請先選擇至少一個檔案", "error");
    return;
  }
  const btn = document.getElementById("wizard-start-ocr-btn");
  btn.disabled = true;
  // Whether to use the slow-but-accurate engine is now the user's own explicit choice
  // (the checkbox on step 0), not a hardcoded default either way - prompt-based
  // correction alone can't recover a character the fast engine's raw OCR text never
  // captured in the first place (missing 鄰, missing 里 characters, whole records
  // dropped entirely), so accuracy-sensitive imports need the better engine from the
  // start, not patched after the fact.
  btn.textContent = "辨識中...(請稍候，勿關閉視窗)";
  // tauSeconds controls how long the curve takes to approach its ~92% ceiling - the
  // default (20s) was calibrated for a short batch, so a large multi-page upload spent
  // most of its real wait crawling the last few percent (fast at first, crawling near
  // the end, exactly the "前面快後面慢" users kept reporting). Real measured timing
  // (see the backend's own timing log) runs roughly 2-3s of total work per page, so
  // scale the curve to the batch size instead of a fixed constant.
  const progress = startFakeProgress(
    "wizard-ocr-progress-wrap",
    "wizard-ocr-progress-fill",
    "wizard-ocr-progress-label",
    Math.max(20, titleDeedWizard.files.length * 3)
  );
  try {
    const fd = new FormData();
    titleDeedWizard.files.forEach((f) => {
      fd.append("files", f);
      fd.append("source_document_ids", f.sourceDocumentId ? String(f.sourceDocumentId) : "");
    });
    fd.append("record_type", titleDeedWizard.recordType);
    const result = await api(`/projects/${state.currentProjectId}/ocr/title-deed`, { method: "POST", body: fd, isForm: true });

    if (result.job.status !== "completed") {
      toast(result.job.error_message || "辨識失敗,請手動輸入欄位", "error");
      titleDeedWizard.data = normalizeTitleDeedData(null);
    } else if (result.job.error_message) {
      // Completed, but part of a multi-chunk batch failed - the rest of the data is
      // still usable, just possibly incomplete.
      toast(result.job.error_message, "error");
      titleDeedWizard.data = normalizeTitleDeedData(result.data);
    } else {
      titleDeedWizard.data = normalizeTitleDeedData(result.data);
      titleDeedWizard.data.parcels.forEach((p) => {
        p._sourceOcrJobId = result.job.id;
      });
      titleDeedWizard.data.buildings.forEach((b) => {
        b._sourceOcrJobId = result.job.id;
      });
      toast("辨識完成,請逐步核對每個區塊", "success");
    }
    progress.finish();
    startWizardReview();
  } catch (err) {
    progress.stop();
    btn.disabled = false;
    btn.textContent = "開始辨識";
  }
}

/* ---- Shared: scanned-page lightbox preview, used by the batch case-split and
   building-batch import flows' page thumbnail grids. ---- */

function base64ToBlob(base64, mime) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

// Appended to <body> (not #modal-root) so it layers on top of whatever wizard modal is
// already open without destroying/replacing it - openModal() would wipe out the
// current screen's inputs and listeners.
function showImageLightbox(base64, mime) {
  const overlay = document.createElement("div");
  overlay.style.cssText =
    "position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:9999;display:flex;align-items:center;justify-content:center;cursor:zoom-out;padding:24px";
  overlay.innerHTML = `<img src="data:${mime};base64,${base64}" style="max-width:100%;max-height:100%;object-fit:contain;border-radius:6px;box-shadow:0 8px 32px rgba(0,0,0,.5)">`;
  overlay.addEventListener("click", () => overlay.remove());
  document.body.appendChild(overlay);
}

function wireThumbnailLightbox(container, pages) {
  container.querySelectorAll("img[data-page-index]").forEach((img) => {
    img.style.cursor = "zoom-in";
    img.addEventListener("click", () => {
      const p = pages[Number(img.dataset.pageIndex)];
      showImageLightbox(p.image_base64, p.mime_type);
    });
  });
}

function parcelSummaryLabel(p) {
  const place = `${p.township || ""}${p.section || ""}${p.subsection || ""}`;
  return `${place || "(未填寫鄉鎮市區/地段)"} · 地號 ${p.parcel_number || "-"} · ${p.owners.length} 位所有權人`;
}

function buildingSummaryLabel(b) {
  return `建號 ${b.building_number || "-"} · ${b.building_address || "(未填寫門牌)"} · ${b.owners.length} 位所有權人`;
}


/* ---- Shared: owner rows (land 所有權部 / building 所有權部) ---- */

function ownerRowHtml(prefix, o, areaSqm) {
  const numerator = o.ownership_numerator || 1;
  const denominator = o.ownership_denominator || 1;
  let areaHelper = "";
  if (areaSqm) {
    const ownedSqm = (areaSqm * numerator) / denominator;
    const ownedPing = ownedSqm * PING_PER_SQM;
    areaHelper = `
      <div class="field-row">
        <div class="field">
          <label>持分面積(m²)</label>
          <div class="${prefix}-area-sqm" style="padding:9px 11px;background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-sm);font-weight:600">${ownedSqm.toFixed(2)}</div>
        </div>
        <div class="field">
          <label>持分面積(坪)</label>
          <div class="${prefix}-area-ping" style="padding:9px 11px;background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-sm);font-weight:600">${ownedPing.toFixed(3)}</div>
        </div>
      </div>`;
  }
  return `
    <div class="field-row">
      <div class="field"><label>登記次序</label><input class="${prefix}-order" value="${escapeHtml(o.registration_order)}" autocomplete="off"></div>
      <div class="field"><label>所有權人姓名</label><input class="${prefix}-name" value="${escapeHtml(o.owner_name)}" autocomplete="off"></div>
    </div>
    <div class="field">
      <label>權利範圍</label>
      <div style="display:flex;align-items:center;gap:8px">
        <input class="${prefix}-num" type="number" value="${numerator}" placeholder="分子" style="width:90px" autocomplete="off">
        <span style="color:var(--text-muted)">分之</span>
        <input class="${prefix}-den" type="number" value="${denominator}" placeholder="分母" style="width:90px" autocomplete="off">
      </div>
    </div>
    ${areaHelper}
    <div class="field"><label>戶籍地址</label><input class="${prefix}-address" value="${escapeHtml(o.address)}" autocomplete="off"></div>
    <button type="button" class="btn-link btn-sm remove-wizard-row-btn">刪除此筆</button>`;
}

function renderOwnerRowsContainer(containerId, owners, prefix, areaSqm) {
  const wrap = document.getElementById(containerId);
  wrap.innerHTML = owners.map((o) => `<div class="record-row wizard-row">${ownerRowHtml(prefix, o, areaSqm)}</div>`).join("");
  wrap.querySelectorAll(".remove-wizard-row-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => e.target.closest(".wizard-row").remove());
  });
  // 持分面積 is derived from 權利範圍 - recompute it live as the user edits the
  // numerator/denominator, instead of only showing the stale OCR-time value until the
  // next full re-render (which only happens on step navigation).
  if (areaSqm) {
    wrap.querySelectorAll(`.${prefix}-num, .${prefix}-den`).forEach((input) => {
      input.addEventListener("input", () => {
        const row = input.closest(".wizard-row");
        const numerator = Number(row.querySelector(`.${prefix}-num`).value) || 0;
        const denominator = Number(row.querySelector(`.${prefix}-den`).value) || 1;
        const ownedSqm = (areaSqm * numerator) / denominator;
        row.querySelector(`.${prefix}-area-sqm`).textContent = ownedSqm.toFixed(2);
        row.querySelector(`.${prefix}-area-ping`).textContent = (ownedSqm * PING_PER_SQM).toFixed(3);
      });
    });
  }
}

function readOwnerRowsContainer(containerId, prefix) {
  return [...document.querySelectorAll(`#${containerId} .wizard-row`)]
    .map((row) => {
      const obj = {
        registration_order: row.querySelector(`.${prefix}-order`).value.trim(),
        owner_name: row.querySelector(`.${prefix}-name`).value.trim(),
        ownership_numerator: Number(row.querySelector(`.${prefix}-num`).value) || 1,
        ownership_denominator: Number(row.querySelector(`.${prefix}-den`).value) || 1,
        address: row.querySelector(`.${prefix}-address`).value.trim(),
      };
      const idInput = row.querySelector(`.${prefix}-idnum`);
      if (idInput) obj.id_number = idInput.value.trim();
      return obj;
    })
    .filter((o) => o.owner_name);
}

// Lets the user attach a separate file (e.g. a building's own 建物謄本, uploaded apart
// from whatever land-deed batch this record originally came from) and re-run OCR/AI
// extraction scoped to just that one file, overwriting only this single record's
// fields - instead of having to redo the whole multi-record wizard batch, or type
// everything in by hand, when one record's source document wasn't part of the original
// upload.
function openWizardSingleRecordRescan(recordType, record, rerender) {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*,application/pdf";
  input.multiple = true;
  input.addEventListener("change", async () => {
    if (!input.files.length) return;
    const btn = document.getElementById("wizard-rescan-btn");
    if (btn) {
      btn.disabled = true;
      // Uses the same smart-hybrid default engine as the main wizard flow (fast OCR on
      // the page, auto re-scanned with the slower high-accuracy engine only if this
      // page's own confidence comes back low) - no separate "high accuracy" mode to opt
      // into here any more.
      btn.textContent = "重新辨識中...(請稍候，勿關閉視窗)";
      // Same fake-but-honest progress bar as the main wizard OCR step (see
      // startFakeProgress) - asymptotically creeps toward ~92% and jumps to 100% on
      // finish, with an elapsed-seconds label. No real per-page signal exists for a
      // single blocking call either way, so this at least looks and reads consistently
      // with the rest of the wizard instead of a different indeterminate-bar style here.
      const wrap = document.createElement("div");
      wrap.id = "wizard-rescan-progress-wrap";
      wrap.style.marginTop = "8px";
      wrap.innerHTML = `
        <div class="progress-bar-track"><div class="progress-bar-fill" id="wizard-rescan-progress-fill" style="width:0%"></div></div>
        <div class="helper-text" id="wizard-rescan-progress-label" style="margin-top:4px;text-align:center"></div>`;
      btn.insertAdjacentElement("afterend", wrap);
    }
    var progress = btn
      ? startFakeProgress("wizard-rescan-progress-wrap", "wizard-rescan-progress-fill", "wizard-rescan-progress-label", 20, "重新辨識中")
      : null;
    try {
      const fd = new FormData();
      Array.from(input.files).forEach((f) => fd.append("files", f));
      fd.append("record_type", recordType === "parcel" ? "land" : "building");
      const result = await api(`/projects/${state.currentProjectId}/ocr/title-deed`, { method: "POST", body: fd, isForm: true });
      const normalized = normalizeTitleDeedData(result.data);
      const list = recordType === "parcel" ? normalized.parcels : normalized.buildings;
      if (list.length) {
        Object.assign(record, list[0]);
        toast("已重新辨識,請核對欄位", "success");
      } else {
        toast(`這份檔案沒有偵測到${recordType === "parcel" ? "地號" : "建物"}資料`, "error");
      }
      if (progress) progress.finish();
    } catch (e) {
      if (progress) progress.stop();
    } finally {
      rerender();
    }
  });
  input.click();
}

/* ---- Step 2: 土地所有權部 ---- */

// Advances past the parcel at `idx` (already saved or already deleted by the caller) to
// whatever comes next: the next parcel if there is one, the first building if not, or
// straight to the final confirm screen once both are exhausted.
function advanceFromParcel(idx) {
  const d = titleDeedWizard.data;
  titleDeedWizard.parcelSubStep = 0;
  if (idx < d.parcels.length) {
    titleDeedWizard.activeIndex = idx;
    renderWizardStep();
  } else if (d.buildings.length) {
    titleDeedWizard.activeType = "building";
    titleDeedWizard.activeIndex = 0;
    titleDeedWizard.buildingSubStep = 0;
    titleDeedWizard.step = 3;
    renderWizardStep();
  } else {
    titleDeedWizard.step = 4;
    renderWizardStep();
  }
}

// Each 地號 is reviewed as three small sub-steps in sequence, mirroring how the deed
// itself is actually printed (標示部 then 所有權部 then that parcel's own 他項權利部,
// before the next 地號 starts) instead of one combined form - see
// titleDeedWizard.parcelSubStep (0/1/2). "上一筆"/"下一筆" between whole parcels only
// happens at the edges (sub-step 0's 上一筆, sub-step 2's 下一筆/下一步).
function renderWizardStepParcelEditor() {
  const substeps = [renderParcelDescriptionSubStep, renderParcelOwnersSubStep, renderParcelEncumbrancesSubStep];
  substeps[titleDeedWizard.parcelSubStep || 0](titleDeedWizard.activeIndex);
}

function renderParcelDescriptionSubStep(idx) {
  const parcels = titleDeedWizard.data.parcels;
  const p = parcels[idx];
  openModal(
    "掃描謄本匯入",
    `
    ${wizardProgressHtml(`地號編輯(第 ${idx + 1} / ${parcels.length} 筆) · 1/3 土地標示部`)}
    <div style="margin-bottom:10px">
      <button type="button" class="btn-secondary btn-sm" id="wizard-rescan-btn">重新上傳這一筆的謄本檔案並辨識</button>
    </div>
    <form id="wizard-step-form" autocomplete="off">
      <div class="field-row">
        <div class="field"><label>鄉鎮市區</label><input name="township" value="${escapeHtml(p.township)}" autocomplete="off"></div>
        <div class="field"><label>地段</label><input name="section" value="${escapeHtml(p.section)}" autocomplete="off"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>小段</label><input name="subsection" value="${escapeHtml(p.subsection)}" autocomplete="off"></div>
        <div class="field"><label>地號</label><input name="parcel_number" value="${escapeHtml(p.parcel_number)}" autocomplete="off"></div>
      </div>
      <div class="field"><label>土地面積(㎡)</label><input name="area_sqm" type="number" step="0.01" value="${escapeHtml(p.area_sqm)}" autocomplete="off"></div>
    </form>
    <div class="modal-footer">
      <button type="button" class="btn-secondary" onclick="closeModal()">取消</button>
      <button type="button" class="btn-danger" id="wizard-delete-parcel-btn">刪除此筆</button>
      ${idx > 0 ? `<button type="button" class="btn-secondary" id="wizard-prev-item-btn">上一筆</button>` : ""}
      <button type="button" class="btn-primary" id="wizard-next-item-btn">下一步:土地所有權部</button>
    </div>`,
    { width: "620px" }
  );

  document.getElementById("wizard-rescan-btn").addEventListener("click", () => {
    openWizardSingleRecordRescan("parcel", p, () => renderParcelDescriptionSubStep(idx));
  });

  const saveFields = () => {
    const fd = new FormData(document.getElementById("wizard-step-form"));
    Object.assign(p, {
      township: (fd.get("township") || "").trim(),
      section: (fd.get("section") || "").trim(),
      subsection: (fd.get("subsection") || "").trim(),
      parcel_number: (fd.get("parcel_number") || "").trim(),
      area_sqm: fd.get("area_sqm") || "",
    });
  };

  const prevBtn = document.getElementById("wizard-prev-item-btn");
  if (prevBtn) {
    prevBtn.addEventListener("click", () => {
      saveFields();
      titleDeedWizard.activeIndex = idx - 1;
      titleDeedWizard.parcelSubStep = 2; // land on the previous parcel's last sub-step
      renderWizardStep();
    });
  }
  document.getElementById("wizard-next-item-btn").addEventListener("click", () => {
    saveFields();
    titleDeedWizard.parcelSubStep = 1;
    renderWizardStep();
  });
  document.getElementById("wizard-delete-parcel-btn").addEventListener("click", () => {
    parcels.splice(idx, 1);
    advanceFromParcel(idx);
  });
}

function renderParcelOwnersSubStep(idx) {
  const parcels = titleDeedWizard.data.parcels;
  const p = parcels[idx];
  openModal(
    "掃描謄本匯入",
    `
    ${wizardProgressHtml(`地號編輯(第 ${idx + 1} / ${parcels.length} 筆) · 2/3 土地所有權部`)}
    <div class="helper-text" style="margin-bottom:10px">${escapeHtml(parcelSummaryLabel(p))}</div>
    <div id="wizard-land-owners" style="margin:6px 0"></div>
    <button type="button" class="btn-secondary btn-sm" id="wizard-add-land-owner-btn">+ 新增共有人</button>
    <div class="modal-footer">
      <button type="button" class="btn-secondary" onclick="closeModal()">取消</button>
      <button type="button" class="btn-secondary" id="wizard-prev-item-btn">上一步</button>
      <button type="button" class="btn-primary" id="wizard-next-item-btn">下一步:土地他項權利部</button>
    </div>`,
    { width: "620px" }
  );

  const areaSqm = Number(p.area_sqm) || null;
  renderOwnerRowsContainer("wizard-land-owners", p.owners, "lo", areaSqm);

  document.getElementById("wizard-add-land-owner-btn").addEventListener("click", () => {
    p.owners = readOwnerRowsContainer("wizard-land-owners", "lo");
    p.owners.push({
      registration_order: "",
      owner_name: "",
      id_number: "",
      ownership_numerator: 1,
      ownership_denominator: 1,
      address: "",
    });
    renderOwnerRowsContainer("wizard-land-owners", p.owners, "lo", areaSqm);
  });

  document.getElementById("wizard-prev-item-btn").addEventListener("click", () => {
    p.owners = readOwnerRowsContainer("wizard-land-owners", "lo");
    titleDeedWizard.parcelSubStep = 0;
    renderWizardStep();
  });
  document.getElementById("wizard-next-item-btn").addEventListener("click", () => {
    p.owners = readOwnerRowsContainer("wizard-land-owners", "lo");
    titleDeedWizard.parcelSubStep = 2;
    renderWizardStep();
  });
}

function renderParcelEncumbrancesSubStep(idx) {
  const parcels = titleDeedWizard.data.parcels;
  const p = parcels[idx];
  const isLast = idx === parcels.length - 1;
  openModal(
    "掃描謄本匯入",
    `
    ${wizardProgressHtml(`地號編輯(第 ${idx + 1} / ${parcels.length} 筆) · 3/3 土地他項權利部`)}
    <div class="helper-text" style="margin-bottom:10px">${escapeHtml(parcelSummaryLabel(p))}</div>
    <div id="wizard-parcel-encumbrances" style="margin:6px 0"></div>
    <button type="button" class="btn-secondary btn-sm" id="wizard-add-parcel-encumbrance-btn">+ 新增他項權利</button>
    <div class="helper-text" style="margin-top:6px">若這筆地號沒有他項權利部,可直接略過。跨好幾筆地號的他項權利,留到最後「他項權利部」步驟處理即可</div>
    <div class="modal-footer">
      <button type="button" class="btn-secondary" onclick="closeModal()">取消</button>
      <button type="button" class="btn-secondary" id="wizard-prev-item-btn">上一步</button>
      <button type="button" class="btn-primary" id="wizard-next-item-btn">${isLast ? "下一步" : "下一筆地號"}</button>
    </div>`,
    { width: "620px" }
  );

  renderEncumbranceRows("wizard-parcel-encumbrances", p.encumbrances);

  document.getElementById("wizard-add-parcel-encumbrance-btn").addEventListener("click", () => {
    p.encumbrances = readEncumbranceRows("wizard-parcel-encumbrances");
    p.encumbrances.push({
      registration_order: "",
      applies_to_parcels: p.parcel_number || "",
      right_type: "",
      right_holder: "",
      debtor_info: "",
    });
    renderEncumbranceRows("wizard-parcel-encumbrances", p.encumbrances);
  });

  document.getElementById("wizard-prev-item-btn").addEventListener("click", () => {
    p.encumbrances = readEncumbranceRows("wizard-parcel-encumbrances");
    titleDeedWizard.parcelSubStep = 1;
    renderWizardStep();
  });
  document.getElementById("wizard-next-item-btn").addEventListener("click", () => {
    p.encumbrances = readEncumbranceRows("wizard-parcel-encumbrances");
    advanceFromParcel(idx + 1);
  });
}

/* ---- Step 3: 他項權利部(建立/刪除列的共用邏輯,實際編輯畫面在總覽頁) ---- */

// Common values seen in 他項權利部's 權利種類 field. If a row's AI-extracted value
// doesn't match either even after the near-match normalization below, it's kept as an
// extra selected option instead of being silently discarded/forced into the wrong
// choice - see encumbranceRowHtml.
const ENCUMBRANCE_RIGHT_TYPE_OPTIONS = ["最高限額抵押權", "抵押權"];

// Single-character edit distance (insert/delete/substitute) - cheap enough for these
// short (5-7 char) right-type strings. The backend prompt already asks the model to
// self-correct an OCR-dropped-character variant like 「最高限抵押權」(missing 額) back
// to 「最高限額抵押權」, but this normalizes it client-side too as a safety net for
// records extracted before that prompt fix, or on the rare case the model still misses.
function levenshteinAtMostOne(a, b) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < shorter.length && j < longer.length) {
    if (shorter[i] === longer[j]) {
      i++;
      j++;
      continue;
    }
    edits++;
    if (edits > 1) return false;
    if (shorter.length === longer.length) i++;
    j++;
  }
  return true;
}

// debtor_info is stored as a single "分母分之分子" string (e.g. "1分之1"), matching the
// same X分之Y convention used for ownership_numerator/denominator elsewhere in this
// app, but is edited here as two separate number inputs - parse an existing string back
// into {numerator, denominator} to populate them.
function parseDebtorRatio(debtorInfo) {
  const match = (debtorInfo || "").match(/(\d+)\s*分之\s*(\d+)/);
  return match ? { denominator: match[1], numerator: match[2] } : { denominator: "", numerator: "" };
}

// Shared between the wizard's encumbrance rows and the 他項權利部 tab's add/edit form.
function encumbranceRightTypeOptionsHtml(rawType) {
  const closeMatch = ENCUMBRANCE_RIGHT_TYPE_OPTIONS.find((t) => t === rawType || levenshteinAtMostOne(rawType, t));
  const currentType = closeMatch || rawType || "";
  const isKnownType = !!closeMatch;
  return `
    <option value="" ${currentType ? "" : "selected"}>請選擇</option>
    ${ENCUMBRANCE_RIGHT_TYPE_OPTIONS.map(
      (t) => `<option value="${escapeHtml(t)}" ${currentType === t ? "selected" : ""}>${escapeHtml(t)}</option>`
    ).join("")}
    ${currentType && !isKnownType ? `<option value="${escapeHtml(currentType)}" selected>${escapeHtml(currentType)}(AI 辨識,非標準選項)</option>` : ""}
  `;
}

function encumbranceRowHtml(e) {
  const ratio = parseDebtorRatio(e.debtor_info);
  return `
    <div class="field-row">
      <div class="field"><label>登記次序</label><input class="enc-order" value="${escapeHtml(e.registration_order)}" autocomplete="off"></div>
      <div class="field"><label>對應地號</label><input class="enc-parcels" value="${escapeHtml(e.applies_to_parcels)}" autocomplete="off"></div>
    </div>
    <div class="field-row">
      <div class="field">
        <label>權利種類</label>
        <select class="enc-type">${encumbranceRightTypeOptionsHtml(e.right_type || "")}</select>
      </div>
      <div class="field"><label>他項權利人</label><input class="enc-holder" value="${escapeHtml(e.right_holder)}" autocomplete="off"></div>
    </div>
    <div class="field">
      <label>債務額比例</label>
      <div style="display:flex;align-items:center;gap:8px">
        <input class="enc-debtor-num" type="number" value="${escapeHtml(ratio.numerator)}" placeholder="分子" style="width:90px" autocomplete="off">
        <span style="color:var(--text-muted)">分之</span>
        <input class="enc-debtor-den" type="number" value="${escapeHtml(ratio.denominator)}" placeholder="分母" style="width:90px" autocomplete="off">
      </div>
    </div>
    <button type="button" class="btn-link btn-sm remove-wizard-row-btn">刪除此筆</button>`;
}

function renderEncumbranceRows(containerId, list) {
  const wrap = document.getElementById(containerId);
  wrap.innerHTML = list.map((e) => `<div class="record-row wizard-row">${encumbranceRowHtml(e)}</div>`).join("");
  wrap.querySelectorAll(".remove-wizard-row-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => e.target.closest(".wizard-row").remove());
  });
}

function readEncumbranceRows(containerId) {
  return [...document.querySelectorAll(`#${containerId} .wizard-row`)]
    .map((row) => {
      const numerator = row.querySelector(".enc-debtor-num").value.trim();
      const denominator = row.querySelector(".enc-debtor-den").value.trim();
      return {
        registration_order: row.querySelector(".enc-order").value.trim(),
        applies_to_parcels: row.querySelector(".enc-parcels").value.trim(),
        right_type: row.querySelector(".enc-type").value.trim(),
        right_holder: row.querySelector(".enc-holder").value.trim(),
        debtor_info: numerator && denominator ? `${denominator}分之${numerator}` : "",
      };
    })
    .filter((e) => e.right_type || e.right_holder);
}

/* ---- Step 3: 建物標示部 + 建物所有權部(單筆建號編輯) ---- */

// Advances past the building at `idx` to the next building, or straight to the final
// confirm screen once buildings are exhausted (buildings are always reviewed after all
// parcels, so there's no further record type to fall through to here).
function advanceFromBuilding(idx) {
  const d = titleDeedWizard.data;
  titleDeedWizard.buildingSubStep = 0;
  if (idx < d.buildings.length) {
    titleDeedWizard.activeIndex = idx;
    renderWizardStep();
  } else {
    titleDeedWizard.step = 4;
    renderWizardStep();
  }
}

// Same two-sub-step pattern as the parcel editor (see renderWizardStepParcelEditor) -
// 建物標示部 first, 建物所有權部 second - instead of one long combined form, mirroring
// how the deed itself is actually laid out. titleDeedWizard.buildingSubStep (0/1).
function renderWizardStepBuildingEditor() {
  const substeps = [renderBuildingDescriptionSubStep, renderBuildingOwnersSubStep];
  substeps[titleDeedWizard.buildingSubStep || 0](titleDeedWizard.activeIndex);
}

function renderBuildingDescriptionSubStep(idx) {
  const buildings = titleDeedWizard.data.buildings;
  const b = buildings[idx];
  openModal(
    "掃描謄本匯入",
    `
    ${wizardProgressHtml(`建號編輯(第 ${idx + 1} / ${buildings.length} 筆) · 1/2 建物標示部`)}
    <div style="margin-bottom:10px">
      <button type="button" class="btn-secondary btn-sm" id="wizard-rescan-btn">重新上傳這一筆的建物謄本檔案並辨識</button>
    </div>
    <form id="wizard-step-form" autocomplete="off">
      <div class="field-row">
        <div class="field"><label>建號</label><input name="building_number" value="${escapeHtml(b.building_number)}" autocomplete="off"></div>
        <div class="field"><label>建號門牌</label><input name="building_address" value="${escapeHtml(b.building_address)}" autocomplete="off"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>地號</label><input name="parcel_number" value="${escapeHtml(b.parcel_number)}" autocomplete="off"></div>
        <div class="field"><label>層數</label><input name="total_floors" value="${escapeHtml(b.total_floors)}" autocomplete="off"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>層次</label><input name="floor" value="${escapeHtml(b.floor)}" autocomplete="off"></div>
        <div class="field"><label>建物總面積(㎡)</label><input name="total_area_sqm" value="${escapeHtml(b.total_area_sqm)}" type="number" step="0.01" autocomplete="off"></div>
      </div>
      <div class="field"><label>層次面積(㎡)</label><input name="floor_area_sqm" value="${escapeHtml(b.floor_area_sqm)}" type="number" step="0.01" autocomplete="off"></div>
    </form>
    <div class="modal-footer">
      <button type="button" class="btn-secondary" onclick="closeModal()">取消</button>
      <button type="button" class="btn-danger" id="wizard-delete-building-btn">刪除此筆</button>
      ${idx > 0 ? `<button type="button" class="btn-secondary" id="wizard-prev-item-btn">上一筆</button>` : ""}
      <button type="button" class="btn-primary" id="wizard-next-item-btn">下一步:建物所有權部</button>
    </div>`,
    { width: "620px" }
  );

  document.getElementById("wizard-rescan-btn").addEventListener("click", () => {
    openWizardSingleRecordRescan("building", b, () => renderBuildingDescriptionSubStep(idx));
  });

  const saveFields = () => {
    const fd = new FormData(document.getElementById("wizard-step-form"));
    Object.assign(b, {
      building_number: (fd.get("building_number") || "").trim(),
      building_address: (fd.get("building_address") || "").trim(),
      parcel_number: (fd.get("parcel_number") || "").trim(),
      total_floors: (fd.get("total_floors") || "").trim(),
      floor: (fd.get("floor") || "").trim(),
      total_area_sqm: fd.get("total_area_sqm") || "",
      floor_area_sqm: fd.get("floor_area_sqm") || "",
    });
  };

  const prevBtn = document.getElementById("wizard-prev-item-btn");
  if (prevBtn) {
    prevBtn.addEventListener("click", () => {
      saveFields();
      titleDeedWizard.activeIndex = idx - 1;
      titleDeedWizard.buildingSubStep = 1; // land on the previous building's last sub-step
      renderWizardStep();
    });
  }
  document.getElementById("wizard-next-item-btn").addEventListener("click", () => {
    saveFields();
    titleDeedWizard.buildingSubStep = 1;
    renderWizardStep();
  });
  document.getElementById("wizard-delete-building-btn").addEventListener("click", () => {
    buildings.splice(idx, 1);
    advanceFromBuilding(idx);
  });
}

function renderBuildingOwnersSubStep(idx) {
  const buildings = titleDeedWizard.data.buildings;
  const b = buildings[idx];
  const isLast = idx === buildings.length - 1;
  openModal(
    "掃描謄本匯入",
    `
    ${wizardProgressHtml(`建號編輯(第 ${idx + 1} / ${buildings.length} 筆) · 2/2 建物所有權部`)}
    <div class="helper-text" style="margin-bottom:10px">${escapeHtml(buildingSummaryLabel(b))}</div>
    <div id="wizard-building-owners" style="margin:6px 0"></div>
    <button type="button" class="btn-secondary btn-sm" id="wizard-add-building-owner-btn">+ 新增共有人</button>
    <div class="modal-footer">
      <button type="button" class="btn-secondary" onclick="closeModal()">取消</button>
      <button type="button" class="btn-secondary" id="wizard-prev-item-btn">上一步</button>
      <button type="button" class="btn-primary" id="wizard-next-item-btn">${isLast ? "下一步" : "下一筆建號"}</button>
    </div>`,
    { width: "620px" }
  );

  const areaSqm = Number(b.total_area_sqm) || Number(b.floor_area_sqm) || null;
  renderOwnerRowsContainer("wizard-building-owners", b.owners, "bo", areaSqm);

  document.getElementById("wizard-add-building-owner-btn").addEventListener("click", () => {
    b.owners = readOwnerRowsContainer("wizard-building-owners", "bo");
    b.owners.push({ registration_order: "", owner_name: "", ownership_numerator: 1, ownership_denominator: 1, address: "" });
    renderOwnerRowsContainer("wizard-building-owners", b.owners, "bo", areaSqm);
  });

  document.getElementById("wizard-prev-item-btn").addEventListener("click", () => {
    b.owners = readOwnerRowsContainer("wizard-building-owners", "bo");
    titleDeedWizard.buildingSubStep = 0;
    renderWizardStep();
  });
  document.getElementById("wizard-next-item-btn").addEventListener("click", () => {
    b.owners = readOwnerRowsContainer("wizard-building-owners", "bo");
    advanceFromBuilding(idx + 1);
  });
}

/* ---- Step 4: 確認建立 ---- */

function renderWizardStepConfirm() {
  const d = titleDeedWizard.data;
  // A parcel/building's owners collectively own the whole thing - their ownership shares
  // should sum to ~100%. A misread numerator/denominator (a genuine OCR digit error, not
  // the numerator>denominator reversal already auto-corrected server-side) throws that
  // sum off without being individually implausible, so it can't be caught per-owner -
  // this is the cheapest signal that flags exactly the records worth manually checking
  // against the original scan, instead of requiring every single one to be checked.
  const shareSum = (owners) =>
    owners.reduce((sum, o) => sum + (Number(o.ownership_numerator) || 0) / (Number(o.ownership_denominator) || 1), 0);
  const shareSumWarningHtml = (owners) => {
    if (!owners.length) return "";
    const sum = shareSum(owners);
    if (Math.abs(sum - 1) <= 0.05) return "";
    return `<div class="wizard-confirm-card-row" style="color:var(--danger)">⚠ 權利範圍加總為 ${(sum * 100).toFixed(1)}%,明顯偏離 100%,請重點核對這幾位所有權人的權利範圍</div>`;
  };
  const ownerChipsHtml = (owners) =>
    `<div class="wizard-confirm-chip-list">${owners
      .map((o) => `<span class="wizard-confirm-chip">${escapeHtml(o.owner_name) || "-"}(${o.ownership_numerator}/${o.ownership_denominator})</span>`)
      .join("")}</div>`;
  const parcelCardHtml = (p, idx) => `
    <div class="wizard-confirm-card">
      <div class="wizard-confirm-card-row" style="justify-content:space-between;align-items:center">
        <div class="wizard-confirm-card-title">${escapeHtml(parcelSummaryLabel(p))}</div>
        <button type="button" class="btn-link btn-sm" data-jump-parcel="${idx}">編輯</button>
      </div>
      <div class="wizard-confirm-card-row">
        <span class="wizard-confirm-card-label">所有權人</span>
        ${ownerChipsHtml(p.owners)}
      </div>
      ${shareSumWarningHtml(p.owners)}
      ${
        (p.encumbrances || []).length
          ? `<div class="wizard-confirm-card-row">
              <span class="wizard-confirm-card-label">他項權利</span>
              <div class="wizard-confirm-chip-list">${(p.encumbrances || []).map((e) => `<span class="wizard-confirm-chip encumbrance">${escapeHtml(e.right_type) || "-"} · ${escapeHtml(e.right_holder) || "-"}</span>`).join("")}</div>
            </div>`
          : ""
      }
    </div>`;
  const parcelsHtml = d.parcels.length
    ? d.parcels.map(parcelCardHtml).join("")
    : `<div class="helper-text" style="margin-top:8px">(本次未包含土地資料)</div>`;
  const buildingsSectionHtml = d.buildings.length
    ? `<div class="wizard-confirm-section-title">建物建號(${d.buildings.length})</div>
      ${d.buildings
        .map(
          (b, idx) => `
        <div class="wizard-confirm-card">
          <div class="wizard-confirm-card-row" style="justify-content:space-between;align-items:center">
            <div class="wizard-confirm-card-title">${escapeHtml(buildingSummaryLabel(b))}</div>
            <button type="button" class="btn-link btn-sm" data-jump-building="${idx}">編輯</button>
          </div>
          <div class="wizard-confirm-card-row">
            <span class="wizard-confirm-card-label">所有權人</span>
            ${ownerChipsHtml(b.owners)}
          </div>
          ${shareSumWarningHtml(b.owners)}
        </div>`
        )
        .join("")}`
    : "";

  // Land↔building relation preview: same matching rule the actual submit step uses
  // (parcel_number match, see submitTitleDeedWizard) but computed here purely for
  // display before anything is created, so the user can see which buildings will link
  // to which parcel before committing.
  const relationRowsHtml = d.parcels
    .map((p) => {
      const linkedBuildings = d.buildings.filter((b) => b.parcel_number && b.parcel_number === p.parcel_number);
      if (!linkedBuildings.length) return "";
      return `
        <div class="wizard-relation-row">
          <div class="wizard-relation-card">
            <div class="wizard-relation-card-title">📍 地號 ${escapeHtml(p.parcel_number) || "-"}</div>
            <div class="wizard-relation-card-sub">${escapeHtml(parcelSummaryLabel(p))}</div>
          </div>
          <div class="wizard-relation-arrow">→</div>
          <div class="wizard-relation-card">
            <div class="wizard-relation-card-title">🏢 建號 ${linkedBuildings.length} 筆</div>
            <div class="wizard-relation-card-sub">${linkedBuildings.map((b) => escapeHtml(b.building_number) || "-").join("、")}</div>
          </div>
        </div>`;
    })
    .join("");
  const relationSectionHtml = relationRowsHtml
    ? `<div class="wizard-confirm-section-title">地號 → 建號 關聯預覽</div>${relationRowsHtml}`
    : "";

  openModal(
    "掃描謄本匯入",
    `
    ${wizardProgressHtml("確認建立")}
    <div class="final-banner warning" style="margin-bottom:16px">⚠️ 建立前最後確認：以下姓名、地址、面積等內容為 AI 辨識結果，可能有誤或臆測，請務必逐筆對照原始掃描件</div>
    ${relationSectionHtml}
    <div class="wizard-confirm-section-title">土地地號(${d.parcels.length})</div>
    ${parcelsHtml}
    ${buildingsSectionHtml}
    ${
      d.encumbrances.length
        ? `<div class="wizard-confirm-section-title">跨地號/建號的他項權利(${d.encumbrances.length})</div>
          <div class="wizard-confirm-card">
            <div class="wizard-confirm-chip-list">
              ${d.encumbrances.map((e) => `<span class="wizard-confirm-chip encumbrance">${escapeHtml(e.right_type) || "-"} · ${escapeHtml(e.right_holder) || "-"}</span>`).join("")}
            </div>
          </div>`
        : ""
    }
    <div class="helper-text" style="margin-top:14px;line-height:1.6">確認無誤後點「建立」，系統會自動比對／建立地主，並寫入土地、建物、他項權利資料。同一人若出現在多筆地號／建號，只會建立一筆地主。</div>
    <div class="modal-footer">
      <button type="button" class="btn-secondary" id="wizard-prev-btn">上一步</button>
      <button type="button" class="btn-primary" id="wizard-confirm-btn">建立</button>
    </div>`,
    { width: "620px" }
  );

  document.getElementById("wizard-prev-btn").addEventListener("click", () => {
    // No standalone "他項權利部" step to go back to any more - land back on whichever
    // record was reviewed last (its last sub-step, for a parcel).
    const d = titleDeedWizard.data;
    if (d.buildings.length) {
      titleDeedWizard.activeType = "building";
      titleDeedWizard.activeIndex = d.buildings.length - 1;
      titleDeedWizard.buildingSubStep = 1;
      titleDeedWizard.step = 3;
    } else if (d.parcels.length) {
      titleDeedWizard.activeType = "parcel";
      titleDeedWizard.activeIndex = d.parcels.length - 1;
      titleDeedWizard.parcelSubStep = 2;
      titleDeedWizard.step = 2;
    } else {
      closeModal();
      return;
    }
    renderWizardStep();
  });
  document.getElementById("wizard-confirm-btn").addEventListener("click", submitTitleDeedWizard);
  document.querySelectorAll("[data-jump-parcel]").forEach((btn) => {
    btn.addEventListener("click", () => jumpToWizardRecordOwners("parcel", Number(btn.dataset.jumpParcel)));
  });
  document.querySelectorAll("[data-jump-building]").forEach((btn) => {
    btn.addEventListener("click", () => jumpToWizardRecordOwners("building", Number(btn.dataset.jumpBuilding)));
  });
}

// matchRecordType ("land" | "building") restricts which existing landowners this is
// allowed to match/reuse against - only ones that already have at least one record of
// that same type. Without this, importing a building deed would happily match (and
// silently merge into) a landowner who so far only has land records, purely because
// the name happened to match - surprising when the two deeds are unrelated imports the
// user never intended to link. Matching only within the same record type still lets a
// second import of the *same* type (e.g. re-running the building wizard) correctly
// dedupe against a building owner it already created, without ever reaching across into
// the other type's owners. Cross-references some of the same real person may still
// exist across imports, but that's now something the user does explicitly (e.g. editing
// a landowner to add a land_record_id link on a building_record) rather than an
// automatic side effect of the wizard.
async function findOrCreateLandownerByOwner(owner, createdCache, matchRecordType) {
  const pid = state.currentProjectId;
  const idKey = (owner.id_number || "").trim();
  const nameKey = owner.owner_name.trim();
  const cacheKey = idKey || `name:${nameKey}`;
  if (createdCache.has(cacheKey)) return createdCache.get(cacheKey);

  const existingList = state.projectCache[pid].landowners;
  const candidates = matchRecordType
    ? existingList.filter((o) => (matchRecordType === "land" ? o.land_records : o.building_records || []).length > 0)
    : existingList;
  let existing = null;
  if (idKey) existing = candidates.find((o) => o.id_number && o.id_number === idKey);
  if (!existing) existing = candidates.find((o) => o.name === nameKey);

  let landownerId;
  if (existing) {
    landownerId = existing.id;
  } else {
    const created = await api(`/projects/${pid}/landowners`, {
      method: "POST",
      body: {
        name: nameKey,
        id_number: idKey || null,
        address: owner.address || null,
        land_records: [],
        building_records: [],
      },
    });
    landownerId = created.id;
    existingList.push(created);
  }
  createdCache.set(cacheKey, landownerId);
  return landownerId;
}

async function submitTitleDeedWizard() {
  const d = titleDeedWizard.data;

  const badParcelIndex = d.parcels.findIndex((p) => p.owners.some((o) => o.owner_name) && !p.parcel_number);
  if (badParcelIndex !== -1) {
    toast(`第 ${badParcelIndex + 1} 筆地號缺少地號欄位,請返回編輯`, "error");
    titleDeedWizard.activeType = "parcel";
    titleDeedWizard.activeIndex = badParcelIndex;
    titleDeedWizard.step = 2;
    renderWizardStep();
    return;
  }

  const btn = document.getElementById("wizard-confirm-btn");
  btn.disabled = true;
  btn.textContent = "建立中...";
  const pid = state.currentProjectId;
  const createdCache = new Map();
  // Links a building record to the land record for the SAME owner on the matching
  // 地號 (building.parcel_number), so 建物標示部's "地號" field isn't just descriptive
  // text - it actually connects the two records in the data model.
  const landRecordIdByParcelOwner = new Map();
  // Keyed by the real person's identity (id_number, falling back to name), NOT
  // landowner_id - a land-only import and a building-only import intentionally create
  // SEPARATE landowner rows for the same real person (see findOrCreateLandownerByOwner's
  // matchRecordType, to avoid surprise auto-merging), so keying on landowner_id here
  // would never match across the two imports even though it's the same person on the
  // same 地號. Keying on identity instead lets a building-only import correctly link
  // against land records an earlier land-only import already created.
  const ownerIdentityKey = (owner) => (owner.id_number || "").trim() || `name:${(owner.owner_name || owner.name || "").trim()}`;
  const parcelOwnerKey = (parcelNumber, identityKey) => `${(parcelNumber || "").trim()}::${identityKey}`;
  // The OcrJob (see runTitleDeedOcr) that contributed the created land/building
  // records, so the user can be sent to that batch's detail page after submit (see
  // view-ocr-batch).
  const sourceOcrJobIds = new Set();

  try {
    if (!state.projectCache[pid]) state.projectCache[pid] = {};
    if (!state.projectCache[pid].landowners) {
      state.projectCache[pid].landowners = await api(`/projects/${pid}/landowners`);
    }

    // Seed from land records that already exist in the project (e.g. from an earlier
    // wizard run that only scanned the 土地謄本) - otherwise a building-only run today
    // would never find a match, since it'd only ever look at parcels created in this
    // same submission.
    for (const owner of state.projectCache[pid].landowners) {
      for (const lr of owner.land_records || []) {
        landRecordIdByParcelOwner.set(parcelOwnerKey(lr.parcel_number, ownerIdentityKey(owner)), lr.id);
      }
    }

    for (const p of d.parcels) {
      for (const owner of p.owners) {
        if (!owner.owner_name) continue;
        const landownerId = await findOrCreateLandownerByOwner(owner, createdCache, "land");
        const created = await api(`/projects/${pid}/landowners/${landownerId}/land-records`, {
          method: "POST",
          body: {
            parcel_number: p.parcel_number,
            township: p.township || null,
            section: p.section || null,
            subsection: p.subsection || null,
            registration_order: owner.registration_order || null,
            total_area_sqm: Number(p.area_sqm) || 0,
            ownership_numerator: owner.ownership_numerator || 1,
            ownership_denominator: owner.ownership_denominator || 1,
            source_ocr_job_id: p._sourceOcrJobId || null,
          },
        });
        if (p._sourceOcrJobId) sourceOcrJobIds.add(p._sourceOcrJobId);
        landRecordIdByParcelOwner.set(parcelOwnerKey(p.parcel_number, ownerIdentityKey(owner)), created.id);
      }
      // This 地號's own 他項權利部, reviewed alongside it in the wizard - submitted the
      // same way as the cross-parcel ones below (encumbrances are project-level, not
      // tied to a specific land_record_id in the data model either way).
      for (const enc of p.encumbrances || []) {
        if (!enc.right_type && !enc.right_holder) continue;
        await api(`/projects/${pid}/encumbrances`, { method: "POST", body: enc });
      }
    }

    for (const enc of d.encumbrances) {
      if (!enc.right_type && !enc.right_holder) continue;
      await api(`/projects/${pid}/encumbrances`, { method: "POST", body: enc });
    }

    for (const b of d.buildings) {
      const floorAreaSqm = Number(b.total_area_sqm) || Number(b.floor_area_sqm) || 0;
      for (const owner of b.owners) {
        if (!owner.owner_name) continue;
        const landownerId = await findOrCreateLandownerByOwner(owner, createdCache, "building");
        await api(`/projects/${pid}/landowners/${landownerId}/building-records`, {
          method: "POST",
          body: {
            land_record_id: landRecordIdByParcelOwner.get(parcelOwnerKey(b.parcel_number, ownerIdentityKey(owner))) || null,
            building_number: b.building_number || null,
            address: b.building_address || null,
            floor: b.floor || null,
            total_floors: b.total_floors || null,
            registration_order: owner.registration_order || null,
            structure_area_sqm: floorAreaSqm,
            auxiliary_area_sqm: 0,
            common_area_sqm: 0,
            ownership_numerator: owner.ownership_numerator || 1,
            ownership_denominator: owner.ownership_denominator || 1,
            source_ocr_job_id: b._sourceOcrJobId || null,
          },
        });
        if (b._sourceOcrJobId) sourceOcrJobIds.add(b._sourceOcrJobId);
      }
    }

    const hadParcels = d.parcels.length > 0;
    closeModal();
    toast("謄本資料已匯入", "success");
    titleDeedWizard = null;
    await renderTab(state.activeTab);
    // A manually-grouped import can span several OcrJobs (one per group) - there's no
    // single batch page to land on in that case, so fall back to just staying on the
    // project tab. The common case (single-shot upload, or one manual group) has exactly
    // one job, which is what actually has something to show on view-ocr-batch.
    if (sourceOcrJobIds.size === 1) {
      await goToOcrBatch([...sourceOcrJobIds][0]);
      return;
    }
    // Building records link back to a land record by matching parcel_number (see
    // landRecordIdByParcelOwner above) - offering to continue straight into a
    // building-deed upload right after land data lands makes that linking "just work"
    // without the user having to remember to come back and run the wizard a second time.
    if (hadParcels) offerBuildingImportFollowUp();
  } catch (err) {
    btn.disabled = false;
    btn.textContent = "建立";
  }
}

function offerBuildingImportFollowUp() {
  openModal(
    "匯入建物謄本",
    `
    <p style="margin-top:0">地號資料已匯入完成。要不要現在就上傳這個案件的建物謄本？建物的「地號」欄位會自動比對剛剛匯入的地號資料。</p>
    <div class="modal-footer">
      <button type="button" class="btn-secondary" onclick="closeModal()">稍後再說</button>
      <button type="button" class="btn-primary" id="start-building-import-btn">立即匯入建物謄本</button>
    </div>`,
    { width: "480px" }
  );
  document.getElementById("start-building-import-btn").addEventListener("click", async () => {
    // Switch the tab underneath to 建物登記 before opening the wizard, so whichever tab
    // was showing when the land import finished (usually 土地登記, since that's what
    // triggered this follow-up) isn't what's left behind once the wizard modal closes.
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === "buildings"));
    state.activeTab = "buildings";
    await renderTab("buildings");
    openBuildingTitleDeedWizard();
  });
}

/* ================= OCR import batch detail (view-ocr-batch) ================= */

// One 謄本匯入批次 = one OcrJob (see backend/models/ocr.py docstring: "one job = one
// 謄本, which may span several scanned pages/files"). Fetched fresh every visit rather
// than cached, since land_records/building_records created against it can keep changing
// after the fact (edited/deleted from the normal 土地登記/建物登記 tabs).
let currentOcrBatch = null;
let activeBatchTab = "overview";

async function goToOcrBatch(jobId) {
  setActiveSidebarCase(state.currentProjectId);
  showView("view-ocr-batch");
  document.getElementById("batch-name").textContent = "載入中...";
  document.getElementById("batch-sub").textContent = "";
  document.getElementById("batch-status-badge").innerHTML = "";
  document.getElementById("batch-pipeline").innerHTML = "";
  document.getElementById("batch-tab-content").innerHTML = "";

  try {
    currentOcrBatch = await api(`/projects/${state.currentProjectId}/ocr-jobs/${jobId}`);
  } catch (err) {
    goToDashboard();
    return;
  }

  const project = state.currentProject;
  document.getElementById("batch-name").textContent = `${project ? project.name + " · " : ""}謄本匯入批次 #${jobId}`;
  document.getElementById("batch-sub").textContent = `建立於 ${fmtDateTime(currentOcrBatch.job.created_at)}`;
  renderBatchStatusBadge();
  renderBatchPipeline();

  activeBatchTab = "overview";
  document.querySelectorAll("#view-ocr-batch .tab-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.batchTab === activeBatchTab);
    btn.onclick = () => {
      activeBatchTab = btn.dataset.batchTab;
      document.querySelectorAll("#view-ocr-batch .tab-btn").forEach((b) => b.classList.toggle("active", b === btn));
      renderBatchTab();
    };
  });
  renderBatchTab();
}

document.getElementById("back-to-project-from-batch").addEventListener("click", () => {
  if (state.currentProjectId) openProject(state.currentProjectId);
  else goToDashboard();
});

const OCR_JOB_STATUS_LABEL = { pending: "等待中", processing: "辨識中", completed: "已完成", failed: "失敗" };

function renderBatchStatusBadge() {
  const { status } = currentOcrBatch.job;
  const cls = status === "completed" ? "status-active" : status === "failed" ? "status-suspended" : "status-closed";
  document.getElementById("batch-status-badge").innerHTML =
    `<span class="status-badge ${cls}">${OCR_JOB_STATUS_LABEL[status] || status}</span>`;
}

// Derives the 5-step pipeline shown on the reference design purely from signals the
// backend already exposes (job.status, whether an OcrMatchResult/extracted_data exists,
// and whether any land/building records have actually been linked back to this job) -
// deliberately not adding a new "pipeline_stage" column, since these three existing
// signals are already enough to place the job on one of the 5 steps honestly.
function renderBatchPipeline() {
  const { job, extracted_data, land_records, building_records, documents } = currentOcrBatch;
  const hasExtraction = !!extracted_data;
  const hasLinkedRecords = land_records.length > 0 || building_records.length > 0;
  const steps = [
    {
      label: "上傳原始謄本",
      sub: `${documents.length} 個檔案/頁面`,
      state: documents.length ? "done" : "active",
    },
    {
      label: "OCR 辨識",
      sub: job.status === "failed" ? job.error_message || "辨識失敗" : hasExtraction ? "已完成擷取" : "辨識中",
      state: job.status === "failed" ? "failed" : hasExtraction ? "done" : "active",
    },
    {
      label: "地號 / 建號抽取",
      sub: hasExtraction
        ? `候選 ${(extracted_data.land_parcels || []).length} 筆地號、${(extracted_data.buildings || []).length} 筆建號`
        : "尚未擷取",
      state: hasExtraction ? "done" : job.status === "failed" ? "failed" : "",
    },
    {
      label: "人工核對",
      sub: hasLinkedRecords ? "已核對並建立資料" : hasExtraction ? "待逐筆核對(於匯入精靈中勾選「已核對」)" : "尚未開始",
      state: hasLinkedRecords ? "done" : hasExtraction ? "active" : "",
    },
    {
      label: "建立地號 ↔ 建號關聯",
      sub: hasLinkedRecords
        ? `已建立 ${land_records.length} 筆地號、${building_records.length} 筆建號`
        : "完成核對後自動寫入資料庫",
      state: hasLinkedRecords ? "done" : "",
    },
  ];
  document.getElementById("batch-pipeline").innerHTML = steps
    .map((s, i) => {
      const icon = s.state === "done" ? "✓" : s.state === "failed" ? "✕" : i + 1;
      return `
        <div class="batch-step ${s.state}">
          <div class="dot">${icon}</div>
          <div>
            <div class="batch-step-label">${escapeHtml(s.label)}</div>
            <div class="batch-step-sub">${escapeHtml(s.sub)}</div>
          </div>
        </div>`;
    })
    .join("");
}

function renderBatchTab() {
  const el = document.getElementById("batch-tab-content");
  const renderers = {
    overview: renderBatchOverviewTab,
    parcels: renderBatchParcelsTab,
    buildings: renderBatchBuildingsTab,
    relations: renderBatchRelationsTab,
    ocrai: renderBatchOcrAiTab,
    documents: renderBatchDocumentsTab,
    timeline: renderBatchTimelineTab,
  };
  el.innerHTML = (renderers[activeBatchTab] || renderBatchOverviewTab)();
  el.querySelectorAll("[data-batch-doc-index]").forEach((row) => {
    row.addEventListener("click", () => {
      const doc = currentOcrBatch.documents[Number(row.dataset.batchDocIndex)];
      downloadDocument(doc.document.id, doc.document.file_name);
    });
  });
}

function renderBatchOverviewTab() {
  const { job, documents, extracted_data, land_records, building_records } = currentOcrBatch;
  return `
    <div class="card">
      <div class="batch-kv"><label>批次編號</label><span>#${job.id}</span></div>
      <div class="batch-kv"><label>狀態</label><span>${OCR_JOB_STATUS_LABEL[job.status] || job.status}</span></div>
      <div class="batch-kv"><label>來源檔案數</label><span>${documents.length}</span></div>
      <div class="batch-kv"><label>地號候選</label><span>${(extracted_data?.land_parcels || []).length} 筆(已建立 ${land_records.length} 筆)</span></div>
      <div class="batch-kv"><label>建號候選</label><span>${(extracted_data?.buildings || []).length} 筆(已建立 ${building_records.length} 筆)</span></div>
      <div class="batch-kv"><label>建立時間</label><span>${fmtDateTime(job.created_at)}</span></div>
      <div class="batch-kv"><label>開始時間</label><span>${job.started_at ? fmtDateTime(job.started_at) : "-"}</span></div>
      <div class="batch-kv"><label>完成時間</label><span>${job.completed_at ? fmtDateTime(job.completed_at) : "-"}</span></div>
      ${job.error_message ? `<div class="batch-kv"><label>訊息</label><span style="color:var(--danger)">${escapeHtml(job.error_message)}</span></div>` : ""}
    </div>`;
}

function renderBatchParcelsTab() {
  const { land_records } = currentOcrBatch;
  if (!land_records.length) return `<div class="empty-state">這個批次還沒有已建立的地號資料</div>`;
  return `
    <div class="table-wrap"><table><thead><tr>
      <th>地號</th><th>地段/小段</th><th>面積(㎡)</th><th>持分</th><th>持分面積(㎡)</th>
    </tr></thead><tbody>
      ${land_records
        .map(
          (r) => `
        <tr>
          <td>${escapeHtml(r.parcel_number)}</td>
          <td>${escapeHtml([r.township, r.section, r.subsection].filter(Boolean).join(""))}</td>
          <td>${r.total_area_sqm}</td>
          <td>${r.ownership_numerator}/${r.ownership_denominator}</td>
          <td>${r.owned_area_sqm ?? "-"}</td>
        </tr>`
        )
        .join("")}
    </tbody></table></div>`;
}

function renderBatchBuildingsTab() {
  const { building_records } = currentOcrBatch;
  if (!building_records.length) return `<div class="empty-state">這個批次還沒有已建立的建號資料</div>`;
  return `
    <div class="table-wrap"><table><thead><tr>
      <th>建號</th><th>門牌</th><th>層次</th><th>總面積(㎡)</th><th>持分</th>
    </tr></thead><tbody>
      ${building_records
        .map(
          (r) => `
        <tr>
          <td>${escapeHtml(r.building_number) || "-"}</td>
          <td>${escapeHtml(r.address) || "-"}</td>
          <td>${escapeHtml(r.floor) || "-"}</td>
          <td>${r.total_area_sqm}</td>
          <td>${r.ownership_numerator}/${r.ownership_denominator}</td>
        </tr>`
        )
        .join("")}
    </tbody></table></div>`;
}

// Shared between the OCR batch page's 「關聯」分頁 (scoped to one import batch's
// land_records/building_records) and the project detail page's 「關聯」分頁 (scoped to
// every land_record/building_record the case has, regardless of which batch - or manual
// entry - created them).
function relationBlocksHtml(land_records, building_records, emptyMessage) {
  const rows = land_records
    .map((lr) => {
      const linked = building_records.filter((br) => br.land_record_id === lr.id);
      if (!linked.length) return "";
      const avgArea = linked.reduce((sum, b) => sum + (Number(b.total_area_sqm) || 0), 0) / linked.length;
      return `
        <div class="batch-relation-block">
          <div>
            <span class="batch-relation-pill land">土地</span>
            <div class="batch-relation-title land-title">${escapeHtml(lr.parcel_number)}</div>
            <div class="batch-relation-sub">面積 ${lr.total_area_sqm}㎡</div>
            <div class="batch-relation-list">
              ${linked.map((b) => `<div class="batch-relation-list-item tree">└ ${escapeHtml(b.building_number) || "-"}</div>`).join("")}
            </div>
          </div>
          <div class="batch-relation-connector">↔</div>
          <div>
            <span class="batch-relation-pill building">建物</span>
            <div class="batch-relation-title">${linked.length} 筆</div>
            <div class="batch-relation-sub">每筆總面積 ${avgArea.toFixed(2)}㎡</div>
            <div class="batch-relation-list">
              ${linked.map((b) => `<div class="batch-relation-list-item">${escapeHtml(b.building_number) || "-"}${b.floor ? ` · ${escapeHtml(b.floor)}` : ""}</div>`).join("")}
            </div>
          </div>
        </div>`;
    })
    .join("");
  const unlinkedBuildings = building_records.filter((br) => !br.land_record_id);
  return (
    (rows || `<div class="empty-state">${emptyMessage}</div>`) +
    (unlinkedBuildings.length
      ? `<div class="helper-text" style="margin-top:12px">⚠ ${unlinkedBuildings.length} 筆建號尚未連結任何地號:${unlinkedBuildings.map((b) => escapeHtml(b.building_number) || "-").join("、")}</div>`
      : "")
  );
}

function renderBatchRelationsTab() {
  const { land_records, building_records } = currentOcrBatch;
  return relationBlocksHtml(land_records, building_records, "這個批次還沒有已建立的地號↔建號關聯");
}

// Project detail page's 「關聯」分頁 - pulls every landowner's land/building records
// (not scoped to one OCR batch, since a case's records can come from several import
// batches or manual entry over time) and shows the same 地號↔建號關聯圖 as the batch
// page, just case-wide.
async function renderRelationsTab(el) {
  const pid = state.currentProjectId;
  const allLandowners = await api(`/projects/${pid}/landowners`);
  state.projectCache[pid].landowners = allLandowners;
  const land_records = allLandowners.flatMap((o) => o.land_records || []);
  const building_records = allLandowners.flatMap((o) => o.building_records || []);
  el.innerHTML = `
    <div class="section-toolbar">
      <h3>地號 ↔ 建號關聯圖</h3>
    </div>
    ${relationBlocksHtml(land_records, building_records, "這個案件還沒有已建立的地號↔建號關聯")}
  `;
}

function renderBatchOcrAiTab() {
  const { extracted_data } = currentOcrBatch;
  if (!extracted_data) return `<div class="empty-state">尚無 OCR 擷取結果</div>`;
  // Raw extracted fields only - no fabricated confidence scores (see the wizard's
  // "已核對" checkbox for the real human-verification signal, which is per land_record/
  // building_record, not surfaced here since this tab only has the raw OCR JSON).
  return `
    <div class="helper-text" style="margin-bottom:10px">以下為這次 OCR 擷取的原始結果(送出匯入精靈前的候選資料,非最終已建立的資料)</div>
    <pre style="background:var(--surface-2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:14px;overflow-x:auto;font-size:12px;line-height:1.6">${escapeHtml(JSON.stringify(extracted_data, null, 2))}</pre>`;
}

function renderBatchDocumentsTab() {
  const { documents } = currentOcrBatch;
  if (!documents.length) return `<div class="empty-state">這個批次沒有來源檔案</div>`;
  return `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px">
      ${documents
        .map(
          (jd, i) => `
        <div class="record-row" data-batch-doc-index="${i}" style="padding:8px;text-align:center;cursor:pointer">
          ${
            (jd.document.mime_type || "").startsWith("image/")
              ? `<div style="height:110px;overflow:hidden;border-radius:4px;border:1px solid var(--border);display:flex;align-items:center;justify-content:center;background:var(--surface-2)">
                  <span style="font-size:24px">📄</span>
                </div>`
              : `<div style="height:110px;display:flex;align-items:center;justify-content:center;background:var(--surface-2);border-radius:4px;border:1px solid var(--border)"><span style="font-size:24px">📄</span></div>`
          }
          <div class="helper-text" style="margin-top:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(jd.document.file_name)}">${escapeHtml(jd.document.file_name)}</div>
        </div>`
        )
        .join("")}
    </div>`;
}

// Real timeline built from actual timestamps this job has (created/started/completed),
// not a fabricated activity log - see plan notes: no general audit-log table exists yet,
// so this deliberately doesn't invent per-field "AI 校正"/"人工確認" events that aren't
// tracked anywhere.
function renderBatchTimelineTab() {
  const { job, documents } = currentOcrBatch;
  const events = [];
  if (job.created_at) events.push({ at: job.created_at, text: `建立匯入批次,含 ${documents.length} 個來源檔案` });
  if (job.started_at) events.push({ at: job.started_at, text: "開始 OCR 辨識" });
  if (job.completed_at) {
    events.push({
      at: job.completed_at,
      text: job.status === "failed" ? `辨識失敗:${job.error_message || ""}` : "OCR 辨識完成",
    });
  }
  events.sort((a, b) => new Date(a.at) - new Date(b.at));
  if (!events.length) return `<div class="empty-state">尚無紀錄</div>`;
  return `
    <div class="card">
      ${events
        .map(
          (e) => `
        <div class="batch-kv"><label>${fmtDateTime(e.at)}</label><span>${escapeHtml(e.text)}</span></div>`
        )
        .join("")}
    </div>`;
}

/* ================= Tab: SOP ================= */

const DUAL_GATE_STAGES = [4, 8, 9];

// Cosmetic-only relabeling for the SOP screen - the backend's own stage names
// (source of truth, e.g. "初始核定立案", "聯絡率>95%") stay exactly as stored/returned
// by the API; this just swaps in friendlier display wording for the same 10 stages
// without touching any backend data or migrating existing projects' stored stage JSON.
const SOP_STAGE_DISPLAY_NAMES = {
  0: "案件初始設定",
  1: "申請第三類謄本",
  2: "住戶聯絡達95%",
  3: "第一次說明會",
  4: "意願書達80%",
  5: "上傳顧問文件",
  6: "第二次說明會",
  7: "第三次說明會",
  8: "第四次說明會(簽約)",
  9: "簽約達80%",
};
function sopStageLabel(stageKey, stage) {
  return SOP_STAGE_DISPLAY_NAMES[Number(stageKey)] || stage.name.split(":")[1] || stage.name;
}

// Per-stage checklists, all backed by real data - no stage here shows a fabricated
// per-item status. Item kinds:
//   - docType: done when a document of that doc_type has been uploaded to this project
//   - countOf "land"/"building": done when >=1 land_record/building_record exists; shows
//     a real count ("共 N 筆"), not the reference mockup's "8/14份" target-based format,
//     since this system has no field for how many parcels/buildings a case is expected
//     to have.
//   - contactRate: done when >= the real 95% contact-rate gate (same threshold the
//     backend itself uses to auto-advance stage 2 - see CONTACT_RATE_THRESHOLD in
//     routers/sop.py), computed from actual landowner.contact_status values.
//   - manual: a real staff confirmation, durably stored via POST /sop/{stage}/checklist
//     (not inferred from any other data - e.g. a document existing doesn't mean a human
//     actually reviewed it).
// Stages 4/8/9 (dual-gate) intentionally have no checklist here - their real breakdown
// (headcount/land-share % bars + per-landowner consent table) already renders via
// renderConsentPanel, which is a more detailed real view than a 2-line checklist would
// be. 第0關's checklist also deliberately omits "樓棟視圖基礎設定" from the reference
// mockup this was modeled on - this app has no building-layout-view feature to check
// that against.
// Mirrors backend's CONTACT_RATE_THRESHOLD in routers/sop.py (the real gate that
// auto-advances stage 2) - not a separately-chosen frontend value.
const CONTACT_RATE_THRESHOLD = 0.95;

const SOP_STAGE_CHECKLISTS = {
  0: [
    { key: "basic_info", label: "案件基本資料建立", sub: "名稱、地址、基地範圍" },
    { key: "dev_letter_template", label: "上傳開發信", docType: "dev_letter_template" },
    { key: "willingness_form_template", label: "上傳意願書", docType: "willingness_form_template" },
    { key: "consent_form_template", label: "上傳同意書", docType: "consent_form_template" },
    { key: "contract_template", label: "上傳合約", docType: "contract_template" },
  ],
  1: [
    { key: "cadastral_map", label: "上傳地籍圖", docType: "cadastral_map" },
    { key: "land_deed", label: "上傳土地謄本PDF", countOf: "land" },
    { key: "building_deed", label: "上傳建物謄本PDF", countOf: "building" },
    { key: "landowner_roster_confirmed", label: "確認地主清冊正確", manual: true },
  ],
  2: [
    { key: "contact_info_established", label: "地主聯絡方式建立", countOf: "landowner_with_phone" },
    { key: "contact_rate_95", label: "達到95%聯絡門檻", contactRate: true },
  ],
  3: [
    { key: "briefing_material", label: "上傳說明會簡報", docType: "briefing_material" },
    { key: "briefing_reviewed_3", label: "主管審核通過", manual: true },
  ],
  5: [
    { key: "consultant_document", label: "上傳顧問文件", docType: "consultant_document" },
    { key: "consultant_reviewed", label: "主管審核通過", manual: true },
  ],
  6: [
    { key: "briefing_material", label: "上傳說明會簡報", docType: "briefing_material" },
    { key: "briefing_reviewed_6", label: "主管審核通過", manual: true },
  ],
  7: [
    { key: "briefing_material", label: "上傳說明會簡報", docType: "briefing_material" },
    { key: "briefing_reviewed_7", label: "主管審核通過", manual: true },
  ],
};

// Compact "進度 X/9" bar that always shows above the tab bar, regardless of which tab
// is active - the full interactive breakdown (per-stage status, complete/force-complete
// buttons, dual-gate consent panel) lives in the dedicated "SOP 進度" tab (see
// renderSopTab) since it needs real screen space and isn't something you need visible
// while working in, say, 土地登記.
async function renderSopSummary() {
  const el = document.getElementById("pd-sop-summary");
  const pid = state.currentProjectId;
  const sop = await api(`/projects/${pid}/sop`);
  state.projectCache[pid].sop = sop;

  const stageKeys = Object.keys(sop.stages).sort((a, b) => Number(a) - Number(b));
  const maxStage = Math.max(...stageKeys.map(Number));
  const isFinished = sop.final.status !== "pending";
  const progressNum = isFinished ? maxStage : sop.current_stage;

  let finalBanner = "";
  if (sop.final.status === "completed") {
    finalBanner = `<div class="final-banner">✓ 案件已 100% 同意結案${sop.final.closed_at ? "(" + fmtDateTime(sop.final.closed_at) + ")" : ""}</div>`;
  } else if (sop.final.status === "force_closed") {
    finalBanner = `<div class="final-banner warning">案件已由主管強制結案${sop.final.reason ? ":" + escapeHtml(sop.final.reason) : ""}</div>`;
  }

  const currentStageObj = sop.stages[String(sop.current_stage)];
  const currentLabel = isFinished
    ? "已結案"
    : currentStageObj
      ? `第${sop.current_stage}關・${sopStageLabel(sop.current_stage, currentStageObj)}`
      : "";

  // Lives up in the case title header (next to the status badge), not down here with
  // the progress bar - it acts on the whole case, not on any one stage, so it reads
  // better sitting alongside the case's own status.
  document.getElementById("pd-header-actions").innerHTML =
    isManager() && !isFinished ? `<button class="btn-danger btn-sm" id="force-close-project-btn">強制結案</button>` : "";

  el.innerHTML = `
    ${finalBanner}
    <div class="sop-progress-bar">
      <span class="sop-progress-num">進度 ${progressNum}/${maxStage}</span>
      <div class="progress-bar-track" style="flex:1"><div class="progress-bar-fill" style="width:${((progressNum / maxStage) * 100).toFixed(0)}%"></div></div>
      <span class="sop-progress-current">${escapeHtml(currentLabel)}</span>
    </div>
  `;

  const forceCloseBtn = document.getElementById("force-close-project-btn");
  if (forceCloseBtn) {
    forceCloseBtn.addEventListener("click", async () => {
      const reason = prompt("請輸入強制結案原因:");
      if (reason === null) return;
      try {
        await api(`/projects/${pid}/sop/force-close`, { method: "POST", body: { force: true, reason } });
        toast("案件已強制結案", "success");
        await loadDashboard();
        await renderSopSummary();
        if (state.activeTab === "sop") renderTab("sop");
      } catch (err) {}
    });
  }
}

// The "SOP 進度" tab: a left-hand list of every stage (checkmark if done, highlighted
// ring if it's the case's current stage, greyed "未解鎖" for anything further along
// than the current stage - no per-stage sub-checklist here since the backend doesn't
// track anything at that granularity, only stage-level status), and a right-hand detail
// card for whichever stage is selected. Only the case's actual current stage gets the
// complete/force-complete actions and (for dual-gate stages) the real consent-ratio
// panel; clicking any other stage in the list just shows its status, it's a read-only
// look back/ahead, not a way to jump the case's real progress around.
async function renderSopTab(el) {
  const pid = state.currentProjectId;
  const sop = await api(`/projects/${pid}/sop`);
  state.projectCache[pid].sop = sop;

  const stageKeys = Object.keys(sop.stages).sort((a, b) => Number(a) - Number(b));
  const isFinished = sop.final.status !== "pending";

  if (state.sopSelectedStage == null || !stageKeys.includes(String(state.sopSelectedStage))) {
    state.sopSelectedStage = isFinished ? Math.max(...stageKeys.map(Number)) : sop.current_stage;
  }
  const selected = state.sopSelectedStage;

  const navItemsHtml = stageKeys
    .map((key, i) => {
      const stage = sop.stages[key];
      const num = Number(key);
      const isCurrent = num === sop.current_stage && !isFinished;
      const isDone = stage.status === "completed" || stage.status === "force_closed";
      const statusText = isDone ? (stage.status === "force_closed" ? "已強制完成" : "已完成") : isCurrent ? "進行中" : "未解鎖";
      const cls = isDone ? "done" : isCurrent ? "current" : "locked";
      const label = sopStageLabel(key, stage);
      const isLast = i === stageKeys.length - 1;
      return `
      <div class="sop-nav-item ${cls} ${num === Number(selected) ? "selected" : ""}" data-sop-nav="${key}">
        <div class="sop-nav-circle-wrap">
          <div class="sop-nav-circle">${isDone ? "✓" : key}</div>
          ${isLast ? "" : `<div class="sop-nav-line ${isDone ? "done" : ""}"></div>`}
        </div>
        <div class="sop-nav-text">
          <div class="sop-nav-label">第${key}關 ${escapeHtml(label)}</div>
          <div class="sop-nav-status">${statusText}</div>
        </div>
      </div>`;
    })
    .join("");

  const selectedStage = sop.stages[String(selected)];
  const selectedIsCurrent = Number(selected) === sop.current_stage && !isFinished;
  const selectedIsDone = selectedStage.status === "completed" || selectedStage.status === "force_closed";
  const selectedLabel = sopStageLabel(selected, selectedStage);
  const statusBadgeText = selectedIsDone
    ? selectedStage.status === "force_closed"
      ? "已強制完成"
      : "已完成"
    : selectedIsCurrent
      ? "進行中"
      : "未解鎖";
  const statusBadgeCls = selectedIsDone || selectedIsCurrent ? "status-active" : "status-closed";
  const isDualGate = selectedIsCurrent && DUAL_GATE_STAGES.includes(Number(selected));

  // Checklists are only rendered for stages backed by real, checkable data - see
  // SOP_STAGE_CHECKLISTS. Stages 4/8/9 (dual-gate) intentionally have none, since their
  // real breakdown already renders via renderConsentPanel below.
  let checklistHtml = "";
  let checklistAllDone = true;
  const checklistConfig = SOP_STAGE_CHECKLISTS[Number(selected)] || null;
  if (checklistConfig) {
    const needsDocs = checklistConfig.some((item) => item.docType);
    const needsLandowners = checklistConfig.some((item) => item.countOf || item.contactRate);
    const [docs, landowners] = await Promise.all([
      needsDocs ? api(`/projects/${pid}/documents`) : Promise.resolve([]),
      needsLandowners ? api(`/projects/${pid}/landowners`) : Promise.resolve([]),
    ]);
    const latestByType = {};
    docs.forEach((d) => {
      if (!latestByType[d.doc_type] || new Date(d.uploaded_at) > new Date(latestByType[d.doc_type].uploaded_at)) {
        latestByType[d.doc_type] = d;
      }
    });
    const landCount = landowners.reduce((sum, o) => sum + (o.land_records || []).length, 0);
    const buildingCount = landowners.reduce((sum, o) => sum + (o.building_records || []).length, 0);
    const phoneCount = landowners.filter((o) => (o.phone || "").trim()).length;
    const contactedCount = landowners.filter((o) => o.contact_status && o.contact_status !== "not_contacted").length;
    const contactRate = landowners.length > 0 ? contactedCount / landowners.length : 0;
    const confirmedChecklist = (selectedStage.data && selectedStage.data.checklist) || {};
    checklistAllDone = true;

    const itemsHtml = checklistConfig
      .map((item) => {
        let done = true;
        let sub = item.sub || "";
        if (item.docType) {
          const doc = latestByType[item.docType];
          done = !!doc;
          sub = doc ? `已上傳・${fmtDate(doc.uploaded_at)}` : "尚未上傳";
        } else if (item.countOf === "landowner_with_phone") {
          done = phoneCount > 0;
          sub = `${phoneCount}/${landowners.length} 位已建立聯絡方式`;
        } else if (item.countOf) {
          const count = item.countOf === "land" ? landCount : buildingCount;
          done = count > 0;
          sub = done ? `共 ${count} 筆` : "尚未匯入";
        } else if (item.contactRate) {
          done = contactRate >= CONTACT_RATE_THRESHOLD;
          sub = `已聯絡 ${contactedCount}/${landowners.length}(${Math.round(contactRate * 100)}%)`;
        } else if (item.manual) {
          const confirmed = confirmedChecklist[item.key];
          done = !!confirmed;
          sub = done ? `已確認・${fmtDate(confirmed.confirmed_at)}` : "尚未確認";
        }
        if (!done) checklistAllDone = false;
        const confirmBtn =
          item.manual && isEditor()
            ? `<button type="button" class="btn-secondary btn-sm" data-checklist-confirm="${item.key}" data-checklist-confirmed="${done}">${done ? "取消確認" : "確認"}</button>`
            : "";
        const uploadBtn =
          item.docType && canOcr()
            ? `<button type="button" class="btn-secondary btn-sm" data-checklist-upload="${item.docType}">${done ? "重新上傳" : "上傳"}</button>
               <input type="file" data-checklist-upload-input="${item.docType}" style="display:none">`
            : "";
        return `
        <div class="sop-checklist-item ${done ? "done" : ""}">
          <div class="sop-checklist-icon">${done ? "✓" : ""}</div>
          <div style="flex:1">
            <div class="sop-checklist-label">${escapeHtml(item.label)}</div>
            <div class="sop-checklist-sub">${escapeHtml(sub)}</div>
          </div>
          ${confirmBtn}${uploadBtn}
        </div>`;
      })
      .join("");
    checklistHtml = `<div class="sop-checklist">${itemsHtml}</div>`;
  }

  el.innerHTML = `
    <div class="sop-panel-layout">
      <div class="sop-nav-list">${navItemsHtml}</div>
      <div class="sop-detail-card">
        <div class="sop-detail-header">
          <h3>第${selected}關・${escapeHtml(selectedLabel)}</h3>
          <span class="status-badge ${statusBadgeCls}">${statusBadgeText}</span>
        </div>
        ${checklistHtml}
        ${isDualGate ? `<div id="sop-tab-consent-panel" style="margin-top:14px"></div>` : ""}
        ${
          selectedIsCurrent && isEditor()
            ? `<div style="display:flex;gap:8px;align-items:center;margin-top:16px;flex-wrap:wrap">
                <button class="btn-primary btn-sm" id="complete-stage-btn" ${checklistAllDone ? "" : "disabled title=\"還有項目未完成\""}>完成本關卡</button>
                ${!checklistAllDone ? `<span class="helper-text">還有項目未完成,無法進入下一關</span>` : ""}
                ${isManager() ? `<button class="btn-warning btn-sm" id="force-stage-btn">主管強制完成</button>` : ""}
              </div>`
            : !selectedIsCurrent
              ? `<div class="helper-text" style="margin-top:16px">${selectedIsDone ? "這一關已經完成。" : "這一關還沒開始,要先完成前面的關卡才會解鎖。"}</div>`
              : ""
        }
      </div>
    </div>`;

  if (isDualGate) {
    await renderConsentPanel(document.getElementById("sop-tab-consent-panel"), Number(selected));
  }

  el.querySelectorAll("[data-sop-nav]").forEach((node) => {
    node.addEventListener("click", () => {
      state.sopSelectedStage = Number(node.dataset.sopNav);
      renderSopTab(el);
    });
  });

  el.querySelectorAll("[data-checklist-confirm]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const key = btn.dataset.checklistConfirm;
      const currentlyConfirmed = btn.dataset.checklistConfirmed === "true";
      try {
        await api(`/projects/${pid}/sop/${selected}/checklist`, {
          method: "POST",
          body: { key, confirmed: !currentlyConfirmed },
        });
        toast(currentlyConfirmed ? "已取消確認" : "已確認", "success");
        renderSopTab(el);
      } catch (err) {}
    });
  });

  el.querySelectorAll("[data-checklist-upload]").forEach((btn) => {
    btn.addEventListener("click", () => {
      el.querySelector(`[data-checklist-upload-input="${btn.dataset.checklistUpload}"]`).click();
    });
  });
  el.querySelectorAll("[data-checklist-upload-input]").forEach((input) => {
    input.addEventListener("change", async () => {
      const file = input.files[0];
      if (!file) return;
      const docType = input.dataset.checklistUploadInput;

      const confirmed = await inspectAndConfirmDocumentUpload(file, docType);
      if (!confirmed) {
        input.value = "";
        return;
      }

      const fd = new FormData();
      fd.append("file", file);
      fd.append("doc_type", docType);
      try {
        await api(`/projects/${pid}/documents`, { method: "POST", body: fd, isForm: true });
        const label = DOC_TYPE_LABEL[docType] || docType;
        toast(`【${label}】已成功上傳`, "success");
        renderSopTab(el);
      } catch (err) {}
    });
  });

  const completeBtn = document.getElementById("complete-stage-btn");
  if (completeBtn) {
    completeBtn.addEventListener("click", async () => {
      try {
        await api(`/projects/${pid}/sop/${sop.current_stage}/complete`, { method: "POST", body: {} });
        toast("關卡已完成", "success");
        await loadDashboard();
        await renderSopSummary();
        state.sopSelectedStage = null;
        renderSopTab(el);
      } catch (err) {}
    });
  }
  const forceBtn = document.getElementById("force-stage-btn");
  if (forceBtn) {
    forceBtn.addEventListener("click", async () => {
      const reason = prompt("請輸入強制完成原因:");
      if (reason === null) return;
      try {
        await api(`/projects/${pid}/sop/${sop.current_stage}/complete`, { method: "POST", body: { force: true, reason } });
        toast("已強制完成關卡", "success");
        await renderSopSummary();
        state.sopSelectedStage = null;
        renderSopTab(el);
      } catch (err) {}
    });
  }
}

async function renderConsentPanel(el, stage) {
  const pid = state.currentProjectId;
  const [ratio, records, landowners] = await Promise.all([
    api(`/projects/${pid}/consent-ratio`, { params: { stage } }),
    api(`/projects/${pid}/sop/${stage}/consent`),
    api(`/projects/${pid}/landowners`),
  ]);
  const recordByLandowner = Object.fromEntries(records.map((r) => [r.landowner_id, r]));

  el.innerHTML = `
    <div class="gate-bars">
      <div>
        <div class="gate-bar-label"><span>人數同意率</span><span>${fmtPct(ratio.headcount_ratio)} (${ratio.headcount_agreed}/${ratio.headcount_total})</span></div>
        <div class="progress-bar-track"><div class="progress-bar-fill" style="width:${Math.min(ratio.headcount_ratio * 100, 100)}%"></div></div>
      </div>
      <div>
        <div class="gate-bar-label"><span>面積同意率</span><span>${fmtPct(ratio.land_share_ratio)} (${ratio.land_share_agreed_sqm.toFixed(1)}/${ratio.land_share_total_sqm.toFixed(1)} m²)</span></div>
        <div class="progress-bar-track"><div class="progress-bar-fill" style="width:${Math.min(ratio.land_share_ratio * 100, 100)}%"></div></div>
      </div>
      <div class="helper-text">需人數與面積同意率皆 ≥ 80% 才能通過雙門檻${ratio.dual_gate_passed ? " · <strong style='color:var(--success)'>已達標</strong>" : ""}</div>
    </div>
    ${
      isEditor()
        ? `<div class="table-wrap">
            <table>
              <thead><tr><th>地主</th><th>本輪同意狀態</th><th>操作</th></tr></thead>
              <tbody>
                ${landowners
                  .map((o) => {
                    const rec = recordByLandowner[o.id];
                    const status = rec ? rec.consent_status : "pending";
                    return `<tr>
                      <td>${escapeHtml(o.name)}</td>
                      <td><span class="consent-status-badge cs-${status}">${CONSENT_STATUS_LABEL[status]}</span></td>
                      <td class="actions-cell">
                        <button class="btn-secondary btn-sm" data-consent="${o.id}" data-status="agreed">同意</button>
                        <button class="btn-secondary btn-sm" data-consent="${o.id}" data-status="opposed">反對</button>
                      </td>
                    </tr>`;
                  })
                  .join("")}
              </tbody>
            </table>
          </div>`
        : ""
    }
  `;

  el.querySelectorAll("[data-consent]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await api(`/projects/${pid}/sop/${stage}/consent`, {
          method: "POST",
          body: { landowner_id: Number(btn.dataset.consent), consent_status: btn.dataset.status },
        });
        toast("已登記同意狀態", "success");
        renderConsentPanel(el, stage);
      } catch (err) {}
    });
  });
}

/* ================= Tab: Contacts ================= */

async function renderContactsTab(el) {
  const pid = state.currentProjectId;
  const [landowners, alerts] = await Promise.all([
    api(`/projects/${pid}/landowners`),
    api(`/projects/${pid}/alerts`),
  ]);
  state.projectCache[pid].landowners = landowners;

  if (!landowners.length) {
    el.innerHTML = `<div class="empty-state">請先建立地主資料</div>`;
    return;
  }

  const selectedId = state.selectedContactLandownerId && landowners.some((o) => o.id === state.selectedContactLandownerId)
    ? state.selectedContactLandownerId
    : landowners[0].id;
  state.selectedContactLandownerId = selectedId;

  el.innerHTML = `
    ${
      alerts.length
        ? `<div class="card" style="margin-bottom:16px;border-left:4px solid var(--danger)">
            <h3 style="margin-top:0">⚠ 需跟進地主 (${alerts.length})</h3>
            <div class="table-wrap" style="box-shadow:none;border:none">
              <table>
                <thead><tr><th>姓名</th><th>聯絡狀態</th><th>最後聯絡</th><th>未聯絡天數</th></tr></thead>
                <tbody>
                  ${alerts
                    .map(
                      (a) => `<tr>
                        <td>${escapeHtml(a.landowner_name)}</td>
                        <td><span class="contact-status-badge cs-${a.contact_status}">${CONTACT_STATUS_LABEL[a.contact_status]}</span></td>
                        <td>${a.last_contact_date ? fmtDateTime(a.last_contact_date) : "尚無紀錄"}</td>
                        <td>${a.days_since_last_contact ?? "-"}</td>
                      </tr>`
                    )
                    .join("")}
                </tbody>
              </table>
            </div>
          </div>`
        : ""
    }
    <div class="section-toolbar">
      <h3>聯絡紀錄</h3>
      <div style="display:flex;gap:10px;align-items:center">
        <select id="contact-landowner-select" style="width:auto">
          ${landowners.map((o) => `<option value="${o.id}" ${o.id === selectedId ? "selected" : ""}>${escapeHtml(o.name)}</option>`).join("")}
        </select>
        ${isEditor() ? `<button class="btn-primary btn-sm" id="add-contact-btn">+ 新增紀錄</button>` : ""}
      </div>
    </div>
    <div id="contact-log-list"></div>
  `;

  document.getElementById("contact-landowner-select").addEventListener("change", (e) => {
    state.selectedContactLandownerId = Number(e.target.value);
    loadContactLogList();
  });
  const addBtn = document.getElementById("add-contact-btn");
  if (addBtn) addBtn.addEventListener("click", () => openAddContactModal(state.selectedContactLandownerId));

  await loadContactLogList();
}

async function loadContactLogList() {
  const pid = state.currentProjectId;
  const lid = state.selectedContactLandownerId;
  const listEl = document.getElementById("contact-log-list");
  listEl.innerHTML = `<div class="empty-state">載入中...</div>`;
  const logs = await api(`/projects/${pid}/landowners/${lid}/contacts`);
  if (!logs.length) {
    listEl.innerHTML = `<div class="empty-state">尚無聯絡紀錄</div>`;
    return;
  }
  listEl.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead><tr><th>日期</th><th>方式</th><th>結果</th><th>備註</th><th>下次跟進</th></tr></thead>
        <tbody>
          ${logs
            .map(
              (c) => `<tr>
                <td>${fmtDateTime(c.contact_date)}</td>
                <td>${CONTACT_METHOD_LABEL[c.contact_method] || c.contact_method}</td>
                <td><span class="consent-status-badge cs-${c.contact_result === "agreed" ? "agreed" : c.contact_result === "opposed" ? "opposed" : "pending"}">${CONTACT_RESULT_LABEL[c.contact_result] || c.contact_result}</span></td>
                <td>${escapeHtml(c.notes) || "-"}</td>
                <td>${fmtDate(c.next_follow_up_date)}</td>
              </tr>`
            )
            .join("")}
        </tbody>
      </table>
    </div>`;
}

function openAddContactModal(landownerId) {
  const now = new Date();
  const localIso = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  openModal(
    "新增聯絡紀錄",
    `
    <form id="contact-form">
      <div class="field-row">
        <div class="field"><label>聯絡時間</label><input type="datetime-local" name="contact_date" value="${localIso}" required></div>
        <div class="field"><label>聯絡方式</label>
          <select name="contact_method">
            ${Object.entries(CONTACT_METHOD_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="field">
        <label>聯絡結果</label>
        <select name="contact_result">
          ${Object.entries(CONTACT_RESULT_LABEL).map(([k, v]) => `<option value="${k}" ${k === "undecided" ? "selected" : ""}>${v}</option>`).join("")}
        </select>
      </div>
      <div class="field-row">
        <div class="field"><label>備註</label><textarea name="notes" rows="2"></textarea></div>
      </div>
      <div class="field"><label>下次跟進日期(選填)</label><input type="date" name="next_follow_up_date"></div>
      <div class="modal-footer">
        <button type="button" class="btn-secondary" onclick="closeModal()">取消</button>
        <button type="submit" class="btn-primary">新增</button>
      </div>
    </form>`
  );
  document.getElementById("contact-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = Object.fromEntries(fd.entries());
    const payload = {
      landowner_id: landownerId,
      contact_date: new Date(data.contact_date).toISOString(),
      contact_method: data.contact_method,
      contact_result: data.contact_result,
      notes: data.notes || null,
      next_follow_up_date: data.next_follow_up_date || null,
    };
    try {
      await api(`/projects/${state.currentProjectId}/landowners/${landownerId}/contacts`, { method: "POST", body: payload });
      closeModal();
      toast("聯絡紀錄已新增", "success");
      renderTab("contacts");
    } catch (err) {}
  });
}

/* ================= Tab: Documents ================= */

async function renderDocumentsTab(el) {
  const pid = state.currentProjectId;
  const docs = await api(`/projects/${pid}/documents`);

  el.innerHTML = `
    <div class="section-toolbar">
      <h3>文件清單 (${docs.length})</h3>
      <div style="display:flex;gap:8px">
        <button class="btn-secondary btn-sm" id="view-ocr-batches-btn">謄本匯入批次紀錄</button>
        ${canOcr() ? `<button class="btn-primary btn-sm" id="upload-doc-btn">+ 上傳文件</button>` : ""}
      </div>
    </div>
    ${
      docs.length
        ? `<div class="table-wrap">
            <table>
              <thead><tr><th>檔名</th><th>類型</th><th>大小</th><th>上傳時間</th><th>說明</th><th>操作</th></tr></thead>
              <tbody>
                ${docs
                  .map(
                    (d) => `<tr>
                      <td>${escapeHtml(d.file_name)}</td>
                      <td>${DOC_TYPE_LABEL[d.doc_type] || d.doc_type}</td>
                      <td>${(d.file_size_bytes / 1024).toFixed(1)} KB</td>
                      <td>${fmtDateTime(d.uploaded_at)}</td>
                      <td>${escapeHtml(d.description) || "-"}</td>
                      <td class="actions-cell">
                        <button class="btn-secondary btn-sm" data-download="${d.id}" data-filename="${escapeHtml(d.file_name)}">下載</button>
                        ${canOcr() ? `<button class="btn-danger btn-sm" data-delete-doc="${d.id}">刪除</button>` : ""}
                      </td>
                    </tr>`
                  )
                  .join("")}
              </tbody>
            </table>
          </div>`
        : `<div class="empty-state">尚無文件</div>`
    }
  `;

  el.querySelectorAll("[data-download]").forEach((btn) => {
    btn.addEventListener("click", () => downloadDocument(Number(btn.dataset.download), btn.dataset.filename));
  });
  el.querySelectorAll("[data-delete-doc]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("確定要刪除此文件嗎?")) return;
      try {
        await api(`/projects/${pid}/documents/${btn.dataset.deleteDoc}`, { method: "DELETE" });
        toast("已刪除", "success");
        renderTab("documents");
      } catch (err) {}
    });
  });
  const uploadBtn = document.getElementById("upload-doc-btn");
  if (uploadBtn) uploadBtn.addEventListener("click", openUploadDocumentModal);
  document.getElementById("view-ocr-batches-btn").addEventListener("click", openOcrBatchListModal);
}

async function openOcrBatchListModal() {
  const pid = state.currentProjectId;
  let jobs;
  try {
    jobs = await api(`/projects/${pid}/ocr-jobs`);
  } catch (err) {
    return;
  }
  openModal(
    "謄本匯入批次紀錄",
    jobs.length
      ? jobs
          .map(
            (j) => `
        <div class="record-row" data-open-batch="${j.id}" style="cursor:pointer;display:flex;justify-content:space-between;align-items:center;padding:10px 12px">
          <div>
            <div style="font-weight:700">批次 #${j.id}</div>
            <div class="helper-text">${fmtDateTime(j.created_at)}</div>
          </div>
          <span class="status-badge ${j.status === "completed" ? "status-active" : j.status === "failed" ? "status-suspended" : "status-closed"}">${OCR_JOB_STATUS_LABEL[j.status] || j.status}</span>
        </div>`
          )
          .join("")
      : `<div class="empty-state">尚無匯入批次紀錄</div>`,
    { width: "480px" }
  );
  document.getElementById("modal-root")
    .querySelectorAll("[data-open-batch]")
    .forEach((row) => {
      row.addEventListener("click", () => {
        closeModal();
        goToOcrBatch(Number(row.dataset.openBatch));
      });
    });
}

async function downloadDocument(docId, fileName) {
  try {
    const res = await api(`/projects/${state.currentProjectId}/documents/${docId}/download`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {}
}

function openUploadDocumentModal() {
  const landowners = state.projectCache[state.currentProjectId]?.landowners || [];
  openModal(
    "上傳文件",
    `
    <form id="upload-form">
      <div class="field"><label>檔案</label><input type="file" name="file" required></div>
      <div class="field-row">
        <div class="field"><label>文件類型</label>
          <select name="doc_type">
            ${Object.entries(DOC_TYPE_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}
          </select>
        </div>
        <div class="field"><label>關聯地主(選填)</label>
          <select name="landowner_id">
            <option value="">— 無 —</option>
            ${landowners.map((o) => `<option value="${o.id}">${escapeHtml(o.name)}</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="field"><label>說明</label><textarea name="description" rows="2"></textarea></div>
      <div class="modal-footer">
        <button type="button" class="btn-secondary" onclick="closeModal()">取消</button>
        <button type="submit" class="btn-primary">上傳</button>
      </div>
    </form>`
  );
  document.getElementById("upload-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.target;
    const fileInput = form.querySelector('input[name="file"]');
    const file = fileInput ? fileInput.files[0] : null;
    const docTypeSelect = form.querySelector('select[name="doc_type"]');
    const docType = docTypeSelect ? docTypeSelect.value : "other";

    if (file) {
      const confirmed = await inspectAndConfirmDocumentUpload(file, docType);
      if (!confirmed) return;
    }

    const fd = new FormData(form);
    if (!fd.get("landowner_id")) fd.delete("landowner_id");
    try {
      await api(`/projects/${state.currentProjectId}/documents`, { method: "POST", body: fd, isForm: true });
      closeModal();
      toast("文件已上傳", "success");
      renderTab("documents");
    } catch (err) {}
  });
}

/* ================= Tab: Members (案件成員) ================= */

async function renderMembersTab(el) {
  const pid = state.currentProjectId;
  const members = await api(`/projects/${pid}/members`);

  el.innerHTML = `
    <div class="section-toolbar">
      <h3>案件成員 (${members.length})</h3>
      <button class="btn-primary btn-sm" id="add-member-btn">+ 新增成員</button>
    </div>
    ${
      members.length
        ? `<div class="table-wrap">
            <table>
              <thead><tr><th>帳號</th><th>顯示名稱</th><th>角色</th><th>加入時間</th><th>操作</th></tr></thead>
              <tbody>
                ${members
                  .map(
                    (m) => `<tr>
                      <td>${escapeHtml(m.username)}</td>
                      <td>${escapeHtml(m.display_name)}</td>
                      <td><span class="role-badge ${m.role_in_project}">${ROLE_LABEL[m.role_in_project] || m.role_in_project}</span></td>
                      <td>${fmtDateTime(m.assigned_at)}</td>
                      <td class="actions-cell">
                        <button class="btn-danger btn-sm" data-remove-member="${m.user_id}">移除</button>
                      </td>
                    </tr>`
                  )
                  .join("")}
              </tbody>
            </table>
          </div>`
        : `<div class="empty-state">尚未指派任何成員(L1/L2 可以看到所有案件,不需要被指派)</div>`
    }
  `;

  document.getElementById("add-member-btn").addEventListener("click", () => openAddMemberModal(members));
  el.querySelectorAll("[data-remove-member]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("確定要將此成員移出這個案件嗎?")) return;
      try {
        await api(`/projects/${pid}/members/${btn.dataset.removeMember}`, { method: "DELETE" });
        toast("已移除", "success");
        renderTab("members");
      } catch (err) {}
    });
  });
}

async function openAddMemberModal(existingMembers) {
  const pid = state.currentProjectId;
  const allUsers = await api("/users");
  const existingIds = new Set(existingMembers.map((m) => m.user_id));
  const candidates = allUsers.filter((u) => !existingIds.has(u.id));

  openModal(
    "新增案件成員",
    `
    <form id="add-member-form">
      <div class="field"><label>使用者</label>
        <select name="user_id" required>
          <option value="">— 選擇使用者 —</option>
          ${candidates.map((u) => `<option value="${u.id}">${escapeHtml(u.display_name)}(${escapeHtml(u.username)}) - ${ROLE_LABEL[u.role] || u.role}</option>`).join("")}
        </select>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn-secondary" onclick="closeModal()">取消</button>
        <button type="submit" class="btn-primary">新增</button>
      </div>
    </form>`
  );
  document.getElementById("add-member-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api(`/projects/${pid}/members`, { method: "POST", body: { user_id: Number(fd.get("user_id")) } });
      closeModal();
      toast("已新增成員", "success");
      renderTab("members");
    } catch (err) {}
  });
}

/* ================= Tab: Encumbrances (他項權利部) ================= */

async function renderEncumbrancesTab(el) {
  const pid = state.currentProjectId;
  const encumbrances = await api(`/projects/${pid}/encumbrances`);
  state.projectCache[pid].encumbrances = encumbrances;

  el.innerHTML = `
    <div class="section-toolbar">
      <h3>他項權利部 (${encumbrances.length})</h3>
      ${isEditor() ? `<button class="btn-primary btn-sm" id="add-encumbrance-btn">+ 新增他項權利</button>` : ""}
    </div>
    ${
      encumbrances.length
        ? `<div class="table-wrap">
            <table>
              <thead><tr>
                <th>登記次序</th><th>對應地號/建號</th><th>權利種類</th><th>他項權利人</th><th>債務額比例</th>
                ${isEditor() ? "<th>操作</th>" : ""}
              </tr></thead>
              <tbody>
                ${encumbrances
                  .map(
                    (enc) => `<tr>
                      <td>${escapeHtml(enc.registration_order) || "-"}</td>
                      <td>${escapeHtml(enc.applies_to_parcels) || "-"}</td>
                      <td>${escapeHtml(enc.right_type) || "-"}</td>
                      <td>${escapeHtml(enc.right_holder) || "-"}</td>
                      <td>${escapeHtml(enc.debtor_info) || "-"}</td>
                      ${
                        isEditor()
                          ? `<td class="actions-cell">
                              <button class="btn-secondary btn-sm" data-edit-encumbrance="${enc.id}">編輯</button>
                              <button class="btn-danger btn-sm" data-delete-encumbrance="${enc.id}">刪除</button>
                            </td>`
                          : ""
                      }
                    </tr>`
                  )
                  .join("")}
              </tbody>
            </table>
          </div>`
        : `<div class="empty-state">尚無他項權利資料</div>`
    }
  `;

  el.querySelectorAll("[data-delete-encumbrance]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("確定要刪除此筆他項權利嗎?")) return;
      try {
        await api(`/projects/${pid}/encumbrances/${btn.dataset.deleteEncumbrance}`, { method: "DELETE" });
        toast("已刪除", "success");
        renderTab("encumbrances");
      } catch (err) {}
    });
  });
  el.querySelectorAll("[data-edit-encumbrance]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const enc = encumbrances.find((e) => e.id === Number(btn.dataset.editEncumbrance));
      if (enc) openEncumbranceFormModal(enc);
    });
  });
  const addBtn = document.getElementById("add-encumbrance-btn");
  if (addBtn) addBtn.addEventListener("click", () => openEncumbranceFormModal(null));
}

function openEncumbranceFormModal(encumbrance) {
  const isEdit = !!encumbrance;
  const e = encumbrance || { registration_order: "", applies_to_parcels: "", right_type: "", right_holder: "", debtor_info: "" };
  const ratio = parseDebtorRatio(e.debtor_info);
  openModal(
    isEdit ? "編輯他項權利" : "新增他項權利",
    `
    <form id="encumbrance-form">
      <div class="field-row">
        <div class="field"><label>登記次序</label><input name="registration_order" value="${escapeHtml(e.registration_order)}" autocomplete="off"></div>
        <div class="field"><label>對應地號/建號</label><input name="applies_to_parcels" value="${escapeHtml(e.applies_to_parcels)}" autocomplete="off"></div>
      </div>
      <div class="field-row">
        <div class="field">
          <label>權利種類</label>
          <select name="right_type">${encumbranceRightTypeOptionsHtml(e.right_type || "")}</select>
        </div>
        <div class="field"><label>他項權利人</label><input name="right_holder" value="${escapeHtml(e.right_holder)}" autocomplete="off"></div>
      </div>
      <div class="field">
        <label>債務額比例</label>
        <div style="display:flex;align-items:center;gap:8px">
          <input name="debtor_num" type="number" value="${escapeHtml(ratio.numerator)}" placeholder="分子" style="width:90px" autocomplete="off">
          <span style="color:var(--text-muted)">分之</span>
          <input name="debtor_den" type="number" value="${escapeHtml(ratio.denominator)}" placeholder="分母" style="width:90px" autocomplete="off">
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn-secondary" onclick="closeModal()">取消</button>
        <button type="submit" class="btn-primary">${isEdit ? "儲存" : "新增"}</button>
      </div>
    </form>`
  );

  document.getElementById("encumbrance-form").addEventListener("submit", async (evt) => {
    evt.preventDefault();
    const fd = new FormData(evt.target);
    const numerator = (fd.get("debtor_num") || "").trim();
    const denominator = (fd.get("debtor_den") || "").trim();
    const payload = {
      registration_order: (fd.get("registration_order") || "").trim() || null,
      applies_to_parcels: (fd.get("applies_to_parcels") || "").trim() || null,
      right_type: (fd.get("right_type") || "").trim() || null,
      right_holder: (fd.get("right_holder") || "").trim() || null,
      debtor_info: numerator && denominator ? `${denominator}分之${numerator}` : null,
    };
    try {
      if (isEdit) {
        await api(`/projects/${state.currentProjectId}/encumbrances/${encumbrance.id}`, { method: "PATCH", body: payload });
      } else {
        await api(`/projects/${state.currentProjectId}/encumbrances`, { method: "POST", body: payload });
      }
      closeModal();
      toast(isEdit ? "已更新" : "已新增", "success");
      renderTab("encumbrances");
    } catch (err) {}
  });
}

/* ================= Tab: Expenses ================= */

async function renderExpensesTab(el) {
  const pid = state.currentProjectId;
  const [expenses, summary, categories] = await Promise.all([
    api(`/projects/${pid}/expenses`),
    api(`/projects/${pid}/expenses/summary`),
    api(`/expense-categories`),
  ]);
  state.projectCache[pid].categories = categories;
  const catById = Object.fromEntries(categories.map((c) => [c.id, c.name]));

  el.innerHTML = `
    <div class="card" style="margin-bottom:16px">
      <h3 style="margin-top:0">支出統計</h3>
      <div style="font-size: 23.5px;font-weight:700;margin-bottom:10px">NT$ ${fmtMoney(summary.total_amount)}</div>
      ${summary.by_category
        .map(
          (c) => `
        <div class="card-meta-row" style="margin-bottom:4px">
          <span>${escapeHtml(c.category_name) || "未分類"}</span><span>NT$ ${fmtMoney(c.total_amount)}</span>
        </div>`
        )
        .join("")}
    </div>
    <div class="section-toolbar">
      <h3>支出明細 (${expenses.length})</h3>
      <div style="display:flex;gap:10px">
        ${isManager() ? `<button class="btn-secondary btn-sm" id="manage-categories-btn">管理類別</button>` : ""}
        ${isEditor() ? `<button class="btn-primary btn-sm" id="add-expense-btn">+ 新增支出</button>` : ""}
      </div>
    </div>
    ${
      expenses.length
        ? `<div class="table-wrap">
            <table>
              <thead><tr><th>日期</th><th>類別</th><th>金額</th><th>廠商</th><th>說明</th>${isEditor() ? "<th>操作</th>" : ""}</tr></thead>
              <tbody>
                ${expenses
                  .map(
                    (ex) => `<tr>
                      <td>${fmtDate(ex.expense_date)}</td>
                      <td>${escapeHtml(catById[ex.category_id]) || "-"}</td>
                      <td>NT$ ${fmtMoney(ex.amount)}</td>
                      <td>${escapeHtml(ex.vendor) || "-"}</td>
                      <td>${escapeHtml(ex.description) || "-"}</td>
                      ${
                        isEditor()
                          ? `<td class="actions-cell">
                              <button class="btn-danger btn-sm" data-delete-expense="${ex.id}">刪除</button>
                            </td>`
                          : ""
                      }
                    </tr>`
                  )
                  .join("")}
              </tbody>
            </table>
          </div>`
        : `<div class="empty-state">尚無支出紀錄</div>`
    }
  `;

  el.querySelectorAll("[data-delete-expense]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("確定要刪除此筆支出嗎?")) return;
      try {
        await api(`/projects/${pid}/expenses/${btn.dataset.deleteExpense}`, { method: "DELETE" });
        toast("已刪除", "success");
        renderTab("expenses");
      } catch (err) {}
    });
  });
  const addBtn = document.getElementById("add-expense-btn");
  if (addBtn) addBtn.addEventListener("click", () => openAddExpenseModal(categories));
  const manageBtn = document.getElementById("manage-categories-btn");
  if (manageBtn) manageBtn.addEventListener("click", () => openManageCategoriesModal(categories));
}

function openAddExpenseModal(categories) {
  openModal(
    "新增支出",
    `
    <form id="expense-form">
      <div class="field-row">
        <div class="field"><label>日期</label><input type="date" name="expense_date" value="${new Date().toISOString().slice(0, 10)}" required></div>
        <div class="field"><label>金額</label><input type="number" name="amount" step="0.01" required></div>
      </div>
      <div class="field-row">
        <div class="field"><label>類別</label>
          <select name="category_id">
            <option value="">— 未分類 —</option>
            ${categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("")}
          </select>
        </div>
        <div class="field"><label>廠商</label><input name="vendor"></div>
      </div>
      <div class="field"><label>說明</label><textarea name="description" rows="2"></textarea></div>
      <div class="modal-footer">
        <button type="button" class="btn-secondary" onclick="closeModal()">取消</button>
        <button type="submit" class="btn-primary">新增</button>
      </div>
    </form>`
  );
  document.getElementById("expense-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = Object.fromEntries(fd.entries());
    const payload = {
      category_id: data.category_id ? Number(data.category_id) : null,
      amount: Number(data.amount),
      expense_date: data.expense_date,
      vendor: data.vendor || null,
      description: data.description || null,
    };
    try {
      await api(`/projects/${state.currentProjectId}/expenses`, { method: "POST", body: payload });
      closeModal();
      toast("支出已新增", "success");
      renderTab("expenses");
    } catch (err) {}
  });
}

function openManageCategoriesModal(categories) {
  function renderList(cats) {
    return cats
      .map(
        (c) => `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)">
          <span>${escapeHtml(c.name)} ${!c.is_active ? '<span class="mini-badge">已停用</span>' : ""}</span>
          <div class="actions-cell">
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
        } catch (err) {}
      };
    });
    document.querySelectorAll("[data-delete-cat]").forEach((btn) => {
      btn.onclick = async () => {
        if (!confirm("確定要刪除此類別嗎?")) return;
        try {
          await api(`/expense-categories/${btn.dataset.deleteCat}`, { method: "DELETE" });
          await refresh();
        } catch (err) {}
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
    } catch (err) {}
  });
}

/* ================= Users ================= */

async function goToUsers() {
  setActiveNav("users");
  showView("view-users");
  await loadUsers();
}

async function loadUsers() {
  const wrap = document.getElementById("users-table-wrap");
  wrap.innerHTML = `<div class="empty-state">載入中...</div>`;
  const users = await api("/users");
  const roleLabel = ROLE_LABEL;

  wrap.innerHTML = `
    <table>
      <thead><tr><th>帳號</th><th>顯示名稱</th><th>角色</th><th>Email</th><th>狀態</th><th>操作</th></tr></thead>
      <tbody>
        ${users
          .map(
            (u) => `<tr>
              <td>${escapeHtml(u.username)}</td>
              <td>${escapeHtml(u.display_name)}</td>
              <td><span class="role-badge ${u.role}">${roleLabel[u.role] || u.role}</span></td>
              <td>${escapeHtml(u.email) || "-"}</td>
              <td><span class="mini-badge ${u.is_active ? "gate-ok" : "alert"}">${u.is_active ? "啟用" : "停用"}</span></td>
              <td class="actions-cell">
                <button class="btn-secondary btn-sm" data-edit-user="${u.id}">編輯</button>
                <button class="btn-secondary btn-sm" data-toggle-user="${u.id}" data-active="${u.is_active}">${u.is_active ? "停用" : "啟用"}</button>
                <button class="btn-danger btn-sm" data-delete-user="${u.id}">刪除</button>
              </td>
            </tr>`
          )
          .join("")}
      </tbody>
    </table>`;

  wrap.querySelectorAll("[data-edit-user]").forEach((btn) => {
    btn.addEventListener("click", () => openEditUserModal(users.find((u) => u.id === Number(btn.dataset.editUser))));
  });
  wrap.querySelectorAll("[data-toggle-user]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const isActive = btn.dataset.active === "true";
      try {
        await api(`/users/${btn.dataset.toggleUser}/active`, { method: "PATCH", body: { is_active: !isActive } });
        toast("已更新狀態", "success");
        loadUsers();
      } catch (err) {}
    });
  });
  wrap.querySelectorAll("[data-delete-user]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("確定要刪除此使用者嗎?")) return;
      try {
        await api(`/users/${btn.dataset.deleteUser}`, { method: "DELETE" });
        toast("已刪除", "success");
        loadUsers();
      } catch (err) {}
    });
  });
}

/* ================= Login logs ================= */

async function goToLoginLogs() {
  setActiveNav("loginlogs");
  showView("view-loginlogs");
  await loadLoginLogs();
}

async function loadLoginLogs() {
  const wrap = document.getElementById("loginlogs-table-wrap");
  wrap.innerHTML = `<div class="empty-state">載入中...</div>`;
  const logs = await api("/auth/login-logs");
  const roleLabel = ROLE_LABEL;
  const actionLabel = { login: "登入", logout: "登出" };

  if (!logs.length) {
    wrap.outerHTML = `<div class="empty-state">尚無登入紀錄</div>`;
    return;
  }

  wrap.innerHTML = `
    <table>
      <thead><tr><th>使用者</th><th>角色</th><th>動作</th><th>時間</th><th>IP 位址</th></tr></thead>
      <tbody>
        ${logs
          .map(
            (l) => `<tr>
              <td>${escapeHtml(l.display_name)} <span class="project-code">(${escapeHtml(l.username)})</span></td>
              <td><span class="role-badge ${l.role}">${roleLabel[l.role] || l.role}</span></td>
              <td><span class="consent-status-badge ${l.action === "login" ? "cs-agreed" : "cs-pending"}">${actionLabel[l.action] || l.action}</span></td>
              <td>${fmtDateTime(l.occurred_at)}</td>
              <td>${escapeHtml(l.ip_address) || "-"}</td>
            </tr>`
          )
          .join("")}
      </tbody>
    </table>`;
}

/* ================= 公版文件 ================= */

async function goToCompanyDocs() {
  setActiveNav("companydocs");
  showView("view-companydocs");
  document.getElementById("upload-companydoc-btn").classList.toggle("hidden", !isManager());
  await loadCompanyDocs();
}

// Real signal only - derived from the actual uploaded mime_type, not a fabricated
// per-item category icon set.
function companyDocIcon(mimeType) {
  if (!mimeType) return "📎";
  if (mimeType === "application/pdf") return "📄";
  if (mimeType.startsWith("image/")) return "🖼️";
  if (mimeType.includes("spreadsheet") || mimeType.includes("excel")) return "📊";
  if (mimeType.includes("word") || mimeType.includes("document")) return "📝";
  return "📎";
}

async function loadCompanyDocs() {
  const wrap = document.getElementById("companydocs-table-wrap");
  wrap.innerHTML = `<div class="empty-state">載入中...</div>`;
  const docs = await api("/company-documents");

  wrap.innerHTML = docs.length
    ? `<div class="card">
        ${docs
          .map(
            (d) => `
          <div class="doc-row">
            <div class="doc-row-icon">${companyDocIcon(d.mime_type)}</div>
            <div style="flex:1;min-width:0">
              <div class="doc-row-name">${escapeHtml(d.file_name)}</div>
              <div class="helper-text">
                最後更新:${fmtDate(d.uploaded_at)}${d.uploaded_by_name ? ` by ${escapeHtml(d.uploaded_by_name)}` : ""}${d.category ? ` · ${escapeHtml(d.category)}` : ""}${d.description ? ` · ${escapeHtml(d.description)}` : ""}
              </div>
            </div>
            <div class="actions-cell">
              <button class="btn-secondary btn-sm" data-download-companydoc="${d.id}" data-filename="${escapeHtml(d.file_name)}">↓ 下載</button>
              ${isManager() ? `<button class="btn-danger btn-sm" data-delete-companydoc="${d.id}">刪除</button>` : ""}
            </div>
          </div>`
          )
          .join("")}
      </div>`
    : `<div class="empty-state">尚無公版文件</div>`;

  wrap.querySelectorAll("[data-download-companydoc]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        const res = await api(`/company-documents/${btn.dataset.downloadCompanydoc}/download`);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = btn.dataset.filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (err) {}
    });
  });
  wrap.querySelectorAll("[data-delete-companydoc]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("確定要刪除此文件嗎?")) return;
      try {
        await api(`/company-documents/${btn.dataset.deleteCompanydoc}`, { method: "DELETE" });
        toast("已刪除", "success");
        loadCompanyDocs();
      } catch (err) {}
    });
  });
}

document.getElementById("upload-companydoc-btn").addEventListener("click", () => {
  openModal(
    "上傳公版文件",
    `
    <form id="upload-companydoc-form">
      <div class="field"><label>檔案</label><input type="file" name="file" required></div>
      <div class="field"><label>分類(選填)</label><input name="category" placeholder="例:開發信範本"></div>
      <div class="field"><label>說明</label><textarea name="description" rows="2"></textarea></div>
      <div class="modal-footer">
        <button type="button" class="btn-secondary" onclick="closeModal()">取消</button>
        <button type="submit" class="btn-primary">上傳</button>
      </div>
    </form>`
  );
  document.getElementById("upload-companydoc-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    if (!fd.get("category")) fd.delete("category");
    try {
      await api("/company-documents", { method: "POST", body: fd, isForm: true });
      closeModal();
      toast("文件已上傳", "success");
      loadCompanyDocs();
    } catch (err) {}
  });
});

/* ================= 相關法規 / 相關網站 (共用邏輯) ================= */

const LINK_SECTION_ACCENTS = ["accent-brand", "accent-success", "accent-info", "accent-danger"];

function renderLinkListPage(items, listElId, isManagerView) {
  const el = document.getElementById(listElId);
  if (!items.length) {
    el.innerHTML = `<div class="empty-state">尚無連結,${isManagerView ? "點右上角新增" : "請洽管理員新增"}</div>`;
    return;
  }
  const byCategory = {};
  items.forEach((item) => {
    const cat = item.category || "未分類";
    (byCategory[cat] = byCategory[cat] || []).push(item);
  });
  el.innerHTML = Object.entries(byCategory)
    .map(
      ([cat, rows], catIdx) => `
      <div class="link-section">
        <div class="link-section-hdr"><span>📄</span>${escapeHtml(cat)}</div>
        ${rows
          .map(
            (r) => `
          <div class="card link-card" data-id="${r.id}">
            <div class="link-card-dot ${LINK_SECTION_ACCENTS[catIdx % LINK_SECTION_ACCENTS.length]}"></div>
            <div style="flex:1;min-width:0">
              <div class="link-card-name">${escapeHtml(r.name)}</div>
              ${r.description ? `<div class="helper-text">${escapeHtml(r.description)}</div>` : ""}
            </div>
            <div class="actions-cell">
              <a href="${escapeHtml(r.url)}" target="_blank" rel="noopener" class="btn-secondary btn-sm">開啟 ↗</a>
              ${
                isManagerView
                  ? `<button class="btn-secondary btn-sm" data-edit-link="${r.id}">編輯</button>
                     <button class="btn-danger btn-sm" data-delete-link="${r.id}">刪除</button>`
                  : ""
              }
            </div>
          </div>`
          )
          .join("")}
      </div>`
    )
    .join("");
}

function openLinkFormModal(title, endpoint, item, onSaved) {
  openModal(
    title,
    `
    <form id="link-form">
      <div class="field"><label>分類(選填)</label><input name="category" value="${item ? escapeHtml(item.category) || "" : ""}"></div>
      <div class="field"><label>名稱</label><input name="name" required value="${item ? escapeHtml(item.name) : ""}"></div>
      <div class="field"><label>網址</label><input name="url" type="url" required value="${item ? escapeHtml(item.url) : ""}"></div>
      <div class="field"><label>說明(選填)</label><textarea name="description" rows="2">${item ? escapeHtml(item.description) || "" : ""}</textarea></div>
      <div class="modal-footer">
        <button type="button" class="btn-secondary" onclick="closeModal()">取消</button>
        <button type="submit" class="btn-primary">儲存</button>
      </div>
    </form>`
  );
  document.getElementById("link-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = Object.fromEntries(fd.entries());
    if (!payload.category) delete payload.category;
    if (!payload.description) delete payload.description;
    try {
      if (item) {
        await api(`${endpoint}/${item.id}`, { method: "PATCH", body: payload });
      } else {
        await api(endpoint, { method: "POST", body: payload });
      }
      closeModal();
      toast("已儲存", "success");
      onSaved();
    } catch (err) {}
  });
}

let regulationsEditMode = false;
let websitesEditMode = false;

async function goToRegulations() {
  setActiveNav("regulations");
  showView("view-regulations");
  regulationsEditMode = false;
  document.getElementById("new-regulation-btn").classList.toggle("hidden", !isManager());
  document.getElementById("toggle-regulation-edit-btn").classList.toggle("hidden", !isManager());
  await loadRegulations();
}

async function loadRegulations() {
  const el = document.getElementById("regulations-list");
  el.innerHTML = `<div class="empty-state">載入中...</div>`;
  const items = await api("/regulations");
  renderLinkListPage(items, "regulations-list", isManager() && regulationsEditMode);
  if (isManager() && regulationsEditMode) {
    el.querySelectorAll("[data-edit-link]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const item = items.find((r) => r.id === Number(btn.dataset.editLink));
        openLinkFormModal("編輯法規連結", "/regulations", item, loadRegulations);
      });
    });
    el.querySelectorAll("[data-delete-link]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("確定要刪除此連結嗎?")) return;
        try {
          await api(`/regulations/${btn.dataset.deleteLink}`, { method: "DELETE" });
          toast("已刪除", "success");
          loadRegulations();
        } catch (err) {}
      });
    });
  }
}

document.getElementById("new-regulation-btn").addEventListener("click", () => {
  openLinkFormModal("新增法規連結", "/regulations", null, loadRegulations);
});

document.getElementById("toggle-regulation-edit-btn").addEventListener("click", (e) => {
  regulationsEditMode = !regulationsEditMode;
  e.currentTarget.classList.toggle("btn-primary", regulationsEditMode);
  e.currentTarget.classList.toggle("btn-secondary", !regulationsEditMode);
  loadRegulations();
});

async function goToWebsites() {
  setActiveNav("websites");
  showView("view-websites");
  websitesEditMode = false;
  document.getElementById("new-website-btn").classList.toggle("hidden", !isManager());
  document.getElementById("toggle-website-edit-btn").classList.toggle("hidden", !isManager());
  await loadWebsites();
}

async function loadWebsites() {
  const el = document.getElementById("websites-list");
  el.innerHTML = `<div class="empty-state">載入中...</div>`;
  const items = await api("/websites");
  renderLinkListPage(items, "websites-list", isManager() && websitesEditMode);
  if (isManager() && websitesEditMode) {
    el.querySelectorAll("[data-edit-link]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const item = items.find((r) => r.id === Number(btn.dataset.editLink));
        openLinkFormModal("編輯網站連結", "/websites", item, loadWebsites);
      });
    });
    el.querySelectorAll("[data-delete-link]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("確定要刪除此連結嗎?")) return;
        try {
          await api(`/websites/${btn.dataset.deleteLink}`, { method: "DELETE" });
          toast("已刪除", "success");
          loadWebsites();
        } catch (err) {}
      });
    });
  }
}

document.getElementById("new-website-btn").addEventListener("click", () => {
  openLinkFormModal("新增網站連結", "/websites", null, loadWebsites);
});

document.getElementById("toggle-website-edit-btn").addEventListener("click", (e) => {
  websitesEditMode = !websitesEditMode;
  e.currentTarget.classList.toggle("btn-primary", websitesEditMode);
  e.currentTarget.classList.toggle("btn-secondary", !websitesEditMode);
  loadWebsites();
});

/* ================= 知識庫 (FAQ) ================= */

let faqCurCat = "全部";

let faqEditMode = false;

async function goToFaq() {
  setActiveNav("faq");
  showView("view-faq");
  faqEditMode = false;
  const toggleBtn = document.getElementById("toggle-faq-edit-btn");
  toggleBtn.classList.toggle("hidden", !isManager());
  toggleBtn.classList.remove("btn-primary");
  toggleBtn.classList.add("btn-secondary");
  document.getElementById("new-faq-btn").classList.toggle("hidden", !isManager());
  document.getElementById("manage-faq-cats-btn").classList.toggle("hidden", !isManager());
  faqCurCat = "全部";
  await loadFaq();
}

let faqItemsCache = [];

async function loadFaq() {
  const listEl = document.getElementById("faq-list");
  listEl.innerHTML = `<div class="empty-state">載入中...</div>`;
  const items = await api("/faq");
  faqItemsCache = items;

  // Union of real categories already used on saved items and admin-declared preset
  // categories (FAQ_CATEGORY_OPTIONS) - lets a newly-added-but-not-yet-used category
  // show up here right away, same as expense categories can exist before any expense
  // references them. "未分類" only shows up if some real item actually has no category.
  const usedCats = items.map((i) => i.category || "未分類");
  const cats = ["全部", ...new Set([...usedCats, ...FAQ_CATEGORY_OPTIONS])];
  document.getElementById("faq-cat-bar").innerHTML = cats
    .map((c) => `<button class="fb ${faqCurCat === c ? "act" : ""}" data-faq-cat="${escapeHtml(c)}">${escapeHtml(c)}</button>`)
    .join("");
  document.querySelectorAll("[data-faq-cat]").forEach((btn) => {
    btn.addEventListener("click", () => {
      faqCurCat = btn.dataset.faqCat;
      renderFaqList(items);
    });
  });

  renderFaqList(items);
}

function renderFaqList(items) {
  const listEl = document.getElementById("faq-list");
  const filtered = items.filter((i) => faqCurCat === "全部" || (i.category || "未分類") === faqCurCat);

  listEl.innerHTML = filtered.length
    ? filtered
        .map(
          (i) => `
      <div class="faq-item">
        <div class="faq-q" data-faq-toggle="${i.id}">
          <span class="faq-cat-tag">${escapeHtml(i.category) || "未分類"}</span>
          <span style="flex:1">${escapeHtml(i.question)}</span>
          ${
            isManager() && faqEditMode
              ? `<span class="actions-cell" onclick="event.stopPropagation()">
                  <button class="btn-secondary btn-sm" data-edit-faq="${i.id}">編輯</button>
                  <button class="btn-danger btn-sm" data-delete-faq="${i.id}">刪除</button>
                </span>`
              : ""
          }
          <span class="faq-arr">▶</span>
        </div>
        <div class="faq-a">${escapeHtml(i.answer)}</div>
      </div>`
        )
        .join("")
    : `<div class="empty-state">尚無問答</div>`;

  listEl.querySelectorAll("[data-faq-toggle]").forEach((hdr) => {
    hdr.addEventListener("click", () => {
      const item = hdr.closest(".faq-item");
      const wasOpen = item.classList.contains("open");
      listEl.querySelectorAll(".faq-item.open").forEach((x) => x.classList.remove("open"));
      if (!wasOpen) item.classList.add("open");
    });
  });
  listEl.querySelectorAll("[data-edit-faq]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = items.find((i) => i.id === Number(btn.dataset.editFaq));
      openFaqFormModal("編輯問答", item);
    });
  });
  listEl.querySelectorAll("[data-delete-faq]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("確定要刪除此問答嗎?")) return;
      try {
        await api(`/faq/${btn.dataset.deleteFaq}`, { method: "DELETE" });
        toast("已刪除", "success");
        loadFaq();
      } catch (err) {}
    });
  });
}

const FAQ_CATEGORY_OPTIONS = ["條件分配", "法律問題", "稅務優惠", "說明會相關", "都更流程"];

function openFaqFormModal(title, item) {
  const currentCat = item ? item.category || "" : "";
  const isKnownCat = !currentCat || FAQ_CATEGORY_OPTIONS.includes(currentCat);
  openModal(
    title,
    `
    <form id="faq-form">
      <div class="field">
        <label>分類(選填)</label>
        <select id="faq-category-select">
          <option value="" ${!currentCat ? "selected" : ""}>無</option>
          ${FAQ_CATEGORY_OPTIONS.map((c) => `<option value="${escapeHtml(c)}" ${currentCat === c ? "selected" : ""}>${escapeHtml(c)}</option>`).join("")}
          ${!isKnownCat ? `<option value="${escapeHtml(currentCat)}" selected>${escapeHtml(currentCat)}</option>` : ""}
          <option value="__new__">＋ 新增分類</option>
        </select>
        <input type="hidden" name="category" id="faq-category-value" value="${escapeHtml(currentCat)}">
      </div>
      <div class="field"><label>問題</label><input name="question" required value="${item ? escapeHtml(item.question) : ""}"></div>
      <div class="field"><label>答案</label><textarea name="answer" rows="4" required>${item ? escapeHtml(item.answer) : ""}</textarea></div>
      <div class="modal-footer">
        <button type="button" class="btn-secondary" onclick="closeModal()">取消</button>
        <button type="submit" class="btn-primary">儲存</button>
      </div>
    </form>`
  );
  const catSelect = document.getElementById("faq-category-select");
  const catValue = document.getElementById("faq-category-value");
  catSelect.addEventListener("change", () => {
    if (catSelect.value === "__new__") {
      const name = prompt("輸入新分類名稱:");
      if (name && name.trim()) {
        const opt = document.createElement("option");
        opt.value = name.trim();
        opt.textContent = name.trim();
        catSelect.insertBefore(opt, catSelect.querySelector('option[value="__new__"]'));
        catSelect.value = name.trim();
      } else {
        catSelect.value = catValue.value;
      }
    }
    catValue.value = catSelect.value === "__new__" ? "" : catSelect.value;
  });
  document.getElementById("faq-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = Object.fromEntries(fd.entries());
    if (!payload.category) delete payload.category;
    try {
      if (item) {
        await api(`/faq/${item.id}`, { method: "PATCH", body: payload });
      } else {
        await api("/faq", { method: "POST", body: payload });
      }
      closeModal();
      toast("已儲存", "success");
      loadFaq();
    } catch (err) {}
  });
}

document.getElementById("new-faq-btn").addEventListener("click", () => {
  openFaqFormModal("新增問答", null);
});

document.getElementById("toggle-faq-edit-btn").addEventListener("click", (e) => {
  faqEditMode = !faqEditMode;
  e.currentTarget.classList.toggle("btn-primary", faqEditMode);
  e.currentTarget.classList.toggle("btn-secondary", !faqEditMode);
  renderFaqList(faqItemsCache);
});

function openManageFaqCatsModal() {
  const realCats = new Set(faqItemsCache.map((i) => i.category).filter(Boolean));
  const allCats = [...new Set([...FAQ_CATEGORY_OPTIONS, ...realCats])];

  openModal(
    "管理分類",
    `
    <div id="faq-cat-manage-list">
      ${
        allCats.length
          ? allCats
              .map((c) => {
                const count = faqItemsCache.filter((i) => i.category === c).length;
                return `
              <div class="cat-manage-row" data-cat="${escapeHtml(c)}">
                <span class="cat-manage-name">${escapeHtml(c)}${count ? ` (${count} 筆問答使用中)` : ""}</span>
                <button type="button" class="btn-secondary btn-sm" data-rename-cat="${escapeHtml(c)}">編輯</button>
                <button type="button" class="btn-danger btn-sm" data-delete-cat="${escapeHtml(c)}">刪除</button>
              </div>`;
              })
              .join("")
          : `<div class="empty-state">尚無分類</div>`
      }
    </div>
    <div class="field-row" style="margin-top:12px">
      <div class="field" style="margin-bottom:0"><input id="new-faq-cat-name" placeholder="新分類名稱"></div>
      <div class="field" style="flex:0 0 auto;margin-bottom:0">
        <button type="button" class="btn-primary" id="add-faq-cat-btn">新增</button>
      </div>
    </div>
    <div class="modal-footer">
      <button type="button" class="btn-secondary" onclick="closeModal()">關閉</button>
    </div>`
  );

  document.getElementById("add-faq-cat-btn").addEventListener("click", () => {
    const input = document.getElementById("new-faq-cat-name");
    const name = input.value.trim();
    if (!name) return;
    if (FAQ_CATEGORY_OPTIONS.includes(name) || realCats.has(name)) {
      toast("分類已存在", "error");
      return;
    }
    FAQ_CATEGORY_OPTIONS.push(name);
    toast("已新增分類", "success");
    closeModal();
    loadFaq();
  });

  document.querySelectorAll("[data-rename-cat]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const oldName = btn.dataset.renameCat;
      const newName = prompt(`將分類「${oldName}」重新命名為:`, oldName);
      if (!newName || !newName.trim() || newName.trim() === oldName) return;
      const trimmed = newName.trim();
      try {
        const affected = faqItemsCache.filter((i) => i.category === oldName);
        for (const item of affected) {
          await api(`/faq/${item.id}`, { method: "PATCH", body: { category: trimmed } });
        }
        const idx = FAQ_CATEGORY_OPTIONS.indexOf(oldName);
        if (idx >= 0) FAQ_CATEGORY_OPTIONS[idx] = trimmed;
        toast("已更新分類名稱", "success");
        closeModal();
        await loadFaq();
      } catch (err) {}
    });
  });
  document.querySelectorAll("[data-delete-cat]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const name = btn.dataset.deleteCat;
      const affected = faqItemsCache.filter((i) => i.category === name);
      const msg = affected.length
        ? `確定要刪除分類「${name}」嗎?底下 ${affected.length} 筆問答會變成「無分類」。`
        : `確定要刪除分類「${name}」嗎?`;
      if (!confirm(msg)) return;
      try {
        for (const item of affected) {
          await api(`/faq/${item.id}`, { method: "PATCH", body: { category: null } });
        }
        const idx = FAQ_CATEGORY_OPTIONS.indexOf(name);
        if (idx >= 0) FAQ_CATEGORY_OPTIONS.splice(idx, 1);
        toast("已刪除分類", "success");
        closeModal();
        await loadFaq();
      } catch (err) {}
    });
  });
}

document.getElementById("manage-faq-cats-btn").addEventListener("click", openManageFaqCatsModal);

document.getElementById("new-user-btn").addEventListener("click", () => {
  openModal(
    "新增使用者",
    `
    <form id="user-form">
      <div class="field-row">
        <div class="field"><label>帳號</label><input name="username" required></div>
        <div class="field"><label>密碼</label><input name="password" type="password" required></div>
      </div>
      <div class="field-row">
        <div class="field"><label>顯示名稱</label><input name="display_name" required></div>
        <div class="field"><label>角色</label>
          <select name="role">
            ${Object.entries(ROLE_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="field-row">
        <div class="field"><label>Email</label><input name="email" type="email"></div>
        <div class="field"><label>電話</label><input name="phone"></div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn-secondary" onclick="closeModal()">取消</button>
        <button type="submit" class="btn-primary">建立</button>
      </div>
    </form>`
  );
  document.getElementById("user-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = Object.fromEntries(fd.entries());
    try {
      await api("/users", { method: "POST", body: payload });
      closeModal();
      toast("使用者已建立", "success");
      loadUsers();
    } catch (err) {}
  });
});

function openEditUserModal(user) {
  openModal(
    "編輯使用者",
    `
    <form id="user-edit-form">
      <div class="field-row">
        <div class="field"><label>顯示名稱</label><input name="display_name" value="${escapeHtml(user.display_name)}" required></div>
        <div class="field"><label>角色</label>
          <select name="role">
            ${Object.entries(ROLE_LABEL).map(([k, v]) => `<option value="${k}" ${user.role === k ? "selected" : ""}>${v}</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="field-row">
        <div class="field"><label>Email</label><input name="email" type="email" value="${escapeHtml(user.email) || ""}"></div>
        <div class="field"><label>電話</label><input name="phone" value="${escapeHtml(user.phone) || ""}"></div>
      </div>
      <div class="field"><label>新密碼(留空表示不變更)</label><input name="password" type="password"></div>
      <div class="modal-footer">
        <button type="button" class="btn-secondary" onclick="closeModal()">取消</button>
        <button type="submit" class="btn-primary">儲存</button>
      </div>
    </form>`
  );
  document.getElementById("user-edit-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = Object.fromEntries(fd.entries());
    if (!payload.password) delete payload.password;
    try {
      await api(`/users/${user.id}`, { method: "PATCH", body: payload });
      closeModal();
      toast("已更新", "success");
      loadUsers();
    } catch (err) {}
  });
}

/* ================= Bootstrap ================= */

(async function init() {
  if (state.token) {
    try {
      await loadCurrentUser();
      return;
    } catch (e) {
      /* fall through to login */
    }
  }
  document.getElementById("view-login").classList.remove("hidden");
})();
