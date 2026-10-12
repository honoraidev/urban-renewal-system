"use strict";

let selectedProjectIds = new Set();
let dashboardProjectsById = {};
const expandedSidebarCities = new Set();
let sidebarCitiesInitialized = false;


// 案件卡片的「同意人數/反對人數/其他」文字統計 —— 依「拜訪結果」分類(跟樓棟視圖的
// 拜訪結果選項同一套:agreed/opposed/callback_needed/undecided/no_answer),「其他」
// 是把需回電/未決定/未接聽三種合併算,不細分成三個數字。取代原本土地同意/建物同意
// 兩個面積環,只留人數(土地/建物持分同意度改到案件總覽頁的「關鍵指標」看)。
function projectConsentBreakdownHtml(breakdown, names) {
  const total = breakdown?.headcount_total || 0;
  const agreed = breakdown?.headcount_agreed || 0;
  const opposed = breakdown?.headcount_opposed || 0;
  const other = Math.max(0, total - agreed - opposed);
  const agreedPct = total > 0 ? Math.round((agreed / total) * 100) : 0;
  const agreedDeg = total > 0 ? (agreed / total) * 360 : 0;
  const opposedDeg = total > 0 ? agreedDeg + (opposed / total) * 360 : 0;
  const nameTitle = names && names.length ? ` title="${escapeHtml(names.join("、"))}"` : "";
  return `
    <div class="project-card-consent">
      <div class="consent-pie"
        style="background:conic-gradient(var(--success) 0deg ${agreedDeg}deg, var(--danger) ${agreedDeg}deg ${opposedDeg}deg, var(--pie-rest, #fff) ${opposedDeg}deg 360deg)"${nameTitle}>
        <div class="consent-pie-hole">${agreedPct}<span class="consent-pie-unit">%</span></div>
      </div>
      <div class="consent-stats">
        <div class="consent-stat consent-stat-agreed">
          <div class="consent-num">${agreed}<span class="consent-unit">人</span></div>
          <div class="consent-lbl">同意人數</div>
        </div>
        <div class="consent-stat consent-stat-opposed">
          <div class="consent-num">${opposed}<span class="consent-unit">人</span></div>
          <div class="consent-lbl">反對人數</div>
        </div>
        <div class="consent-stat consent-stat-other" title="需回電 / 未決定 / 未接聽">
          <div class="consent-num">${other}<span class="consent-unit">人</span></div>
          <div class="consent-lbl">其他</div>
        </div>
      </div>
    </div>`;
}

// 「YYYY-MM-DD」+ 天數位移 -> 「YYYY/MM/DD」,純用 UTC 整數日期運算(Date.UTC),
// 不透過瀏覽器當地時區解析單純日期字串,避免月底/跨年這種進位算錯,也不會因為
// 使用者裝置時區不同而位移一天。
function _wkDateShift(dateStr, days) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return `${dt.getUTCFullYear()}/${String(dt.getUTCMonth() + 1).padStart(2, "0")}/${String(dt.getUTCDate()).padStart(2, "0")}`;
}

// 圓形徽章裡的小圖示一律用 SVG(不用 ✓/✕/↑/↓/→ 這種文字符號)- 不同瀏覽器/字型
// 對這幾個 Unicode 符號的粗細、置中位置渲染差很多,看起來會比範本裡乾淨的線條
// 圖示笨重,跟同一張卡片裡本來就是 SVG 畫的日期膠囊小箭頭也對不起來。
const _wkSvg = (path) =>
  `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
// 「變化」欄的箭頭:朝好的方向(good)用有精神的斜角箭頭、朝壞的方向(bad)用
// 平實的直角箭頭 - 不是隨機選字體,同一份 up/down 各自有兩種畫法,依 tone 決定
// 用哪個,參考圖上同意(綠、好事)是斜的「↗」、反對(紅、壞事)是直的「↑」就是
// 這個規則畫出來的,不是巧合。
const WK_ICON = {
  check: _wkSvg(`<path d="M5 13l4 4L19 7"/>`),
  cross: _wkSvg(`<path d="M6 6l12 12M18 6L6 18"/>`),
  upStraight: _wkSvg(`<path d="M12 19V6M6 12l6-6 6 6"/>`),
  upDiagonal: _wkSvg(`<path d="M7 17L17 7M9 7h8v8"/>`),
  downStraight: _wkSvg(`<path d="M12 5v13M18 12l-6 6-6-6"/>`),
  downDiagonal: _wkSvg(`<path d="M7 7l10 10M17 9v8h-8"/>`),
  flat: _wkSvg(`<path d="M5 12h13M13 7l5 5-5 5"/>`),
  people: _wkSvg(`<circle cx="9" cy="8" r="3"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 5.5a3 3 0 0 1 0 5.5M17.5 14.5a5 5 0 0 1 3 4.5"/>`),
  bars: _wkSvg(`<path d="M6 19v-6M12 19V6M18 19v-9"/>`),
  calendar: _wkSvg(`<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>`),
  caret: _wkSvg(`<path d="M7 10l5 5 5-5"/>`),
};

const WK_WEEK_CHOICES = 8;

function _wkOffsetLabel(offset) {
  return offset === 0 ? "本週" : offset === 1 ? "上週" : `${offset} 週前`;
}

