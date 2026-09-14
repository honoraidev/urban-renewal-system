"use strict";

// 都更進度報表 —— 彙整 /projects/dashboard-summary 的真實案件資料(關卡、同意度、
// 提醒分級、行政區、負責人),不使用假資料。沒有起訖日資料可支撐甘特圖,詳情面板
// 改用「SOP 十關」勾選清單呈現真實進度,而不是虛構時程。

const PR_CHART_COLORS = ["#42cbd0", "#2fae72", "#e2a13c", "#e6584f", "#6366f1", "#ec4899", "#0ea5e9", "#94a3b8"];

const progressReportState = {
  loaded: false,
  projects: [], // DashboardProjectItem[]
  projectDetailsById: {}, // 補充 ProjectRead(建立日期等),detail 面板才拉,懶載入
  filters: { status: "", stage: "", handler: "", district: "", q: "" },
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
  ["pr-f-status", "pr-f-stage", "pr-f-handler", "pr-f-district"].forEach((id) => {
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
  document.getElementById("pr-project-picker")?.addEventListener("change", (e) => {
    selectProgressReportProject(e.target.value ? Number(e.target.value) : null);
  });
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
  const pickerSel = document.getElementById("pr-project-picker");
  if (!stageSel || !handlerSel || !districtSel || !pickerSel) return;

  const stages = [...new Set(progressReportState.projects.map((p) => p.current_stage))].sort((a, b) => a - b);
  const keepValue = (sel, buildOptions, placeholder = "全部") => {
    const prev = sel.value;
    sel.innerHTML = `<option value="">${placeholder}</option>` + buildOptions();
    if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
  };

  keepValue(stageSel, () => stages.map((s) => `<option value="${s}">第${s}關 · ${escapeHtml(sopStageLabel(s))}</option>`).join(""));

  const handlers = [...new Set(progressReportState.projects.flatMap((p) => [p.case_handler_name, p.case_manager_name]).filter(Boolean))].sort();
  keepValue(handlerSel, () => handlers.map((h) => `<option value="${escapeHtml(h)}">${escapeHtml(h)}</option>`).join(""));

  const districts = [...new Set(progressReportState.projects.map((p) => p.district).filter(Boolean))].sort();
  keepValue(districtSel, () => districts.map((d) => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join(""));

  const projectsSorted = [...progressReportState.projects].sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"));
  keepValue(
    pickerSel,
    () => projectsSorted.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}（${escapeHtml(p.project_code)}）</option>`).join(""),
    "全部案件總覽"
  );
}

function progressReportFilteredProjects() {
  const f = progressReportState.filters;
  return progressReportState.projects.filter((p) => {
    if (f.status && p.status !== f.status) return false;
    if (f.stage !== "" && String(p.current_stage) !== String(f.stage)) return false;
    if (f.handler && p.case_handler_name !== f.handler && p.case_manager_name !== f.handler) return false;
    if (f.district && p.district !== f.district) return false;
    if (f.q && !`${p.name} ${p.project_code} ${p.district || ""} ${p.city || ""}`.toLowerCase().includes(f.q)) return false;
    return true;
  });
}

function renderProgressReportBody() {
  const overview = document.getElementById("pr-overview");
  const isDetailMode = !!progressReportState.selectedId;
  if (overview) overview.classList.toggle("hidden", isDetailMode);

  if (!isDetailMode) {
    const all = progressReportState.projects;
    const filtered = progressReportFilteredProjects();

    renderProgressReportStats(all);
    renderProgressReportCharts(filtered);
    renderProgressReportTable(filtered);

    const title = document.getElementById("pr-table-title");
    if (title) title.textContent = `案件列表（共 ${filtered.length} 筆）`;
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
          <th>同意度(人數/土地)</th><th>負責人</th><th>狀態</th><th style="text-align:right">操作</th>
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
              <td>${escapeHtml(handler)}</td>
              <td><span class="status-badge ${PR_TIER_BADGE_CLASS[tier]}">${PR_TIER_LABEL[tier]}</span></td>
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

// 案件選擇統一由這裡進出 —— 不管是點上方「選擇案件」下拉、點總覽表格的列/查看
// 按鈕,一律走這個函式,才能保證下拉的值、總覽區塊顯不顯示、詳情面板三者不會兜不
// 起來。選了案件就整個切到「該案詳細分析」畫面(蓋掉總覽,不是總覽下面再多一塊)。
function selectProgressReportProject(id) {
  progressReportState.selectedId = id;
  progressReportState.detailTab = "overview";
  const picker = document.getElementById("pr-project-picker");
  if (picker) picker.value = id ? String(id) : "";
  renderProgressReportBody();
  if (id) {
    document.getElementById("pr-detail-panel")?.scrollIntoView({ behavior: "smooth", block: "start" });
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
          <button type="button" class="btn-secondary btn-sm" id="pr-close-detail-btn">← 返回總覽</button>
        </div>
      </div>
      <div class="tab-bar">
        ${tabs.map((t) => `<button type="button" class="tab-btn ${progressReportState.detailTab === t.key ? "active" : ""}" data-pr-tab="${t.key}">${t.label}</button>`).join("")}
      </div>
      <div id="pr-detail-tab-content">${renderProgressReportDetailTab(progressReportState.detailTab, p, full)}</div>
    </div>`;

  panel.querySelector("#pr-open-project-btn")?.addEventListener("click", () => openProject(id));
  panel.querySelector("#pr-close-detail-btn")?.addEventListener("click", () => selectProgressReportProject(null));
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
    <div class="pr-detail-grid">
      <div><div class="helper-text">案件編號</div><div>${escapeHtml(p.project_code)}</div></div>
      <div><div class="helper-text">行政區</div><div>${escapeHtml([p.city, p.district].filter(Boolean).join(" ") || "—")}</div></div>
      <div><div class="helper-text">目前關卡</div><div>第${p.current_stage}關 · ${escapeHtml(sopStageLabel(p.current_stage))}</div></div>
      <div><div class="helper-text">負責人</div><div>${escapeHtml(p.case_handler_name || "—")}</div></div>
      <div><div class="helper-text">主管</div><div>${escapeHtml(p.case_manager_name || "—")}</div></div>
      <div><div class="helper-text">地號 / 建號數</div><div>${p.land_record_count} / ${p.building_record_count}</div></div>
      ${full ? `<div><div class="helper-text">建立日期</div><div>${fmtDate(full.created_at)}</div></div>` : ""}
      ${full && full.address ? `<div><div class="helper-text">地址</div><div>${escapeHtml(full.address)}</div></div>` : ""}
    </div>`;
}
