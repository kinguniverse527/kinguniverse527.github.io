/* 文章文件读写：只处理元数据与文件名，不改写 Markdown 正文。 */
(function (root) {
  "use strict";

  function yaml() {
    var library = root.BlogVendor && root.BlogVendor.YAML;
    if (!library) throw new Error("文章文件工具尚未加载，请刷新页面。");
    return library;
  }

  function todayShanghai() {
    var parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit"
    }).formatToParts(new Date());
    var values = {};
    parts.forEach(function (part) { values[part.type] = part.value; });
    return values.year + "-" + values.month + "-" + values.day;
  }

  function isDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    var parts = value.split("-").map(Number);
    var year = parts[0], month = parts[1], day = parts[2];
    var leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    var days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
  }

  /* Jekyll 常见日期格式：日期，或日期 + 时间 + 可选时区。 */
  function datePart(value) {
    if (typeof value !== "string") return "";
    var match = value.trim().match(/^(\d{4}-\d{2}-\d{2})(?:[Tt ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:\s*(Z|[+-]\d{2}:?\d{2}))?)?$/);
    if (!match || !isDate(match[1])) return "";
    if (match[2] && (+match[2] > 23 || +match[3] > 59 || +(match[4] || 0) > 59)) return "";
    if (match[5] && match[5] !== "Z") {
      var offset = match[5].replace(":", "");
      if (+offset.slice(1, 3) > 23 || +offset.slice(3, 5) > 59) return "";
    }
    return match[1];
  }

  function textField(value, label) {
    if (value == null) return "";
    if (typeof value !== "string") throw new Error(label + "需要填写文字；数字或特殊内容请用引号包住。");
    return value;
  }

  function safeFilename(filename) {
    if (typeof filename !== "string" || !filename || /[<>:"/\\|?*\x00-\x1f\x7f]/.test(filename) || filename.includes("..") || /[. ]$/.test(filename)) {
      throw new Error("文章文件名不能包含路径、连续句点或文件系统特殊字符。");
    }
    if (!/^\d{4}-\d{2}-\d{2}-.+\.(md|markdown)$/i.test(filename) || !isDate(filename.slice(0, 10))) {
      throw new Error("文章文件名应为有效的 YYYY-MM-DD-短名.md 格式。");
    }
    return filename;
  }

  function safeSlug(value) {
    if (typeof value !== "string" || /[<>:"/\\|?*\x00-\x1f\x7f]/.test(value) || value.includes("..")) {
      throw new Error("文章短名不能包含路径、连续句点或文件系统特殊字符。");
    }
    var slug = value.normalize("NFC").trim().toLowerCase()
      .replace(/[^\p{L}\p{N}_-]+/gu, "-").replace(/-+/g, "-").replace(/^[-_]+|[-_]+$/g, "");
    if (!slug) throw new Error("请填写文章短名，例如 my-note 或 我的记录。");
    return slug;
  }

  function parseArticle(text, filename) {
    if (typeof text !== "string") throw new Error("请选择 Markdown 文字文件。");
    text = text.replace(/^\uFEFF/, "");
    var originalFilename = filename ? safeFilename(filename) : "";
    var metadata = {};
    var markdown = text;
    var start = text.match(/^---[ \t]*(?:\r?\n|$)/);

    if (start) {
      var rest = text.slice(start[0].length);
      var end = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m.exec(rest);
      if (!end) throw new Error("文章开头的配置没有结束，请在配置后补上一行 ---。");
      try {
        metadata = yaml().load(rest.slice(0, end.index), { schema: yaml().CORE_SCHEMA });
      } catch (error) {
        throw new Error("文章开头的 YAML 配置有误：" + error.message);
      }
      if (metadata == null) metadata = {};
      if (typeof metadata !== "object" || Array.isArray(metadata)) {
        throw new Error("文章开头的配置应为 title、date 等键值，不能是列表或单独一段文字。");
      }
      markdown = rest.slice(end.index + end[0].length);
    }

    var date = metadata.date == null ? (originalFilename.slice(0, 10) || todayShanghai()) : datePart(metadata.date);
    if (!date) throw new Error("文章日期或时间无效，请使用 YYYY-MM-DD 或 YYYY-MM-DD HH:mm:ss +0800。");

    return {
      metadata: metadata,
      title: textField(metadata.title, "文章标题"),
      date: date,
      description: textField(metadata.description, "文章摘要"),
      slug: textField(metadata.slug, "网址短名") || (originalFilename ? originalFilename.slice(11).replace(/\.(md|markdown)$/i, "") : ""),
      markdown: markdown,
      originalFilename: originalFilename
    };
  }

  function filenameFor(article) {
    if (article.originalFilename) return safeFilename(article.originalFilename);
    if (!isDate(article.date)) throw new Error("请选择有效的文章日期（YYYY-MM-DD）。");
    // 自动短名可以清除标题标点；用户主动填写的短名则严格检查路径字符。
    var titleSlug = String(article.title || "").replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, "-").replace(/\.{2,}/g, "-");
    return article.date + "-" + safeSlug(article.slug || titleSlug) + ".md";
  }

  function originalSlug(article) {
    return textField(article.metadata?.slug, "网址短名") || (article.originalFilename ? safeFilename(article.originalFilename).slice(11).replace(/\.(md|markdown)$/i, "") : "");
  }
  function slugFor(article) {
    var original = originalSlug(article);
    var input = textField(article.slug, "网址短名").trim();
    if (!input || input === original) return original || filenameFor(article).slice(11).replace(/\.(md|markdown)$/i, "");
    return safeSlug(input);
  }
  // 对应本博客 /posts/:year/:month/:day/:title/ 的配置，用于提交前检查网址冲突。
  function urlPath(article) {
    var slug = slugFor(article);
    var values = { year: article.date.slice(0, 4), month: article.date.slice(5, 7), day: article.date.slice(8, 10), title: slug, slug: slug };
    var template = textField(article.metadata?.permalink, "固定链接") || "/posts/:year/:month/:day/:title/";
    if (!template.startsWith("/") || template.startsWith("//")) throw new Error("文章的固定链接格式不受支持，请先检查 permalink 配置。");
    var path = template.replace(/:([a-z_]+)/g, function (_, key) {
      if (!(key in values)) throw new Error("文章固定链接包含暂不支持的网址变量：" + key);
      return values[key];
    });
    return new URL(path, "https://kinguniverse527.github.io").pathname;
  }

  function contentErrors(article) {
    var errors = [];
    if (!article || typeof article !== "object") return ["没有可导出的文章。"];
    if (typeof article.title !== "string" || !article.title.trim()) errors.push("请填写文章标题。");
    if (!isDate(article.date)) errors.push("请选择有效的文章日期（YYYY-MM-DD）。");
    if (typeof article.description !== "string" && article.description != null) errors.push("文章摘要需要填写文字。");
    if (typeof article.markdown !== "string" || !article.markdown.trim()) errors.push("请填写文章正文。");
    if (article.metadata != null && (typeof article.metadata !== "object" || Array.isArray(article.metadata))) errors.push("文章元数据必须是键值配置。");
    try {
      var slug = slugFor(article);
      if (article.metadata?.permalink && !/:(?:title|slug)(?![a-z_])/.test(article.metadata.permalink) && slug !== originalSlug(article)) {
        errors.push("这篇文章设置了固定链接 permalink，修改短名不会改变网址。请在仓库文章头部修改 permalink。");
      }
    } catch (error) { errors.push(error.message); }
    return errors;
  }

  function validateArticle(article) {
    var errors = contentErrors(article);
    if (!article || typeof article !== "object") return errors;
    try { filenameFor(article); } catch (error) {
      if (!errors.includes(error.message)) errors.push(error.message);
    }
    return errors;
  }

  function serializeArticle(article) {
    // 序列化只要求内容有效，文件名由导出步骤单独检查。
    var errors = contentErrors(article);
    if (errors.length) throw new Error(errors.join("\n"));
    var original = article.metadata || {};
    var metadata = Object.assign(Object.create(null), original);
    metadata.title = article.title;
    metadata.date = datePart(original.date) === article.date ? original.date : article.date + " 00:00:00 +0800";
    metadata.description = article.description || "";
    // 改网址只更新 slug，原 Markdown 文件名保持稳定，避免产生重复文章。
    var slug = slugFor(article);
    if (Object.prototype.hasOwnProperty.call(original, "slug") || slug !== originalSlug(article)) metadata.slug = slug;
    var header = yaml().dump(metadata, { schema: yaml().CORE_SCHEMA, lineWidth: -1, sortKeys: false });
    return "---\n" + header + "---\n" + article.markdown;
  }

  var api = {
    parseArticle: parseArticle,
    serializeArticle: serializeArticle,
    filenameFor: filenameFor,
    slugFor: slugFor,
    urlPath: urlPath,
    validateArticle: validateArticle,
    todayShanghai: todayShanghai
  };
  root.BlogFiles = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
