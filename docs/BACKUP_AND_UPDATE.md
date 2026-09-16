# D1 备份、升级与恢复

这份文档回答四件事：**怎么备份、怎么升级、怎么执行 migration、出事了怎么回去**。

**先记住一句话：**

> **代码可以回滚，数据库不会跟着回滚。**
> `wrangler deploy` 回滚到上一个版本，D1 里的表和字段仍是迁移之后的样子。
> 一旦迁移里包含 `DROP TABLE` / `DROP COLUMN` / 数据转换，回滚代码**无法**恢复数据。
> 唯一能恢复的是**迁移之前的备份**。

---

## 1. 迁移清单：哪些是不可逆的

项目共 22 个迁移（`migrations/0000` – `0021`）。以下按风险分类，
**升级前请对照这张表**。新增迁移出现时，请同步更新本表。

### 🔴 破坏性（含 DROP 或数据转换，回滚代码救不回来）

| 迁移 | 内容 | 影响 |
| --- | --- | --- |
| `0001_flawless_black_queen.sql` | `ALTER TABLE posts DROP COLUMN category` | 旧的文章分类字段被删除 |
| `0005_tricky_scarlet_spider.sql` | 建 `__new_comments` → `DROP TABLE comments` → 重命名 → 重建索引 | 评论表整体重建 |
| `0008_strong_callisto.sql` | `DROP TABLE jwks / oauth_access_token / oauth_client / oauth_consent / oauth_refresh_token` | 移除 MCP 与 OAuth Provider 相关表 |
| `0011_publish_public_snapshot.sql` | 新增 `public_snapshot_json` / `public_slug`，**`UPDATE posts` 回填数据**，再 DROP `public_content_json` 与 `read_time_in_minutes` | **数据转换**：旧公开内容格式迁移为新快照格式 |
| `0012_drop_comment_moderation.sql` | `UPDATE comments`（状态处理）+ DROP `ai_reason` | 待审核评论被改为公开；AI 审核原因字段删除 |
| `0013_comment_body_plain_text.sql` | `UPDATE comments` | **数据转换**：富文本评论正文转为纯文本 |
| `0014_drop_page_views.sql` | `DROP TABLE page_views` | 浏览量数据表删除，改用 Umami |
| `0020_system_config_versions.sql` | 建 guard → 建 `system_config_next` → **`DROP TABLE system_config`** → 重命名 | 系统配置表结构重构 |
| `0021_friend_link_account_email.sql` | `ALTER TABLE friend_links DROP COLUMN contact_email` | 友链联系邮箱字段删除 |

> **`0020` 有一个安全设计值得知道：** 它先建了一张
> `system_config_migration_guard`，带 `CHECK (rows <= 1)`，并写入
> `SELECT count(*) FROM system_config`。如果旧表里有 **0 条或 2 条以上**记录，
> 迁移会直接失败退出，而不是「随便挑一条、丢掉其余的」。
> 这是有意的：宁可失败让你来看，也不要悄悄丢配置。
> 看到这个迁移报错，**不要去绕开它**，先查 `SELECT * FROM system_config;`。

### 🟡 加字段 / 建表（可逆性较好，但仍建议先备份）

| 迁移 | 内容 |
| --- | --- |
| `0002_flimsy_sentry.sql` | 建 `email_unsubscriptions` |
| `0003_zippy_luminals.sql` | 建 `friend_links` + 索引 |
| `0004_slim_tinkerer.sql` | `posts` 加 `public_content_json` |
| `0006_grey_legion.sql` | 建 `post_revisions` + 索引 |
| `0007_nervous_pepper_potts.sql` | 建 MCP / OAuth 相关表（后被 `0008` 删除） |
| `0009_light_brood.sql` | 建 `page_views`（后被 `0014` 删除） |
| `0010_romantic_roland_deschain.sql` | `posts` 加 `pinned_at` |
| `0015_muted_at.sql` | `user` 加 `muted_at` |
| `0016_apikey.sql` | 建 `apikey` + 索引 |
| `0017_post_cover.sql` | `posts` 加 `cover_media_id` + 索引 |
| `0018_category.sql` | 建 `categories`，`posts` 加 `category_id` |
| `0019_search_fts.sql` | 建 `search_documents`、`search_index_meta`、FTS5 虚拟表与三个触发器 |

