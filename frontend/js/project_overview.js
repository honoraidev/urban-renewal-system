"use strict";

// 「案件總覽」—— 首頁「都更案件進度總覽」卡片點進去的獨立落地頁(view-project-overview,
// 見 dashboard.js goToProjectOverviewPage),跟側欄「案件管理」清單直接進的 SOP 進度分頁
// 頁面(view-project-detail)是不同畫面。全部資料都串真實 API,沒有後端資料可算的欄位
// (待辦事項)先留空狀態,不做假資料。

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
    .ov-grid { display:flex; flex-direction:column; gap:18px; }
    .ov-row { display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap:18px; }
    .ov-row.ov-row-top { grid-template-columns: 1fr 1.7fr; align-items:start; }
    .ov-col { display:flex; flex-direction:column; gap:18px; min-width:0; }
    @media (max-width:1000px) { .ov-row.ov-row-top { grid-template-columns: 1fr; } }
    .ov-card { background:var(--surface); border:1px solid var(--border); border-radius:14px; padding:18px 20px;
      box-shadow: 0 1px 2px rgba(0,0,0,.03); }
    .ov-card h3 { margin:0 0 14px; font-size:14.5px; font-weight:700; display:flex; align-items:center; justify-content:space-between; gap:8px;
      padding-bottom:10px; border-bottom:1px solid var(--border); }
    .ov-card h3 .helper-text { font-weight:400; }

    .ov-hero-card { background:var(--surface); border:1px solid var(--border); border-radius:14px; padding:18px 20px;
      box-shadow:0 1px 2px rgba(0,0,0,.03); display:flex; flex-direction:column; gap:16px; }
    .ov-hero-top { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; flex-wrap:wrap; }
    .ov-meta-row { display:flex; flex-wrap:wrap; gap:8px 18px; }
    .ov-meta-item { font-size:13px; color:var(--text); white-space:nowrap; }
    .ov-hero-actions { display:flex; gap:8px; flex-shrink:0; }

    .ov-brief-card { position:relative; padding-top:16px; border-top:1px solid var(--border); }
    .ov-brief-view, .ov-brief-edit { display:flex; gap:18px; align-items:flex-start; flex-wrap:wrap; }
    .ov-brief-cover { width:240px; max-width:100%; height:150px; object-fit:cover; border-radius:12px; flex:0 0 auto; background:var(--surface-2); }
    .ov-brief-cover.hidden { display:none; }
    .ov-brief-cover-empty { width:240px; max-width:100%; height:150px; border-radius:12px; flex:0 0 auto;
      background:var(--surface-2); color:var(--text-muted); font-size:12.5px;
      display:flex; align-items:center; justify-content:center; }
    .ov-brief-label { font-size:12.5px; font-weight:700; color:var(--text-muted); margin-bottom:6px; }
    .ov-brief-text { flex:1 1 260px; font-size:13.5px; line-height:1.7; color:var(--text); white-space:pre-line; }
    .ov-brief-edit-btn { position:absolute; top:16px; right:0; width:30px; height:30px; border-radius:50%;
      border:1px solid var(--border); background:var(--surface); cursor:pointer; font-size:14px;
      display:flex; align-items:center; justify-content:center; }
    .ov-brief-edit-btn:hover { background:var(--surface-2); }
    .ov-brief-cover-wrap { display:flex; flex-direction:column; gap:8px; flex:0 0 auto; }
    .ov-brief-edit-cover-actions { display:flex; gap:8px; flex-wrap:wrap; }
    .ov-brief-edit .ov-brief-text { display:flex; flex-direction:column; }
    .ov-brief-edit textarea { width:100%; resize:vertical; font:inherit; }
    .ov-brief-edit-actions { display:flex; justify-content:flex-end; gap:8px; margin-top:10px; }

    .ov-donut-wrap { display:flex; flex-direction:column; align-items:center; gap:12px; padding:6px 0 2px; }
    .ov-donut { width:150px; height:150px; border-radius:50%; position:relative;
      background: conic-gradient(var(--brand) calc(var(--pct,0)*3.6deg), var(--surface-2) 0deg); }
    .ov-donut-hole { position:absolute; inset:15px; border-radius:50%; background:var(--surface);
      display:flex; flex-direction:column; align-items:center; justify-content:center; }
    .ov-donut-hole strong { font-size:28px; line-height:1.1; }
    .ov-donut-hole span { font-size:12px; color:var(--text-muted); margin-top:3px; }
    .ov-donut-updated { font-size:12px; color:var(--text-muted); }

    .ov-stage-scroll { display:flex; flex-wrap:wrap; gap:18px 16px; }
    .ov-stage { flex:0 0 auto; width:88px; display:flex; flex-direction:column; align-items:center; gap:6px; text-align:center; }
    .ov-stage-ring { width:64px; height:64px; border-radius:50%; position:relative;
      background: conic-gradient(var(--stage-color,var(--brand)) calc(var(--pct,0)*3.6deg), var(--surface-2) 0deg); }
    .ov-stage-ring-hole { position:absolute; inset:6px; border-radius:50%; background:var(--surface);
      display:flex; align-items:center; justify-content:center; font-size:12.5px; font-weight:700; color:var(--stage-color,var(--brand)); }
    .ov-stage-name { font-size:12px; font-weight:600; }
    .ov-stage-sub { font-size:11px; color:var(--text-muted); }

    .ov-status-list { display:flex; flex-direction:column; gap:0; }
    .ov-status-row { display:flex; justify-content:space-between; align-items:center; padding:9px 0; border-bottom:1px solid var(--border); font-size:13.5px; }
    .ov-status-row:last-child { border-bottom:none; }
    .ov-status-row .lbl { color:var(--text-muted); }
    .ov-risk-low { color:var(--success); font-weight:700; }
    .ov-risk-medium { color:var(--warning); font-weight:700; }
    .ov-risk-high { color:var(--danger); font-weight:700; }

    .ov-metrics-group { display:flex; flex-direction:column; gap:16px; }
    .ov-metrics-group .ov-metrics + .ov-metrics { padding-top:16px; border-top:1px dashed var(--border); }
    .ov-metrics { display:grid; grid-template-columns:repeat(auto-fit,minmax(120px,1fr)); gap:12px; }
    .ov-metric { border-radius:10px; padding:14px 10px; text-align:center; background:var(--surface-2); }
    .ov-metric .ov-metric-icon { font-size:20px; }
    .ov-metric .ov-metric-label { font-size:12.5px; color:var(--text-muted); margin:4px 0; }
    .ov-metric .ov-metric-pct { font-size:22px; font-weight:800; }
    .ov-metric .ov-metric-sub { font-size:11px; color:var(--text-muted); }
    .ov-detail-agreed .ov-metric-pct { color:var(--success); }
    .ov-detail-opposed .ov-metric-pct { color:var(--danger); }
    .ov-detail-undecided .ov-metric-pct { color:var(--warning); }
    .ov-detail-noresponse .ov-metric-pct { color:var(--text-muted); }

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

