"use strict";

const SUN_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/></svg>`;
const MOON_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>`;

function getEffectiveTheme() {
  const stored = localStorage.getItem("theme");
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function renderThemeToggle() {
  const btn = document.getElementById("theme-toggle-btn");
  if (!btn) return;
  btn.innerHTML = getEffectiveTheme() === "dark" ? SUN_ICON : MOON_ICON;
}

function applyTheme(theme) {
  document.documentElement.setAttribute("data-theme", theme);
  localStorage.setItem("theme", theme);
  renderThemeToggle();
}

async function doLogin(username, password) {
  const data = await api("/auth/login", { method: "POST", body: { username, password } });
  state.token = data.access_token;
  sessionStorage.setItem("token", state.token);
  await loadCurrentUser();
}

async function loadCurrentUser() {
  const user = await api("/auth/me");
  state.user = user;
  renderNavUser();
  showApp();
  goToDashboard();
}

let loggingOut = false;

async function doLogout() {
  if (loggingOut) return;
  loggingOut = true;
  try {
    if (state.token) {
      await api("/auth/logout", { method: "POST", silent: true });
    }
  } catch (err) {
    /* still log out client-side even if the server call fails */
  }
  state.token = null;
  state.user = null;
  state.currentProjectId = null;
  state.projectCache = {};
  sessionStorage.removeItem("token");
  document.getElementById("app").classList.add("hidden");
  document.getElementById("view-login").classList.remove("hidden");
  loggingOut = false;
}

function showApp() {
  document.getElementById("view-login").classList.add("hidden");
  document.getElementById("app").classList.remove("hidden");
  document.getElementById("nav-users-btn").classList.toggle("hidden", !isSystemAdmin());
  document.getElementById("nav-loginlogs-btn").classList.toggle("hidden", !isSystemAdmin());
  document.getElementById("new-project-btn").classList.toggle("hidden", !canCreateProject());
}

function renderNavUser() {
  document.getElementById("dropdown-user-name").textContent = state.user.display_name;
  document.getElementById("avatar-btn").textContent = (state.user.display_name || "?").trim().charAt(0).toUpperCase();
  const roleLabel = ROLE_LABEL[state.user.role] || state.user.role;
  const badge = document.getElementById("nav-user-role");
  badge.textContent = roleLabel;
  badge.className = "role-badge " + state.user.role;
}

function closeAvatarDropdown() {
  const dropdown = document.getElementById("avatar-dropdown");
  if (dropdown) dropdown.classList.add("hidden");
  const avatarBtn = document.getElementById("avatar-btn");
  if (avatarBtn) avatarBtn.setAttribute("aria-expanded", "false");
}

function initAuth() {
  renderThemeToggle();
  const themeBtn = document.getElementById("theme-toggle-btn");
  if (themeBtn) {
    themeBtn.addEventListener("click", () => {
      applyTheme(getEffectiveTheme() === "dark" ? "light" : "dark");
    });
  }

  const avatarBtn = document.getElementById("avatar-btn");
  if (avatarBtn) {
    avatarBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const dropdown = document.getElementById("avatar-dropdown");
      const isOpen = !dropdown.classList.contains("hidden");
      dropdown.classList.toggle("hidden", isOpen);
      avatarBtn.setAttribute("aria-expanded", String(!isOpen));
    });
  }

  const dropdown = document.getElementById("avatar-dropdown");
  if (dropdown) dropdown.addEventListener("click", (e) => e.stopPropagation());
  document.addEventListener("click", closeAvatarDropdown);

  const loginForm = document.getElementById("login-form");
  if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const username = document.getElementById("login-username").value.trim();
      const password = document.getElementById("login-password").value;
      const btn = e.target.querySelector("button");
      btn.disabled = true;
      try {
        await doLogin(username, password);
      } catch (err) {
        /* toast already shown by api() */
      } finally {
        btn.disabled = false;
      }
    });
  }

  const logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      closeAvatarDropdown();
      doLogout();
    });
  }
}
