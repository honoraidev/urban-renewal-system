"use strict";

async function renderMembersTab(el) {
  const pid = state.currentProjectId;
  const members = await api(`/projects/${pid}/members`);

  el.innerHTML = `
    <div class="section-toolbar">
      <h3>案件人員 (${members.length})</h3>
      <button class="btn-primary btn-sm" id="add-member-btn">+ 新增人員</button>
    </div>
    ${members.length
      ? `<div class="table-wrap">
            <table>
              <thead><tr><th>帳號</th><th>顯示名稱</th><th>角色</th><th>加入時間</th><th>操作</th></tr></thead>
              <tbody>
                ${members
        .map(
          (m) => `<tr>
                      <td>${escapeHtml(m.username)}</td>
                      <td>${escapeHtml(m.display_name)}</td>
                      <td><span class="role-badge ${m.role_in_project}">${ROLE_LABEL[m.role_in_project] || m.role_in_project}</span></td>
                      <td>${fmtDateTime(m.assigned_at)}</td>
                      <td class="actions-cell">
                        <button class="btn-danger btn-sm" data-remove-member="${m.user_id}">移除</button>
                      </td>
                    </tr>`
        )
        .join("")}
              </tbody>
            </table>
          </div>`
      : `<div class="empty-state">尚未指派任何人員(L1/L2 可以看到所有案件,不需要被指派)</div>`
    }
  `;

  document.getElementById("add-member-btn").addEventListener("click", () => openAddMemberModal(members));
  el.querySelectorAll("[data-remove-member]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("確定要將此人員移出這個案件嗎?")) return;
      try {
        await api(`/projects/${pid}/members/${btn.dataset.removeMember}`, { method: "DELETE" });
        toast("已移除", "success");
        renderTab("members");
      } catch (err) { }
    });
  });
}

async function openAddMemberModal(existingMembers) {
  const pid = state.currentProjectId;
  const allUsers = await api("/users");
  const existingIds = new Set(existingMembers.map((m) => m.user_id));
  const candidates = allUsers.filter((u) => !existingIds.has(u.id));

  const roleCounts = {};
  candidates.forEach((u) => {
    roleCounts[u.role] = (roleCounts[u.role] || 0) + 1;
  });

  const modalHtml = `
    <form id="add-member-form">
      <div class="field">
        <label>選擇權限分層</label>
        <select id="member-role-select" required>
          <option value="">— 請選擇權限分層 —</option>
          <option value="all">全部分層 (共 ${candidates.length} 人可選)</option>
          ${Object.entries(ROLE_LABEL)
      .map(([roleKey, roleName]) => {
        const count = roleCounts[roleKey] || 0;
        return `<option value="${roleKey}">${roleName} (${count} 人可選)</option>`;
      })
      .join("")}
        </select>
      </div>
      <div class="field">
        <label>選擇人員</label>
        <select id="member-user-select" name="user_id" required disabled>
          <option value="">— 請先選擇權限分層 —</option>
        </select>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn-secondary" onclick="closeModal()">取消</button>
        <button type="submit" class="btn-primary" id="add-member-submit-btn" disabled>新增</button>
      </div>
    </form>`;

  openModal("新增案件人員", modalHtml, { width: "460px" });

  const roleSelect = document.getElementById("member-role-select");
  const userSelect = document.getElementById("member-user-select");
  const submitBtn = document.getElementById("add-member-submit-btn");

  roleSelect.addEventListener("change", () => {
    const selectedRole = roleSelect.value;
    userSelect.innerHTML = "";

    if (!selectedRole) {
      userSelect.innerHTML = `<option value="">— 請先選擇權限分層 —</option>`;
      userSelect.disabled = true;
      submitBtn.disabled = true;
      return;
    }

    const filtered = selectedRole === "all"
      ? candidates
      : candidates.filter((u) => u.role === selectedRole);

    if (!filtered.length) {
      userSelect.innerHTML = `<option value="">— 此權限分層尚無可選的使用者 —</option>`;
      userSelect.disabled = true;
      submitBtn.disabled = true;
      return;
    }

    userSelect.innerHTML = `<option value="">— 請選擇使用者 (${filtered.length} 人) —</option>` +
      filtered
        .map((u) => `<option value="${u.id}">${escapeHtml(u.display_name)} (${escapeHtml(u.username)})</option>`)
        .join("");

    userSelect.disabled = false;
    submitBtn.disabled = userSelect.value === "";
  });

  userSelect.addEventListener("change", () => {
    submitBtn.disabled = !userSelect.value;
  });

  document.getElementById("add-member-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const userId = Number(userSelect.value);
    if (!userId) return;
    try {
      await api(`/projects/${pid}/members`, { method: "POST", body: { user_id: userId } });
      closeModal();
      toast("已新增人員", "success");
      renderTab("members");
    } catch (err) { }
  });
}