> **`0019` 的注意点：** 它创建的是 FTS5 虚拟表 + 同步触发器。
> 用 `--local` 或 `--remote` 执行时都依赖运行时支持 FTS5。
> 该迁移**不搬运旧数据**——v2 的搜索索引需要部署后在后台
> 「设置 → 维护 → 重建搜索索引」重新生成。旧 KV 里的 Orama 索引不会自动迁入。

### 完整迁移列表

```text
0000_breezy_pretty_boy.sql          0011_publish_public_snapshot.sql
0001_flawless_black_queen.sql       0012_drop_comment_moderation.sql
0002_flimsy_sentry.sql              0013_comment_body_plain_text.sql
0003_zippy_luminals.sql             0014_drop_page_views.sql
0004_slim_tinkerer.sql              0015_muted_at.sql
0005_tricky_scarlet_spider.sql      0016_apikey.sql
0006_grey_legion.sql                0017_post_cover.sql
0007_nervous_pepper_potts.sql       0018_category.sql
0008_strong_callisto.sql            0019_search_fts.sql
0009_light_brood.sql                0020_system_config_versions.sql
0010_romantic_roland_deschain.sql   0021_friend_link_account_email.sql
```

**禁止删除 `migrations/` 下的任何历史文件**，包括看起来「已经没有用」的
`0007`（建了随后被删的表）和 `0008`。Wrangler 用文件名记录哪些迁移已经执行过，
删掉历史文件会让迁移状态与数据库不一致。

---

## 2. 备份

### 2.1 什么时候必须备份

| 场景 | 是否必须备份 |
| --- | --- |
| 同步 upstream 新版本并会执行新迁移 | ✅ **必须** |
| 手工执行任何 `ALTER` / `DELETE` / `UPDATE` | ✅ **必须** |
| 改动 `system_config`（站点设置）之前 | ✅ 建议 |
| 只改前端样式、文案、CSS | ⬜ 不需要 |
| 本地开发 | ⬜ 不需要（用 `--local`） |

### 2.2 方法 A：整库导出（推荐，最可靠）

```bash
# 1) 导出结构与数据（生产库）
bunx wrangler d1 export DB --remote --output "backup-$(date +%Y%m%d-%H%M%S).sql"

# Windows PowerShell 等价写法
bunx wrangler d1 export DB --remote --output "backup-$(Get-Date -Format 'yyyyMMdd-HHmmss').sql"
```

> **⚠️ 关键限制：`d1 export` 不会导出 FTS5 虚拟表。**
> 也就是说 `search_documents_fts` 不在导出内容里。
> 这是可以接受的：它在部署后通过后台「重建搜索索引」即可重新生成。
> **但导出文件里会包含建表和触发器的语句**，恢复后需要重建索引。

把导出的 `.sql` 文件放到**仓库之外**的可靠位置（例如加密云盘或本地备份盘）。
**不要把备份提交进 Git** —— 里面有全部用户邮箱与评论内容。

### 2.3 方法 B：只备份关键表（体积小，够用于配置回滚）

```bash
bunx wrangler d1 execute DB --remote --json --command \
  "SELECT * FROM system_config;" > backup-system-config.json

bunx wrangler d1 execute DB --remote --json --command \
  "SELECT id, email, name, role, created_at FROM user;" > backup-users.json
```

适合「只想保住站点设置和账号」的场景。文章内容不在其中。

### 2.4 方法 C：Time Travel（Cloudflare 内置，作为兜底）

D1 提供 Time Travel，可在 30 天内把数据库恢复到某个时间点：

```bash
# 查看当前书签
bunx wrangler d1 time-travel info DB --remote

# 恢复到指定时间戳（Unix 秒）或书签
bunx wrangler d1 time-travel restore DB --remote --timestamp <unix-seconds>
# 或
bunx wrangler d1 time-travel restore DB --remote --bookmark <bookmark>
```

