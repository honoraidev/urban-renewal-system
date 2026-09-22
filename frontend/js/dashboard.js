"use strict";

let selectedProjectIds = new Set();
let dashboardProjectsById = {};
const expandedSidebarCities = new Set();
let sidebarCitiesInitialized = false;


// 案件卡片的「同意人數/反對人數/其他」文字統計 —— 依「拜訪結果」分類(跟樓棟視圖的
// 拜訪結果選項同一套:agreed/opposed/callback_needed/undecided/no_answer),「其他」
// 是把需回電/未決定/未接聽三種合併算,不細分成三個數字。取代原本土地同意/建物同意
// 兩個面積環,只留人數(土地/建物持分同意度改到案件總覽頁的「關鍵指標」看)。
function projectConsentBreakdownHtml(breakdown, names) {
  const total = breakdown?.headcount_total || 0;
  const agreed = breakdown?.headcount_agreed || 0;
  const opposed = breakdown?.headcount_opposed || 0;
  const other = Math.max(0, total - agreed - opposed);
  const agreedPct = total > 0 ? Math.round((agreed / total) * 100) : 0;
  const agreedDeg = total > 0 ? (agreed / total) * 360 : 0;
  const opposedDeg = total > 0 ? agreedDeg + (opposed / total) * 360 : 0;
  const nameTitle = names && names.length ? ` title="${escapeHtml(names.join("、"))}"` : "";
  return `
    <div class="project-card-consent">
      <div class="consent-pie"
        style="background:conic-gradient(var(--success) 0deg ${agreedDeg}deg, var(--danger) ${agreedDeg}deg ${opposedDeg}deg, #fff ${opposedDeg}deg 360deg)"${nameTitle}>
        <div class="consent-pie-hole">${agreedPct}<span class="consent-pie-unit">%</span></div>
      </div>
      <div class="consent-stats">
        <div class="consent-stat consent-stat-agreed">
          <div class="consent-num">${agreed}<span class="consent-unit">人</span></div>
          <div class="consent-lbl">同意人數</div>
        </div>
        <div class="consent-stat consent-stat-opposed">
          <div class="consent-num">${opposed}<span class="consent-unit">人</span></div>
          <div class="consent-lbl">反對人數</div>
        </div>
        <div class="consent-stat consent-stat-other" title="需回電 / 未決定 / 未接聽">
          <div class="consent-num">${other}<span class="consent-unit">人</span></div>
          <div class="consent-lbl">其他</div>
        </div>
      </div>
    </div>`;
}

