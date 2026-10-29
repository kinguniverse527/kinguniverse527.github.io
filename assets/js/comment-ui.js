/* 保留无 JavaScript 时的全文阅读；只为长留言添加展开/收起。 */
(() => {
  "use strict";
  const entries = [...document.querySelectorAll(".comment-body")].map(body => ({
    text: body.querySelector(".comment-text"),
    button: body.querySelector(".comment-toggle"),
    expanded: false
  })).filter(entry => entry.text && entry.button);

  function update(entry) {
    const limit = parseFloat(getComputedStyle(entry.text).lineHeight) * 4;
    const long = entry.text.scrollHeight > limit + 2;
    entry.button.hidden = !long;
    entry.text.style.maxHeight = long && !entry.expanded ? limit + "px" : "";
    entry.text.classList.toggle("is-collapsed", long && !entry.expanded);
    entry.button.setAttribute("aria-expanded", String(entry.expanded));
    entry.button.textContent = entry.expanded ? "收起" : "展开";
  }
  for (const entry of entries) {
    entry.button.addEventListener("click", () => {
      entry.expanded = !entry.expanded;
      update(entry);
    });
    update(entry);
  }
  let frame;
  window.addEventListener("resize", () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => entries.forEach(update));
  });
})();
