"use strict";

// 建物登記分頁把「地主」顯示成「屋主」比較符合語感 - 地主/屋主背後是同一張 landowners
// 資料表,只是名稱用哪個字依目前分頁而定,所以用一個模組層級變數記住目前該用哪個字,而不是
// 把 isLand 一路傳進每個共用的 modal 函式。
let currentLandownerLabel = "地主";

// 地主 / 土地登記 / 建物登記 / 聯絡紀錄有異動後,連帶更新專案上方的 SOP 進度與同意率、
// 以及左側側欄的關卡徽章與案件卡片統計(提醒/警示/緊急、人數/土地/建物同意)。
function syncProjectAggregates() {
  try { if (typeof renderSopSummary === "function") renderSopSummary(); } catch (e) {}
  try {
    if (typeof loadDashboard === "function") {
      Promise.resolve(loadDashboard()).then(() => {
        // loadDashboard 重畫了側欄案件清單,把目前案件的 active 標記補回去
        if (state.currentProjectId && typeof setActiveSidebarCase === "function") {
          setActiveSidebarCase(state.currentProjectId);
        }
      }).catch(() => {});
    }
  } catch (e) {}
}

// 合併後的「登記資料」分頁:上方兩個按鈕(土地登記 / 建物登記)切換,下方沿用
// renderLandownersTypeTab 依 land / building 渲染同一份清冊。
async function renderRegistrationsTab(el) {
  const mode = state.landRegSubMode === "building" ? "building" : "land";
  el.innerHTML = `
    <div class="reg-subtab-bar" style="display:flex;gap:8px;margin-bottom:16px">
      <button type="button" class="btn-sm reg-subtab ${mode === "land" ? "btn-primary" : "btn-secondary"}" data-reg-sub="land">土地登記</button>
      <button type="button" class="btn-sm reg-subtab ${mode === "building" ? "btn-primary" : "btn-secondary"}" data-reg-sub="building">建物登記</button>
    </div>
    <div id="reg-sub-content"><div class="empty-state">載入中...</div></div>`;

  el.querySelectorAll("[data-reg-sub]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      state.landRegSubMode = btn.dataset.regSub === "building" ? "building" : "land";
      el.querySelectorAll(".reg-subtab").forEach((x) => {
        const on = x.dataset.regSub === state.landRegSubMode;
        x.classList.toggle("btn-primary", on);
        x.classList.toggle("btn-secondary", !on);
      });
      await renderLandownersTypeTab(document.getElementById("reg-sub-content"), state.landRegSubMode);
    });
  });

  await renderLandownersTypeTab(document.getElementById("reg-sub-content"), mode);
}

// 「整合清冊」:一列 = 一位地主,土地 + 建物資料合併呈現。純檢視。
function _shortDoorAddr(addr) {
  if (!addr) return "";
  const s = String(addr).trim().replace(/[０-９]/g, (d) => "０１２３４５６７８９".indexOf(d));
  // 只保留「弄」開始到第一個「號」為止(含號);沒有弄就取「N(之N)號」。
  // 樓層、「房屋地下X層」等號碼後面的東西一律不要 → 同一門牌會被 uniqJoin 去重。
  let m = s.match(/\d+\s*弄.*?號/);
  if (m) return m[0].replace(/\s+/g, "");
  m = s.match(/\d+(?:\s*之\s*\d+)?\s*號/);
  if (m) return m[0].replace(/\s+/g, "");
  const idx = Math.max(s.lastIndexOf("大道"), s.lastIndexOf("路"), s.lastIndexOf("街"), s.lastIndexOf("道"), s.lastIndexOf("段"));
  const tail = idx >= 0 ? s.slice(idx + (s.substr(idx, 2) === "大道" ? 2 : 1)) : s;
  const dm = tail.match(/[0-9].*$/);
  return (dm ? dm[0] : tail).trim();
}

