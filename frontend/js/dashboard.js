"use strict";

let selectedProjectIds = new Set();
let dashboardProjectsById = {};
const expandedSidebarCities = new Set();
let sidebarCitiesInitialized = false;

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

function projectRingHtml(ratio, label) {
  const pct = Math.round((ratio || 0) * 100);
  return `
    <div class="project-ring">
      <div class="project-ring-svg-wrap">
        ${donutSvg(pct, 62)}
        <span class="project-ring-pct">${pct}%</span>
      </div>
      <div class="project-ring-label">${escapeHtml(label)}</div>
    </div>`;
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
    "view-tools",
  ].forEach((v) => {
    const el = document.getElementById(v);
    if (el) el.classList.toggle("hidden", v !== id);
  });
}

function goToTools() {
  setActiveNav("tools");
  showView("view-tools");
}

function setActiveNav(name) {
  document.querySelectorAll(".nav-link").forEach((b) => b.classList.toggle("active", b.dataset.nav === name));
  document.querySelectorAll(".sb-case-item").forEach((b) => b.classList.remove("active"));
}

function setActiveSidebarCase(projectId) {
  document.querySelectorAll(".nav-link").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll(".sb-case-item").forEach((b) =>
    b.classList.toggle("active", Number(b.dataset.projectId) === Number(projectId))
  );
}

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
                (p) => `
                <div class="sb-case-item" data-project-id="${p.id}">
                  <span class="sb-case-name"><span style="margin-right:6px">📋</span>${escapeHtml(p.name)}</span>
                  <span class="sb-case-stage">第${p.current_stage}關</span>
                </div>`
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

async function goToDashboard() {
  setActiveNav("dashboard");
  showView("view-dashboard");
  await loadDashboard();
}

async function loadDashboard() {
  selectedProjectIds = new Set();
  dashboardProjectsById = {};
  updateBatchDeleteBar();

  const statRow = document.getElementById("dashboard-stat-row");
  const aiBadge = document.getElementById("ai-online-badge");
  const grid = document.getElementById("project-grid");
  if (statRow) statRow.innerHTML = `<div class="empty-state">載入中...</div>`;
  if (grid) grid.innerHTML = `<div class="empty-state">載入中...</div>`;

  let summary;
  try {
    summary = await api("/projects/dashboard-summary");
  } catch (e) {
    if (statRow) statRow.innerHTML = "";
    if (grid) grid.innerHTML = `<div class="empty-state">載入失敗</div>`;
    return;
  }

  if (aiBadge) {
    aiBadge.textContent = summary.ai_online ? "AI Online" : "AI Offline";
    aiBadge.className = `status-badge ${summary.ai_online ? "status-active" : "status-closed"}`;
  }

  if (statRow) {
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
    `;
  }

  renderSidebarProjects(summary.projects);

  if (!summary.projects.length) {
    if (grid) {
      grid.innerHTML = `<div class="empty-state">目前沒有可查看的案件</div>`;
    }
    return;
  }

  summary.projects.forEach((p) => (dashboardProjectsById[p.id] = p));

  const cardAccents = ["accent-info", "accent-success", "accent-brand", "accent-danger"];

  if (grid) {
    grid.innerHTML = summary.projects
      .map(
        (p, i) => `
          <div class="card project-card ${cardAccents[i % cardAccents.length]}" data-project-id="${p.id}">
            <div class="project-card-top">
              ${isManager()
                ? `<input type="checkbox" class="project-select-checkbox" data-select-project="${p.id}" ${selectedProjectIds.has(p.id) ? "checked" : ""}>`
                : ""
              }
              <h3 style="flex:1">${escapeHtml(p.name)}</h3>
              ${p.city ? `<span class="mini-badge">${escapeHtml(p.city)}</span>` : ""}
            </div>
            <div class="project-card-stage">
              <div class="project-stage-bar">
                ${Array.from({ length: 10 }, (_, i) => `<span class="${i <= p.current_stage ? "filled" : ""}"></span>`).join("")}
              </div>
              <div class="helper-text">第${p.current_stage}關 · ${escapeHtml(sopStageLabel(p.current_stage))}</div>
            </div>
            <div class="project-card-rings">
              ${projectRingHtml(p.headcount_ratio, "人數同意")}
              ${projectRingHtml(p.land_share_ratio, "土地同意")}
              ${projectRingHtml(p.building_share_ratio, "建物同意")}
            </div>
            <div class="project-card-tiers">
              <span class="tier-badge tier-reminder">▲ 提醒:${p.reminder_count}</span>
              <span class="tier-badge tier-warning">▲ 警示:${p.warning_count}</span>
              <span class="tier-badge tier-urgent">▲ 緊急:${p.urgent_count}</span>
            </div>
            ${p.case_handler_name || p.case_manager_name
              ? `<div class="project-card-footer">
                  ${p.case_handler_name ? `<span>👤 ${escapeHtml(p.case_handler_name)}</span>` : ""}
                  ${p.case_manager_name ? `<span>💼 ${escapeHtml(p.case_manager_name)}</span>` : ""}
                </div>`
              : ""
            }
            ${isManager()
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
}

function updateBatchDeleteBar() {
  const btn = document.getElementById("batch-delete-btn");
  const countEl = document.getElementById("batch-select-count");
  const selectAllWrap = document.getElementById("batch-select-all-wrap");
  const selectAllCheckbox = document.getElementById("batch-select-all");
  if (!btn || !countEl || !selectAllWrap || !selectAllCheckbox) return;

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
    } catch (err) { }
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
  } catch (e) { }
  return `${year}-${String(maxSeq + 1).padStart(3, "0")}`;
}