function _ovHeadcountDetailHtml(detail) {
  if (!detail) return "";
  const items = [
    { label: "同意", count: detail.agreed, cls: "ov-detail-agreed" },
    { label: "反對", count: detail.opposed, cls: "ov-detail-opposed" },
    { label: "未決定", count: detail.undecided, cls: "ov-detail-undecided" },
    { label: "未回覆", count: detail.no_response, cls: "ov-detail-noresponse" },
  ];
  return items
    .map(
      (it) => `<div class="ov-metric ${it.cls}">
        <div class="ov-metric-label">${it.label}</div>
        <div class="ov-metric-pct">${it.count}</div>
        <div class="ov-metric-sub">/ ${detail.total} 人</div>
      </div>`
    )
    .join("");
}

function _ovMemberRoleLabel(role) {
  return (typeof ROLE_LABEL !== "undefined" && ROLE_LABEL[role]) || role;
}

// 「案件簡介 + 封面圖」直接在總覽頁上編輯,不跳出「編輯案件資料」那個大視窗(裡面
// 一堆跟簡介/封面圖無關的欄位)- 這裡是唯一入口,只管這兩樣。
function _ovBriefViewHtml(proj) {
  return `
    <div class="ov-brief-view">
      <div class="ov-brief-cover-wrap">
        ${proj.has_cover_image
          ? `<img id="ov-cover-img" class="ov-brief-cover" alt="案件封面圖">`
          : `<div class="ov-brief-cover-empty">尚無封面圖</div>`}
      </div>
      <div class="ov-brief-text">
        <div class="ov-brief-label">案件簡介</div>
        ${proj.summary ? escapeHtml(proj.summary).replace(/\n/g, "<br>") : `<span class="helper-text">尚未填寫案件簡介</span>`}
      </div>
      <button type="button" class="ov-brief-edit-btn" id="ov-brief-edit-btn" title="編輯簡介與封面圖">✏️</button>
    </div>`;
}