async function renderIntegratedRosterTab(el) {
  const pid = state.currentProjectId;
  const [owners, alerts, contactSummary, sop] = await Promise.all([
    api(`/projects/${pid}/landowners`),
    api(`/projects/${pid}/alerts`, { silent: true }).catch(() => []),
    api(`/projects/${pid}/contact-summary`, { silent: true }).catch(() => []),
    api(`/projects/${pid}/sop`, { silent: true }).catch(() => null),
  ]);
  const contactBy = new Map(contactSummary.map((c) => [c.landowner_id, c]));
  // SOP 第1關「確認地主清冊正確」的確認鈕搬到這裡(整合清冊工具列右側)—— 這裡才
  // 是實際盤點地主清冊的地方,SOP 頁只留狀態文字,不重複放按鈕。
  const rosterConfirmed = !!sop?.stages?.["1"]?.data?.checklist?.landowner_roster_confirmed;
  const rows = owners.filter((o) => (o.land_records || []).length || (o.building_records || []).length);

  const fmt2 = fmtArea;
  const uniqJoin = (arr) => [...new Set(arr.filter(Boolean))].join("、");

  // 「已連繫 / 待聯繫」由 contact_status + 逾期推導(一列可同時是已連繫又待聯繫)
  const contactTokens = (o) => {
    const c = contactBy.get(o.id);
    const t = [];
    if (["contacted", "agreed", "declined"].includes(o.contact_status)) t.push("linked");
    if (o.contact_status === "not_contacted" || (c && c.is_overdue)) t.push("pending");
    return t;
  };

  const ddHtml = (id, label, opts) => `
    <details class="integ-filter" style="position:relative">
      <summary style="list-style:none;cursor:pointer;padding:6px 12px;border:1px solid var(--border);border-radius:8px;background:var(--surface);white-space:nowrap;font-size:13px">${label} ▾</summary>
      <div id="${id}" style="position:absolute;z-index:20;margin-top:4px;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:8px 10px;box-shadow:0 4px 16px rgba(0,0,0,.12);min-width:140px">
        ${opts.map((o) => `<label style="display:flex;align-items:center;gap:6px;padding:3px 0;font-size:13px;white-space:nowrap"><input type="checkbox" value="${o.v}" style="width:auto">${o.t}</label>`).join("")}
      </div>
    </details>`;

  el.innerHTML = `
    <div class="section-toolbar" style="flex-wrap:wrap;gap:8px">
      <h3>整合清冊 (<span id="integ-count">${rows.length}</span>)</h3>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-right:auto">
        <input type="text" id="integrated-search" class="search-input-pill" style="max-width:240px" placeholder="搜尋姓名 / 地號 / 門牌...">
        ${ddHtml("integ-state-dd", "狀態", [
          { v: "visited", t: "已拜訪" }, { v: "not_visited", t: "未拜訪" },
          { v: "signed", t: "已簽約" }, { v: "not_signed", t: "未簽約" },
        ])}
        ${ddHtml("integ-visit-dd", "拜訪紀錄", [
          { v: "replied", t: "已回覆" }, { v: "not_replied", t: "未回覆" },
          { v: "linked", t: "已連繫" }, { v: "pending", t: "待聯繫" },
        ])}
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        ${rosterConfirmed && !isLandowner()
      ? `<button type="button" class="btn-primary btn-sm" id="roster-xlsx-btn">📊 產生地主清冊 Excel</button>`
      : ""
    }
        ${isEditor()
      ? `<button type="button" class="btn-${rosterConfirmed ? "secondary" : "primary"} btn-sm" id="integ-roster-confirm-btn" data-confirmed="${rosterConfirmed}">${rosterConfirmed ? "✓ 已確認地主清冊(點擊取消)" : "確認地主清冊正確"}</button>`
      : ""
    }
      </div>
    </div>
    <style>
      #integ-roster .table-wrap { border:1px solid var(--border); border-radius:12px; overflow:auto; box-shadow:0 1px 3px rgba(0,0,0,.04); }
      #integ-roster table { border-collapse:separate; border-spacing:0; width:100%; font-size:13px; }
      #integ-roster thead th {
        position:sticky; top:0; z-index:2; background:var(--surface-2);
        padding:10px 12px; text-align:left; font-weight:700; color:var(--text-muted);
        white-space:nowrap; border-bottom:1px solid var(--border);
      }
      #integ-roster tbody td { padding:9px 12px; border-bottom:1px solid var(--border); vertical-align:middle; }
      #integ-roster tbody tr:last-child td { border-bottom:none; }
      #integ-roster tbody tr:nth-child(even) { background:color-mix(in srgb, var(--surface-2) 45%, transparent); }
      #integ-roster tbody tr:hover { background:color-mix(in srgb, var(--brand) 8%, transparent); }
      #integ-roster .col-idx { color:var(--text-muted); font-variant-numeric:tabular-nums; width:52px; }
      #integ-roster .col-nowrap { white-space:nowrap; }
      #integ-roster .col-name { font-weight:600; }
      #integ-roster .num { text-align:right; font-variant-numeric:tabular-nums; white-space:nowrap; }
      #integ-roster th.num { text-align:right; }
      #integ-roster .cell-state, #integ-roster .cell-visit { white-space:nowrap; }
      #integ-roster .cell-visit .mini-badge { margin-right:6px; }
      #integ-roster .row-actions { white-space:nowrap; text-align:right; }
      #integ-roster .row-actions .btn-sm { padding:3px 10px; }
      #integ-roster .visit-date { color:var(--text-muted); }
    </style>
    <div id="integ-roster"><div class="table-wrap">
      <table>
        <thead><tr>
          <th class="col-idx">#</th><th>建物門牌</th><th>地號</th><th>姓名</th><th>狀態</th>
          <th class="num">土地㎡</th><th class="num">土地(坪)</th><th class="num">建物㎡</th><th class="num">建物(坪)</th>
          <th>拜訪紀錄</th><th class="row-actions">操作</th>
        </tr></thead>
        <tbody>
        ${rows.map((o, i) => {
    const lr = o.land_records || [];
    const br = o.building_records || [];
    const landSqm = lr.reduce((s, r) => s + (Number(r.owned_area_sqm) ||
      (Number(r.total_area_sqm || 0) * (r.ownership_numerator || 1)) / (r.ownership_denominator || 1)), 0);
    const bldSqm = br.reduce((s, r) => s + (Number(r.total_area_sqm || 0) * (r.ownership_numerator || 1)) / (r.ownership_denominator || 1), 0);
    const c = contactBy.get(o.id);
    const visit = c && c.last_contact_date
      ? `${fmtDate(c.last_contact_date)}${c.is_overdue ? ` <span class="contact-overdue-flag">⚠ 逾期</span>` : ""}`
      : `<span style="color:var(--text-muted)">尚無</span>`;
    const hay = `${o.name} ${o.id_number || ""} ${lr.map((r) => r.parcel_number).join(" ")} ${br.map((r) => r.address).join(" ")}`.toLowerCase();
    const stateTok = `${o.visit_status} ${o.agreement_status}`;
    const visitTok = `${o.reply_status} ${contactTokens(o).join(" ")}`;
    return `<tr data-hay="${escapeHtml(hay)}" data-state-tok="${stateTok}" data-visit-tok="${visitTok}">
            <td class="col-idx">${String(i + 1).padStart(3, "0")}</td>
            <td class="col-nowrap">${escapeHtml(uniqJoin(br.map((r) => _shortDoorAddr(r.address)))) || "-"}</td>
            <td class="col-nowrap">${escapeHtml(uniqJoin(lr.map((r) => r.parcel_number))) || "-"}</td>
            <td class="col-name">${escapeHtml(o.name)}</td>
            <td class="cell-state">
              <span class="agreement-status-badge as-${o.agreement_status}">${AGREEMENT_STATUS_LABEL[o.agreement_status]}</span>
              <span class="mini-badge ${o.visit_status === "visited" ? "gate-ok" : ""}" style="margin-left:4px">${VISIT_STATUS_LABEL[o.visit_status] || "未拜訪"}</span>
            </td>
            <td class="num">${fmt2(landSqm)}</td>
            <td class="num">${fmt2(landSqm * 0.3025)}</td>
            <td class="num">${fmt2(bldSqm)}</td>
            <td class="num">${fmt2(bldSqm * 0.3025)}</td>
            <td class="cell-visit">
              <span class="mini-badge ${o.reply_status === "replied" ? "gate-ok" : ""}">${REPLY_STATUS_LABEL[o.reply_status] || "未回覆"}</span>
              <span class="visit-date">${visit}</span>
            </td>
            <td class="row-actions">
              ${isEditor() ? `<button type="button" class="btn-secondary btn-sm" data-edit-integ="${o.id}">編輯</button>
              <button type="button" class="btn-danger btn-sm" data-delete-integ="${o.id}">刪除</button>` : "-"}
            </td>
          </tr>`;
  }).join("")}
        </tbody>
      </table>
    </div></div>`;

  const checked = (id) => [...el.querySelectorAll(`#${id} input:checked`)].map((c) => c.value);
  const applyIntegratedFilter = () => {
    const q = (document.getElementById("integrated-search")?.value || "").trim().toLowerCase();
    const st = checked("integ-state-dd");
    const vt = checked("integ-visit-dd");
    let shown = 0;
    el.querySelectorAll("tbody tr").forEach((tr) => {
      const okSearch = !q || (tr.dataset.hay || "").includes(q);
      const rowSt = (tr.dataset.stateTok || "").split(" ");
      const rowVt = (tr.dataset.visitTok || "").split(" ");
      const okSt = !st.length || st.some((x) => rowSt.includes(x));
      const okVt = !vt.length || vt.some((x) => rowVt.includes(x));
      const show = okSearch && okSt && okVt;
      tr.classList.toggle("hidden", !show);
      if (show) shown++;
    });
    const cnt = document.getElementById("integ-count");
    if (cnt) cnt.textContent = shown;
  };
  document.getElementById("integrated-search")?.addEventListener("input", applyIntegratedFilter);
  el.querySelectorAll(".integ-filter input").forEach((cb) => cb.addEventListener("change", applyIntegratedFilter));
  // 一次只開一個篩選面板,避免兩個面板重疊
  const integDetails = [...el.querySelectorAll("details.integ-filter")];
  integDetails.forEach((d) => {
    d.addEventListener("toggle", () => {
      if (d.open) integDetails.forEach((o) => { if (o !== d) o.open = false; });
    });
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".integ-filter")) integDetails.forEach((d) => (d.open = false));
  });
  el.querySelectorAll("[data-edit-integ]").forEach((b) => {
    b.addEventListener("click", () => openEditLandownerModal(Number(b.dataset.editInteg)));
  });
  el.querySelectorAll("[data-delete-integ]").forEach((b) => {
    b.addEventListener("click", () => deleteLandowner(Number(b.dataset.deleteInteg)));
  });

  const confirmRosterBtn = document.getElementById("integ-roster-confirm-btn");
  if (confirmRosterBtn) {
    confirmRosterBtn.addEventListener("click", async () => {
      const currentlyConfirmed = confirmRosterBtn.dataset.confirmed === "true";
      confirmRosterBtn.disabled = true;
      try {
        await api(`/projects/${pid}/sop/1/checklist`, {
          method: "POST",
          body: { key: "landowner_roster_confirmed", confirmed: !currentlyConfirmed },
        });
        toast(currentlyConfirmed ? "已取消確認" : "已確認地主清冊正確", "success");
        renderTab("integrated");
      } catch (err) {
        confirmRosterBtn.disabled = false;
      }
    });
  }

  const rosterXlsxBtn = document.getElementById("roster-xlsx-btn");
  if (rosterXlsxBtn) {
    rosterXlsxBtn.addEventListener("click", async () => {
      rosterXlsxBtn.disabled = true;
      const orig = rosterXlsxBtn.textContent;
      rosterXlsxBtn.textContent = "產生中…";
      try {
        const res = await api(`/projects/${pid}/roster.xlsx`);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const proj = state.currentProject || {};
        a.download = `${proj.project_code || "roster"}_地主清冊.xlsx`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        toast("地主清冊已下載", "success");
      } catch (err) {
      } finally {
        rosterXlsxBtn.disabled = false;
        rosterXlsxBtn.textContent = orig;
      }
    });
  }
}

