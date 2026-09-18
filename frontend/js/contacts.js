"use strict";

// 「地主聯絡簿」—— 純聯絡資訊清單(姓名/建物門牌/電話/戶籍地址),方便外出拜訪前
// 快速核對名單、電話。詳細的拜訪/聯絡紀錄仍在「編輯地主」視窗裡管理,這裡不重複。

async function renderContactsTab(el) {
  const pid = state.currentProjectId;
  const owners = await api(`/projects/${pid}/landowners`);
  state.projectCache[pid].landowners = owners;

  // 只列「有地/有房」的實際地主 - 純粹掛在他項權利部下面的權利人(銀行等)不算
  // 需要外出聯絡的對象,同一套排除邏輯跟「整合清冊」一致。
  const rows = owners.filter((o) => (o.land_records || []).length || (o.building_records || []).length);

  if (!rows.length) {
    el.innerHTML = `<div class="empty-state">請先建立地主資料</div>`;
    return;
  }

  const hasPhone = (o) => !!(o.phone_landline || o.phone_mobile || o.phone);

  el.innerHTML = `
    <div class="section-toolbar" style="flex-wrap:wrap;gap:8px">
      <h3>地主聯絡簿 (<span id="contacts-count">${rows.length}</span>)</h3>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-right:auto">
        <input type="text" id="contacts-search" class="search-input-pill" style="max-width:240px" placeholder="搜尋姓名 / 門牌 / 電話 / 戶籍地址...">
        <details class="integ-filter" style="position:relative">
          <summary style="list-style:none;cursor:pointer;padding:6px 12px;border:1px solid var(--border);border-radius:8px;background:var(--surface);white-space:nowrap;font-size:13px">聯絡方式 ▾</summary>
          <div id="contacts-phone-dd" style="position:absolute;z-index:20;margin-top:4px;background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:8px 10px;box-shadow:0 4px 16px rgba(0,0,0,.12);min-width:140px">
            <label style="display:flex;align-items:center;gap:6px;padding:3px 0;font-size:13px;white-space:nowrap"><input type="checkbox" value="has" style="width:auto">有電話</label>
            <label style="display:flex;align-items:center;gap:6px;padding:3px 0;font-size:13px;white-space:nowrap"><input type="checkbox" value="none" style="width:auto">無電話</label>
          </div>
        </details>
      </div>
    </div>
    <style>
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
    </style>
    <div id="contacts-roster"><div class="table-wrap">
      <table>
        <thead><tr>
          <th class="col-idx">#</th><th>地主姓名</th><th>建物門牌</th><th>連絡電話</th><th>戶籍地址</th>
        </tr></thead>
        <tbody>
          ${rows
            .map((o, i) => {
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
              const hay = `${o.name} ${o.phone_landline || ""} ${o.phone_mobile || ""} ${o.phone || ""} ${o.address || ""} ${doorEntries.map(([a]) => a).join(" ")}`.toLowerCase();
              const phoneTok = hasPhone(o) ? "has" : "none";
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
              return `<tr data-hay="${escapeHtml(hay)}" data-phone-tok="${phoneTok}">
                <td class="col-idx">${String(i + 1).padStart(3, "0")}</td>
                <td class="col-name">${escapeHtml(o.name)}</td>
                <td>${doorHtml}</td>
                <td class="cell-phone">${phoneHtml}</td>
                <td class="cell-addr">${o.address ? escapeHtml(o.address) : `<span style="color:var(--text-muted)">未填寫</span>`}</td>
              </tr>`;
            })
            .join("")}
        </tbody>
      </table>
    </div></div>`;

  const applyContactsFilter = () => {
    const q = (document.getElementById("contacts-search")?.value || "").trim().toLowerCase();
    const phoneChecked = [...el.querySelectorAll("#contacts-phone-dd input:checked")].map((c) => c.value);
    let shown = 0;
    el.querySelectorAll("#contacts-roster tbody tr").forEach((tr) => {
      const okSearch = !q || (tr.dataset.hay || "").includes(q);
      const okPhone = !phoneChecked.length || phoneChecked.includes(tr.dataset.phoneTok);
      const show = okSearch && okPhone;
      tr.classList.toggle("hidden", !show);
      if (show) shown++;
    });
    const cnt = document.getElementById("contacts-count");
    if (cnt) cnt.textContent = shown;
  };
  document.getElementById("contacts-search")?.addEventListener("input", applyContactsFilter);
  el.querySelectorAll("#contacts-phone-dd input").forEach((cb) => cb.addEventListener("change", applyContactsFilter));

  // 一次只開一個篩選面板
  const contactsDetails = [...el.querySelectorAll("details.integ-filter")];
  contactsDetails.forEach((d) => {
    d.addEventListener("toggle", () => {
      if (d.open) contactsDetails.forEach((o) => { if (o !== d) o.open = false; });
    });
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".integ-filter")) contactsDetails.forEach((d) => (d.open = false));
  });
}
