"use strict";

// 同意度100%通過、案件結案後的都更後續開發流程(事業計畫核定/權利變換/拆除/開工/
// 交屋這類)- 跟 SOP 是分開的兩件事,預設帶入固定的 6 關(見後端
// DEFAULT_DEVELOPMENT_STAGES)。階段名稱/順序可編輯(「⚙ 編輯流程」按鈕,跟 SOP 頁
// 的「自訂關卡流程」是同一套 UI 模式,只是資料各自獨立),流程一開始跑就鎖住不能再
// 調整。獨立分頁,排在「人員」右邊(見 index.html 的 tab-btn-development)。

const DEV_STAGE_ICONS = ["📋", "📜", "🏗", "📝", "🏢", "🏠"];

async function renderDevelopmentTab(container) {
  const pid = state.currentProjectId;
  let dev, sop, allDocs;
  try {
    [dev, sop, allDocs] = await Promise.all([
      api(`/projects/${pid}/development`, { silent: true }),
      api(`/projects/${pid}/sop`, { silent: true }),
      api(`/projects/${pid}/documents`, { silent: true }).catch(() => []),
    ]);
  } catch (err) {
    container.innerHTML = `<div class="empty-state">載入失敗</div>`;
    return;
  }

  const stageKeys = Object.keys(dev.stages).sort((a, b) => Number(a) - Number(b));
  const hasStages = stageKeys.length > 0;
  const canAct = isEditor();
  const sopDone = sop.final && sop.final.status !== "pending";
  // SOP 進度的 10 個關卡(final gate,100% 同意結案或 L1/L2 強制結案)沒完成之前,
  // 整組後續開發流程鎖死在「案件同意度通過待完成」- 不是前端單純不給點,後端
  // routers/development.py 的 complete/reopen/meta/history 幾支 API 也一樣會擋,
  // 避免繞過 UI 直接呼叫 API 就能在 SOP 沒跑完時把開發流程往前推。
  const locked = hasStages && !sopDone;
  // 跟 SOP 頁「自訂關卡流程」同一個限制:流程完全還沒開始跑(還在第0階段、每一階段
  // 都還是待開始)才准調整階段名稱/順序,避免動到已經在推進中的資料。
  const canEditFlow = isManager() && dev.current_stage === 0 && stageKeys.every((k) => (dev.stages[k].status || "pending") === "pending");

  // ---- 橫向關卡步驟條(前面加一顆「案件同意度通過」裝飾節點,來自 SOP 結案狀態) ----
  const stepperNodes = [
    { icon: "✅", title: "案件同意度通過", status: sopDone ? "done" : "pending", dateText: sopDone && sop.final.closed_at ? fmtDate(sop.final.closed_at) : "待完成", isReal: false, key: null },
    ...stageKeys.map((k, i) => {
      const s = dev.stages[k];
      const isDone = !locked && s.status === "completed";
      const isCurrent = !locked && Number(k) === dev.current_stage && !isDone;
      return {
        icon: locked ? "🔒" : DEV_STAGE_ICONS[i % DEV_STAGE_ICONS.length],
        title: s.name,
        status: locked ? "locked" : isDone ? "done" : isCurrent ? "current" : "pending",
        dateText: locked
          ? "尚未解鎖"
          : isDone
            ? (s.completed_at ? fmtDate(s.completed_at) : "已完成")
            : s.due_date
              ? `預計 ${fmtDate(s.due_date)}`
              : "待開始",
        isReal: true,
        key: k,
      };
    }),
  ];
  const stepperHtml = `
    <div class="card sop-subcard">
      <div class="sop-subcard-header">
        <h4>都更後續開發流程(SOP)</h4>
        ${canEditFlow ? `<button type="button" class="btn-secondary btn-sm" id="dev-edit-flow-btn">⚙ 編輯流程</button>` : ""}
      </div>
      ${hasStages
        ? `<div class="dev-stepper">
            ${stepperNodes
              .map(
                (n, i) => `
              <div class="dev-stepper-node ${n.status} ${!locked && n.isReal && n.key === String(dev.current_stage) ? "selected" : ""}" ${n.isReal && !locked ? `data-dev-stepper-select="${n.key}"` : ""}>
                <div class="dev-stepper-circle">${n.status === "done" ? "✓" : n.icon}</div>
                <div class="dev-stepper-num">${i}</div>
                <div class="dev-stepper-title">${escapeHtml(n.title)}</div>
                <div class="dev-stepper-status-badge">${n.status === "done" ? "已完成" : n.status === "current" ? "進行中" : n.status === "locked" ? "鎖定中" : "待開始"}</div>
                <div class="helper-text">${escapeHtml(n.dateText)}</div>
              </div>`
              )
              .join("")}
          </div>`
        : `<div class="empty-state">尚未建立流程,請洽案件負責人(L2以上)</div>`
      }
    </div>`;

  // ---- 目前階段資訊 ----
  const selectedKey = state.devSelectedStage != null && stageKeys.includes(String(state.devSelectedStage))
    ? String(state.devSelectedStage)
    : String(dev.current_stage);
  const selectedStage = dev.stages[selectedKey];
  let currentInfoHtml = "";
  if (locked) {
    currentInfoHtml = `
      <div class="card sop-subcard">
        <div class="sop-subcard-header"><h4>🔒 都更後續開發流程尚未解鎖</h4></div>
        <div class="empty-state">需先完成「SOP 進度」全部 10 個關卡(案件同意度通過)才會開放這裡的流程。</div>
      </div>`;
  } else if (hasStages && selectedStage) {
    const isDone = selectedStage.status === "completed";
    const isCurrent = Number(selectedKey) === dev.current_stage && !isDone;
    const canReopen = isDone && Number(selectedKey) === dev.current_stage - 1;
    const progressPct = selectedStage.progress_pct ?? (isDone ? 100 : 0);
    currentInfoHtml = `
      <div class="card sop-subcard">
        <div class="sop-subcard-header">
          <h4>${isDone ? "✓" : isCurrent ? "▶" : "🔒"} ${escapeHtml(selectedStage.name)}</h4>
          <span class="status-badge ${isDone || isCurrent ? "status-active" : "status-closed"}">${isDone ? "已完成" : isCurrent ? "進行中" : "待開始"}</span>
        </div>
        <div class="dev-info-grid">
          <div class="field"><label>預計完成日</label>${canAct
            ? `<input type="date" id="dev-meta-due-date" value="${escapeHtml(selectedStage.due_date) || ""}">`
            : `<div class="sop-meta-value">${selectedStage.due_date ? fmtDate(selectedStage.due_date) : "未設定"}</div>`
          }</div>
          <div class="field"><label>負責單位</label>${canAct
            ? `<input type="text" id="dev-meta-department" value="${escapeHtml(selectedStage.department) || ""}" placeholder="例:都市發展局">`
            : `<div class="sop-meta-value">${escapeHtml(selectedStage.department) || "未設定"}</div>`
          }</div>
        </div>
        <div class="field"><label>辦理內容</label>${canAct
          ? `<textarea id="dev-meta-description" rows="2" placeholder="這一關要做什麼...">${escapeHtml(selectedStage.description) || ""}</textarea>`
          : `<div class="sop-meta-value">${escapeHtml(selectedStage.description) || "未設定"}</div>`
        }</div>
        <div class="field"><label>所需文件</label>${canAct
          ? `<input type="text" id="dev-meta-required-docs" value="${escapeHtml(selectedStage.required_docs) || ""}" placeholder="例:事業計畫書、圖說、相關同意書、委任書等">`
          : `<div class="sop-meta-value">${escapeHtml(selectedStage.required_docs) || "未設定"}</div>`
        }</div>
        <div class="field">
          <label>本階段進度${canAct ? "" : `:${progressPct}%`}</label>
          ${canAct ? `<input type="range" id="dev-meta-progress" min="0" max="100" value="${progressPct}">` : ""}
          <div class="progress-bar-track"><div class="progress-bar-fill" style="width:${progressPct}%"></div></div>
          ${canAct ? `<div class="helper-text" style="text-align:right"><span id="dev-meta-progress-text">${progressPct}</span>%</div>` : ""}
        </div>
        ${canAct ? `<div style="text-align:right"><button type="button" class="btn-secondary btn-sm" id="dev-save-meta-btn">儲存階段資訊</button></div>` : ""}
        <div class="sop-action-bar">
          ${isCurrent && canAct ? `<button type="button" class="btn-primary btn-sm" data-dev-complete="${selectedKey}">完成本階段</button>` : ""}
          ${canReopen && canAct ? `<button type="button" class="btn-secondary btn-sm" data-dev-reopen="${selectedKey}">取消完成</button>` : ""}
        </div>
      </div>`;
  }

  // ---- 相關文件(掛在目前選取的關卡上) ----
  const stageDocs = hasStages && !locked
    ? allDocs.filter((d) => d.dev_stage === Number(selectedKey)).sort((a, b) => new Date(b.uploaded_at) - new Date(a.uploaded_at))
    : [];
  const fileRowHtml = (d) => `
    <div class="sop-file-row" data-doc-id="${d.id}">
      <span class="sop-file-icon">📄</span>
      <div class="sop-file-main">
        <div class="sop-file-name">${escapeHtml(d.file_name)}</div>
        <div class="helper-text">${fmtDateTime(d.uploaded_at)}</div>
      </div>
      <button type="button" class="btn-secondary btn-sm" data-dev-file-download="${d.id}" data-dev-file-name="${escapeHtml(d.file_name)}" title="下載">⬇</button>
      ${canAct ? `<button type="button" class="btn-danger btn-sm" data-dev-file-delete="${d.id}" title="刪除">✕</button>` : ""}
    </div>`;
  const relatedFilesHtml = hasStages && !locked
    ? `<div class="card sop-subcard">
        <div class="sop-subcard-header"><h4>📎 相關文件</h4></div>
        ${canAct
          ? `<label class="sop-file-dropzone" id="dev-file-dropzone">
              <input type="file" id="dev-file-input" style="display:none">
              <div>⬆ 點擊上傳檔案或拖曳檔案到此處</div>
            </label>`
          : ""
        }
        <div class="sop-file-list">${stageDocs.length ? stageDocs.map(fileRowHtml).join("") : `<div class="empty-state">尚無相關文件</div>`}</div>
      </div>`
    : "";

  // ---- 各階段重點文件清單 ----
  const docTableHtml = hasStages
    ? `<div class="card sop-subcard">
        <h4>各階段重點文件清單</h4>
        <div class="table-wrap">
          <table>
            <thead><tr><th>階段</th><th>主要文件</th><th>備註</th></tr></thead>
            <tbody>
              ${stageKeys
                .map((k) => `<tr><td>${escapeHtml(dev.stages[k].name)}</td><td>${escapeHtml(dev.stages[k].required_docs) || "-"}</td><td>${escapeHtml(dev.stages[k].description) || "-"}</td></tr>`)
                .join("")}
            </tbody>
          </table>
        </div>
      </div>`
    : "";

  // ---- 階段歷程 ----
  const history = dev.history || [];
  const historyHtml = `
    <div class="card sop-subcard">
      <div class="sop-subcard-header"><h4>🕒 階段歷程</h4></div>
      ${canAct && !locked
        ? `<div class="dev-history-add">
            <input type="date" id="dev-history-date" value="${new Date().toISOString().slice(0, 10)}">
            <input type="text" id="dev-history-title" placeholder="事件標題(如:提送事業計畫書)">
            <button type="button" class="btn-secondary btn-sm" id="dev-history-add-btn">+ 新增</button>
          </div>`
        : ""
      }
      <div class="dev-history-list">
        ${history.length
          ? history
              .map(
                (h) => `
            <div class="dev-history-item">
              <div class="dev-history-dot"></div>
              <div class="dev-history-body">
                <div class="dev-history-date">${fmtDate(h.event_date)}</div>
                <div class="dev-history-title">${escapeHtml(h.title)}${h.note ? ` - ${escapeHtml(h.note)}` : ""}</div>
              </div>
              ${canAct ? `<button type="button" class="btn-link btn-sm" data-dev-history-delete="${h.id}">刪除</button>` : ""}
            </div>`
              )
              .join("")
          : `<div class="empty-state">尚無歷程紀錄</div>`
        }
      </div>
    </div>`;

  container.innerHTML = `
    ${stepperHtml}
    <div class="dev-two-col">
      <div class="dev-two-col-main">${currentInfoHtml}${docTableHtml}</div>
      <div class="dev-two-col-side">${relatedFilesHtml}${historyHtml}</div>
    </div>`;

  // ---- 事件綁定 ----
  container.querySelectorAll("[data-dev-stepper-select]").forEach((node) => {
    node.addEventListener("click", () => {
      state.devSelectedStage = Number(node.dataset.devStepperSelect);
      renderDevelopmentTab(container);
    });
  });

  const editFlowBtn = document.getElementById("dev-edit-flow-btn");
  if (editFlowBtn) {
    editFlowBtn.addEventListener("click", () => {
      const currentStages = stageKeys.map((k) => dev.stages[k].name);
      openDevFlowEditor(currentStages, async (stages) => {
        await api(`/projects/${pid}/development/stages`, { method: "PUT", body: { stages } });
        toast("流程已更新", "success");
        closeModal();
        state.devSelectedStage = null;
        renderDevelopmentTab(container);
      });
    });
  }

  container.querySelectorAll("[data-dev-complete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await api(`/projects/${pid}/development/${btn.dataset.devComplete}/complete`, { method: "POST", body: {} });
        toast("已完成", "success");
        state.devSelectedStage = null;
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

  const progressInput = document.getElementById("dev-meta-progress");
  const progressText = document.getElementById("dev-meta-progress-text");
  if (progressInput && progressText) {
    progressInput.addEventListener("input", () => {
      progressText.textContent = progressInput.value;
      progressInput.parentElement.querySelector(".progress-bar-fill").style.width = `${progressInput.value}%`;
    });
  }
  const saveMetaBtn = document.getElementById("dev-save-meta-btn");
  if (saveMetaBtn) {
    saveMetaBtn.addEventListener("click", async () => {
      const payload = {
        due_date: document.getElementById("dev-meta-due-date").value || null,
        department: document.getElementById("dev-meta-department").value || null,
        description: document.getElementById("dev-meta-description").value || null,
        required_docs: document.getElementById("dev-meta-required-docs").value || null,
        progress_pct: progressInput ? Number(progressInput.value) : undefined,
      };
      try {
        await api(`/projects/${pid}/development/${selectedKey}/meta`, { method: "PATCH", body: payload });
        toast("已儲存", "success");
        renderDevelopmentTab(container);
      } catch (err) { }
    });
  }

  // ---- 相關文件上傳/下載/刪除 ----
  // 同一關卡再上傳一次同檔名的檔案,視為「覆蓋」:先刪掉舊的那筆再上傳新的,
  // 不會在清單裡疊出兩筆同名檔案。
  const uploadDevFile = async (file) => {
    if (!file) return;
    const existing = stageDocs.find((d) => d.file_name === file.name);
    if (existing) {
      try {
        await api(`/projects/${pid}/documents/${existing.id}`, { method: "DELETE" });
      } catch (err) {
        return;
      }
    }
    const fd = new FormData();
    fd.append("file", file);
    fd.append("doc_type", "other");
    fd.append("dev_stage", selectedKey);
    try {
      await api(`/projects/${pid}/documents`, { method: "POST", body: fd, isForm: true });
      toast(existing ? "已覆蓋原檔案" : "已上傳", "success");
      renderDevelopmentTab(container);
    } catch (err) { }
  };
  const dropzone = document.getElementById("dev-file-dropzone");
  const fileInput = document.getElementById("dev-file-input");
  if (dropzone && fileInput) {
    fileInput.addEventListener("change", () => uploadDevFile(fileInput.files[0]));
    dropzone.addEventListener("dragover", (e) => {
      e.preventDefault();
      dropzone.classList.add("dragover");
    });
    dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
    dropzone.addEventListener("drop", (e) => {
      e.preventDefault();
      dropzone.classList.remove("dragover");
      uploadDevFile(e.dataTransfer.files[0]);
    });
  }
  container.querySelectorAll("[data-dev-file-download]").forEach((btn) => {
    btn.addEventListener("click", () => downloadDocument(Number(btn.dataset.devFileDownload), btn.dataset.devFileName));
  });
  container.querySelectorAll("[data-dev-file-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("確定要刪除這個檔案嗎?")) return;
      try {
        await api(`/projects/${pid}/documents/${btn.dataset.devFileDelete}`, { method: "DELETE" });
        toast("已刪除", "success");
        renderDevelopmentTab(container);
      } catch (err) { }
    });
  });

  // ---- 階段歷程新增/刪除 ----
  const historyAddBtn = document.getElementById("dev-history-add-btn");
  if (historyAddBtn) {
    historyAddBtn.addEventListener("click", async () => {
      const dateInput = document.getElementById("dev-history-date");
      const titleInput = document.getElementById("dev-history-title");
      if (!titleInput.value.trim()) {
        toast("請輸入事件標題", "error");
        return;
      }
      try {
        await api(`/projects/${pid}/development/history`, {
          method: "POST",
          body: { event_date: dateInput.value, title: titleInput.value.trim() },
        });
        toast("已新增", "success");
        renderDevelopmentTab(container);
      } catch (err) { }
    });
  }
  container.querySelectorAll("[data-dev-history-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await api(`/projects/${pid}/development/history/${btn.dataset.devHistoryDelete}`, { method: "DELETE" });
        renderDevelopmentTab(container);
      } catch (err) { }
    });
  });
}