async function renderLandownersTypeTab(el, type) {
  const pid = state.currentProjectId;
  const isLand = type === "land";
  currentLandownerLabel = isLand ? "地主" : "屋主";
  // 地主帳號沒有 documents 權限,個別呼叫失敗不應讓整頁掛掉
  const [allLandowners, documents, alerts, contactSummary] = await Promise.all([
    api(`/projects/${pid}/landowners`),
    api(`/projects/${pid}/documents`, { silent: true }).catch(() => []),
    api(`/projects/${pid}/alerts`, { silent: true }).catch(() => []),
    api(`/projects/${pid}/contact-summary`, { silent: true }).catch(() => []),
  ]);
  state.projectCache[pid].landowners = allLandowners;
  const contactByOwner = new Map(contactSummary.map((c) => [c.landowner_id, c]));

  const landowners = allLandowners.filter((o) => (isLand ? o.land_records : o.building_records).length > 0);
  const landownerIds = new Set(landowners.map((o) => o.id));

  const signedIds = new Set(
    documents.filter((d) => d.doc_type === "contract" && landownerIds.has(d.landowner_id)).map((d) => d.landowner_id)
  );
  const willingIds = new Set(
    documents.filter((d) => d.doc_type === "willingness_form_template" && landownerIds.has(d.landowner_id)).map((d) => d.landowner_id)
  );
  const alertIds = new Set(alerts.filter((a) => landownerIds.has(a.landowner_id)).map((a) => a.landowner_id));

  el.innerHTML = `
    <div class="dashboard-stat-row" style="margin-bottom:20px">
      <div class="dashboard-stat-item accent-brand" data-stat-filter="all" role="button" tabindex="0">
        <div class="dashboard-stat-icon">👥</div>
        <div><div class="dashboard-stat-num">${landowners.length}</div><div class="dashboard-stat-lbl">總${currentLandownerLabel}人數</div></div>
      </div>
      <div class="dashboard-stat-item accent-success" data-stat-filter="signed" role="button" tabindex="0">
        <div class="dashboard-stat-icon">✅</div>
        <div><div class="dashboard-stat-num">${signedIds.size}</div><div class="dashboard-stat-lbl">已簽約人數</div></div>
      </div>
      <div class="dashboard-stat-item accent-info" data-stat-filter="willing" role="button" tabindex="0">
        <div class="dashboard-stat-icon">📋</div>
        <div><div class="dashboard-stat-num">${willingIds.size}</div><div class="dashboard-stat-lbl">已意願書人數</div></div>
      </div>
      <div class="dashboard-stat-item accent-danger" data-stat-filter="alert" role="button" tabindex="0">
        <div class="dashboard-stat-icon">🔔</div>
        <div><div class="dashboard-stat-num">${alertIds.size}</div><div class="dashboard-stat-lbl">待聯繫提醒</div></div>
      </div>
    </div>
    <div class="section-toolbar">
      <h3>${isLand ? "土地登記清冊" : "建物登記清冊"} (${landowners.length})</h3>
      ${isEditor() || canOcr()
      ? `<div style="display:flex;gap:8px">
              ${canOcr() ? `<button class="btn-secondary btn-sm" id="scan-title-deed-btn">${isLand ? "土地登記匯入" : "建物登記匯入"}</button>` : ""}
              ${isEditor() ? `<button class="btn-primary btn-sm" id="add-landowner-btn">+ 新增${currentLandownerLabel}</button>` : ""}
            </div>`
      : ""
    }
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>編號</th><th>姓名</th><th>統一編號</th><th>門牌地址</th><th>${isLand ? "土地" : "建物"}持分</th>
          <th>意願狀態</th><th>聯繫狀態</th><th>操作</th>
        </tr></thead>
        <tbody>
          ${landowners
      .map((o, rowIdx) => {
        const records = isLand ? o.land_records : o.building_records;
        const shareLabel = records.length
          ? `${records[0].ownership_numerator}/${records[0].ownership_denominator}${records.length > 1 ? ` 等${records.length}筆` : ""}`
          : "-";
        const contact = contactByOwner.get(o.id);
        return `
            <tr data-row-owner="${o.id}">
              <td>${String(rowIdx + 1).padStart(3, "0")}</td>
              <td>${escapeHtml(o.name)}</td>
              <td>${escapeHtml(o.id_number) || "-"}</td>
              <td>${escapeHtml(o.address) || "-"}</td>
              <td>${shareLabel}</td>
              <td><span class="agreement-status-badge as-${o.agreement_status}">${AGREEMENT_STATUS_LABEL[o.agreement_status]}</span></td>
              <td>${contact && contact.is_overdue
            ? `<span class="contact-overdue-flag">⚠ 提醒</span>`
            : `<span class="contact-status-badge cs-${o.contact_status}">${CONTACT_STATUS_LABEL[o.contact_status]}</span>`
          }</td>
              <td class="actions-cell">
                <button class="btn-link btn-sm" data-detail="${o.id}">查看明細</button>
              </td>
            </tr>
            <tr class="detail-row hidden" id="detail-row-${o.id}"><td colspan="10">
              <div class="sub-detail">
                <div class="section-toolbar" style="margin-bottom:8px">
                  <strong>土地資料</strong>
                  ${isEditor() ? `<button class="btn-secondary btn-sm" data-add-land="${o.id}">+ 新增土地</button>` : ""}
                </div>
                ${o.land_records.length
            ? `<table>
                        <thead><tr><th>地號</th><th>地段</th><th>面積</th><th>持分</th><th>持有面積</th>${isEditor() ? "<th>操作</th>" : ""}</tr></thead>
                        <tbody>
                          ${o.land_records
              .map(
                (lr) => `<tr>
                                <td>${escapeHtml(lr.parcel_number)}</td>
                                <td>${escapeHtml(lr.section) || "-"}</td>
                                <td>${fmtArea(lr.total_area_sqm)}m²</td>
                                <td>${lr.ownership_numerator}/${lr.ownership_denominator}</td>
                                <td>${fmtArea(lr.owned_area_sqm)}m² (${lr.ownership_share_pct ?? "-"}%)</td>
                                ${isEditor()
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
                ${o.building_records.length
            ? `<table>
                        <thead><tr><th>建號</th><th>座落地號</th><th>樓層</th><th>面積</th><th>持分</th>${isEditor() ? "<th>操作</th>" : ""}</tr></thead>
                        <tbody>
                          ${o.building_records
              .map(
                (br) => `<tr>
                                <td>${escapeHtml(br.building_number) || "-"}</td>
                                <td>${escapeHtml((o.land_records.find((lr) => lr.id === br.land_record_id) || {}).parcel_number) || "-"}</td>
                                <td>${escapeHtml(br.floor) || "-"}</td>
                                <td>${fmtArea(br.total_area_sqm)}m²</td>
                                <td>${br.ownership_numerator}/${br.ownership_denominator} (${br.ownership_share_pct}%)</td>
                                ${isEditor()
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
          `;
      })
      .join("")}
        </tbody>
      </table>
    </div>
  `;

  if (!landowners.length) {
    el.querySelector(".table-wrap").outerHTML = `<div class="empty-state">${isLand ? "尚無土地登記資料" : "尚無建物登記資料"}</div>`;
  }

  {
    const statFilterSets = { signed: signedIds, willing: willingIds, alert: alertIds };
    const statCards = el.querySelectorAll("[data-stat-filter]");
    const applyStatFilter = (filter) => {
      statCards.forEach((card) => card.classList.toggle("active", card.dataset.statFilter === filter));
      const matchSet = filter === "all" ? null : statFilterSets[filter];
      el.querySelectorAll("[data-row-owner]").forEach((row) => {
        const ownerId = Number(row.dataset.rowOwner);
        const visible = !matchSet || matchSet.has(ownerId);
        row.classList.toggle("hidden", !visible);
        if (!visible) {
          const detailRow = document.getElementById(`detail-row-${ownerId}`);
          if (detailRow) detailRow.classList.add("hidden");
        }
      });
    };
    statCards.forEach((card) => {
      card.addEventListener("click", () => applyStatFilter(card.dataset.statFilter));
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          applyStatFilter(card.dataset.statFilter);
        }
      });
    });
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
  el.querySelectorAll("[data-log-contact]").forEach((btn) => {
    btn.addEventListener("click", () =>
      openAddContactModal(Number(btn.dataset.logContact), () => {
        renderTab(state.activeTab);
        syncProjectAggregates();
      })
    );
  });
  const addBtn = document.getElementById("add-landowner-btn");
  if (addBtn) addBtn.addEventListener("click", isLand ? openAddLandownerModal : openAddBuildingByNumberModal);
  const scanBtn = document.getElementById("scan-title-deed-btn");
  if (scanBtn) {
    // 防呆:建物登記要先有土地資料(建號要比對地號)。整個案件都沒有任何土地
    // record 時,擋下建物匯入並提示。
    const hasLandRecords = !isLand && allLandowners.some((o) => (o.land_records || []).length > 0);
    if (!isLand && !hasLandRecords) {
      scanBtn.style.opacity = "0.55";
      scanBtn.style.cursor = "not-allowed";
      scanBtn.title = "請先完成「土地登記匯入」,才能匯入建物登記";
      scanBtn.addEventListener("click", (e) => {
        e.preventDefault();
        toast("請先匯入土地登記 —— 建物的地號需要比對土地資料", "error");
      });
    } else {
      scanBtn.addEventListener("click", isLand ? openTitleDeedWizard : openBuildingTitleDeedWizard);
    }
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

function formatMonthToMinguo(yyyyMm) {
  if (!yyyyMm) return null;
  const parts = yyyyMm.split("-");
  if (parts.length === 2) {
    const minguoYear = Number(parts[0]) - 1911;
    return `${minguoYear}年${parts[1]}月`;
  }
  return yyyyMm;
}

function formatMinguoToMonth(minguoStr) {
  if (!minguoStr) return "";
  const match = minguoStr.match(/(\d+)年(\d+)月/);
  if (match) {
    const yyyy = Number(match[1]) + 1911;
    const mm = match[2].padStart(2, "0");
    return `${yyyy}-${mm}`;
  }
  return minguoStr;
}

function parcelOwnerRowHtml() {
  return `
    <div class="field-row">
      <div class="field"><label>登記次序</label><input class="po-reg-order" placeholder="例: 0006" autocomplete="off"></div>
      <div class="field"><label>所有權人姓名</label><input class="po-name" required placeholder="例: 陳仕偉" autocomplete="off"></div>
    </div>
    <div class="field-row">
      <div class="field">
        <label>權利範圍</label>
        <div style="display:flex;align-items:center;gap:6px">
          <input class="po-num" type="number" placeholder="分子" value="1" style="width:80px" autocomplete="off">
          <span style="color:var(--text-muted)">/</span>
          <input class="po-den" type="number" placeholder="分母" value="1" style="width:80px" autocomplete="off">
        </div>
      </div>
      <div class="field"><label>持分面積(m²)</label><input class="po-owned-sqm" type="number" step="0.01" placeholder="自動計算" readonly style="background:var(--bg-subtle)" autocomplete="off"></div>
      <div class="field"><label>持分面積(坪)</label><input class="po-owned-ping" type="number" step="0.001" placeholder="自動計算" readonly style="background:var(--bg-subtle)" autocomplete="off"></div>
    </div>
    <div class="field po-idnum-wrap"><label>統一編號</label><input class="po-idnum" placeholder="例如 A123456789 (一類完整、二類隱匿)" autocomplete="off"></div>
    <div class="field"><label>戶籍地址</label><input class="po-address" placeholder="完整戶籍地址" autocomplete="off"></div>
    <div class="field">
      <label>前次移轉現值或原規定地價(元/m²)</label>
      <div style="display:flex;gap:8px"
>
        <input class="po-ltt-period" type="text" placeholder="年月 (例: 86年01月)" style="flex:1" autocomplete="off">
        <input class="po-ltt-val" type="number" step="1"  style="flex:1" autocomplete="off">
      </div>
    </div>
    <div class="field"><label>備註</label><input class="po-notes" placeholder="選填備註" autocomplete="off"></div>
    <button type="button" class="btn-link btn-sm remove-po-row-btn" style="margin-top:6px">刪除此所有人</button>`;
}

function addParcelOwnerRow(container, totalAreaInput, prefill = {}) {
  const row = document.createElement("div");
  row.className = "po-row record-row";
  row.style.cssText = "border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:12px;background:var(--surface)";
  row.innerHTML = parcelOwnerRowHtml();

  if (prefill.registration_order) row.querySelector(".po-reg-order").value = prefill.registration_order;
  if (prefill.name) row.querySelector(".po-name").value = prefill.name;
  if (prefill.ownership_numerator) row.querySelector(".po-num").value = prefill.ownership_numerator;
  if (prefill.ownership_denominator) row.querySelector(".po-den").value = prefill.ownership_denominator;
  if (prefill.id_number) row.querySelector(".po-idnum").value = prefill.id_number;
  if (prefill.address) row.querySelector(".po-address").value = prefill.address;
  if (prefill.ltt_original_value_period) row.querySelector(".po-ltt-period").value = prefill.ltt_original_value_period;
  if (prefill.ltt_original_value) row.querySelector(".po-ltt-val").value = prefill.ltt_original_value;
  if (prefill.notes) row.querySelector(".po-notes").value = prefill.notes;

  const updateOwnedArea = () => {
    const totalArea = Number(totalAreaInput?.value) || 0;
    const num = Number(row.querySelector(".po-num").value) || 1;
    const den = Number(row.querySelector(".po-den").value) || 1;
    const ownedSqm = den > 0 ? (totalArea * num) / den : 0;
    const ownedPing = ownedSqm * 0.3025;
    row.querySelector(".po-owned-sqm").value = ownedSqm ? ownedSqm.toFixed(2) : "";
    row.querySelector(".po-owned-ping").value = ownedPing ? ownedPing.toFixed(3) : "";
  };

  row.updateOwnedArea = updateOwnedArea;

  row.querySelector(".po-num").addEventListener("input", updateOwnedArea);
  row.querySelector(".po-den").addEventListener("input", updateOwnedArea);
  updateOwnedArea();

  row.querySelector(".remove-po-row-btn").addEventListener("click", () => row.remove());
  container.appendChild(row);
  return row;
}

function openAddLandownerModal() {
  openModal(
    `按地號建立所有人資料`,
    `
    <form id="landowner-parcel-form">
      <div style="background:var(--bg-subtle);border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:16px">
        <div class="field-row">
          <div class="field"><label>地號</label><input name="parcel_number" required placeholder="例: 0232-0000" autocomplete="off"></div>
          <div class="field"><label>地段/小段</label><input name="section" placeholder="例: 信義區祥和段三小段" autocomplete="off"></div>
        </div>
        <div class="field-row">
          <div class="field"><label>土地總面積(m²)</label><input name="total_area_sqm" id="p-total-area" type="number" step="0.01" placeholder="例: 138.00" autocomplete="off"></div>
          <div class="field"><label>謄本類別</label>
            <select id="p-deed-category">
              <option value="第一類謄本">第一類謄本</option>
              <option value="第二類謄本" selected>第二類謄本</option>
              <option value="第三類謄本">第三類謄本</option>
            </select>
          </div>
        </div>
      </div>

      <fieldset>
        <legend>此地號下的所有人清單</legend>
        <div id="parcel-owners-list"></div>
        <button type="button" class="btn-secondary btn-sm" id="add-po-row-btn" style="margin-top:8px">+ 新增一位所有權人</button>
      </fieldset>

      <div class="modal-footer">
        <button type="button" class="btn-secondary" onclick="closeModal()">取消</button>
        <button type="submit" class="btn-primary">建立</button>
      </div>
    </form>`
  );

  const ownersList = document.getElementById("parcel-owners-list");
  const totalAreaInput = document.getElementById("p-total-area");
  const deedCatSelect = document.getElementById("p-deed-category");
  const applyDeedCategory = () => {
    const isThird = deedCatSelect.value.includes("第三類");
    ownersList.querySelectorAll(".po-idnum-wrap").forEach((w) => {
      w.style.display = isThird ? "none" : "block";
    });
  };
  deedCatSelect.addEventListener("change", applyDeedCategory);

  addParcelOwnerRow(ownersList, totalAreaInput);
  applyDeedCategory();

  document.getElementById("add-po-row-btn").addEventListener("click", () => {
    addParcelOwnerRow(ownersList, totalAreaInput);
    applyDeedCategory();
  });
  totalAreaInput.addEventListener("input", () => {
    ownersList.querySelectorAll(".po-row").forEach((row) => row.updateOwnedArea && row.updateOwnedArea());
  });

  document.getElementById("landowner-parcel-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const parcelNumber = fd.get("parcel_number")?.toString().trim();
    const section = fd.get("section")?.toString().trim() || null;
    const totalAreaSqm = Number(fd.get("total_area_sqm")) || 0;

    const ownerRows = [...ownersList.querySelectorAll(".po-row")].map((row) => ({
      registration_order: row.querySelector(".po-reg-order")?.value.trim() || null,
      name: row.querySelector(".po-name")?.value.trim(),
      id_number: row.querySelector(".po-idnum")?.value.trim() || null,
      ownership_numerator: Number(row.querySelector(".po-num")?.value) || 1,
      ownership_denominator: Number(row.querySelector(".po-den")?.value) || 1,
      address: row.querySelector(".po-address")?.value.trim() || null,
      ltt_original_value_period: formatMonthToMinguo(row.querySelector(".po-ltt-period")?.value.trim()),
      ltt_original_value: Number(row.querySelector(".po-ltt-val")?.value) || null,
      notes: row.querySelector(".po-notes")?.value.trim() || null,
    })).filter((o) => o.name);

    if (ownerRows.length === 0) {
      toast("請至少填寫一位所有權人姓名", "error");
      return;
    }

    try {
      for (const o of ownerRows) {
        const payload = {
          name: o.name,
          id_number: o.id_number,
          phone: null,
          address: o.address,
          is_representative: false,
          notes: o.notes,
          land_records: [{
            registration_order: o.registration_order,
            parcel_number: parcelNumber,
            section: section,
            total_area_sqm: totalAreaSqm,
            ownership_numerator: o.ownership_numerator,
            ownership_denominator: o.ownership_denominator,
            ltt_original_value_period: o.ltt_original_value_period,
            ltt_original_value: o.ltt_original_value,
          }],
          building_records: [],
        };
        await api(`/projects/${state.currentProjectId}/landowners`, { method: "POST", body: payload });
      }
      closeModal();
      toast("地號與所有權人已成功建立", "success");
      renderTab(state.activeTab);
      syncProjectAggregates();
    } catch (err) { }
  });
}

function buildingOwnerRowHtml() {
  return `
    <div class="field-row">
      <div class="field"><label>登記次序</label><input class="bo-reg-order" placeholder="例: 0001" autocomplete="off"></div>
      <div class="field"><label>所有權人姓名</label><input class="bo-name" required placeholder="例: 鄭敏敏" autocomplete="off"></div>
    </div>
    <div class="field-row">
      <div class="field">
        <label>權利範圍</label>
        <div style="display:flex;align-items:center;gap:6px">
          <input class="bo-num" type="number" placeholder="分子" value="1" style="width:80px" autocomplete="off">
          <span style="color:var(--text-muted)">/</span>
          <input class="bo-den" type="number" placeholder="分母" value="1" style="width:80px" autocomplete="off">
        </div>
      </div>
      <div class="field"><label>持分面積(m²)</label><input class="bo-owned-sqm" type="number" step="0.01" placeholder="自動計算" readonly style="background:var(--bg-subtle)" autocomplete="off"></div>
      <div class="field"><label>持分面積(坪)</label><input class="bo-owned-ping" type="number" step="0.001" placeholder="自動計算" readonly style="background:var(--bg-subtle)" autocomplete="off"></div>
    </div>
    <div class="field bo-idnum-wrap"><label>統一編號</label><input class="bo-idnum" placeholder="例如 A123456789 (一類完整、二類隱匿)" autocomplete="off"></div>
    <div class="field"><label>戶籍地址</label><input class="bo-address" placeholder="完整戶籍地址" autocomplete="off"></div>
    <div class="field"><label>備註</label><input class="bo-notes" placeholder="選填備註" autocomplete="off"></div>
    <button type="button" class="btn-link btn-sm remove-bo-row-btn" style="margin-top:6px">刪除此所有人</button>`;
}

function addBuildingOwnerRow(container, getTotalArea, prefill = {}) {
  const row = document.createElement("div");
  row.className = "bo-row record-row";
  row.style.cssText = "border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:12px;background:var(--surface)";
  row.innerHTML = buildingOwnerRowHtml();

  if (prefill.registration_order) row.querySelector(".bo-reg-order").value = prefill.registration_order;
  if (prefill.name) row.querySelector(".bo-name").value = prefill.name;
  if (prefill.ownership_numerator) row.querySelector(".bo-num").value = prefill.ownership_numerator;
  if (prefill.ownership_denominator) row.querySelector(".bo-den").value = prefill.ownership_denominator;
  if (prefill.id_number) row.querySelector(".bo-idnum").value = prefill.id_number;
  if (prefill.address) row.querySelector(".bo-address").value = prefill.address;
  if (prefill.notes) row.querySelector(".bo-notes").value = prefill.notes;

  const updateOwnedArea = () => {
    const totalArea = getTotalArea() || 0;
    const num = Number(row.querySelector(".bo-num").value) || 1;
    const den = Number(row.querySelector(".bo-den").value) || 1;
    const ownedSqm = den > 0 ? (totalArea * num) / den : 0;
    const ownedPing = ownedSqm * 0.3025;
    row.querySelector(".bo-owned-sqm").value = ownedSqm ? ownedSqm.toFixed(2) : "";
    row.querySelector(".bo-owned-ping").value = ownedPing ? ownedPing.toFixed(3) : "";
  };

  row.updateOwnedArea = updateOwnedArea;

  row.querySelector(".bo-num").addEventListener("input", updateOwnedArea);
  row.querySelector(".bo-den").addEventListener("input", updateOwnedArea);
  updateOwnedArea();

  row.querySelector(".remove-bo-row-btn").addEventListener("click", () => row.remove());
  container.appendChild(row);
  return row;
}

function openAddBuildingByNumberModal() {
  openModal(
    `按建號建立建物與所有人資料`,
    `
    <form id="building-by-number-form">
      <div style="background:var(--bg-subtle);border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:16px">
        <div class="field-row">
          <div class="field"><label>建號</label><input name="building_number" required placeholder="例: 00060-000" autocomplete="off"></div>
          <div class="field"><label>樓層</label><input name="floor" placeholder="例: 1樓" autocomplete="off"></div>
          <div class="field"><label>謄本類別</label>
            <select id="b-deed-category">
              <option value="第一類謄本">第一類謄本</option>
              <option value="第二類謄本" selected>第二類謄本</option>
              <option value="第三類謄本">第三類謄本</option>
            </select>
          </div>
        </div>
        <div class="field"><label>建物地址/門牌</label><input name="address" placeholder="例: 台北市信義區祥和路100號" autocomplete="off"></div>
        <div class="field-row">
          <div class="field"><label>主建物面積(m²)</label><input name="structure_area_sqm" id="b-struct-area" type="number" step="0.01" value="0" autocomplete="off"></div>
          <div class="field"><label>附屬建物面積(m²)</label><input name="auxiliary_area_sqm" id="b-aux-area" type="number" step="0.01" value="0" autocomplete="off"></div>
        </div>
        <div class="field-row">
          <div class="field"><label>共有部分面積(m²)</label><input name="common_area_sqm" id="b-common-area" type="number" step="0.01" value="0" autocomplete="off"></div>
          <div class="field"><label>建物總面積(m²)</label><input id="b-total-area" type="number" step="0.01" placeholder="自動計算" readonly style="background:var(--bg-subtle)" autocomplete="off"></div>
        </div>
      </div>

      <fieldset>
        <legend>此建號的所有權人</legend>
        <div id="building-owners-list"></div>
        <button type="button" class="btn-secondary btn-sm" id="add-bo-row-btn" style="margin-top:8px">+ 新增一位所有權人</button>
      </fieldset>

      <div class="modal-footer">
        <button type="button" class="btn-secondary" onclick="closeModal()">取消</button>
        <button type="submit" class="btn-primary">建立</button>
      </div>
    </form>`
  );

  const ownersList = document.getElementById("building-owners-list");
  const structInput = document.getElementById("b-struct-area");
  const auxInput = document.getElementById("b-aux-area");
  const commonInput = document.getElementById("b-common-area");
  const totalInput = document.getElementById("b-total-area");

  const getTotalArea = () => {
    const total = (Number(structInput.value) || 0) + (Number(auxInput.value) || 0) + (Number(commonInput.value) || 0);
    totalInput.value = total ? total.toFixed(2) : "0.00";
    return total;
  };

  const updateAllOwnedAreas = () => {
    getTotalArea();
    ownersList.querySelectorAll(".bo-row").forEach((row) => row.updateOwnedArea && row.updateOwnedArea());
  };

  structInput.addEventListener("input", updateAllOwnedAreas);
  auxInput.addEventListener("input", updateAllOwnedAreas);
  commonInput.addEventListener("input", updateAllOwnedAreas);

  const deedCatSelect = document.getElementById("b-deed-category");
  const applyDeedCategory = () => {
    const isThird = deedCatSelect.value.includes("第三類");
    ownersList.querySelectorAll(".bo-idnum-wrap").forEach((w) => {
      w.style.display = isThird ? "none" : "block";
    });
  };
  deedCatSelect.addEventListener("change", applyDeedCategory);

  addBuildingOwnerRow(ownersList, getTotalArea);
  applyDeedCategory();

  document.getElementById("add-bo-row-btn").addEventListener("click", () => {
    addBuildingOwnerRow(ownersList, getTotalArea);
    applyDeedCategory();
  });

  document.getElementById("building-by-number-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const buildingNumber = fd.get("building_number")?.toString().trim();
    const floor = fd.get("floor")?.toString().trim() || null;
    const bAddress = fd.get("address")?.toString().trim() || null;
    const structureAreaSqm = Number(fd.get("structure_area_sqm")) || 0;
    const auxiliaryAreaSqm = Number(fd.get("auxiliary_area_sqm")) || 0;
    const commonAreaSqm = Number(fd.get("common_area_sqm")) || 0;

    const ownerRows = [...ownersList.querySelectorAll(".po-row, .bo-row")].map((row) => ({
      registration_order: row.querySelector(".bo-reg-order")?.value.trim() || null,
      name: row.querySelector(".bo-name")?.value.trim(),
      id_number: row.querySelector(".bo-idnum")?.value.trim() || null,
      ownership_numerator: Number(row.querySelector(".bo-num")?.value) || 1,
      ownership_denominator: Number(row.querySelector(".bo-den")?.value) || 1,
      address: row.querySelector(".bo-address")?.value.trim() || null,
      notes: row.querySelector(".bo-notes")?.value.trim() || null,
    })).filter((o) => o.name);

    if (ownerRows.length === 0) {
      toast("請至少填寫一位所有權人姓名", "error");
      return;
    }

    try {
      for (const o of ownerRows) {
        const payload = {
          name: o.name,
          id_number: o.id_number,
          phone: null,
          address: o.address,
          is_representative: false,
          notes: o.notes,
          land_records: [],
          building_records: [{
            registration_order: o.registration_order,
            building_number: buildingNumber,
            floor: floor,
            address: bAddress,
            structure_area_sqm: structureAreaSqm,
            auxiliary_area_sqm: auxiliaryAreaSqm,
            common_area_sqm: commonAreaSqm,
            ownership_numerator: o.ownership_numerator,
            ownership_denominator: o.ownership_denominator,
          }],
        };
        await api(`/projects/${state.currentProjectId}/landowners`, { method: "POST", body: payload });
      }
      closeModal();
      toast("建號與所有權人已成功建立", "success");
      renderTab(state.activeTab);
      syncProjectAggregates();
    } catch (err) { }
  });
}

async function openEditLandownerModal(landownerId) {
  // 直接打 API 拿最新資料,不要用 state.projectCache 裡的快取 —— 整合清冊分頁自己
  // 抓的地主清單沒有寫回這個快取,只有登記資料分頁會寫,所以在整合清冊儲存過一次
  // 之後,快取還是舊的,再點編輯會看到儲存前的舊狀態(例如拜訪/簽約狀態一直顯示
  // 未拜訪/未簽約)。
  let owner;
  try {
    owner = await api(`/projects/${state.currentProjectId}/landowners/${landownerId}`);
  } catch (e) {
    return;
  }
  if (!owner) return;
  const now = new Date();
  const localIso = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  openModal(
    `編輯${currentLandownerLabel}`,
    `
    <form id="landowner-edit-form">
      <div class="field-row">
        <div class="field"><label>姓名</label><input name="name" value="${escapeHtml(owner.name)}" required></div>
        <div class="field"><label>統一編號</label><input name="id_number" value="${escapeHtml(owner.id_number) || ""}" placeholder="例如 A123456789 (二類遮罩)" autocomplete="off"></div>
        <div class="field"><label>電話</label><input name="phone" value="${escapeHtml(owner.phone) || ""}"></div>
      </div>
      <div class="field">
        <label>拜訪 / 簽約狀態(未拜訪不能選已簽約)</label>
        <div id="lo-status-group" style="display:flex;flex-wrap:wrap;gap:8px 22px;padding:10px 14px;border:1px solid var(--border);border-radius:8px;background:var(--surface)">
          <label style="display:flex;align-items:center;gap:6px;font-weight:400;margin:0;cursor:pointer"><input type="radio" name="lo-visit-status" data-sg="visit" value="visited" ${owner.visit_status === "visited" ? "checked" : ""} style="width:auto">已拜訪</label>
          <label style="display:flex;align-items:center;gap:6px;font-weight:400;margin:0;cursor:pointer"><input type="radio" name="lo-visit-status" data-sg="visit" value="not_visited" ${(owner.visit_status || "not_visited") === "not_visited" ? "checked" : ""} style="width:auto">未拜訪</label>
          <label style="display:flex;align-items:center;gap:6px;font-weight:400;margin:0;cursor:pointer"><input type="radio" name="lo-agreement-status" data-sg="agreement" value="signed" ${owner.agreement_status === "signed" ? "checked" : ""} style="width:auto">已簽約</label>
          <label style="display:flex;align-items:center;gap:6px;font-weight:400;margin:0;cursor:pointer"><input type="radio" name="lo-agreement-status" data-sg="agreement" value="not_signed" ${(owner.agreement_status || "not_signed") === "not_signed" ? "checked" : ""} style="width:auto">未簽約</label>
        </div>
      </div>
      <div class="field"><label>回覆狀態</label>
        <select name="reply_status">
          ${Object.entries(REPLY_STATUS_LABEL)
            .map(([k, v]) => `<option value="${k}" ${(owner.reply_status || "not_replied") === k ? "selected" : ""}>${v}</option>`)
            .join("")}
        </select>
      </div>
      <div class="field"><label>地址</label><input name="address" value="${escapeHtml(owner.address) || ""}"></div>
      <div class="field">
        <label>綁定登入帳號(限地主帳號,可讓該地主自行登入查看本筆)</label>
        <select name="user_id" id="lo-bind-user"><option value="">— 未綁定 —</option></select>
      </div>

      <div style="border-top:1px solid var(--border);margin:16px 0 6px;padding-top:14px">
        <label for="lo-add-contact-toggle" style="display:inline-flex;align-items:center;gap:8px;font-weight:700;cursor:pointer;margin:0">
          <input type="checkbox" id="lo-add-contact-toggle" style="width:17px;height:17px;flex:none;margin:0;accent-color:var(--brand);cursor:pointer">
          <span>同時新增一筆聯絡紀錄</span>
        </label>
        <div id="lo-contact-fields" class="hidden" style="margin-top:10px">
          <div class="field-row">
            <div class="field"><label>聯絡時間</label><input type="datetime-local" name="c_contact_date" value="${localIso}"></div>
            <div class="field"><label>聯絡方式</label>
              <select name="c_contact_method">
                ${Object.entries(CONTACT_METHOD_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}
              </select>
            </div>
          </div>
          <div class="field-row">
            <div class="field"><label>聯絡結果</label>
              <select name="c_contact_result" id="lo-c-result">
                ${Object.entries(CONTACT_RESULT_LABEL).map(([k, v]) => `<option value="${k}" ${k === "undecided" ? "selected" : ""}>${v}</option>`).join("")}
              </select>
            </div>
            <div class="field" id="lo-c-followup"><label>下次跟進日期(選填)</label><input type="date" name="c_next_follow_up_date"></div>
          </div>
          <div class="field"><label>聯絡備註</label><textarea name="c_notes" rows="2"></textarea></div>
        </div>
      </div>

      <div class="modal-footer">
        <button type="button" class="btn-secondary" onclick="closeModal()">取消</button>
        <button type="submit" class="btn-primary">儲存</button>
      </div>
    </form>`
  );
  const contactToggle = document.getElementById("lo-add-contact-toggle");
  const contactFields = document.getElementById("lo-contact-fields");
  contactToggle.addEventListener("change", () => contactFields.classList.toggle("hidden", !contactToggle.checked));

  // 拜訪 / 簽約狀態:each group(visit / agreement)用 radio 讓瀏覽器原生保證「一定
  // 剛好選一個」——之前用 checkbox 自己模擬互斥,點已經選定的那個時 checkbox 原生
  // 行為是先取消勾選再被我們的程式碼強制勾回去,使用者會覺得「按了沒反應/按不
  // 了」;radio 點已選定的選項本來就什麼事都不會發生,不會有這種卡住的錯覺。
  const statusGroup = document.getElementById("lo-status-group");
  const visitBoxes = [...statusGroup.querySelectorAll('[data-sg="visit"]')];
  const agreementBoxes = [...statusGroup.querySelectorAll('[data-sg="agreement"]')];
  const signedBox = statusGroup.querySelector('[data-sg="agreement"][value="signed"]');
  const notSignedBox = statusGroup.querySelector('[data-sg="agreement"][value="not_signed"]');
  const notVisitedBox = statusGroup.querySelector('[data-sg="visit"][value="not_visited"]');
  const syncStatusGuard = () => {
    const isNotVisited = notVisitedBox.checked;
    signedBox.disabled = isNotVisited;
    signedBox.parentElement.style.opacity = isNotVisited ? "0.5" : "1";
    signedBox.parentElement.style.cursor = isNotVisited ? "not-allowed" : "pointer";
    if (isNotVisited && signedBox.checked) {
      signedBox.checked = false;
      notSignedBox.checked = true;
    }
  };
  [...visitBoxes, ...agreementBoxes].forEach((rb) => rb.addEventListener("change", syncStatusGuard));
  syncStatusGuard();

  // 綁定登入帳號下拉:載入所有地主角色帳號
  (async () => {
    const sel = document.getElementById("lo-bind-user");
    if (!sel) return;
    try {
      const users = await api(`/projects/${state.currentProjectId}/landowners/account-options`);
      sel.innerHTML =
        `<option value="">— 未綁定 —</option>` +
        users
          .map((u) => `<option value="${u.id}" ${owner.user_id === u.id ? "selected" : ""}>${escapeHtml(u.display_name)}(${escapeHtml(u.username)})</option>`)
          .join("");
    } catch (e) {
      sel.innerHTML = `<option value="">(無法載入帳號清單)</option>`;
    }
  })();

  const cResult = document.getElementById("lo-c-result");
  const cFollowup = document.getElementById("lo-c-followup");
  const syncFollowupVisibility = () => {
    const hide = cResult.value === "agreed" || cResult.value === "opposed";
    cFollowup.classList.toggle("hidden", hide);
    if (hide) cFollowup.querySelector("input").value = "";
  };
  cResult.addEventListener("change", syncFollowupVisibility);
  syncFollowupVisibility();

  document.getElementById("landowner-edit-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = Object.fromEntries(fd.entries());
    // 聯絡狀態不再讓人手動改 —— 有新增聯絡紀錄時,後端會照這筆的「聯絡結果」自動
    // 更新聯絡狀態(見 routers/contacts.py create_contact),這裡不用也不能送這個欄位。
    const payload = {
      name: data.name,
      id_number: data.id_number || null,
      phone: data.phone || null,
      agreement_status: agreementBoxes.find((b) => b.checked)?.value || "not_signed",
      visit_status: visitBoxes.find((b) => b.checked)?.value || "not_visited",
      reply_status: data.reply_status,
      address: data.address || null,
      user_id: data.user_id ? Number(data.user_id) : null,
    };
    try {
      await api(`/projects/${state.currentProjectId}/landowners/${landownerId}`, { method: "PATCH", body: payload });
      if (contactToggle.checked && data.c_contact_date) {
        await api(`/projects/${state.currentProjectId}/landowners/${landownerId}/contacts`, {
          method: "POST",
          body: {
            landowner_id: landownerId,
            contact_date: new Date(data.c_contact_date).toISOString(),
            contact_method: data.c_contact_method,
            contact_result: data.c_contact_result,
            notes: data.c_notes || null,
            next_follow_up_date: data.c_next_follow_up_date || null,
          },
        });
      }
      closeModal();
      toast("已更新", "success");
      renderTab(state.activeTab);
      syncProjectAggregates();
    } catch (err) { }
  });
}

async function deleteLandowner(id) {
  if (!confirm(`確定要刪除此${currentLandownerLabel}嗎?`)) return;
  try {
    await api(`/projects/${state.currentProjectId}/landowners/${id}`, { method: "DELETE" });
    toast("已刪除", "success");
    renderTab(state.activeTab);
    syncProjectAggregates();
  } catch (err) { }
}

function landRecordFormFields(record) {
  const r = record || {};
  return `
    <div class="field-row">
      <div class="field"><label>登記次序</label><input name="registration_order" value="${escapeHtml(r.registration_order) || ""}" placeholder="例: 0006" autocomplete="off"></div>
      <div class="field"><label>地號</label><input name="parcel_number" value="${escapeHtml(r.parcel_number) || ""}" placeholder="例: 0232-0000" required autocomplete="off"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>地段/小段</label><input name="section" value="${escapeHtml(r.section) || ""}" placeholder="例: 祥和段三小段" autocomplete="off"></div>
      <div class="field">
        <label>權利範圍</label>
        <div style="display:flex;align-items:center;gap:6px">
          <input name="ownership_numerator" type="number" value="${r.ownership_numerator ?? 1}" placeholder="分子" style="width:80px" autocomplete="off">
          <span style="color:var(--text-muted)">/</span>
          <input name="ownership_denominator" type="number" value="${r.ownership_denominator ?? 1}" placeholder="分母" style="width:80px" autocomplete="off">
        </div>
      </div>
    </div>
    <div class="field-row">
      <div class="field"><label>土地總面積(m²)</label><input name="total_area_sqm" type="number" step="0.01" value="${r.total_area_sqm ?? 0}" autocomplete="off"></div>
      <div class="field"><label>持分面積(m²)</label><input class="lr-owned-sqm" type="number" readonly placeholder="總面積 × 分子/分母" style="background:var(--bg-subtle)" tabindex="-1"></div>
      <div class="field"><label>持分面積(坪)</label><input class="lr-owned-ping" type="number" readonly style="background:var(--bg-subtle)" tabindex="-1"></div>
    </div>
    <div class="field">
      <label>前次移轉現值或原規定地價(元/m²)</label>
      <div style="display:flex;gap:8px">
        <input name="ltt_original_value_period" value="${escapeHtml(r.ltt_original_value_period) || ""}" placeholder="年月 (例: 95年12月)" style="flex:1" autocomplete="off">
        <input name="ltt_original_value" type="number" step="1" value="${r.ltt_original_value ?? ""}" placeholder="金額 (例: 123000)" style="flex:1" autocomplete="off">
      </div>
    </div>`;
}

// 編輯土地/建物登記時,依總面積與權利範圍即時重算持分面積,讓使用者存檔前就看到結果
// (後端 owned_area_sqm 是 DB GENERATED 欄位、建物 total_area_sqm 由 _compute_building_totals
// 重算,所以存檔後也一定是對的;這裡只是提前把重算結果顯示出來)。
function wireLandRecordAreaPreview(form) {
  const q = (s) => form.querySelector(s);
  const calc = () => {
    const total = Number(q('[name="total_area_sqm"]').value) || 0;
    const num = Number(q('[name="ownership_numerator"]').value) || 1;
    const den = Number(q('[name="ownership_denominator"]').value) || 1;
    const sqm = den ? (total * num) / den : 0;
    q(".lr-owned-sqm").value = sqm ? sqm.toFixed(2) : "";
    q(".lr-owned-ping").value = sqm ? (sqm * 0.3025).toFixed(2) : "";
  };
  form.addEventListener("input", calc);
  calc();
}

function wireBuildingRecordAreaPreview(form) {
  const q = (s) => form.querySelector(s);
  const calc = () => {
    const s = Number(q('[name="structure_area_sqm"]').value) || 0;
    const a = Number(q('[name="auxiliary_area_sqm"]').value) || 0;
    const c = Number(q('[name="common_area_sqm"]').value) || 0;
    q(".br-total-area").value = (s + a + c).toFixed(2);
  };
  form.addEventListener("input", calc);
  calc();
}

function readLandRecordForm(fd) {
  const data = Object.fromEntries(fd.entries());
  return {
    registration_order: data.registration_order || null,
    parcel_number: data.parcel_number,
    section: data.section || null,
    total_area_sqm: Number(data.total_area_sqm) || 0,
    ownership_numerator: Number(data.ownership_numerator) || 1,
    ownership_denominator: Number(data.ownership_denominator) || 1,
    ltt_original_value_period: data.ltt_original_value_period || null,
    ltt_original_value: Number(data.ltt_original_value) || null,
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
  const _f=document.getElementById("land-record-form");
  wireLandRecordAreaPreview(_f);
  _f.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api(`/projects/${state.currentProjectId}/landowners/${landownerId}/land-records`, {
        method: "POST",
        body: readLandRecordForm(new FormData(e.target)),
      });
      closeModal();
      toast("土地資料已新增", "success");
      renderTab(state.activeTab);
      syncProjectAggregates();
    } catch (err) { }
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
  const _f=document.getElementById("land-record-edit-form");
  wireLandRecordAreaPreview(_f);
  _f.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api(`/projects/${state.currentProjectId}/landowners/${landownerId}/land-records/${record.id}`, {
        method: "PATCH",
        body: readLandRecordForm(new FormData(e.target)),
      });
      closeModal();
      toast("已更新", "success");
      renderTab(state.activeTab);
      syncProjectAggregates();
    } catch (err) { }
  });
}

