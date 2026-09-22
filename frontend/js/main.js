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
  };
  sbCollapseBtn?.addEventListener("click", () => applySidebarCollapsed(!sb?.classList.contains("collapsed")));
  let savedSidebarCollapsed = "0";
  try {
    savedSidebarCollapsed = localStorage.getItem("sidebarCollapsed") || "0";
  } catch (e) { }
  applySidebarCollapsed(savedSidebarCollapsed === "1");

  // 側欄「案件管理／工具與資源／系統指南」卡片各自可收合(點標題列),不記憶狀態 -
  // 每次重新整理都是展開的,跟畫面上一開始看到的樣子一致。
  document.querySelectorAll("[data-sb-card-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      btn.closest(".sb-card")?.classList.toggle("sb-card-collapsed");
    });
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
