# 更新网站的三种方式

这份文档回答一个问题：**我改了东西，怎么让访客看到？**

答案取决于你改的是什么。三种情况的操作完全不同，先看速查：

| 我改了什么 | 需要做什么 | 生效速度 | 会碰生产数据库吗 |
| --- | --- | --- | --- |
| **写文章 / 改设置 / 审评论 / 换头像** | 登录后台点保存 | **立即** | 只写内容表，不跑迁移 |
| **主站 `omiki.cc` 的代码** | `npm run deploy:cf` | 约 1 分钟 | ❌ 完全没有数据库 |
| **博客 `blog.omiki.cc` 的代码** | `bun run deploy` | 约 3 分钟 | ⚠️ **会跑 D1 迁移，先备份** |
| **同步上游新版本** | 见 `docs/BACKUP_AND_UPDATE.md` | 约 10 分钟 | ⚠️ **会跑迁移，必须先备份** |

---

## 0. 先理解：现在的部署链路

要看清楚哪些环节是通的、哪些是断的：

```text
情况 A —— 写内容（日常 90% 的操作）
   浏览器后台 ──► Cloudflare Worker ──► D1 / R2 / KV
                                         ↑
                                   直接生效，与 Git 无关

情况 B —— 改代码（现在）
   你的编辑器 ──► 本机 wrangler deploy ──► Cloudflare
                        ↑
                   Git 只用于存档
                        │
      git push ──► GitHub ──╳── 没有连接，不会触发部署

情况 C —— 改代码（接入 Workers Builds 之后）
   你的编辑器 ──► git push ──► GitHub ──► Cloudflare Workers Builds ──► 上线
```

**关键区别：** 写内容不需要任何部署动作；改代码需要部署。
而 GitHub 目前只是版本存档，**不参与部署** —— 除非你做完下面第 4 节的接入。

---

## 1. 写文章、改站点设置 —— 不需要部署

这是最常用的一条路径，**完全不碰代码，也不需要 Git**。

1. 打开 <https://blog.omiki.cc>，用 GitHub 登录（你已经是管理员）
2. 进入 `/admin`
3. 按需要操作：

| 想做的事 | 位置 | 注意 |
| --- | --- | --- |
| 写 / 改文章 | 后台 → 文章 | 改完必须点**发布**，读者才看得到。自动保存只改编辑稿 |
| 改站点名称、介绍、作者、头像、首页背景、导航、社交链接 | 后台 → 设置 → 站点 | 立即生效 |
| 上传图片 | 后台 → 媒体 | 存进 R2，10 MB 上限，支持 jpg/png/webp/gif |
| 管分类与标签 | 后台 → 分类标签 | 改分类名会影响已发布文章的公开展示，**无需重新发布** |
| 审友链、禁言用户 | 后台 → 友链 / 禁言用户 | |
| 管通知邮件与 Webhook | 后台 → 设置 → 通知 | |
| 签发 API Key | 后台 → 设置 → API Keys | ⚠️ API Key 等同于管理员密码，见下文 |
| 重建搜索索引 | 后台 → 设置 → 维护 | 内容大批量变动后跑一次 |

### 容易踩的坑

- **改了文章但前台没变** → 需要重新**发布**。v2 的规则是「发布时才更新公开内容快照」，
  自动保存和编辑稿改动都不影响读者看到的版本。
- **改了分类名，文章列表没变** → 分类归属的改动不需要重新发布，
  但公开缓存可能有延迟，等一会儿或到「设置 → 维护」刷一次缓存。
- **搜索不到新文章** → 到「设置 → 维护 → 重建搜索索引」。
- **删不掉某张图片** → 是刻意的保护：只要编辑稿或已发布内容还在引用该图片，
  就不允许删除。先从文章里移除引用。

### 关于 API Key

后台可以签发 API Key，用来让脚本或 AI 工具通过 HTTP API 写文章。
**API Key 会完全冒充你的管理员会话**，拥有你的全部内容管理权限
（唯一限制是不能创建/撤销别的 API Key）。

所以：

