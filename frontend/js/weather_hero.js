"use strict";

// 工作看板頂端橫幅:「XXX | 午安」+ 目前天氣(板橋 24°C・短暫陣雨・降雨機率 80%),
// 背景依天氣 / 日夜做動態(陽光、雲飄、下雨、打雷、霧、下雪、星空)。
// 天氣資料由後端 /weather 提供(Open-Meteo,後端快取 15 分鐘)。
const WX_ICON = { clear: "☀️", partly: "🌤️", cloudy: "☁️", fog: "🌫️", rain: "🌧️", thunder: "⛈️", snow: "❄️" };

function _wxDark() {
  const t = document.documentElement.dataset.theme;
  if (t === "dark") return true;
  if (t === "light") return false;
  return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
}

let _wxLast = { kind: "clear", isDay: true };
function _applyHeroTheme(kind, isDay) {
  _wxLast = { kind, isDay };
  const hero = document.querySelector("#view-mywork .page-header");
  if (!hero) return;
  hero.classList.add("mw-hero");
  hero.dataset.wx = kind || "clear";
  // 深色模式或夜間都用夜景配色
  hero.dataset.day = isDay && !_wxDark() ? "1" : "0";
}

function renderWorkHero() {
  const holder = document.getElementById("mywork-actions");
  if (!holder) return;
  const hr = new Date().getHours();
  const greet = hr < 5 ? "夜深了,注意休息" : hr < 11 ? "早安" : hr < 18 ? "午安" : "晚安";
  const who = (state.user && (state.user.display_name || state.user.username)) || "";
  const dayByClock = hr >= 6 && hr < 18;
  _applyHeroTheme("clear", dayByClock);
  holder.innerHTML = `
    <div class="mw-hero-right">
      <div class="mw-hero-ic" id="mw-hero-ic">${dayByClock ? "☀️" : "🌙"}</div>
      <div class="mw-hero-txt">
        <div class="mw-hero-l1">${who ? `<b>${escapeHtml(who)}</b><i></i>` : ""}<span>${greet}</span></div>
        <div class="mw-hero-l2" id="mw-hero-wx">天氣載入中…</div>
      </div>
      ${isSystemAdmin() ? `<button type="button" class="mw-hero-btn" id="ann-open-btn">📢 發布公告</button>` : ""}
    </div>`;
  loadWorkHeroWeather(dayByClock);
}

async function loadWorkHeroWeather(dayByClock) {
  const line = document.getElementById("mw-hero-wx");
  const icon = document.getElementById("mw-hero-ic");
  if (!line) return;
  let w = null;
  try {
    w = await api("/weather", { silent: true });
  } catch (e) {}
  if (!w || !w.ok) {
    line.textContent = "";
    return;
  }
  _applyHeroTheme(w.kind, w.is_day);
  if (icon) icon.textContent = w.is_day ? WX_ICON[w.kind] || "☀️" : w.kind === "clear" || w.kind === "partly" ? "🌙" : WX_ICON[w.kind] || "🌙";
  const rain = w.rain_prob != null ? `・降雨機率 ${w.rain_prob}%` : "";
  line.textContent = `${w.city} ${w.temp}°C・${w.label}${rain}`;
}

// 切換深色 / 淺色模式時,橫幅配色跟著換
new MutationObserver(() => _applyHeroTheme(_wxLast.kind, _wxLast.isDay)).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