// 本地日期的「第 offset 週」週一 ~ 週日(跟後端 weekly-compare 的週界線一致)
function _wkWeekRange(offset) {
  const now = new Date();
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7) - offset * 7);
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
  const f = (d) => `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
  return `${f(monday)} - ${f(sunday)}`;
}

// 日期膠囊的下拉選單:選一週 → 跟後端要那週 vs 前一週的資料,只重畫這一塊。
document.addEventListener("click", async (e) => {
  const opt = e.target.closest("[data-wkt-pick]");
  if (opt) {
    e.stopPropagation();
    const box = opt.closest(".wkt-range-wrap");
    const pid = Number(box.dataset.pid);
    const offset = Number(opt.dataset.wktPick);
    box.querySelector(".wkt-menu")?.remove();
    try {
      const data = await api(`/projects/${pid}/weekly-compare`, { params: { week_offset: offset } });
      const card = box.closest(".project-card-weekly");
      if (card) card.outerHTML = projectWeeklyCompareHtml(data.breakdown, data.last_week_breakdown, pid, offset);
    } catch (err) {}
    return;
  }
  const btn = e.target.closest("[data-wkt-pid]");
  document.querySelectorAll(".wkt-menu").forEach((m) => {
    if (!btn || !btn.parentElement.contains(m)) m.remove();
  });
  if (!btn) return;
  e.stopPropagation();
  const wrap = btn.parentElement;
  if (wrap.querySelector(".wkt-menu")) {
    wrap.querySelector(".wkt-menu").remove();
    return;
  }
  const cur = Number(btn.dataset.wktOffset);
  const menu = document.createElement("div");
  menu.className = "wkt-menu";
  menu.innerHTML = Array.from({ length: WK_WEEK_CHOICES }, (_, i) =>
    `<button type="button" class="wkt-menu-item ${i === cur ? "active" : ""}" data-wkt-pick="${i}"><b>${_wkOffsetLabel(i)}</b><span>${_wkWeekRange(i)}</span></button>`
  ).join("");
  wrap.appendChild(menu);
}, true);

// 本週 vs 上週的同意/反對人數比較 —— 上週/變化/本週三欄並排、中間夾漲跌,樣式照
// 使用者給的參考模板(圓形勾/叉徽章 + 底部圓角標籤 + 副標題 + 日期區間膠囊)做。
function projectWeeklyCompareHtml(breakdown, lastWeek, pid = null, weekOffset = 0) {
  if (!lastWeek) {
    return `
      <div class="project-card-weekly">
        <div class="wk-head"><div class="wk-head-icon">📅</div><div class="wk-head-title">本週 vs 上週</div></div>
        <div class="project-card-weekly-empty">快照累積中,滿一週後才會有比較資料</div>
      </div>`;
  }
  // lastWeek.snapshot_date 是上週日(這週一的前一天):上週 = 往前 6 天 ~ 當天,本週 = +1 ~ +7 天。
  const prevStart = _wkDateShift(lastWeek.snapshot_date, -6);
  const prevEnd = _wkDateShift(lastWeek.snapshot_date, 0);
  const weekStart = _wkDateShift(lastWeek.snapshot_date, 1);
  const weekEnd = _wkDateShift(lastWeek.snapshot_date, 7);
  const md = (d) => d.slice(5);
  const countOf = (b, key) => {
    if (!b) return 0;
    if (key === "other") return Math.max(0, (b.headcount_total || 0) - (b.headcount_agreed || 0) - (b.headcount_opposed || 0));
    return b[key] || 0;
  };
  // 第3~4關(意願書)/第5關起(合約)改看簽署週報:新簽 / 累計已簽 / 未簽;第0~2關維持拜訪統計
  const phase = (breakdown && breakdown.phase) || "visit";
  const phaseWord = phase === "contract" ? "簽約" : "簽署";
  const rows = phase === "visit"
    ? [
        { key: "headcount_agreed", label: "同意", icon: WK_ICON.check, tone: "agree" },
        { key: "headcount_opposed", label: "反對", icon: WK_ICON.cross, tone: "oppose" },
        { key: "other", label: "其他", icon: WK_ICON.people, tone: "other" },
      ]
    : [
        { key: "new_signed", label: `新${phaseWord === "簽約" ? "簽約" : "簽"}`, icon: WK_ICON.check, tone: "agree" },
        { key: "cum_signed", label: "累計已簽", icon: WK_ICON.people, tone: "other" },
        { key: "unsigned", label: "未簽", icon: WK_ICON.cross, tone: "oppose" },
      ];
  const colTip = phase === "visit"
    ? "該週內有拜訪紀錄的地主人數(每位地主依該週最後一次拜訪結果分類)"
    : phase === "contract"
      ? "新簽 = 該週新簽約人數;累計已簽 / 未簽 = 到該週結束為止(依 SOP 第8關簽約階段記錄)"
      : "新簽 = 該週首次上傳意願書的人數;累計已簽 / 未簽 = 到該週結束為止";
  const arrow = `<span class="wkt-arrow" aria-hidden="true"></span>`;
  const rowHtml = (r) => {
    const prev = countOf(lastWeek, r.key);
    const cur = countOf(breakdown, r.key);
    const delta = cur - prev;
    // 變化百分比 = 相對上週人數的增減;上週是 0 人時沒有基準,有增加就算 100%。
    const pct = prev > 0 ? Math.round((delta / prev) * 100) : delta > 0 ? 100 : 0;
    const sign = delta > 0 ? "+" : "";
    return `
      <div class="wkt-label"><span class="wkt-badge wkt-${r.tone}">${r.icon}</span>${r.label}</div>
      <div class="wkt-val wkt-${r.tone}">${prev}<small>人</small></div>
      ${arrow}
      <div class="wkt-delta ${delta ? `wkt-${r.tone}` : "wkt-flat"}">${sign}${delta}<small>人</small> <span class="wkt-pct">(${sign}${pct}%)</span></div>
      ${arrow}
      <div class="wkt-val wkt-${r.tone} wkt-cur">${cur}<small>人</small></div>`;
  };
  return `
    <div class="project-card-weekly wkt">
      <div class="wkt-head">
        <span class="wkt-head-title">本週 vs 上週</span>
        <span class="wkt-range-wrap" data-pid="${pid || ""}"><button type="button" class="wkt-range" ${pid ? `data-wkt-pid="${pid}" data-wkt-offset="${weekOffset}"` : "disabled"} title="切換週次">
          ${WK_ICON.calendar} ${_wkOffsetLabel(weekOffset)} ${md(weekStart)} - ${md(weekEnd)}
          <span class="wkt-range-caret">${WK_ICON.caret}</span>
        </button></span>
      </div>
      <div class="wkt-grid">
        <div></div>
        <div class="wkt-col-h" title="${colTip}">上週<span>${md(prevStart)}-${md(prevEnd)}</span></div>
        <div></div>
        <div class="wkt-col-h" title="本週人數 − 上週人數">變化</div>
        <div></div>
        <div class="wkt-col-h" title="${colTip}">本週<span>${md(weekStart)}-${md(weekEnd)}</span></div>
        ${rows.map(rowHtml).join("")}
      </div>
    </div>`;
}

function alertTiers(alerts) {
  const tiers = { warn: 0, alert: 0, urgent: 0 };
  (alerts || []).forEach((a) => {
    const days = a.days_since_last_contact;
    if (days == null || days >= 30) tiers.urgent++;
    else if (days >= 14) tiers.alert++;
    else tiers.warn++;
  });
  return tiers;
}

function showView(id) {
  [
    "view-dashboard",
    "view-mywork",
    "view-new-project",
    "view-project-overview",
    "view-project-detail",
    "view-ocr-batch",
    "view-users",
    "view-loginlogs",
    "view-companydocs",
    "view-news",
    "view-regulations",
    "view-websites",
    "view-faq",
    "view-inventory",
    "view-tools",
    "view-manual",
  ].forEach((v) => {
    const el = document.getElementById(v);
    if (el) el.classList.toggle("hidden", v !== id);
  });
  persistViewState(id);
}

// 記住目前停在哪個畫面(頁面 + 案件 + 分頁),重新整理瀏覽器後 loadCurrentUser() 會
// 用這個復原,不用每次重整都被彈回「都更案件進度總覽」。存 sessionStorage(跟登入
// token 同壽命,關掉分頁/瀏覽器就清掉,不會留著別人下次打開還停在你看過的案件)。
function persistViewState(viewId) {
  try {
    const snapshot = { view: viewId };
    if (viewId === "view-project-detail" && state.currentProjectId) {
      snapshot.projectId = state.currentProjectId;
      snapshot.tab = state.activeTab || "sop";
    }
    if (viewId === "view-project-overview" && state.currentProjectId) {
      snapshot.projectId = state.currentProjectId;
    }
    sessionStorage.setItem("lastView", JSON.stringify(snapshot));
  } catch (e) { /* sessionStorage 不可用(私密瀏覽等)就算了,不影響功能 */ }
}

// 案件詳情頁在 openProject() 呼叫 showView() 當下,state.activeTab 還沒定案(稍後
// 才會設成 "sop" 或由 renderTab() 內部改寫),所以每次分頁實際渲染完成後(見
// renderTab() 尾端)都要再存一次,快照才會是使用者最後停留的那個分頁。
function persistCurrentTabState() {
  if (!document.getElementById("view-project-detail")?.classList.contains("hidden")) {
    persistViewState("view-project-detail");
  }
}

async function restoreLastView() {
  let saved = null;
  try {
    saved = JSON.parse(sessionStorage.getItem("lastView") || "null");
  } catch (e) {
    saved = null;
  }

  // 側欄「案件管理」清單只有 loadDashboard() 會填(renderSidebarProjects)。以前
  // 每次重整一定先進總覽,側欄一定會被建好;現在改成直接復原到其他畫面時,如果不
  // 順便補跑這個,側欄案件清單會整個是空的,要點回總覽才會出現。loadDashboard()
  // 本身不會切換可見畫面/側欄導覽反白(那是 goToDashboard() 才做的事),所以就算
  // 等一下要顯示的是別的畫面,先跑這個也不會讓畫面閃到總覽。
  try {
    await loadDashboard();
  } catch (e) { /* 個別畫面自己會處理載入失敗,這裡失敗不影響後面的畫面復原 */ }

  // 完全沒有存過快照(第一次登入、或剛登出清過 sessionStorage)才走這條預設路徑,
  // 落地在工作看板;saved.view 明確是 view-dashboard 的話,代表使用者上次就是停在
  // 案件一覽重新整理,維持原樣退回那頁,不要被這裡的登入預設值蓋過去。
  if (!saved || !saved.view) {
    await goToMyWork();
    return;
  }
  if (saved.view === "view-dashboard") {
    setActiveNav("dashboard");
    showView("view-dashboard");
    return;
  }
  try {
    switch (saved.view) {
      case "view-project-overview":
        if (!saved.projectId) {
          setActiveNav("dashboard");
          showView("view-dashboard");
          break;
        }
        await goToProjectOverviewPage(saved.projectId);
        break;
      case "view-project-detail":
        if (!saved.projectId) {
          setActiveNav("dashboard");
          showView("view-dashboard");
          break;
        }
        await openProject(saved.projectId);
        if (saved.tab && saved.tab !== "sop") {
          const tabBtn = document.querySelector(`.tab-btn[data-tab="${saved.tab}"]`);
          if (tabBtn && !tabBtn.classList.contains("hidden")) {
            document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b === tabBtn));
            state.activeTab = saved.tab;
            await renderTab(saved.tab);
          }
        }
        break;
      case "view-mywork":
        await goToMyWork();
        break;
      case "view-users":
        await goToUsers();
        break;
      case "view-loginlogs":
        await goToLoginLogs();
        break;
      case "view-companydocs":
        await goToCompanyDocs();
        break;
      case "view-news":
        await goToNews();
        break;
      case "view-regulations":
        await goToRegulations();
        break;
      case "view-websites":
        await goToWebsites();
        break;
      case "view-faq":
        await goToFaq();
        break;
      case "view-inventory":
        await goToInventory();
        break;
      case "view-tools":
        goToTools();
        break;
      case "view-manual":
        goToManual();
        break;
      default:
        // "view-new-project" / "view-ocr-batch" 這類過渡畫面沒有可復原的內容,回首頁。
        setActiveNav("dashboard");
        showView("view-dashboard");
    }
  } catch (e) {
    goToDashboard();
  }
}

function goToTools() {
  setActiveNav("tools");
  showView("view-tools");
}

function goToManual() {
  setActiveNav("manual");
  showView("view-manual");
}

// 側邊欄卡片(案件管理 / 工具與資源 / 系統指南)標題列:裡面有任何一項是目前頁面,標題列就跟著反白 -
// 收合成圖示列時項目都藏起來了,靠這個才看得出現在在哪一區。
function syncSidebarCardActive(forceCases = false) {
  // 卡片內容在收合圖示列彈出浮窗時會被搬到 body 底下,不能用「卡片.querySelector」找反白項目 -
  // 改成全域找出所有反白項目,再用 data-sb-owner(搬走也帶著)對回它屬於哪張卡片。
  const owners = new Set();
  document.querySelectorAll(".nav-link.active, .sb-case-item.active").forEach((el) => {
    const o = el.closest("[data-sb-owner]")?.dataset.sbOwner || el.closest(".sb-card")?.dataset.sbCard;
    if (o) owners.add(o);
  });
  if (forceCases) owners.add("cases"); // 進入案件頁時案件清單可能還沒畫好,直接強制反白
  document.querySelectorAll(".sb-card").forEach((card) => {
    const head = card.querySelector(".sb-card-head");
    if (head) head.classList.toggle("active", owners.has(card.dataset.sbCard));
  });
}

function setActiveNav(name) {
  document.querySelectorAll(".nav-link").forEach((b) => b.classList.toggle("active", b.dataset.nav === name));
  document.querySelectorAll(".sb-case-item").forEach((b) => b.classList.remove("active"));
  syncSidebarCardActive();
}

function setActiveSidebarCase(projectId) {
  document.querySelectorAll(".nav-link").forEach((b) => b.classList.remove("active"));
  document.querySelectorAll(".sb-case-item").forEach((b) =>
    b.classList.toggle("active", Number(b.dataset.projectId) === Number(projectId))
  );
  syncSidebarCardActive(true);
}

function renderSidebarProjects(projects) {
  const wrap = document.getElementById("sb-cases");
  if (!wrap) return;

  const byCity = {};
  (projects || []).forEach((p) => {
    const city = p.city || "未分類";
    (byCity[city] = byCity[city] || []).push(p);
  });

  if (!sidebarCitiesInitialized) {
    Object.keys(byCity).forEach((city) => expandedSidebarCities.add(city));
    sidebarCitiesInitialized = true;
  }

  // 側邊欄收合成圖示列時,案件清單改在浮窗裡顯示、城市分組不能再收合(見下面
  // .sb-cg-head 點擊防呆),但這裡如果不強制全部當成 open,原本在展開側邊欄時就手動
  // 收合過的城市(不在 expandedSidebarCities 裡)一收合成圖示列,底下案件列表就會
  // 用 max-height:0 的收合樣式畫出來 —— 使用者在浮窗裡看不到案件、又點不了標題列
  // 展開,等於完全被鎖住看不到那個城市的案件。收合狀態下一律強制展開,忽略
  // expandedSidebarCities 記的狀態。
  const forceOpen = document.querySelector(".sb")?.classList.contains("collapsed");
  const _sbDt = (iso) => {
    const d = iso ? parseApiDate(iso) : null;
    if (!d || isNaN(d.getTime())) return "";
    const z = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}/${z(d.getMonth() + 1)}/${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`;
  };
  const SB_PIN_ICON = `<svg viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><path d="M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z" fill="#22b8cf"/><circle cx="12" cy="10" r="2.8" fill="#ffffff"/></svg>`;
  const SB_FOLDER_ICON = `<svg viewBox="0 0 40 40" width="38" height="38" aria-hidden="true"><path d="M3 11a3 3 0 0 1 3-3h8.5l3.5 4H34a3 3 0 0 1 3 3v16a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z" fill="#f59e0b"/><rect x="3" y="15" width="34" height="3" fill="#fcd34d" opacity=".7"/><path d="M3 19a3 3 0 0 1 3-3h28a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3z" fill="#fbbf24"/></svg>`;
  wrap.innerHTML = Object.entries(byCity)
    .map(([city, cases]) => {
      const open = forceOpen || expandedSidebarCities.has(city);
      const latest = cases.map((c) => c.updated_at || c.created_at).filter(Boolean).sort().pop();
      const latestText = _sbDt(latest);
      return `
        <div class="sb-cg">
          <div class="sb-cg-head" data-city="${escapeHtml(city)}">
            <span class="sb-cg-pin">${SB_PIN_ICON}</span>
            <span class="sb-cg-title">
              <span class="sb-cg-name">${escapeHtml(city)}</span>
              <span class="sb-cg-sub">共 ${cases.length} 個案件${latestText ? ` · 最後更新 ${latestText}` : ""}</span>
            </span>
            <span class="sb-cg-count">${cases.length}</span>
            <span class="sb-cg-arrow ${open ? "open" : ""}">⌄</span>
          </div>
          <div class="sb-cg-items ${open ? "open" : ""}">
            ${cases
              .map((p) => {
                const upd = _sbDt(p.updated_at || p.created_at);
                return `
                <div class="sb-case-item" data-project-id="${p.id}">
                  <span class="sb-case-ic">${SB_FOLDER_ICON}</span>
                  <span class="sb-case-main">
                    <span class="sb-case-name">${escapeHtml(p.name)}</span>
                    ${upd ? `<span class="sb-case-sub">更新於 ${upd}</span>` : ""}
                  </span>
                  <span class="sb-case-stage sb-stage-c${Number(p.current_stage) % 4}">第${p.current_stage}階段</span>
                  <span class="sb-chev">›</span>
                </div>`;
              })
              .join("")}
          </div>
        </div>`;
    })
    .join("");

  wrap.querySelectorAll(".sb-cg-head").forEach((el) => {
    el.addEventListener("click", () => {
      // 側邊欄收合成圖示列時,案件清單是搬到浮窗裡顯示的(見 main.js
      // openCardFlyout())- 城市分組沒必要在那個小浮窗裡還能收合/展開,固定全部
      // 展開、標題列也不用做成看起來可以點的樣子(見 style.css
      // .sb.collapsed #sb-cases .sb-cg-head)。
      if (document.querySelector(".sb")?.classList.contains("collapsed")) return;
      const city = el.dataset.city;
      if (expandedSidebarCities.has(city)) expandedSidebarCities.delete(city);
      else expandedSidebarCities.add(city);
      renderSidebarProjects(projects);
    });
  });
  wrap.querySelectorAll(".sb-case-item").forEach((el) => {
    el.addEventListener("click", () => openProject(Number(el.dataset.projectId)));
  });
}