async function deleteLandRecord(landownerId, recordId) {
  if (!confirm("確定要刪除此筆土地資料嗎?")) return;
  try {
    await api(`/projects/${state.currentProjectId}/landowners/${landownerId}/land-records/${recordId}`, { method: "DELETE" });
    toast("已刪除", "success");
    renderTab(state.activeTab);
    syncProjectAggregates();
  } catch (err) { }
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
      <div class="field"><label>建物總面積(m²)</label><input class="br-total-area" type="number" readonly placeholder="主+附屬+共有" style="background:var(--bg-subtle)" tabindex="-1"></div>
    </div>
    <div class="field">
      <label>持分(分子/分母)</label>
      <div style="display:flex;gap:6px">
        <input name="ownership_numerator" type="number" value="${r.ownership_numerator ?? 1}">
        <input name="ownership_denominator" type="number" value="${r.ownership_denominator ?? 1}">
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
  const _f=document.getElementById("building-record-form");
  wireBuildingRecordAreaPreview(_f);
  _f.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api(`/projects/${state.currentProjectId}/landowners/${landownerId}/building-records`, {
        method: "POST",
        body: readBuildingRecordForm(new FormData(e.target)),
      });
      closeModal();
      toast("建物資料已新增", "success");
      renderTab(state.activeTab);
      syncProjectAggregates();
    } catch (err) { }
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
  const _f=document.getElementById("building-record-edit-form");
  wireBuildingRecordAreaPreview(_f);
  _f.addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      await api(`/projects/${state.currentProjectId}/landowners/${landownerId}/building-records/${record.id}`, {
        method: "PATCH",
        body: readBuildingRecordForm(new FormData(e.target)),
      });
      closeModal();
      toast("已更新", "success");
      renderTab(state.activeTab);
      syncProjectAggregates();
    } catch (err) { }
  });
}

