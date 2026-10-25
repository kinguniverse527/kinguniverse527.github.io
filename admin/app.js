(async function () {
  'use strict';
  const $ = id => document.getElementById(id);
  function message(text, error = false) {
    $('message').textContent = text;
    $('message').classList.toggle('error', error);
  }
  if (!window.BlogVendor || !window.BlogFiles || !window.BlogDrafts) {
    message('编辑器文件未加载完整，请完整解压项目后重新打开。', true);
    return;
  }
  const V = window.BlogVendor;
  const F = window.BlogFiles;
  const DB = window.BlogDrafts;
  const preview = window.BlogPreview.create($('preview-frame'));
  const IMAGE_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' };
  const newId = () => crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random().toString(36).slice(2);
  let current = null;
  let attachments = [];
  let imageUrls = new Map();
  let sourceMode = false;
  let loading = false;
  let bodyChanged = false;
  let dirty = false;
  let revision = 0;
  let saveTimer;
  let renderTimer;
  let saveQueue = Promise.resolve();
  let githubPanel = null;
  let remoteBusy = false;
  let localBusy = false;
  let pendingLocalDelete = null;

  // 编辑器只处理正文；元数据、附件、预览、持久化分别由其他模块负责。
  const editor = new V.Editor({
    element: $('editor'),
    extensions: [
      V.StarterKit.configure({ underline: false, link: { openOnClick: false } }),
      V.Markdown.configure({ markedOptions: { gfm: true, breaks: false } }),
      V.Image.configure({ allowBase64: false }),
    ],
    content: '',
    contentType: 'markdown',
    editorProps: {
      attributes: { role: 'textbox', 'aria-label': '文章正文', 'aria-multiline': 'true', spellcheck: 'false' },
      transformPastedHTML: html => V.DOMPurify.sanitize(html),
      handlePaste: (view, event) => {
        const images = Array.from(event.clipboardData?.files || []).filter(file => file.type.startsWith('image/'));
        if (!images.length) return false;
        event.preventDefault();
        insertImages(images).catch(error => message(error.message, true));
        return true;
      },
      handleDrop: (view, event) => {
        const images = Array.from(event.dataTransfer?.files || []).filter(file => file.type.startsWith('image/'));
        if (!images.length) return false;
        event.preventDefault();
        insertImages(images).catch(error => message(error.message, true));
        return true;
      },
    },
    onUpdate: () => { if (!loading) { bodyChanged = true; changed(); } },
    onSelectionUpdate: () => updateToolbar(),
  });

  function emptyArticle() {
    return { metadata: {}, title: '', date: F.todayShanghai(), description: '', slug: '', markdown: '', originalFilename: '' };
  }
  function needsSource(markdown) {
    const plain = markdown.replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, '').replace(/^~~~[^\n]*\n[\s\S]*?^~~~\s*$/gm, '');
    if (/\{[{%]|^\s*\[[^\]]+\]:|^\s*\{:|^\s*\$\$/m.test(plain)) return true;
    let unsupported = false;
    const supported = new Set(['space', 'heading', 'paragraph', 'text', 'list', 'list_item', 'blockquote', 'code', 'hr', 'strong', 'em', 'codespan', 'br', 'link', 'image', 'escape', 'del']);
    V.marked.walkTokens(V.marked.lexer(markdown), token => {
      if (!supported.has(token.type) || token.task) unsupported = true;
    });
    return unsupported;
  }
  function rebuildImageUrls() {
    for (const url of imageUrls.values()) URL.revokeObjectURL(url);
    imageUrls = new Map(attachments.map(asset => ['/' + asset.path, URL.createObjectURL(asset.blob)]));
  }
  function imageUrl(src) {
    try { src = decodeURI(src); } catch { /* 非编码路径按原文处理。 */ }
    return imageUrls.get(src) || imageUrls.get('/' + src) || null;
  }
  function canonicalMarkdown(markdown) {
    for (const [path, url] of imageUrls) markdown = markdown.replaceAll(url, path);
    return markdown;
  }
  function editorMarkdown(markdown) {
    for (const [path, url] of imageUrls) markdown = markdown.replaceAll(path, url).replaceAll(path.slice(1), url).replaceAll(encodeURI(path), url).replaceAll(encodeURI(path.slice(1)), url);
    // 既有图片在本地项目内读取；正文导出仍保留原路径。
    return markdown;
  }
  function articleNow() {
    return {
      ...current.article,
      title: $('title').value.trim(),
      date: $('date').value,
      description: $('description').value,
      slug: $('slug').value.trim(),
      markdown: sourceMode ? $('source-editor').value : (bodyChanged ? canonicalMarkdown(editor.getMarkdown()) : current.article.markdown),
    };
  }
  function changed() {
    if (loading || !current) return;
    dirty = true;
    revision += 1;
    $('save-status').textContent = '等待保存…';
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, 160);
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => persist().catch(error => message(error.message, true)), 700);
  }
  function render() {
    if (!current) return;
    const article = articleNow();
    preview.update(article, imageUrl);
    const count = sourceMode ? article.markdown.replace(/\s/g, '').length : editor.getText().replace(/\s/g, '').length;
    $('word-count').textContent = count + ' 字';
    updateToolbar();
  }
  function setMode(raw, markdown) {
    sourceMode = raw;
    $('source-editor').hidden = !raw;
    $('source-notice').hidden = !raw;
    $('editor').hidden = raw;
    $('format-toolbar').hidden = raw;
    $('source-toggle').textContent = raw ? '返回可视化' : '查看原文';
    $('source-toggle').setAttribute('aria-pressed', String(raw));
    if (raw) $('source-editor').value = markdown;
    else editor.commands.setContent(editorMarkdown(markdown), { contentType: 'markdown', emitUpdate: false });
  }
  async function openDraft(draft) {
    loading = true;
    clearTimeout(saveTimer);
    clearTimeout(renderTimer);
    current = draft;
    attachments = draft.attachments || [];
    rebuildImageUrls();
    for (const key of ['title', 'date', 'description', 'slug']) $(key).value = draft.article[key] || '';
    $('slug').readOnly = false;
    $('slug').title = '修改短名后提交即可更新网址；留空沿用原短名。';
    setMode(needsSource(draft.article.markdown), draft.article.markdown);
    bodyChanged = false;
    dirty = false;
    revision = 0;
    loading = false;
    $('save-status').textContent = draft.updatedAt ? '已恢复本机草稿' : '开始编辑后自动保存';
    $('publish-result').hidden = true;
    render();
    githubPanel?.update();
    await refreshList();
  }
  function snapshot() {
    return { id: current.id, article: articleNow(), remote: current.remote || null, attachments: attachments.map(asset => ({ path: asset.path, blob: asset.blob, remoteSha: asset.remoteSha || null })) };
  }
  async function persist() {
    clearTimeout(saveTimer);
    if (!current) return;
    const data = snapshot();
    const version = revision;
    $('save-status').textContent = '保存中…';
    const operation = saveQueue.catch(() => {}).then(() => DB.save(data));
    saveQueue = operation;
    try {
      const saved = await operation;
      if (current.id === data.id && revision === version) {
        current.updatedAt = saved.updatedAt;
        dirty = false;
        $('save-status').textContent = '已保存到本机 · ' + new Date(saved.updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
      }
      await refreshList();
    } catch (error) {
      $('save-status').textContent = '保存失败，请先导出备份';
      throw error;
    }
  }
  async function beforeSwitch() {
    while (dirty) await persist();
    await saveQueue.catch(() => {});
  }
  async function refreshList() {
    try {
      const drafts = await DB.list();
      const list = $('draft-list');
      list.replaceChildren();
      if (!drafts.length) {
        const text = document.createElement('p'); text.className = 'subtle'; text.textContent = '还没有保存的草稿'; list.append(text);
      }
      for (const draft of drafts) {
        const row = document.createElement('div'); row.className = 'draft-row'; row.dataset.draftId = draft.id;
        const button = document.createElement('button');
        button.className = 'draft-item'; button.type = 'button';
        button.setAttribute('aria-current', String(draft.id === current?.id));
        const title = document.createElement('strong'); title.textContent = draft.article?.title || '未命名文章';
        const date = document.createElement('small'); date.textContent = draft.article?.date || '';
        button.append(title, date);
        button.addEventListener('click', () => run(async () => { await beforeSwitch(); await openDraft(await DB.get(draft.id)); message('已打开本机草稿。'); }));
        const remove = document.createElement('button');
        remove.type = 'button'; remove.className = 'draft-remove'; remove.textContent = '删除';
        remove.setAttribute('aria-label', '删除本机草稿：' + (draft.article?.title || '未命名文章'));
        remove.addEventListener('click', () => run(async () => {
          await beforeSwitch();
          const target = await DB.get(draft.id);
          if (!target) { await refreshList(); return; }
          pendingLocalDelete = target.id;
          $('delete-local-description').textContent = '确定删除本机草稿“' + (target.article?.title || '未命名文章') + '”吗？';
          $('delete-local-dialog').showModal();
        }));
        row.append(button, remove); list.append(row);
      }
    } catch (error) { message(error.message, true); }
  }
  async function insertImages(files) {
    if (sourceMode) throw new Error('请在可视化模式中插入图片。');
    for (const file of files) {
      const ext = IMAGE_TYPES[file.type];
      if (!ext) throw new Error('图片支持 PNG、JPG、WebP 和 GIF。');
      if (file.size > 8 * 1024 * 1024) throw new Error('单张图片请控制在 8MB 以内。');
      const path = 'assets/images/' + F.todayShanghai() + '-' + newId().slice(0, 12) + '.' + ext;
      attachments.push({ path, blob: file });
      const url = URL.createObjectURL(file);
      imageUrls.set('/' + path, url);
      editor.chain().focus().setImage({ src: url, alt: file.name.replace(/\.[^.]+$/, '') }).run();
    }
    bodyChanged = true;
    changed();
    message('图片已插入。导出时会与文章一起打包。');
  }
  function updateToolbar() {
    document.querySelectorAll('[data-command]').forEach(button => {
      const command = button.dataset.command;
      if (!['undo', 'redo'].includes(command)) button.setAttribute('aria-pressed', String(editor.isActive(command)));
    });
    $('block-format').value = editor.isActive('heading', { level: 2 }) ? 'h2' : editor.isActive('heading', { level: 3 }) ? 'h3' : 'paragraph';
  }
  function run(action) { if (remoteBusy || localBusy) return; return Promise.resolve().then(action).catch(error => message(error.message || '操作未完成，请重试。', true)); }
  function updateBusy() {
    const busy = remoteBusy || localBusy;
    document.body.dataset.busy = String(busy);
    document.querySelector('.workspace').inert = busy;
    document.querySelector('.header-actions').inert = busy;
    editor.setEditable(!busy, false);
  }
  function download(name, data, type) {
    const url = URL.createObjectURL(new Blob([data], { type }));
    const link = document.createElement('a'); link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }
  async function exportArticle() {
    const article = articleNow();
    const errors = F.validateArticle(article);
    if (errors.length) throw new Error(errors.join(' '));
    if (article.date > F.todayShanghai()) throw new Error('当前博客不自动定时发布。请将日期改为今天或更早，再导出。');
    if (/blob:|data:image\//i.test(article.markdown)) throw new Error('正文包含未归档的临时图片，请重新插入图片后导出。');
    const name = F.filenameFor(article);
    const text = F.serializeArticle(article);
    const used = attachments.filter(asset => article.markdown.includes(asset.path));
    if (used.length) {
      const entries = { ['_posts/' + name]: V.fflate.strToU8(text) };
      for (const asset of used) entries[asset.path] = new Uint8Array(await asset.blob.arrayBuffer());
      download(name.replace(/\.(md|markdown)$/i, '') + '.zip', V.fflate.zipSync(entries, { level: 6 }), 'application/zip');
      message('已导出文章和图片。解压后，将 _posts 和 assets 中的文件放到仓库相同位置并提交。');
    } else {
      download(name, text, 'text/markdown;charset=utf-8');
      message('已导出 ' + name + '。把它上传到仓库的 _posts 文件夹并提交即可发布。');
    }
    await persist();
  }
  async function importFile(file) {
    if (file.size > 40 * 1024 * 1024) throw new Error('导入文件请控制在 40MB 以内。');
    let text, filename, importedAssets = [];
    if (/\.zip$/i.test(file.name)) {
      let extractedSize = 0;
      const content = V.fflate.unzipSync(new Uint8Array(await file.arrayBuffer()), { filter(entry) {
        const name = entry.name;
        if (name.includes('..') || name.startsWith('/') || name.includes('\\')) throw new Error('压缩包包含不支持的路径。');
        extractedSize += entry.originalSize;
        if (extractedSize > 60 * 1024 * 1024) throw new Error('解压内容过大，请使用单篇文章的发布包。');
        return !name.endsWith('/');
      } });
      const posts = Object.keys(content).filter(name => /^_posts\/[^/]+\.(md|markdown)$/i.test(name));
      if (posts.length !== 1) throw new Error('请打开本编辑器导出的单篇文章压缩包，里面应只有一篇文章。');
      filename = posts[0].slice(7); text = V.fflate.strFromU8(content[posts[0]]);
      for (const [name, bytes] of Object.entries(content)) {
        const match = name.match(/^assets\/images\/[\w\p{L}.-]+\.(png|jpe?g|webp|gif)$/iu);
        if (match) importedAssets.push({ path: name, blob: new Blob([bytes], { type: match[1].toLowerCase().startsWith('jp') ? 'image/jpeg' : 'image/' + match[1].toLowerCase() }) });
      }
    } else {
      text = await file.text(); filename = /^\d{4}-\d{2}-\d{2}-.+\.(md|markdown)$/i.test(file.name) ? file.name : undefined;
    }
    const article = F.parseArticle(text, filename);
    await beforeSwitch();
    await openDraft({ id: newId(), article, attachments: importedAssets });
    await persist();
    message(needsSource(article.markdown) ? '已保留原文打开：这篇文章含有高级格式。可修改资料并导出，正文保持原样。' : '已打开文章。标题、正文和未知元数据都会随文章一起保存。');
  }

  ['title', 'date', 'description', 'slug'].forEach(id => $(id).addEventListener('input', changed));
  $('source-editor').addEventListener('input', () => { bodyChanged = true; changed(); });
  $('save-button').addEventListener('click', () => run(persist));
  $('export-button').addEventListener('click', () => run(exportArticle));
  $('new-button').addEventListener('click', () => run(async () => { await beforeSwitch(); await openDraft({ id: newId(), article: emptyArticle(), attachments: [] }); $('title').focus(); message('新文章已准备好。'); }));
  $('cancel-delete-local').addEventListener('click', () => { if (!localBusy) $('delete-local-dialog').close(); });
  $('delete-local-dialog').addEventListener('close', () => { pendingLocalDelete = null; });
  $('delete-local-dialog').addEventListener('cancel', event => { if (localBusy) event.preventDefault(); });
  $('confirm-delete-local').addEventListener('click', () => run(async () => {
    const id = pendingLocalDelete;
    if (!id) return;
    localBusy = true; updateBusy();
    $('confirm-delete-local').disabled = true; $('cancel-delete-local').disabled = true;
    try {
      // 等待自动保存真正结束，避免删除后排队中的保存再次写回同一草稿。
      clearTimeout(saveTimer);
      await beforeSwitch();
      await DB.remove(id);
      if (current?.id === id) await openDraft({ id: newId(), article: emptyArticle(), attachments: [] });
      else await refreshList();
      $('delete-local-dialog').close();
      message('本机草稿已删除，GitHub 上的文章不受影响。');
    } catch (error) {
      $('delete-local-dialog').close();
      message('删除本机草稿失败：' + (error.message || '请重试。'), true);
    } finally {
      localBusy = false; updateBusy();
      $('confirm-delete-local').disabled = false; $('cancel-delete-local').disabled = false;
    }
  }));
  $('import-button').addEventListener('click', () => $('article-file').click());
  $('article-file').addEventListener('change', () => run(async () => { const file = $('article-file').files[0]; $('article-file').value = ''; if (file) await importFile(file); }));
  $('image-button').addEventListener('click', () => $('image-file').click());
  $('image-file').addEventListener('change', () => run(async () => { const files = Array.from($('image-file').files); $('image-file').value = ''; await insertImages(files); }));
  $('help-button').addEventListener('click', () => $('help-dialog').showModal());
  $('source-toggle').addEventListener('click', () => run(() => {
    const markdown = articleNow().markdown;
    if (sourceMode && needsSource(markdown)) throw new Error('正文包含高级格式，请继续使用原文模式，以免转换时丢失内容。');
    loading = true; setMode(!sourceMode, markdown); loading = false; render();
  }));
  $('format-toolbar').addEventListener('mousedown', event => { if (event.target.closest('button')) event.preventDefault(); });
  document.querySelectorAll('[data-command]').forEach(button => button.addEventListener('click', () => run(() => {
    const command = button.dataset.command;
    const chain = editor.chain().focus();
    const commands = { bold: 'toggleBold', italic: 'toggleItalic', bulletList: 'toggleBulletList', orderedList: 'toggleOrderedList', blockquote: 'toggleBlockquote', codeBlock: 'toggleCodeBlock', undo: 'undo', redo: 'redo' };
    if (command === 'link') {
      const href = window.prompt('输入链接地址；留空可移除链接。', editor.getAttributes('link').href || 'https://');
      if (href === null) return;
      if (!href.trim()) chain.extendMarkRange('link').unsetLink().run();
      else if (/^(https?:\/\/|mailto:|#)/i.test(href.trim())) chain.extendMarkRange('link').setLink({ href: href.trim() }).run();
      else throw new Error('请输入以 https://、http:// 或 mailto: 开头的链接。');
    } else chain[commands[command]]().run();
    updateToolbar();
  })));
  $('block-format').addEventListener('change', () => {
    const value = $('block-format').value;
    if (value === 'paragraph') editor.chain().focus().setParagraph().run();
    else editor.chain().focus().setHeading({ level: Number(value.slice(1)) }).run();
  });
  for (const mode of ['desktop', 'mobile']) $(mode + '-view').addEventListener('click', () => {
    $('preview-stage').classList.toggle('mobile', mode === 'mobile');
    $('desktop-view').setAttribute('aria-pressed', String(mode === 'desktop'));
    $('mobile-view').setAttribute('aria-pressed', String(mode === 'mobile'));
  });
  $('sample-button').addEventListener('click', () => run(async () => {
    await beforeSwitch();
    const article = emptyArticle();
    Object.assign(article, { title: '给未来的自己，留一个入口', slug: 'a-place-to-begin', description: '建立这个小小的空间，保存此刻对生活的感受。', markdown: 'I created this space to capture how I see and feel about life.\n\nPerhaps one day, when I return,  \nI’ll see things differently.' });
    await openDraft({ id: newId(), article, attachments: [] });
    message('示例已打开。可以直接修改，或新建自己的文章。');
  }));
  window.addEventListener('beforeunload', event => { if (dirty || remoteBusy || localBusy) { event.preventDefault(); event.returnValue = ''; } });
  document.addEventListener('keydown', event => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); run(persist); } });

  try {
    const drafts = await DB.list();
    await openDraft(drafts[0] || { id: newId(), article: emptyArticle(), attachments: [] });
  } catch (error) {
    await openDraft({ id: newId(), article: emptyArticle(), attachments: [] });
    message(error.message, true);
  }
  githubPanel = window.BlogGitHubPanel.mount({
    getDraft: snapshot,
    flush: beforeSwitch,
    message,
    setBusy(busy) {
      remoteBusy = busy;
      updateBusy();
    },
    async openRemote(article, assets, remote) {
      const existing = (await DB.list()).find(draft => draft.remote &&
        ['owner', 'repo', 'branch', 'path', 'sha'].every(key => draft.remote[key] === remote[key]) &&
        !draft.remote.uncertain && !draft.remote.deleted);
      if (existing) {
        await openDraft(existing);
        return true;
      }
      await openDraft({ id: newId(), article, attachments: assets, remote });
      dirty = true;
      await persist();
      return false;
    },
    async updateRemote(remote) {
      current.remote = remote;
      if (remote?.sha && !remote.uncertain && !remote.deleted) {
        const published = F.parseArticle(F.serializeArticle(articleNow()), remote.path.split('/').pop());
        current.article.metadata = published.metadata;
        current.article.slug = published.slug;
        $('slug').value = published.slug;
      }
      if (remote?.path) current.article.originalFilename = remote.path.split('/').pop();
      $('slug').readOnly = false;
      dirty = true;
      await persist();
    },
  });
  // 就绪标志仅供本地检查；业务状态通过各模块管理。
  document.documentElement.dataset.writerReady = 'true';
})();