- 按用途各签发一个，命名清楚（例如 `codex-drafts`）
- 不用了就撤销
- **绝对不要提交进任何 Git 仓库**，也不要贴到聊天里
- 接口文档在后台「设置 → API Keys」页面里能看到 OpenAPI 说明

---

## 2. 改主站 `omiki.cc` 的代码

主站是 `C:\workspace\wuwa`（GitHub: `omiki1/between-tides`），纯静态导出，**没有数据库**。

### 日常流程

```powershell
cd C:\workspace\wuwa

# 1. 本地看效果
npm run dev                 # http://127.0.0.1:3000

# 2. 改完跑检查（必须，不要跳过）
npm run check               # ESLint + TypeScript
npm run verify              # 构建 + 导出结构检查

# 3. 一条命令部署上线
npm run deploy:cf
```

`npm run deploy:cf` = `next build` + `wrangler deploy`，
构建完自动推上 Cloudflare 并绑定 `omiki.cc`，约 1 分钟。

### 内容改在哪里

| 想改什么 | 文件 |
| --- | --- |
| 站点名、简介、导航、社交链接、音乐、NOW 状态、版权声明 | `config/site.ts` |
| 文章 | `content/posts/*.md`（frontmatter 里 `title`、`date` 必填） |
| 随记 | `content/notes/notes.json` |
| 项目 | `data/projects.ts`，正文在 `content/projects/*.md` |
| 图集 | `data/gallery.ts` + `public/gallery/` |
| 追番 | `data/bangumi.json` |
| 颜色 token | `styles/tokens.css`（深/浅两套） |
| 全局样式 | `app/globals.css` |

> 新增文章后，`/rss.xml`、`/sitemap.xml`、`/search.json` 会自动包含它 ——
> 它们都在构建期从同一批内容源生成，不需要手工维护。

### 部署后怎么确认真的生效了

主站在**你的浏览器里直接打开 <https://omiki.cc> 刷新**即可。
如果看到的是旧内容，按 `Ctrl+Shift+R` 强刷（HTML 设了 `must-revalidate`，
但浏览器可能仍持有副本）。

### 关于 `wrangler` 的凭据

`npm run deploy:cf` 会自己去找 Cloudflare 凭据，查找顺序：

1. 环境变量 `CLOUDFLARE_API_TOKEN`
2. 本机密钥文件 `C:\Users\freeing1\.dsh-secrets\cloudflare.env`

**不要**把 Token 写进 `.env` 或任何 `.env.*` 文件 ——
本仓库有意提交 `.env.production`，那个文件里不能放秘密。

---

## 3. 改博客 `blog.omiki.cc` 的代码

博客是 `C:\workspace\flare-stack-blog`（GitHub: `omiki1/flare-stack-blog`，
上游 Fork），有 D1 数据库，**所以部署比主站危险**。

### ⚠️ 先记住这一条

```bash
bun run deploy   # 等于 bun db:migrate && wrangler deploy
```

**它每次都会先对生产 D1 执行迁移。** 首次部署时库是空的，没问题；
以后每次部署都会重复这个动作。所以：

> **只要这次改动涉及 `migrations/` 目录，部署前先备份 D1。**
> 备份命令与恢复流程见 `docs/BACKUP_AND_UPDATE.md` 第 2 节。

### 日常流程（纯前端 / 文案改动，不动 migrations）

```powershell
cd C:\workspace\flare-stack-blog

bun install                        # 依赖有变动时
bun run check                      # orpc:contract + oxlint + oxfmt + tsc
bun run test                       # 集成测试（16 文件 / 215 用例）
bun run test:node                  # 单元测试（52 文件 / 258 用例）
bun dev                            # http://localhost:3000 人工走查

# 部署（需要凭据，见下）
$env:CLOUDFLARE_API_TOKEN = (Get-Content C:\Users\freeing1\.dsh-secrets\cloudflare.env | Where-Object { $_ -like 'CLOUDFLARE_API_TOKEN=*' }) -replace '^CLOUDFLARE_API_TOKEN=',''
bun run deploy
```

### 日常流程（涉及 migrations）

