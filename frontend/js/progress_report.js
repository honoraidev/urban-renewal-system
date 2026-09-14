"use strict";

// 都更進度報表 —— 彙整 /projects/dashboard-summary 的真實案件資料(關卡、同意度、
// 提醒分級、行政區、負責人),不使用假資料。沒有起訖日資料可支撐甘特圖,詳情面板
// 改用「SOP 十關」勾選清單呈現真實進度,而不是虛構時程。

const PR_CHART_COLORS = ["#42cbd0", "#2fae72", "#e2a13c", "#e6584f", "#6366f1", "#ec4899", "#0ea5e9", "#94a3b8"];

const progressReportState = {
  loaded: false,
  projects: [], // DashboardProjectItem[]
  projectDetailsById: {}, // 補充 ProjectRead(建立日期等),detail 面板才拉,懶載入
  filters: { status: "", stage: "", handler: "", district: "", project: "", q: "" },
  selectedId: null,
  detailTab: "overview",
};

function prTierOf(p) {
  if (p.status === "closed") return "closed";
  if (p.status === "suspended") return "suspended";
  if (p.urgent_count > 0) return "urgent";
  if (p.warning_count > 0) return "warning";
  return "ok";
}

const PR_TIER_LABEL = { ok: "正常進行", warning: "有風險", urgent: "已延遲", suspended: "暫停中", closed: "已結案" };
const PR_TIER_BADGE_CLASS = { ok: "status-active", warning: "status-suspended", urgent: "status-closed", suspended: "status-suspended", closed: "status-closed" };

function initProgressReport() {
  ["pr-f-status", "pr-f-stage", "pr-f-handler", "pr-f-district", "pr-f-project"].forEach((id) => {
    document.getElementById(id)?.addEventListener("change", (e) => {
      const key = id.replace("pr-f-", "");
      progressReportState.filters[key] = e.target.value;
      renderProgressReportBody();
    });
  });
  const qInput = document.getElementById("pr-f-q");
  if (qInput) {
    qInput.addEventListener("input", (e) => {
      progressReportState.filters.q = e.target.value.trim().toLowerCase();
      renderProgressReportBody();
    });
  }
}

async function goToProgressReport() {
  setActiveNav("progressreport");
  showView("view-progress-report");
  await loadProgressReport();
}

async function loadProgressReport() {
  const statRow = document.getElementById("pr-stat-row");
  const tableWrap = document.getElementById("pr-table-wrap");
  if (statRow) statRow.innerHTML = `<div class="empty-state">載入中...</div>`;
  if (tableWrap) tableWrap.innerHTML = "";

  try {
    const summary = await api("/projects/dashboard-summary");
    progressReportState.projects = summary.projects || [];
    progressReportState.loaded = true;
  } catch (e) {
    if (statRow) statRow.innerHTML = "";
    if (tableWrap) tableWrap.innerHTML = `<div class="empty-state">載入失敗</div>`;
    return;
  }

  populateProgressReportFilterOptions();
  renderProgressReportBody();
}