async function goToUsers() {
  setActiveNav("users");
  showView("view-users");
  await loadUsers();
}

async function loadUsers() {
  const wrap = document.getElementById("users-table-wrap");
  if (!wrap) return;
  wrap.innerHTML = `<div class="empty-state">載入中...</div>`;
  const users = await api("/users");
  const roleLabel = ROLE_LABEL;

  wrap.innerHTML = `
    <table>
      <thead><tr><th>帳號</th><th>顯示名稱</th><th>角色</th><th>Email</th><th>狀態</th><th>操作</th></tr></thead>
      <tbody>
        ${users
      .map(
        (u) => `<tr>
              <td>${escapeHtml(u.username)}</td>
              <td>${escapeHtml(u.display_name)}</td>
              <td><span class="role-badge ${u.role}">${roleLabel[u.role] || u.role}</span></td>
              <td>${escapeHtml(u.email) || "-"}</td>
              <td><span class="mini-badge ${u.is_active ? "gate-ok" : "alert"}">${u.is_active ? "啟用" : "停用"}</span></td>
              <td class="actions-cell">
                <button class="btn-secondary btn-sm" data-edit-user="${u.id}">編輯</button>
                <button class="btn-secondary btn-sm" data-toggle-user="${u.id}" data-active="${u.is_active}">${u.is_active ? "停用" : "啟用"}</button>
                <button class="btn-danger btn-sm" data-delete-user="${u.id}">刪除</button>
              </td>
            </tr>`
      )
      .join("")}
      </tbody>
    </table>`;

  wrap.querySelectorAll("[data-edit-user]").forEach((btn) => {
    btn.addEventListener("click", () => openEditUserModal(users.find((u) => u.id === Number(btn.dataset.editUser))));
  });
  wrap.querySelectorAll("[data-toggle-user]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const isActive = btn.dataset.active === "true";
      try {
        await api(`/users/${btn.dataset.toggleUser}/active`, { method: "PATCH", body: { is_active: !isActive } });
        toast("已更新狀態", "success");
        loadUsers();
      } catch (err) { }
    });
  });
  wrap.querySelectorAll("[data-delete-user]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("確定要刪除此使用者嗎?")) return;
      try {
        await api(`/users/${btn.dataset.deleteUser}`, { method: "DELETE" });
        toast("已刪除", "success");
        loadUsers();
      } catch (err) { }
    });
  });
}

