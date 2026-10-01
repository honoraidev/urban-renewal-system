"use strict";

// 建物登記分頁把「地主」顯示成「屋主」比較符合語感 - 地主/屋主背後是同一張 landowners
// 資料表,只是名稱用哪個字依目前分頁而定,所以用一個模組層級變數記住目前該用哪個字,而不是
// 把 isLand 一路傳進每個共用的 modal 函式。
let currentLandownerLabel = "地主";
// 從案件總覽「本週拜訪」點進來時,地主資料視窗的「拜訪紀錄」自動展開(只展開一次)。
let _loExpandContactsOnce = false;
// 從案件總覽「本週拜訪」點進來的地主資料視窗是純檢視:不能編輯、不能新增拜訪紀錄、不能上傳 /
// 刪文件,也不顯示基本資料與拜訪/簽約狀態,只看姓名門牌、拜訪紀錄、相關文件。
let _loModalReadOnly = false;

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

// 若當前分頁是樓棟視圖,背景非同步重新畫(不中斷編輯視窗);其他分頁無需重畫
// (整合清冊等分頁不含聯絡狀態色,更新側欄案件清單就夠了)。
async function _refreshBackgroundIfBuilding() {
  if (state.activeTab === "buildingview" && typeof renderBuildingViewTab === "function") {
    const el = document.getElementById("tab-content");
    if (el) {
      try { await renderBuildingViewTab(el); } catch (e) {}
    }
  }
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

// 整合清冊「樓層」欄 - 建物登記的 floor 欄位有值就用它,沒值(舊資料/OCR 沒抓到)就從
// 門牌地址字串裡撈「N樓」「地下N層」;同一位地主名下多戶就去重後用「、」串起來。
function _floorLabelOf(r) {
  const f = (r.floor || "").toString().trim();
  if (f) return f;
  const a = String(r.address || "").replace(/[０-９]/g, (d) => "０１２３４５６７８９".indexOf(d));
  const m = a.match(/地下[一二三四五六七八九十\d]+層|\d+\s*樓/);
  return m ? m[0].replace(/\s+/g, "") : "";
}

// 樓層排序用:地下N層 → 負數,N樓/N層 → 正數(支援阿拉伯數字與中文數字,「地下層」視為地下一層)。
function _floorSortKey(label) {
  const cn = { 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const m = String(label).match(/(\d+|[零一二三四五六七八九十]+)/);
  let n = 1;
  if (m) {
    const t = m[1];
    if (/^\d+$/.test(t)) n = Number(t);
    else if (t.includes("十")) {
      const [a, b] = t.split("十");
      n = (a ? cn[a] : 1) * 10 + (b ? cn[b] : 0);
    } else n = cn[t] ?? 1;
  }
  return /地下/.test(label) ? -n : n;
}

// 「樓層」欄的儲存格內容:一位地主名下多戶/多層去重、依樓層由低到高排序。連續 3 層以上
// (例如地下層、一~五層)合併成一顆「起~迄」徽章(滑過看得到完整清單),不是每層各自一顆
// 徽章,不然像整棟都有持分的地主樓層一多,欄位會被撐成好幾行、拉高整列。斷層(中間缺樓層)
// 不會被誤合併,只有真的連號才合併。
function _floorsCellHtml(buildingRecords) {
  const labels = [...new Set((buildingRecords || []).map(_floorLabelOf).filter(Boolean))].sort(
    (a, b) => _floorSortKey(a) - _floorSortKey(b)
  );
  if (!labels.length) return `<span style="color:var(--text-muted)">-</span>`;

  // 樓層編號沒有「0」(地下一層 -1 直接接一樓 +1),判斷連號時要跳過 0,不然地下層永遠
  // 併不進緊接在上面的一樓。
  const nextKey = (k) => (k === -1 ? 1 : k + 1);
  const groups = [];
  labels.forEach((l) => {
    const key = _floorSortKey(l);
    const last = groups[groups.length - 1];
    if (last && key === nextKey(last.lastKey)) {
      last.labels.push(l);
      last.lastKey = key;
    } else {
      groups.push({ labels: [l], lastKey: key });
    }
  });

  const badges = groups.map((g) => {
    const full = g.labels.join("、");
    const text = g.labels.length >= 3 ? `${g.labels[0]}~${g.labels[g.labels.length - 1]}` : full;
    return `<span class="mini-badge" title="${escapeHtml(full)}">${escapeHtml(text)}</span>`;
  });
  return `<div class="floor-badges">${badges.join("")}</div>`;
}

// 「整合清冊」分頁的檢視切換,現在是分頁列上「整合清冊」那顆分頁按鈕本身的下拉
// (見 index.html #tab-integrated-view-select + dashboard.js 的 change 監聽),這裡
// 只依目前模式決定標題文字和要渲染哪個子畫面。
function integratedViewLabel(mode) {
  return mode === "land" ? "土地登記清冊" : mode === "building" ? "建物登記清冊" : "整合清冊";
}

async function renderIntegratedRosterTab(el) {
  const mode = state.integratedViewMode || "combined";
  const titleText = integratedViewLabel(mode);
  if (mode === "land" || mode === "building") {
    await renderLandownersTypeTab(el, mode, titleText);
  } else {
    await renderIntegratedCombinedView(el, titleText);
  }
}

// 分頁狀態跨次渲染保留(不放在 renderIntegratedCombinedView 內部的區域變數) - 不然
// 每次切分頁籤或重整這個分頁都會被重設回第 1 頁,使用者翻到一半的頁碼就白翻了。
let integUi = { page: 1, pageSize: 10 };

// 整合清冊標題圖示:跟樓棟視圖同一套雙色扁平配色(深藍 / 灰藍 / 淺藍),但畫成不同圖案 ——
// 一張橫式「表格」(表頭 + 三列格子),右下角疊一個「人」的圓形徽章,代表一人一列的名冊。
const INTEG_ROSTER_ICON = `<svg viewBox="0 0 48 48" width="52" height="52" aria-hidden="true"><rect x="3" y="7" width="35" height="32" rx="3.5" fill="#1f3a8a"/><rect x="3" y="7" width="35" height="9" rx="3.5" fill="#5b7aa8"/><rect x="3" y="12" width="35" height="4" fill="#5b7aa8"/><g fill="#ffffff" opacity=".9"><rect x="7" y="20" width="8" height="4.5" rx="1"/><rect x="17" y="20" width="8" height="4.5" rx="1"/><rect x="27" y="20" width="7" height="4.5" rx="1"/><rect x="7" y="27" width="8" height="4.5" rx="1"/><rect x="17" y="27" width="8" height="4.5" rx="1"/><rect x="27" y="27" width="7" height="4.5" rx="1"/></g><circle cx="36" cy="35" r="10.5" fill="#dbe7f7" stroke="#ffffff" stroke-width="2"/><circle cx="36" cy="32" r="3.2" fill="#1f3a8a"/><path d="M29.8 42.2a6.2 6.2 0 0 1 12.4 0z" fill="#1f3a8a"/></svg>`;

async function renderIntegratedCombinedView(el, titleText = "整合清冊") {
  const pid = state.currentProjectId;
  const [owners, alerts, contactSummary] = await Promise.all([
    api(`/projects/${pid}/landowners`),
    api(`/projects/${pid}/alerts`, { silent: true }).catch(() => []),
    api(`/projects/${pid}/contact-summary`, { silent: true }).catch(() => []),
  ]);
  const contactBy = new Map(contactSummary.map((c) => [c.landowner_id, c]));
  const allRows = owners.filter((o) => (o.land_records || []).length || (o.building_records || []).length);

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

  // 「持分類型」:只有土地 / 只有建物 / 土地+建物都有
  const shareTypeTokens = (o) => {
    const hasLand = (o.land_records || []).length > 0;
    const hasBld = (o.building_records || []).length > 0;
    if (hasLand && hasBld) return ["both"];
    if (hasLand) return ["land_only"];
    if (hasBld) return ["building_only"];
    return [];
  };

  // 「地號段別」:一筆土地的段+小段(如「中正段一小段」);一位地主可能橫跨多筆,
  // 篩選時只要其中一筆符合勾選的段別就算命中。
  const sectionOf = (r) => `${r.section || ""}${r.subsection || ""}`;
  const sectionTokens = (o) => [...new Set((o.land_records || []).map(sectionOf).filter(Boolean))];

  // 「樓層範圍」:一位地主名下建物涵蓋到的樓層(沿用「樓層」欄同一套 _floorLabelOf)。
  const floorTokens = (o) => [...new Set((o.building_records || []).map(_floorLabelOf).filter(Boolean))];

  // 篩選下拉的選項清單依目前這份清冊實際出現過的段別/樓層動態產生,而不是寫死 -
  // 不同案件、甚至同案件不同時間點涵蓋的地號段別、樓層範圍都不一樣。
  const sectionOptionSet = new Set();
  const floorOptionSet = new Set();
  allRows.forEach((o) => {
    sectionTokens(o).forEach((s) => sectionOptionSet.add(s));
    floorTokens(o).forEach((f) => floorOptionSet.add(f));
  });
  const sectionOptions = [...sectionOptionSet].sort((a, b) => a.localeCompare(b, "zh-Hant"));
  const floorOptions = [...floorOptionSet].sort((a, b) => _floorSortKey(b) - _floorSortKey(a));

  const ddHtml = (id, label, opts) => `
    <details class="integ-filter">
      <summary>${label}<span class="integ-filter-badge" id="${id}-badge"></span></summary>
      <div id="${id}" class="integ-filter-panel">
        ${opts.map((o) => `<label><input type="checkbox" value="${o.v}">${o.t}</label>`).join("")}
      </div>
    </details>`;

  // 統計卡片(從「地主聯絡簿」搬過來,同一份 allRows,口徑保持一致):地主總數、
  // 已/未聯絡人數+佔比、建物門牌數(去重後的簡化門牌)、涵蓋樓層範圍。
  const isContacted = (o) => !!o.contact_status && o.contact_status !== "not_contacted";
  // 跟後端 utils/building_view.py 的 is_shared_building_record() 同一套判斷 - 共有
  // 部分/公設建號(OCR 常把每位區分所有權人名下都掛一筆,無真實門牌)不是真的一戶。
  // 已/未聯絡統計要濾掉「名下建物全部都只是這種公設」的地主,不然人數會比樓棟
  // 視圖多算(那些人樓棟視圖根本畫不出一格);只有土地、沒有建物的地主不受影響,
  // 他們是真實可聯絡的人,只是樓棟視圖沒有畫他們而已,還是照算。
  const _isSharedBuildingRecord = (r) => {
    if ((r.main_use || "").trim() === "共有部分") return true;
    if (Array.isArray(r.common_part_shares) && r.common_part_shares.length) return true;
    return (r.address || "").includes("共同使用");
  };
  const countsForContactStats = (o) => {
    const brs = o.building_records || [];
    return brs.length === 0 || brs.some((r) => !_isSharedBuildingRecord(r));
  };
  const contactableRows = allRows.filter(countsForContactStats);
  const doorSet = new Set();
  const floorKeys = [];
  allRows.forEach((o) => {
    (o.building_records || []).forEach((r) => {
      const label = _shortDoorAddr(r.address);
      if (label) doorSet.add(label);
      const floorLabel = _floorLabelOf(r);
      if (floorLabel) floorKeys.push(_floorSortKey(floorLabel));
    });
  });
  const contactedCount = contactableRows.filter(isContacted).length;
  const notContactedCount = contactableRows.length - contactedCount;
  const contactedPct = contactableRows.length ? Math.round((contactedCount / contactableRows.length) * 1000) / 10 : 0;
  const notContactedPct = contactableRows.length ? Math.round((notContactedCount / contactableRows.length) * 1000) / 10 : 0;
  const floorRangeText = floorKeys.length
    ? (() => {
        const min = Math.min(...floorKeys);
        const max = Math.max(...floorKeys);
        const fmt = (k) => (k < 0 ? `地下${Math.abs(k)}` : String(k));
        return min === max ? `${fmt(min)}層` : `${fmt(min)} ~ ${fmt(max)}層`;
      })()
    : "-";
  const statTile = (icon, tone, label, valueHtml, subHtml) => `
    <div class="enc-stat-tile enc-stat-${tone}">
      <div class="enc-stat-icon">${icon}</div>
      <div style="flex:1;min-width:0"><div class="enc-stat-lbl">${label}</div><div class="enc-stat-val">${valueHtml}</div>${subHtml || ""}</div>
    </div>`;

  el.innerHTML = `
    <div class="section-toolbar" style="flex-wrap:wrap;gap:8px">
      <h3 class="section-hero-title"><span class="hero-ic" style="display:inline-flex;align-items:center;background:none">${INTEG_ROSTER_ICON}</span><span>${titleText} (<span id="integ-count">${allRows.length}</span>)</span></h3>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-right:auto">
        <div class="hero-search">${BV_ICON.search}<input type="text" id="integrated-search" placeholder="搜尋姓名 / 地號 / 門牌..."></div>
        ${ddHtml("integ-visit-dd", "聯絡結果", [
          { v: "linked", t: "已連繫" }, { v: "pending", t: "待聯繫" },
        ])}
        ${ddHtml("integ-share-dd", "持分類型", [
          { v: "land_only", t: "只有土地" }, { v: "building_only", t: "只有建物" }, { v: "both", t: "土地+建物" },
        ])}
        ${sectionOptions.length ? ddHtml("integ-section-dd", "地號段別", sectionOptions.map((s) => ({ v: s, t: s }))) : ""}
        ${floorOptions.length ? ddHtml("integ-floor-dd", "樓層範圍", floorOptions.map((f) => ({ v: f, t: f }))) : ""}
      </div>
    </div>
    <div class="enc-stat-row">
      ${statTile("👥", "land", "地主總數", `${allRows.length} <small>位</small>`)}
      ${statTile(
        "📞",
        "building",
        "已聯絡",
        `${contactedCount} <small>位</small><span class="contacts-stat-pct">${contactedPct}%</span>`,
        `<div class="progress-bar-track" style="margin-top:6px"><div class="progress-bar-fill" style="width:${contactedPct}%"></div></div>`
      )}
      ${statTile(
        "🕐",
        "type",
        "未聯絡",
        `${notContactedCount} <small>位</small><span class="contacts-stat-pct">${notContactedPct}%</span>`,
        `<div class="progress-bar-track" style="margin-top:6px"><div class="progress-bar-fill" style="width:${notContactedPct}%;background:var(--border)"></div></div>`
      )}
      ${statTile("🏠", "amount", "建物門牌數", `${doorSet.size} <small>筆</small>`)}
      ${statTile("🏢", "type", "涵蓋樓層", `<span style="font-size:17px">${floorRangeText}</span>`)}
    </div>
    <style>
      #integ-roster { margin-top:16px; }
      #integ-roster .table-wrap { border:1px solid var(--border); border-radius:12px; overflow:auto; box-shadow:0 1px 3px rgba(0,0,0,.04); }
      /* table-layout:fixed 只套外層主表格(靠 > 限定直接子代 table)- 展開列裡巢狀的
         土地/建物卡片表格欄位數、內容長度都不一樣,套同一組固定寬度只會把它們擠壞。 */
      #integ-roster > .table-wrap > table {
        border-collapse:separate; border-spacing:0; width:100%; font-size:13px; table-layout:fixed;
      }
      #integ-roster thead th {
        position:sticky; top:0; z-index:2; background:var(--surface-2);
        padding:12px 14px; text-align:left; font-weight:700; color:var(--text-muted);
        white-space:nowrap; border-bottom:1px solid var(--border);
      }
      #integ-roster tbody td { padding:11px 14px; border-bottom:1px solid var(--border); vertical-align:middle; }
      #integ-roster tbody tr:last-child td { border-bottom:none; }
      #integ-roster tbody tr:nth-child(even) { background:color-mix(in srgb, var(--surface-2) 45%, transparent); }
      #integ-roster tbody tr:hover { background:color-mix(in srgb, var(--brand) 8%, transparent); }
      /* 表格預設會把多的水平空間平均塞給內容最短的欄位(例如地號、樓層),看起來
         像留白留很大一塊;給每欄一個合理寬度,讓姓名/建物門牌這種內容較長的欄位
         吃到大部分空間,數字欄跟樓層欄維持剛好夠用的寬度就好。 */
      #integ-roster .col-idx { color:var(--text-muted); font-variant-numeric:tabular-nums; width:60px; }
      #integ-roster th:nth-child(2), #integ-roster td:nth-child(2) { width:14%; }
      #integ-roster .col-floor { width:8%; }
      #integ-roster .col-nowrap { width:16%; }
      #integ-roster .col-name { width:calc(6em + 50px); min-width:calc(6em + 50px); max-width:calc(6em + 50px); font-weight:600; }
      #integ-roster .num { width:9%; text-align:right; font-variant-numeric:tabular-nums; }
      #integ-roster th.num { text-align:right; }
      #integ-roster .row-actions { width:90px; text-align:right; white-space:nowrap; }
      #integ-roster td { word-break:break-word; }
      #integ-roster .cell-sub {
        white-space:normal; font-weight:400; font-size:11.5px; color:var(--text-muted);
        line-height:1.35; margin-top:2px; word-break:break-word;
      }
      #integ-roster .col-idx { cursor:pointer; }
      #integ-roster tr.expanded { border-left:3px solid var(--brand); background:color-mix(in srgb, var(--brand) 6%, transparent); }
      #integ-roster tr.expanded td:first-child { padding-left:9px; }
      #integ-roster .integ-toggle-btn {
        display:inline-flex; align-items:center; gap:5px; min-width:64px; justify-content:center;
        border-color:color-mix(in srgb, var(--brand) 45%, var(--border)); color:var(--brand); font-weight:600;
      }
      #integ-roster .integ-toggle-btn:hover { background:color-mix(in srgb, var(--brand) 10%, transparent); }
      #integ-roster .integ-toggle-btn.expanded { background:var(--brand); color:#fff; border-color:var(--brand); }
      /* 展開列裡的卡片表格也巢狀在 #integ-roster 底下,上面 thead th 的 sticky
         選到它就會跟外層表頭疊在一起亂飄,展開列裡的表頭固定關掉。 */
      #integ-roster .integ-detail-card thead th {
        position:static; padding:9px 12px; font-size:12.5px; color:var(--text-muted);
        font-weight:600; background:color-mix(in srgb, var(--surface-2) 60%, transparent);
      }
      #integ-roster .integ-detail-card tbody td { padding:10px 12px; font-size:14px; border-bottom:1px solid var(--border); }
      #integ-roster .integ-detail-card tbody tr:last-child td { border-bottom:none; }
      #integ-roster .integ-detail-card tbody tr:nth-child(even) { background:color-mix(in srgb, var(--surface-2) 35%, transparent); }
      #integ-roster .integ-detail-card table { font-size:14px; width:100%; border-collapse:collapse; }
      #integ-roster .integ-detail-wrap { display:flex; gap:16px; padding:18px 20px; align-items:flex-start; }
      #integ-roster .integ-detail-main { flex:1; min-width:0; display:flex; flex-direction:column; gap:16px; }
      #integ-roster .integ-detail-card {
        border:1px solid var(--border); border-radius:12px; overflow:hidden;
        background:var(--surface); box-shadow:0 1px 3px rgba(0,0,0,.04);
      }
      #integ-roster .integ-detail-card-head {
        display:flex; align-items:center; justify-content:space-between;
        padding:11px 16px; background:var(--surface-2); border-bottom:1px solid var(--border);
      }
      #integ-roster .integ-detail-card-title { font-weight:700; font-size:13.5px; display:flex; align-items:center; gap:8px; }
      #integ-roster .integ-detail-card-title .count { font-weight:400; color:var(--text-muted); font-size:11.5px; }
      /* 卡片標題圖示統一用色塊底 + emoji,土地/建物/其他資訊各自一個色調,
         比裸 emoji 直接接文字看起來更像一個設計系統,而不是隨手放的表情符號。 */
      #integ-roster .integ-card-icon {
        display:inline-flex; align-items:center; justify-content:center; flex-shrink:0;
        width:24px; height:24px; border-radius:7px; font-size:12.5px;
      }
      #integ-roster .integ-card-icon-land { background:color-mix(in srgb, #16a34a 16%, transparent); }
      #integ-roster .integ-card-icon-building { background:color-mix(in srgb, #2563eb 14%, transparent); }
      #integ-roster .integ-card-icon-info { background:color-mix(in srgb, #7c3aed 14%, transparent); }
      #integ-roster .integ-side-card { flex:0 0 290px; display:flex; flex-direction:column; }
      #integ-roster .integ-side-body { padding:16px; display:flex; flex-direction:column; gap:14px; }
      #integ-roster .integ-side-row { display:flex; flex-direction:column; gap:4px; }
      #integ-roster .integ-side-label {
        font-size:11.5px; color:var(--text-muted); font-weight:600;
        display:flex; align-items:center; gap:6px;
      }
      #integ-roster .integ-side-label .integ-card-icon { width:18px; height:18px; font-size:10px; border-radius:5px; }
      #integ-roster .integ-side-val { font-size:13px; word-break:break-word; padding-left:24px; }
      #integ-roster .integ-side-note-date { display:block; font-size:11px; color:var(--text-muted); margin-top:2px; }
      #integ-roster .integ-icon-btn {
        display:inline-flex; align-items:center; justify-content:center;
        border:1px solid transparent; border-radius:6px;
        width:27px; height:27px; cursor:pointer; font-size:12px; line-height:1; margin-right:4px;
        background:color-mix(in srgb, #2563eb 12%, transparent); transition:background .12s, border-color .12s;
      }
      #integ-roster .integ-icon-btn:hover { background:color-mix(in srgb, #2563eb 22%, transparent); }
      #integ-roster .integ-icon-btn-danger { background:color-mix(in srgb, var(--danger) 12%, transparent); }
      #integ-roster .integ-icon-btn-danger:hover { background:color-mix(in srgb, var(--danger) 22%, transparent); }
      @media (max-width: 900px) {
        #integ-roster .integ-detail-wrap { flex-direction:column; }
        #integ-roster .integ-side-card { flex:1 1 auto; }
      }
    </style>
    <div id="integ-roster"><div class="table-wrap">
      <table>
        <thead><tr>
          <th class="col-idx">#</th><th>建物門牌</th><th class="col-floor">樓層</th><th>地號<br>(地段)</th><th class="col-name">姓名</th>
          <th class="num">土地㎡</th><th class="num">土地(坪)</th><th class="num">建物㎡</th><th class="num">建物(坪)</th>
          <th class="row-actions">操作</th>
        </tr></thead>
        <tbody id="integ-tbody"></tbody>
      </table>
    </div></div>
    <div class="lv-foot" id="integ-foot"></div>`;

  // 一列的 HTML(摘要列 + 展開列)。seq 是這筆在「篩選後全部結果」裡的序號(不是頁內
  // 序號),換頁後編號才會接續 011、012...,不會每頁都從 001 重新算。
  const rowHtml = (o, seq) => {
    const lr = o.land_records || [];
    const br = o.building_records || [];
    const landSqm = lr.reduce((s, r) => s + (Number(r.owned_area_sqm) ||
      (Number(r.total_area_sqm || 0) * (r.ownership_numerator || 1)) / (r.ownership_denominator || 1)), 0);
    const bldSqm = br.reduce((s, r) => s + (Number(r.total_area_sqm || 0) * (r.ownership_numerator || 1)) / (r.ownership_denominator || 1), 0);
    const hay = `${o.name} ${o.id_number || ""} ${lr.map((r) => r.parcel_number).join(" ")} ${br.map((r) => r.address).join(" ")} ${br.map(_floorLabelOf).join(" ")}`.toLowerCase();
    const visitTok = contactTokens(o).join(" ");
    const sectionInfo = uniqJoin(lr.map((r) => `${r.section || ""}${r.subsection || ""}`));
    const landShare = uniqJoin(lr.map((r) => `${r.ownership_numerator}/${r.ownership_denominator}`));
    const bldShare = uniqJoin(br.map((r) => `${r.ownership_numerator}/${r.ownership_denominator}`));
    const sub = (s) => (s ? `<div class="cell-sub">${escapeHtml(s)}</div>` : "");
    return `<tr data-hay="${escapeHtml(hay)}" data-visit-tok="${visitTok}" data-owner-id="${o.id}">
            <td class="col-idx" data-toggle="${o.id}" style="cursor:pointer;user-select:none">${String(seq).padStart(3, "0")}</td>
            <td>${(() => {
      const addrMap = new Map();
      br.forEach((r) => {
        const label = _shortDoorAddr(r.address);
        if (!label) return;
        const shared = /房屋地下/.test(r.address || "");
        if (!addrMap.has(label)) addrMap.set(label, shared);
      });
      const addrs = [...addrMap.entries()];
      return addrs.length
        ? `<div style="display:flex;flex-wrap:wrap;gap:4px">${addrs
          .map(([a, shared]) =>
            shared
              ? `<span class="mini-badge mini-badge-shared-door" title="依持分比例登記的地下室/車位建號,非專屬住家門牌">${escapeHtml(a)}(地下持分)</span>`
              : `<span class="mini-badge">${escapeHtml(a)}</span>`
          )
          .join("")}</div>`
        : `<span style="color:var(--text-muted)">-</span>`;
    })()}</td>
            <td class="col-floor">${_floorsCellHtml(br)}</td>
            <td class="col-nowrap">${escapeHtml(uniqJoin(lr.map((r) => r.parcel_number))) || "-"}${sub(sectionInfo)}</td>
            <td class="col-name">${escapeHtml(o.name)}</td>
            <td class="num">${fmt2(landSqm)}</td>
            <td class="num">${fmt2(landSqm * 0.3025)}${sub(landShare)}</td>
            <td class="num">${fmt2(bldSqm)}</td>
            <td class="num">${fmt2(bldSqm * 0.3025)}${sub(bldShare)}</td>
            <td class="row-actions">
              <button type="button" class="btn-secondary btn-sm integ-toggle-btn" data-toggle="${o.id}">展開</button>
            </td>
          </tr>
          ${ownerDetailRowHtml(o, 10, contactBy.get(o.id))}`;
  };

  const checked = (id) => [...el.querySelectorAll(`#${id} input:checked`)].map((c) => c.value);
  const getFiltered = () => {
    const q = (document.getElementById("integrated-search")?.value || "").trim().toLowerCase();
    const vt = checked("integ-visit-dd");
    const st = checked("integ-share-dd");
    const sec = checked("integ-section-dd");
    const fl = checked("integ-floor-dd");
    return allRows.filter((o) => {
      if (!q && !vt.length && !st.length && !sec.length && !fl.length) return true;
      const lr = o.land_records || [];
      const br = o.building_records || [];
      const hay = `${o.name} ${o.id_number || ""} ${lr.map((r) => r.parcel_number).join(" ")} ${br.map((r) => r.address).join(" ")} ${br.map(_floorLabelOf).join(" ")}`.toLowerCase();
      const okSearch = !q || hay.includes(q);
      const rowVt = contactTokens(o);
      const okVt = !vt.length || vt.some((x) => rowVt.includes(x));
      const rowSt = shareTypeTokens(o);
      const okSt = !st.length || st.some((x) => rowSt.includes(x));
      const rowSec = sectionTokens(o);
      const okSec = !sec.length || sec.some((x) => rowSec.includes(x));
      const rowFl = floorTokens(o);
      const okFl = !fl.length || fl.some((x) => rowFl.includes(x));
      return okSearch && okVt && okSt && okSec && okFl;
    });
  };

  // 每次分頁/搜尋/篩選變動都整批重畫 tbody(不是像以前那樣渲染全部 53 筆再靠 CSS
  // hidden 切換)- 這樣每頁 DOM 節點數固定,不會因為案件地主一多就整頁卡頓,而且
  // 「顯示 X-Y 筆,共 Z 筆」這種分頁資訊本來就得知道篩選後的總數才能算,靠隱藏
  // 沒辦法簡單支援換頁。
  const renderBody = () => {
    const filtered = getFiltered();
    const total = filtered.length;
    const pages = Math.max(1, Math.ceil(total / integUi.pageSize));
    if (integUi.page > pages) integUi.page = pages;
    const start = (integUi.page - 1) * integUi.pageSize;
    const slice = filtered.slice(start, start + integUi.pageSize);

    const tbody = el.querySelector("#integ-tbody");
    tbody.innerHTML = slice.length
      ? slice.map((o, i) => rowHtml(o, start + i + 1)).join("")
      : `<tr><td colspan="10"><div class="empty-state">沒有符合條件的地主</div></td></tr>`;

    const cnt = document.getElementById("integ-count");
    if (cnt) cnt.textContent = total;

    const pageBtn = (label, n, opts = {}) =>
      `<button type="button" class="lv-pg${opts.active ? " active" : ""}${opts.arrow ? " lv-pg-arrow" : ""}" data-integ-page="${n}"${opts.disabled ? " disabled" : ""}${opts.aria ? ` aria-label="${opts.aria}"` : ""}>${label}</button>`;
    const items = lttPageItems(integUi.page, pages)
      .map((n) => (n === "…" ? `<span class="lv-pg-gap">…</span>` : pageBtn(n, n, { active: n === integUi.page })))
      .join("");
    el.querySelector("#integ-foot").innerHTML = `
      <div class="lv-foot-info">${total ? `顯示 ${start + 1} - ${start + slice.length} 筆,共 ${total} 筆` : "共 0 筆"}</div>
      <div class="lv-pager">
        ${pageBtn(LTT_ICON.chevLeft, integUi.page - 1, { arrow: true, disabled: integUi.page <= 1, aria: "上一頁" })}
        ${items}
        ${pageBtn(LTT_ICON.chevRight, integUi.page + 1, { arrow: true, disabled: integUi.page >= pages, aria: "下一頁" })}
      </div>
      <div class="lv-foot-size"><span>每頁顯示</span>
        <select class="lv-select lv-select-sm" id="integ-page-size">${[10, 20, 50, 100].map((n) => `<option value="${n}"${n === integUi.pageSize ? " selected" : ""}>${n}</option>`).join("")}</select>
      </div>`;

    wireOwnerDetailRows(el, owners);
    // 展開/收合:欄位裡的編號(col-idx)跟操作欄的「展開」按鈕都可以觸發,兩處共用
    // 同一個 data-toggle="ownerId",同一列的兩顆一起切換箭頭方向跟按鈕文字。
    tbody.querySelectorAll("[data-toggle]").forEach((toggle) => {
      toggle.addEventListener("click", (e) => {
        e.stopPropagation();
        const ownerId = toggle.dataset.toggle;
        const detailRow = document.getElementById(`detail-row-${ownerId}`);
        if (!detailRow) return;
        const nowExpanded = detailRow.classList.toggle("hidden") === false;
        const summaryRow = detailRow.previousElementSibling;
        summaryRow?.classList.toggle("expanded", nowExpanded);
        tbody.querySelectorAll(`[data-toggle="${ownerId}"]`).forEach((t) => {
          t.classList.toggle("expanded", nowExpanded);
          if (t.classList.contains("integ-toggle-btn")) {
            t.textContent = nowExpanded ? "收合" : "展開";
          }
        });
      });
    });
  };

  renderBody();

  document.getElementById("integrated-search")?.addEventListener("input", () => {
    integUi.page = 1;
    renderBody();
  });
  el.querySelectorAll(".integ-filter input").forEach((cb) =>
    cb.addEventListener("change", () => {
      updateFilterBadge(cb.closest(".integ-filter-panel").id);
      integUi.page = 1;
      renderBody();
    })
  );
  wireFilterPillMutex(el);

  el.querySelector("#integ-foot").addEventListener("click", (e) => {
    const pg = e.target.closest("[data-integ-page]");
    if (pg && !pg.disabled) {
      integUi.page = Number(pg.dataset.integPage);
      renderBody();
    }
  });
  el.querySelector("#integ-foot").addEventListener("change", (e) => {
    if (e.target.id === "integ-page-size") {
      integUi.pageSize = Number(e.target.value);
      integUi.page = 1;
      renderBody();
    }
  });
}

// 「產生地主清冊 Excel」的下載動作 - 整合清冊工具列的按鈕、SOP 第1關「確認地主清冊
// 正確」確認完之後自動觸發,共用同一份。
async function downloadRosterExcel(pid) {
  try {
    const res = await api(`/projects/${pid}/roster.xlsx`);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const proj = state.currentProject || {};
    a.download = `${proj.name || proj.project_code || "roster"}-清冊.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    toast("地主清冊已下載", "success");
  } catch (err) { }
}

// 一位地主的「查看明細」展開列:左邊土地/建物卡片(逐筆列表 + 各自的新增/編輯/刪除),
// 右邊「其他資訊」卡片(基本資料摘要 + 查看詳細內容/聯絡紀錄捷徑)。
// 「整合清冊」跟「土地登記清冊/建物登記清冊」共用同一份,操作欄行為一致。
function ownerDetailRowHtml(o, colspan, contact) {
  const iconBtn = (action, id, ownerId, title, danger) =>
    `<button type="button" class="integ-icon-btn ${danger ? "integ-icon-btn-danger" : ""}" data-${action}="${id}" data-owner="${ownerId}" title="${title}">${danger ? "🗑" : "✏️"}</button>`;
  const cardIcon = (emoji, tone) => `<span class="integ-card-icon integ-card-icon-${tone}">${emoji}</span>`;

  const landCard = `
    <div class="integ-detail-card">
      <div class="integ-detail-card-head">
        <span class="integ-detail-card-title">${cardIcon("🌱", "land")} 土地資料 <span class="count">(${o.land_records.length}筆)</span></span>
        ${isEditor() ? `<button class="btn-secondary btn-sm" data-add-land="${o.id}">+ 新增土地</button>` : ""}
      </div>
      ${o.land_records.length
      ? `<table class="integ-land-table">
              <thead><tr><th>#</th><th>地號</th><th>地段</th><th>面積(m²)</th><th>持分</th><th>持有面積(m²)</th><th>持有面積(%)</th>${isEditor() ? "<th>操作</th>" : ""}</tr></thead>
              <tbody>
                ${o.land_records
        .map(
          (lr, idx) => `<tr>
                    <td>${idx + 1}</td>
                    <td>${escapeHtml(lr.parcel_number)}</td>
                    <td>${escapeHtml(lr.section) || "-"}</td>
                    <td>${fmtArea(lr.total_area_sqm)}</td>
                    <td>${lr.ownership_numerator}/${lr.ownership_denominator}</td>
                    <td>${fmtArea(lr.owned_area_sqm)}</td>
                    <td>${lr.ownership_share_pct == null ? "-" : `${fmtPct(lr.ownership_share_pct)}%`}</td>
                    ${isEditor()
              ? `<td class="actions-cell">
                          ${iconBtn("edit-land", lr.id, o.id, "編輯")}
                          ${iconBtn("delete-land", lr.id, o.id, "刪除", true)}
                        </td>`
              : ""
            }
                  </tr>`
        )
        .join("")}
              </tbody>
            </table>`
      : `<div class="helper-text" style="padding:12px 14px">尚無土地資料</div>`
    }
    </div>`;

  const buildingCard = `
    <div class="integ-detail-card">
      <div class="integ-detail-card-head">
        <span class="integ-detail-card-title">${cardIcon("🏠", "building")} 建物資料 <span class="count">(${o.building_records.length}筆)</span></span>
        ${isEditor() ? `<button class="btn-secondary btn-sm" data-add-building="${o.id}">+ 新增建物</button>` : ""}
      </div>
      ${o.building_records.length
      ? `<table class="integ-building-table">
              <thead><tr><th>#</th><th>建號</th><th>座落地號</th><th>樓層</th><th>面積(m²)</th><th>持分</th><th>持有面積(m²)</th><th>持有面積(%)</th>${isEditor() ? "<th>操作</th>" : ""}</tr></thead>
              <tbody>
                ${o.building_records
        .map(
          (br, idx) => `<tr>
                    <td>${idx + 1}</td>
                    <td>${escapeHtml(br.building_number) || "-"}</td>
                    <td>${escapeHtml((o.land_records.find((lr) => lr.id === br.land_record_id) || {}).parcel_number || br.parcel_number) || "-"}</td>
                    <td>${escapeHtml(br.floor) || "-"}</td>
                    <td>${fmtArea(br.total_area_sqm)}</td>
                    <td>${br.ownership_numerator}/${br.ownership_denominator}</td>
                    <td>${fmtArea((Number(br.total_area_sqm) || 0) * (br.ownership_numerator || 1) / (br.ownership_denominator || 1))}</td>
                    <td>${br.ownership_share_pct == null ? "-" : `${fmtPct(br.ownership_share_pct)}%`}</td>
                    ${isEditor()
              ? `<td class="actions-cell">
                          ${iconBtn("edit-building", br.id, o.id, "編輯")}
                          ${iconBtn("delete-building", br.id, o.id, "刪除", true)}
                        </td>`
              : ""
            }
                  </tr>`
        )
        .join("")}
              </tbody>
            </table>`
      : `<div class="helper-text" style="padding:12px 14px">尚無建物資料</div>`
    }
    </div>`;

  const phone = o.phone_mobile || o.phone_landline || "";
  const noteHtml = contact && contact.last_contact_result
    ? `<span class="mini-badge ${CONTACT_RESULT_BADGE_CLASS[contact.last_contact_result] || ""}">${CONTACT_RESULT_LABEL[contact.last_contact_result] || contact.last_contact_result}</span>
       ${contact.last_contact_date ? `<span class="integ-side-note-date">最後聯絡<br>${fmtDate(contact.last_contact_date)}</span>` : ""}`
    : `<span style="color:var(--text-muted)">尚無</span>`;
  const sideRow = (emoji, label, valueHtml) => `
    <div class="integ-side-row">
      <div class="integ-side-label">${cardIcon(emoji, "info")} ${label}</div>
      <div class="integ-side-val">${valueHtml}</div>
    </div>`;
  const sideCard = `
    <div class="integ-detail-card integ-side-card">
      <div class="integ-detail-card-head">
        <span class="integ-detail-card-title">${cardIcon("ℹ️", "info")} 其他資訊</span>
      </div>
      <div class="integ-side-body">
        ${sideRow("👤", "所有權人", escapeHtml(o.name))}
        ${sideRow("📞", "聯絡電話", phone ? escapeHtml(phone) : '<span style="color:var(--text-muted)">未填寫</span>')}
        ${sideRow("🏠", "戶籍地址", o.address ? escapeHtml(o.address) : '<span style="color:var(--text-muted)">未填寫</span>')}
        ${sideRow("📝", "備註", noteHtml)}
      </div>
    </div>`;

  return `
    <tr class="detail-row hidden" id="detail-row-${o.id}"><td colspan="${colspan}">
      <div class="integ-detail-wrap">
        <div class="integ-detail-main">${landCard}${buildingCard}</div>
        ${sideCard}
      </div>
    </td></tr>`;
}

function wireOwnerDetailRows(el, landowners) {
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
  el.querySelectorAll("[data-delete-land]").forEach((btn) => {
    btn.addEventListener("click", () => deleteLandRecord(Number(btn.dataset.owner), Number(btn.dataset.deleteLand)));
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

async function renderLandownersTypeTab(el, type, titleText = "") {
  const pid = state.currentProjectId;
  const isLand = type === "land";
  currentLandownerLabel = isLand ? "地主" : "屋主";
  // 地主帳號沒有 documents 權限,個別呼叫失敗不應讓整頁掛掉
  const [allLandowners, documents, alerts] = await Promise.all([
    api(`/projects/${pid}/landowners`),
    api(`/projects/${pid}/documents`, { silent: true }).catch(() => []),
    api(`/projects/${pid}/alerts`, { silent: true }).catch(() => []),
  ]);
  state.projectCache[pid].landowners = allLandowners;

  const landowners = allLandowners.filter((o) => (isLand ? o.land_records : o.building_records).length > 0);
  const landownerIds = new Set(landowners.map((o) => o.id));

  const signedIds = new Set(
    documents.filter((d) => d.doc_type === "contract" && landownerIds.has(d.landowner_id)).map((d) => d.landowner_id)
  );
  const alertIds = new Set(alerts.filter((a) => landownerIds.has(a.landowner_id)).map((a) => a.landowner_id));

  el.innerHTML = `
    <div class="section-toolbar">
      <h3>${titleText || (isLand ? "土地登記清冊" : "建物登記清冊")} (${landowners.length})</h3>
      ${isEditor()
      ? `<div style="display:flex;gap:8px">
              <button class="btn-primary btn-sm" id="add-landowner-btn">+ 新增${currentLandownerLabel}</button>
            </div>`
      : ""
    }
    </div>
    <div class="dashboard-stat-row" style="margin-bottom:20px">
      <div class="dashboard-stat-item accent-brand" data-stat-filter="all" role="button" tabindex="0">
        <div class="dashboard-stat-icon">👥</div>
        <div><div class="dashboard-stat-num">${landowners.length}</div><div class="dashboard-stat-lbl">總${currentLandownerLabel}人數</div></div>
      </div>
      <div class="dashboard-stat-item accent-success" data-stat-filter="signed" role="button" tabindex="0">
        <div class="dashboard-stat-icon">✅</div>
        <div><div class="dashboard-stat-num">${signedIds.size}</div><div class="dashboard-stat-lbl">已簽約人數</div></div>
      </div>
      <div class="dashboard-stat-item accent-danger" data-stat-filter="alert" role="button" tabindex="0">
        <div class="dashboard-stat-icon">🔔</div>
        <div><div class="dashboard-stat-num">${alertIds.size}</div><div class="dashboard-stat-lbl">待聯繫提醒</div></div>
      </div>
    </div>
    <div class="table-wrap">
      <table>
        <thead><tr>
          <th>編號</th><th>姓名</th><th>統一編號</th><th>門牌地址</th><th>${isLand ? "土地" : "建物"}持分</th>
        </tr></thead>
        <tbody>
          ${landowners
      .map((o, rowIdx) => {
        const records = isLand ? o.land_records : o.building_records;
        const shareLabel = records.length
          ? `${records[0].ownership_numerator}/${records[0].ownership_denominator}${records.length > 1 ? ` 等${records.length}筆` : ""}`
          : "-";
        return `
            <tr data-row-owner="${o.id}">
              <td>${String(rowIdx + 1).padStart(3, "0")}</td>
              <td>${escapeHtml(o.name)}</td>
              <td>${escapeHtml(o.id_number) || "-"}</td>
              <td>${escapeHtml(o.address) || "-"}</td>
              <td>${shareLabel}</td>
            </tr>
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
    const statFilterSets = { signed: signedIds, alert: alertIds };
    const statCards = el.querySelectorAll("[data-stat-filter]");
    const applyStatFilter = (filter) => {
      statCards.forEach((card) => card.classList.toggle("active", card.dataset.statFilter === filter));
      const matchSet = filter === "all" ? null : statFilterSets[filter];
      el.querySelectorAll("[data-row-owner]").forEach((row) => {
        const ownerId = Number(row.dataset.rowOwner);
        const visible = !matchSet || matchSet.has(ownerId);
        row.classList.toggle("hidden", !visible);
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

  const addBtn = document.getElementById("add-landowner-btn");
  if (addBtn) addBtn.addEventListener("click", isLand ? openAddLandownerModal : openAddBuildingByNumberModal);
  // 土地/建物登記匯入按鈕搬到「SOP > 第1關」的清冊需求旁邊了(見 sop.js),這裡不再放。
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

// 目前開著的編輯視窗屬於哪組共有人(樓棟視圖同一格門牌)、目前是第幾位 - 給標題列
// 的 ▲▼ 按鈕、以及上下鍵監聽共用,單筆編輯(沒有 siblingIds)時維持 null。
let _loEditorSiblings = null;
let _loEditorCurrentId = null;

function switchLandownerSibling(delta) {
  if (!_loEditorSiblings) return;
  const idx = _loEditorSiblings.indexOf(_loEditorCurrentId);
  const next = (idx + delta + _loEditorSiblings.length) % _loEditorSiblings.length;
  openEditLandownerModal(_loEditorSiblings[next], _loEditorSiblings);
}

// 編輯地主視窗預設唯讀顯示,要先點視窗裡的「✏️ 編輯」才能改資料 - 避免誤觸(原本
// 樓棟視圖格子上可直接點的簽約/拜訪標籤也一併拿掉,統一改成只能從這個視窗改)。
// 要記住是「哪一位」地主開的編輯模式,不然切到別位地主(上下鍵切共有人)還留在
// 編輯模式就失去保護意義了。
let landownerEditMode = false;
let _landownerEditModeFor = null;

function loFieldHtml(label, name, value, extra) {
  if (landownerEditMode) {
    return `<div class="field"><label>${label}</label><input name="${name}" value="${escapeHtml(value) || ""}" ${extra || ""}></div>`;
  }
  return `<div class="field"><label>${label}</label><div class="lo-readonly-value">${escapeHtml(value) || "-"}</div></div>`;
}

// siblingIds:同一個樓棟視圖格子裡的共有人 id 清單(依序),讓編輯視窗能用標題列的
// ▲▼ 按鈕或上下鍵切換到下一 / 上一位,不用先跳一層「此門牌共有人」清單再點進去。
// 單筆編輯(從整合清冊等清單點「編輯」進來)不傳這個參數,就不會出現切換 UI。
async function openEditLandownerModal(landownerId, siblingIds = null, opts = {}) {
  const readOnly = !!(opts && opts.readOnly);
  _loModalReadOnly = readOnly;
  if (_landownerEditModeFor !== landownerId || readOnly) {
    landownerEditMode = false;
    _landownerEditModeFor = landownerId;
  }
  // 直接打 API 拿最新資料,不要用 state.projectCache 裡的快取 —— 整合清冊分頁自己
  // 抓的地主清單沒有寫回這個快取,只有登記資料分頁會寫,所以在整合清冊儲存過一次
  // 之後,快取還是舊的,再點編輯會看到儲存前的舊狀態(例如拜訪/簽約狀態一直顯示
  // 未拜訪/未簽約)。
  let owner;
  let contacts = [];
  let latestContact = null;
  let roDocs = [];
  try {
    const [ownerResult, contactsResult, docsResult] = await Promise.all([
      api(`/projects/${state.currentProjectId}/landowners/${landownerId}`),
      api(`/projects/${state.currentProjectId}/landowners/${landownerId}/contacts`, { silent: true }).catch(() => []),
      readOnly ? api(`/projects/${state.currentProjectId}/documents`, { silent: true }).catch(() => []) : Promise.resolve([]),
    ]);
    roDocs = (docsResult || []).filter((d) => d.landowner_id === landownerId);
    owner = ownerResult;
    contacts = contactsResult;
    // 後端已依 contact_date 新到舊排序(見 routers/contacts.py list_contacts),第一筆就是最近一次。
    latestContact = contacts[0] || null;
  } catch (e) {
    return;
  }
  if (!owner) return;
  // 已經聯絡到「同意」了,底下就不用再逼人多填一筆聯絡紀錄 - 除非之後又有新狀況
  // (反對/需回電等),那本來就會再點進來新增一筆蓋過去,不受這裡影響。
  const alreadyAgreed = latestContact && latestContact.contact_result === "agreed";
  // 門牌地址(建物登記的 address)跟「地址」(地主自己的戶籍地址)是兩件事 - 同一位
  // 地主可能同時持有好幾戶,這裡去重後全部列出來,唯讀顯示,不是真的可以在這裡改。
  // 多筆時逐行列出(不再擠成一行用「、」串接被輸入框裁掉看不到後面),方便一眼看完。
  const buildingRecordsList = owner.building_records || [];
  const doorAddresses = [...new Set(buildingRecordsList.map((r) => r.address).filter(Boolean))];
  // 原謄本門牌(匯入當下登載的,改「門牌地址」不會動它)- 每個建號一行;舊資料沒有
  // original_address 就退回目前的門牌。
  const deedAddresses = buildingRecordsList
    .map((r) => ({ no: r.building_number, addr: r.original_address || r.address }))
    .filter((d) => d.addr);
  // 同一案件底下每戶的路名/幾段幾乎都一樣,每個膠囊都重複顯示一次很雜訊 - 只留巷弄號樓
  // 那段(真正能分辨是哪一戶的部分);完整地址還是留在 title,滑鼠移上去看得到。
  const stripRoadPrefix = (addr) =>
    (addr || "").replace(/^[一-龥]+?[路街道](?:[0-9一二三四五六七八九十]+段)?/, "") || addr;
  const siblings = siblingIds && siblingIds.length > 1 ? siblingIds : null;
  if (siblings) {
    _loEditorSiblings = siblings;
    _loEditorCurrentId = landownerId;
  }
  const idx = siblings ? siblings.indexOf(landownerId) : -1;
  const canAddContact = isEditor() && !isLandowner() && !alreadyAgreed && !readOnly;
  const editToggleBtnHtml = readOnly ? "" : landownerEditMode
    ? `<button type="button" class="btn-secondary btn-sm" id="lo-edit-toggle-btn" title="檢視模式" aria-label="檢視模式">👁</button>`
    : `<button type="button" class="btn-primary btn-sm" id="lo-edit-toggle-btn">✏️ 編輯</button>`;
  const addContactBtnHtml = canAddContact
    ? `<button type="button" class="btn-secondary btn-sm" id="lo-add-contact-btn">+ 拜訪紀錄</button>`
    : "";
  const siblingNavHtml = siblings
    ? `<span class="lo-sibling-nav">
        <button type="button" class="lo-sibling-btn" onclick="switchLandownerSibling(-1)" title="上一位">‹</button>
        <span class="lo-sibling-count">${idx + 1}/${siblings.length}</span>
        <button type="button" class="lo-sibling-btn" onclick="switchLandownerSibling(1)" title="下一位">›</button>
      </span>`
    : "";
  const expandContacts = _loExpandContactsOnce;
  // 純檢視:拜訪紀錄不收合,每筆可點開看詳細;相關文件直接列出來(不用再按按鈕)。
  const roContactsHtml = readOnly
    ? `<div class="lo-ro-title">拜訪紀錄${contacts.length ? ` <span class="lod-count">${contacts.length}</span>` : ""}</div>
      ${contacts.length
      ? `<div class="lo-ro-list">${contacts
        .map((c) => {
          const rk = c.contact_result === "agreed" ? "agreed" : c.contact_result === "opposed" ? "opposed" : "pending";
          return `<details class="lo-ro-contact">
              <summary>
                <span class="clm-date">${fmtDateTime(c.contact_date)}</span>
                <span class="clm-method">${CONTACT_METHOD_LABEL[c.contact_method] || c.contact_method}</span>
                <span class="consent-status-badge cs-${rk}">${CONTACT_RESULT_LABEL[c.contact_result] || c.contact_result}</span>
              </summary>
              <div class="lo-ro-detail">
                <div class="clm-row"><span class="clm-label">拜訪時間</span><span>${fmtDateTime(c.contact_date)}</span></div>
                <div class="clm-row"><span class="clm-label">拜訪方式</span><span>${CONTACT_METHOD_LABEL[c.contact_method] || c.contact_method}</span></div>
                <div class="clm-row"><span class="clm-label">拜訪結果</span><span>${CONTACT_RESULT_LABEL[c.contact_result] || c.contact_result}</span></div>
                <div class="clm-row"><span class="clm-label">拜訪人員</span><span>${escapeHtml(c.staff_name || "—")}</span></div>
                <div class="clm-row"><span class="clm-label">拜訪紀錄</span><span>${c.notes ? escapeHtml(c.notes) : "—"}</span></div>
                ${c.next_follow_up_date ? `<div class="clm-row"><span class="clm-label">下次跟進</span><span>${fmtDate(c.next_follow_up_date)}</span></div>` : ""}
              </div>
            </details>`;
        })
        .join("")}</div>`
      : `<div class="helper-text">尚無拜訪紀錄</div>`}`
    : "";
  const roDocsHtml = readOnly
    ? `<div class="lo-ro-title">相關文件${roDocs.length ? ` <span class="lod-count">${roDocs.length}</span>` : ""}</div>
      ${roDocs.length
      ? `<div class="lod-doc-list">${roDocs
        .map(
          (d) => `<div class="lod-doc">
            <div class="lod-doc-main">
              <div class="lod-doc-name" title="${escapeHtml(d.file_name)}">${escapeHtml(d.file_name)}</div>
              <div class="lod-doc-meta"><span class="lod-chip">${escapeHtml(DOC_TYPE_LABEL[d.doc_type] || d.doc_type)}</span>${fmtDateTime(d.uploaded_at)}</div>
            </div>
            <button type="button" class="lod-icon-btn" data-lo-ro-view="${d.id}" data-lo-ro-name="${escapeHtml(d.file_name)}" title="預覽" aria-label="預覽">${DOC_EYE_ICON}</button>
            <button type="button" class="lod-icon-btn" data-lo-ro-dl="${d.id}" data-lo-ro-name="${escapeHtml(d.file_name)}" title="下載" aria-label="下載">${DOC_DOWNLOAD_ICON}</button>
          </div>`
        )
        .join("")}</div>`
      : `<div class="helper-text">這位地主目前沒有相關文件</div>`}`
    : "";
  _loExpandContactsOnce = false;
  const titleHtml = `<span class="lo-modal-title-row">
      <span class="lo-modal-title-left">${currentLandownerLabel}資料${siblingNavHtml}</span>
      <span class="lo-modal-title-right">${landownerEditMode ? addContactBtnHtml + editToggleBtnHtml : ""}</span>
    </span>`;
  openModal(
    titleHtml,
    `
    <form id="landowner-edit-form">
      <div class="field-row lo-edit-top">
        ${loFieldHtml("姓名", "name", owner.name, "required")}
        <div class="field">
            <label>門牌地址${doorAddresses.length > 1 ? `(共 ${doorAddresses.length} 戶)` : ""}</label>
            ${landownerEditMode
      ? (buildingRecordsList.length
        ? `<div style="display:flex;flex-direction:column;gap:6px">
                  ${buildingRecordsList
          .map(
            (r) =>
              `<input data-building-address-id="${r.id}" value="${escapeHtml(r.address) || ""}" placeholder="建號${escapeHtml(r.building_number) || r.id} 門牌地址" autocomplete="off">`
          )
          .join("")}
                </div>`
        : `<div class="helper-text">尚無建物登記資料,請先到「登記資料 → 建物登記」新增</div>`)
      : `<div class="badge-row" style="padding:8px 2px">
              ${doorAddresses.length
        ? doorAddresses.map((a) => `<span class="mini-badge" title="${escapeHtml(a)}">${escapeHtml(stripRoadPrefix(a))}</span>`).join("")
        : `<span class="mini-badge">—</span>`
      }
            </div>`
    }
          </div>
      </div>

      ${readOnly ? "" : `      <details class="lo-edit-section"${landownerEditMode ? " open" : ""}>
        <summary>地主基本資料</summary>
        <div class="lo-edit-section-body">
          <div class="field-row">
            ${loFieldHtml("統一編號", "id_number", owner.id_number, 'placeholder="例如 A123456789 (二類遮罩)" autocomplete="off"')}
          </div>
          <div class="field-row">
            ${loFieldHtml("市內電話", "phone_landline", owner.phone_landline, 'placeholder="例如 02-12345678" autocomplete="off"')}
            ${loFieldHtml("行動電話", "phone_mobile", owner.phone_mobile, 'placeholder="例如 0912345678" autocomplete="off"')}
          </div>
          <div class="field-row">
            ${loFieldHtml("LINE ID", "line_id", owner.line_id, 'autocomplete="off"')}
            ${loFieldHtml("電子郵箱", "email", owner.email, 'type="email" autocomplete="off"')}
          </div>
          ${deedAddresses.length
      ? `<div class="field">
            <label>原謄本門牌地址${deedAddresses.length > 1 ? `(共 ${deedAddresses.length} 戶)` : ""}</label>
            <div class="lo-deed-addr-list" title="謄本匯入時登載的門牌,不會隨上面「門牌地址」的修改而變動">
              ${deedAddresses
        .map(
          (d) => `<div class="lo-deed-addr-row">${d.no ? `<span class="lo-deed-addr-no">建號 ${escapeHtml(d.no)}</span>` : ""}<span>${escapeHtml(d.addr)}</span></div>`
        )
        .join("")}
            </div>
          </div>`
      : ""}
          ${loFieldHtml("地址", "address", owner.address)}
        </div>
      </details>`}

      ${landownerEditMode || readOnly ? "" : `      <div class="field">
        <label>拜訪 / 簽約狀態</label>
        ${landownerEditMode
      ? `<div class="sop-checklist lo-visit-checklist">
          <label class="sop-checklist-item lo-check-row">
            <input type="checkbox" data-lo-visit-toggle ${owner.visit_status === "visited" ? "checked" : ""} class="lo-check-input">
            <span class="sop-checklist-icon lo-check-icon">✓</span>
            <div style="flex:1">
              <div class="sop-checklist-label">已拜訪</div>
              <div class="sop-checklist-sub">${owner.visit_status === "visited" ? "已完成拜訪" : "勾選即完成拜訪"}</div>
            </div>
          </label>
          ${owner.visit_status === "visited"
        ? `<div class="sop-checklist-item ${owner.agreement_status === "signed" ? "done" : ""}">
                <div class="sop-checklist-icon">${owner.agreement_status === "signed" ? "✓" : ""}</div>
                <div style="flex:1">
                  <div class="sop-checklist-label">已簽約</div>
                  <div class="sop-checklist-sub">${owner.agreement_status === "signed" ? "已上傳簽約文件" : "上傳意願書與簽約文件後完成簽約"}</div>
                </div>
                <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
                  ${owner.agreement_status === "signed" ? `<button type="button" class="btn-link btn-sm" data-lo-reset="agreement">取消</button>` : ""}
                  <span class="helper-text">請到「相關文件」上傳意願書與簽約文件</span>
                </div>
                <input type="file" data-lo-upload-input="willingness_form" style="display:none">
              </div>`
        : ""
      }
        </div>`
      : `<div class="badge-row" style="padding:8px 2px">
          <span class="mini-badge ${owner.visit_status === "visited" ? "gate-ok" : ""}">${owner.visit_status === "visited" ? "✓ 已拜訪" : "未拜訪"}</span>
          <span class="mini-badge ${owner.agreement_status === "signed" ? "gate-ok" : ""}">${owner.agreement_status === "signed" ? "✓ 已簽約" : "未簽約"}</span>
        </div>`
    }
      </div>`}

      ${readOnly ? roContactsHtml + roDocsHtml : landownerEditMode ? "" : `      <details class="lo-edit-section"${expandContacts ? " open" : ""}>
        <summary>拜訪紀錄${contacts.length ? ` (${contacts.length})` : ""}</summary>
        <div class="lo-edit-section-body">
          ${contacts.length
      ? `<div class="clm-list">
                ${contacts
        .map((c) => {
          const rk = c.contact_result === "agreed" ? "agreed" : c.contact_result === "opposed" ? "opposed" : "pending";
          return `<div class="clm-item">
                    <div class="clm-item-head">
                      <span class="clm-date">${fmtDateTime(c.contact_date)}</span>
                      <span class="clm-method">${CONTACT_METHOD_LABEL[c.contact_method] || c.contact_method}</span>
                      <span class="consent-status-badge cs-${rk}">${CONTACT_RESULT_LABEL[c.contact_result] || c.contact_result}</span>
                    </div>
                    ${c.notes ? `<div class="clm-row"><span class="clm-label">備註</span><span>${escapeHtml(c.notes)}</span></div>` : ""}
                    ${c.next_follow_up_date ? `<div class="clm-row"><span class="clm-label">下次跟進</span><span>${fmtDate(c.next_follow_up_date)}</span></div>` : ""}
                  </div>`;
        })
        .join("")}
              </div>`
      : `<div class="helper-text">尚無聯絡紀錄</div>`
    }
        </div>
      </details>

`}

      <div class="modal-footer">
        ${landownerEditMode
      ? `<button type="button" class="btn-secondary" id="lo-cancel-btn">取消</button>
           <button type="submit" class="btn-primary">儲存</button>`
      : `${isLandowner() || readOnly ? "" : `<button type="button" class="btn-secondary lo-footer-left" id="lo-related-docs-btn">📎 相關文件</button>`}${addContactBtnHtml}${editToggleBtnHtml}`
    }
      </div>
    </form>`
  );

  // 編輯模式不要右上角叉叉(有「取消」鈕);檢視模式保留叉叉。
  if (landownerEditMode) document.getElementById("modal-close-btn")?.remove();

  document.getElementById("lo-cancel-btn")?.addEventListener("click", () => {
    landownerEditMode = false;
    closeModal();
  });

  document.getElementById("lo-edit-toggle-btn")?.addEventListener("click", () => {
    landownerEditMode = !landownerEditMode;
    openEditLandownerModal(landownerId, siblingIds, { readOnly: _loModalReadOnly });
  });

  document.querySelectorAll("[data-lo-ro-view]").forEach((b) =>
    b.addEventListener("click", () => viewDocument(Number(b.dataset.loRoView), b.dataset.loRoName))
  );
  document.querySelectorAll("[data-lo-ro-dl]").forEach((b) =>
    b.addEventListener("click", () => downloadDocument(Number(b.dataset.loRoDl), b.dataset.loRoName))
  );

  document.getElementById("lo-related-docs-btn")?.addEventListener("click", () => {
    openLandownerDocsSidePanel(landownerId, siblingIds);
  });

  document.getElementById("lo-add-contact-btn")?.addEventListener("click", () => {
    openContactSidePanel(landownerId, siblingIds);
  });

  // 好幾位共有人共用同一格門牌時,上下鍵切到上一 / 下一位,直接重開這個編輯視窗
  // (每次都是新的 openModal,舊的按鍵監聽要先拆掉,不然切幾次就疊了好幾份)。且只
  // 在焦點不在表單欄位上時生效,才不會搶掉 <select>/radio 原生的上下鍵操作。
  if (siblings) {
    const onKey = (e) => {
      if (!document.getElementById("landowner-edit-form")) {
        document.removeEventListener("keydown", onKey);
        return;
      }
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      if (e.target.closest("#landowner-edit-form")) return;
      e.preventDefault();
      document.removeEventListener("keydown", onKey);
      switchLandownerSibling(e.key === "ArrowUp" ? -1 : 1);
    };
    document.addEventListener("keydown", onKey);
  } else {
    _loEditorSiblings = null;
    _loEditorCurrentId = null;
  }

  // 拜訪 / 簽約狀態改成 SOP 關卡的做法:「已拜訪」是純勾選,勾了才會多出「已簽約」
  // 這格(沒拜訪完全不顯示簽約選項);「已簽約」靠上傳意願書判定,不用另外傳合約。
  // 每個動作都直接呼叫 API、整個重開編輯視窗刷新畫面,做法跟共有人上下鍵切換一致。
  const renderedAt = Date.now();
  document.querySelectorAll("[data-lo-visit-toggle]").forEach((cb) => {
    cb.addEventListener("change", async (ev) => {
      // 剛開啟編輯模式的瞬間(例如點「編輯」那一下的殘留點擊)不算使用者勾選,
      // 還原勾選狀態、不送出,避免一按編輯就被自動改成已拜訪。
      if (!ev.isTrusted || Date.now() - renderedAt < 600) {
        cb.checked = !cb.checked;
        return;
      }
      const next = cb.checked ? "visited" : "not_visited";
      const payload = { visit_status: next };
      // 取消拜訪時,已簽約不能繼續留著,一起歸零 - 不允許「沒拜訪卻已簽約」殘留
      if (next === "not_visited" && owner.agreement_status === "signed") payload.agreement_status = "not_signed";
      try {
        await api(`/projects/${state.currentProjectId}/landowners/${landownerId}`, { method: "PATCH", body: payload });
        syncProjectAggregates();
        _refreshBackgroundIfBuilding();
        openEditLandownerModal(landownerId, siblingIds, { readOnly: _loModalReadOnly });
      } catch (err) {
        cb.checked = !cb.checked;
      }
    });
  });
  document.querySelectorAll("[data-lo-upload]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelector(`[data-lo-upload-input="${btn.dataset.loUpload}"]`).click();
    });
  });
  document.querySelectorAll("[data-lo-upload-input]").forEach((input) => {
    input.addEventListener("change", async () => {
      const file = input.files[0];
      if (!file) return;
      const docType = input.dataset.loUploadInput;
      const confirmed = await inspectAndConfirmDocumentUpload(file, docType);
      if (!confirmed) {
        input.value = "";
        return;
      }
      const fd = new FormData();
      fd.append("file", file);
      fd.append("doc_type", docType);
      fd.append("landowner_id", landownerId);
      try {
        await api(`/projects/${state.currentProjectId}/documents`, { method: "POST", body: fd, isForm: true });
        await api(`/projects/${state.currentProjectId}/landowners/${landownerId}`, { method: "PATCH", body: { agreement_status: "signed" } });
        toast("已上傳並更新狀態", "success");
        syncProjectAggregates();
        _refreshBackgroundIfBuilding();
        openEditLandownerModal(landownerId, siblingIds, { readOnly: _loModalReadOnly });
      } catch (err) {
        input.value = "";
      }
    });
  });
  document.querySelectorAll("[data-lo-reset]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await api(`/projects/${state.currentProjectId}/landowners/${landownerId}`, { method: "PATCH", body: { agreement_status: "not_signed" } });
        toast("已取消", "success");
        syncProjectAggregates();
        _refreshBackgroundIfBuilding();
        openEditLandownerModal(landownerId, siblingIds, { readOnly: _loModalReadOnly });
      } catch (err) { }
    });
  });

  document.getElementById("landowner-edit-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    // 表單只有在編輯模式才會渲染出可送出的欄位(檢視模式沒有「儲存」鈕,見上面
    // modal-footer),送到這裡一定是編輯模式,可以放心讀 input 的值。
    const fd = new FormData(e.target);
    const data = Object.fromEntries(fd.entries());
    try {
      const payload = {
        name: data.name,
        id_number: data.id_number || null,
        phone_landline: data.phone_landline || null,
        phone_mobile: data.phone_mobile || null,
        line_id: data.line_id || null,
        email: data.email || null,
        address: data.address || null,
      };
      await api(`/projects/${state.currentProjectId}/landowners/${landownerId}`, { method: "PATCH", body: payload });

      const addressInputs = [...document.querySelectorAll("[data-building-address-id]")];
      await Promise.all(
        addressInputs.map((inp) => {
          const rid = Number(inp.dataset.buildingAddressId);
          const orig = buildingRecordsList.find((r) => r.id === rid);
          const val = inp.value.trim();
          if (orig && (orig.address || "") === val) return null;
          return api(`/projects/${state.currentProjectId}/landowners/${landownerId}/building-records/${rid}`, {
            method: "PATCH",
            body: { address: val || null },
          });
        })
      );

      landownerEditMode = false;
      closeModal();
      toast("已更新", "success");
      renderTab(state.activeTab);
      syncProjectAggregates();
    } catch (err) { }
  });
}

// datetime-local 沒給 value 的話,Chrome/Edge 只會顯示一個「現在時刻」的灰色預覽
// 樣式,看起來像已經填好,但使用者沒真的點進去改過任何一段的話,FormData 讀出來
// 其實是空字串 —— 送出時 new Date("") 會丟例外,又被下面的 catch(err){} 整個吞掉,
// 使用者只會看到「點建立沒反應」,連 toast 都不會跳。這裡直接把 value 設成真正的
// 現在時間,從根本避免這個空值陷阱。
function _nowForDatetimeLocalInput() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

// 這位地主的「相關文件」視窗:意願書上傳 + 拜訪→意願書→簽約 進度。
// 只有最近一次拜訪結果是「同意」才能上傳意願書;反對/未決定 = 已拜訪但不能上傳;
// 未接聽或沒拜訪過 = 未拜訪、不能上傳。
let _loDocsChanged = false;
async function openLandownerDocsSidePanel(landownerId, siblingIds = null) {
  // 已經開著就只更新內容(不重開視窗、不閃爍);第一次才建立面板。
  if (!document.getElementById("modal-side-panel")) {
    openSidePanel("相關文件", `<div class="helper-text">載入中…</div>`, { width: "460px" });
  }
  let owner, contacts, docs;
  try {
    [owner, contacts, docs] = await Promise.all([
      api(`/projects/${state.currentProjectId}/landowners/${landownerId}`),
      api(`/projects/${state.currentProjectId}/landowners/${landownerId}/contacts`, { silent: true }).catch(() => []),
      api(`/projects/${state.currentProjectId}/documents`),
    ]);
  } catch (e) {
    return;
  }
  const panel = document.getElementById("modal-side-panel");
  const body = panel && panel.querySelector(".modal-body");
  if (!body) return;
  // 關閉面板時,如果有變動過,才把後面的地主資料視窗刷新一次(狀態徽章才會跟上)。
  const closeBtn = panel.querySelector("#modal-side-close-btn");
  if (closeBtn) {
    closeBtn.onclick = () => {
      panel.remove();
      if (_loDocsChanged) {
        _loDocsChanged = false;
        openEditLandownerModal(landownerId, siblingIds, { readOnly: _loModalReadOnly });
      }
    };
  }

  const forms = docs
    .filter((d) => d.landowner_id === landownerId && d.doc_type === "willingness_form")
    .sort((x, y) => parseApiDate(y.uploaded_at) - parseApiDate(x.uploaded_at));
  const contracts = docs
    .filter((d) => d.landowner_id === landownerId && d.doc_type === "contract")
    .sort((x, y) => parseApiDate(y.uploaded_at) - parseApiDate(x.uploaded_at));
  const otherDocs = docs.filter((d) => d.landowner_id === landownerId && d.doc_type !== "willingness_form" && d.doc_type !== "contract");
  const latest = contacts[0] || null;
  const result = latest ? latest.contact_result : null;
  const ro = _loModalReadOnly;
  const canUpload = result === "agreed" && isEditor() && !isLandowner() && !ro;
  const visited = owner.visit_status === "visited";
  const visitedLog = contacts.find((c) => c.contact_result !== "no_answer");
  const signed = owner.agreement_status === "signed";
  const lastForm = forms[0] || null;
  const lastContract = contracts[0] || null;
  // 簽約 = 意願書之後還要再上傳簽約文件(合約);沒有意願書就不能上傳簽約文件。
  const canUploadContract = !!lastForm && isEditor() && !isLandowner() && !ro;
  // 同一個上傳區:還沒有意願書 → 上傳的是意願書;已有意願書 → 上傳的是簽約文件。
  const nextIsContract = !!lastForm;
  const zoneEnabled = nextIsContract ? canUploadContract : canUpload;

  const blockedMsg = !latest
    ? "尚未有拜訪紀錄,請先「+ 拜訪紀錄」,結果為同意才能上傳意願書"
    : result === "no_answer"
      ? "還未拜訪,不能進行上傳作業!"
      : result === "opposed"
        ? "最近一次拜訪結果為反對,已拜訪但不能上傳意願書"
        : result === "agreed"
          ? "你的角色沒有上傳權限"
          : "最近一次拜訪結果尚未同意(已拜訪),不能上傳意願書";

  const pad2 = (n) => String(n).padStart(2, "0");
  const dt = (iso) => {
    const d = parseApiDate(iso);
    return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  };
  const ICON = {
    check: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>`,
    file: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h4"/></svg>`,
    pen: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>`,
    dash: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M7 12h10"/></svg>`,
    eye: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>`,
    trash: `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6"/></svg>`,
    upload: `<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 8.5a4 4 0 0 1-.5 7.97"/><path d="M12 12v8M9 15l3-3 3 3"/></svg>`,
    lock: `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>`,
  };

  // 三步驟進度:on = 已完成(綠),cur = 目前這一步(藍),off = 還沒到(灰)
  const step = (state, icon, title, sub, file) => `<div class="lod-step lod-${state}">
      <div class="lod-dot">${icon}</div>
      <div class="lod-st-title">${title}</div>
      ${file ? `<div class="lod-st-file" title="${escapeHtml(file)}">${escapeHtml(file)}</div>` : ""}
      <div class="lod-st-sub">${sub}</div>
    </div>`;
  const bar = (on) => `<div class="lod-bar${on ? " lod-bar-on" : ""}"></div>`;

  const docRow = (d, tag, canDelete) => `<div class="lod-doc">
      <div class="lod-doc-ic">${ICON.file}</div>
      <div class="lod-doc-main">
        <div class="lod-doc-name" title="${escapeHtml(d.file_name)}">${escapeHtml(d.file_name)}</div>
        <div class="lod-doc-meta"><span class="lod-chip">${escapeHtml(tag)}</span>${dt(d.uploaded_at)}</div>
      </div>
      <button type="button" class="lod-icon-btn" data-lo-doc-view="${d.id}" data-lo-doc-name="${escapeHtml(d.file_name)}" title="預覽" aria-label="預覽">${ICON.eye}</button>
      ${canDelete ? `<button type="button" class="lod-icon-btn lod-icon-danger" data-lo-doc-del="${d.id}" title="刪除" aria-label="刪除">${ICON.trash}</button>` : ""}
    </div>`;

  const docRows = [
    ...forms.map((d) => docRow(d, "意願書", isEditor() && !ro)),
    ...contracts.map((d) => docRow(d, "簽約文件", isEditor() && !ro)),
  ].join("");
  const otherRows = otherDocs.map((d) => docRow(d, DOC_TYPE_LABEL[d.doc_type] || d.doc_type, false)).join("");
  const docCount = forms.length + contracts.length;

  const statusMsg = signed
    ? "已完成拜訪、上傳意願書與簽約文件,已簽約。"
    : lastForm
      ? "已完成拜訪並上傳意願書,請上傳簽約文件完成簽約。"
      : canUpload
        ? "已拜訪且同意,請上傳意願書。"
        : blockedMsg;
  const statusTone = signed ? "ok" : lastForm || canUpload ? "go" : "wait";
  const statusIcon = signed ? ICON.check : lastForm || canUpload ? ICON.upload : ICON.lock;

  const zoneHtml = (id, inputId, enabled, lockedMsg) => enabled
    ? `<label id="${id}" class="lod-drop">
          <span class="lod-drop-ic">${ICON.upload}</span>
          <span class="lod-drop-text">
            <b>將檔案拖曳到此,或 <u>點擊選擇檔案</u></b>
            <small>支援 PDF、JPG、JPEG、PNG(單檔上限 10MB)</small>
          </span>
          <input type="file" id="${inputId}" accept=".pdf,.jpg,.jpeg,.png" style="display:none">
        </label>`
    : `<div class="lod-drop lod-drop-locked"><span class="lod-drop-ic">${ICON.lock}</span><span class="lod-drop-text"><b>${escapeHtml(lockedMsg)}</b></span></div>`;

  body.innerHTML = `
    <div class="lod-steps">
      ${step(visited ? "on" : "off", visited ? ICON.check : ICON.dash, visited ? "已拜訪" : "未拜訪", visited && visitedLog ? dt(visitedLog.contact_date) : "—")}
      ${bar(visited && !!lastForm)}
      ${step(lastForm ? "on" : visited && canUpload ? "cur" : "off", ICON.file, lastForm ? "已上傳意願書" : "未上傳意願書", lastForm ? dt(lastForm.uploaded_at) : "—", lastForm ? lastForm.file_name : "")}
      ${bar(!!lastForm && signed)}
      ${step(signed ? "on" : lastForm ? "cur" : "off", signed ? ICON.check : ICON.pen, signed ? "已簽約" : "尚未簽約", signed ? (lastContract ? dt(lastContract.uploaded_at) : "已完成簽約") : "尚未完成簽約", signed && lastContract ? lastContract.file_name : "")}
    </div>
    <div class="lod-status lod-status-${statusTone}"><span class="lod-status-ic">${statusIcon}</span><span>${escapeHtml(statusMsg)}</span></div>
    ${ro ? "" : `<div class="lod-sec-title">${nextIsContract ? "上傳簽約文件" : "上傳意願書"}</div>
    ${zoneHtml("lo-docs-drop", "lo-docs-input", zoneEnabled, nextIsContract ? "你的角色沒有上傳權限" : blockedMsg)}`}
    ${docRows ? `<div class="lod-sec-title">已上傳文件 <span class="lod-count">${docCount}</span></div><div class="lod-doc-list">${docRows}</div>` : ""}
    ${otherRows ? `<div class="lod-sec-title">其他相關文件</div><div class="lod-doc-list">${otherRows}</div>` : ""}`;

  const reopen = async () => {
    _loDocsChanged = true;
    syncProjectAggregates();
    _refreshBackgroundIfBuilding();
    await openLandownerDocsSidePanel(landownerId, siblingIds);
  };

  body.querySelectorAll("[data-lo-doc-view]").forEach((b) =>
    b.addEventListener("click", () => viewDocument(Number(b.dataset.loDocView), b.dataset.loDocName))
  );
  body.querySelectorAll("[data-lo-doc-del]").forEach((b) =>
    b.addEventListener("click", async () => {
      if (!confirm("確定要刪除這份文件嗎?")) return;
      try {
        const delId = Number(b.dataset.loDocDel);
        const isForm = forms.some((f) => f.id === delId);
        await api(`/projects/${state.currentProjectId}/documents/${delId}`, { method: "DELETE" });
        // 刪掉最後一份簽約文件(或最後一份意願書)後,簽約就不成立,狀態退回未簽約
        const remainingContracts = contracts.filter((c) => c.id !== delId).length;
        const remainingForms = forms.filter((f) => f.id !== delId).length;
        if (signed && ((!isForm && remainingContracts === 0) || (isForm && remainingForms === 0))) {
          await api(`/projects/${state.currentProjectId}/landowners/${landownerId}`, { method: "PATCH", body: { agreement_status: "not_signed" } });
        }
        toast("已刪除", "success");
        await reopen();
      } catch (err) { }
    })
  );

  const wireZone = (zoneId, inputId, docType, markSigned) => {
    const input = body.querySelector("#" + inputId);
    const drop = body.querySelector("#" + zoneId);
    const doUpload = async (file) => {
      if (!file) return;
      if (!/\.(pdf|jpe?g|png)$/i.test(file.name)) {
        toast("只支援 PDF、JPG、JPEG、PNG", "error");
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        toast("單檔上限 10MB", "error");
        return;
      }
      if (drop) {
        drop.style.pointerEvents = "none";
        drop.style.opacity = ".6";
        drop.innerHTML = `<div style="font-weight:700;padding:18px 0">上傳中,請稍候…</div>`;
      }
      const fd = new FormData();
      fd.append("file", file);
      fd.append("doc_type", docType);
      fd.append("landowner_id", landownerId);
      try {
        await api(`/projects/${state.currentProjectId}/documents`, { method: "POST", body: fd, isForm: true });
        if (markSigned) {
          await api(`/projects/${state.currentProjectId}/landowners/${landownerId}`, { method: "PATCH", body: { agreement_status: "signed" } });
        }
        toast(markSigned ? "已上傳簽約文件,完成簽約" : "已上傳意願書", "success");
      } catch (err) { }
      await reopen();
    };
    if (input) input.addEventListener("change", () => doUpload(input.files[0]));
    if (drop) {
      drop.addEventListener("dragover", (e) => e.preventDefault());
      drop.addEventListener("drop", (e) => {
        e.preventDefault();
        doUpload(e.dataTransfer.files[0]);
      });
    }
  };
  wireZone("lo-docs-drop", "lo-docs-input", nextIsContract ? "contract" : "willingness_form", nextIsContract);
}

function contactSidePanelFieldsHtml() {
  return `
    <div class="field"><label>拜訪時間</label><input type="datetime-local" name="c_contact_date" value="${_nowForDatetimeLocalInput()}" required></div>
    <div class="field"><label>拜訪方式</label>
      <select name="c_contact_method">
        ${Object.entries(CONTACT_METHOD_LABEL).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}
      </select>
    </div>
    <div class="field"><label>拜訪結果</label>
      <select name="c_contact_result">
        ${Object.entries(CONTACT_RESULT_LABEL).filter(([k]) => k !== "callback_needed").map(([k, v]) => `<option value="${k}" ${k === "undecided" ? "selected" : ""}>${v}</option>`).join("")}
      </select>
    </div>
    <div class="field"><label>拜訪紀錄</label><textarea name="c_notes" rows="3"></textarea></div>`;
}

function openContactSidePanel(landownerId, siblingIds) {
  openSidePanel(
    "建立一筆拜訪資料",
    `<form id="lo-contact-side-form">
      ${contactSidePanelFieldsHtml()}
      <div class="modal-footer">
        <button type="button" class="btn-secondary" id="lo-contact-side-cancel">取消</button>
        <button type="submit" class="btn-primary">建立</button>
      </div>
    </form>`,
    { width: "380px" }
  );
  document.getElementById("lo-contact-side-cancel").addEventListener("click", () => closeSidePanel());
  document.getElementById("lo-contact-side-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    // 整個 handler 包一層 try/catch(連 FormData/Date 解析都包進去)- 原本只有
    // await api(...) 那段有 try,前面同步解析萬一丟例外,async function 會讓它
    // 變成沒人接的 rejected promise,使用者只會看到「按鈕沒反應、視窗沒關」,
    // 連錯誤 toast 都不會跳,除非自己開 DevTools 主控台才看得到。全包起來後,
    // 任何一步出錯都保證會跳 toast,不用再靠使用者回報主控台紅字才能定位問題。
    try {
      const fd = new FormData(e.target);
      const data = Object.fromEntries(fd.entries());
      const contactDate = new Date(data.c_contact_date);
      if (!data.c_contact_date || isNaN(contactDate.getTime())) {
        toast("請填寫拜訪時間", "error");
        return;
      }
      await api(`/projects/${state.currentProjectId}/landowners/${landownerId}/contacts`, {
        method: "POST",
        body: {
          landowner_id: landownerId,
          contact_date: contactDate.toISOString(),
          contact_method: data.c_contact_method,
          contact_result: data.c_contact_result,
          notes: data.c_notes || null,
        },
      });
      closeSidePanel();
      toast("已建立拜訪紀錄", "success");
      syncProjectAggregates();
      _refreshBackgroundIfBuilding();
      openEditLandownerModal(landownerId, siblingIds, { readOnly: _loModalReadOnly });
    } catch (err) {
      toast(`建立失敗:${err && err.message ? err.message : err}`, "error");
    }
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
        <input name="ltt_original_value" type="number" step="1" value="${r.ltt_original_value ?? ""}" placeholder="單價 (例: 86900)" style="flex:1" autocomplete="off">
      </div>
      <div class="helper-text" style="margin-top:4px">照謄本上印的單價(元/平方公尺)填,不用自己乘面積;土增稅試算會自動換算成這筆持分的總額。</div>
      ${landRecordLttHistoryHtml(r)}
    </div>
    <div class="field">
      <label>當期公告土地現值(元/m²)</label>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <input name="ltt_current_value_period" value="${escapeHtml(r.ltt_current_value_period) || ""}" placeholder="年期 (例: 115年)" style="flex:1;min-width:100px" autocomplete="off">
        <input name="ltt_current_value" type="number" step="1" value="${r.ltt_current_value ?? ""}" placeholder="單價 (例: 237000)" style="flex:1;min-width:100px" autocomplete="off">
      </div>
      <div class="helper-text" style="margin-top:4px">照謄本土地標示部「公告土地現值」印的單價(元/平方公尺)填,供「土增稅」頁自動計算「本月申報移轉現值」用;臺北市案件「土增稅」頁會自動查詢帶入,這裡填的值只在查無資料時當備援。</div>
    </div>`;
}

// 謄本原始的「前次移轉現值或原規定地價」全部歷史記錄(同一筆地每次移轉都會多一筆) -
// 上面欄位只存系統挑出的最新一筆(供土增稅試算用),這裡純粹列出來給人工核對,不能編輯。
function landRecordLttHistoryHtml(r) {
  const history = Array.isArray(r.ltt_original_value_history) ? r.ltt_original_value_history : [];
  if (history.length <= 1) return "";
  const items = history
    .map((h) => `${escapeHtml(h.period || "")} ${h.value_per_sqm != null ? Number(h.value_per_sqm).toLocaleString() : "-"}元/m²`)
    .join("、");
  return `<div class="helper-text" style="margin-top:4px">謄本原始記錄共 ${history.length} 筆:${items}(上方欄位僅顯示系統挑選的最新一筆)</div>`;
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
    ltt_current_value_period: data.ltt_current_value_period || null,
    ltt_current_value: Number(data.ltt_current_value) || null,
    // 物價指數調整比例/持有年限/可扣除金額三欄已從表單移除,這裡刻意不送,才不會在編輯時
    // 把資料庫裡既有的手動值覆蓋成 null(土增稅頁仍會用這些值,沒填就走自動計算)。
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