function _ovBriefEditHtml(proj) {
  return `
    <div class="ov-brief-edit">
      <div class="ov-brief-cover-wrap">
        <img id="ov-brief-edit-preview" class="ov-brief-cover${proj.has_cover_image ? "" : " hidden"}" alt="案件封面圖預覽">
        <div class="ov-brief-cover-empty" id="ov-brief-edit-empty" style="${proj.has_cover_image ? "display:none" : ""}">尚無封面圖</div>
        <div class="ov-brief-edit-cover-actions">
          <label class="btn-secondary btn-sm">📷 選擇圖片<input type="file" id="ov-brief-file" accept="image/*" hidden></label>
          <button type="button" class="btn-secondary btn-sm" id="ov-brief-remove-cover" ${proj.has_cover_image ? "" : "disabled"}>移除圖片</button>
        </div>
      </div>
      <div class="ov-brief-text">
        <div class="ov-brief-label">案件簡介</div>
        <textarea id="ov-brief-summary-input" rows="5" placeholder="案件簡介,例如基地面積、預計興建規模等">${escapeHtml(proj.summary || "")}</textarea>
        <div class="ov-brief-edit-actions">
          <button type="button" class="btn-secondary btn-sm" id="ov-brief-cancel-btn">取消</button>
          <button type="button" class="btn-primary btn-sm" id="ov-brief-save-btn">儲存</button>
        </div>
      </div>
    </div>`;
}

function _ovLoadCoverPreview(pid) {
  const img = document.getElementById("ov-cover-img");
  if (!img) return;
  api(`/projects/${pid}/cover-image`, { silent: true })
    .then((res) => res.blob())
    .then((blob) => { img.src = URL.createObjectURL(blob); })
    .catch(() => {});
}

function _ovWireBriefCard(pid) {
  document.getElementById("ov-brief-edit-btn")?.addEventListener("click", () => _ovEnterBriefEditMode(pid));
  _ovLoadCoverPreview(pid);
}