> **Time Travel 是兜底，不是备份策略。**
> 它保留窗口有限（默认 30 天，Free 计划可能更短），
> 且**无法只恢复单张表**——恢复会作用于整个数据库。
> 每次重大升级前仍然要按 2.2 做一份可离线保存的导出。

### 2.5 顺带备份 R2 与 KV

D1 之外，媒体文件在 R2、缓存与快照在 KV：

```bash
# R2 桶内容清单与对象（媒体）
bunx wrangler r2 object list omiki1-blog-media

# KV 命名空间里所有 key
bunx wrangler kv key list --namespace-id <KV_NAMESPACE_ID>
```

> R2 里的媒体**建议单独留一份本地原始文件**。项目本身不允许删除仍被引用的媒体
> （见 `CONTEXT.md` 的 Media 规则），但这不能替代你自己的文件备份。

---

## 3. 升级 upstream

### 3.1 版本策略（重要）

**生产只跟随稳定 Release，不跟随 `main` 的最新 commit。**

```text
检查上游 Release
      ↓
阅读 Breaking Changes（Releases 页面 + docs/adr/）
      ↓
备份 D1（第 2.2 节）
      ↓
在本地/测试环境合并并升级
      ↓
bun run check && bun run test && bun run test:node
      ↓
本地启动，人工点一遍关键流程
      ↓
人工确认
      ↓
推到 fork 的 main → Cloudflare Builds 自动部署 + 执行迁移
```

### 3.2 远端约定

| 远端 | 地址 | 作用 |
| --- | --- | --- |
| `origin` | `https://github.com/omiki1/flare-stack-blog.git` | 自己的 Fork，**生产部署来源** |
| `upstream` | `https://github.com/du2333/flare-stack-blog.git` | 上游，**只读** |

核对：

```bash
git remote -v
# origin    https://github.com/omiki1/flare-stack-blog.git (fetch/push)
# upstream  https://github.com/du2333/flare-stack-blog.git  (fetch/push)
```

> 建议把 `upstream` 的 push 地址去掉，避免误推到上游：
> `git remote set-url --push upstream DISABLED`

### 3.3 标准升级流程

```bash
# 0) 干净起步
git status                     # 必须干净，否则先处理未提交改动
git checkout main

# 1) 取回上游，但不动工作区
git fetch upstream --tags

# 2) 看有哪些新 Release（不要直接 merge main）
gh release list --repo du2333/flare-stack-blog --limit 10

# 3) 读目标版本的 Release Notes，重点看「升级」「不兼容」「Breaking」
gh release view v2.1.0 --repo du2333/flare-stack-blog
#    同时检查是否新增了 ADR（架构决策变更）
git log --oneline upstream/main -- docs/adr/

# 4) 【必做】备份生产 D1 —— 见第 2.2 节
bunx wrangler d1 export DB --remote --output "backup-before-v2.1.0.sql"

# 5) 检查目标版本新增的迁移，逐条看有没有 DROP / UPDATE
git diff --stat HEAD upstream/v2.1.0 -- migrations/
git diff HEAD upstream/v2.1.0 -- migrations/*.sql

# 6) 合并到本地，先不推
git merge upstream/v2.1.0        # 或 git rebase，见 3.5
#    有冲突 → 看 docs/FORK_CHANGES.md 的冲突面清单

# 7) 安装依赖（上游可能升级了依赖）
bun install

# 8) 质量门禁
bun run check
bun run test
bun run test:node

# 9) 本地起服务，人工点一遍
bun run db:migrate:local          # 在本地库上先跑一遍新迁移
bun dev                           # 走查首页、文章页、后台、登录

# 10) 人工确认无误后推送，Cloudflare 会自动构建部署并执行生产迁移
git push origin main
```

> **第 5 步和第 9 步不能省。**
> 第 5 步让你在打生产库之前就知道迁移要做什么；
> 第 9 步让新迁移先在本地库上跑一遍，能提前暴露语法或数据问题。

