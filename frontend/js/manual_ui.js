"use strict";

// 使用手冊:右側一次只顯示一個章節(點左側目錄切換);第一次載入把 h3 + 後面的內容包成一個章節。
(function () {
  function init() {
    const body = document.querySelector("#view-manual .manual-body");
    const links = [...document.querySelectorAll("#view-manual .manual-toc a[href^='#manual-']")];
    if (!body || !links.length || body.dataset.ready) return;
    body.dataset.ready = "1";
    const kids = [...body.children];
    const firstH3 = kids.findIndex((e) => e.tagName === "H3");
    const sections = [];
    let cur = null;
    kids.slice(firstH3).forEach((el) => {
      if (el.tagName === "H3") {
        cur = document.createElement("section");
        cur.className = "manual-sec";
        cur.id = "sec-" + el.id;
        sections.push(cur);
        body.insertBefore(cur, el);
      }
      cur.appendChild(el);
    });
    // 章節編號寫成 data-n(CSS counter 遇到 display:none 的章節不會計數,會全部變成 1)
    sections.forEach((sec, i) => { const h = sec.querySelector("h3"); if (h) h.dataset.n = String(i + 1); });
    const show = (id) => {
      const target = "sec-" + id;
      let found = false;
      sections.forEach((s) => {
        const on = s.id === target;
        s.hidden = !on;
        if (on) found = true;
      });
      if (!found) return false;
      links.forEach((a) => a.classList.toggle("active", a.getAttribute("href") === "#" + id));
      return true;
    };
    links.forEach((a) => {
      a.addEventListener("click", (e) => {
        e.preventDefault();
        show(a.getAttribute("href").slice(1));
        const view = document.getElementById("view-manual");
        if (view && window.innerWidth < 1120) body.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
    show(sections[0].id.replace("sec-", ""));
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