function populateProgressReportFilterOptions() {
  const stageSel = document.getElementById("pr-f-stage");
  const handlerSel = document.getElementById("pr-f-handler");
  const districtSel = document.getElementById("pr-f-district");
  if (!stageSel || !handlerSel || !districtSel) return;

  const stages = [...new Set(progressReportState.projects.map((p) => p.current_stage))].sort((a, b) => a - b);
  const keepValue = (sel, buildOptions) => {
    const prev = sel.value;
    sel.innerHTML = `<option value="">全部</option>` + buildOptions();
    if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
  };

  keepValue(stageSel, () => stages.map((s) => `<option value="${s}">第${s}關 · ${escapeHtml(sopStageLabel(s))}</option>`).join(""));

  const handlers = [...new Set(progressReportState.projects.flatMap((p) => [p.case_handler_name, p.case_manager_name]).filter(Boolean))].sort();
  keepValue(handlerSel, () => handlers.map((h) => `<option value="${escapeHtml(h)}">${escapeHtml(h)}</option>`).join(""));

  const districts = [...new Set(progressReportState.projects.map((p) => p.district).filter(Boolean))].sort();
  keepValue(districtSel, () => districts.map((d) => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join(""));
}

// excludeKeys:算「案件名稱」下拉自己選項用的 —— 那格要跟著其他篩選條件(行政區等)
// 一起縮小範圍,但不能被自己的選值篩掉自己,不然選了行政區之後選單只剩「全部」。
function progressReportFilteredProjects(excludeKeys = []) {
  const f = progressReportState.filters;
  return progressReportState.projects.filter((p) => {
    if (!excludeKeys.includes("status") && f.status && p.status !== f.status) return false;
    if (!excludeKeys.includes("stage") && f.stage !== "" && String(p.current_stage) !== String(f.stage)) return false;
    if (!excludeKeys.includes("handler") && f.handler && p.case_handler_name !== f.handler && p.case_manager_name !== f.handler) return false;
    if (!excludeKeys.includes("district") && f.district && p.district !== f.district) return false;
    if (!excludeKeys.includes("project") && f.project && String(p.id) !== f.project) return false;
    if (!excludeKeys.includes("q") && f.q && !`${p.name} ${p.project_code} ${p.district || ""} ${p.city || ""}`.toLowerCase().includes(f.q)) return false;
    return true;
  });
}

// 「案件名稱」下拉的選項要跟著其他篩選條件(行政區/案件狀態/階段/負責人)即時縮小,
// 不然選了行政區之後,案件名稱選單還是列出全部案件,選了也選不到那個行政區的案子。
function populateProjectNameOptions() {
  const projectSel = document.getElementById("pr-f-project");
  if (!projectSel) return;
  const candidates = [...progressReportFilteredProjects(["project"])].sort((a, b) =>
    a.name.localeCompare(b.name, "zh-Hant")
  );
  const prev = projectSel.value;
  projectSel.innerHTML =
    `<option value="">全部</option>` +
    candidates.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
  if ([...projectSel.options].some((o) => o.value === prev)) {
    projectSel.value = prev;
  } else {
    // 目前選的案件被其他篩選條件濾掉了(比如選了別的行政區)- 選單重置回「全部」,
    // state 也要跟著清空,不然畫面顯示「全部」但篩選條件裡還殘留舊的 project id。
    projectSel.value = "";
    progressReportState.filters.project = "";
  }
}

function renderProgressReportBody() {
  populateProjectNameOptions();
  const filtered = progressReportFilteredProjects();

  // 統計卡/圖表/列表一律用篩選後的結果 —— 選了特定案件名稱或行政區之後,下方每一
  // 塊看到的都只會是那個篩選範圍內的資訊,不會卡片顯示全部案件數字、下面表格卻只
  // 剩一筆這種兜不起來的情況。
  renderProgressReportStats(filtered);
  renderProgressReportCharts(filtered);
  renderProgressReportTable(filtered);

  const title = document.getElementById("pr-table-title");
  if (title) title.textContent = `案件列表（共 ${filtered.length} 筆）`;

  // 篩選後若選取的案件不在名單裡，收起詳情面板
  if (progressReportState.selectedId && !filtered.some((p) => p.id === progressReportState.selectedId)) {
    progressReportState.selectedId = null;
  }
  renderProgressReportDetailPanel();
}

function renderProgressReportStats(all) {
  const row = document.getElementById("pr-stat-row");
  if (!row) return;

  const total = all.length;
  const active = all.filter((p) => p.status === "active").length;
  const delayed = all.filter((p) => prTierOf(p) === "urgent").length;
  const pendingItems = all.reduce((sum, p) => sum + p.reminder_count + p.warning_count + p.urgent_count, 0);
  const closed = all.filter((p) => p.status === "closed").length;

  const items = [
    { icon: "📁", num: total, label: "案件總數", accent: "accent-brand" },
    { icon: "▶️", num: active, label: "進行中案件", sub: total ? `${Math.round((active / total) * 100)}%` : "", accent: "accent-success" },
    { icon: "⏰", num: delayed, label: "延遲案件", sub: total ? `${Math.round((delayed / total) * 100)}%` : "", accent: "accent-danger" },
    { icon: "❗", num: pendingItems, label: "待處理事項", accent: "accent-info" },
    { icon: "✅", num: closed, label: "已完成案件", sub: total ? `${Math.round((closed / total) * 100)}%` : "", accent: "accent-success" },
  ];

  row.innerHTML = items
    .map(
      (it) => `
      <div class="dashboard-stat-item ${it.accent}">
        <div class="dashboard-stat-icon">${it.icon}</div>
        <div>
          <div class="dashboard-stat-num">${it.num}${it.sub ? ` <span class="pr-stat-sub">${it.sub}</span>` : ""}</div>
          <div class="dashboard-stat-lbl">${it.label}</div>
        </div>
      </div>`
    )
    .join("");
}

function prMultiDonutSvg(segments, size = 140, strokeWidth = 22) {
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  const r = size / 2 - strokeWidth / 2;
  const c = size / 2;
  const circumference = 2 * Math.PI * r;
  let offset = 0;
  const circles = !total
    ? `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="var(--surface-2)" stroke-width="${strokeWidth}"/>`
    : segments
        .filter((seg) => seg.value > 0)
        .map((seg) => {
          const len = (seg.value / total) * circumference;
          const dash = `${len} ${circumference - len}`;
          const circle = `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${seg.color}" stroke-width="${strokeWidth}"
            stroke-dasharray="${dash}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${c} ${c})"/>`;
          offset += len;
          return circle;
        })
        .join("");
  return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${circles}
    <text x="${c}" y="${c - 6}" text-anchor="middle" font-size="22" font-weight="800" fill="var(--text-main)">${total}</text>
    <text x="${c}" y="${c + 14}" text-anchor="middle" font-size="11" fill="var(--text-muted)">案件總數</text>
  </svg>`;
}

function prLegendHtml(segments) {
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  return segments
    .map(
      (seg) => `
      <div class="pr-legend-row">
        <span class="pr-legend-dot" style="background:${seg.color}"></span>
        <span class="pr-legend-label">${escapeHtml(seg.label)}</span>
        <span class="pr-legend-value">${seg.value} ${total ? `(${Math.round((seg.value / total) * 100)}%)` : ""}</span>
      </div>`
    )
    .join("");
}

function renderProgressReportCharts(filtered) {
  const grid = document.getElementById("pr-chart-grid");
  if (!grid) return;

  if (!filtered.length) {
    grid.innerHTML = `<div class="card"><div class="empty-state">沒有符合篩選條件的案件</div></div>`;
    return;
  }

  // 案件階段分布
  const stageCounts = {};
  filtered.forEach((p) => { stageCounts[p.current_stage] = (stageCounts[p.current_stage] || 0) + 1; });
  const stageSegments = Object.keys(stageCounts)
    .sort((a, b) => Number(a) - Number(b))
    .map((stage, i) => ({ label: `第${stage}關 · ${sopStageLabel(stage)}`, value: stageCounts[stage], color: PR_CHART_COLORS[i % PR_CHART_COLORS.length] }));

  // 行政區分布
  const districtCounts = {};
  filtered.forEach((p) => { const key = p.district || p.city || "未分類"; districtCounts[key] = (districtCounts[key] || 0) + 1; });
  const districtEntries = Object.entries(districtCounts).sort((a, b) => b[1] - a[1]);
  const maxDistrict = Math.max(...districtEntries.map(([, v]) => v), 1);

  // 案件狀態統計
  const tierCounts = { ok: 0, warning: 0, urgent: 0, suspended: 0, closed: 0 };
  filtered.forEach((p) => { tierCounts[prTierOf(p)]++; });
  const tierColors = { ok: "var(--success)", warning: "var(--warning)", urgent: "var(--danger)", suspended: "#94a3b8", closed: "var(--text-muted)" };
  const tierSegments = Object.entries(tierCounts)
    .filter(([, v]) => v > 0)
    .map(([k, v]) => ({ label: PR_TIER_LABEL[k], value: v, color: tierColors[k] }));

  grid.innerHTML = `
    <div class="card pr-chart-card">
      <div class="pr-chart-title">案件階段分布</div>
      <div class="pr-chart-body">
        ${prMultiDonutSvg(stageSegments)}
        <div class="pr-legend">${prLegendHtml(stageSegments)}</div>
      </div>
    </div>
    <div class="card pr-chart-card">
      <div class="pr-chart-title">行政區分布</div>
      <div class="pr-bar-chart">
        ${districtEntries
          .map(
            ([label, value]) => `
            <div class="pr-bar-row">
              <span class="pr-bar-label">${escapeHtml(label)}</span>
              <div class="pr-bar-track"><div class="pr-bar-fill" style="width:${(value / maxDistrict) * 100}%"></div></div>
              <span class="pr-bar-value">${value}</span>
            </div>`
          )
          .join("")}
      </div>
    </div>
    <div class="card pr-chart-card">
      <div class="pr-chart-title">案件狀態統計</div>
      <div class="pr-chart-body">
        ${prMultiDonutSvg(tierSegments)}
        <div class="pr-legend">${prLegendHtml(tierSegments)}</div>
      </div>
    </div>
  `;
}

function renderProgressReportTable(filtered) {
  const wrap = document.getElementById("pr-table-wrap");
  if (!wrap) return;

  if (!filtered.length) {
    wrap.innerHTML = `<div class="empty-state">沒有符合篩選條件的案件</div>`;
    return;
  }

  wrap.innerHTML = `
    <table class="pr-table">
      <thead>
        <tr>
          <th>案件編號</th><th>案件名稱</th><th>行政區</th><th>案件階段</th>
          <th>同意度(人數/土地)</th><th>預計完成日</th><th>負責人</th><th>狀態</th><th>更新時間</th><th style="text-align:right">操作</th>
        </tr>
      </thead>
      <tbody>
        ${filtered
          .map((p) => {
            const tier = prTierOf(p);
            const handler = [p.case_handler_name, p.case_manager_name].filter(Boolean).join(" / ") || "—";
            return `
            <tr class="pr-table-row ${progressReportState.selectedId === p.id ? "selected" : ""}" data-pr-row="${p.id}">
              <td class="project-code">${escapeHtml(p.project_code)}</td>
              <td>${escapeHtml(p.name)}</td>
              <td>${escapeHtml(p.district || p.city || "—")}</td>
              <td>
                <div class="project-stage-bar" style="margin-bottom:2px">
                  ${Array.from({ length: 10 }, (_, i) => `<span class="${i <= p.current_stage ? "filled" : ""}"></span>`).join("")}
                </div>
                <div class="helper-text" style="margin-top:0">第${p.current_stage}關 · ${escapeHtml(sopStageLabel(p.current_stage))}</div>
              </td>
              <td>${fmtPct(p.headcount_ratio)} / ${fmtPct(p.land_share_ratio)}</td>
              <td>${p.expected_completion_date ? fmtDate(p.expected_completion_date) : "—"}</td>
              <td>${escapeHtml(handler)}</td>
              <td><span class="status-badge ${PR_TIER_BADGE_CLASS[tier]}">${PR_TIER_LABEL[tier]}</span></td>
              <td>${fmtDate(p.updated_at)}</td>
              <td style="text-align:right"><button type="button" class="btn-secondary btn-sm" data-pr-view="${p.id}">查看</button></td>
            </tr>`;
          })
          .join("")}
      </tbody>
    </table>`;

  wrap.querySelectorAll("[data-pr-row]").forEach((row) => {
    row.addEventListener("click", (e) => {
      if (e.target.closest("[data-pr-view]")) return;
      selectProgressReportProject(Number(row.dataset.prRow));
    });
  });
  wrap.querySelectorAll("[data-pr-view]").forEach((btn) => {
    btn.addEventListener("click", () => selectProgressReportProject(Number(btn.dataset.prView)));
  });
}

function selectProgressReportProject(id) {
  progressReportState.selectedId = progressReportState.selectedId === id ? null : id;
  progressReportState.detailTab = "overview";
  document.querySelectorAll("[data-pr-row]").forEach((row) => {
    row.classList.toggle("selected", Number(row.dataset.prRow) === progressReportState.selectedId);
  });
  renderProgressReportDetailPanel();
  if (progressReportState.selectedId) {
    document.getElementById("pr-detail-panel")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

async function renderProgressReportDetailPanel() {
  const panel = document.getElementById("pr-detail-panel");
  if (!panel) return;

  const id = progressReportState.selectedId;
  if (!id) { panel.innerHTML = ""; return; }

  const p = progressReportState.projects.find((x) => x.id === id);
  if (!p) { panel.innerHTML = ""; return; }

  if (!progressReportState.projectDetailsById[id]) {
    try {
      progressReportState.projectDetailsById[id] = await api(`/projects/${id}`);
    } catch (e) {
      progressReportState.projectDetailsById[id] = null;
    }
  }
  const full = progressReportState.projectDetailsById[id];

  const tabs = [
    { key: "overview", label: "基本資料" },
    { key: "sop", label: "SOP 進度" },
    { key: "alerts", label: "地主與提醒" },
  ];

  panel.innerHTML = `
    <div class="card pr-detail-card">
      <div class="pr-detail-head">
        <div>
          <h3 style="margin:0">${escapeHtml(p.name)}</h3>
          <div class="helper-text" style="margin-top:4px">${escapeHtml(p.project_code)} · ${escapeHtml(p.district || p.city || "—")}</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <span class="status-badge ${PR_TIER_BADGE_CLASS[prTierOf(p)]}">${PR_TIER_LABEL[prTierOf(p)]}</span>
          <button type="button" class="btn-primary btn-sm" id="pr-open-project-btn">前往案件完整頁面</button>
          <button type="button" class="btn-secondary btn-sm" id="pr-close-detail-btn">✕</button>
        </div>
      </div>
      <div class="tab-bar">
        ${tabs.map((t) => `<button type="button" class="tab-btn ${progressReportState.detailTab === t.key ? "active" : ""}" data-pr-tab="${t.key}">${t.label}</button>`).join("")}
      </div>
      <div id="pr-detail-tab-content">${renderProgressReportDetailTab(progressReportState.detailTab, p, full)}</div>
    </div>`;

  panel.querySelector("#pr-open-project-btn")?.addEventListener("click", () => openProject(id));
  panel.querySelector("#pr-close-detail-btn")?.addEventListener("click", () => selectProgressReportProject(id));
  panel.querySelectorAll("[data-pr-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      progressReportState.detailTab = btn.dataset.prTab;
      renderProgressReportDetailPanel();
    });
  });
}

function renderProgressReportDetailTab(tab, p, full) {
  if (tab === "sop") {
    return `
      <div class="pr-stage-list">
        ${Array.from({ length: 10 }, (_, stage) => {
          const stageState = stage < p.current_stage ? "done" : stage === p.current_stage ? "current" : "pending";
          const icon = stageState === "done" ? "✅" : stageState === "current" ? "🔵" : "⚪";
          return `
            <div class="pr-stage-item pr-stage-${stageState}">
              <span class="pr-stage-icon">${icon}</span>
              <span class="pr-stage-name">第${stage}關 · ${escapeHtml(sopStageLabel(stage))}</span>
              <span class="pr-stage-state">${stageState === "done" ? "已完成" : stageState === "current" ? `進行中` : "尚未開始"}</span>
            </div>`;
        }).join("")}
      </div>`;
  }

  if (tab === "alerts") {
    return `
      <div class="pr-detail-grid">
        <div class="pr-detail-metric"><div class="pr-detail-metric-num">${fmtPct(p.headcount_ratio)}</div><div class="helper-text">人數同意度</div></div>
        <div class="pr-detail-metric"><div class="pr-detail-metric-num">${fmtPct(p.land_share_ratio)}</div><div class="helper-text">土地同意度</div></div>
        <div class="pr-detail-metric"><div class="pr-detail-metric-num">${fmtPct(p.building_share_ratio)}</div><div class="helper-text">建物同意度</div></div>
      </div>
      <div class="pr-detail-tiers">
        <span class="tier-badge tier-reminder">▲ 提醒：${p.reminder_count}</span>
        <span class="tier-badge tier-warning">▲ 警示：${p.warning_count}</span>
        <span class="tier-badge tier-urgent">▲ 緊急：${p.urgent_count}</span>
      </div>
      <p class="helper-text" style="margin-top:12px">依地主最後聯絡天數分級，詳細名單請至案件的「地主聯絡簿」頁籤查看。</p>`;
  }

  // overview
  return `
    ${full ? prTimelineBarHtml(full.created_at, p.expected_completion_date, p.current_stage) : ""}
    <div class="pr-detail-grid">
      <div><div class="helper-text">案件編號</div><div>${escapeHtml(p.project_code)}</div></div>
      <div><div class="helper-text">行政區</div><div>${escapeHtml([p.city, p.district].filter(Boolean).join(" ") || "—")}</div></div>
      <div><div class="helper-text">目前關卡</div><div>第${p.current_stage}關 · ${escapeHtml(sopStageLabel(p.current_stage))}</div></div>
      <div><div class="helper-text">負責人</div><div>${escapeHtml(p.case_handler_name || "—")}</div></div>
      <div><div class="helper-text">主管</div><div>${escapeHtml(p.case_manager_name || "—")}</div></div>
      <div><div class="helper-text">地號 / 建號數</div><div>${p.land_record_count} / ${p.building_record_count}</div></div>
      ${full ? `<div><div class="helper-text">建立日期</div><div>${fmtDate(full.created_at)}</div></div>` : ""}
      <div><div class="helper-text">預計完成日</div><div>${p.expected_completion_date ? fmtDate(p.expected_completion_date) : "未設定"}</div></div>
      ${full && full.address ? `<div><div class="helper-text">地址</div><div>${escapeHtml(full.address)}</div></div>` : ""}
    </div>`;
}

// 簡化版時程進度條 —— 沒有每一關的起訖日期資料(SOP 十關只有勾選完成/未完成),
// 做不出真正的甘特圖,所以只能用「案件建立日 → 預計完成日」這一條時間軸,疊上
// 「時間已過幾成」跟「關卡實際走到幾成」兩條刻度,方便一眼比較進度是超前還落後。
// 沒填預計完成日就不畫,不要瞎猜一個日期出來騙自己。
function prTimelineBarHtml(createdAt, expectedDate, currentStage) {
  if (!expectedDate) {
    return `<div class="pr-timeline-empty helper-text">尚未設定「預計完成日」，無法顯示時程進度條。可到「案件一覽」卡片選單的「編輯案件資料」補上。</div>`;
  }
  const start = new Date(createdAt);
  const end = new Date(expectedDate);
  const now = new Date();
  const totalMs = end - start;
  const timePct = totalMs > 0 ? Math.max(0, Math.min(100, ((now - start) / totalMs) * 100)) : 100;
  const stagePct = Math.round((currentStage / 9) * 100);
  const overdue = now > end && stagePct < 100;

  return `
    <div class="pr-timeline">
      <div class="pr-timeline-row">
        <span class="pr-timeline-label">時間進度</span>
        <div class="pr-timeline-track">
          <div class="pr-timeline-fill pr-timeline-fill-time" style="width:${timePct}%"></div>
        </div>
        <span class="pr-timeline-pct">${Math.round(timePct)}%</span>
      </div>
      <div class="pr-timeline-row">
        <span class="pr-timeline-label">關卡進度</span>
        <div class="pr-timeline-track">
          <div class="pr-timeline-fill pr-timeline-fill-stage" style="width:${stagePct}%"></div>
        </div>
        <span class="pr-timeline-pct">${stagePct}%</span>
      </div>
      <div class="pr-timeline-dates">
        <span>案件建立：${fmtDate(createdAt)}</span>
        ${overdue ? `<span class="pr-timeline-overdue">⚠ 已超過預計完成日，關卡進度落後</span>` : ""}
        <span>預計完成：${fmtDate(expectedDate)}</span>
      </div>
    </div>`;
}
