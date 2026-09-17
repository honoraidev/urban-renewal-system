"use strict";

// 「案件總覽」分頁 —— 從首頁/案件卡片點進案件時的預設落點(側欄「案件管理」清單
// 點進去還是直接到 SOP 進度頁,見 dashboard.js openProject 的 defaultTab)。全部
// 資料都串真實 API,沒有後端資料可算的欄位(待辦事項)先留空狀態,不做假資料。

const OVERVIEW_RISK_LABEL = { low: "低", medium: "中", high: "高", "未設定": "未設定", "-": "—" };
const OVERVIEW_RISK_CLASS = { low: "ov-risk-low", medium: "ov-risk-medium", high: "ov-risk-high" };

const OVERVIEW_STAGE_STATUS_LABEL = {
  completed: "已完成",
  force_closed: "強制結案",
  in_progress: "進行中",
  pending: "未開始",
};

function overviewEnsureStyle() {
  if (document.getElementById("ov-style")) return;
  const s = document.createElement("style");
  s.id = "ov-style";
  s.textContent = `
    .ov-grid { display:flex; flex-direction:column; gap:16px; }
    .ov-row { display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap:16px; }
    .ov-row.ov-row-3col { grid-template-columns: 1.1fr 1.6fr 1fr; align-items:stretch; }
    @media (max-width:1000px) { .ov-row.ov-row-3col { grid-template-columns: 1fr; } }
    .ov-card { background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:16px; }
    .ov-card h3 { margin:0 0 12px; font-size:14.5px; display:flex; align-items:center; justify-content:space-between; gap:8px; }
    .ov-card h3 .helper-text { font-weight:400; }

    .ov-donut-wrap { display:flex; flex-direction:column; align-items:center; gap:10px; }
    .ov-donut { width:140px; height:140px; border-radius:50%; position:relative;
      background: conic-gradient(var(--brand) calc(var(--pct,0)*3.6deg), var(--surface-2) 0deg); }
    .ov-donut-hole { position:absolute; inset:14px; border-radius:50%; background:var(--surface);
      display:flex; flex-direction:column; align-items:center; justify-content:center; }
    .ov-donut-hole strong { font-size:26px; line-height:1.1; }
    .ov-donut-hole span { font-size:12px; color:var(--text-muted); margin-top:2px; }
    .ov-donut-updated { font-size:12px; color:var(--text-muted); }

    .ov-stage-scroll { display:flex; gap:14px; overflow-x:auto; padding-bottom:4px; }
    .ov-stage { flex:0 0 auto; width:92px; display:flex; flex-direction:column; align-items:center; gap:6px; text-align:center; }
    .ov-stage-ring { width:64px; height:64px; border-radius:50%; position:relative;
      background: conic-gradient(var(--stage-color,var(--brand)) calc(var(--pct,0)*3.6deg), var(--surface-2) 0deg); }
    .ov-stage-ring-hole { position:absolute; inset:6px; border-radius:50%; background:var(--surface);
      display:flex; align-items:center; justify-content:center; font-size:12.5px; font-weight:700; color:var(--stage-color,var(--brand)); }
    .ov-stage-name { font-size:12px; font-weight:600; }
    .ov-stage-sub { font-size:11px; color:var(--text-muted); }

    .ov-status-list { display:flex; flex-direction:column; gap:0; }
    .ov-status-row { display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid var(--border); font-size:13.5px; }
    .ov-status-row:last-child { border-bottom:none; }
    .ov-status-row .lbl { color:var(--text-muted); }
    .ov-risk-low { color:var(--success); font-weight:700; }
    .ov-risk-medium { color:var(--warning); font-weight:700; }
    .ov-risk-high { color:var(--danger); font-weight:700; }

    .ov-metrics { display:grid; grid-template-columns:repeat(auto-fit,minmax(120px,1fr)); gap:12px; }
    .ov-metric { border-radius:10px; padding:14px 10px; text-align:center; background:var(--surface-2); }
    .ov-metric .ov-metric-icon { font-size:20px; }
    .ov-metric .ov-metric-label { font-size:12.5px; color:var(--text-muted); margin:4px 0; }
    .ov-metric .ov-metric-pct { font-size:22px; font-weight:800; }
    .ov-metric .ov-metric-sub { font-size:11px; color:var(--text-muted); }

    .ov-member-row { display:flex; align-items:center; gap:8px; padding:6px 0; font-size:13.5px; }
    .ov-member-avatar { width:28px; height:28px; border-radius:50%; background:var(--surface-2);
      display:flex; align-items:center; justify-content:center; font-weight:700; font-size:12px; flex:0 0 auto; }
    .ov-member-main { flex:1 1 auto; min-width:0; }
    .ov-member-role { font-size:11.5px; color:var(--text-muted); }

    .ov-list-row { display:flex; justify-content:space-between; gap:10px; padding:7px 0; border-bottom:1px solid var(--border); font-size:13px; }
    .ov-list-row:last-child { border-bottom:none; }
    .ov-list-row-main { min-width:0; }
    .ov-list-row-sub { color:var(--text-muted); font-size:11.5px; }
    .ov-list-row-meta { flex:0 0 auto; color:var(--text-muted); font-size:12px; text-align:right; white-space:nowrap; }
  `;
  document.head.appendChild(s);
}