function _ovEnterBriefEditMode(pid) {
  const card = document.getElementById("ov-brief-card");
  if (!card) return;
  const proj = state.currentProject || {};
  card.innerHTML = _ovBriefEditHtml(proj);

  let pendingFile = null;
  let removeCover = false;
  const preview = document.getElementById("ov-brief-edit-preview");
  const emptyLabel = document.getElementById("ov-brief-edit-empty");
  const removeBtn = document.getElementById("ov-brief-remove-cover");

  if (proj.has_cover_image) {
    api(`/projects/${pid}/cover-image`, { silent: true })
      .then((res) => res.blob())
      .then((blob) => { preview.src = URL.createObjectURL(blob); })
      .catch(() => {});
  }

  document.getElementById("ov-brief-file")?.addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    pendingFile = file;
    removeCover = false;
    preview.src = URL.createObjectURL(file);
    preview.classList.remove("hidden");
    if (emptyLabel) emptyLabel.style.display = "none";
    if (removeBtn) removeBtn.disabled = false;
  });

  removeBtn?.addEventListener("click", () => {
    pendingFile = null;
    removeCover = true;
    preview.removeAttribute("src");
    preview.classList.add("hidden");
    if (emptyLabel) emptyLabel.style.display = "";
    removeBtn.disabled = true;
  });

  document.getElementById("ov-brief-cancel-btn")?.addEventListener("click", () => {
    card.innerHTML = _ovBriefViewHtml(proj);
    _ovWireBriefCard(pid);
  });

  document.getElementById("ov-brief-save-btn")?.addEventListener("click", async () => {
    const summaryVal = document.getElementById("ov-brief-summary-input").value.trim();
    try {
      if (pendingFile) {
        const fd = new FormData();
        fd.append("file", pendingFile);
        await api(`/projects/${pid}/cover-image`, { method: "POST", body: fd, isForm: true });
      } else if (removeCover) {
        await api(`/projects/${pid}/cover-image`, { method: "DELETE" });
      }
      const updated = await api(`/projects/${pid}`, { method: "PATCH", body: { summary: summaryVal || null } });
      state.currentProject = updated;
      toast("案件簡介已更新", "success");
      card.innerHTML = _ovBriefViewHtml(updated);
      _ovWireBriefCard(pid);
      if (typeof loadDashboard === "function") loadDashboard().catch(() => {});
    } catch (err) { }
  });
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

  const proj = state.currentProject || {};
  // 「負責人」跟首頁案件卡片(dashboard-summary 的 case_handler_name/case_manager_name)
  // 同一套邏輯:members 裡第一個 case_staff/case_owner 是負責人,第一個 manager/
  // sys_admin 是主管(見 backend routers/projects.py _case_handler_names)。
  const handlerMember = members.find((m) => ["case_staff", "case_owner"].includes(m.role_in_project));
  const managerMember = members.find((m) => ["manager", "sys_admin"].includes(m.role_in_project));
  const handlerName = handlerMember && (handlerMember.display_name || handlerMember.username);
  const managerName = managerMember && (managerMember.display_name || managerMember.username);
  const dateRangeText = `${fmtDate(proj.created_at)} ~ ${proj.expected_completion_date ? fmtDate(proj.expected_completion_date) : "未定"}`;

  const heroHtml = `
    <div class="ov-hero-card">
      <div class="ov-hero-top">
        <div class="ov-meta-row">
          <span class="ov-meta-item">📍 ${escapeHtml([proj.city, proj.district, proj.address].filter(Boolean).join("") || "—")}</span>
          <span class="ov-meta-item">📁 ${escapeHtml(proj.project_code || "—")}</span>
          ${proj.case_type ? `<span class="ov-meta-item">🏢 ${escapeHtml(proj.case_type)}</span>` : ""}
          <span class="ov-meta-item">📅 ${dateRangeText}</span>
          ${handlerName ? `<span class="ov-meta-item">👤 負責人:${escapeHtml(handlerName)}</span>` : ""}
          ${managerName ? `<span class="ov-meta-item">💼 主管:${escapeHtml(managerName)}</span>` : ""}
        </div>
      </div>
      <div class="ov-brief-card" id="ov-brief-card">${_ovBriefViewHtml(proj)}</div>
    </div>`;

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
      ${heroHtml}
      <div class="ov-row ov-row-top">
        <div class="ov-col">
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
            <h3>案件狀態</h3>
            ${_ovRiskCard(overview.case_status)}
          </div>
        </div>
        <div class="ov-card">
          <h3>階段進度</h3>
          <div class="ov-stage-scroll">${overview.stages.map(_ovStageHtml).join("")}</div>
        </div>
      </div>

      <div class="ov-card">
        <h3>關鍵指標</h3>
        <div class="ov-metrics-group">
          <div class="ov-metrics">
            ${_ovMetric("👥", "人數同意", overview.key_metrics.headcount_ratio, `${overview.key_metrics.headcount_agreed} / ${overview.key_metrics.headcount_total} 人`)}
          </div>
          <div class="ov-metrics">
            ${_ovHeadcountDetailHtml(overview.key_metrics.headcount_detail)}
          </div>
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

  _ovWireBriefCard(pid);
}
