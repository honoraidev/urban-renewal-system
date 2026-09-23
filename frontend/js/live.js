"use strict";

// 全站即時同步 - 任何一個已登入的分頁(不限同一個帳號)做了會改資料的操作,後端
// ActivityLogMiddleware 判斷成功後會廣播一個「project X 有異動」的信號(見後端
// utils/live_events.py),所有連著的分頁都會透過這條 SSE 收到,自動刷新鈴鐺 + 目前
// 畫面上正在看的內容,不用手動重新整理。EventSource 沒辦法自訂 header,認證 token
// 只能放在 query string(見後端 routers/events.py)。斷線瀏覽器會自動重連,加上各
// 頁面原本就有的輪詢(鈴鐺 60 秒、工作看板 30 秒)當保險,SSE 斷了也不會完全沒更新。
const liveState = { source: null, debounceTimer: null, pendingProjectIds: new Set(), pendingGlobal: false };

function liveConnect() {
  liveDisconnect();
  if (!state.token) return;
  const source = new EventSource(`${API_BASE}/events/stream?token=${encodeURIComponent(state.token)}`);
  source.onmessage = (e) => {
    let data;
    try {
      data = JSON.parse(e.data);
    } catch (err) {
      return;
    }
    liveQueueUpdate(data.project_id ?? null);
  };
  liveState.source = source;
}

function liveDisconnect() {
  if (liveState.source) {
    liveState.source.close();
    liveState.source = null;
  }
  if (liveState.debounceTimer) {
    clearTimeout(liveState.debounceTimer);
    liveState.debounceTimer = null;
  }
  liveState.pendingProjectIds = new Set();
  liveState.pendingGlobal = false;
}

// 短時間內同一個案件常常連續好幾個異動(例如上傳文件會連帶寫入 activity_log 又
// 觸發一次),集中 500ms 內收到的信號一次處理,不要每個信號都重刷一次畫面。
function liveQueueUpdate(projectId) {
  if (projectId == null) liveState.pendingGlobal = true;
  else liveState.pendingProjectIds.add(projectId);
  if (liveState.debounceTimer) return;
  liveState.debounceTimer = setTimeout(liveFlushUpdate, 500);
}

function liveViewVisible(id) {
  const el = document.getElementById(id);
  return !!el && !el.classList.contains("hidden");
}

async function liveFlushUpdate() {
  const projectIds = liveState.pendingProjectIds;
  const isGlobal = liveState.pendingGlobal;
  liveState.pendingProjectIds = new Set();
  liveState.pendingGlobal = false;
  liveState.debounceTimer = null;

  if (typeof refreshReminderBell === "function") refreshReminderBell();

  // 開著彈跳視窗表示使用者正在手動輸入東西(填表單、寫原因...),這時候把畫面
  // 換掉會讓還沒送出的內容不見,寧可這次事件被下次輪詢或使用者自己的動作蓋過去,
  // 也不要打斷正在輸入的人。
  if (document.getElementById("modal-overlay")) return;

  const affectsCurrentProject = state.currentProjectId != null && (isGlobal || projectIds.has(state.currentProjectId));

  try {
    if (liveViewVisible("view-project-detail") && affectsCurrentProject) {
      await renderTab(state.activeTab);
    } else if (liveViewVisible("view-project-overview") && affectsCurrentProject) {
      await goToProjectOverviewPage(state.currentProjectId);
    } else if (liveViewVisible("view-mywork") && typeof loadMyWork === "function") {
      await loadMyWork();
    } else if (liveViewVisible("view-dashboard") && typeof loadDashboard === "function") {
      await loadDashboard();
    }
  } catch (err) {
    /* 這次刷新失敗就算了,下一個信號或使用者自己的動作會再補上 */
  }
}