// ========== 編輯流程(階段名稱/順序)==========
// 跟 SOP 頁「自訂關卡流程」是同一套視覺/操作模式(.sop-flow-* 共用同一份 CSS),但
// 開發流程沒有自動門檻/進階需求這些東西,單純就是名稱 + 順序,所以是簡化過的獨立版本。
let devFlowEditorState = null; // { stages: [{name}] }

function devFlowEditorRowsHtml() {
  const stages = devFlowEditorState.stages;
  return stages
    .map(
      (row, i) => `
      <div class="sop-flow-row">
        <span class="sop-flow-row-num">${i + 1}</span>
        <input type="text" class="sop-flow-row-name" data-dflow-name="${i}" value="${escapeHtml(row.name || "")}" placeholder="階段名稱" style="flex:1">
        <div class="sop-flow-row-actions">
          <button type="button" class="btn-secondary btn-sm" data-dflow-up="${i}" ${i === 0 ? "disabled" : ""} title="上移">↑</button>
          <button type="button" class="btn-secondary btn-sm" data-dflow-down="${i}" ${i === stages.length - 1 ? "disabled" : ""} title="下移">↓</button>
          <button type="button" class="btn-danger btn-sm" data-dflow-remove="${i}" ${stages.length <= 1 ? "disabled" : ""} title="刪除">✕</button>
        </div>
      </div>`
    )
    .join("");
}