function ocrStatusBadge(item) {
  if (!item.latest_ocr_job_status) return "";
  if (item.latest_ocr_job_status === "processing") return `<span class="status-badge status-ocr-processing">OCR 中</span>`;
  if (item.latest_ocr_job_status === "failed") return `<span class="status-badge status-ocr-failed">辨識失敗</span>`;
  if (item.latest_ocr_job_status === "completed") {
    return item.latest_ocr_job_has_warning
      ? `<span class="status-badge status-ocr-review">AI 校正中</span>`
      : `<span class="status-badge status-ocr-complete">完成</span>`;
  }
  return "";
}

async function goToDashboard() {
  setActiveNav("dashboard");
  showView("view-dashboard");
  await loadDashboard();
}

// ===== 案件一覽:搜尋 / 篩選縣市 / 篩選負責人員(前端過濾,不重新打 API) =====
let _dashFilter = { q: "", city: "", district: "", owner: "" };
let _dashProjects = [];
let _dashFilterBound = false;

function _dashOwnerNames(p) {
  const split = (v) => String(v || "").split("、").map((x) => x.trim()).filter(Boolean);
  return [...new Set([...split(p.case_handler_name), ...split(p.case_manager_name)])];
}

function applyDashboardFilters() {
  const cards = [...document.querySelectorAll("#project-grid .project-card")];
  const q = _dashFilter.q.trim().toLowerCase();
  let shown = 0;
  cards.forEach((c) => {
    const owners = (c.dataset.owners || "").split("|").filter(Boolean);
    const ok =
      (!q || (c.dataset.hay || "").includes(q)) &&
      (!_dashFilter.city || c.dataset.city === _dashFilter.city) &&
      (!_dashFilter.district || c.dataset.district === _dashFilter.district) &&
      (!_dashFilter.owner || owners.includes(_dashFilter.owner));
    c.classList.toggle("hidden", !ok);
    if (ok) shown++;
  });
  const active = !!(q || _dashFilter.city || _dashFilter.district || _dashFilter.owner);
  document.getElementById("dash-clear")?.classList.toggle("hidden", !active);
  const countEl = document.getElementById("dash-count");
  if (countEl) countEl.textContent = active ? `符合 ${shown} / ${cards.length} 件` : "";
  document.getElementById("dash-empty")?.classList.toggle("hidden", shown > 0 || cards.length === 0);
}

// 行政區下拉:選了縣市就只列該縣市有案件的行政區,沒選就列全部
function _dashFillDistrictOptions() {
  const el = document.getElementById("dash-district");
  if (!el) return;
  const list = [...new Set(_dashProjects.filter((p) => !_dashFilter.city || p.city === _dashFilter.city).map((p) => p.district).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "zh-Hant")
  );
  if (_dashFilter.district && !list.includes(_dashFilter.district)) _dashFilter.district = "";
  el.innerHTML = `<option value="">全部行政區</option>` + list.map((d) => `<option value="${escapeHtml(d)}">${escapeHtml(d)}</option>`).join("");
  el.value = _dashFilter.district;
}

