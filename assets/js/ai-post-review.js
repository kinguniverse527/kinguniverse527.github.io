/* 手动邀请 ChatGPT 阅读某一篇文章。这里不直接调用模型，也不请求任何密钥。 */
(() => {
  "use strict";
  const section = document.querySelector(".ai-post-review");
  const button = section?.querySelector(".ai-review-copy");
  const status = section?.querySelector(".ai-review-status");
  const fallback = section?.querySelector(".ai-review-fallback");
  if (!section || !button || !status || !fallback) return;

  const title = section.dataset.postTitle || "未命名文章";
  const url = section.dataset.postUrl || window.location.href;
  const article = document.querySelector(".reading .prose");
  button.addEventListener("click", async () => {
    const content = article?.innerText?.trim() || article?.textContent?.trim() || "";
    if (!content) {
      status.textContent = "没有读取到文章正文，请刷新页面后重试。";
      return;
    }
    const prompt = [
      "我在写一个用于长期保存生活与思考的个人博客。请完整阅读下面这一篇文章，然后以“ChatGPT 留言”的形式写给我一段真诚、独立且有思想的读后感。",
      "",
      "我想听到的是你对我在文字中表达的感受、困惑、期待、价值判断和内在矛盾的理解与评价，而不只是文章总结。",
      "请遵循以下要求：",
      "1. 结合文中具体句子或细节谈论我真实写下的内容，不要生搬硬套心理学标签，不要推测未写明的事实。",
      "2. 可以认同，也可以温和地指出逻辑上值得商榷的地方，不要为了安慰而空洞地奉承。",
      "3. 用第二人称直接与我交流，尊重我的自主性；不要急于给我的人生下结论。",
      "4. 重点是感受、思想与生活，而非文字润色、成绩打分或笼统的职业规划。",
      "5. 以自然中文写成适合公开留在这篇博客下方的读者留言，约 300—500 字；如有值得继续想的问题，可以在结尾提出一个。",
      "",
      "文章标题：" + title,
      "文章链接：" + url,
      "",
      "文章正文：",
      content
    ].join("\n");

    fallback.hidden = true;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(prompt);
      status.textContent = "已复制全文与问题。点击“② 打开 ChatGPT”，粘贴并发送即可。";
    } catch (_) {
      fallback.hidden = false;
      fallback.value = prompt;
      fallback.focus();
      fallback.select();
      status.textContent = "当前浏览器未允许自动复制。请长按或手动复制下方文字，再到 ChatGPT 发送。";
    }
  });
})();