// 本週 vs 上週的三個指標(人數/土地/建物同意)比較區塊。
function projectWeeklyCompareHtml(breakdown, lastWeek) {
  const pctOf = (b, agreedKey, totalKey) => {
    const total = b ? b[totalKey] : 0;
    return total > 0 ? (b[agreedKey] / total) * 100 : 0;
  };
  const items = [
    { label: "人數同意", agreedKey: "headcount_agreed", totalKey: "headcount_total" },
    { label: "土地同意", agreedKey: "land_agreed_sqm", totalKey: "land_total_sqm" },
    { label: "建物同意", agreedKey: "building_agreed_sqm", totalKey: "building_total_sqm" },
  ];
  if (!lastWeek) {
    return `
      <div class="project-card-weekly">
        <div class="project-card-weekly-head">📅 本週 vs 上週</div>
        <div class="project-card-weekly-empty">快照累積中,滿一週後才會有比較資料</div>
      </div>`;
  }
  const rowsHtml = items
    .map((it) => {
      const cur = pctOf(breakdown, it.agreedKey, it.totalKey);
      const prev = pctOf(lastWeek, it.agreedKey, it.totalKey);
      const delta = cur - prev;
      const dir = delta > 0.5 ? "up" : delta < -0.5 ? "down" : "flat";
      const arrow = dir === "up" ? "↑" : dir === "down" ? "↓" : "→";
      return `
        <div class="project-card-weekly-item">
          <div class="project-card-weekly-pct">${Math.round(cur)}%</div>
          <div class="project-card-weekly-delta ${dir}">${arrow} ${delta >= 0 ? "+" : ""}${Math.round(delta)}%</div>
          <div class="project-card-weekly-prev">上週 ${Math.round(prev)}%</div>
        </div>`;
    })
    .join("");
  return `
    <div class="project-card-weekly">
      <div class="project-card-weekly-head">📅 本週 vs 上週</div>
      <div class="project-card-weekly-row">${rowsHtml}</div>
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
    "view-mywork",
    "view-new-project",
    "view-project-overview",
    "view-project-detail",
    "view-ocr-batch",
    "view-users",
    "view-loginlogs",
    "view-companydocs",
    "view-news",
    "view-regulations",
    "view-websites",
    "view-faq",
    "view-inventory",
    "view-tools",
    "view-manual",
  ].forEach((v) => {
    const el = document.getElementById(v);
    if (el) el.classList.toggle("hidden", v !== id);
  });
  persistViewState(id);
}

// 記住目前停在哪個畫面(頁面 + 案件 + 分頁),重新整理瀏覽器後 loadCurrentUser() 會
// 用這個復原,不用每次重整都被彈回「都更案件進度總覽」。存 sessionStorage(跟登入
// token 同壽命,關掉分頁/瀏覽器就清掉,不會留著別人下次打開還停在你看過的案件)。
function persistViewState(viewId) {
  try {
    const snapshot = { view: viewId };
    if (viewId === "view-project-detail" && state.currentProjectId) {
      snapshot.projectId = state.currentProjectId;
      snapshot.tab = state.activeTab || "sop";
    }
    if (viewId === "view-project-overview" && state.currentProjectId) {
      snapshot.projectId = state.currentProjectId;
    }
    sessionStorage.setItem("lastView", JSON.stringify(snapshot));
  } catch (e) { /* sessionStorage 不可用(私密瀏覽等)就算了,不影響功能 */ }
}

// 案件詳情頁在 openProject() 呼叫 showView() 當下,state.activeTab 還沒定案(稍後
// 才會設成 "sop" 或由 renderTab() 內部改寫),所以每次分頁實際渲染完成後(見
// renderTab() 尾端)都要再存一次,快照才會是使用者最後停留的那個分頁。
function persistCurrentTabState() {
  if (!document.getElementById("view-project-detail")?.classList.contains("hidden")) {
    persistViewState("view-project-detail");
  }
}

async function restoreLastView() {
  let saved = null;
  try {
    saved = JSON.parse(sessionStorage.getItem("lastView") || "null");
  } catch (e) {
    saved = null;
  }

  // 側欄「案件管理」清單只有 loadDashboard() 會填(renderSidebarProjects)。以前
  // 每次重整一定先進總覽,側欄一定會被建好;現在改成直接復原到其他畫面時,如果不
  // 順便補跑這個,側欄案件清單會整個是空的,要點回總覽才會出現。loadDashboard()
  // 本身不會切換可見畫面/側欄導覽反白(那是 goToDashboard() 才做的事),所以就算
  // 等一下要顯示的是別的畫面,先跑這個也不會讓畫面閃到總覽。
  try {
    await loadDashboard();
  } catch (e) { /* 個別畫面自己會處理載入失敗,這裡失敗不影響後面的畫面復原 */ }

  if (!saved || !saved.view || saved.view === "view-dashboard") {
    setActiveNav("dashboard");
    showView("view-dashboard");
    return;
  }
  try {
    switch (saved.view) {
      case "view-project-overview":
        if (!saved.projectId) {
          setActiveNav("dashboard");
          showView("view-dashboard");
          break;
        }
        await goToProjectOverviewPage(saved.projectId);
        break;
      case "view-project-detail":
        if (!saved.projectId) {
          setActiveNav("dashboard");
          showView("view-dashboard");
          break;
        }
        await openProject(saved.projectId);
        if (saved.tab && saved.tab !== "sop") {
          const tabBtn = document.querySelector(`.tab-btn[data-tab="${saved.tab}"]`);
          if (tabBtn && !tabBtn.classList.contains("hidden")) {
            document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b === tabBtn));
            state.activeTab = saved.tab;
            await renderTab(saved.tab);
          }
        }
        break;
      case "view-mywork":
        await goToMyWork();
        break;
      case "view-users":
        await goToUsers();
        break;
      case "view-loginlogs":
        await goToLoginLogs();
        break;
      case "view-companydocs":
        await goToCompanyDocs();
        break;
      case "view-news":
        await goToNews();
        break;
      case "view-regulations":
        await goToRegulations();
        break;
      case "view-websites":
        await goToWebsites();
        break;
      case "view-faq":
        await goToFaq();
        break;
      case "view-inventory":
        await goToInventory();
        break;
      case "view-tools":
        goToTools();
        break;
      case "view-manual":
        goToManual();
        break;
      default:
        // "view-new-project" / "view-ocr-batch" 這類過渡畫面沒有可復原的內容,回首頁。
        setActiveNav("dashboard");
        showView("view-dashboard");
    }
  } catch (e) {
    goToDashboard();
  }
}

function goToTools() {
  setActiveNav("tools");
  showView("view-tools");
}

function goToManual() {
  setActiveNav("manual");
  showView("view-manual");
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
            <span class="sb-cg-arrow ${open ? "open" : ""}">⌄</span>
          </div>
          <div class="sb-cg-items ${open ? "open" : ""}">
            ${cases
              .map(
                (p) => `
                <div class="sb-case-item" data-project-id="${p.id}">
                  <span class="sb-case-name">${escapeHtml(p.name)}</span>
                  <span class="sb-case-stage">第${p.current_stage}階段</span>
                  <span class="sb-chev">›</span>
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
              ${isEditor() ? `<button type="button" class="project-card-menu-btn" data-project-menu="${p.id}" title="案件選項">⋮</button>` : ""}
            </div>
            <div class="project-card-stage">
              <div class="project-stage-bar">
                ${Array.from({ length: 10 }, (_, i) => `<span class="${i <= p.current_stage ? "filled" : ""}"></span>`).join("")}
              </div>
              <div class="helper-text">第${p.current_stage}階段 · ${escapeHtml(sopStageLabel(p.current_stage))}</div>
            </div>
            ${projectConsentBreakdownHtml(p.visit_breakdown, p.agreed_landowner_names)}
            ${projectWeeklyCompareHtml(p.visit_breakdown, p.last_week_breakdown)}
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
          </div>`
      )
      .join("");

    grid.querySelectorAll(".project-card[data-project-id]").forEach((card) => {
      card.addEventListener("click", () => goToProjectOverviewPage(Number(card.dataset.projectId)));
    });
    document.getElementById("add-project-tile")?.addEventListener("click", goToNewProject);

    grid.querySelectorAll("[data-project-menu]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const target = summary.projects.find((x) => x.id === Number(btn.dataset.projectMenu));
        if (target) toggleProjectCardMenu(btn, target);
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
  const used = new Set();
  try {
    const projects = await api("/projects", { silent: true });
    const prefix = `${year}-`;
    projects.forEach((p) => {
      if (p.project_code && p.project_code.startsWith(prefix)) {
        const seq = Number(p.project_code.slice(prefix.length));
        if (Number.isInteger(seq) && seq > 0) used.add(seq);
      }
    });
  } catch (e) { }
  // Fill the lowest free number so a deleted code (e.g. 2026-001) gets reused
  // instead of the sequence always climbing.
  let seq = 1;
  while (used.has(seq)) seq++;
  return `${year}-${String(seq).padStart(3, "0")}`;
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
  // L2 以上(isManager)可以在建案的同時客製化 SOP 關卡流程,跟案件內 SOP 頁的
  // 「自訂關卡流程」是同一套編輯器 - 這裡先只存在這個 closure 的本地變數,案件建立
  // 成功後才真正呼叫 PUT .../sop/stages(此時案件才有 id)。openSopStageFlowEditor
  // 會用 openModal 蓋掉整個 #modal-root,所以編輯完要用 mountForm() 在同一個
  // closure 裡重繪表單(不能整個重呼叫 goToNewProject,不然 customStageFlow 會重置)。
  let customStageFlow = null;
  const canCustomizeFlow = isManager();

  function flowSummaryText() {
    if (!customStageFlow) return "預設流程(10關)";
    return `已自訂(${customStageFlow.length}關)`;
  }

  function mountForm(prevValues) {
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
        ${canCustomizeFlow
          ? `<div class="field">
               <label>SOP 關卡流程</label>
               <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
                 <span class="helper-text" id="np-flow-summary" style="margin:0">${flowSummaryText()}</span>
                 <button type="button" class="btn-secondary btn-sm" id="np-edit-flow-btn">⚙ 自訂關卡流程</button>
               </div>
             </div>`
          : ""}
        <div class="modal-footer">
          <button type="button" class="btn-secondary" onclick="closeModal()">取消</button>
          <button type="submit" class="btn-primary">建立</button>
        </div>
      </form>`,
      { width: "560px" }
    );

    const city = (prevValues && prevValues.city) || "";
    updateDistrictSelectOptions(city, (prevValues && prevValues.district) || "");
    document.getElementById("np-city").value = city;

    (async () => {
      document.getElementById("np-code").value = (prevValues && prevValues.project_code) || (await suggestNextProjectCode());
    })();
    if (prevValues) {
      ["name", "description"].forEach((k) => {
        const field = document.querySelector(`#project-form [name="${k}"]`);
        if (field && prevValues[k] != null) field.value = prevValues[k];
      });
    }

    document.getElementById("np-city").addEventListener("change", (e) => {
      updateDistrictSelectOptions(e.target.value);
    });

    const editFlowBtn = document.getElementById("np-edit-flow-btn");
    if (editFlowBtn) {
      editFlowBtn.addEventListener("click", () => {
        const form = document.getElementById("project-form");
        const snapshot = Object.fromEntries(new FormData(form).entries());
        const startFrom = customStageFlow || SOP_DEFAULT_STAGE_DEFS;
        openSopStageFlowEditor(startFrom, async (stages) => {
          customStageFlow = stages;
          mountForm(snapshot);
        });
      });
    }

    document.getElementById("project-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const payload = Object.fromEntries(fd.entries());
      payload.expected_completion_date = payload.expected_completion_date || null;
      try {
        const project = await api("/projects", { method: "POST", body: payload });
        if (customStageFlow) {
          try {
            await api(`/projects/${project.id}/sop/stages`, { method: "PUT", body: { stages: customStageFlow } });
          } catch (err) { }
        }
        toast("案件已建立", "success");
        closeModal();
        await loadDashboard();
        await openProject(project.id);
      } catch (err) { }
    });
  }

  mountForm(null);
}