function setupDashboardFilters(projects) {
  _dashProjects = projects || [];
  const qEl = document.getElementById("dash-q");
  const cityEl = document.getElementById("dash-city");
  const ownerEl = document.getElementById("dash-owner");
  if (!qEl || !cityEl || !ownerEl) return;
  const cities = [...new Set((projects || []).map((p) => p.city).filter(Boolean))].sort((a, b) => a.localeCompare(b, "zh-Hant"));
  const owners = [...new Set((projects || []).flatMap(_dashOwnerNames))].sort((a, b) => a.localeCompare(b, "zh-Hant"));
  if (_dashFilter.city && !cities.includes(_dashFilter.city)) _dashFilter.city = "";
  if (_dashFilter.owner && !owners.includes(_dashFilter.owner)) _dashFilter.owner = "";
  cityEl.innerHTML = `<option value="">全部縣市</option>` + cities.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
  ownerEl.innerHTML = `<option value="">全部負責人員</option>` + owners.map((o) => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join("");
  _dashFillDistrictOptions();
  qEl.value = _dashFilter.q;
  cityEl.value = _dashFilter.city;
  ownerEl.value = _dashFilter.owner;
  if (!_dashFilterBound) {
    _dashFilterBound = true;
    qEl.addEventListener("input", () => { _dashFilter.q = qEl.value; applyDashboardFilters(); });
    cityEl.addEventListener("change", () => { _dashFilter.city = cityEl.value; _dashFillDistrictOptions(); applyDashboardFilters(); });
    document.getElementById("dash-district")?.addEventListener("change", (e) => { _dashFilter.district = e.target.value; applyDashboardFilters(); });
    ownerEl.addEventListener("change", () => { _dashFilter.owner = ownerEl.value; applyDashboardFilters(); });
    document.getElementById("dash-clear")?.addEventListener("click", () => {
      _dashFilter = { q: "", city: "", district: "", owner: "" };
      qEl.value = ""; cityEl.value = ""; ownerEl.value = "";
      _dashFillDistrictOptions();
      applyDashboardFilters();
    });
  }
  applyDashboardFilters();
}

async function loadDashboard() {
  selectedProjectIds = new Set();
  dashboardProjectsById = {};
  updateBatchDeleteBar();

  const statRow = document.getElementById("dashboard-stat-row");
  const aiBadge = document.getElementById("ai-online-badge");
  const grid = document.getElementById("project-grid");
  if (statRow) statRow.innerHTML = `<div class="empty-state">載入中...</div>`;
  if (grid) grid.innerHTML = `<div class="empty-state">載入中...</div>`;

  let summary;
  try {
    summary = await api("/projects/dashboard-summary");
  } catch (e) {
    if (statRow) statRow.innerHTML = "";
    if (grid) grid.innerHTML = `<div class="empty-state">載入失敗</div>`;
    return;
  }

  if (aiBadge) {
    aiBadge.textContent = summary.ai_online ? "AI Online" : "AI Offline";
    aiBadge.className = `status-badge ${summary.ai_online ? "status-active" : "status-closed"}`;
  }

  if (statRow) {
    statRow.innerHTML = `
      <div class="dashboard-stat-item accent-brand">
        <div class="dashboard-stat-icon">📁</div>
        <div><div class="dashboard-stat-num">${summary.project_count}</div><div class="dashboard-stat-lbl">案件</div></div>
      </div>
      <div class="dashboard-stat-item accent-success">
        <div class="dashboard-stat-icon">🌐</div>
        <div><div class="dashboard-stat-num">${summary.land_record_count}</div><div class="dashboard-stat-lbl">地號</div></div>
      </div>
      <div class="dashboard-stat-item accent-info">
        <div class="dashboard-stat-icon">🏢</div>
        <div><div class="dashboard-stat-num">${summary.building_record_count}</div><div class="dashboard-stat-lbl">建號</div></div>
      </div>
    `;
  }

  renderSidebarProjects(summary.projects);

  if (!summary.projects.length) {
    if (grid) {
      grid.innerHTML = `<div class="empty-state">目前沒有可查看的案件</div>`;
    }
    return;
  }

  summary.projects.forEach((p) => (dashboardProjectsById[p.id] = p));

  const cardAccents = ["accent-info", "accent-success", "accent-brand", "accent-danger"];
  // 卡片頂端色條 / 階段色塊的顏色依「縣市」決定(同一縣市同色),不再是依卡片順序輪流換色。
  const cityAccent = (city) => {
    let h = 0;
    for (const ch of String(city || "未分類")) h = (h * 31 + ch.codePointAt(0)) >>> 0;
    return cardAccents[h % cardAccents.length];
  };

  if (grid) {
    grid.innerHTML = summary.projects
      .map(
        (p, i) => `
          <div class="card project-card ${cityAccent(p.city)}" data-project-id="${p.id}" data-city="${escapeHtml(p.city || "")}" data-district="${escapeHtml(p.district || "")}" data-owners="${escapeHtml(_dashOwnerNames(p).join("|"))}" data-hay="${escapeHtml([p.name, p.project_code, p.description, p.city, p.district].filter(Boolean).join(" ").toLowerCase())}">
            <div class="project-card-top">
              ${isManager()
                ? `<input type="checkbox" class="project-select-checkbox" data-select-project="${p.id}" ${selectedProjectIds.has(p.id) ? "checked" : ""}>`
                : ""
              }
              <h3 style="flex:1">${escapeHtml(p.name)}</h3>
              ${p.city ? `<span class="mini-badge">${escapeHtml(p.city)}</span>` : ""}
              <button type="button" class="project-card-menu-btn project-card-eye-btn" data-project-site="${p.id}" title="檢視基地圖資" aria-label="檢視基地圖資">${NP_ICON.eye}</button>
              ${isEditor() ? `<button type="button" class="project-card-menu-btn" data-project-menu="${p.id}" title="案件選項">⋮</button>` : ""}
            </div>
            <div class="project-card-stage">
              <div class="project-stage-bar">
                ${Array.from({ length: 10 }, (_, i) => `<span class="${i <= p.current_stage ? "filled" : ""}"></span>`).join("")}
              </div>
              <div class="helper-text">第${p.current_stage}階段 · ${escapeHtml(sopStageLabel(p.current_stage))}</div>
            </div>
            ${projectConsentBreakdownHtml(p.visit_breakdown, p.agreed_landowner_names)}
            ${projectWeeklyCompareHtml(p.week_activity || p.visit_breakdown, p.last_week_activity || p.last_week_breakdown, p.id)}
            ${p.case_handler_name || p.case_manager_name
              ? `<div class="project-card-footer">
                  ${p.case_handler_name ? `<span>👤 ${escapeHtml(p.case_handler_name)}</span>` : ""}
                  ${p.case_manager_name ? `<span>💼 ${escapeHtml(p.case_manager_name)}</span>` : ""}
                </div>`
              : ""
            }
          </div>`
      )
      .join("");
    setupDashboardFilters(summary.projects);

    grid.querySelectorAll(".project-card[data-project-id]").forEach((card) => {
      card.addEventListener("click", () => goToProjectOverviewPage(Number(card.dataset.projectId)));
    });
    document.getElementById("add-project-tile")?.addEventListener("click", goToNewProject);

    grid.querySelectorAll("[data-project-site]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const target = summary.projects.find((x) => x.id === Number(btn.dataset.projectSite));
        if (target) openSiteMapsViewer(target);
      });
    });

    grid.querySelectorAll("[data-project-menu]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const target = summary.projects.find((x) => x.id === Number(btn.dataset.projectMenu));
        if (target) toggleProjectCardMenu(btn, target);
      });
    });

    grid.querySelectorAll("[data-select-project]").forEach((checkbox) => {
      checkbox.addEventListener("click", (e) => e.stopPropagation());
      checkbox.addEventListener("change", () => {
        const id = Number(checkbox.dataset.selectProject);
        if (checkbox.checked) selectedProjectIds.add(id);
        else selectedProjectIds.delete(id);
        updateBatchDeleteBar();
      });
    });
  }
}

function updateBatchDeleteBar() {
  const btn = document.getElementById("batch-delete-btn");
  const countEl = document.getElementById("batch-select-count");
  const selectAllWrap = document.getElementById("batch-select-all-wrap");
  const selectAllCheckbox = document.getElementById("batch-select-all");
  if (!btn || !countEl || !selectAllWrap || !selectAllCheckbox) return;

  const total = Object.keys(dashboardProjectsById).length;
  const show = isManager() && selectedProjectIds.size > 0;

  btn.classList.toggle("hidden", !show);
  countEl.classList.toggle("hidden", !show);
  selectAllWrap.classList.toggle("hidden", !show);
  if (show) countEl.textContent = `已選取 ${selectedProjectIds.size} 個案件`;

  selectAllCheckbox.checked = total > 0 && selectedProjectIds.size === total;
  selectAllCheckbox.indeterminate = selectedProjectIds.size > 0 && selectedProjectIds.size < total;
}

function toggleSelectAllProjects(checked) {
  if (checked) Object.keys(dashboardProjectsById).forEach((id) => selectedProjectIds.add(Number(id)));
  else selectedProjectIds.clear();
  document.querySelectorAll("[data-select-project]").forEach((checkbox) => {
    checkbox.checked = selectedProjectIds.has(Number(checkbox.dataset.selectProject));
  });
  updateBatchDeleteBar();
}

function openBatchDeleteModal() {
  const ids = [...selectedProjectIds];
  const selectedProjects = ids.map((id) => dashboardProjectsById[id]).filter(Boolean);
  openModal(
    "批量刪除案件",
    `
    <p style="margin-top:0">此操作將永久刪除以下 ${selectedProjects.length} 個案件及其底下所有地主、土地/建物資料、聯絡紀錄、文件、費用與 SOP 進度,且<strong style="color:var(--danger)">無法復原</strong>:</p>
    <ul style="margin:0 0 14px;padding-left:20px">
      ${selectedProjects.map((p) => `<li>${escapeHtml(p.name)}(${escapeHtml(p.project_code)})</li>`).join("")}
    </ul>
    <p>請輸入管理者帳號密碼以確認刪除:</p>
    <form id="batch-delete-form">
      <div class="field"><label>管理者帳號</label><input name="admin_username" autocomplete="off" required></div>
      <div class="field"><label>管理者密碼</label><input name="admin_password" type="password" autocomplete="off" required></div>
      <div class="modal-footer">
        <button type="button" class="btn-secondary" onclick="closeModal()">取消</button>
        <button type="submit" class="btn-danger">永久刪除 ${selectedProjects.length} 個案件</button>
      </div>
    </form>`
  );
  document.getElementById("batch-delete-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const submitBtn = e.target.querySelector("button[type=submit]");
    submitBtn.disabled = true;
    try {
      const result = await api("/projects/batch-delete", {
        method: "POST",
        body: {
          project_ids: ids,
          admin_username: fd.get("admin_username"),
          admin_password: fd.get("admin_password"),
        },
      });
      closeModal();
      toast(
        result.not_found_ids.length
          ? `已刪除 ${result.deleted_ids.length} 個案件,${result.not_found_ids.length} 個案件已不存在`
          : `已刪除 ${result.deleted_ids.length} 個案件`,
        "success"
      );
      await loadDashboard();
    } catch (err) {
      submitBtn.disabled = false;
    }
  });
}

function openDeleteProjectModal(project) {
  openModal(
    "刪除案件",
    `
    <p style="margin-top:0">此操作將永久刪除案件「${escapeHtml(project.name)}」及其底下所有地主、土地/建物資料、聯絡紀錄、文件、費用與 SOP 進度,且<strong style="color:var(--danger)">無法復原</strong>。</p>
    <p>請輸入案件代碼 <code style="background:var(--bg);padding:2px 6px;border-radius:4px">${escapeHtml(project.project_code)}</code> 以確認刪除:</p>
    <form id="delete-project-form">
      <div class="field"><input name="confirm_code" autocomplete="off" required></div>
      <div class="modal-footer">
        <button type="button" class="btn-secondary" onclick="closeModal()">取消</button>
        <button type="submit" class="btn-danger">永久刪除</button>
      </div>
    </form>`
  );
  document.getElementById("delete-project-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    if (fd.get("confirm_code") !== project.project_code) {
      toast("輸入的案件代碼不符,請重新確認", "error");
      return;
    }
    try {
      await api(`/projects/${project.id}`, { method: "DELETE" });
      closeModal();
      toast("案件已刪除", "success");
      loadDashboard();
    } catch (err) { }
  });
}