```powershell
# 1. 先看清这次迁移要做什么 —— 有没有 DROP TABLE / DROP COLUMN / UPDATE
git diff HEAD -- migrations/

# 2. 备份生产 D1
bunx wrangler d1 export DB --remote --output "backup-$(Get-Date -Format 'yyyyMMdd-HHmmss').sql"

# 3. 先在本地库上跑一遍，确认不报错
bun run db:migrate:local

# 4. 本地起服务人工验证
bun dev

# 5. 确认无误再部署到生产
bun run deploy
```

### 部署后怎么确认

**直接从你的浏览器打开 <https://blog.omiki.cc>。**
如需看 Worker 日志：Cloudflare 控制台 → Compute → Workers & Pages →
`omiki1-blog` → Logs。

> **注意：这台开发机无法在命令行里访问 `blog.omiki.cc`。**
> 本机 Clash TUN 对 `omiki.cc` 的子域走了一条不通的代理链路，
> 表现是 TLS 握手被中断（`schannel: failed to receive handshake`）。
> 对照实验：连一个**不存在的**子域也是同样的失败，而 apex `omiki.cc` 正常，
> 所以这是本机网络配置问题，不是站点问题。
> **因此博客的验证请在浏览器里做**，命令行验证不可靠。

---

## 4. 让"推送即上线"（推荐长期方案）

接入 Cloudflare Workers Builds 之后，流程会简化成：

```text
改代码 → git push → GitHub → Cloudflare 自动构建并部署 → 上线
```

不用再记部署命令，手机改代码也能发布。

**这一步只能在 Cloudflare 控制台点，因为需要授权 Cloudflare 访问你的 GitHub。**

### 主站 `omiki.cc`

1. 控制台 → **Compute → Workers & Pages → Create application → Continue with GitHub**
2. 授权后选择 `omiki1/between-tides`
3. 填写：

   | 设置项 | 值 |
   | --- | --- |
   | Project name | `omiki1-home` —— **必须与 `wrangler.jsonc` 的 `name` 完全一致** |
   | Build command | `npm ci && npm run build` |
   | Deploy command | `npx wrangler deploy` |
   | Root directory | `/` |
   | Production branch | `main` |
   | Builds for non-production branches | 取消勾选 |

4. **Deploy**。之后每次 `git push origin main` 都会自动上线。

> 主站没有机密需要录入，接上就能用。

### 博客 `blog.omiki.cc`

同样步骤，但多两步：

1. 选择 `omiki1/flare-stack-blog`
2. 填写：

   | 设置项 | 值 |
   | --- | --- |
   | Project name | `omiki1-blog` —— **必须与 `WORKER_NAME` 一致** |
   | Build command | `bun run wrangler:prepare && bun run build` |
   | Deploy command | `bun run deploy` |
   | Root directory | `/` |
   | Production branch | `main` |

3. **Advanced settings → 添加 6 个构建变量**（这些不是机密，可以放在构建变量里）：

   ```
   WORKER_NAME       = omiki1-blog
   DOMAIN            = blog.omiki.cc
   D1_DATABASE_ID    = 4216488c-a345-4f7d-a387-ccbe9b846b84
   KV_NAMESPACE_ID   = 6a34cbc64ec04ead8e251fc4d3071e97
   BUCKET_NAME       = omiki1-blog-media
   QUEUE_NAME        = omiki1-blog-queue
   ```

   可选再加 `BUN_VERSION=1.4.2` 固定构建环境的 Bun 版本。

4. **Deploy**。

> **运行时变量与 Secret 不需要再填。** 它们已经存在 Worker 上，
> 而 `wrangler.jsonc` 里有 `keep_vars: true`，重新部署不会清掉它们。

> **⚠️ 接入 Workers Builds 之后，`bun run deploy` 里的 D1 迁移会在每次
> `git push` 时自动执行。** 这意味着：
> - 好处是迁移不会忘记跑
> - 风险是**你在本地还没验证过的迁移会直接打到生产库**
>
> 所以只要动了 `migrations/`，仍然必须先按第 3 节先在本地库上验证。

### 可选：给部署加一道门槛