function _ovRiskCard(caseStatus) {
  const riskCls = OVERVIEW_RISK_CLASS[caseStatus.risk_level] || "";
  const riskLabel = OVERVIEW_RISK_LABEL[caseStatus.risk_level] || caseStatus.risk_level || "—";
  return `
    <div class="ov-status-list">
      <div class="ov-status-row"><span class="lbl">案件狀態</span><span><span class="status-badge status-${caseStatus.status}">${escapeHtml(PROJECT_STATUS_LABEL[caseStatus.status] || caseStatus.status)}</span>${caseStatus.is_force_closed ? ` <span class="mini-badge alert">強制結案</span>` : ""}</span></div>
      <div class="ov-status-row"><span class="lbl">風險等級</span><span class="${riskCls}">${escapeHtml(riskLabel)}</span></div>
      <div class="ov-status-row"><span class="lbl">延遲天數</span><span>${caseStatus.delay_days > 0 ? `${caseStatus.delay_days} 天` : "0 天"}</span></div>
      <div class="ov-status-row"><span class="lbl">下次里程碑</span><span>${escapeHtml(caseStatus.next_milestone_name || "—")}</span></div>
      <div class="ov-status-row"><span class="lbl">預計完成日</span><span>${caseStatus.expected_completion_date ? fmtDate(caseStatus.expected_completion_date) : "未設定"}</span></div>
      <div class="ov-status-row"><span class="lbl">更新日期</span><span>${fmtDateTime(caseStatus.updated_at)}</span></div>
    </div>`;
}

function _ovStageColor(status) {
  if (status === "completed" || status === "force_closed") return "var(--success)";
  if (status === "in_progress") return "var(--brand)";
  return "var(--border)";
}

function _ovStageHtml(s) {
  const color = _ovStageColor(s.status);
  const hole = s.status === "completed" || s.status === "force_closed" ? "✓" : `${s.pct}%`;
  return `
    <div class="ov-stage" title="${escapeHtml(s.name)} - ${escapeHtml(OVERVIEW_STAGE_STATUS_LABEL[s.status] || s.status)}">
      <div class="ov-stage-ring" style="--pct:${s.pct};--stage-color:${color}">
        <div class="ov-stage-ring-hole" style="color:${color}">${hole}</div>
      </div>
      <div class="ov-stage-name">${escapeHtml(s.name)}</div>
      <div class="ov-stage-sub">${escapeHtml(OVERVIEW_STAGE_STATUS_LABEL[s.status] || s.status)}</div>
    </div>`;
}

function _ovMetric(icon, label, ratio, agreedText) {
  const pct = Math.round((ratio || 0) * 100);
  return `
    <div class="ov-metric">
      <div class="ov-metric-icon">${icon}</div>
      <div class="ov-metric-label">${label}</div>
      <div class="ov-metric-pct">${pct}%</div>
      <div class="ov-metric-sub">${agreedText}</div>
    </div>`;
}

function _ovMemberRoleLabel(role) {
  return (typeof ROLE_LABEL !== "undefined" && ROLE_LABEL[role]) || role;
}

