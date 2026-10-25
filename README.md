# King_Universe 的个人博客

用 Jekyll 生成博客页面，通过 GitHub Pages 发布。项目自带可视化写作室，文章以 Markdown 文件保存在仓库中；日常写作无需安装开发工具。

- [阅读博客](https://kinguniverse527.github.io/)
- [打开写作室](https://kinguniverse527.github.io/admin/)
- [查看部署进度](https://github.com/kinguniverse527/kinguniverse527.github.io/actions)
- [写作室详细说明](admin/README.md)

## 日常使用

打开写作室后，左侧“全部文章”会自动读取公开仓库中的文章，按日期从新到旧排列。可以搜索标题、日期、网址短名和已读取的正文。读取公开文章无需授权，提交修改需要连接 GitHub。

| 想做什么 | 怎么操作 |
| --- | --- |
| 写新文章 | 点击左上角 **＋**，填写标题和正文，再点 **发布到博客** |
| 修改已有文章 | 在 **全部文章** 中搜索并打开，修改后点 **更新线上文章** |
| 修改文章网址 | 修改 **网址短名** 后点 **更新线上文章**；部署后新网址生效，旧链接不会自动跳转 |
| 暂时不发布 | 点击 **保存草稿** 或按 `Ctrl+S`；编辑后也会自动保存 |
| 备份文章 | 点击 **导出备份**，下载 Markdown 或包含图片的单篇文章 ZIP |
| 删除本机草稿 | 点击草稿右侧 **删除**，核对标题后确认；不会删除 GitHub 上的文章 |
| 删除线上文章 | 连接 GitHub 并打开文章，点击 **删除线上文章** 后确认；本机草稿和线上图片保留 |
| 查看发布结果 | 提交后点击 **查看部署进度**，部署成功后再查看博客 |

**保存草稿保存在当前浏览器，发布才会提交到 GitHub。** 换浏览器、换设备或清理网站数据后，本机草稿可能无法找回，重要内容请导出备份。删除本机草稿后无法恢复未发布内容。

再次打开同一线上版本，会恢复已有的关联草稿并保留未提交的修改。线上文件已更新时，会另开草稿，保留原来的本机版本。

## 首页 ChatGPT 留言

首页简介下方展示一段 ChatGPT 生成的读后留言，标明生成日期和当时阅读的文章数量，可展开“阅读范围”查看相关文章。

- 内容、日期、所读文章路径保存在 [`_data/ai_comment.yml`](_data/ai_comment.yml)；`source_revision` 记录阅读时的仓库版本。
- 展示模板为 [`_includes/ai-comment.html`](_includes/ai-comment.html)，布局在 `assets/css/style.css` 的末尾。
- 将 `enabled` 改为 `false` 可以隐藏留言。段落作为普通文字显示，不执行 HTML。
- **当前留言由 ChatGPT 在本次对话中阅读文章后生成并发布；新文章或内容更新不会自动触发新评论。** 页面上的日期与篇数对应当次阅读，不代表实时全站分析。
- 留言是 AI 对文章的阅读理解，不代表作者自述。它直接显示在首页，不冒用 GitHub 读者账号，也不需要额外 API 密钥。
- 文章链接按原文件路径匹配，写作室修改网址短名后链接随构建更新。删除或移动源文件会使该篇链接不再显示；原阅读记录仍保留。

## 文章评论（Giscus）

评论区已启用，显示在每篇文章正文下方。访客可公开阅读评论，使用 GitHub 账号授权 Giscus 后发表评论、回复和表情反应，无需生成写作室令牌。评论存放在 GitHub Discussions，站点不接收读者密码。

首次设置（当前仓库已完成；迁移仓库时参考）：

1. 在[仓库设置](https://github.com/kinguniverse527/kinguniverse527.github.io/settings)的 General → Features 勾选 **Discussions**。
2. [安装 Giscus GitHub App](https://github.com/apps/giscus)，选择 **Only select repositories**，只选本博客仓库。
3. 打开 [Giscus 配置](https://giscus.app/zh-CN)，填写本仓库名称，选 **Announcements**（公告类型）分类。从生成代码中复制 `data-category-id` 到 [`_data/comments.yml`](_data/comments.yml) 的 `category_id`，确认分类名称匹配，再把 `enabled` 改为 `true`。仓库 ID 已填写；这里的 ID 是公开标识，不是密码或 token。
4. 提交并等待 Pages 部署完成，在一篇文章底部确认登录入口。首次真实留言会创建对应讨论；不需要事先为每篇文章建讨论。

管理与维护：

- 在[仓库 Discussions](https://github.com/kinguniverse527/kinguniverse527.github.io/discussions)管理留言，可删除违规内容、锁定讨论。登录不等于完全防垃圾评论，仍需人工管理。
- 全站关闭：将 `_data/comments.yml` 的 `enabled` 设为 `false`；单篇关闭：在文章头部添加 `comments: false`。隐藏页面评论区不会删除 GitHub 中已有讨论，也不等于锁定讨论。
- 评论默认按文章文件路径关联。通过写作室修改标题、日期或网址短名不会改变原文件路径，因此仍使用原评论区。
- 若要在仓库里移动或重命名文章文件，请先加 `comment_id: "_posts/原文件名.md"`（完整原路径，不加 `blog:`），以后保持该值不变；不要给不同文章使用相同 `comment_id`。
- [`giscus.json`](giscus.json) 限制仅正式域名嵌入评论；本地预览默认不能加载真实评论。更换域名时同步修改该文件。此限制不阻止用户直接在 GitHub 讨论。
- 模块集中在 [`_includes/comments.html`](_includes/comments.html)，布局在 `assets/css/style.css` 的末尾。评论为中文浅色主题，滚动到附近才加载，不影响写作室。
- 详情见 [Giscus 官方说明](https://giscus.app/zh-CN)。评论账号授权和站长的写作室发布授权彼此独立。

## 首次连接 GitHub

1. 在写作室点击 **连接 GitHub**。默认仓库为 `kinguniverse527/kinguniverse527.github.io`，分支为 `main`，通常无需修改。
2. 打开 [GitHub Fine-grained token 设置](https://github.com/settings/personal-access-tokens)，点击 **Generate new token**，填写名称和有效期，Resource owner 选自己的账号。
3. Repository access 选 **Only select repositories**，只勾选 `kinguniverse527.github.io`；在仓库权限中把 **Contents** 设为 **Read and write**。
4. 生成后立即复制令牌，回到写作室粘贴到 **仓库授权码**，点击 **连接仓库**。具体设置可参照 [GitHub 官方说明](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)。
5. 在自己的设备上，可以勾选 **记住此浏览器，30 天内自动连接**，以后刷新或重新打开会自动验证并恢复连接。

生成后如果没有保存令牌、又已离开显示令牌的页面，请重新生成并复制；可以删除不再使用的旧令牌。令牌不要发到聊天、截图中或提交进仓库。

“记住此浏览器”会把授权码存到当前浏览器，最长 30 天；授权码提前过期、被撤销或浏览器存储被清除时仍需重新连接。不勾选则仅保留本页连接。点击 **账号设置 → 退出并忘记连接** 可清除记忆，本机草稿保留。当前使用令牌连接，并非 GitHub 账号的一键跳转登录。

## 调整展示效果：改哪个文件

| 想调整的内容 | 文件或目录 |
| --- | --- |
| 网站名称、网址、时区、文章链接规则 | [`_config.yml`](_config.yml) |
| 首页简介、寄语、项目列表 | [`_data/profile.yml`](_data/profile.yml) |
| 关于我 | [`about.md`](about.md) |
| 文章内容 | [`_posts/`](_posts/) |
| 首页结构和文章列表 | [`index.html`](index.html) |
| 全站框架、文章和普通页面模板 | [`_layouts/`](_layouts/) |
| 导航和页脚 | [`_includes/`](_includes/) |
| **字体、字号、行高** | [`assets/css/typography.css`](assets/css/typography.css)，优先修改顶部 `:root` |
| 页面宽度、留白、颜色、手机布局 | [`assets/css/style.css`](assets/css/style.css) |
| 文章图片 | [`assets/images/`](assets/images/) |
| 写作室界面、布局、按钮 | [`admin/index.html`](admin/index.html)、[`admin/editor.css`](admin/editor.css) |
| 写作室功能模块 | [`admin/app.js`](admin/app.js)、[`admin/modules/`](admin/modules/) |

文字设置集中为两套字体（日常文字、代码）和四档字号（大标题、标题、正文、辅助文字）。修改博客文字样式时，先找 `typography.css`，不必从整个 `style.css` 中查找。

## 项目如何运转

```text
写作室编辑 → 提交 Markdown 和图片到 GitHub
                         ↓
                   GitHub Pages 构建
                         ↓
              Jekyll 把文章套入模板与样式
                         ↓
                   公开博客更新
```

文章、资料、模板、样式和写作室分别存放。写作室使用已打包的 Tiptap 编辑器；普通文字编辑和样式修改不需要重新打包。

## 手动写文章（可选）

在 `_posts/` 新建 `YYYY-MM-DD-短名.md`，例如：

```markdown
---
title: 今天的记录
date: 2026-10-24 12:00:00 +0800
description: 一句话摘要。
---

这里写正文。

## 一个小标题

可以使用 **加粗**、列表、引用和链接。

![图片说明](/assets/images/photo.jpg)
```

图片放在 `assets/images/`。首页会自动列出文章，不必手动添加链接。默认用文件名里的短名生成网址，正文开头的 `title` 用于显示标题。写作室修改网址短名时，会保存文章头部的 `slug` 配置，更新原文章并保留 Markdown 文件名；不会额外创建一篇文章。新网址若与其他文章重复，会阻止提交。

网址短名只填 `my-note` 这样的名称，不要粘贴完整网址；留空沿用原短名。单独设置了固定链接 `permalink` 的文章，需修改该配置才能改变固定网址。修改后旧链接不会自动跳转，请同步更新之前分享的链接。

写作室目前不支持定时发布，提交及导出时要求文章日期为今天或更早。手动提交的未来日期文章会被当前配置隐藏，要等日期到达后的下一次构建才会显示。设置 `published: false` 也会隐藏博客页面，但公开仓库里的源文件仍可被读取。

## 更新项目与部署

网站已经使用 GitHub Pages 发布。日常更新只替换有改动的文件，不需要先清空仓库。

- 上传时保留目录层级，将项目内部文件放在仓库根目录；不要上传外层项目文件夹、整个 `outputs` 或 ZIP 文件本身。
- 同路径文件上传提交后会更新，新文件会新增；旧文件不会因上传一个新文件夹而自动全部删除。
- 不要用旧整站压缩包覆盖最新的 `_posts/`、资料或配置；更新前先核对仓库里的最新内容。
- Pages 应执行 Jekyll 构建。本项目使用 `main` 分支的根目录；根目录不要放会关闭 Jekyll 的 `.nojekyll`。
- `_config.yml` 仅排除写作室中的 `admin/build` 和 `admin/README.md`，不要排除整个 `admin`。
- 提交后到 [Actions](https://github.com/kinguniverse527/kinguniverse527.github.io/actions) 查看结果。提交成功与网站部署成功是两步。

## 常见情况

| 情况 | 处理方式 |
| --- | --- |
| 看不到新版按钮 | 先保存草稿，再按 **Ctrl + F5** 刷新 |
| 全部文章读取失败或达到限额 | 检查网络，连接 GitHub 后点 **刷新** |
| 授权后无法提交 | 检查是否选中正确仓库、Contents 是否为 Read and write、令牌是否过期 |
| 提示文章已在远端修改 | 先导出当前草稿，再刷新并打开线上版本核对，避免覆盖其他修改 |
| 提交后博客暂未更新 | 等待 Pages 部署成功，再刷新博客 |
| 文章进入“原文模式” | 内容包含表格、HTML、Liquid 等高级语法；继续编辑原文以保留格式 |

写作室的阅读预览使用博客样式，但不执行 Jekyll 或 Liquid，最终效果以正式博客为准。

## 本地预览与开发（可选）

完整下载项目后，可直接打开 `admin/index.html` 离线写作；联网读取和发布仍需要访问 GitHub。本地文件与线上入口可能使用不同的浏览器草稿库。

博客根目录的 `index.html` 是 Jekyll 模板，需要构建后才能预览。安装兼容项目依赖的 Ruby 和 Bundler，在项目根目录运行：

```sh
bundle install
bundle exec jekyll serve
```

打开终端显示的网址；修改 `_config.yml` 后重启预览。`_site/` 是生成结果，不要手工修改或提交。

只有升级写作室第三方依赖时，才需要在 `admin/build/` 运行 `npm ci` 和 `npm run build`。模块职责、依赖和验证边界见 [写作室详细说明](admin/README.md)。