function renderDevFlowEditorBody() {
  return `
    <div class="sop-flow-editor">
      <p class="helper-text">自訂這個案件的後續開發流程階段:可新增、刪除、改名、排序。流程一旦開始推進(有任一階段狀態變動)就無法再調整。</p>
      <div class="sop-flow-rows" id="dev-flow-rows">${devFlowEditorRowsHtml()}</div>
      <div style="display:flex;gap:8px;margin-top:12px">
        <button type="button" class="btn-secondary btn-sm" id="dev-flow-add-btn">+ 新增階段</button>
      </div>
      <div class="modal-footer" style="margin-top:20px">
        <button type="button" class="btn-primary" id="dev-flow-save-btn">儲存</button>
      </div>
    </div>`;
}

function rerenderDevFlowEditor() {
  const rowsEl = document.getElementById("dev-flow-rows");
  if (rowsEl) rowsEl.innerHTML = devFlowEditorRowsHtml();
  wireDevFlowEditorRows();
}

function wireDevFlowEditorRows() {
  const root = document.getElementById("modal-root");
  root.querySelectorAll("[data-dflow-name]").forEach((input) => {
    input.oninput = () => {
      devFlowEditorState.stages[Number(input.dataset.dflowName)].name = input.value;
    };
  });
  root.querySelectorAll("[data-dflow-up]").forEach((btn) => {
    btn.onclick = () => {
      const i = Number(btn.dataset.dflowUp);
      const arr = devFlowEditorState.stages;
      if (i > 0) {
        [arr[i - 1], arr[i]] = [arr[i], arr[i - 1]];
        rerenderDevFlowEditor();
      }
    };
  });
  root.querySelectorAll("[data-dflow-down]").forEach((btn) => {
    btn.onclick = () => {
      const i = Number(btn.dataset.dflowDown);
      const arr = devFlowEditorState.stages;
      if (i < arr.length - 1) {
        [arr[i + 1], arr[i]] = [arr[i], arr[i + 1]];
        rerenderDevFlowEditor();
      }
    };
  });
  root.querySelectorAll("[data-dflow-remove]").forEach((btn) => {
    btn.onclick = () => {
      const i = Number(btn.dataset.dflowRemove);
      if (devFlowEditorState.stages.length > 1) {
        devFlowEditorState.stages.splice(i, 1);
        rerenderDevFlowEditor();
      }
    };
  });
}

function openDevFlowEditor(initialStageNames, onSave) {
  devFlowEditorState = { stages: (initialStageNames && initialStageNames.length ? initialStageNames : [""]).map((n) => ({ name: n })) };
  openModal("編輯流程", renderDevFlowEditorBody(), { width: "560px" });
  wireDevFlowEditorRows();

  document.getElementById("dev-flow-add-btn").onclick = () => {
    devFlowEditorState.stages.push({ name: "" });
    rerenderDevFlowEditor();
  };
  document.getElementById("dev-flow-save-btn").onclick = async () => {
    const stages = devFlowEditorState.stages.map((s) => ({ name: (s.name || "").trim() }));
    if (stages.some((s) => !s.name)) {
      toast("每個階段都要有名稱", "error");
      return;
    }
    const saveBtn = document.getElementById("dev-flow-save-btn");
    saveBtn.disabled = true;
    try {
      await onSave(stages);
    } catch (err) {
      saveBtn.disabled = false;
    }
  };
}
