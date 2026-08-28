"use strict";

function bootstrapApp() {
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
      if (target === "tools") goToTools();
      if (target === "users") goToUsers();
      if (target === "loginlogs") goToLoginLogs();
      if (target === "companydocs") goToCompanyDocs();
      if (target === "regulations") goToRegulations();
      if (target === "websites") goToWebsites();
      if (target === "faq") goToFaq();
    });
  });

  const ocrBtn = document.getElementById("btn-run-ocr");
  if (ocrBtn) {
    ocrBtn.addEventListener("click", () => {
      openModal(
        "OCR 謄本辨識 - 使用說明",
        `
        <div style="padding:4px 0">
          <div style="background:#e0f2fe;border:1px solid #bae6fd;border-radius:10px;padding:14px;margin-bottom:16px;display:flex;align-items:flex-start;gap:12px">
            <div style="font-size:14px;color:#0369a1;line-height:1.5">
              <strong>本系統整合 OCR 謄本自動辨識功能！</strong>
            </div>
          </div>
          
          <h4 style="margin:12px 0 8px;font-size:15px;color:var(--text-main);font-weight:700">📍 如何使用此功能：</h4>
          <ol style="margin:0 0 16px 20px;padding:0;font-size:14px;color:var(--text-muted);line-height:1.8">
            <li>請由左側選單進入任一<strong>「都更案件」</strong>。</li>
            <li>切換至<strong>「土地登記」</strong>或<strong>「建物登記」</strong>頁籤。</li>
            <li>點擊上方 <strong>「自動掃描謄本 (OCR)」</strong> 按鈕。</li>
            <li>上傳謄本 PDF 檔，系統將自動辨識地主姓名、持分、地號與面積並匯入清冊。</li>
          </ol>
          
          <div class="modal-footer" style="margin-top:20px">
            <button type="button" class="btn-primary" onclick="closeModal()">我知道了</button>
          </div>
        </div>`
      );
    });
  }

  const taxBtn = document.getElementById("btn-run-tax");
  if (taxBtn) {
    taxBtn.addEventListener("click", () => {
      openModal(
        "計算土地增值稅 - 使用說明",
        `
        <div style="padding:4px 0">
          <div style="background:#fef9c3;border:1px solid #fef08a;border-radius:10px;padding:14px;margin-bottom:16px;display:flex;align-items:flex-start;gap:12px">
            <div style="font-size:14px;color:#854d0e;line-height:1.5">
              <strong>本系統整合土地增值稅自動試算與計算器功能！</strong>
            </div>
          </div>
          
          <h4 style="margin:12px 0 8px;font-size:15px;color:var(--text-main);font-weight:700">📍 如何使用此功能：</h4>
          <ol style="margin:0 0 16px 20px;padding:0;font-size:14px;color:var(--text-muted);line-height:1.8">
            <li>請由左側選單進入任一<strong>「都更案件」</strong>。</li>
            <li>切換至<strong>「土增稅」</strong>頁籤。</li>
            <li>系統將自動帶入該案件下所有地主與地號數據。</li>
            <li>可輸入前次移轉現值、公告土地現值、台灣物價指數與持有年數，即時自動試算一般稅率與自用住宅優惠稅率應納稅額！</li>
          </ol>
          
          <div class="modal-footer" style="margin-top:20px">
            <button type="button" class="btn-primary" onclick="closeModal()">我知道了</button>
          </div>
        </div>`
      );
    });
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