博客仓库里已有 `.github/workflows/ci.yml`（上游自带），
在 pull request 上跑 `bun lint` / `bun typecheck` / `bun run test:node` / `bun run test`。

如果你希望**推送前必须通过检查**，在 GitHub 仓库
**Settings → Branches → Add branch protection rule**，对 `main` 勾选
`Require status checks to pass`。这样坏代码进不了生产分支。

> 注意：主站仓库 `omiki1/between-tides` **还没有** CI 工作流。
> 需要的话照博客仓库的 `.github/workflows/ci.yml` 写一份，
> 命令换成 `npm ci` / `npm run check` / `npm run verify`。

---

## 5. 同步上游新版本（博客专属）

博客项目来自 `du2333/flare-stack-blog`。**不要盲目跟随上游 `main` 的最新提交**，
只跟随正式 Release。

完整流程（含备份、迁移审查、恢复预案）见
[`docs/BACKUP_AND_UPDATE.md`](./BACKUP_AND_UPDATE.md) 第 3 节。

速查：

```powershell
git fetch upstream --tags
gh release list --repo du2333/flare-stack-blog --limit 10
gh release view v2.1.0 --repo du2333/flare-stack-blog     # 读 Breaking Changes

# 备份！备份！备份！
bunx wrangler d1 export DB --remote --output "backup-before-v2.1.0.sql"

git diff HEAD upstream/v2.1.0 -- migrations/              # 看迁移要做什么
git merge upstream/v2.1.0
bun install
bun run check ; bun run test ; bun run test:node
bun run db:migrate:local ; bun dev                        # 本地先试
git push origin main                                      # 确认后上线
```

**合并时唯一会冲突的地方是 `package.json` 的 4 行脚本**
（Windows 类型检查路径）。冲突怎么解见
[`docs/FORK_CHANGES.md`](./FORK_CHANGES.md) 第 3 节。

---

## 6. 回滚

| 出问题的东西 | 怎么回滚 |
| --- | --- |
| 主站页面 | `git revert <提交>` → `git push` → `npm run deploy:cf` |
| 博客代码（数据库结构没变） | 控制台 → `omiki1-blog` → Deployments → 找上一个正常版本 → **Rollback** |
| 博客代码（数据库结构变了） | **必须恢复 D1 备份**。代码回滚救不了已执行的迁移，见 `BACKUP_AND_UPDATE.md` 第 4 节 |
| 一篇文章的旧版本 | 后台 → 文章 → 编辑 → 历史版本 → 预览 → 恢复（恢复只改编辑稿，需再发布） |
| 站点设置改错了 | 后台重新改回来。D1 里的 `system_config` 有版本号列，冲突时会拒绝写入而不是静默覆盖 |

---

## 7. 一页速查

```powershell
# ---------- 主站 omiki.cc ----------
cd C:\workspace\wuwa
npm run dev            # 本地预览
npm run check          # 检查
npm run verify         # 构建校验
npm run deploy:cf      # 部署上线
git push                # 存档（接入 CI 后这一步即部署）

# ---------- 博客 blog.omiki.cc ----------
cd C:\workspace\flare-stack-blog
bun dev                # 本地预览
bun run check          # 检查
bun run test           # 集成测试
bun run test:node      # 单元测试
bun run deploy         # 部署（会先跑 D1 迁移！）
git push                # 存档（接入 CI 后这一步即部署）

# 备份生产数据库
bunx wrangler d1 export DB --remote --output "backup-$(Get-Date -Format 'yyyyMMdd-HHmmss').sql"

# 看 Worker 实时日志
bunx wrangler tail omiki1-blog
```

| 我改了… | 命令 | 需要备份吗 |
| --- | --- | --- |
| 文章、设置、评论、图片 | 后台点保存 | 不需要 |
| 主站文案 / 样式 / 内容 | `npm run deploy:cf` | 不需要 |
| 博客前端 / 文案（无 migrations） | `bun run deploy` | 建议 |
| 博客 `migrations/` | 先备份，再 `bun run deploy` | **必须** |
| 上游版本 | 见 `BACKUP_AND_UPDATE.md` | **必须** |

---

[返回项目 README](../README.md)
