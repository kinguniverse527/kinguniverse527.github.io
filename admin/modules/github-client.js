/* GitHub 文章接口：支持公开仓库只读访问；所有发布均为非强制的单次提交。 */
(function (root) {
  'use strict';

  const API = 'https://api.github.com';
  const SHA = /^[a-f0-9]{40}$/i;
  const READ_TIMEOUT = 20000;
  const WRITE_TIMEOUT = 40000;

  function failure(message, code, status) {
    const error = new Error(message);
    error.name = 'BlogGitHubError';
    error.code = code;
    if (status) error.status = status;
    return error;
  }

  function uncertain() {
    const error = failure('提交结果暂时无法确认，操作可能已经完成。请先刷新远端文章列表核对，不要直接重复提交。', 'UNKNOWN_RESULT');
    error.uncertain = true;
    return error;
  }

  function sha(value) {
    if (typeof value !== 'string' || !SHA.test(value)) {
      throw failure('GitHub 返回的数据不完整，请刷新后重试。', 'INVALID_RESPONSE');
    }
    return value.toLowerCase();
  }

  function pathParts(path) {
    if (typeof path !== 'string' || !path || path.length > 1000 || path.includes('..') || path.includes('\\') || path.startsWith('/')) {
      throw failure('文件路径无效，不能包含绝对路径、连续句点或反斜杠。', 'INVALID_PATH');
    }
    const parts = path.split('/');
    if (parts.some(part => !part || part.startsWith('.') || /[. ]$/.test(part) || !/^[\p{L}\p{M}\p{N}_. -]+$/u.test(part))) {
      throw failure('文件路径包含不支持的字符，请使用中文、英文、数字、短横线或下划线。', 'INVALID_PATH');
    }
    return parts;
  }

  function postPath(path) {
    const parts = pathParts(path);
    const name = parts[parts.length - 1];
    const match = /^(\d{4}-\d{2}-\d{2})-.+\.(md|markdown)$/i.exec(name);
    if (parts[0] !== '_posts' || parts.length < 2 || !match) {
      throw failure('文章必须位于 _posts 目录，文件名使用 YYYY-MM-DD-短名.md。', 'INVALID_PATH');
    }
    const date = new Date(match[1] + 'T00:00:00Z');
    if (match[1].startsWith('0000') || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== match[1]) {
      throw failure('文章文件名中的日期无效。', 'INVALID_PATH');
    }
    return path;
  }

  function imagePath(path) {
    const parts = pathParts(path);
    if (parts[0] !== 'assets' || parts[1] !== 'images' || parts.length < 3 || !/\.(png|jpe?g|webp|gif|avif)$/i.test(path)) {
      throw failure('图片必须位于 assets/images 目录，并使用 PNG、JPG、WebP、GIF 或 AVIF 格式。', 'INVALID_PATH');
    }
    return path;
  }

  function bytesOf(value) {
    if (value instanceof Uint8Array) return new Uint8Array(value);
    if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
    throw failure('图片数据无效，请重新选择图片。', 'INVALID_ASSET');
  }

  function encode64(bytes) {
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 8192) {
      binary += String.fromCharCode.apply(null, bytes.subarray(offset, offset + 8192));
    }
    return root.btoa(binary);
  }

  function decode64(value) {
    try {
      const binary = root.atob(value.replace(/\s/g, ''));
      return Uint8Array.from(binary, character => character.charCodeAt(0));
    } catch (_) {
      throw failure('GitHub 返回的文件内容无法解码，请重新读取。', 'INVALID_RESPONSE');
    }
  }

  async function blobSha(bytes) {
    if (!root.crypto || !root.crypto.subtle) {
      throw failure('当前浏览器不能校验图片内容，请使用新版浏览器并从 HTTPS 或本地文件打开写作室。', 'CRYPTO_UNAVAILABLE');
    }
    const header = new TextEncoder().encode('blob ' + bytes.length + '\0');
    const object = new Uint8Array(header.length + bytes.length);
    object.set(header);
    object.set(bytes, header.length);
    const digest = await root.crypto.subtle.digest('SHA-1', object);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  }

  function create(options) {
    options = options || {};
    const owner = options.owner;
    const repo = options.repo;
    const branch = options.branch || 'main';
    let token = typeof options.token === 'string' ? options.token.trim() : '';
    const readOnly = options.readOnly === true;
    const fetcher = options.fetch || (root.fetch && root.fetch.bind(root));
    if (typeof owner !== 'string' || typeof repo !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(owner) || !/^[A-Za-z0-9_.-]{1,100}$/.test(repo) || repo === '.' || repo === '..') {
      throw failure('GitHub 用户名或仓库名称无效。', 'INVALID_REPOSITORY');
    }
    if (typeof branch !== 'string' || !branch || branch.length > 250 || /[\x00-\x20\x7f~^:?*\[\\]/.test(branch) || branch.includes('..') || branch.includes('@{') || branch.endsWith('.') || branch.split('/').some(part => !part || part.startsWith('.') || part.endsWith('.lock'))) {
      throw failure('GitHub 分支名称无效。', 'INVALID_BRANCH');
    }
    if ((!token && !readOnly) || /[\s\x00-\x1f\x7f]/.test(token)) throw failure('请填写有效的 GitHub 访问令牌。', 'INVALID_TOKEN');
    if (typeof fetcher !== 'function') throw failure('当前浏览器不支持连接 GitHub。', 'FETCH_UNAVAILABLE');

    const prefix = '/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo);
    const branchPath = branch.split('/').map(encodeURIComponent).join('/');
    const controllers = new Set();
    // 缓存仅属于本次连接，按不可变的提交/文件 SHA 区分版本。
    const snapshots = new Map();
    const blobs = new Map();
    const pendingBlobs = new Map();
    let cachedBytes = 0;
    let disconnected = false;
    let writing = false;

    // 不携带 cookie、不跟随重定向、不缓存响应；错误中不返回原始请求或令牌。
    async function request(method, path, body, finalWrite = false) {
      if (disconnected) throw failure('GitHub 连接已断开，请重新连接。', 'DISCONNECTED');
      if (readOnly && (method !== 'GET' || path === '/user')) throw failure('请先连接 GitHub，再提交修改。', 'AUTH_REQUIRED');
      const controller = new AbortController();
      controllers.add(controller);
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; controller.abort(); }, method === 'GET' ? READ_TIMEOUT : WRITE_TIMEOUT);
      let response;
      let data;
      try {
        response = await fetcher(API + path, {
          method,
          headers: {
            Accept: 'application/vnd.github+json',
            ...(token ? { Authorization: 'Bearer ' + token } : {}),
            'X-GitHub-Api-Version': '2026-03-10',
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal,
        });
        try { data = await response.json(); } catch (_) {
          if (response.ok) throw finalWrite ? uncertain() : failure('GitHub 返回的数据无法读取，请稍后重试。', 'INVALID_RESPONSE');
        }
      } catch (error) {
        if (error && error.name === 'BlogGitHubError') throw error;
        if (finalWrite) throw uncertain();
        if (disconnected) throw failure('GitHub 连接已断开，本次操作已停止。', 'DISCONNECTED');
        throw failure(timedOut ? '连接 GitHub 超时，请检查网络后重试。' : '无法连接 GitHub，请检查网络或浏览器的跨域访问限制后重试。', timedOut ? 'TIMEOUT' : 'NETWORK');
      } finally {
        if (timer) clearTimeout(timer);
        controllers.delete(controller);
      }
      if (!response.ok) {
        const status = response.status;
        const remoteMessage = typeof data?.message === 'string' ? data.message : '';
        if (status === 429 || (status === 403 && (response.headers?.get('x-ratelimit-remaining') === '0' || response.headers?.get('retry-after') || /rate limit|abuse detection/i.test(remoteMessage)))) {
          throw failure(readOnly ? '公开读取暂时达到 GitHub 的访问限额。连接 GitHub 后可继续读取，或稍后重试。' : 'GitHub 请求过于频繁，已达到访问频率限制。请稍后再试，不要连续点击提交。', 'RATE_LIMIT', status);
        }
        if (status === 401) throw failure('GitHub 令牌无效或已经过期，请重新连接。', 'UNAUTHORIZED', status);
        if (status === 403) throw failure('GitHub 拒绝访问。请检查令牌是否授权此仓库及 Contents 读写权限，并确认分支没有限制直接提交。', 'FORBIDDEN', status);
        if (status === 404) throw failure('找不到仓库、分支或文件，或令牌没有访问权限。请检查名称及授权范围。', 'NOT_FOUND', status);
        if (status === 409) throw failure('远端内容或分支状态已变化，提交未完成。请刷新并核对后再编辑。', 'CONFLICT', status);
        if (status === 422) throw failure(finalWrite ? '分支已变化或受保护，GitHub 拒绝更新。请刷新核对；不会强制覆盖远端内容。' : 'GitHub 无法接受本次提交，请检查文件内容、分支限制及仓库状态。', finalWrite ? 'CONFLICT' : 'VALIDATION', status);
        if (finalWrite && status >= 500) throw uncertain();
        throw failure('GitHub 服务暂时无法完成请求，请稍后重试。', 'HTTP_ERROR', status);
      }
      return data;
    }

    async function head() {
      const reference = await request('GET', prefix + '/git/ref/heads/' + branchPath);
      if (reference?.ref !== 'refs/heads/' + branch || reference?.object?.type !== 'commit') {
        throw failure('GitHub 分支引用不完整，请检查分支名称。', 'INVALID_RESPONSE');
      }
      return sha(reference.object.sha);
    }

    async function snapshot(ref) {
      if (disconnected) throw failure('GitHub 连接已断开，请重新连接。', 'DISCONNECTED');
      const headSha = ref === undefined ? await head() : sha(ref);
      if (snapshots.has(headSha)) return snapshots.get(headSha);
      const pending = loadSnapshot(headSha);
      snapshots.set(headSha, pending);
      if (snapshots.size > 8) snapshots.delete(snapshots.keys().next().value);
      try { return await pending; }
      catch (error) { if (snapshots.get(headSha) === pending) snapshots.delete(headSha); throw error; }
    }

    async function loadSnapshot(headSha) {
      const commit = await request('GET', prefix + '/git/commits/' + headSha);
      const treeSha = sha(commit?.tree?.sha);
      const tree = await request('GET', prefix + '/git/trees/' + treeSha + '?recursive=1');
      if (tree?.truncated || !Array.isArray(tree?.tree)) {
        throw failure('仓库目录没有完整读取，已停止操作以免覆盖遗漏的文件。', 'INCOMPLETE_TREE');
      }
      const entries = new Map();
      for (const entry of tree.tree) {
        if (typeof entry?.path !== 'string' || entries.has(entry.path)) {
          throw failure('仓库目录数据异常，请刷新后重试。', 'INVALID_RESPONSE');
        }
        entries.set(entry.path, entry);
      }
      return { headSha, treeSha, entries };
    }

    function fileEntry(state, path) {
      const segments = path.split('/');
      for (let count = 1; count < segments.length; count += 1) {
        const ancestor = state.entries.get(segments.slice(0, count).join('/'));
        if (ancestor && (ancestor.type !== 'tree' || ancestor.mode !== '040000')) {
          throw failure('文章或图片目录包含符号链接、子模块或同名文件，已停止操作。', 'UNSAFE_PATH');
        }
      }
      const entry = state.entries.get(path);
      if (entry && (entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode))) {
        throw failure('不能读取或覆盖符号链接、目录或子模块，请选择普通文件。', 'UNSAFE_PATH');
      }
      if (entry) sha(entry.sha);
      return entry;
    }

    async function readBlob(entry) {
      if (disconnected) throw failure('GitHub 连接已断开，请重新连接。', 'DISCONNECTED');
      const key = sha(entry.sha);
      if (blobs.has(key)) {
        const bytes = blobs.get(key);
        blobs.delete(key); blobs.set(key, bytes);
        return bytes.slice();
      }
      if (pendingBlobs.has(key)) return (await pendingBlobs.get(key)).slice();
      const pending = loadBlob(key);
      pendingBlobs.set(key, pending);
      try {
        const bytes = await pending;
        if (!disconnected && bytes.length <= 8 * 1024 * 1024) {
          blobs.set(key, bytes); cachedBytes += bytes.length;
          while (cachedBytes > 48 * 1024 * 1024 || blobs.size > 128) {
            const oldest = blobs.keys().next().value;
            cachedBytes -= blobs.get(oldest).length; blobs.delete(oldest);
          }
        }
        return bytes.slice();
      } finally { pendingBlobs.delete(key); }
    }

    async function loadBlob(key) {
      const blob = await request('GET', prefix + '/git/blobs/' + key);
      if (blob?.encoding !== 'base64' || typeof blob.content !== 'string') {
        throw failure('GitHub 文件编码不受支持，请从仓库检查原文件。', 'INVALID_RESPONSE');
      }
      return decode64(blob.content);
    }

    async function verify() {
      const [user, repository] = await Promise.all([request('GET', '/user'), request('GET', prefix), head()]);
      if (typeof user?.login !== 'string' || !user.login) throw failure('GitHub 用户信息不完整，请重新连接。', 'INVALID_RESPONSE');
      if (repository?.archived) throw failure('这个仓库已归档，不能发布新内容。', 'READ_ONLY');
      if (repository?.permissions?.push === false) throw failure('当前账号没有这个仓库的写入权限。', 'FORBIDDEN', 403);
      return { login: user.login, repo: repository.full_name || owner + '/' + repo, branch };
    }

    async function listPosts() {
      const state = await snapshot();
      const directory = state.entries.get('_posts');
      // 树快照直接表示目录不存在，避免将仓库无权访问的 404 误当作空文章列表。
      if (!directory) return [];
      if (directory.type !== 'tree' || directory.mode !== '040000') throw failure('_posts 必须是普通目录，不能是符号链接。', 'UNSAFE_PATH');
      const result = [];
      for (const [path, entry] of state.entries) {
        if (!path.startsWith('_posts/') || !/^\d{4}-\d{2}-\d{2}-.+\.(md|markdown)$/i.test(path.split('/').pop())) continue;
        postPath(path);
        fileEntry(state, path);
        result.push({ path, name: path.split('/').pop(), sha: sha(entry.sha), headSha: state.headSha });
      }
      return result.sort((left, right) => right.name.localeCompare(left.name));
    }

    async function getFile(path, ref) {
      pathParts(path);
      path.startsWith('_posts/') ? postPath(path) : imagePath(path);
      const state = await snapshot(ref);
      const entry = fileEntry(state, path);
      if (!entry) throw failure('远端没有找到这个文件。', 'NOT_FOUND', 404);
      return { bytes: await readBlob(entry), sha: sha(entry.sha) };
    }

    async function readPost(path, ref) {
      postPath(path);
      const state = await snapshot(ref);
      const entry = fileEntry(state, path);
      if (!entry) throw failure('远端没有找到这篇文章，请刷新文章列表。', 'NOT_FOUND', 404);
      const bytes = await readBlob(entry);
      let text;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (_) {
        throw failure('文章不是有效的 UTF-8 文本，请先检查文件编码。', 'INVALID_ENCODING');
      }
      return { text, path, sha: sha(entry.sha), headSha: state.headSha };
    }

    function expectedEntry(state, path, expectedSha, deleting) {
      const entry = fileEntry(state, path);
      if (expectedSha === null && !deleting) {
        if (entry) throw failure('远端已有同名文章。请从远端打开后编辑，或为新文章选择其他名称。', 'CONFLICT', 409);
      } else {
        if (typeof expectedSha !== 'string' || !SHA.test(expectedSha)) throw failure('缺少文章的原始版本，请先从远端重新打开文章。', 'EXPECTED_SHA_REQUIRED');
        if (!entry || sha(entry.sha) !== expectedSha.toLowerCase()) throw failure('这篇文章已在远端修改或删除。请先刷新核对，当前内容不会覆盖远端版本。', 'CONFLICT', 409);
      }
      return entry;
    }

    async function createBlob(bytes, expected) {
      const blob = await request('POST', prefix + '/git/blobs', { content: encode64(bytes), encoding: 'base64' });
      if (sha(blob?.sha) !== expected) throw failure('上传内容的校验结果不一致，已停止发布。', 'INVALID_RESPONSE');
      return expected;
    }

    async function commitChanges(state, treeEntries, message) {
      const tree = await request('POST', prefix + '/git/trees', { base_tree: state.treeSha, tree: treeEntries });
      const commit = await request('POST', prefix + '/git/commits', { message, tree: sha(tree?.sha), parents: [state.headSha] });
      const commitSha = sha(commit?.sha);
      // 创建 Git 对象尚未发布；只有最后一步非强制更新引用才会改变网站分支。
      if (await head() !== state.headSha) throw failure('发布期间分支出现了新提交，已停止更新。请刷新并核对后再试。', 'CONFLICT', 409);
      const reference = await request('PATCH', prefix + '/git/refs/heads/' + branchPath, { sha: commitSha, force: false }, true);
      if (reference?.object?.sha !== commitSha) throw uncertain();
      return { commitSha, commitUrl: 'https://github.com/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo) + '/commit/' + commitSha };
    }

    function commitMessage(message, fallback) {
      if (message === undefined) return fallback;
      if (typeof message !== 'string' || !message.trim() || message.length > 2000) throw failure('提交说明不能为空，且不能超过 2000 字。', 'INVALID_MESSAGE');
      return message.trim();
    }

    async function write(action) {
      if (readOnly) throw failure('请先连接 GitHub，再提交修改。', 'AUTH_REQUIRED');
      if (writing) throw failure('已有提交正在处理中，请等待结果后再操作。', 'BUSY');
      if (disconnected) throw failure('GitHub 连接已断开，请重新连接。', 'DISCONNECTED');
      writing = true;
      try { return await action(); } finally { writing = false; }
    }

    async function publish(input) {
      return write(async () => {
        if (!input || typeof input !== 'object') throw failure('没有可发布的文章。', 'INVALID_ARTICLE');
        const path = postPath(input.path);
        const expectedHeadSha = input.expectedHeadSha == null ? null : sha(input.expectedHeadSha);
        if (typeof input.text !== 'string') throw failure('文章内容必须是文字。', 'INVALID_ARTICLE');
        const textBytes = new TextEncoder().encode(input.text);
        const expectedSha = input.expectedSha;
        if (expectedSha !== null && (typeof expectedSha !== 'string' || !SHA.test(expectedSha))) throw failure('请明确选择新建文章，或先读取文章的远端版本。', 'EXPECTED_SHA_REQUIRED');
        const message = commitMessage(input.message, '发布文章：' + path.split('/').pop());
        if (input.assets !== undefined && !Array.isArray(input.assets)) throw failure('图片附件列表无效。', 'INVALID_ASSET');
        const seen = new Set();
        const assets = (input.assets || []).map(asset => {
          const assetPath = imagePath(asset?.path);
          if (seen.has(assetPath)) throw failure('图片附件包含重复路径，请重新插入重名图片。', 'INVALID_ASSET');
          seen.add(assetPath);
          return { path: assetPath, bytes: bytesOf(asset.bytes) };
        });
        const state = await snapshot();
        if (expectedHeadSha && state.headSha !== expectedHeadSha) throw failure('网址检查期间仓库有新提交，请刷新后再提交，避免网址冲突。', 'CONFLICT', 409);
        const existing = expectedEntry(state, path, expectedSha, false);
        const articleSha = await blobSha(textBytes);
        for (const asset of assets) {
          asset.sha = await blobSha(asset.bytes);
          const remote = fileEntry(state, asset.path);
          if (remote && sha(remote.sha) !== asset.sha) throw failure('远端已有同名但内容不同的图片，可能被其他文章使用。请更换图片文件名后发布。', 'ASSET_CONFLICT', 409);
          asset.exists = Boolean(remote);
        }
        // 所有路径、文章版本和图片冲突均在任何写请求前完成校验。
        if (!existing || sha(existing.sha) !== articleSha) await createBlob(textBytes, articleSha);
        const treeEntries = [{ path, mode: '100644', type: 'blob', sha: articleSha }];
        for (const asset of assets) {
          if (asset.exists) continue;
          await createBlob(asset.bytes, asset.sha);
          treeEntries.push({ path: asset.path, mode: '100644', type: 'blob', sha: asset.sha });
        }
        return { path, sha: articleSha, ...await commitChanges(state, treeEntries, message) };
      });
    }

    async function deletePost(input) {
      return write(async () => {
        if (!input || typeof input !== 'object') throw failure('没有可删除的文章。', 'INVALID_ARTICLE');
        const path = postPath(input.path);
        const message = commitMessage(input.message, '删除文章：' + path.split('/').pop());
        if (typeof input.expectedSha !== 'string' || !SHA.test(input.expectedSha)) throw failure('请先读取文章的远端版本再删除。', 'EXPECTED_SHA_REQUIRED');
        const expectedSha = input.expectedSha;
        const state = await snapshot();
        const entry = expectedEntry(state, path, expectedSha, true);
        return commitChanges(state, [{ path, mode: entry.mode, type: 'blob', sha: null }], message);
      });
    }

    function disconnect() {
      token = '';
      disconnected = true;
      for (const controller of controllers) controller.abort();
      controllers.clear();
      snapshots.clear(); blobs.clear(); pendingBlobs.clear(); cachedBytes = 0;
    }

    return Object.freeze({ verify, listPosts, readPost, getFile, publish, deletePost, disconnect });
  }

  const api = Object.freeze({ create });
  root.BlogGitHub = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window === 'undefined' ? globalThis : window);
