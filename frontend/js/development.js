"use strict";

// 同意度100%通過、案件結案後的都更後續開發流程(事業計畫核定/權利變換/拆除/開工/
// 交屋這類)- 跟 SOP 是分開的兩件事,完全自訂、沒有預設關卡、沒有自動門檻,純人工
// 按「完成」推進。獨立分頁,排在「人員」右邊(見 index.html 的 tab-btn-development)。

let devFlowEditorState = null; // { names: [string], onSave(names) }

function devFlowEditorRowsHtml() {
  const names = devFlowEditorState.names;
  return names
    .map(
      (name, i) => `
      <div class="sop-flow-row">
        <span class="sop-flow-row-num">${i + 1}</span>
        <input type="text" class="sop-flow-row-name" data-dev-flow-name="${i}" value="${escapeHtml(name || "")}" placeholder="關卡名稱" style="flex:1 1 auto">
        <div class="sop-flow-row-actions">
          <button type="button" class="btn-secondary btn-sm" data-dev-flow-up="${i}" ${i === 0 ? "disabled" : ""} title="上移">↑</button>
          <button type="button" class="btn-secondary btn-sm" data-dev-flow-down="${i}" ${i === names.length - 1 ? "disabled" : ""} title="下移">↓</button>
          <button type="button" class="btn-danger btn-sm" data-dev-flow-remove="${i}" title="刪除">✕</button>
        </div>
      </div>`
    )
    .join("");
}

function rerenderDevFlowEditor() {
  const rowsEl = document.getElementById("dev-flow-rows");
  if (rowsEl) rowsEl.innerHTML = devFlowEditorRowsHtml();
  wireDevFlowEditorRows();
}

function wireDevFlowEditorRows() {
  const root = document.getElementById("modal-root");
  root.querySelectorAll("[data-dev-flow-name]").forEach((input) => {
    input.oninput = () => {
      devFlowEditorState.names[Number(input.dataset.devFlowName)] = input.value;
    };
  });
  root.querySelectorAll("[data-dev-flow-up]").forEach((btn) => {
    btn.onclick = () => {
      const i = Number(btn.dataset.devFlowUp);
      const arr = devFlowEditorState.names;
      if (i > 0) {
        [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
        rerenderDevFlowEditor();
      }
    };
  });
  root.querySelectorAll("[data-dev-flow-down]").forEach((btn) => {
    btn.onclick = () => {
      const i = Number(btn.dataset.devFlowDown);
      const arr = devFlowEditorState.names;
      if (i < arr.length - 1) {
        [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]];
        rerenderDevFlowEditor();
      }
    };
  });
  root.querySelectorAll("[data-dev-flow-remove]").forEach((btn) => {
    btn.onclick = () => {
      devFlowEditorState.names.splice(Number(btn.dataset.devFlowRemove), 1);
      rerenderDevFlowEditor();
    };
  });
}

function openDevelopmentFlowEditor(initialNames, onSave) {
  devFlowEditorState = { names: initialNames && initialNames.length ? [...initialNames] : [""], onSave };
  openModal(
    "自訂開發流程",
    `
    <div class="sop-flow-editor">
      <p class="helper-text">案件結案後的後續開發關卡,完全自訂、沒有預設值,純人工按「完成」推進。</p>
      <div class="sop-flow-rows" id="dev-flow-rows">${devFlowEditorRowsHtml()}</div>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button type="button" class="btn-secondary btn-sm" id="dev-flow-add-btn">+ 新增關卡</button>
      </div>
      <div class="modal-footer" style="margin-top:20px">
        <button type="button" class="btn-primary" id="dev-flow-save-btn">儲存</button>
      </div>
    </div>`,
    { width: "560px" }
  );
  wireDevFlowEditorRows();

  document.getElementById("dev-flow-add-btn").onclick = () => {
    devFlowEditorState.names.push("");
    rerenderDevFlowEditor();
  };
  document.getElementById("dev-flow-save-btn").onclick = async () => {
    const names = devFlowEditorState.names.map((n) => (n || "").trim()).filter(Boolean);
    if (!names.length) {
      toast("至少要有一關", "error");
      return;
    }
    const saveBtn = document.getElementById("dev-flow-save-btn");
    saveBtn.disabled = true;
    try {
      await devFlowEditorState.onSave(names);
    } catch (err) {
      saveBtn.disabled = false;
    }
  };
}