async function suggestNextProjectCode() {
  const year = new Date().getFullYear();
  const used = new Set();
  try {
    const projects = await api("/projects", { silent: true });
    const prefix = `${year}-`;
    projects.forEach((p) => {
      if (p.project_code && p.project_code.startsWith(prefix)) {
        const seq = Number(p.project_code.slice(prefix.length));
        if (Number.isInteger(seq) && seq > 0) used.add(seq);
      }
    });
  } catch (e) { }
  // Fill the lowest free number so a deleted code (e.g. 2026-001) gets reused
  // instead of the sequence always climbing.
  let seq = 1;
  while (used.has(seq)) seq++;
  return `${year}-${String(seq).padStart(3, "0")}`;
}

function updateDistrictSelectOptions(city, defaultDistrict = "") {
  const distSelect = document.getElementById("np-district");
  if (!distSelect) return;
  const districts = (typeof TAIWAN_DISTRICTS !== "undefined" && TAIWAN_DISTRICTS[city]) || [];
  if (!districts.length) {
    distSelect.innerHTML = `<option value="">請先選擇縣市</option>`;
    distSelect.disabled = true;
  } else {
    distSelect.disabled = false;
    distSelect.innerHTML =
      `<option value="">請選擇行政區</option>` +
      districts.map((d) => `<option value="${d}" ${d === defaultDistrict ? "selected" : ""}>${d}</option>`).join("");
  }
}

// 建立都更案:基本資料 + 基地圖資(基地位置圖、地籍範圍圖,必填)+ SOP 關卡流程
const NP_ICON = {
  building: '<svg viewBox="0 0 48 48" fill="none"><rect x="9" y="6" width="30" height="36" rx="3" fill="#1fb5a6"/><g fill="#fff"><rect x="15" y="12" width="5" height="5" rx="1"/><rect x="22" y="12" width="5" height="5" rx="1"/><rect x="29" y="12" width="5" height="5" rx="1"/><rect x="15" y="20" width="5" height="5" rx="1"/><rect x="22" y="20" width="5" height="5" rx="1"/><rect x="29" y="20" width="5" height="5" rx="1"/><path d="M20 42V32a4 4 0 0 1 8 0v10z"/></g></svg>',
  doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg>',
  image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="1.8"/><path d="m4 18 5-5 4 4 3-3 4 4"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  pin: '<svg viewBox="0 0 48 48" fill="none" stroke="#1fb5a6" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M24 4c-7 0-12 5.2-12 12 0 8.5 12 20 12 20s12-11.5 12-20c0-6.8-5-12-12-12z"/><circle cx="24" cy="16" r="4.5"/><path d="M6 36l8-3m28 3l-8-3M14 44h20"/></svg>',
  map: '<svg viewBox="0 0 48 48" fill="none" stroke="#1fb5a6" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12l12-5 16 5 12-5v29l-12 5-16-5-12 5z"/><path d="M16 7v29M32 12v29"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>',
  swap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-15-6.7L3 8M3 3v5h5M3 12a9 9 0 0 0 15 6.7l3-2.7M21 21v-5h-5"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
};

const NP_IMAGE_SLOTS = [
  { key: "location", title: "基地位置圖(周邊商圈)", hint: "例如:基地周邊道路、商圈、重要地標等", icon: "pin" },
  { key: "cadastral", title: "基地地籍範圍圖", hint: "例如:地籍套繪圖、地號範圍、更新單元範圍圖等", icon: "map" },
];

function npFmtSize(n) {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}
function npFmtStamp(d) {
  const p = (x) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// 案件卡片右上角眼睛:檢視這個案件的基地圖資(基地位置圖 + 基地地籍範圍圖),唯讀。
async function openSiteMapsViewer(project) {
  let docs = [];
  try {
    docs = await api(`/projects/${project.id}/documents`, { silent: true });
  } catch (e) { }
  const latest = (type) =>
    (docs || [])
      .filter((d) => d.doc_type === type)
      .sort((a, b) => new Date(b.uploaded_at) - new Date(a.uploaded_at))[0] || null;
  const panels = [
    { type: "site_location_map", title: "基地位置圖(周邊商圈)", desc: "基地周邊道路、商圈、重要地標等", icon: "pin" },
    { type: "site_cadastral_map", title: "基地地籍範圍圖", desc: "地籍套繪圖、地號範圍、更新單元範圍圖等", icon: "map" },
  ].map((x) => ({ ...x, doc: latest(x.type) }));

  const metaRow = (ico, k, v) => `<div class="sv-meta-row"><span class="sv-meta-ic">${NP_ICON[ico]}</span><span class="sv-meta-k">${k}</span><span class="sv-meta-v">${escapeHtml(v)}</span></div>`;
  const panelHtml = (x, i) => `
    <section class="sv-panel">
      <div class="sv-panel-head">
        <span class="sv-panel-ic">${NP_ICON[x.icon]}</span>
        <div><div class="sv-panel-t">${x.title}</div><div class="sv-panel-d">${x.desc}</div></div>
      </div>
      <div class="sv-img" data-sv-img="${i}">${x.doc ? '<span class="sv-img-loading">載入中…</span>' : '<span class="sv-img-empty">尚未上傳</span>'}</div>
      ${x.doc
        ? `<div class="sv-meta">
             <div class="sv-meta-list">
               ${metaRow("file", "檔案名稱", x.doc.file_name)}
               ${metaRow("clock", "上傳時間", fmtDateTime(x.doc.uploaded_at))}
               ${metaRow("file", "檔案大小", npFmtSize(x.doc.file_size_bytes || 0))}
             </div>
             <button type="button" class="sv-open" data-sv-open="${i}">${NP_ICON.eye}檢視大圖</button>
           </div>`
        : `<div class="sv-meta"><div class="sv-meta-list sv-none">還沒有上傳,請到 SOP 第 0 階段上傳</div></div>`}
    </section>`;

  openModal(
    `<span class="np-head"><span class="np-head-ic sv-head-ic">${NP_ICON.map}</span><span><span class="np-head-t">基地圖資檢視</span><span class="np-head-s">檢視本案件之基地圖資,僅供查閱,圖片不可變更或重新上傳。</span></span></span>`,
    `<div class="sv-grid">${panels.map(panelHtml).join("")}</div>
     <div class="modal-footer"><button type="button" class="btn-secondary" onclick="closeModal()">關閉</button></div>`,
    { width: "1000px" }
  );

  panels.forEach(async (x, i) => {
    if (!x.doc) return;
    const box = document.querySelector(`[data-sv-img="${i}"]`);
    try {
      const res = await api(`/projects/${project.id}/documents/${x.doc.id}/preview`, { silent: true });
      const blob = await res.blob();
      x.url = URL.createObjectURL(blob);
      const isImg = /^image\//i.test(blob.type) || /\.(png|jpe?g|gif|webp|bmp)$/i.test(x.doc.file_name);
      if (box) box.innerHTML = isImg ? `<img src="${x.url}" alt="${escapeHtml(x.title)}">` : `<span class="sv-img-empty">${NP_ICON.file}<br>${escapeHtml(x.doc.file_name)}</span>`;
    } catch (e) {
      if (box) box.innerHTML = '<span class="sv-img-empty">無法載入預覽</span>';
    }
  });
  document.querySelectorAll("[data-sv-open]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const x = panels[Number(btn.dataset.svOpen)];
      if (x && x.url) window.open(x.url, "_blank");
    });
  });
}

