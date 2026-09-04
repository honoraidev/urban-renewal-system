"use strict";

async function goToMyWork() {
  setActiveNav("mywork");
  showView("view-mywork");
  await loadMyWork();
}

function myWorkFollowUpTierClass(days) {
  if (days == null || days >= 30) return "tier-urgent";
  if (days >= 14) return "tier-warning";
  return "tier-reminder";
}

async function loadMyWork() {
  const statRow = document.getElementById("mywork-stat-row");
  const body = document.getElementById("mywork-body");
  if (statRow) statRow.innerHTML = `<div class="empty-state">載入中...</div>`;
  if (body) body.innerHTML = "";

  let data;
  try {
    data = await api("/dashboard/my-work");
  } catch (e) {
    if (statRow) statRow.innerHTML = "";
    if (body) body.innerHTML = `<div class="empty-state">載入失敗</div>`;
    return;
  }

  const s = data.stats;
  if (statRow) {
    statRow.innerHTML = `
      <div class="dashboard-stat-item accent-brand">
        <div class="dashboard-stat-icon">📁</div>
        <div><div class="dashboard-stat-num">${s.project_count}</div><div class="dashboard-stat-lbl">負責案件</div></div>
      </div>
      <div class="dashboard-stat-item accent-danger">
        <div class="dashboard-stat-icon">🔴</div>
        <div><div class="dashboard-stat-num">${s.urgent_count}</div><div class="dashboard-stat-lbl">緊急待聯絡</div></div>
      </div>
      <div class="dashboard-stat-item accent-info">
        <div class="dashboard-stat-icon">🟡</div>
        <div><div class="dashboard-stat-num">${s.warning_count}</div><div class="dashboard-stat-lbl">警示待聯絡</div></div>
      </div>
      <div class="dashboard-stat-item accent-success">
        <div class="dashboard-stat-icon">🟢</div>
        <div><div class="dashboard-stat-num">${s.reminder_count}</div><div class="dashboard-stat-lbl">提醒待聯絡</div></div>
      </div>
      <div class="dashboard-stat-item accent-brand">
        <div class="dashboard-stat-icon">🤖</div>
        <div><div class="dashboard-stat-num">${s.pending_ai_review_count}</div><div class="dashboard-stat-lbl">待檢視 OCR</div></div>
      </div>`;
  }

  if (!body) return;

  const projectsHtml = (data.projects || []).length
    ? `<div class="project-grid">
        ${data.projects
          .map(
            (p) => `
          <div class="card project-card" data-mywork-project="${p.id}" style="cursor:pointer">
            <div class="project-card-top">
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
          </div>`
          )
          .join("")}
      </div>`
    : `<div class="empty-state">目前沒有負責的案件</div>`;

  const followUpsHtml = (data.follow_ups || []).length
    ? `<div class="table-wrap">
        <table>
          <thead><tr><th>案件</th><th>地主</th><th>電話</th><th>聯絡狀態</th><th>最近聯絡</th><th>逾期天數</th></tr></thead>
          <tbody>
            ${data.follow_ups
              .map(
                (f) => `
              <tr data-mywork-project="${f.project_id}" style="cursor:pointer">
                <td>${escapeHtml(f.project_name)}</td>
                <td>${escapeHtml(f.landowner_name)}</td>
                <td>${escapeHtml(f.phone || "-")}</td>
                <td>${escapeHtml(CONTACT_STATUS_LABEL[f.contact_status] || f.contact_status)}</td>
                <td>${f.last_contact_date ? fmtDateTime(f.last_contact_date) : "從未聯絡"}</td>
                <td><span class="tier-badge ${myWorkFollowUpTierClass(f.days_since_last_contact)}">${
                  f.days_since_last_contact == null ? "—" : f.days_since_last_contact + " 天"
                }</span></td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>`
    : `<div class="empty-state">沒有待聯絡的地主 🎉</div>`;

  const recentHtml = (data.recent_contacts || []).length
    ? `<div class="table-wrap">
        <table>
          <thead><tr><th>時間</th><th>案件</th><th>地主</th><th>方式</th><th>結果</th><th>備註</th></tr></thead>
          <tbody>
            ${data.recent_contacts
              .map(
                (c) => `
              <tr data-mywork-project="${c.project_id}" style="cursor:pointer">
                <td>${fmtDateTime(c.contact_date)}</td>
                <td>${escapeHtml(c.project_name)}</td>
                <td>${escapeHtml(c.landowner_name)}</td>
                <td>${escapeHtml(CONTACT_METHOD_LABEL[c.contact_method] || c.contact_method)}</td>
                <td>${escapeHtml(CONTACT_RESULT_LABEL[c.contact_result] || c.contact_result)}</td>
                <td>${escapeHtml(c.notes || "-")}</td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>`
    : `<div class="empty-state">近期沒有你的聯絡紀錄</div>`;

  body.innerHTML = `
    <h3 style="margin:24px 0 10px">待聯絡地主(依逾期程度排序,最多 30 筆)</h3>
    ${followUpsHtml}
    <h3 style="margin:28px 0 10px">我負責的案件</h3>
    ${projectsHtml}
    <h3 style="margin:28px 0 10px">我的近期聯絡紀錄</h3>
    ${recentHtml}`;

  body.querySelectorAll("[data-mywork-project]").forEach((el) => {
    el.addEventListener("click", () => openProject(Number(el.dataset.myworkProject)));
  });
}

function initMyWork() {
  const btn = document.getElementById("mywork-refresh-btn");
  if (btn) btn.addEventListener("click", loadMyWork);
}
