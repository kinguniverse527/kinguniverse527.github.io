(() => {
  "use strict";
  const repo = "kinguniverse527/kinguniverse527.github.io";
  const dataPath = "_data/ai_post_reviews.json";
  const params = new URLSearchParams(location.search);
  const path = params.get("post") || "";
  const title = params.get("title") || "未命名文章";
  const url = params.get("url") || "../";
  const name = document.getElementById("article-name");
  const back = document.getElementById("back-to-post");
  const button = document.getElementById("save-review");
  const status = document.getElementById("status");
  const body = document.getElementById("review-body");
  const tokenInput = document.getElementById("github-review-token");
  const validPost = /^_posts\/(?:[\p{L}\p{N}_ .-]+\/)*\d{4}-\d{2}-\d{2}-[\p{L}\p{N}_ .-]+\.(?:md|markdown)$/u.test(path) && !path.includes("..");
  name.textContent = validPost ? ("文章：" + title + "（" + path + "）") : "找不到对应的文章。请从文章页面点击“③ 保存读后感”进入。";
  if (!validPost) button.disabled = true;
  try { const postUrl = new URL(url, location.origin); if (postUrl.origin === location.origin) back.href = postUrl.href; } catch (_) {}

  const api = "https://api.github.com/repos/" + repo;
  async function request(method, endpoint, token, bodyData) {
    const res = await fetch(api + endpoint, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: "Bearer " + token,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(bodyData ? {"Content-Type": "application/json"} : {})
      },
      body: bodyData ? JSON.stringify(bodyData) : undefined,
      credentials: "omit",
      cache: "no-store"
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error("GitHub 请求失败 (" + res.status + ")。" + (res.status === 409 ? "文件已被其他提交修改，请刷新后重试。" : "请检查授权码与网络，或稍后重试。"));
    return json;
  }
  function decode64(str) {
    const raw = atob(str.replace(/\s/g, ""));
    return new TextDecoder().decode(Uint8Array.from(raw, x => x.charCodeAt(0)));
  }
  function encode64(str) {
    const bytes = new TextEncoder().encode(str);
    let raw = "";
    for (let i = 0; i < bytes.length; i += 8192) raw += String.fromCharCode(...bytes.slice(i, i + 8192));
    return btoa(raw);
  }
  button.addEventListener("click", async () => {
    const text = body.value.trim();
    if (!validPost || text.length < 15 || text.length > 15000) {
      status.textContent = "请粘贴至少 15 字、最多 15000 字的完整读后感。";
      return;
    }
    let token = tokenInput.value.trim();
    if (!token) {
      const saved = window.BlogGitHubSession?.load();
      if (saved?.settings?.owner === "kinguniverse527" && saved.settings.repo === "kinguniverse527.github.io") token = saved.token;
    }
    if (!token) {
      status.textContent = "请填写 GitHub 授权码，或先在写作室连接并勾选“记住此浏览器”。";
      return;
    }
    button.disabled = true;
    status.textContent = "正在检查仓库版本并保存读后感…";
    try {
      const enc = dataPath.split("/").map(encodeURIComponent).join("/");
      const current = await request("GET", "/contents/" + enc + "?ref=main", token);
      const data = JSON.parse(decode64(current.content || ""));
      if (!data || !Array.isArray(data.reviews)) throw new Error("评论数据库格式异常，已停止提交。");
      // 保留已有文章与所有旧评论，按文章源文件路径稳定关联。
      let item = data.reviews.find(review => review.path === path);
      if (!item) {
        item = {path, title, comments: []};
        data.reviews.push(item);
      }
      if (!Array.isArray(item.comments)) throw new Error("现有历史留言格式异常，已停止提交。");
      item.comments.push({created_at: new Date().toISOString(), body: text});
      const changed = await request("PUT", "/contents/" + enc, token, {
        message: "Add manually requested ChatGPT reading response for " + path.split("/").pop(),
        content: encode64(JSON.stringify(data, null, 2) + "\n"),
        sha: current.sha,
        branch: "main"
      });
      if (!changed?.commit?.sha) throw new Error("尚未确认 GitHub 已提交，请检查提交历史。");
      tokenInput.value = "";
      status.textContent = "已保存到 GitHub，等待 Pages 构建后将显示在这篇文章下方。";
      body.value = "";
    } catch (error) {
      status.textContent = error.message || "保存失败，请检查网络后重试。";
    } finally { button.disabled = false; }
  });
})();