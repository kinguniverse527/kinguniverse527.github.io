/* GitHub 连接界面与文章工作流；编辑器和 API 客户端通过小接口组合。 */
(function (root) {
  'use strict';
  const $ = id => document.getElementById(id);
  const F = root.BlogFiles;
  const Session = root.BlogGitHubSession;
  const defaults = { owner: 'kinguniverse527', repo: 'kinguniverse527.github.io', branch: 'main' };
  const SETTINGS_KEY = 'king-universe-github-settings';

  async function eachLimited(values, action) {
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(3, values.length) }, async () => {
      while (next < values.length) await action(values[next++]);
    }));
  }

  function mount(editor) {
    let settings = { ...defaults };
    try {
      const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null');
      for (const key of Object.keys(defaults)) if (typeof saved?.[key] === 'string') settings[key] = saved[key];
    } catch { /* 无本地设置时使用博客默认值。 */ }
    let client = root.BlogGitHub.create({ ...settings, readOnly: true });
    let identity = null;
    let busy = false;
    let pendingDelete = null;
    let items = [];
    let listVersion = 0;
    let connectionVersion = 0;
    const titles = new Map();
    const searchTexts = new Map();
    for (const key of Object.keys(defaults)) $('github-' + key).value = settings[key];

    const sameRepository = remote => remote && remote.owner === settings.owner && remote.repo === settings.repo && remote.branch === settings.branch;
    function repositoryURL() { return 'https://github.com/' + encodeURIComponent(settings.owner) + '/' + encodeURIComponent(settings.repo); }
    function update() {
      const remote = editor.getDraft().remote;
      $('connection-badge').textContent = identity ? 'GitHub 已连接 · ' + identity : '公开文章 · 连接后可发布';
      $('connect-button').textContent = identity ? '账号设置' : '连接 GitHub';
      $('disconnect-button').hidden = !identity && !Session.load();
      $('refresh-remote').disabled = !client || busy;
      $('publish-button').disabled = !identity || busy;
      $('publish-button').textContent = remote && !remote.deleted ? '更新线上文章 ↗' : '发布到博客 ↗';
      $('delete-remote').hidden = !(identity && sameRepository(remote) && remote.sha && !remote.deleted && !remote.uncertain);
      $('article-origin').textContent = remote ? (remote.deleted ? '已删除线上版本 · 本机草稿保留' : remote.uncertain ? '提交结果待确认 · 请重新打开线上版本核对' : '关联文章：' + remote.path) : '本机草稿 · 尚未关联线上文章';
    }
    async function perform(action) {
      if (busy) return;
      busy = true;
      editor.setBusy(true);
      $('connect-form').inert = true;
      try { await action(); }
      catch (error) {
        if (error.code === 'UNAUTHORIZED' || error.status === 401) {
          try { Session.clear(); } catch { /* 本次连接仍会失效。 */ }
          usePublicClient();
        }
        editor.message(error.message || '操作未完成，请重试。', true);
      }
      finally {
        busy = false;
        editor.setBusy(false);
        $('connect-form').inert = false;
        update();
      }
    }
    function setupLink() {
      const params = new URLSearchParams({ name: '博客写作室', description: '仅供个人博客文章管理', target_name: $('github-owner').value.trim(), expires_in: '30', contents: 'write' });
      $('create-token-link').href = 'https://github.com/settings/personal-access-tokens/new?' + params;
    }
    function usePublicClient() {
      connectionVersion += 1; listVersion += 1;
      client?.disconnect();
      client = root.BlogGitHub.create({ ...settings, readOnly: true });
      identity = null; items = []; titles.clear(); searchTexts.clear();
      $('remote-list').replaceChildren();
      update();
    }
    function filterPosts() {
      const query = $('article-search').value.trim().toLocaleLowerCase();
      const paths = new Map(items.map(item => [item.path, item]));
      let count = 0;
      for (const button of $('remote-list').children) {
        const item = paths.get(button.dataset.path);
        const text = item ? [item.path, titles.get(item.sha) || '', searchTexts.get(item.sha) || ''].join('\n') : '';
        button.hidden = Boolean(query && !text.toLocaleLowerCase().includes(query));
        if (!button.hidden) count += 1;
      }
      $('search-status').textContent = query ? '找到 ' + count + ' / ' + items.length + ' 篇文章' : '';
    }
    $('article-search').addEventListener('input', filterPosts);
    async function refresh() {
      const activeClient = client;
      const version = ++listVersion;
      $('remote-status').textContent = '正在读取文章列表…';
      const listed = await activeClient.listPosts();
      if (version !== listVersion || client !== activeClient) return;
      items = listed;
      $('remote-list').replaceChildren();
      const pending = [];
      const summary = items.length ? settings.branch + ' · ' + items.length + ' 篇文章' : '还没有文章。点 ＋ 写第一篇，发布时会自动创建 _posts。';
      for (const item of items) {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'draft-item'; button.dataset.path = item.path;
        const name = document.createElement('strong');
        name.textContent = titles.get(item.sha) || '正在读取标题…';
        const date = document.createElement('small'); date.textContent = item.name.slice(0, 10);
        button.title = name.textContent + '\n' + item.path; button.append(name, date);
        button.addEventListener('click', () => perform(() => openPost(item.path)));
        $('remote-list').append(button);
        if (!titles.has(item.sha)) pending.push({ item, name, button });
      }
      $('remote-status').textContent = summary + (pending.length ? ' · 正在读取标题…' : '');
      filterPosts();
      // 后台逐项补齐标题，不阻塞打开文章；正文同时进入客户端缓存。
      let failed = 0;
      void eachLimited(pending, async ({ item, name, button }) => {
        if (version !== listVersion || client !== activeClient) return;
        try {
          const file = await activeClient.readPost(item.path, item.headSha);
          const article = F.parseArticle(file.text, item.name);
          if (version !== listVersion || client !== activeClient) return;
          const title = article.title.trim() || '未命名文章';
          titles.set(item.sha, title);
          searchTexts.set(item.sha, article.markdown + '\n' + article.description);
          name.textContent = title; button.title = title + '\n' + item.path;
          filterPosts();
        } catch {
          if (version !== listVersion || client !== activeClient) return;
          failed += 1;
          name.textContent = '标题读取失败 · ' + item.name;
          button.title = '点击尝试打开文章；也可以刷新重试。\n' + item.path;
        }
      }).then(() => {
        if (version === listVersion && client === activeClient) $('remote-status').textContent = summary + (failed ? ' · ' + failed + ' 篇标题读取失败，可刷新重试' : '');
      }).catch(() => { /* 单篇失败已保留重试入口。 */ });
    }
    async function refreshAfterWrite() {
      try { await refresh(); }
      catch { $('remote-status').textContent = '提交已完成，列表刷新失败；稍后点“刷新”。'; }
    }
    function sourceAssets(markdown) {
      const paths = new Set();
      root.BlogVendor.marked.walkTokens(root.BlogVendor.marked.lexer(markdown), token => {
        if (token.type !== 'image') return;
        let name;
        try { name = decodeURIComponent(token.href).replace(/^\//, ''); } catch { return; }
        if (/^assets\/images\/(?:[\p{L}\p{N}_. -]+\/)*[\p{L}\p{N}_. -]+\.(png|jpe?g|webp|gif)$/iu.test(name) && !name.includes('..')) paths.add(name);
      });
      return [...paths];
    }
    async function openPost(path) {
      const activeClient = client;
      const activeSettings = { ...settings };
      await editor.flush();
      editor.message('正在读取线上文章和图片…');
      const file = await activeClient.readPost(path);
      const article = F.parseArticle(file.text, path.split('/').pop());
      const assets = [];
      let failed = 0, total = 0;
      await eachLimited(sourceAssets(article.markdown), async imagePath => {
        try {
          const image = await activeClient.getFile(imagePath, file.headSha);
          if (image.bytes.length > 8 * 1024 * 1024 || total + image.bytes.length > 40 * 1024 * 1024) throw new Error('图片过大');
          total += image.bytes.length;
          const ext = imagePath.split('.').pop().toLowerCase();
          assets.push({ path: imagePath, remoteSha: image.sha, blob: new Blob([image.bytes], { type: /^jpe?g$/.test(ext) ? 'image/jpeg' : 'image/' + ext }) });
        } catch { failed += 1; }
      });
      if (client !== activeClient) return;
      const restored = await editor.openRemote(article, assets, { ...activeSettings, path, sha: file.sha, commitSha: file.headSha });
      editor.message((restored ? '已恢复这篇文章的本机草稿，保留尚未提交的修改。' : '已打开线上文章。本机草稿会自动保存。') + (identity ? '点“更新线上文章”才会提交。' : '连接 GitHub 后即可提交修改。') + (failed ? ' 有 ' + failed + ' 张图片未能下载，原引用已保留。' : ''));
    }
    function validate(article) {
      const errors = F.validateArticle(article);
      if (errors.length) throw new Error(errors.join(' '));
      if (article.date > F.todayShanghai()) throw new Error('当前博客不自动定时发布。请改为今天或更早的日期。');
      if (/blob:|data:image\//i.test(article.markdown)) throw new Error('正文有未归档的临时图片，请重新插入后再发布。');
    }
    function showResult(result, deleted, unpublished) {
      $('publish-result').hidden = false;
      $('publish-result-text').textContent = deleted ? '已提交删除，等待网站部署。' : unpublished ? '已提交；文章保留 published: false，不会出现在公开博客。' : '已提交到 GitHub，等待网站部署。';
      $('commit-link').href = repositoryURL() + '/commit/' + encodeURIComponent(result.commitSha);
      $('deploy-link').href = repositoryURL() + '/actions';
    }
    async function remember(remote) {
      try { await editor.updateRemote(remote); return true; }
      catch { return false; }
    }
    async function publish() {
      if (!identity) throw new Error('请先连接 GitHub。');
      await editor.flush();
      const draft = editor.getDraft();
      validate(draft.article);
      if (draft.remote && !sameRepository(draft.remote)) throw new Error('这篇草稿关联另一个仓库或分支。请连接原仓库，或导出后重新导入为新文章。');
      if (draft.remote?.uncertain) throw new Error('上次提交结果尚未确认。请先导出备份，再从左侧重新打开线上文章核对。');
      const path = draft.remote?.path || '_posts/' + F.filenameFor(draft.article);
      let expectedHeadSha;
      let urlChanged = false;
      const previous = draft.article.originalFilename ? F.parseArticle('---\n' + root.BlogVendor.YAML.dump(draft.article.metadata || {}) + '---\n' + draft.article.markdown, draft.article.originalFilename) : null;
      if (!draft.remote || draft.remote.deleted || !previous || F.slugFor(draft.article) !== F.slugFor(previous) || draft.article.date !== previous.date) {
        editor.message('正在检查文章网址是否重复…');
        const destination = F.urlPath(draft.article);
        urlChanged = Boolean(draft.remote && !draft.remote.deleted && previous && destination !== F.urlPath(previous));
        const listed = await client.listPosts();
        expectedHeadSha = listed[0]?.headSha;
        await eachLimited(listed.filter(item => item.path !== path), async item => {
          const file = await client.readPost(item.path, item.headSha);
          const other = F.parseArticle(file.text, item.name);
          if (F.urlPath(other) === destination) throw new Error('新网址已被文章“' + (other.title || item.name) + '”使用，请换一个网址短名。');
        });
      }
      const assets = [];
      for (const asset of draft.attachments) {
        if (!asset.remoteSha && draft.article.markdown.includes(asset.path)) assets.push({ path: asset.path, bytes: new Uint8Array(await asset.blob.arrayBuffer()) });
      }
      editor.message('正在提交文章和图片，请保持页面打开…');
      let result;
      try {
        result = await client.publish({ path, text: F.serializeArticle(draft.article), expectedSha: draft.remote?.deleted ? null : draft.remote?.sha || null, expectedHeadSha, assets, message: (draft.remote && !draft.remote.deleted ? '更新文章：' : '发布文章：') + draft.article.title });
      } catch (error) {
        if (error.uncertain) await remember({ ...settings, ...draft.remote, path, uncertain: true });
        throw error;
      }
      const saved = await remember({ ...settings, path, sha: result.sha, commitSha: result.commitSha });
      showResult(result, false, draft.article.metadata?.published === false);
      editor.message(saved ? '文章已提交。部署完成后，读者才会看到新版本。' + (urlChanged ? ' 网址已更新，旧网址不会自动跳转，请更新之前分享的链接。' : '') : 'GitHub 提交已完成，但本机草稿保存失败。请导出备份，不要重复提交。', !saved);
      await refreshAfterWrite();
    }
    async function removePost() {
      const draft = editor.getDraft();
      if (!identity || !sameRepository(draft.remote) || !draft.remote.sha || draft.remote.deleted) throw new Error('请先打开要删除的线上文章。');
      pendingDelete = { ...draft.remote, draftId: draft.id };
      $('delete-description').textContent = '将从 ' + settings.owner + '/' + settings.repo + '（' + settings.branch + '）删除：' + draft.article.title + '，文件 ' + draft.remote.path;
      $('delete-dialog').showModal();
    }
    $('confirm-delete').addEventListener('click', () => {
      const target = pendingDelete;
      pendingDelete = null; $('delete-dialog').close();
      if (!target) return;
      perform(async () => {
        if (editor.getDraft().id !== target.draftId || !sameRepository(target)) throw new Error('文章已切换，请重新选择要删除的文章。');
        await editor.flush();
        editor.message('正在提交删除…');
        let result;
        try { result = await client.deletePost({ path: target.path, expectedSha: target.sha, message: '删除文章：' + target.path }); }
        catch (error) { if (error.uncertain) await remember({ ...target, uncertain: true }); throw error; }
        const saved = await remember({ ...settings, path: target.path, sha: null, deleted: true, commitSha: result.commitSha });
        showResult(result, true);
        editor.message(saved ? '已从 GitHub 删除文章。本机草稿和图片保留，等待网站部署。' : '线上删除已提交，但本机草稿更新失败。请导出备份。', !saved);
        await refreshAfterWrite();
      });
    });
    $('cancel-delete').addEventListener('click', () => { pendingDelete = null; $('delete-dialog').close(); });
    $('connect-button').addEventListener('click', () => {
      setupLink(); $('connection-message').textContent = '';
      $('remember-connection').checked = Boolean(Session.load());
      $('token-guide').open = !identity && !Session.load();
      $('connect-dialog').showModal();
    });
    $('cancel-connect').addEventListener('click', () => $('connect-dialog').close());
    $('connect-dialog').addEventListener('close', () => { $('github-token').value = ''; });
    $('connect-dialog').addEventListener('cancel', event => { if (busy) event.preventDefault(); });
    $('github-owner').addEventListener('input', setupLink);
    $('connect-form').addEventListener('submit', event => {
      event.preventDefault();
      perform(async () => {
        const version = ++connectionVersion;
        const next = Object.fromEntries(Object.keys(defaults).map(key => [key, $('github-' + key).value.trim()]));
        let credential = $('github-token').value.trim();
        let candidate;
        try {
          candidate = root.BlogGitHub.create({ ...next, token: credential });
          $('github-token').value = '';
          $('connection-message').textContent = '正在验证连接…';
          const result = await candidate.verify();
          if (version !== connectionVersion) { candidate.disconnect(); return; }
          client?.disconnect(); client = candidate; candidate = null;
          listVersion += 1; titles.clear(); searchTexts.clear();
          settings = next; identity = result.login;
          let storageMessage = '';
          try {
            if ($('remember-connection').checked) Session.save(credential, settings);
            else Session.clear();
          } catch { storageMessage = ' 浏览器未能更新连接记忆；本次仍可使用，请检查浏览器存储设置。'; }
          try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* 设置不能保存不影响连接。 */ }
          $('connect-dialog').close();
          update();
          editor.message('已连接 ' + settings.owner + '/' + settings.repo + '（' + settings.branch + '）。' + storageMessage);
          await refresh();
        } catch (error) {
          candidate?.disconnect();
          $('connection-message').textContent = error.message;
          throw error;
        } finally { credential = ''; $('github-token').value = ''; }
      });
    });
    $('disconnect-button').addEventListener('click', () => {
      let cleared = true;
      try { Session.clear(); } catch { cleared = false; }
      usePublicClient();
      $('remember-connection').checked = false;
      $('connect-dialog').close();
      editor.message(cleared ? '已退出并忘记连接。仍可浏览公开文章，本机草稿保留。' : '已断开本页连接，但浏览器未能清除保存的授权。请清除此网站的连接存储或在 GitHub 撤销授权。', !cleared);
      void refresh().catch(error => { $('remote-status').textContent = error.message; });
    });
    $('refresh-remote').addEventListener('click', () => perform(async () => {
      try { await refresh(); } catch (error) { $('remote-status').textContent = error.message; throw error; }
    }));
    $('publish-button').addEventListener('click', () => perform(publish));
    $('delete-remote').addEventListener('click', () => perform(removePost));
    root.addEventListener('storage', event => {
      if ((event.key === Session.key || event.key === null) && event.newValue === null && identity) {
        usePublicClient();
        editor.message('另一窗口已退出连接。本机草稿保留。');
        void refresh().catch(error => { $('remote-status').textContent = error.message; });
      }
    });
    update(); setupLink();
    async function initialize() {
      const version = connectionVersion;
      const saved = Session.load();
      let candidate;
      try {
        if (saved && Object.keys(defaults).every(key => saved.settings[key] === settings[key])) {
          $('connection-badge').textContent = '正在恢复 GitHub 连接…';
          candidate = root.BlogGitHub.create({ ...saved.settings, token: saved.token });
          try {
            const result = await candidate.verify();
            if (version !== connectionVersion) { candidate.disconnect(); return; }
            client.disconnect(); client = candidate; candidate = null; identity = result.login;
            $('remember-connection').checked = true;
          } catch (error) {
            candidate?.disconnect(); candidate = null;
            if (version !== connectionVersion) return;
            if (error.code === 'UNAUTHORIZED' || error.status === 401) {
              try { Session.clear(); } catch { /* 可在连接窗口退出。 */ }
              editor.message('保存的授权已失效，请重新连接 GitHub；仍可浏览公开文章。', true);
            } else editor.message('暂未恢复 GitHub 连接，可稍后重试；正在尝试读取公开文章。', true);
          }
        }
        if (version !== connectionVersion) return;
        update();
        await refresh();
      } catch (error) {
        candidate?.disconnect();
        if (version === connectionVersion) $('remote-status').textContent = error.message || '文章读取失败，请点刷新重试。';
      }
    }
    void initialize();
    return { update };
  }
  root.BlogGitHubPanel = { mount };
})(window);