async function goToNewProject() {
  const cityOptions =
    `<option value="">請選擇</option>` + TAIWAN_CITIES.map((c) => `<option value="${c}">${c}</option>`).join("");
  // L2 以上(isManager)可以在建案的同時客製化 SOP 關卡流程,跟案件內 SOP 頁的
  // 「自訂關卡流程」是同一套編輯器 - 這裡先只存在這個 closure 的本地變數,案件建立
  // 成功後才真正呼叫 PUT .../sop/stages(此時案件才有 id)。openSopStageFlowEditor
  // 會用 openModal 蓋掉整個 #modal-root,所以編輯完要用 mountForm() 在同一個
  // closure 裡重繪表單(不能整個重呼叫 goToNewProject,不然 customStageFlow 會重置)。
  let customStageFlow = null;
  const canCustomizeFlow = isManager();
  // 兩張基地圖也只存在 closure:{ file, url, at }(url 是 objectURL 預覽,重繪表單時沿用)
  const images = { location: null, cadastral: null };
  // 「基地圖資」「SOP 關卡流程」兩塊用往下展開的方式,預設收合
  const open = { img: false, flow: false };

  // 把頁面內流程編輯器的目前內容同步回 closure;跟預設流程完全一樣就視為沒自訂(null)
  function syncFlow() {
    if (typeof sopFlowEditorState === "undefined" || !sopFlowEditorState || !sopFlowEditorState.root || !document.getElementById("np-flow-inline")) return;
    const cur = sopFlowEditorState.stages.map((x) => ({ key: x.key || null, name: (x.name || "").trim(), requirements: x.requirements || null }));
    const def = SOP_DEFAULT_STAGE_DEFS.map((d) => ({ key: d.key, name: d.name, requirements: null }));
    customStageFlow = JSON.stringify(cur) === JSON.stringify(def) ? null : cur;
  }

  function flowSummaryText() {
    if (!customStageFlow) return "預設流程(10關)";
    return `已自訂(${customStageFlow.length}關)`;
  }

  function slotHtml(slot) {
    const img = images[slot.key];
    return `
      <div class="np-up" data-slot="${slot.key}">
        <div class="np-up-title">${slot.title}</div>
        <div class="np-up-hint">${slot.hint}</div>
        <label class="np-drop" data-drop="${slot.key}">
          <span class="np-drop-ic">${NP_ICON[slot.icon]}</span>
          <b>點擊上傳或拖曳檔案到這裡</b>
          <input type="file" hidden data-file="${slot.key}">
        </label>
        ${img ? `
        <div class="np-file">
          ${img.isImage ? `<img src="${img.url}" alt="">` : `<span class="np-file-ico">📄</span>`}
          <div class="np-file-main">
            <div class="np-file-name">${escapeHtml(img.file.name)}</div>
            <div class="np-file-meta">${npFmtSize(img.file.size)} · ${npFmtStamp(img.at)}</div>
            <div class="np-file-act">
              <button type="button" data-act="view" data-slot="${slot.key}">${NP_ICON.search}<span class="np-lbl">查看</span></button>
              <button type="button" data-act="swap" data-slot="${slot.key}">${NP_ICON.swap}<span class="np-lbl">更換</span></button>
              <button type="button" class="del" data-act="del" data-slot="${slot.key}">${NP_ICON.trash}<span class="np-lbl">刪除</span></button>
            </div>
          </div>
        </div>` : ""}
      </div>`;
  }

  function mountForm(prevValues) {
    openModal(
      `<span class="np-head"><span class="np-head-ic">${NP_ICON.building}</span><span><span class="np-head-t">建立都更案</span><span class="np-head-s">填寫基本資料並上傳相關圖資,建立新的都市更新案件。</span></span></span>`,
      `
      <form id="project-form" class="np-form">
        <section class="np-card">
          <div class="np-card-head"><b>基本資料</b><span class="np-note">＊為必填欄位</span></div>
          <div class="np-card-body">
            <div class="field-row np-row4">
              <div class="field"><label>縣市 <span class="np-req">*</span></label><select name="city" id="np-city">${cityOptions}</select></div>
              <div class="field"><label>行政區 <span class="np-req">*</span></label><select name="district" id="np-district" disabled><option value="">請先選擇縣市</option></select></div>

              <div class="field"><label>案件代碼</label>
                <div class="np-code"><input name="project_code" id="np-code" readonly required><button type="button" id="np-code-copy" title="複製案件代碼">${NP_ICON.copy}</button></div>
              </div>
              <div class="field"><label>案件名稱 <span class="np-req">*</span></label><input name="name" required placeholder="請輸入案件名稱..."></div>
            </div>
            <div class="field np-desc"><label>備註</label><textarea name="description" rows="3" maxlength="500" placeholder="請輸入備註..." id="np-desc"></textarea><span class="np-count" id="np-count">0 / 500</span></div>
          </div>
        </section>

        <section class="np-card np-card-img${open.img ? " open" : ""}" data-np-sec="img">
          <button type="button" class="np-card-head np-toggle" data-np-toggle="img"><b>基地圖資</b><span class="np-opt">選填 · 已上傳 ${NP_IMAGE_SLOTS.filter((sl) => images[sl.key]).length}/${NP_IMAGE_SLOTS.length}</span><span class="np-chev">▾</span></button>
          <div class="np-collapse"${open.img ? "" : " hidden"}>
            <div class="np-ups">${NP_IMAGE_SLOTS.map(slotHtml).join("")}</div>
          </div>
        </section>

        ${canCustomizeFlow
          ? `<section class="np-card${open.flow ? " open" : ""}" data-np-sec="flow">
               <button type="button" class="np-card-head np-toggle" data-np-toggle="flow"><b>SOP 關卡流程</b><span class="np-opt" id="np-flow-summary">${flowSummaryText()}</span><span class="np-chev">▾</span></button>
               <div class="np-collapse"${open.flow ? "" : " hidden"}>
                 <div class="np-card-sub">選擇案件要套用的標準流程,或直接在下面調整。</div>
                 <div class="np-flow-inline" id="np-flow-inline"></div>
               </div>
             </section>`
          : ""}
        <div class="modal-footer np-foot">
          <button type="button" class="btn-secondary" onclick="closeModal()">取消</button>
          <button type="submit" class="btn-primary">${NP_ICON.check}建立</button>
        </div>
      </form>`,
      { width: "900px" }
    );

    const city = (prevValues && prevValues.city) || "";
    updateDistrictSelectOptions(city, (prevValues && prevValues.district) || "");
    document.getElementById("np-city").value = city;

    (async () => {
      document.getElementById("np-code").value = (prevValues && prevValues.project_code) || (await suggestNextProjectCode());
    })();
    if (prevValues) {
      ["name", "description"].forEach((k) => {
        const field = document.querySelector(`#project-form [name="${k}"]`);
        if (field && prevValues[k] != null) field.value = prevValues[k];
      });
    }
    const descEl = document.getElementById("np-desc");
    const countEl = document.getElementById("np-count");
    const syncCount = () => (countEl.textContent = `${descEl.value.length} / 500`);
    descEl.addEventListener("input", syncCount);
    syncCount();

    document.getElementById("np-code-copy").addEventListener("click", () => {
      const v = document.getElementById("np-code").value;
      try { navigator.clipboard.writeText(v); toast("已複製案件代碼", "success"); } catch (e) { }
    });

    document.getElementById("np-city").addEventListener("change", (e) => {
      updateDistrictSelectOptions(e.target.value);
    });

    // ---- 基地圖資上傳 ----
    const form = document.getElementById("project-form");
    const snapshotValues = () => {
      syncFlow();
      return Object.fromEntries(new FormData(form).entries());
    };
    const setImage = (key, file) => {
      if (!file) return;
      if (images[key]) URL.revokeObjectURL(images[key].url);
      images[key] = { file, url: URL.createObjectURL(file), at: new Date(), isImage: /^image\//i.test(file.type) };
      open.img = true;
      mountForm(snapshotValues());
    };
    form.querySelectorAll("[data-np-toggle]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const k = btn.dataset.npToggle;
        open[k] = !open[k];
        const sec = form.querySelector(`[data-np-sec="${k}"]`);
        sec.classList.toggle("open", open[k]);
        sec.querySelector(".np-collapse").hidden = !open[k];
      });
    });
    NP_IMAGE_SLOTS.forEach((slot) => {
      const input = form.querySelector(`input[data-file="${slot.key}"]`);
      const drop = form.querySelector(`[data-drop="${slot.key}"]`);
      input.addEventListener("change", () => setImage(slot.key, input.files[0]));
      ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
      ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
      drop.addEventListener("drop", (e) => setImage(slot.key, e.dataTransfer.files[0]));
    });
    form.querySelectorAll("[data-act]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const key = btn.dataset.slot;
        const img = images[key];
        if (btn.dataset.act === "view" && img) window.open(img.url, "_blank");
        else if (btn.dataset.act === "swap") form.querySelector(`input[data-file="${key}"]`).click();
        else if (btn.dataset.act === "del" && img) {
          URL.revokeObjectURL(img.url);
          images[key] = null;
          mountForm(snapshotValues());
        }
      });
    });

    // SOP 關卡流程:展開後直接在頁面內編輯(不用再按按鈕開視窗)
    const flowBox = document.getElementById("np-flow-inline");
    if (flowBox) {
      mountSopFlowEditorInline(flowBox, customStageFlow || SOP_DEFAULT_STAGE_DEFS, () => {
        syncFlow();
        const sum = document.getElementById("np-flow-summary");
        if (sum) sum.textContent = flowSummaryText();
      });
    }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const payload = Object.fromEntries(fd.entries());
      if (!payload.city) { toast("請選擇縣市", "error"); return; }
      if (!payload.district) { toast("請選擇行政區", "error"); return; }
      payload.expected_completion_date = payload.expected_completion_date || null;
      syncFlow();
      if (customStageFlow && customStageFlow.some((x) => !x.name)) { toast("每一關都要有名稱", "error"); return; }
      try {
        const project = await api("/projects", { method: "POST", body: payload });
        if (customStageFlow) {
          try {
            await api(`/projects/${project.id}/sop/stages`, { method: "PUT", body: { stages: customStageFlow } });
          } catch (err) { }
        }
        // 兩張基地圖(選填)都進「基地調查 › 基本調查」資料夾,並掛在 SOP 第 0 階段,
        // 直接算完成該階段對應的上傳項目;任一張傳失敗不影響案件已建立,可到 SOP 補傳。
        let uploadFailed = false;
        let basicFolderId = null;
        try {
          const folders = await api(`/projects/${project.id}/documents/folders`, { silent: true });
          basicFolderId = (folders.find((f) => f.code === "site_survey.basic") || {}).id || null;
        } catch (err) { }
        const uploads = [
          { img: images.location, docType: "site_location_map", desc: "基地位置圖(周邊商圈)", folderId: basicFolderId },
          { img: images.cadastral, docType: "site_cadastral_map", desc: "基地地籍範圍圖", folderId: basicFolderId },
        ];
        for (const u of uploads) {
          if (!u.img) continue; // 選填:沒選就跳過,之後到 SOP 第 0 階段補
          const up = new FormData();
          up.append("file", u.img.file);
          up.append("doc_type", u.docType);
          up.append("description", u.desc);
          up.append("sop_stage", "0"); // 對應 SOP 第 0 階段的「基地位置圖 / 基地地籍範圍圖」項目
          if (u.folderId) up.append("folder_id", String(u.folderId));
          try {
            await api(`/projects/${project.id}/documents`, { method: "POST", body: up, isForm: true, silent: true });
          } catch (err) { uploadFailed = true; }
        }
        Object.values(images).forEach((i) => i && URL.revokeObjectURL(i.url));
        toast(uploadFailed ? "案件已建立,但有基地圖上傳失敗,請到 SOP 第 0 階段補傳" : "案件已建立", uploadFailed ? "error" : "success");
        closeModal();
        await loadDashboard();
        await openProject(project.id);
      } catch (err) { }
    });
  }

  mountForm(null);
}