function updateDistrictSelectOptions(city, defaultDistrict = "") {
  const distSelect = document.getElementById("np-district");
  if (!distSelect) return;
  const districts = (typeof TAIWAN_DISTRICTS !== "undefined" && TAIWAN_DISTRICTS[city]) || [];
  if (!districts.length) {
    distSelect.innerHTML = `<option value="">請先選擇縣市</option>`;
    distSelect.disabled = true;
  } else {
    distSelect.disabled = false;
    distSelect.innerHTML =
      `<option value="">請選擇行政區</option>` +
      districts.map((d) => `<option value="${d}" ${d === defaultDistrict ? "selected" : ""}>${d}</option>`).join("");
  }
}

async function goToNewProject() {
  const cityOptions =
    `<option value="">請選擇</option>` + TAIWAN_CITIES.map((c) => `<option value="${c}">${c}</option>`).join("");
  openModal(
    "建立都更案",
    `
    <form id="project-form">
      <div class="field-row">
        <div class="field"><label>縣市</label><select name="city" id="np-city">${cityOptions}</select></div>
        <div class="field"><label>行政區</label><select name="district" id="np-district" disabled><option value="">請先選擇縣市</option></select></div>
      </div>
      <div class="field-row">
        <div class="field"><label>案件代碼</label><input name="project_code" id="np-code" required></div>
        <div class="field"><label>案件名稱</label><input name="name" required></div>
      </div>
      <div class="field"><label>備註</label><textarea name="description" rows="3"></textarea></div>
      <div class="modal-footer">
        <button type="button" class="btn-secondary" onclick="closeModal()">取消</button>
        <button type="submit" class="btn-primary">建立</button>
      </div>
    </form>`,
    { width: "560px" }
  );

  updateDistrictSelectOptions("");
  document.getElementById("np-code").value = await suggestNextProjectCode();

  document.getElementById("np-city").addEventListener("change", (e) => {
    updateDistrictSelectOptions(e.target.value);
  });

  document.getElementById("project-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = Object.fromEntries(fd.entries());
    try {
      const project = await api("/projects", { method: "POST", body: payload });
      toast("案件已建立", "success");
      closeModal();
      await loadDashboard();
      await openProject(project.id);
    } catch (err) { }
  });
}

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
  const membersTabBtn = document.getElementById("tab-btn-members");
  if (membersTabBtn) membersTabBtn.classList.toggle("hidden", !isManager());
  state.activeTab = "sop";
  await Promise.all([renderTab(state.activeTab), renderSopSummary()]);
}

function renderProjectHeader(p) {
  const nameEl = document.getElementById("pd-name");
  const subEl = document.getElementById("pd-sub");
  const badgeEl = document.getElementById("pd-status-badge");

  if (nameEl) nameEl.textContent = `${p.name} (${p.project_code})`;
  if (subEl) subEl.textContent = [p.district, p.address].filter(Boolean).join(" · ") || "—";
  if (badgeEl) {
    badgeEl.innerHTML =
      `<span class="status-badge status-${p.status}">${PROJECT_STATUS_LABEL[p.status] || p.status}</span>` +
      (p.is_force_closed ? ` <span class="mini-badge alert">強制結案</span>` : "");
  }
}

async function renderTab(tab) {
  const el = document.getElementById("tab-content");
  if (!el) return;
  el.innerHTML = `<div class="empty-state">載入中...</div>`;
  const renderers = {
    sop: renderSopTab,
    landowners: (el) => renderLandownersTypeTab(el, "land"),
    buildings: (el) => renderLandownersTypeTab(el, "building"),
    buildingview: renderBuildingViewTab,
    relations: renderRelationsTab,
    contacts: renderContactsTab,
    documents: renderDocumentsTab,
    encumbrances: renderEncumbrancesTab,
    expenses: renderExpensesTab,
    landvaluetax: renderLandValueTaxTab,
    members: renderMembersTab,
  };
  try {
    if (renderers[tab]) {
      await renderers[tab](el);
    }
  } catch (e) {
    console.error(`[renderDashboardTab] tab=${tab} error:`, e);
    const msg = escapeHtml(e && (e.message || String(e))) || "系統連線錯誤";
    el.innerHTML = `<div class="empty-state">載入失敗（${msg}）<br><button type="button" class="btn-secondary btn-sm" style="margin-top:12px" onclick="renderDashboardTab('${tab}')">🔄 點此重新載入</button></div>`;
  }
}

function initDashboard() {
  const batchSelectAll = document.getElementById("batch-select-all");
  if (batchSelectAll) {
    batchSelectAll.addEventListener("change", (e) => toggleSelectAllProjects(e.target.checked));
  }

  const batchDeleteBtn = document.getElementById("batch-delete-btn");
  if (batchDeleteBtn) {
    batchDeleteBtn.addEventListener("click", openBatchDeleteModal);
  }

  const newProjectBtn = document.getElementById("new-project-btn");
  if (newProjectBtn) {
    newProjectBtn.addEventListener("click", goToNewProject);
  }

  // 建立都更案 is now a modal (see goToNewProject) - its city/district/submit
  // handlers are wired when the modal opens, not here.

  const backToDashboardDetailBtn = document.getElementById("back-to-dashboard");
  if (backToDashboardDetailBtn) {
    backToDashboardDetailBtn.addEventListener("click", goToDashboard);
  }

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b === btn));
      state.activeTab = btn.dataset.tab;
      await renderTab(btn.dataset.tab);
    });
  });
}