// 案件卡片右上角 ⋮ 的選單 - 直接以下拉方式貼在卡片上,不再開對話框
function closeAllProjectCardMenus() {
  document.querySelectorAll(".project-card-menu-pop").forEach((m) => m.remove());
  document.removeEventListener("click", _onDocClickProjectMenu, true);
  document.removeEventListener("keydown", _onKeyProjectMenu, true);
}
function _onDocClickProjectMenu(e) {
  if (!e.target.closest(".project-card-menu-pop, [data-project-menu]")) closeAllProjectCardMenus();
}
function _onKeyProjectMenu(e) {
  if (e.key === "Escape") closeAllProjectCardMenus();
}
function toggleProjectCardMenu(btn, project) {
  const card = btn.closest(".project-card");
  const alreadyOpen = card && card.querySelector(".project-card-menu-pop");
  closeAllProjectCardMenus();
  if (alreadyOpen || !card) return;

  // 編輯資料 L0~L3(isEditor,對齊後端 require_project_editor)都能用;刪除案件是
  // 不可逆的破壞性操作,維持 L0~L2(isManager,對齊後端 require_project_manager)。
  const pop = document.createElement("div");
  pop.className = "project-card-menu-pop";
  pop.innerHTML = `
    <button type="button" data-pm="edit">✏️ 編輯案件資料</button>
    ${isManager() ? `<button type="button" data-pm="delete" class="danger">🗑️ 刪除案件</button>` : ""}`;
  pop.addEventListener("click", (e) => {
    e.stopPropagation();
    const act = e.target.closest("[data-pm]")?.dataset.pm;
    closeAllProjectCardMenus();
    if (act === "edit") openProjectEditModal(project.id);
    else if (act === "delete") openDeleteProjectModal(project);
  });
  card.appendChild(pop);
  setTimeout(() => {
    document.addEventListener("click", _onDocClickProjectMenu, true);
    document.addEventListener("keydown", _onKeyProjectMenu, true);
  }, 0);
}

