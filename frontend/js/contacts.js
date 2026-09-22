"use strict";

// 「地主聯絡簿」—— 純聯絡資訊清單(姓名/建物門牌/電話/戶籍地址),方便外出拜訪前
// 快速核對名單、電話。詳細的拜訪/聯絡紀錄仍在「編輯地主」視窗裡管理,這裡不重複。

// 分頁狀態跨次渲染保留,不放在 renderContactsTab 內部 - 不然每次重畫這個分頁
// 都會被重設回第 1 頁,使用者翻到一半的頁碼就白翻了。
let contactsUi = { page: 1, pageSize: 10 };

async function renderContactsTab(el) {
  const pid = state.currentProjectId;
  const owners = await api(`/projects/${pid}/landowners`);
  state.projectCache[pid].landowners = owners;

  // 只列「有地/有房」的實際地主 - 純粹掛在他項權利部下面的權利人(銀行等)不算
  // 需要外出聯絡的對象,同一套排除邏輯跟「整合清冊」一致。
  const allRows = owners.filter((o) => (o.land_records || []).length || (o.building_records || []).length);

  if (!allRows.length) {
    el.innerHTML = `<div class="empty-state">請先建立地主資料</div>`;
    return;
  }

  const hasPhone = (o) => !!(o.phone_landline || o.phone_mobile || o.phone);
  const isContacted = (o) => !!o.contact_status && o.contact_status !== "not_contacted";

  // 樓層篩選下拉選項:所有出現過的樓層,依樓層排序由低到高。
  const floorOptions = [...new Set(allRows.flatMap((o) => (o.building_records || []).map(_floorLabelOf).filter(Boolean)))].sort(
    (a, b) => _floorSortKey(a) - _floorSortKey(b)
  );

  el.innerHTML = `
    <div class="section-toolbar" style="flex-wrap:wrap;gap:12px">
      <h3 class="section-hero-title"><span class="hero-ic">👥</span><span>地主聯絡簿 (<span id="contacts-count">${allRows.length}</span>)</span></h3>
      <div class="hero-search">${BV_ICON.search}<input type="text" id="contacts-search" placeholder="搜尋地主姓名 / 建物門牌 / 電話 / 戶籍地址..."></div>
      ${floorOptions.length
      ? `<details class="integ-filter">
              <summary>樓層<span class="integ-filter-badge" id="contacts-floor-dd-badge"></span></summary>
              <div id="contacts-floor-dd" class="integ-filter-panel">
                ${floorOptions.map((f) => `<label><input type="checkbox" value="${escapeHtml(f)}">${escapeHtml(f)}</label>`).join("")}
              </div>
            </details>`
      : ""
    }
      <details class="integ-filter">
        <summary>聯絡方式<span class="integ-filter-badge" id="contacts-phone-dd-badge"></span></summary>
        <div id="contacts-phone-dd" class="integ-filter-panel">
          <label><input type="checkbox" value="has">有電話</label>
          <label><input type="checkbox" value="none">無電話</label>
        </div>
      </details>
      <button type="button" class="btn-secondary btn-sm" id="contacts-clear-btn" title="清除篩選">↺ 清除篩選</button>
      <div style="margin-left:auto;display:flex;gap:8px">
        <button type="button" class="btn-secondary btn-sm" id="contacts-export-btn">⬆ 匯出 Excel</button>
        ${isEditor() ? `<button class="btn-primary btn-sm" id="contacts-add-btn">+ 新增地主</button>` : ""}
      </div>
    </div>
    <div class="helper-text" style="margin:-4px 0 14px">管理地主聯絡資訊,支援搜尋、篩選與批次聯絡作業。</div>
    <style>
      #contacts-roster { margin-top:16px; }
      #contacts-roster .table-wrap { border:1px solid var(--border); border-radius:12px; overflow:auto; box-shadow:0 1px 3px rgba(0,0,0,.04); }
      #contacts-roster table { border-collapse:separate; border-spacing:0; width:100%; font-size:13px; }
      #contacts-roster thead th {
        position:sticky; top:0; z-index:2; background:var(--surface-2);
        padding:10px 12px; text-align:left; font-weight:700; color:var(--text-muted);
        white-space:nowrap; border-bottom:1px solid var(--border);
      }
      #contacts-roster tbody td { padding:9px 12px; border-bottom:1px solid var(--border); vertical-align:middle; }
      #contacts-roster tbody tr:last-child td { border-bottom:none; }
      #contacts-roster tbody tr:nth-child(even) { background:color-mix(in srgb, var(--surface-2) 45%, transparent); }
      #contacts-roster tbody tr:hover { background:color-mix(in srgb, var(--brand) 8%, transparent); }
      #contacts-roster .col-idx { color:var(--text-muted); font-variant-numeric:tabular-nums; width:52px; }
      #contacts-roster .col-name { font-weight:600; white-space:nowrap; }
      #contacts-roster .cell-phone { line-height:1.6; white-space:nowrap; }
      #contacts-roster .cell-phone .ph-mobile { color:var(--text-muted); }
      #contacts-roster .cell-phone .ph-empty { color:var(--text-muted); }
      #contacts-roster .cell-addr { color:var(--text); }
      .contacts-stat-pct { margin-left:6px; font-size:12px; font-weight:600; color:var(--text-muted); }
    </style>
    <div id="contacts-roster"><div class="table-wrap">
      <table>
        <thead><tr>
          <th class="col-idx">#</th><th>地主姓名</th><th>建物門牌</th><th class="col-floor">樓層</th><th>連絡電話</th><th>戶籍地址</th>
        </tr></thead>
        <tbody id="contacts-tbody"></tbody>
      </table>
    </div></div>
    <div class="lv-foot" id="contacts-foot"></div>`;

  const rowHtml = (o, seq) => {
    // 「房屋地下N層」的地下室/車位建號常是依持分比例登記給幾十位共有人,跟
    // 他自己真正的住家門牌標成一樣容易誤會成名下有好幾戶房子 - 標灰色
    // 「(地下持分)」跟真正住家門牌區分開(跟「整合清冊」同一套邏輯)。
    const addrMap = new Map();
    (o.building_records || []).forEach((r) => {
      const label = _shortDoorAddr(r.address);
      if (!label) return;
      const shared = /房屋地下/.test(r.address || "");
      if (!addrMap.has(label)) addrMap.set(label, shared);
    });
    const doorEntries = [...addrMap.entries()];
    const phoneHtml = hasPhone(o)
      ? `${o.phone_landline ? `<div>${escapeHtml(o.phone_landline)}</div>` : ""}${o.phone_mobile ? `<div class="ph-mobile">${escapeHtml(o.phone_mobile)}</div>` : ""}${!o.phone_landline && !o.phone_mobile && o.phone ? `<div>${escapeHtml(o.phone)}</div>` : ""}`
      : `<span class="ph-empty">未填寫</span>`;
    const doorHtml = doorEntries.length
      ? `<div style="display:flex;flex-wrap:wrap;gap:4px">${doorEntries
          .map(([a, shared]) =>
            shared
              ? `<span class="mini-badge mini-badge-shared-door" title="依持分比例登記的地下室/車位建號,非專屬住家門牌">${escapeHtml(a)}(地下持分)</span>`
              : `<span class="mini-badge">${escapeHtml(a)}</span>`
          )
          .join("")}</div>`
      : `<span style="color:var(--text-muted)">-</span>`;
    return `<tr>
      <td class="col-idx">${String(seq).padStart(3, "0")}</td>
      <td class="col-name">${escapeHtml(o.name)}</td>
      <td>${doorHtml}</td>
      <td class="col-floor">${_floorsCellHtml(o.building_records)}</td>
      <td class="cell-phone">${phoneHtml}</td>
      <td class="cell-addr">${o.address ? escapeHtml(o.address) : `<span style="color:var(--text-muted)">未填寫</span>`}</td>
    </tr>`;
  };

  const checked = (id) => [...el.querySelectorAll(`#${id} input:checked`)].map((c) => c.value);
  const getFiltered = () => {
    const q = (document.getElementById("contacts-search")?.value || "").trim().toLowerCase();
    const floorChecked = checked("contacts-floor-dd");
    const phoneChecked = checked("contacts-phone-dd");
    return allRows.filter((o) => {
      const doorEntries = [...new Set((o.building_records || []).map((r) => _shortDoorAddr(r.address)).filter(Boolean))];
      const floorText = [...new Set((o.building_records || []).map(_floorLabelOf).filter(Boolean))];
      const hay = `${o.name} ${o.phone_landline || ""} ${o.phone_mobile || ""} ${o.phone || ""} ${o.address || ""} ${doorEntries.join(" ")} ${floorText.join(" ")}`.toLowerCase();
      const okSearch = !q || hay.includes(q);
      const okFloor = !floorChecked.length || floorChecked.some((f) => floorText.includes(f));
      const okPhone = !phoneChecked.length || phoneChecked.includes(hasPhone(o) ? "has" : "none");
      return okSearch && okFloor && okPhone;
    });
  };

  const renderBody = () => {
    const filtered = getFiltered();
    const total = filtered.length;
    const pages = Math.max(1, Math.ceil(total / contactsUi.pageSize));
    if (contactsUi.page > pages) contactsUi.page = pages;
    const start = (contactsUi.page - 1) * contactsUi.pageSize;
    const slice = filtered.slice(start, start + contactsUi.pageSize);

    const tbody = document.getElementById("contacts-tbody");
    tbody.innerHTML = slice.length
      ? slice.map((o, i) => rowHtml(o, start + i + 1)).join("")
      : `<tr><td colspan="6"><div class="empty-state">沒有符合條件的地主</div></td></tr>`;

    const cnt = document.getElementById("contacts-count");
    if (cnt) cnt.textContent = total;

    const pageBtn = (label, n, opts = {}) =>
      `<button type="button" class="lv-pg${opts.active ? " active" : ""}${opts.arrow ? " lv-pg-arrow" : ""}" data-contacts-page="${n}"${opts.disabled ? " disabled" : ""}${opts.aria ? ` aria-label="${opts.aria}"` : ""}>${label}</button>`;
    const items = lttPageItems(contactsUi.page, pages)
      .map((n) => (n === "…" ? `<span class="lv-pg-gap">…</span>` : pageBtn(n, n, { active: n === contactsUi.page })))
      .join("");
    document.getElementById("contacts-foot").innerHTML = `
      <div class="lv-foot-info">${total ? `顯示 ${start + 1} - ${start + slice.length} 筆,共 ${total} 筆` : "共 0 筆"}</div>
      <div class="lv-pager">
        ${pageBtn(LTT_ICON.chevLeft, contactsUi.page - 1, { arrow: true, disabled: contactsUi.page <= 1, aria: "上一頁" })}
        ${items}
        ${pageBtn(LTT_ICON.chevRight, contactsUi.page + 1, { arrow: true, disabled: contactsUi.page >= pages, aria: "下一頁" })}
      </div>
      <div class="lv-foot-size"><span>每頁顯示</span>
        <select class="lv-select lv-select-sm" id="contacts-page-size">${[10, 20, 50, 100].map((n) => `<option value="${n}"${n === contactsUi.pageSize ? " selected" : ""}>${n}</option>`).join("")}</select>
      </div>`;
  };

  renderBody();

  document.getElementById("contacts-search")?.addEventListener("input", () => {
    contactsUi.page = 1;
    renderBody();
  });
  el.querySelectorAll("#contacts-floor-dd input, #contacts-phone-dd input").forEach((cb) =>
    cb.addEventListener("change", () => {
      updateFilterBadge(cb.closest(".integ-filter-panel").id);
      contactsUi.page = 1;
      renderBody();
    })
  );
  document.getElementById("contacts-clear-btn")?.addEventListener("click", () => {
    const searchInput = document.getElementById("contacts-search");
    if (searchInput) searchInput.value = "";
    el.querySelectorAll("#contacts-floor-dd input, #contacts-phone-dd input").forEach((cb) => (cb.checked = false));
    updateFilterBadge("contacts-floor-dd");
    updateFilterBadge("contacts-phone-dd");
    contactsUi.page = 1;
    renderBody();
  });

  wireFilterPillMutex(el);

  document.getElementById("contacts-foot").addEventListener("click", (e) => {
    const pg = e.target.closest("[data-contacts-page]");
    if (pg && !pg.disabled) {
      contactsUi.page = Number(pg.dataset.contactsPage);
      renderBody();
    }
  });
  document.getElementById("contacts-foot").addEventListener("change", (e) => {
    if (e.target.id === "contacts-page-size") {
      contactsUi.pageSize = Number(e.target.value);
      contactsUi.page = 1;
      renderBody();
    }
  });

  document.getElementById("contacts-export-btn")?.addEventListener("click", () => downloadRosterExcel(pid));
  document.getElementById("contacts-add-btn")?.addEventListener("click", () => openAddLandownerModal());
}