function openEditUserModal(user) {
  if (!user) return;
  openModal(
    "編輯使用者",
    `
    <form id="edit-user-form">
      <div class="field"><label>帳號</label><input value="${escapeHtml(user.username)}" disabled></div>
      <div class="field"><label>顯示名稱</label><input name="display_name" value="${escapeHtml(user.display_name)}" required></div>
      <div class="field"><label>Email</label><input name="email" value="${escapeHtml(user.email) || ""}"></div>
      <div class="field"><label>角色分層</label>
        <select name="role">
          ${Object.entries(ROLE_LABEL)
      .map(([k, v]) => `<option value="${k}" ${user.role === k ? "selected" : ""}>${v}</option>`)
      .join("")}
        </select>
      </div>
      <div class="field"><label>重設密碼 (若不修改請留空)</label><input type="password" name="password" autocomplete="new-password"></div>
      <div class="modal-footer">
        <button type="button" class="btn-secondary" onclick="closeModal()">取消</button>
        <button type="submit" class="btn-primary">儲存</button>
      </div>
    </form>`
  );

  document.getElementById("edit-user-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = {
      display_name: fd.get("display_name"),
      email: fd.get("email") || null,
      role: fd.get("role"),
    };
    const password = fd.get("password");
    if (password) payload.password = password;

    try {
      await api(`/users/${user.id}`, { method: "PATCH", body: payload });
      closeModal();
      toast("使用者已更新", "success");
      loadUsers();
    } catch (err) { }
  });
}

async function goToLoginLogs() {
  setActiveNav("loginlogs");
  showView("view-loginlogs");
  await loadLoginLogs();
}

async function loadLoginLogs() {
  const wrap = document.getElementById("loginlogs-table-wrap");
  if (!wrap) return;
  wrap.innerHTML = `<div class="empty-state">載入中...</div>`;
  const logs = await api("/auth/login-logs");
  const roleLabel = ROLE_LABEL;
  const actionLabel = { login: "登入", logout: "登出" };

  if (!logs.length) {
    wrap.outerHTML = `<div class="empty-state">尚無登入紀錄</div>`;
    return;
  }

  wrap.innerHTML = `
    <table>
      <thead><tr><th>使用者</th><th>角色</th><th>動作</th><th>時間</th><th>IP 位址</th></tr></thead>
      <tbody>
        ${logs
      .map(
        (l) => `<tr>
              <td>${escapeHtml(l.display_name)} <span class="project-code">(${escapeHtml(l.username)})</span></td>
              <td><span class="role-badge ${l.role}">${roleLabel[l.role] || l.role}</span></td>
              <td><span class="consent-status-badge ${l.action === "login" ? "cs-agreed" : "cs-pending"}">${actionLabel[l.action] || l.action}</span></td>
              <td>${fmtDateTime(l.occurred_at)}</td>
              <td>${escapeHtml(l.ip_address) || "-"}</td>
            </tr>`
      )
      .join("")}
      </tbody>
    </table>`;
}

function initMembers() {
  const newMemberBtn = document.getElementById("new-user-btn");
  if (newMemberBtn) {
    newMemberBtn.addEventListener("click", openCreateUserModal);
  }
}

function openCreateUserModal() {
  openModal(
    "新增使用者帳號",
    `
    <form id="create-user-form">
      <div class="field"><label>帳號</label><input name="username" required autocomplete="off"></div>
      <div class="field"><label>密碼</label><input type="password" name="password" required autocomplete="new-password"></div>
      <div class="field"><label>顯示名稱</label><input name="display_name" required autocomplete="off"></div>
      <div class="field"><label>Email</label><input name="email" autocomplete="off"></div>
      <div class="field"><label>角色分層</label>
        <select name="role">
          ${Object.entries(ROLE_LABEL)
      .map(([k, v]) => `<option value="${k}" ${k === "viewer" ? "selected" : ""}>${v}</option>`)
      .join("")}
        </select>
      </div>
      <div class="modal-footer">
        <button type="button" class="btn-secondary" onclick="closeModal()">取消</button>
        <button type="submit" class="btn-primary">建立帳號</button>
      </div>
    </form>`
  );

  document.getElementById("create-user-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const payload = Object.fromEntries(fd.entries());
    try {
      await api("/users", { method: "POST", body: payload });
      closeModal();
      toast("使用者帳號已建立", "success");
      loadUsers();
    } catch (err) { }
  });
}