async function openProjectEditModal(projectId) {
  let p;
  try {
    p = await api(`/projects/${projectId}`);
  } catch (e) {
    return;
  }
  let docs = [];
  try {
    docs = await api(`/projects/${projectId}/documents`, { silent: true });
  } catch (e) { }
  // 文件說明裡的地號/建號摘要 - 提供在「備註」欄快速帶入 (去掉「謄本掃描匯入 - 」前綴)
  const noteSuggestions = [
    ...new Set(
      (docs || [])
        .map((d) => (d.description || "").replace(/^謄本掃描匯入\s*-\s*/, "").trim())
        .filter((s) => s && s !== "謄本掃描匯入")
    ),
  ];
  const noteFillHtml = noteSuggestions.length
    ? `<select id="pe-note-fill" style="margin-bottom:6px">
         <option value="">— 從文件地號帶入… —</option>
         ${noteSuggestions.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("")}
       </select>`
    : "";

  const cityOptions =
    `<option value="">請選擇</option>` +
    TAIWAN_CITIES.map((c) => `<option value="${c}" ${c === (p.city || "") ? "selected" : ""}>${c}</option>`).join("");
  openModal(
    "編輯案件資料",
    `
    <form id="project-edit-form">
      <div class="field-row">
        <div class="field"><label>縣市</label><select name="city" id="np-city">${cityOptions}</select></div>
        <div class="field"><label>行政區</label><select name="district" id="np-district" disabled><option value="">請先選擇縣市</option></select></div>
      </div>
      <div class="field-row">
        <div class="field"><label>案件代碼</label><input name="project_code" value="${escapeHtml(p.project_code || "")}" required></div>
        <div class="field"><label>案件名稱</label><input name="name" value="${escapeHtml(p.name || "")}" required></div>
      </div>
      <div class="field"><label>案件地址</label><input name="address" value="${escapeHtml(p.address || "")}"></div>
      <div class="field"><label>案件類型</label><input name="case_type" value="${escapeHtml(p.case_type || "")}" placeholder="例:都市更新(權利變換)"></div>
      <div class="field"><label>預計完成日</label><input type="date" name="expected_completion_date" value="${p.expected_completion_date || ""}"></div>
      <div class="field"><label>備註</label>${noteFillHtml}<textarea name="description" id="pe-note" rows="3">${escapeHtml(p.description || "")}</textarea></div>
      <div class="field"><label>案件簡介</label><textarea name="summary" rows="4" placeholder="案件總覽頁顯示的簡介段落,例如基地面積、預計興建規模等">${escapeHtml(p.summary || "")}</textarea></div>
      <div class="field">
        <label>封面圖(案件總覽頁用)</label>
        <div id="pe-cover-preview" style="margin-bottom:8px">
          ${p.has_cover_image ? `<img id="pe-cover-img" style="max-width:220px;max-height:140px;border-radius:8px;display:block;object-fit:cover">` : `<span class="helper-text">尚未上傳封面圖</span>`}
        </div>
        <input type="file" id="pe-cover-file" accept="image/*">
        ${p.has_cover_image ? `<button type="button" class="btn-link btn-sm" id="pe-cover-remove-btn" style="margin-top:4px">移除封面圖</button>` : ""}
      </div>
      <div class="modal-footer">
        <button type="button" class="btn-secondary" onclick="closeModal()">取消</button>
        <button type="submit" class="btn-primary">儲存</button>
      </div>
    </form>`,
    { width: "560px" }
  );

  updateDistrictSelectOptions(p.city || "", p.district || "");
  document.getElementById("np-city").addEventListener("change", (e) => {
    updateDistrictSelectOptions(e.target.value);
  });

  const loadCoverPreview = async () => {
    const img = document.getElementById("pe-cover-img");
    if (!img) return;
    try {
      const res = await api(`/projects/${projectId}/cover-image`, { silent: true });
      img.src = URL.createObjectURL(await res.blob());
    } catch (e) { }
  };
  loadCoverPreview();

  document.getElementById("pe-cover-file")?.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    try {
      await api(`/projects/${projectId}/cover-image`, { method: "POST", body: fd, isForm: true });
      toast("封面圖已更新", "success");
      await loadDashboard();
      refreshOverviewPageIfOpen(projectId);
      // 剛上傳完馬上重開一次編輯視窗,順便讓「移除封面圖」按鈕出現(第一次上傳前
      // has_cover_image 是 false,按鈕不存在)。
      closeModal();
      openProjectEditModal(projectId);
    } catch (err) { }
  });

  document.getElementById("pe-cover-remove-btn")?.addEventListener("click", async () => {
    try {
      await api(`/projects/${projectId}/cover-image`, { method: "DELETE" });
      toast("封面圖已移除", "success");
      await loadDashboard();
      refreshOverviewPageIfOpen(projectId);
      closeModal();
      openProjectEditModal(projectId);
    } catch (err) { }
  });

  const noteFill = document.getElementById("pe-note-fill");
  if (noteFill) {
    noteFill.addEventListener("change", () => {
      if (!noteFill.value) return;
      const ta = document.getElementById("pe-note");
      ta.value = ta.value.trim() ? `${ta.value.trim()}\n${noteFill.value}` : noteFill.value;
      noteFill.value = "";
    });
  }

  document.getElementById("project-edit-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = Object.fromEntries(new FormData(e.target).entries());
    payload.expected_completion_date = payload.expected_completion_date || null;
    try {
      const updated = await api(`/projects/${projectId}`, { method: "PATCH", body: payload });
      toast("案件資料已更新", "success");
      closeModal();
      if (state.currentProjectId === projectId) {
        state.currentProject = updated;
        renderProjectHeader(updated);
      }
      await loadDashboard();
      refreshOverviewPageIfOpen(projectId);
    } catch (err) { }
  });
}