async function renderDevelopmentTab(container) {
  const pid = state.currentProjectId;
  let dev;
  try {
    dev = await api(`/projects/${pid}/development`, { silent: true });
  } catch (err) {
    container.innerHTML = `<div class="empty-state">載入失敗</div>`;
    return;
  }

  const stageKeys = Object.keys(dev.stages).sort((a, b) => Number(a) - Number(b));
  const hasStages = stageKeys.length > 0;
  const flowStarted =
    dev.current_stage !== 0 || stageKeys.some((k) => (dev.stages[k].status || "pending") !== "pending");
  const canEditFlow = isManager() && !flowStarted;
  const canAct = isEditor();
  const doneCount = stageKeys.filter((k) => dev.stages[k].status === "completed").length;

  const rowsHtml = hasStages
    ? stageKeys
        .map((k) => {
          const s = dev.stages[k];
          const isDone = s.status === "completed";
          const isCurrent = Number(k) === dev.current_stage;
          const icon = isDone ? "✓" : isCurrent ? "▶" : "○";
          const cls = isDone ? "done" : isCurrent ? "current" : "locked";
          const canReopen = isDone && Number(k) === dev.current_stage - 1;
          const statusText = isDone
            ? `✓ 已完成${s.completed_at ? "・" + fmtDateTime(s.completed_at) : ""}`
            : isCurrent
              ? "▶ 進行中"
              : "尚未開始";
          return `
          <div class="dev-flow-row ${cls}">
            <span class="dev-flow-icon">${icon}</span>
            <div class="dev-flow-main">
              <div class="dev-flow-name">第${Number(k) + 1}關・${escapeHtml(s.name)}</div>
              <div class="dev-flow-status">${statusText}</div>
            </div>
            ${isCurrent && canAct ? `<button type="button" class="btn-primary btn-sm" data-dev-complete="${k}">完成本關卡</button>` : ""}
            ${canReopen && canAct ? `<button type="button" class="btn-secondary btn-sm" data-dev-reopen="${k}">取消完成</button>` : ""}
          </div>`;
        })
        .join("")
    : `<div class="empty-state">尚未建立流程${canEditFlow ? ",按右上角「建立流程」開始設定" : ",請洽案件負責人(L2以上)建立"}</div>`;

  container.innerHTML = `
    <div class="section-toolbar">
      <h3>開發流程${hasStages ? ` (${doneCount}/${stageKeys.length})` : ""}</h3>
      ${canEditFlow ? `<button type="button" class="btn-secondary btn-sm" id="dev-flow-edit-btn">⚙ ${hasStages ? "編輯" : "建立"}流程</button>` : ""}
    </div>
    <p class="helper-text">案件同意度100%通過、SOP 結案之後的都更後續開發關卡(事業計畫核定/權利變換/拆除/開工/交屋這類),跟 SOP 進度是分開追蹤的兩件事。</p>
    <div class="card dev-flow-panel">
      <div class="dev-flow-rows">${rowsHtml}</div>
    </div>`;

  const editBtn = document.getElementById("dev-flow-edit-btn");
  if (editBtn) {
    editBtn.addEventListener("click", () => {
      const names = stageKeys.map((k) => dev.stages[k].name);
      openDevelopmentFlowEditor(names, async (newNames) => {
        await api(`/projects/${pid}/development/stages`, {
          method: "PUT",
          body: { stages: newNames.map((n) => ({ name: n })) },
        });
        toast("開發流程已更新", "success");
        closeModal();
        renderDevelopmentTab(container);
      });
    });
  }

  container.querySelectorAll("[data-dev-complete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await api(`/projects/${pid}/development/${btn.dataset.devComplete}/complete`, { method: "POST", body: {} });
        toast("已完成", "success");
        renderDevelopmentTab(container);
      } catch (err) { }
    });
  });
  container.querySelectorAll("[data-dev-reopen]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await api(`/projects/${pid}/development/${btn.dataset.devReopen}/reopen`, { method: "POST" });
        toast("已取消完成", "success");
        renderDevelopmentTab(container);
      } catch (err) { }
    });
  });
}
