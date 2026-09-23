"use strict";

function bootstrapApp() {
  initAuth();
  initReminders();
  initDashboard();
  initMyWork();
  initOcrWizard();
  initMembers();
  initResources();
  initInventory();

  // 手機版側欄抽屜 (☰) - 桌機沒有 #sb-toggle 就不動作
  const sb = document.querySelector(".sb");
  const sbToggle = document.getElementById("sb-toggle");
  const sbBackdrop = document.getElementById("sb-backdrop");
  const setSidebar = (open) => {
    sb?.classList.toggle("sb-open", open);
    sbBackdrop?.classList.toggle("show", open);
    sbToggle?.setAttribute("aria-expanded", open ? "true" : "false");
  };
  sbToggle?.addEventListener("click", () => setSidebar(!sb.classList.contains("sb-open")));
  sbBackdrop?.addEventListener("click", () => setSidebar(false));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && sb?.classList.contains("sb-open")) setSidebar(false);
  });
  // 點側欄任何項目後自動收起抽屜
  sb?.addEventListener("click", (e) => {
    if (e.target.closest(".nav-link, .sb-case-item, .avatar-dropdown-item")) setSidebar(false);
  });

  // 桌機版側邊欄收合成圖示小標,用 localStorage 記住上次收合的狀態,重新整理/下次
  // 登入還是維持一樣的收合狀態。手機版走上面的抽屜(.sb-open),兩套互不影響。
  const sbCollapseBtn = document.getElementById("sb-collapse-btn");
  const applySidebarCollapsed = (collapsed) => {
    sb?.classList.toggle("collapsed", collapsed);
    const label = collapsed ? "展開側邊欄" : "收合側邊欄";
    sbCollapseBtn?.setAttribute("aria-label", label);
    sbCollapseBtn?.setAttribute("title", label);
    try {
      localStorage.setItem("sidebarCollapsed", collapsed ? "1" : "0");
    } catch (e) { }
    // 案件清單(#sb-cases)裡每個城市分組是否展開,是在 renderSidebarProjects() 畫
    // HTML 的當下就決定的,不會因為之後切換 .collapsed 自動重畫。收合狀態下城市
    // 分組要強制全部展開(見 renderSidebarProjects 的 forceOpen),不然使用者在展開
    // 側邊欄時手動收合過的城市,收合成圖示列後會卡在看不到案件、也點不了標題列
    // 展開的狀態 - 這裡切換的當下就重畫一次,不用等下次 loadDashboard()。
    if (typeof renderSidebarProjects === "function" && typeof dashboardProjectsById === "object") {
      renderSidebarProjects(Object.values(dashboardProjectsById));
    }
  };
  sbCollapseBtn?.addEventListener("click", () => applySidebarCollapsed(!sb?.classList.contains("collapsed")));
  let savedSidebarCollapsed = "0";
  try {
    savedSidebarCollapsed = localStorage.getItem("sidebarCollapsed") || "0";
  } catch (e) { }
  applySidebarCollapsed(savedSidebarCollapsed === "1");

  // 整個側邊欄收合成圖示列時,案件管理／工具與資源／系統指南底下的子項目本來就被
  // 強制隱藏(見 style.css `.sb.collapsed .sb-card-body`)。點圖示不展開整條側邊欄,
  // 而是在圖示旁邊彈出一個浮窗顯示子項目(不佔用主畫面寬度,點別處/Esc/選了項目
  // 就關掉),跟頭像選單那類浮動選單同樣模式。
  //
  // .sb-card-body 不能直接在原地用 position:fixed 定位 —— .sb 本身有
  // backdrop-filter(見 .sb 規則),CSS 規範裡 filter/backdrop-filter 的祖先會幫底下
  // position:fixed 的子孫另建一個「包含區塊」,子孫的 fixed 定位會被限制在那個祖先
  // 的方框裡、被它的 overflow 裁切掉 —— 踩過這個坑:硬套 !important position:fixed
  // 還是被收合後只剩 56px 寬、overflow-x:hidden 的 .sb 裁到只剩一條看不到的縫。
  // 真正的解法是把這個節點直接「搬」到 document.body 下面(不是複製一份 - 複製會把
  // 案件清單/子選單原本綁好的 click 監聽器弄丟),徹底脫離 .sb 這個包含區塊;關閉時
  // 再搬回原本的 .sb-card 裡面,版面照舊。
  let openCardFlyoutCard = null;
  let openCardFlyoutBody = null;
  const closeCardFlyout = () => {
    if (!openCardFlyoutBody) return;
    openCardFlyoutBody.classList.remove("sb-flyout-panel");
    openCardFlyoutBody.style.removeProperty("top");
    openCardFlyoutBody.style.removeProperty("left");
    openCardFlyoutCard?.appendChild(openCardFlyoutBody);
    openCardFlyoutCard = null;
    openCardFlyoutBody = null;
  };
  document.addEventListener("click", (e) => {
    if (openCardFlyoutBody && !e.target.closest(".sb-flyout-panel") && !e.target.closest("[data-sb-card-toggle]")) {
      closeCardFlyout();
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && openCardFlyoutBody) closeCardFlyout();
  });
  window.addEventListener("scroll", () => { if (openCardFlyoutBody) closeCardFlyout(); }, true);

  // 側欄「案件管理／工具與資源／系統指南」卡片各自可收合(點標題列),不記憶狀態 -
  // 每次重新整理都是展開的,跟畫面上一開始看到的樣子一致。
  document.querySelectorAll("[data-sb-card-toggle]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const card = btn.closest(".sb-card");
      if (sb?.classList.contains("collapsed")) {
        e.stopPropagation();
        const wasOpenForThis = openCardFlyoutCard === card;
        closeCardFlyout();
        if (wasOpenForThis) return; // 再點一次同一顆 = 關閉
        const body = card?.querySelector(".sb-card-body");
        if (!body || !card) return;
        document.body.appendChild(body);
        body.classList.add("sb-flyout-panel");
        const r = btn.getBoundingClientRect();
        body.style.left = `${r.right + 8}px`;
        body.style.top = `${r.top}px`;
        // offsetHeight 要等上面那行套用完 position:fixed 才量得準 - 讀取本身會
        // 強制瀏覽器立即reflow,不用另外等下一輪事件循環。
        body.style.top = `${Math.min(r.top, window.innerHeight - body.offsetHeight - 12)}px`;
        openCardFlyoutCard = card;
        openCardFlyoutBody = body;
        return;
      }
      card?.classList.toggle("sb-card-collapsed");
    });
  });
  // 浮窗裡點了任一項目(案件/工具與資源子項目)就收起浮窗
  document.addEventListener("click", (e) => {
    if (openCardFlyoutBody && e.target.closest(".sb-flyout-panel .nav-link, .sb-flyout-panel .sb-case-item")) {
      closeCardFlyout();
    }
  });

  document.querySelectorAll(".nav-link").forEach((btn) => {
    btn.addEventListener("click", () => {
      closeAvatarDropdown();
      const target = btn.dataset.nav;
      if (target === "mywork") goToMyWork();
      if (target === "dashboard") goToDashboard();
      if (target === "tools") goToTools();
      if (target === "manual") goToManual();
      if (target === "users") goToUsers();
      if (target === "loginlogs") goToLoginLogs();
      if (target === "companydocs") goToCompanyDocs();
      if (target === "news") goToNews();
      if (target === "regulations") goToRegulations();
      if (target === "websites") goToWebsites();
      if (target === "faq") goToFaq();
      if (target === "inventory") goToInventory();
    });
  });

  // 功能區卡片的「立即使用」——原本是彈出一長串使用說明的 modal,改成直接跳轉到
  // 該功能實際所在的案件分頁,少一層「看完說明還要自己再找路」的步驟。這幾個功能
  // 都是綁在「某個案件」底下操作的(不是脫離案件的獨立工具),所以要先有已選定的
  // 案件(state.currentProjectId,通常是最近一次從側欄點進去的那個案件)才跳得過去
  // ——沒有的話就導去「案件一覽」讓使用者先選一個案件。
  function goToProjectTool(tab, opts = {}) {
    if (!state.currentProjectId) {
      toast("請先從左側「案件管理」點選一個案件,才能使用這個功能", "error");
      goToDashboard();
      return;
    }
    if (opts.sopStage != null) state.sopSelectedStage = opts.sopStage;
    openProject(state.currentProjectId, tab).then(() => {
      if (opts.sopStage != null) {
        state.sopSelectedStage = opts.sopStage;
        switchProjectTab("sop");
      }
    });
  }

  const rosterBtn = document.getElementById("btn-run-roster");
  if (rosterBtn) {
    // 清冊製作:相關操作(確認地主清冊正確 →產生Excel)都在 SOP 第1關「籌備階段」。
    rosterBtn.addEventListener("click", () => goToProjectTool("sop", { sopStage: 1 }));
  }

  const invoiceBtn = document.getElementById("btn-run-invoice");
  if (invoiceBtn) {
    // 發票掃描:「記錄支出」表單裡的「📷 掃描發票」按鈕,在「費用」分頁。
    invoiceBtn.addEventListener("click", () => goToProjectTool("expenses"));
  }

  const taxBtn = document.getElementById("btn-run-tax");
  if (taxBtn) {
    taxBtn.addEventListener("click", () => goToProjectTool("landvaluetax"));
  }

  (async function init() {
    if (state.token) {
      try {
        await loadCurrentUser();
        return;
      } catch (e) {
        /* fall through to login */
      }
    }
    const loginView = document.getElementById("view-login");
    if (loginView) loginView.classList.remove("hidden");
  })();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrapApp);
} else {
  bootstrapApp();
}