### 3.4 不要这样做

| ❌ 不要 | 原因 |
| --- | --- |
| 直接 `git pull upstream main` 然后推生产 | main 上可能有不带 Release 的中间状态 |
| 跳过备份直接升级 | 破坏性迁移无法用代码回滚恢复 |
| 用 `--remote` 在本地反复试迁移 | 那是在生产库上做实验 |
| 为了通过检查而关掉 TypeScript / ESLint / 测试 | 见第 5 节 |
| 删除 `migrations/` 里的历史文件 | 会破坏 Wrangler 的迁移状态记录 |
| 在 fork 里重写上游文件的大段内容 | 下次同步会持续冲突，见 `docs/FORK_CHANGES.md` |

### 3.5 merge 还是 rebase

| 方式 | 适用 | 代价 |
| --- | --- | --- |
| **`git merge upstream/vX.Y.Z`** | 默认选它 | 历史里会留下 merge commit，但冲突只需解决一次，且能看清上游边界 |
| `git rebase upstream/main` | 想让 fork 的历史线性、改动集中在最前面 | 每个本地提交都要重放；冲突可能反复出现；已推送过的分支不要 rebase |

**本站选择 merge。** 理由：fork 的 `main` 就是生产分支，
已经推送过的提交不应该被重写；且 merge 能清楚地区分「上游的代码」与「我的改动」，
方便将来评估冲突面。

---

## 4. 恢复

### 4.1 升级后出问题：先判断是哪一类

| 症状 | 大概原因 | 处理 |
| --- | --- | --- |
| 页面报错，但数据库结构没问题 | 代码问题 | **回滚代码**（见 4.2） |
| 后台报「表不存在 / 字段不存在」 | 迁移没跑或跑了一半 | 见 4.3 |
| 数据丢了 / 内容变空 | 迁移里的数据转换出错 | **必须恢复备份**（见 4.4） |
| 登录失效、所有人被登出 | 认证相关表被改动 | 见 4.4，通常需要恢复备份 |
| 站点打不开但构建成功 | 域名 / 证书 / Worker 路由 | 查 Worker 的 Domains 与 DNS |

### 4.2 只回滚代码

Cloudflare 控制台 → Worker → **Deployments** → 找到上一个正常版本 →
**Rollback**。

或者用 Git：

```bash
git revert <出问题的提交>          # 生成一个反向提交，不改写历史
git push origin main
```

> 回滚代码**不会**回滚数据库。如果迁移已经执行，数据库仍是新结构。
> 若新代码依赖新字段、旧代码读到新字段，一般仍能工作；
> 反之（旧代码期望已被 DROP 的字段）就会报错——这时必须走 4.4。

### 4.3 迁移只跑了一半

Wrangler 逐条记录已执行的文件。查看状态：

```bash
bunx wrangler d1 migrations list DB --remote
```

- 显示某条未执行 → 补执行：
  ```bash
  bunx wrangler d1 migrations apply DB --remote
  ```
- 某条标为已执行但结构不对（例如 `0020` 因 guard 检查失败）：
  **不要**手工去改 `d1_migrations` 表来「骗过」它。
  先查清实际数据（例如 `SELECT count(*) FROM system_config;`），
  按第 1 节表里的说明处理，或从备份恢复。

### 4.4 从备份恢复

> **恢复会覆盖生产库当前内容。执行前先把「当前状态」也导出一份存起来**，
> 万一恢复过程中发现问题还能回去。

```bash
# 0) 先给「现在」留一份，避免二次损失
bunx wrangler d1 export DB --remote --output "backup-before-restore.sql"

# 1) 执行恢复（把备份 SQL 灌回去）
bunx wrangler d1 execute DB --remote --file "backup-before-v2.1.0.sql"

# 2) 若导出文件是完整重建语句，可能需要先清掉旧表；
#    若不确定，优先用 Time Travel（见下）
```

**更稳的做法 —— 用 Time Travel 回到迁移前的时间点：**

