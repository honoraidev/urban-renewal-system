"use strict";

async function renderExpensesTab(el) {
  const pid = state.currentProjectId;
  const [expenses, summary, categories] = await Promise.all([
    api(`/projects/${pid}/expenses`),
    api(`/projects/${pid}/expenses/summary`),
    api(`/expense-categories`),
  ]);
  state.projectCache[pid].categories = categories;
  const catById = Object.fromEntries(categories.map((c) => [c.id, c.name]));

  el.innerHTML = `
    <div class="card" style="margin-bottom:16px">
      <h3 style="margin-top:0">支出統計</h3>
      <div style="font-size: 23.5px;font-weight:700;margin-bottom:10px">NT$ ${fmtMoney(summary.total_amount)}</div>
      ${summary.by_category
      .map(
        (c) => `
        <div class="card-meta-row" style="margin-bottom:4px">
          <span>${escapeHtml(c.category_name) || "未分類"}</span><span>NT$ ${fmtMoney(c.total_amount)}</span>
        </div>`
      )
      .join("")}
    </div>
    <div class="section-toolbar">
      <h3>支出明細 (${expenses.length})</h3>
      <div style="display:flex;gap:10px">
        ${isManager() ? `<button class="btn-secondary btn-sm" id="manage-categories-btn">管理類別</button>` : ""}
        ${isEditor() ? `<button class="btn-primary btn-sm" id="add-expense-btn">+ 新增支出</button>` : ""}
      </div>
    </div>
    ${expenses.length
      ? `<div class="table-wrap">
            <table>
              <thead><tr><th>日期</th><th>類別</th><th>金額</th><th>廠商</th><th>說明</th>${isEditor() ? "<th>操作</th>" : ""}</tr></thead>
              <tbody>
                ${expenses
        .map(
          (ex) => `<tr>
                      <td>${fmtDate(ex.expense_date)}</td>
                      <td>${escapeHtml(catById[ex.category_id]) || "-"}</td>
                      <td>NT$ ${fmtMoney(ex.amount)}</td>
                      <td>${escapeHtml(ex.vendor) || "-"}</td>
                      <td>${escapeHtml(ex.description) || "-"}</td>
                      ${isEditor()
              ? `<td class="actions-cell">
                              <button class="btn-danger btn-sm" data-delete-expense="${ex.id}">刪除</button>
                            </td>`
              : ""
            }
                    </tr>`
        )
        .join("")}
              </tbody>
            </table>
          </div>`
      : `<div class="empty-state">尚無支出紀錄</div>`
    }
  `;

  el.querySelectorAll("[data-delete-expense]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("確定要刪除此筆支出嗎?")) return;
      try {
        await api(`/projects/${pid}/expenses/${btn.dataset.deleteExpense}`, { method: "DELETE" });
        toast("已刪除", "success");
        renderTab("expenses");
      } catch (err) { }
    });
  });
  const addBtn = document.getElementById("add-expense-btn");
  if (addBtn) addBtn.addEventListener("click", () => openAddExpenseModal(categories));
  const manageBtn = document.getElementById("manage-categories-btn");
  if (manageBtn) manageBtn.addEventListener("click", () => openManageCategoriesModal(categories));
}

function openAddExpenseModal(categories) {
  openModal(
    "新增支出",
    `
    <form id="expense-form">
      <div class="field-row">
        <div class="field"><label>日期</label><input type="date" name="expense_date" value="${new Date().toISOString().slice(0, 10)}" required></div>
        <div class="field"><label>金額</label><input type="number" name="amount" step="0.01" required></div>
      </div>
      <div class="field-row">
        <div class="field"><label>類別</label>
          <select name="category_id">
            <option value="">— 未分類 —</option>
            ${categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("")}
          </select>
        </div>
        <div class="field"><label>廠商</label><input name="vendor"></div>
      </div>
      <div class="field"><label>說明</label><textarea name="description" rows="2"></textarea></div>
      <div class="modal-footer">
        <button type="button" class="btn-secondary" onclick="closeModal()">取消</button>
        <button type="submit" class="btn-primary">新增</button>
      </div>
    </form>`
  );
  document.getElementById("expense-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = Object.fromEntries(fd.entries());
    const payload = {
      category_id: data.category_id ? Number(data.category_id) : null,
      amount: Number(data.amount),
      expense_date: data.expense_date,
      vendor: data.vendor || null,
      description: data.description || null,
    };
    try {
      await api(`/projects/${state.currentProjectId}/expenses`, { method: "POST", body: payload });
      closeModal();
      toast("支出已新增", "success");
      renderTab("expenses");
    } catch (err) { }
  });
}

function openManageCategoriesModal(categories) {
  function renderList(cats) {
    return cats
      .map(
        (c) => `<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)">
          <span>${escapeHtml(c.name)} ${!c.is_active ? '<span class="mini-badge">已停用</span>' : ""}</span>
          <div class="actions-cell">
            <button class="btn-secondary btn-sm" data-toggle-cat="${c.id}" data-active="${c.is_active}">${c.is_active ? "停用" : "啟用"}</button>
            <button class="btn-danger btn-sm" data-delete-cat="${c.id}">刪除</button>
          </div>
        </div>`
      )
      .join("");
  }

  openModal(
    "管理費用類別",
    `
    <div id="category-list">${renderList(categories)}</div>
    <form id="new-category-form" style="margin-top:16px;display:flex;gap:8px">
      <input name="name" placeholder="新增類別名稱" required style="flex:1">
      <button type="submit" class="btn-primary btn-sm">新增</button>
    </form>
    `
  );

  async function refresh() {
    const cats = await api(`/expense-categories`);
    document.getElementById("category-list").innerHTML = renderList(cats);
    wireButtons();
  }

  function wireButtons() {
    document.querySelectorAll("[data-toggle-cat]").forEach((btn) => {
      btn.onclick = async () => {
        const isActive = btn.dataset.active === "true";
        try {
          await api(`/expense-categories/${btn.dataset.toggleCat}`, { method: "PATCH", body: { is_active: !isActive } });
          await refresh();
        } catch (err) { }
      };
    });
    document.querySelectorAll("[data-delete-cat]").forEach((btn) => {
      btn.onclick = async () => {
        if (!confirm("確定要刪除此類別嗎?")) return;
        try {
          await api(`/expense-categories/${btn.dataset.deleteCat}`, { method: "DELETE" });
          await refresh();
        } catch (err) { }
      };
    });
  }
  wireButtons();

  document.getElementById("new-category-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      await api(`/expense-categories`, { method: "POST", body: { name: fd.get("name") } });
      e.target.reset();
      await refresh();
    } catch (err) { }
  });
}
