/* 在样式加载前恢复配色，避免先闪出白色页面。只存储四种预设名称。 */
(() => {
  "use strict";
  const key = "king-universe-reading-theme-v1";
  const names = ["warm", "paper", "sage", "dark"];
  const normalize = value => names.includes(value) ? value : "warm";
  let current = "warm";
  try { current = normalize(localStorage.getItem(key)); } catch (_) {}
  document.documentElement.dataset.readingTheme = current;
  const frames = new WeakSet();
  function syncComments() {
    const frame = document.querySelector("iframe.giscus-frame");
    if (!frame) return;
    if (!frames.has(frame)) {
      frames.add(frame);
      frame.addEventListener("load", syncComments);
    }
    frame.contentWindow?.postMessage({ giscus: { setConfig: { theme: current === "dark" ? "dark" : "light" } } }, "https://giscus.app");
  }
  function apply(value, save) {
    current = normalize(value);
    document.documentElement.dataset.readingTheme = current;
    document.querySelectorAll('input[name="reading-theme"]').forEach(input => { input.checked = input.value === current; });
    if (save) { try { localStorage.setItem(key, current); } catch (_) {} }
    syncComments();
  }
  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll(".theme-picker").forEach(picker => {
      picker.hidden = false;
      picker.addEventListener("change", event => {
        if (event.target.matches('input[name="reading-theme"]')) apply(event.target.value, true);
      });
    });
    apply(current, false);
    const comments = document.querySelector(".giscus");
    if (comments) new MutationObserver(syncComments).observe(comments, { childList: true });
  });
  window.addEventListener("storage", event => {
    if (event.key === key || event.key === null) apply(event.newValue, false);
  });
})();