// 案件資料(名稱/簡介/封面圖等)被編輯後,如果使用者當下就停在案件總覽頁,要跟著
// 重新整理(名稱/總覽卡片裡的簡介、封面圖都可能變了),不然要手動切出去再切回來
// 才看得到最新的。SOP 進度頁那邊已經有 renderProjectHeader() 各自處理,這裡只管
// 總覽頁那份。
function refreshOverviewPageIfOpen(projectId) {
  if (state.currentProjectId !== projectId) return;
  if (document.getElementById("view-project-overview")?.classList.contains("hidden")) return;
  goToProjectOverviewPage(projectId);
}

// 首頁「都更案件進度總覽」卡片的落地頁 —— 獨立的一個 view(view-project-overview),
// 沒有分頁列,跟 openProject() 進去的案件管理分頁頁面(view-project-detail)是完全不同
// 的兩個畫面,不是同一頁裡切分頁/藏分頁列而已。要看 SOP 進度等其他內容,總覽頁面上
// 的「進入案件管理」按鈕會呼叫 openProject() 換到另一個畫面。
async function goToProjectOverviewPage(id) {
  state.currentProjectId = id;
  state.projectCache[id] = state.projectCache[id] || {};
  // 故意不呼叫 setActiveSidebarCase() - 側欄「案件管理」清單反白代表「目前正在那個
  // 案件的 SOP 進度頁面」,這裡是不同的獨立總覽頁,反白側欄項目會讓使用者誤以為
  // 兩個入口其實是同一頁,維持「都更案件進度總覽」這個總覽入口反白就好。
  setActiveNav("dashboard");
  showView("view-project-overview");

  try {
    const project = await api(`/projects/${id}`);
    state.currentProject = project;
    const nameEl = document.getElementById("pov-name");
    const badgeEl = document.getElementById("pov-status-badge");
    if (nameEl) {
      nameEl.textContent = project.name;
      nameEl.title = `${project.name} (${project.project_code})`;
    }
    if (badgeEl) {
      badgeEl.innerHTML =
        `<span class="status-badge status-${project.status}">${PROJECT_STATUS_LABEL[project.status] || project.status}</span>` +
        (project.is_force_closed ? ` <span class="mini-badge alert">強制結案</span>` : "");
    }
  } catch (e) {
    goToDashboard();
    return;
  }

  const el = document.getElementById("project-overview-content");
  if (el) await renderProjectOverviewTab(el);
}