async function deleteBuildingRecord(landownerId, recordId) {
  if (!confirm("確定要刪除此筆建物資料嗎?")) return;
  try {
    await api(`/projects/${state.currentProjectId}/landowners/${landownerId}/building-records/${recordId}`, { method: "DELETE" });
    toast("已刪除", "success");
    renderTab(state.activeTab);
    syncProjectAggregates();
  } catch (err) { }
}

function relationsShareSum(owners) {
  return owners.reduce((sum, ow) => sum + (Number(ow.numerator) || 0) / (Number(ow.denominator) || 1), 0);
}

async function renderRelationsTab(el) {
  const pid = state.currentProjectId;
  const landowners = await api(`/projects/${pid}/landowners`);
  if (!landowners.length) {
    el.innerHTML = `<div class="empty-state">尚無資料</div>`;
    return;
  }
  const landMap = new Map();
  landowners.forEach((o) => {
    (o.land_records || []).forEach((lr) => {
      const key = `${lr.section || ""}_${lr.parcel_number}`;
      if (!landMap.has(key)) {
        landMap.set(key, { section: lr.section, parcel: lr.parcel_number, area: lr.total_area_sqm, owners: [] });
      }
      landMap.get(key).owners.push({
        name: o.name,
        numerator: lr.ownership_numerator,
        denominator: lr.ownership_denominator,
      });
    });
  });
  const items = Array.from(landMap.values()).sort((a, b) => (a.parcel || "").localeCompare(b.parcel || ""));

  el.innerHTML = `
    <div class="section-toolbar">
      <h3>土地/地主對照關係表 (${items.length} 筆地號)</h3>
      <input type="search" id="relations-search" style="width:220px" placeholder="搜尋地號 / 地主姓名">
    </div>
    <div class="table-wrap">
      <table class="relations-table">
        <colgroup>
          <col style="width:110px"><col style="width:100px"><col style="width:100px"><col style="width:80px"><col>
        </colgroup>
        <thead><tr><th>地號</th><th>地段</th><th>面積</th><th>共有人</th><th>所有權人名單</th></tr></thead>
        <tbody id="relations-tbody">
          ${items.map(relationsRowHtml).join("")}
        </tbody>
      </table>
    </div>`;

  const searchInput = document.getElementById("relations-search");
  searchInput.addEventListener("input", () => {
    const q = searchInput.value.trim().toLowerCase();
    const filtered = q
      ? items.filter((item) => item.parcel?.toLowerCase().includes(q) || item.owners.some((ow) => ow.name.toLowerCase().includes(q)))
      : items;
    document.getElementById("relations-tbody").innerHTML = filtered.length
      ? filtered.map(relationsRowHtml).join("")
      : `<tr><td colspan="5" class="empty-state" style="border:none">查無符合的地號或地主</td></tr>`;
  });
}

function relationsRowHtml(item) {
  const shareSum = relationsShareSum(item.owners);
  const shareOff = Math.abs(shareSum - 1) > 0.02;
  return `<tr>
    <td class="relations-parcel-cell">${escapeHtml(item.parcel)}</td>
    <td>${escapeHtml(item.section) || "-"}</td>
    <td>${Number(item.area).toLocaleString()} m²</td>
    <td><span class="mini-badge">${item.owners.length} 人</span></td>
    <td>
      <div class="wizard-confirm-chip-list">
        ${item.owners.map((ow) => `<span class="wizard-confirm-chip">${escapeHtml(ow.name)}<span class="relations-chip-share">${ow.numerator}/${ow.denominator}</span></span>`).join("")}
      </div>
      ${shareOff ? `<div class="relations-share-warning">⚠ 權利範圍加總為 ${(shareSum * 100).toFixed(1)}%,請核對</div>` : ""}
    </td>
  </tr>`;
}

