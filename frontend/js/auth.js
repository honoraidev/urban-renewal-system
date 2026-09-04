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

const LOGIN_ERROR_MESSAGES = {
  user_not_found: "查無此帳號,請確認帳號是否正確",
  wrong_password: "密碼錯誤,請重新輸入",
  account_deactivated: "此帳號已被停用,請聯繫系統管理員",
};

async function doLogin(username, password) {
  const data = await api("/auth/login", { method: "POST", body: { username, password }, silent: true });
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

const DEFAULT_AVATAR_SVG =
  `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;

function avatarInnerHtml(avatar) {
  return avatar
    ? `<img src="${avatar}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;display:block">`
    : DEFAULT_AVATAR_SVG;
}

// 讀檔 → 置中裁切縮到 size×size 的 JPEG data URI(壓小體積再存)
function fileToAvatarDataUrl(file, size = 128) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) return reject(new Error("請選擇圖片檔"));
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("讀取圖片失敗"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("圖片格式不支援"));
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = c.height = size;
        const ctx = c.getContext("2d");
        const s = Math.min(img.width, img.height);
        ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
        resolve(c.toDataURL("image/jpeg", 0.85));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function renderNavUser() {
  document.getElementById("dropdown-user-name").textContent = state.user.display_name;
  const nameEl = document.getElementById("nav-user-name");
  if (nameEl) nameEl.textContent = state.user.display_name;
  document.getElementById("avatar-btn").innerHTML = avatarInnerHtml(state.user.avatar);
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

  const profileBtn = document.getElementById("nav-profile-btn");
  if (profileBtn) {
    profileBtn.addEventListener("click", () => {
      closeAvatarDropdown();
      openEditProfileModal();
    });
  }

  const loginForm = document.getElementById("login-form");
  if (loginForm) {
    loginForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const username = document.getElementById("login-username").value.trim();
      const password = document.getElementById("login-password").value;
      const btn = e.target.querySelector("button");
      const errEl = document.getElementById("login-error");
      if (errEl) errEl.classList.add("hidden");
      if (!username || !password) {
        if (errEl) {
          errEl.textContent = "請輸入帳號與密碼";
          errEl.classList.remove("hidden");
        }
        return;
      }
      if (btn) btn.disabled = true;
      try {
        await doLogin(username, password);
      } catch (err) {
        const msg = LOGIN_ERROR_MESSAGES[err && err.message] || "登入失敗,請稍後再試";
        if (errEl) {
          errEl.textContent = msg;
          errEl.classList.remove("hidden");
        } else {
          toast(msg, "error");
        }
      } finally {
        if (btn) btn.disabled = false;
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

function openEditProfileModal() {
  const u = state.user || {};
  openModal(
    "編輯個人資料",
    `
    <form id="profile-form">
      <div class="field">
        <label>頭像</label>
        <div style="display:flex;align-items:center;gap:16px">
          <div id="pf-avatar-preview" style="width:64px;height:64px;border-radius:50%;flex:none;background:linear-gradient(135deg,var(--brand),var(--brand-dark));color:#fff;display:flex;align-items:center;justify-content:center;overflow:hidden">${avatarInnerHtml(u.avatar)}</div>
          <div style="flex:1;min-width:0">
            <label style="margin-bottom:4px">帳號</label>
            <input value="${escapeHtml(u.username) || ""}" disabled style="background:var(--bg-subtle);margin-bottom:8px">
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button type="button" class="btn-secondary btn-sm" id="pf-avatar-pick">選擇圖片</button>
              <button type="button" class="btn-link btn-sm" id="pf-avatar-clear" ${u.avatar ? "" : "style=\"display:none\""}>移除頭像</button>
            </div>
          </div>
          <input type="file" id="pf-avatar-file" accept="image/*" style="display:none">
        </div>
      </div>
      <div class="field"><label>顯示名稱</label><input name="display_name" value="${escapeHtml(u.display_name) || ""}" required></div>
      <div class="field-row">
        <div class="field"><label>Email</label><input type="email" name="email" value="${escapeHtml(u.email) || ""}" placeholder="選填"></div>
        <div class="field"><label>電話</label><input name="phone" value="${escapeHtml(u.phone) || ""}" placeholder="選填"></div>
      </div>
      <div style="border-top:1px solid var(--border);margin:14px 0 6px;padding-top:12px">
        <label for="pf-pw-toggle" style="display:inline-flex;align-items:center;gap:8px;font-weight:700;cursor:pointer;margin:0">
          <input type="checkbox" id="pf-pw-toggle" style="width:17px;height:17px;flex:none;margin:0;accent-color:var(--brand);cursor:pointer">
          <span>變更密碼</span>
        </label>
        <div id="pf-pw-fields" class="hidden" style="margin-top:10px">
          <div class="field"><label>目前密碼</label><input type="password" name="current_password" autocomplete="current-password"></div>
          <div class="field-row">
            <div class="field"><label>新密碼</label><input type="password" name="new_password" autocomplete="new-password"></div>
            <div class="field"><label>確認新密碼</label><input type="password" name="new_password_confirm" autocomplete="new-password"></div>
          </div>
        </div>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn-secondary" onclick="closeModal()">取消</button>
        <button type="submit" class="btn-primary">儲存</button>
      </div>
    </form>`
  );

  const pwToggle = document.getElementById("pf-pw-toggle");
  const pwFields = document.getElementById("pf-pw-fields");
  pwToggle.addEventListener("change", () => pwFields.classList.toggle("hidden", !pwToggle.checked));

  // 頭像:avatarChange === undefined 表示不變;null 表示移除;字串表示新圖
  let avatarChange;
  const avPreview = document.getElementById("pf-avatar-preview");
  const avFile = document.getElementById("pf-avatar-file");
  const avClear = document.getElementById("pf-avatar-clear");
  document.getElementById("pf-avatar-pick").addEventListener("click", () => avFile.click());
  avFile.addEventListener("change", async () => {
    const f = avFile.files && avFile.files[0];
    if (!f) return;
    try {
      const dataUrl = await fileToAvatarDataUrl(f);
      avatarChange = dataUrl;
      avPreview.innerHTML = avatarInnerHtml(dataUrl);
      avClear.style.display = "";
    } catch (e) {
      toast(e.message || "圖片處理失敗", "error");
    }
    avFile.value = "";
  });
  avClear.addEventListener("click", () => {
    avatarChange = null;
    avPreview.innerHTML = avatarInnerHtml(null);
    avClear.style.display = "none";
  });

  document.getElementById("profile-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const d = Object.fromEntries(fd.entries());
    const payload = {
      display_name: d.display_name,
      email: d.email || null,
      phone: d.phone || null,
    };
    if (avatarChange !== undefined) payload.avatar = avatarChange === null ? "" : avatarChange;
    if (pwToggle.checked) {
      if (!d.new_password) {
        toast("請輸入新密碼", "error");
        return;
      }
      if (d.new_password !== d.new_password_confirm) {
        toast("兩次輸入的新密碼不一致", "error");
        return;
      }
      payload.current_password = d.current_password || "";
      payload.new_password = d.new_password;
    }
    try {
      const updated = await api("/auth/me", { method: "PATCH", body: payload });
      state.user = { ...state.user, ...updated };
      renderNavUser();
      closeModal();
      toast(pwToggle.checked ? "個人資料與密碼已更新" : "個人資料已更新", "success");
    } catch (err) {
      /* api() 已 toast 錯誤訊息 */
    }
  });
}