// 案件管理的分頁頁面(SOP進度/整合清冊等)- 側欄「案件管理」清單、新建案件、OCR匯入
// 完成導回都走這裡。首頁「都更案件進度總覽」的案件卡片改走 goToProjectOverviewPage()
// (獨立的案件總覽頁,不是這個分頁頁面裡的其中一個分頁),兩個入口是真的不同頁面。
async function openProject(id, defaultTab = "sop") {
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

  // 地主帳號:只保留 SOP 進度 / 土地登記 / 建物登記 / 聯絡紀錄 / 土增稅,其餘分頁隱藏
  const landownerHiddenTabs = ["buildingview", "documents", "encumbrances", "expenses", "members", "development"];
  const initialTab = isLandowner() && landownerHiddenTabs.includes(defaultTab) ? "sop" : defaultTab;
  document.querySelectorAll(".tab-btn[data-tab]").forEach((btn) => {
    const hideForLandowner = isLandowner() && landownerHiddenTabs.includes(btn.dataset.tab);
    btn.classList.toggle("hidden", hideForLandowner);
    btn.classList.toggle("active", btn.dataset.tab === initialTab);
  });
  // 「人員」分頁本身已經在上面的 landownerHiddenTabs 迴圈處理過(只有地主看不到,
  // 其餘 L0~L5 都能看)- 頁籤內能不能新增/移除人員,由 renderMembersTab 自己依
  // isEditor()(L0~L3)決定,L4/L5 進來是唯讀。
  state.activeTab = initialTab;
  // renderTab() 本身現在就會刷新公告卡片,這裡不用再額外呼叫一次。
  await Promise.all([renderTab(state.activeTab), renderSopSummary()]);
}