// 案件卡片右上角 ⋮ 的選單 - 直接以下拉方式貼在卡片上,不再開對話框
function closeAllProjectCardMenus() {
  document.querySelectorAll(".project-card-menu-pop").forEach((m) => m.remove());
  document.removeEventListener("click", _onDocClickProjectMenu, true);
  document.removeEventListener("keydown", _onKeyProjectMenu, true);
}
function _onDocClickProjectMenu(e) {
  if (!e.target.closest(".project-card-menu-pop, [data-project-menu]")) closeAllProjectCardMenus();
}
function _onKeyProjectMenu(e) {
  if (e.key === "Escape") closeAllProjectCardMenus();
}
function toggleProjectCardMenu(btn, project) {
  const card = btn.closest(".project-card");
  const alreadyOpen = card && card.querySelector(".project-card-menu-pop");
  closeAllProjectCardMenus();
  if (alreadyOpen || !card) return;

  // 編輯資料 L0~L3(isEditor,對齊後端 require_project_editor)都能用;刪除案件是
  // 不可逆的破壞性操作,維持 L0~L2(isManager,對齊後端 require_project_manager)。
  const pop = document.createElement("div");
  pop.className = "project-card-menu-pop";
  pop.innerHTML = `
    <button type="button" data-pm="edit">✏️ 編輯案件資料</button>
    ${isManager() ? `<button type="button" data-pm="delete" class="danger">🗑️ 刪除案件</button>` : ""}`;
  pop.addEventListener("click", (e) => {
    e.stopPropagation();
    const act = e.target.closest("[data-pm]")?.dataset.pm;
    closeAllProjectCardMenus();
    if (act === "edit") openProjectEditModal(project.id);
    else if (act === "delete") openDeleteProjectModal(project);
  });
  card.appendChild(pop);
  setTimeout(() => {
    document.addEventListener("click", _onDocClickProjectMenu, true);
    document.addEventListener("keydown", _onKeyProjectMenu, true);
  }, 0);
}

async function openProjectEditModal(projectId) {
  let p;
  try {
    p = await api(`/projects/${projectId}`);
  } catch (e) {
    return;
  }
  let docs = [];
  try {
    docs = await api(`/projects/${projectId}/documents`, { silent: true });
  } catch (e) { }
  // 文件說明裡的地號/建號摘要 - 提供在「備註」欄快速帶入 (去掉「謄本掃描匯入 - 」前綴)
  const noteSuggestions = [
    ...new Set(
      (docs || [])
        .map((d) => (d.description || "").replace(/^謄本掃描匯入\s*-\s*/, "").trim())
        .filter((s) => s && s !== "謄本掃描匯入")
    ),
  ];
  const noteFillHtml = noteSuggestions.length
    ? `<select id="pe-note-fill" style="margin-bottom:6px">
         <option value="">— 從文件地號帶入… —</option>
         ${noteSuggestions.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("")}
       </select>`
    : "";

  const cityOptions =
    `<option value="">請選擇</option>` +
    TAIWAN_CITIES.map((c) => `<option value="${c}" ${c === (p.city || "") ? "selected" : ""}>${c}</option>`).join("");
  openModal(
    "編輯案件資料",
    `
    <form id="project-edit-form">
      <div class="field-row">
        <div class="field"><label>縣市</label><select name="city" id="np-city">${cityOptions}</select></div>
        <div class="field"><label>行政區</label><select name="district" id="np-district" disabled><option value="">請先選擇縣市</option></select></div>
      </div>
      <div class="field-row">
        <div class="field"><label>案件代碼</label><input name="project_code" value="${escapeHtml(p.project_code || "")}" required></div>
        <div class="field"><label>案件名稱</label><input name="name" value="${escapeHtml(p.name || "")}" required></div>
      </div>
      <div class="field"><label>案件地址</label><input name="address" value="${escapeHtml(p.address || "")}"></div>
      <div class="field"><label>案件類型</label><input name="case_type" value="${escapeHtml(p.case_type || "")}" placeholder="例:都市更新(權利變換)"></div>
      <div class="field"><label>備註</label>${noteFillHtml}<textarea name="description" id="pe-note" rows="3">${escapeHtml(p.description || "")}</textarea></div>
      <div class="field"><label>案件簡介</label><textarea name="summary" rows="4" placeholder="案件總覽頁顯示的簡介段落,例如基地面積、預計興建規模等">${escapeHtml(p.summary || "")}</textarea></div>
      <div class="field">
        <label>封面圖(案件總覽頁用)</label>
        <div id="pe-cover-preview" style="margin-bottom:8px">
          ${p.has_cover_image ? `<img id="pe-cover-img" style="max-width:220px;max-height:140px;border-radius:8px;display:block;object-fit:cover">` : `<span class="helper-text">尚未上傳封面圖</span>`}
        </div>
        <input type="file" id="pe-cover-file" accept="image/*">
        ${p.has_cover_image ? `<button type="button" class="btn-link btn-sm" id="pe-cover-remove-btn" style="margin-top:4px">移除封面圖</button>` : ""}
      </div>
      <div class="modal-footer">
        <button type="button" class="btn-secondary" onclick="closeModal()">取消</button>
        <button type="submit" class="btn-primary">儲存</button>
      </div>
    </form>`,
    { width: "560px" }
  );

  updateDistrictSelectOptions(p.city || "", p.district || "");
  document.getElementById("np-city").addEventListener("change", (e) => {
    updateDistrictSelectOptions(e.target.value);
  });

  const loadCoverPreview = async () => {
    const img = document.getElementById("pe-cover-img");
    if (!img) return;
    try {
      const res = await api(`/projects/${projectId}/cover-image`, { silent: true });
      img.src = URL.createObjectURL(await res.blob());
    } catch (e) { }
  };
  loadCoverPreview();

  document.getElementById("pe-cover-file")?.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    try {
      await api(`/projects/${projectId}/cover-image`, { method: "POST", body: fd, isForm: true });
      toast("封面圖已更新", "success");
      await loadDashboard();
      refreshOverviewPageIfOpen(projectId);
      // 剛上傳完馬上重開一次編輯視窗,順便讓「移除封面圖」按鈕出現(第一次上傳前
      // has_cover_image 是 false,按鈕不存在)。
      closeModal();
      openProjectEditModal(projectId);
    } catch (err) { }
  });

  document.getElementById("pe-cover-remove-btn")?.addEventListener("click", async () => {
    try {
      await api(`/projects/${projectId}/cover-image`, { method: "DELETE" });
      toast("封面圖已移除", "success");
      await loadDashboard();
      refreshOverviewPageIfOpen(projectId);
      closeModal();
      openProjectEditModal(projectId);
    } catch (err) { }
  });

  const noteFill = document.getElementById("pe-note-fill");
  if (noteFill) {
    noteFill.addEventListener("change", () => {
      if (!noteFill.value) return;
      const ta = document.getElementById("pe-note");
      ta.value = ta.value.trim() ? `${ta.value.trim()}\n${noteFill.value}` : noteFill.value;
      noteFill.value = "";
    });
  }

  document.getElementById("project-edit-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = Object.fromEntries(new FormData(e.target).entries());
    try {
      const updated = await api(`/projects/${projectId}`, { method: "PATCH", body: payload });
      toast("案件資料已更新", "success");
      closeModal();
      if (state.currentProjectId === projectId) {
        state.currentProject = updated;
        renderProjectHeader(updated);
      }
      await loadDashboard();
      refreshOverviewPageIfOpen(projectId);
    } catch (err) { }
  });
}

// 案件資料(名稱/簡介/封面圖等)被編輯後,如果使用者當下就停在案件總覽頁,要跟著
// 重新整理(名稱/總覽卡片裡的簡介、封面圖都可能變了),不然要手動切出去再切回來
// 才看得到最新的。SOP 進度頁那邊已經有 renderProjectHeader() 各自處理,這裡只管
// 總覽頁那份。
function refreshOverviewPageIfOpen(projectId) {
  if (state.currentProjectId !== projectId) return;
  if (document.getElementById("view-project-overview")?.classList.contains("hidden")) return;
  goToProjectOverviewPage(projectId);
}

// 首頁「都更案件進度總覽」卡片的落地頁 —— 獨立的一個 view(view-project-overview),
// 沒有分頁列,跟 openProject() 進去的案件管理分頁頁面(view-project-detail)是完全不同
// 的兩個畫面,不是同一頁裡切分頁/藏分頁列而已。要看 SOP 進度等其他內容,總覽頁面上
// 的「進入案件管理」按鈕會呼叫 openProject() 換到另一個畫面。
async function goToProjectOverviewPage(id) {
  state.currentProjectId = id;
  state.projectCache[id] = state.projectCache[id] || {};
  // 故意不呼叫 setActiveSidebarCase() - 側欄「案件管理」清單反白代表「目前正在那個
  // 案件的 SOP 進度頁面」,這裡是不同的獨立總覽頁,反白側欄項目會讓使用者誤以為
  // 兩個入口其實是同一頁,維持「都更案件進度總覽」這個總覽入口反白就好。
  setActiveNav("dashboard");
  showView("view-project-overview");

  try {
    const project = await api(`/projects/${id}`);
    state.currentProject = project;
    const nameEl = document.getElementById("pov-name");
    const badgeEl = document.getElementById("pov-status-badge");
    const crumbNameEl = document.getElementById("pov-crumb-name");
    if (nameEl) {
      // 案名後面接「編輯案件資料 → 備註」的第一行(例如「地號0578-0000 等 13 筆」)
      const note = (project.description || "").split(/\r?\n/).map((x) => x.trim()).find(Boolean) || "";
      nameEl.innerHTML = `${escapeHtml(project.name)}${note ? `<span class="pov-name-note">${escapeHtml(note)}</span>` : ""}`;
      nameEl.title = `${project.name} (${project.project_code})${note ? `\n${project.description}` : ""}`;
    }
    if (crumbNameEl) crumbNameEl.textContent = project.name;
    _setCrumbCity("pov", project.city);
    if (badgeEl) {
      badgeEl.innerHTML =
        `<span class="status-badge status-${project.status}">${PROJECT_STATUS_LABEL[project.status] || project.status}</span>` +
        (project.is_force_closed ? ` <span class="mini-badge alert">強制結案</span>` : "");
    }
  } catch (e) {
    goToDashboard();
    return;
  }

  const el = document.getElementById("project-overview-content");
  if (el) await renderProjectOverviewTab(el);
}

