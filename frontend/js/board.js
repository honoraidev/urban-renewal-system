"use strict";

// 案件公告 / 進度通知面板 —— 案件標題旁的「🔔 公告」按鈕打開。合併兩種紀錄:
//   ① 系統自動記錄(activity_logs):地主/屋主資料變更、上傳文件、費用異動等,
//      只要動到這個案件就自動出現,誰改的、什麼時候都有。
//   ② 手動補充(project_notes):自己輸入跟進事項與時間,例如電訪紀錄、進度備註。

function boardEnsureStyle() {
  if (document.getElementById("board-style")) return;
  const s = document.createElement("style");
  s.id = "board-style";
  s.textContent = `
    #pd-board-btn { display:inline-flex; align-items:center; gap:5px; }
    .board-row { display:flex; justify-content:space-between; gap:12px; padding:9px 4px;
      border-bottom:1px solid var(--border); align-items:flex-start; }
    .board-row:last-child { border-bottom:none; }
    .board-row-main { display:flex; align-items:flex-start; gap:8px; min-width:0; }
    .board-row-tag { flex:0 0 auto; font-size:11px; font-weight:700; padding:2px 7px; border-radius:10px; white-space:nowrap; }
    .board-row-tag.tag-note { background:rgba(13,148,136,.12); color:#0d9488; }
    .board-row-tag.tag-auto { background:var(--surface-2); color:var(--text-muted); }
    .board-row-text { font-size:13.5px; word-break:break-word; }
    .board-row-meta { flex:0 0 auto; text-align:right; font-size:11.5px; color:var(--text-muted); white-space:nowrap; }
    .board-row-meta button { margin-left:6px; }
  `;
  document.head.appendChild(s);
}

function _boardRowHtml(item) {
  const isNote = item.kind === "note";
  return `<div class="board-row">
    <div class="board-row-main">
      <span class="board-row-tag ${isNote ? "tag-note" : "tag-auto"}">${isNote ? "📝 手動" : "🔄 系統"}</span>
      <span class="board-row-text">${escapeHtml(item.text)}</span>
    </div>
    <div class="board-row-meta">
      ${escapeHtml(item.who || "—")} · ${fmtDateTime(item.time)}
      ${isNote && isEditor() ? `<button type="button" class="btn-link btn-sm" data-del-note="${item.id}">刪除</button>` : ""}
    </div>
  </div>`;
}

async function openProjectBoardModal() {
  const pid = state.currentProjectId;
  if (!pid) return;
  boardEnsureStyle();

  let notes = [];
  let feed = [];
  try {
    [notes, feed] = await Promise.all([
      api(`/projects/${pid}/notes`),
      api(`/projects/${pid}/activity-feed`, { silent: true }).catch(() => []),
    ]);
  } catch (err) {
    return;
  }

  const merged = [
    ...notes.map((n) => ({ kind: "note", id: n.id, time: n.occurred_at, text: n.content, who: n.author_name })),
    ...feed.map((a) => ({ kind: "auto", id: a.id, time: a.created_at, text: a.action, who: a.user_name })),
  ].sort((a, b) => new Date(b.time) - new Date(a.time));

  const nowLocal = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);

  openModal(
    "🔔 公告 / 進度通知",
    `
    <div class="helper-text" style="margin-bottom:12px">
      系統會自動記錄這個案件裡地主/屋主資料變更、文件上傳、費用異動等所有操作;也可以自己補充跟進事項與時間(例如電訪紀錄)。
    </div>
    ${isEditor()
      ? `<form id="board-note-form" style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap;align-items:flex-start">
           <input type="datetime-local" name="occurred_at" value="${nowLocal}" style="flex:0 0 180px">
           <input name="content" placeholder="輸入跟進事項…例:已致電陳先生確認同意書進度" style="flex:1;min-width:220px" required>
           <button type="submit" class="btn-primary btn-sm" style="background:#0d9488;border-color:#0d9488">＋ 新增</button>
         </form>`
      : ""
    }
    <div id="board-list" style="max-height:52vh;overflow:auto">
      ${merged.length ? merged.map(_boardRowHtml).join("") : `<div class="empty-state">尚無紀錄</div>`}
    </div>
    `,
    { width: "640px" }
  );

  const form = document.getElementById("board-note-form");
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const occurred = fd.get("occurred_at");
      try {
        await api(`/projects/${pid}/notes`, {
          method: "POST",
          body: {
            content: fd.get("content"),
            occurred_at: occurred ? new Date(occurred).toISOString() : null,
          },
        });
        toast("已新增", "success");
        openProjectBoardModal();
      } catch (err) { }
    });
  }

  document.querySelectorAll("[data-del-note]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("確定要刪除這筆公告嗎?")) return;
      try {
        await api(`/projects/${pid}/notes/${btn.dataset.delNote}`, { method: "DELETE" });
        openProjectBoardModal();
      } catch (err) { }
    });
  });
}