function renderProjectHeader(p) {
  const nameEl = document.getElementById("pd-name");
  const subEl = document.getElementById("pd-sub");
  const badgeEl = document.getElementById("pd-status-badge");

  if (nameEl) {
    const fullName = `${p.name} (${p.project_code})${p.description ? ` · ${p.description}` : ""}`;
    nameEl.textContent = fullName;
    // 標題現在強制一行顯示、太長會用「...」截斷(見 style.css .project-header h2)
    // - 補個 title 屬性,滑鼠移上去還是看得到完整名稱。
    nameEl.title = fullName;
  }
  if (subEl) subEl.textContent = [p.district, p.address].filter(Boolean).join(" · ") || "—";
  if (badgeEl) {
    badgeEl.innerHTML =
      `<span class="status-badge status-${p.status}">${PROJECT_STATUS_LABEL[p.status] || p.status}</span>` +
      (p.is_force_closed ? ` <span class="mini-badge alert">強制結案</span>` : "");
  }
}

// 切換分頁列的哪個按鈕反白 + 渲染對應內容 - 一般點分頁列按鈕走這個,
// project_overview.js 的「進入案件管理」連結也是呼叫這個切到 SOP 進度分頁。
async function switchProjectTab(tab) {
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  state.activeTab = tab;
  await renderTab(tab);
}

async function renderTab(tab) {
  const el = document.getElementById("tab-content");
  if (!el) return;
  // 土地登記 / 建物登記已併入「整合清冊」分頁的檢視切換下拉。舊的 "buildings" 進入點
  // (例如建物謄本匯入後)導到整合清冊並預設顯示建物登記檢視。
  if (tab === "buildings") {
    state.integratedViewMode = "building";
    tab = "integrated";
    document.querySelectorAll(".tab-btn[data-tab]").forEach((b) => b.classList.toggle("active", b.dataset.tab === "integrated"));
  }
  // 地主帳號不得進入被隱藏的分頁(即使透過殘留狀態)
  if (isLandowner() && ["buildingview", "documents", "encumbrances", "expenses", "members", "development"].includes(tab)) {
    tab = "sop";
    document.querySelectorAll(".tab-btn[data-tab]").forEach((b) => b.classList.toggle("active", b.dataset.tab === "sop"));
  }
  // 有些呼叫端(例如各分頁自己動作完後 renderTab("expenses") 導回列表)不會先手動
  // 同步 state.activeTab,這裡統一補上,讓它永遠等於實際渲染出來的分頁 - 重整還原
  // 進度(persistCurrentTabState)才讀得到準確值。
  state.activeTab = tab;
  el.innerHTML = `<div class="empty-state">載入中...</div>`;
  const renderers = {
    sop: renderSopTab,
    integrated: renderIntegratedRosterTab,
    buildingview: renderBuildingViewTab,
    contacts: renderContactsTab,
    documents: renderDocumentsTab,
    encumbrances: renderEncumbrancesTab,
    expenses: renderExpensesTab,
    landvaluetax: renderLandValueTaxTab,
    members: renderMembersTab,
    development: renderDevelopmentTab,
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
  // 每次切分頁都順便刷新「公告 / 進度通知」卡片 - 案件裡幾乎每個動作(新增/刪除
  // 支出、上傳文件…)完成後都會呼叫 renderTab() 導回列表,這樣公告卡片才會跟著看到
  // 最新一筆自動紀錄,不用使用者手動整理頁面才看得到。
  renderProjectBoardCard();
  persistCurrentTabState();
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

  const backToDashboardOverviewBtn = document.getElementById("back-to-dashboard-from-overview");
  if (backToDashboardOverviewBtn) {
    backToDashboardOverviewBtn.addEventListener("click", goToDashboard);
  }

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchProjectTab(btn.dataset.tab));
  });
}
