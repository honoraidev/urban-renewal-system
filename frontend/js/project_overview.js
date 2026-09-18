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
    .ov-grid { display:flex; flex-direction:column; gap:22px; }
    .ov-row { display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap:22px; align-items:stretch; }
    .ov-row.ov-row-r2 { grid-template-columns: 1.8fr 1.1fr 1fr; }
    @media (max-width:1100px) { .ov-row.ov-row-r2 { grid-template-columns: 1fr; } }
    .ov-stage-band { margin:22px 0; }
    .ov-card { background:var(--surface); border:1px solid var(--border); border-radius:18px; padding:22px 24px;
      box-shadow:var(--shadow); transition:box-shadow .15s; }
    .ov-card:hover { box-shadow:var(--shadow-hover); }
    .ov-card-plain { background:transparent; border:none; box-shadow:none; }
    .ov-card-plain:hover { box-shadow:none; }
    .ov-card h3 { margin:0 0 16px; font-size:15.5px; font-weight:800; display:flex; align-items:center; justify-content:space-between; gap:8px;
      padding-bottom:13px; border-bottom:1px solid var(--border); letter-spacing:.01em; }
    .ov-card h3 .helper-text { font-weight:400; }
    .ov-card-icon { width:28px; height:28px; border-radius:9px; background:var(--brand-light); color:var(--brand-dark);
      display:inline-flex; align-items:center; justify-content:center; font-size:14.5px; flex:0 0 auto; margin-right:2px; }
    .ov-card h3 > span:first-child { display:inline-flex; align-items:center; gap:10px; }
    .ov-todo-add-btn { width:26px; height:26px; border-radius:50%; border:none; background:var(--brand-light);
      color:var(--brand-dark); font-size:16px; font-weight:800; line-height:1; cursor:pointer;
      display:flex; align-items:center; justify-content:center; transition:all .15s; }
    .ov-todo-add-btn:hover { background:var(--brand); color:#fff; transform:scale(1.08); }
    .ov-todo-list { display:flex; flex-direction:column; }
    .ov-todo-row { display:flex; justify-content:space-between; align-items:flex-start; gap:10px; padding:9px 0; border-bottom:1px solid var(--border); }
    .ov-todo-row:last-child { border-bottom:none; }
    .ov-todo-text { font-size:13px; color:var(--text); line-height:1.5; }
    .ov-todo-date { font-size:11.5px; color:var(--text-muted); margin-top:2px; }
    .ov-todo-overdue .ov-todo-date { color:var(--danger); }

    .ov-meta-row { display:flex; flex-wrap:wrap; gap:9px 20px; margin-top:10px; }
    .ov-meta-item { font-size:13.5px; color:var(--text-muted); white-space:nowrap; display:inline-flex; align-items:center; gap:5px; }

    .ov-brief-card { position:relative; flex:1; display:flex; align-items:stretch; background:var(--surface);
      border:1px solid var(--border); border-radius:18px; box-shadow:var(--shadow); overflow:hidden; }
    .ov-brief-view, .ov-brief-edit { display:flex; gap:0; flex-wrap:wrap; width:100%; }
    .ov-brief-view { align-items:stretch; }
    .ov-brief-edit { align-items:flex-start; gap:18px; padding:20px 22px; }
    /* 檢視模式的封面圖直接貼滿卡片左側(上下左邊都到底,靠 overflow:hidden 裁成
       卡片圓角),不要四周留一圈白邊看起來像貼小貼紙。編輯模式維持原本有邊距的
       盒子,底下才放得下「選擇圖片/移除圖片」按鈕。 */
    .ov-brief-cover { width:230px; max-width:100%; height:150px; object-fit:cover; border-radius:14px; flex:0 0 auto;
      background:var(--surface-2); box-shadow:0 6px 16px -6px rgba(15,35,38,.3); }
    .ov-brief-cover.hidden { display:none; }
    .ov-brief-cover-empty { width:230px; max-width:100%; height:150px; border-radius:14px; flex:0 0 auto;
      background:linear-gradient(160deg, var(--brand-light), var(--surface-2)); color:var(--text-muted); font-size:12px;
      border:1.5px dashed var(--border); display:flex; flex-direction:column; align-items:center; justify-content:center; gap:6px; }
    .ov-brief-cover-empty::before { content:"🖼️"; font-size:28px; opacity:.55; }
    .ov-brief-view .ov-brief-cover, .ov-brief-view .ov-brief-cover-empty {
      width:240px; height:100%; min-height:220px; border-radius:0; border-width:0 1.5px 0 0; box-shadow:none; }
    .ov-brief-label { font-size:13px; font-weight:800; color:var(--brand-dark); margin-bottom:7px;
      display:flex; align-items:center; gap:6px; text-transform:uppercase; letter-spacing:.03em; }
    .ov-brief-label::before { content:""; width:7px; height:7px; border-radius:50%; background:var(--brand); box-shadow:0 0 0 3px var(--brand-light); }
    .ov-brief-text { flex:1 1 200px; font-size:14px; line-height:1.8; color:var(--text); white-space:pre-line; }
    .ov-brief-text-card { flex:1 1 220px; display:flex; padding:20px 22px 112px; }
    .ov-brief-edit-btn { position:absolute; top:16px; right:16px; width:32px; height:32px; border-radius:50%;
      border:none; background:var(--warning-light); cursor:pointer; font-size:13px; color:var(--warning);
      box-shadow:0 2px 8px rgba(15,35,38,.08); display:flex; align-items:center; justify-content:center; transition:all .15s; }
    .ov-brief-edit-btn:hover { background:var(--warning); color:#fff; transform:scale(1.08); }
    .ov-brief-cover-wrap { display:flex; flex-direction:column; gap:8px; flex:0 0 auto; }
    .ov-brief-edit-cover-actions { display:flex; gap:8px; flex-wrap:wrap; }
    .ov-brief-edit .ov-brief-text { display:flex; flex-direction:column; }
    .ov-brief-edit textarea { width:100%; resize:vertical; font:inherit; }
    .ov-brief-edit-actions { display:flex; justify-content:flex-end; gap:8px; margin-top:10px; }

    .ov-donut { width:168px; height:168px; border-radius:50%; position:relative;
      background: conic-gradient(var(--brand) calc(var(--pct,0)*3.6deg), var(--surface-2) 0deg);
      filter:drop-shadow(0 6px 14px rgba(66,203,208,.25)); }
    .ov-donut-hole { position:absolute; inset:18px; border-radius:50%; background:var(--surface);
      display:flex; flex-direction:column; align-items:center; justify-content:center; }
    .ov-donut-hole strong { font-size:32px; line-height:1.1; font-weight:800; }
    .ov-donut-hole span { font-size:12.5px; color:var(--text-muted); margin-top:4px; }
    /* 案件簡介卡右下角的迷你版整體進度環,疊在卡片上要有自己的白底陰影撐出層次,
       不然疊在封面圖上會糊在一起看不清楚。 */
    .ov-donut-mini { width:96px; height:96px; box-shadow:0 4px 14px -4px rgba(15,35,38,.35), 0 0 0 4px var(--surface); }
    .ov-donut-mini .ov-donut-hole { inset:10px; }
    .ov-donut-mini .ov-donut-hole strong { font-size:19px; }
    .ov-donut-mini .ov-donut-hole span { font-size:9.5px; margin-top:1px; }

    .ov-stage-scroll { display:flex; flex-wrap:nowrap; gap:14px; overflow-x:auto; padding-bottom:4px; }
    .ov-stage { flex:0 0 auto; width:92px; display:flex; flex-direction:column; align-items:center; gap:7px; text-align:center; }
    .ov-stage-ring { width:76px; height:76px; border-radius:50%; position:relative;
      background: conic-gradient(var(--stage-color,var(--brand)) calc(var(--pct,0)*3.6deg), var(--surface-2) 0deg); }
    .ov-stage-ring-hole { position:absolute; inset:7px; border-radius:50%; background:var(--surface);
      display:flex; align-items:center; justify-content:center; font-size:13.5px; font-weight:800; color:var(--stage-color,var(--brand)); }
    .ov-stage-name { font-size:12.5px; font-weight:700; }
    .ov-stage-sub { font-size:11px; color:var(--text-muted); }

    .ov-status-list { display:flex; flex-direction:column; gap:0; }
    .ov-status-row { display:flex; justify-content:space-between; align-items:center; padding:11px 0; border-bottom:1px solid var(--border); font-size:13.5px; }
    .ov-status-row:last-child { border-bottom:none; }
    .ov-status-row .lbl { color:var(--text-muted); }
    .ov-risk-low { color:var(--success); font-weight:700; }
    .ov-risk-medium { color:var(--warning); font-weight:700; }
    .ov-risk-high { color:var(--danger); font-weight:700; }

    .ov-metrics-group { display:flex; flex-direction:column; gap:18px; }
    .ov-metrics-group .ov-metrics + .ov-metrics { padding-top:18px; border-top:1px dashed var(--border); }
    .ov-metrics { display:grid; grid-template-columns:repeat(auto-fit,minmax(120px,1fr)); gap:12px; }
    .ov-metric { border-radius:14px; padding:14px 10px; text-align:center; background:var(--surface-2); }
    .ov-metric .ov-metric-icon { font-size:20px; }
    .ov-metric .ov-metric-label { font-size:12.5px; color:var(--text-muted); margin:4px 0; }
    .ov-metric .ov-metric-pct { font-size:22px; font-weight:800; }
    .ov-metric .ov-metric-sub { font-size:11px; color:var(--text-muted); }
    .ov-detail-agreed .ov-metric-pct { color:var(--success); }
    .ov-detail-opposed .ov-metric-pct { color:var(--danger); }
    .ov-detail-undecided .ov-metric-pct { color:var(--warning); }
    .ov-detail-noresponse .ov-metric-pct { color:var(--text-muted); }

    .ov-metrics-primary { grid-template-columns:repeat(auto-fit,minmax(190px,1fr)); gap:16px; }
    .ov-metric-primary { padding:20px 16px; background:var(--surface); border:1px solid var(--border); box-shadow:var(--shadow);
      transition:transform .15s, box-shadow .15s; }
    .ov-metric-primary:hover { transform:translateY(-2px); box-shadow:var(--shadow-hover); }
    .ov-metric-icon-badge { width:48px; height:48px; border-radius:50%; margin:0 auto 10px; font-size:22px;
      display:flex; align-items:center; justify-content:center; }
    .ov-metric-tone-brand .ov-metric-icon-badge { background:var(--brand-light); }
    .ov-metric-tone-info .ov-metric-icon-badge { background:var(--info-light); }
    .ov-metric-tone-brown .ov-metric-icon-badge { background:var(--brown-light); }
    .ov-metric-tone-danger .ov-metric-icon-badge { background:var(--danger-light); }
    .ov-metric-tone-muted .ov-metric-icon-badge { background:var(--surface-2); }
    .ov-metric-primary .ov-metric-label { font-size:13px; font-weight:700; color:var(--text); }
    .ov-metric-primary .ov-metric-pct { font-size:30px; font-weight:800; }
    .ov-metric-tone-brand .ov-metric-pct { color:var(--brand-dark, var(--brand)); }
    .ov-metric-tone-info .ov-metric-pct { color:var(--info); }
    .ov-metric-tone-brown .ov-metric-pct { color:var(--brown); }
    .ov-metric-tone-danger .ov-metric-pct { color:var(--danger); }
    .ov-metric-tone-muted .ov-metric-pct { color:var(--text-muted); }
    .ov-metric-primary .ov-metric-sub { font-size:11.5px; margin-top:2px; }

    .ov-member-row { display:flex; align-items:center; gap:10px; padding:8px 0; font-size:13.5px; }
    .ov-member-avatar { width:32px; height:32px; border-radius:50%; background:var(--brand-light); color:var(--brand-dark);
      display:flex; align-items:center; justify-content:center; font-weight:800; font-size:13px; flex:0 0 auto; }
    .ov-member-main { flex:1 1 auto; min-width:0; }
    .ov-member-role { font-size:11.5px; color:var(--text-muted); }

    .ov-list-row { display:flex; justify-content:space-between; align-items:flex-start; gap:10px; padding:9px 0; border-bottom:1px solid var(--border); font-size:13px; }
    .ov-list-row:last-child { border-bottom:none; }
    .ov-list-row-main { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .ov-list-row-sub { color:var(--text-muted); font-size:11.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .ov-list-row-meta { flex:0 0 auto; color:var(--text-muted); font-size:11.5px; text-align:right; white-space:nowrap; padding-top:1px; }
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

function _ovMetric(icon, label, ratio, subText, tone) {
  const pct = Math.round((ratio || 0) * 100);
  return `
    <div class="ov-metric ov-metric-primary ov-metric-tone-${tone}">
      <div class="ov-metric-icon-badge">${icon}</div>
      <div class="ov-metric-label">${label}</div>
      <div class="ov-metric-pct">${pct}%</div>
      <div class="ov-metric-sub">${subText}</div>
    </div>`;
}

function _ovDetailOther(detail) {
  if (!detail) return 0;
  return (detail.undecided || 0) + (detail.no_response || 0);
}

function _ovDetailRatio(detail, kind) {
  if (!detail || !detail.total) return 0;
  const count = kind === "opposed" ? detail.opposed || 0 : _ovDetailOther(detail);
  return count / detail.total;
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

function _ovCardTitle(icon, label, rightHtml) {
  return `<h3><span><span class="ov-card-icon">${icon}</span>${label}</span>${rightHtml || ""}</h3>`;
}

// 待辦事項卡片(案件總覽頁)- 跟工作看板行事曆、全站鈴鐺提醒同一份 calendar_events
// 資料,這裡篩成只看這個案件的,逾期的排最後面但還是要看得到(見 backend
// routers/project_overview.py get_project_todos)。
function _ovTodosHtml(todos, pid) {
  if (!todos || !todos.length) return `<div class="helper-text">尚無待辦事項</div>`;
  return `<div class="ov-todo-list">${todos
    .map(
      (t) => `<div class="ov-todo-row${t.is_overdue ? " ov-todo-overdue" : ""}">
        <div class="ov-todo-main">
          <div class="ov-todo-text">${t.is_important ? "⭐ " : ""}${escapeHtml(t.content)}</div>
          <div class="ov-todo-date">${fmtDate(t.event_date)}${t.is_overdue ? "・已過期" : ""}</div>
        </div>
        ${isEditor() ? `<button type="button" class="btn-link btn-sm" data-ov-todo-delete="${t.id}">刪除</button>` : ""}
      </div>`
    )
    .join("")}</div>`;
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
      <div class="ov-brief-text-card">
        <div class="ov-brief-text">
          <div class="ov-brief-label">案件簡介</div>
          ${proj.summary ? escapeHtml(proj.summary).replace(/\n/g, "<br>") : `<span class="helper-text">尚未填寫案件簡介</span>`}
        </div>
        <button type="button" class="ov-brief-edit-btn" id="ov-brief-edit-btn" title="編輯簡介與封面圖">✏️</button>
      </div>
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
      <div class="ov-brief-text-card">
        <div class="ov-brief-text">
          <div class="ov-brief-label">案件簡介</div>
          <textarea id="ov-brief-summary-input" rows="5" placeholder="案件簡介,例如基地面積、預計興建規模等">${escapeHtml(proj.summary || "")}</textarea>
          <div class="ov-brief-edit-actions">
            <button type="button" class="btn-secondary btn-sm" id="ov-brief-cancel-btn">取消</button>
            <button type="button" class="btn-primary btn-sm" id="ov-brief-save-btn">儲存</button>
          </div>
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

  let overview, members, docs, notes, feed, todos;
  try {
    [overview, members, docs, notes, feed, todos] = await Promise.all([
      api(`/projects/${pid}/overview`),
      api(`/projects/${pid}/members`, { silent: true }).catch(() => []),
      api(`/projects/${pid}/documents`, { silent: true }).catch(() => []),
      api(`/projects/${pid}/notes`, { silent: true }).catch(() => []),
      api(`/projects/${pid}/activity-feed`, { silent: true }).catch(() => []),
      api(`/projects/${pid}/overview/todos`, { silent: true }).catch(() => []),
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

  // 案件資訊列/簡介卡不是 #project-overview-content 裡的東西 - 它們跟麵包屑/標題一樣
  // 放在頁面固定的標題區(index.html 的 pd-top-grid),左右並排對齊,不是分頁內容
  // 卷軸捲下去才看得到的一部分。
  const metaRowEl = document.getElementById("pov-meta-row");
  if (metaRowEl) {
    metaRowEl.innerHTML = `
      <span class="ov-meta-item">📍 ${escapeHtml([proj.city, proj.district, proj.address].filter(Boolean).join("") || "—")}</span>
      <span class="ov-meta-item">📁 ${escapeHtml(proj.project_code || "—")}</span>
      ${proj.case_type ? `<span class="ov-meta-item">🏢 ${escapeHtml(proj.case_type)}</span>` : ""}
      <span class="ov-meta-item">📅 ${dateRangeText}</span>
      ${handlerName ? `<span class="ov-meta-item">👤 負責人:${escapeHtml(handlerName)}</span>` : ""}
      ${managerName ? `<span class="ov-meta-item">💼 主管:${escapeHtml(managerName)}</span>` : ""}`;
  }
  const briefCardEl = document.getElementById("ov-brief-card");
  if (briefCardEl) briefCardEl.innerHTML = _ovBriefViewHtml(proj);

  const progressCardEl = document.getElementById("ov-progress-card");
  if (progressCardEl) {
    progressCardEl.innerHTML = `
      <div class="ov-donut ov-donut-mini" style="--pct:${overview.overall_progress_pct}" title="整體進度 ${overview.overall_progress_pct}%">
        <div class="ov-donut-hole"><strong>${overview.overall_progress_pct}%</strong><span>${escapeHtml(PROJECT_STATUS_LABEL[overview.case_status.status] || overview.case_status.status)}</span></div>
      </div>`;
  }

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
            <div class="ov-list-row-main" title="${escapeHtml(d.file_name)}">📄 ${escapeHtml(d.file_name)}</div>
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
            <div style="min-width:0">
              <div class="ov-list-row-main" title="${escapeHtml(t.text)}">${icon} ${escapeHtml(t.text)}</div>
              <div class="ov-list-row-sub">${escapeHtml(t.who || "—")}</div>
            </div>
            <div class="ov-list-row-meta">${fmtDateTime(t.time)}</div>
          </div>`;
        })
        .join("")
    : `<div class="helper-text">尚無紀錄</div>`;

  const stageBandEl = document.getElementById("ov-stage-band");
  if (stageBandEl) stageBandEl.innerHTML = `<div class="ov-stage-scroll">${overview.stages.map(_ovStageHtml).join("")}</div>`;

  el.innerHTML = `
    <div class="ov-grid">
      <div class="ov-row ov-row-r2">
        <div class="ov-card">
          ${_ovCardTitle("🎯", "關鍵指標")}
          <div class="ov-metrics-group">
            <div class="ov-metrics ov-metrics-primary">
              ${_ovMetric("👥", "人數同意", overview.key_metrics.headcount_ratio, `${overview.key_metrics.headcount_agreed} / ${overview.key_metrics.headcount_total} 人`, "brand")}
              ${_ovMetric("❌", "反對", _ovDetailRatio(overview.key_metrics.headcount_detail, "opposed"), `${overview.key_metrics.headcount_detail?.opposed || 0} / ${overview.key_metrics.headcount_detail?.total || 0} 人`, "danger")}
              ${_ovMetric("❔", "其他", _ovDetailRatio(overview.key_metrics.headcount_detail, "other"), `${_ovDetailOther(overview.key_metrics.headcount_detail)} / ${overview.key_metrics.headcount_detail?.total || 0} 人`, "muted")}
            </div>
            <div class="ov-metrics">
              ${_ovHeadcountDetailHtml(overview.key_metrics.headcount_detail)}
            </div>
          </div>
        </div>
        <div class="ov-card">
          ${_ovCardTitle("📋", "案件狀態")}
          ${_ovRiskCard(overview.case_status)}
        </div>
        <div class="ov-card">${_ovCardTitle("✅", "待辦事項", isEditor() ? `<button type="button" class="ov-todo-add-btn" id="ov-todo-add-btn" title="新增待辦事項">+</button>` : "")}${_ovTodosHtml(todos, pid)}</div>
      </div>

      <div class="ov-row ov-row-r3">
        <div class="ov-card">${_ovCardTitle("📝", "重要紀錄")}${timelineHtml}</div>
        <div class="ov-card">${_ovCardTitle("📁", "最近文件")}${docsHtml}</div>
        <div class="ov-card">${_ovCardTitle("👥", "相關人員")}${membersHtml}</div>
      </div>
    </div>`;

  _ovWireBriefCard(pid);

  document.getElementById("ov-todo-add-btn")?.addEventListener("click", () => {
    openAddReminderModal(pid, [{ id: pid, name: proj.name }], () => renderProjectOverviewTab(el));
  });
  el.querySelectorAll("[data-ov-todo-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("確定要刪除這筆待辦事項嗎?")) return;
      try {
        await api(`/dashboard/calendar/${btn.dataset.ovTodoDelete}`, { method: "DELETE" });
        toast("已刪除", "success");
        renderProjectOverviewTab(el);
      } catch (err) { }
    });
  });
}