async function renderProjectOverviewTab(el) {
  overviewEnsureStyle();
  const pid = state.currentProjectId;
  el.innerHTML = `<div class="empty-state">載入中...</div>`;

  let overview, members, docs, notes, feed;
  try {
    [overview, members, docs, notes, feed] = await Promise.all([
      api(`/projects/${pid}/overview`),
      api(`/projects/${pid}/members`, { silent: true }).catch(() => []),
      api(`/projects/${pid}/documents`, { silent: true }).catch(() => []),
      api(`/projects/${pid}/notes`, { silent: true }).catch(() => []),
      api(`/projects/${pid}/activity-feed`, { silent: true }).catch(() => []),
    ]);
  } catch (err) {
    el.innerHTML = `<div class="empty-state">載入失敗</div>`;
    return;
  }
  if (state.currentProjectId !== pid) return;

  const membersHtml = members.length
    ? members
        .map(
          (m) => `<div class="ov-member-row">
            <span class="ov-member-avatar">${escapeHtml((m.display_name || m.username || "?").charAt(0))}</span>
            <div class="ov-member-main">
              <div>${escapeHtml(m.display_name || m.username)}</div>
              <div class="ov-member-role">${escapeHtml(_ovMemberRoleLabel(m.role_in_project))}</div>
            </div>
          </div>`
        )
        .join("")
    : `<div class="helper-text">尚未指派相關人員</div>`;

  const recentDocs = [...docs].sort((a, b) => new Date(b.uploaded_at) - new Date(a.uploaded_at)).slice(0, 6);
  const docsHtml = recentDocs.length
    ? recentDocs
        .map(
          (d) => `<div class="ov-list-row">
            <div class="ov-list-row-main">📄 ${escapeHtml(d.file_name)}</div>
            <div class="ov-list-row-meta">${fmtDate(d.uploaded_at)}</div>
          </div>`
        )
        .join("")
    : `<div class="helper-text">尚無文件</div>`;

  const timeline = [
    ...notes.map((n) => ({ time: n.occurred_at, text: n.content, who: n.author_name, isNote: true })),
    ...feed.map((a) => ({ time: a.created_at, text: a.action, who: a.user_name, isNote: false })),
  ]
    .sort((a, b) => new Date(b.time) - new Date(a.time))
    .slice(0, 6);
  const timelineHtml = timeline.length
    ? timeline
        .map((t) => {
          const icon = t.isNote ? "📝" : typeof _activityIcon === "function" ? _activityIcon(t.text) : "🔄";
          return `<div class="ov-list-row">
            <div class="ov-list-row-main">${icon} ${escapeHtml(t.text)}<div class="ov-list-row-sub">${escapeHtml(t.who || "—")}</div></div>
            <div class="ov-list-row-meta">${fmtDateTime(t.time)}</div>
          </div>`;
        })
        .join("")
    : `<div class="helper-text">尚無紀錄</div>`;

  el.innerHTML = `
    <div class="ov-grid">
      <div class="ov-row ov-row-3col">
        <div class="ov-card">
          <h3>整體進度</h3>
          <div class="ov-donut-wrap">
            <div class="ov-donut" style="--pct:${overview.overall_progress_pct}">
              <div class="ov-donut-hole"><strong>${overview.overall_progress_pct}%</strong><span>${escapeHtml(PROJECT_STATUS_LABEL[overview.case_status.status] || overview.case_status.status)}</span></div>
            </div>
            <div class="ov-donut-updated">更新日期:${fmtDate(overview.case_status.updated_at)}</div>
          </div>
        </div>
        <div class="ov-card">
          <h3>階段進度</h3>
          <div class="ov-stage-scroll">${overview.stages.map(_ovStageHtml).join("")}</div>
        </div>
        <div class="ov-card">
          <h3>案件狀態</h3>
          ${_ovRiskCard(overview.case_status)}
        </div>
      </div>

      <div class="ov-card">
        <h3>關鍵指標</h3>
        <div class="ov-metrics">
          ${_ovMetric("👥", "人數同意", overview.key_metrics.headcount_ratio, `${overview.key_metrics.headcount_agreed} / ${overview.key_metrics.headcount_total} 人`)}
          ${_ovMetric("🗺️", "土地同意", overview.key_metrics.land_share_ratio, `${fmt2(overview.key_metrics.land_share_agreed_sqm)} / ${fmt2(overview.key_metrics.land_share_total_sqm)} m²`)}
          ${_ovMetric("🏠", "建物同意", overview.key_metrics.building_share_ratio, `${fmt2(overview.key_metrics.building_share_agreed_sqm)} / ${fmt2(overview.key_metrics.building_share_total_sqm)} m²`)}
        </div>
      </div>

      <div class="ov-row">
        <div class="ov-card"><h3>相關人員</h3>${membersHtml}</div>
        <div class="ov-card"><h3>待辦事項</h3><div class="helper-text">功能開發中,尚未串接</div></div>
      </div>

      <div class="ov-row">
        <div class="ov-card"><h3>最近文件</h3>${docsHtml}</div>
        <div class="ov-card"><h3>重要紀錄</h3>${timelineHtml}</div>
      </div>
    </div>`;
}