// 案件管理的分頁頁面(SOP進度/整合清冊等)- 側欄「案件管理」清單、新建案件、OCR匯入
// 完成導回都走這裡。首頁「都更案件進度總覽」的案件卡片改走 goToProjectOverviewPage()
// (獨立的案件總覽頁,不是這個分頁頁面裡的其中一個分頁),兩個入口是真的不同頁面。
async function openProject(id, defaultTab = "sop") {
  state.currentProjectId = id;
  state.projectCache[id] = state.projectCache[id] || {};
  state.sopSelectedStage = null;
  setActiveSidebarCase(id);
  showView("view-project-detail");

  try {
    const project = await api(`/projects/${id}`);
    state.currentProject = project;
    renderProjectHeader(project);
  } catch (e) {
    goToDashboard();
    return;
  }

  // 地主帳號:只保留 SOP 進度 / 土地登記 / 建物登記 / 聯絡紀錄 / 土增稅,其餘分頁隱藏
  const landownerHiddenTabs = ["buildingview", "documents", "encumbrances", "expenses", "members", "development"];
  const initialTab = isLandowner() && landownerHiddenTabs.includes(defaultTab) ? "sop" : defaultTab;
  document.querySelectorAll(".tab-btn[data-tab]").forEach((btn) => {
    const hideForLandowner = isLandowner() && landownerHiddenTabs.includes(btn.dataset.tab);
    btn.classList.toggle("hidden", hideForLandowner);
    btn.classList.toggle("active", btn.dataset.tab === initialTab);
  });
  // 「人員」分頁本身已經在上面的 landownerHiddenTabs 迴圈處理過(只有地主看不到,
  // 其餘 L0~L5 都能看)- 頁籤內能不能新增/移除人員,由 renderMembersTab 自己依
  // isEditor()(L0~L3)決定,L4/L5 進來是唯讀。
  state.activeTab = initialTab;
  // renderTab() 本身現在就會刷新公告卡片,這裡不用再額外呼叫一次。
  await Promise.all([renderTab(state.activeTab), renderSopSummary()]);
}

// 鈴鐺裡 SOP 相關的提醒(見 reminders.js _renderBellDropdown)點下去要直接開到那個
// 案件的 SOP 分頁、並選好對應關卡 —— 不能只是 openProject() 完就好,因為駁回意見可能
// 卡在已經強制完成、案件目前已經走過去的舊關卡,不能只跳去「目前這關」讓人自己找。
async function goToProjectSopStage(pid, stageIdx) {
  await openProject(pid, "sop");
  const stages = state.projectCache[pid]?.sop?.stages || {};
  if (Number.isInteger(stageIdx) && String(stageIdx) in stages) {
    state.sopSelectedStage = stageIdx;
    await renderTab("sop");
  }
}

// 麵包屑的「城市」那一段 - 跟側欄「案件管理」清單同一套依城市分組的邏輯,city 沒填
// (舊資料/測試案件)就整段連分隔線一起藏起來,不留一個空的「›」。
function _setCrumbCity(prefix, city) {
  const cityEl = document.getElementById(`${prefix}-crumb-city`);
  const sepEl = document.getElementById(`${prefix}-crumb-city-sep`);
  if (!cityEl) return;
  const hasCity = !!city;
  cityEl.textContent = city || "";
  cityEl.classList.toggle("hidden", !hasCity);
  sepEl?.classList.toggle("hidden", !hasCity);
}

function renderProjectHeader(p) {
  const nameEl = document.getElementById("pd-name");
  const subEl = document.getElementById("pd-sub");
  const badgeEl = document.getElementById("pd-status-badge");
  const crumbNameEl = document.getElementById("pd-crumb-name");

  if (nameEl) {
    const fullName = `${p.name}${p.description ? ` · ${p.description}` : ""}`;
    nameEl.textContent = fullName;
    // 標題現在強制一行顯示、太長會用「...」截斷(見 style.css .project-header h2)
    // - 補個 title 屬性,滑鼠移上去還是看得到完整名稱。
    nameEl.title = fullName;
  }
  // 麵包屑第三段只放案件名稱(不含案號/備註),太長的完整版留給 h2 標題那行顯示就好。
  if (crumbNameEl) crumbNameEl.textContent = p.name;
  _setCrumbCity("pd", p.city);
  if (subEl) subEl.textContent = [`${p.city || ""}${p.district || ""}`, p.address].filter(Boolean).join(" · ") || "—";
  if (badgeEl) {
    badgeEl.innerHTML =
      `<span class="status-badge status-${p.status}">${PROJECT_STATUS_LABEL[p.status] || p.status}</span>` +
      (p.is_force_closed ? ` <span class="mini-badge alert">強制結案</span>` : "");
  }
}

// 切換分頁列的哪個按鈕反白 + 渲染對應內容 - 一般點分頁列按鈕走這個,
// project_overview.js 的「進入案件管理」連結也是呼叫這個切到 SOP 進度分頁。
async function switchProjectTab(tab) {
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  state.activeTab = tab;
  await renderTab(tab);
}

async function renderTab(tab) {
  const el = document.getElementById("tab-content");
  if (!el) return;
  // 土地登記 / 建物登記已併入「整合清冊」分頁的檢視切換下拉。舊的 "buildings" 進入點
  // (例如建物謄本匯入後)導到整合清冊並預設顯示建物登記檢視。
  if (tab === "buildings") {
    state.integratedViewMode = "building";
    tab = "integrated";
    document.querySelectorAll(".tab-btn[data-tab]").forEach((b) => b.classList.toggle("active", b.dataset.tab === "integrated"));
  }
  // 地主帳號不得進入被隱藏的分頁(即使透過殘留狀態)
  if (isLandowner() && ["buildingview", "documents", "encumbrances", "expenses", "members", "development"].includes(tab)) {
    tab = "sop";
    document.querySelectorAll(".tab-btn[data-tab]").forEach((b) => b.classList.toggle("active", b.dataset.tab === "sop"));
  }
  // 有些呼叫端(例如各分頁自己動作完後 renderTab("expenses") 導回列表)不會先手動
  // 同步 state.activeTab,這裡統一補上,讓它永遠等於實際渲染出來的分頁 - 重整還原
  // 進度(persistCurrentTabState)才讀得到準確值。
  state.activeTab = tab;
  el.innerHTML = `<div class="empty-state">載入中...</div>`;
  const renderers = {
    sop: renderSopTab,
    integrated: renderIntegratedRosterTab,
    buildingview: renderBuildingViewTab,
    contacts: renderContactsTab,
    documents: renderDocumentsTab,
    encumbrances: renderEncumbrancesTab,
    expenses: renderExpensesTab,
    landvaluetax: renderLandValueTaxTab,
    members: renderMembersTab,
    development: renderDevelopmentTab,
  };
  try {
    if (renderers[tab]) {
      await renderers[tab](el);
    }
  } catch (e) {
    console.error(`[renderDashboardTab] tab=${tab} error:`, e);
    const msg = escapeHtml(e && (e.message || String(e))) || "系統連線錯誤";
    el.innerHTML = `<div class="empty-state">載入失敗（${msg}）<br><button type="button" class="btn-secondary btn-sm" style="margin-top:12px" onclick="renderDashboardTab('${tab}')">🔄 點此重新載入</button></div>`;
  }
  // 每次切分頁都順便刷新「公告 / 進度通知」卡片 - 案件裡幾乎每個動作(新增/刪除
  // 支出、上傳文件…)完成後都會呼叫 renderTab() 導回列表,這樣公告卡片才會跟著看到
  // 最新一筆自動紀錄,不用使用者手動整理頁面才看得到。
  renderProjectBoardCard();
  persistCurrentTabState();
}

function initDashboard() {
  const batchSelectAll = document.getElementById("batch-select-all");
  if (batchSelectAll) {
    batchSelectAll.addEventListener("change", (e) => toggleSelectAllProjects(e.target.checked));
  }

  const batchDeleteBtn = document.getElementById("batch-delete-btn");
  if (batchDeleteBtn) {
    batchDeleteBtn.addEventListener("click", openBatchDeleteModal);
  }

  const newProjectBtn = document.getElementById("new-project-btn");
  if (newProjectBtn) {
    newProjectBtn.addEventListener("click", goToNewProject);
  }

  // 建立都更案 is now a modal (see goToNewProject) - its city/district/submit
  // handlers are wired when the modal opens, not here.

  // 麵包屑「首頁」連結(案件管理分頁頁/功能區/使用手冊) - 統一跳去工作看板,跟其他
  // 資源頁(公版文件/新聞/FAQ...)那排 crumb-home 同一套模式跟目的地。
  ["pdet-crumb-home", "pov-crumb-home", "tools-crumb-home", "manual-crumb-home"].forEach((id) => {
    document.getElementById(id)?.addEventListener("click", (e) => {
      e.preventDefault();
      goToMyWork();
    });
  });
  // 麵包屑中間那段(案件管理分頁頁顯示「案件管理」,跟側欄卡片同名;案件總覽頁顯示
  // 「都更案件進度總覽」,跟側欄 nav-link 同名 - 兩邊文字不同,對應各自的入口,但都
  // 是同一份「案件一覽」清單,連結目的地一樣) - 跳去 dashboard 首頁 view-dashboard
  // (原本 goToDashboard() 的落地頁)。
  ["pdet-crumb-cases", "pov-crumb-cases"].forEach((id) => {
    document.getElementById(id)?.addEventListener("click", (e) => {
      e.preventDefault();
      goToDashboard();
    });
  });

  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => switchProjectTab(btn.dataset.tab));
  });
}