```bash
# 1) 找到迁移执行前的时间戳（Unix 秒）
#    可以在 Cloudflare 控制台 Worker 的 Deployments / Logs 里定位

# 2) 恢复
bunx wrangler d1 time-travel restore DB --remote --timestamp <unix-seconds>

# 3) 恢复后重建搜索索引（FTS 表不在 Time Travel 的可控范围内，
#    且 0019 之后的索引内容需要重新生成）
#    → 后台「设置 → 维护 → 重建搜索索引」
```

恢复完成后必须做：

1. 重建搜索索引（后台 → 设置 → 维护）。
2. 登录一次确认管理员权限仍在（头像菜单能看到「管理后台」）。
3. 抽查文章、评论、友链、媒体是否完整。
4. 清一次 Public Cache（后台 → 设置 → 维护，或等缓存自然过期）。

### 4.5 无备份且超出 Time Travel 窗口

这种情况下 **数据无法恢复**。这正是不跳过备份的理由。

可做的补救：R2 里的媒体文件通常还在；文章正文如果本地留有 Markdown
或编辑器草稿，可以重新录入。因此建议**重要文章在本地另存一份 Markdown 源文件**。

---

## 5. 检查失败时的处理原则

`bun run check` / `bun run test` 失败时，**必须先分清是谁引入的**：

```bash
# 在合并上游之前，先记录基线状态
git checkout main
bun run check ; bun run test

# 合并后再跑一次
git merge upstream/vX.Y.Z
bun run check ; bun run test
```

- **合并前就失败** → 上游已有问题。记录到本文档第 6 节，不要为了让门禁变绿而改检查配置。
- **合并后才失败** → 本次合并引入。优先修自己的改动；
  如果是与上游的冲突导致，按 `docs/FORK_CHANGES.md` 的冲突面清单处理。

**不允许**通过下列方式「解决」：

- 关掉 TypeScript（改 `tsconfig.json` 放宽 `strict`、加 `@ts-ignore` 掩盖）
- 关掉 ESLint 规则或加 `eslint-disable`
- 跳过或删除失败的测试
- 让 `oxfmt` 全量重写工作区来「修好」格式

### 本机已知的平台差异（不是上游问题）

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| `bun run check` 报格式错误涉及几百个文件 | Git for Windows 的 `core.autocrlf` 把文件检出为 CRLF | fork 已加 `.gitattributes`（`* text=auto eol=lf`）。换机器后确认该文件存在 |
| `command not found: ./node_modules/typescript/bin/tsc` | 该文件是无法在 Windows 执行的 POSIX 脚本 | fork 的 `typecheck` / `check` 已改走 `scripts/typecheck.mjs`；用 `check:upstream` 对照上游行为 |
| 提交时报 `bun: command not found`，`husky - pre-commit script failed` | Git for Windows 的 sh 没拿到完整 PATH | 需要用户级 `~/.config/husky/init.sh` 里 `export PATH="$HOME/.bun/bin:$PATH"` |

---

## 6. 已知的上游既有问题记录

> 本区记录**合并前就已经失败**的检查项，用于区分「上游已有」与「本次引入」。
> 目前为空。

| 日期 | 上游版本 | 检查项 | 现象 | 状态 |
| --- | --- | --- | --- | --- |
| — | — | — | 无 | — |

---

## 7. 一页速查

```bash
# 备份生产库
bunx wrangler d1 export DB --remote --output "backup-$(Get-Date -Format 'yyyyMMdd-HHmmss').sql"

# 看上游有哪些 Release
gh release list --repo du2333/flare-stack-blog --limit 10
gh release view <tag> --repo du2333/flare-stack-blog

# 取上游（不动工作区）
git fetch upstream --tags

# 看目标版本的新迁移
git diff HEAD upstream/<tag> -- migrations/

# 看迁移执行状态
bunx wrangler d1 migrations list DB --remote

# 本地先试新迁移
bun run db:migrate:local

# 质量门禁
bun run check && bun run test && bun run test:node

# 回滚代码
git revert <commit> && git push origin main

# 兜底恢复
bunx wrangler d1 time-travel info DB --remote
```

---

[返回项目 README](../README.md)
