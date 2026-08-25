"use strict";

document.addEventListener("DOMContentLoaded", () => {
  initAuth();
  initDashboard();
  initOcrWizard();
  initMembers();
  initResources();

  document.querySelectorAll(".nav-link").forEach((btn) => {
    btn.addEventListener("click", () => {
      closeAvatarDropdown();
      const target = btn.dataset.nav;
      if (target === "dashboard") goToDashboard();
      if (target === "users") goToUsers();
      if (target === "loginlogs") goToLoginLogs();
      if (target === "companydocs") goToCompanyDocs();
      if (target === "regulations") goToRegulations();
      if (target === "websites") goToWebsites();
      if (target === "faq") goToFaq();
    });
  });

  (async function init() {
    if (state.token) {
      try {
        await loadCurrentUser();
        return;
      } catch (e) {
        /* fall through to login */
      }
    }
    document.getElementById("view-login").classList.remove("hidden");
  })();
});
