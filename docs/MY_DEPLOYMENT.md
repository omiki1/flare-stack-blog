# 本站主自己的部署流程

这份文档记录 **omiki1 个人站点体系** 的部署方式，是对上游
[`docs/deployment.md`](./deployment.md) 的补充，而不是替代。

- 上游文档负责解释「每个资源是什么、在控制台哪里点」。
- 本文档负责记录「**本站在部署什么、值填成什么、按什么顺序做、哪些步骤绝不能跳过**」。

两份文档冲突时，以**当前代码**为准，其次本文档；发现冲突请直接修正本文档。

---

## 0. 当前状态速览

| 项 | 状态 |
| --- | --- |
| 上游版本 | `du2333/flare-stack-blog` **v2.0.1**（2026-09-13，当前最新稳定 Release） |
| 本仓库 | `omiki1/flare-stack-blog`（上游 Fork），fork 的 `main` 是 Cloudflare 监听的生产分支 |
| 上游远端 | `upstream` → `https://github.com/du2333/flare-stack-blog.git` |
| 本仓库远端 | `origin` → `https://github.com/omiki1/flare-stack-blog.git` |
| **博客域名** | **`blog.omiki.cc`** ✅ 已部署、已绑定 |
| **主站域名** | **`omiki.cc`** ✅ 已部署（由 `omiki1-home` Worker 承载静态站） |
| Cloudflare 账号 | `ca1645341e22bf174f5658d2d375e331` |
| Zone | `omiki.cc` / `b4ac684cd9f2cd7a2e64c3c0bb5adba0` / Active |
| 四项资源 | D1 ✅ KV ✅ Queue ✅ R2 ✅（2026-09-16 创建） |
| 生产 D1 迁移 | ✅ 22 个迁移全部应用，`user` 表 0 条 |
| Worker 部署 | ✅ `omiki1-blog` 版本 `7094182e`，12 个 binding 全部就位 |
| 运行时变量与 Secret | ✅ 6 项已写入（4 个 secret_text + DOMAIN/BETTER_AUTH_URL/ENVIRONMENT 等） |
| GitHub OAuth | ✅ OAuth App 已创建，回调 `https://blog.omiki.cc/api/auth/callback/github` |
| **管理员账号** | ⬜ **尚未创建 —— 需要站主本人首次登录（见第 3 节，最高优先级）** |
| 主站安全响应头 | ✅ 已在真实响应中验证生效 |
| 本地开发 | ✅ 已验证可用（见第 4 节） |

### 剩余待办

1. **【最高优先级】站主本人登录 `https://blog.omiki.cc`，成为管理员。** 见第 3 节。
2. 新建的 API Token 使用完毕后撤销（见第 9 节「Token 卫生」）。
3. Workers Builds（GitHub 自动部署）尚未接入 —— 目前是本地 `wrangler deploy` 部署。
4. CSP 尚未启用（主站），原因与做法见 `between-tides` 仓库的 `public/_headers` 注释。

---

## 1. 目标架构

两个站点、两个 Worker，互相独立部署：

```text
                        Cloudflare
                            │
              ┌─────────────┴──────────────┐
              │                            │
        omiki.cc                   blog.omiki.cc
              │                            │
   Worker: omiki1-home            Worker: omiki1-blog
   (Next.js 16 静态导出)          (TanStack Start SSR)
              │                            │
        仅静态资源                          │
                          ┌─────────┬──────┴────┬─────────┬──────────┐
                          ↓         ↓           ↓         ↓          ↓
                         D1        R2          KV      Queues       DO
                          │         │           │         │          │
                       内容库     媒体      公开缓存   异步通知   限流+发布串行
```

`omiki1-home` 不绑定任何服务端资源。把静态站和 CMS 分成两个 Worker，
是为了不给静态站强行引入它不需要的运行时依赖。

**不使用：** 传统 VPS、Nginx、MySQL Server、Redis Server、Docker 常驻后端、手动 SSL。

---

## 2. 部署前必须由站主本人完成的步骤

以下每一步都涉及账号、付款、密钥或域名，**Agent 不能也不应该代做**。
按顺序执行。

### 2.1 购买并接入域名

1. 购买域名（Cloudflare Registrar，或任意注册商）。
2. **若不在 Cloudflare Registrar 购买**：在 Cloudflare 控制台
   **Add a site** → 输入根域名 → 选择 Free 计划 → 按提示把注册商处的
   Nameserver 改成 Cloudflare 给的两个地址。
3. 等待域名状态变成 **Active**。
   > 状态不是 Active 时，后面所有步骤都会失败。先确认这一项。

### 2.2 绑定付款方式并开通 R2

1. Cloudflare 控制台 → **Manage Account → Billing** → 添加付款方式。
2. **Storage & databases → R2 Object Storage** → 按提示开通。
   > R2 需要先绑定付款方式才能创建桶（即使实际用量在免费额度内）。
   > 这是上游文档「前置条件」里明确要求的一项。

### 2.3 创建 GitHub OAuth App

1. 打开 <https://github.com/settings/applications/new>。
2. 填写：

   | 表单项 | 值 |
   | --- | --- |
   | Application name | 自定，例如 `omiki1 blog` |
   | Homepage URL | `https://<博客域名>` |
   | Authorization callback URL | `https://<博客域名>/api/auth/callback/github` |

3. **Register application**。
4. 复制 **Client ID**（公开值）。
5. **Generate a new client secret** → 立即复制 **Client secret**。
   > 离开页面后无法再次查看完整值。**不要**把它发到聊天里、不要提交进 Git。

### 2.4 生成 BETTER_AUTH_SECRET

任选一种方式生成至少 32 字符的随机值，生成后**存进密码管理器**：

- 密码管理器自带的生成器（推荐，64 位随机字母数字）。
- 或在任意可信 HTTPS 页面的开发者工具 Console 里执行：

  ```js
  Array.from(crypto.getRandomValues(new Uint8Array(32)), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
  ```

### 2.5 创建 Cloudflare 资源

按 `docs/CLOUDFLARE_RESOURCES.md` 第 1 节的命名约定创建，共四项：

| 资源 | 控制台入口 | 名称 | 需要记下 |
| --- | --- | --- | --- |
| D1 数据库 | Storage & databases → D1 SQLite Database | `omiki1-blog-db` | **ID（UUID）** |
| R2 存储桶 | Storage & databases → R2 Object Storage | `omiki1-blog-media` | **名称** |
| Queue 队列 | Compute → Queues | `omiki1-blog-queue` | **名称** |
| KV 命名空间 | Storage & databases → Workers KV | `omiki1-blog-cache` | **ID** |

> D1 / KV 填 **ID**，R2 / Queue 填 **名称**。填错是部署失败最常见的原因。

### 2.6 （可选，建议）开启图片转换与 Turnstile

**图片转换** —— 账号侧栏 **Images → Transformations** → 找到博客的根域名
→ Sources 选 **This zone only** → Save。

**Turnstile** —— 账号侧栏 **Turnstile** → Add site → 添加博客域名
→ 得到 **Site Key**（公开）与 **Secret Key**（机密）。

### 2.7 在 Cloudflare 创建 Worker 并连接 GitHub

1. **Compute → Workers & Pages → Create application → Continue with GitHub**。
2. 授权 Cloudflare 访问 GitHub（首次需要），选择 `omiki1/flare-stack-blog`。
3. 填写构建设置：

   | 设置项 | 值 |
   | --- | --- |
   | Project name / Worker name | `omiki1-blog` — **必须与 `WORKER_NAME` 完全一致** |
   | Build command | `bun run wrangler:prepare && bun run build` |
   | Deploy command | `bun run deploy` |
   | Root directory | `/` |
   | Builds for non-production branches | **取消勾选**（首次部署建议） |

4. **Advanced settings** → 添加六个构建变量（值见
   `docs/CLOUDFLARE_RESOURCES.md` 第 4 节）：
   `WORKER_NAME`、`DOMAIN`、`D1_DATABASE_ID`、`BUCKET_NAME`、`QUEUE_NAME`、`KV_NAMESPACE_ID`。
   可选再加 `BUN_VERSION`。
5. 确认 Production branch 是 fork 的 `main`。
6. 点击 **Deploy**，等待构建与部署成功。
   > `bun run deploy` = `bun db:migrate && wrangler deploy`。
   > **这一步会先对生产 D1 执行迁移。** 首次部署时数据库是空的，属于预期；
   > 之后的每一次部署都会重复这个动作，因此升级前必须先备份（见
   > `docs/BACKUP_AND_UPDATE.md`）。

### 2.8 添加运行时变量与机密

Worker → **Settings → Runtime variables and secrets → Add variable**。
至少填这五项：

| Key | 值 | 勾选 Secret |
| --- | --- | --- |
| `BETTER_AUTH_SECRET` | 2.4 生成的值 | ✅ |
| `GITHUB_CLIENT_SECRET` | 2.3 的 Client secret | ✅ |
| `BETTER_AUTH_URL` | `https://<博客域名>` | ⬜ |
| `DOMAIN` | `<博客域名>`（纯域名） | ⬜ |
| `GITHUB_CLIENT_ID` | 2.3 的 Client ID | ⬜ |
| `ENVIRONMENT` | `prod` | ⬜ |

> 可以把 `KEY=value` 多行粘贴到 **Key** 输入框批量导入。
> 保存时用 **Add variable and deploy**。

### 2.9 确认域名绑定

Worker → **Settings → Domains & Routes**（或 **Domains**）里应当出现博客域名。
DNS 与证书生效后访问 `https://<博客域名>`。

---

## 3. 管理员初始化：**上线流程中最重要的一步**

### 3.1 机制说明（依据当前代码，不是猜测）

`src/lib/auth/auth.server.ts` 的 `databaseHooks.user.create.before` 实现如下逻辑：

```ts
// src/lib/auth/auth.server.ts（节选）
before: async (user) => {
  const existing = await db.query.user.findFirst({ columns: { id: true } });
  if (!existing) {
    return { data: { ...user, role: "admin" } };
  }
  return { data: user };
},
```

也就是说：

- **数据库中第一个被创建的用户自动获得 `admin` 角色。**
- 判断依据是「**user 表是否为空**」，不是邮箱白名单、不是环境变量。
- v2 已移除 `ADMIN_EMAIL` 配置项，无法用邮箱指定管理员。
- 无法通过 `npm run dev` 之外的界面「指定」管理员：**先到先得**。

`src/lib/auth/auth.integration.test.ts` 中的 `assigns admin to the first created User only`
就是这个行为的回归测试。

### 3.2 因此的强制流程

```text
1. 部署成功
        ↓
2. 【不要公开传播博客地址】
        ↓
3. 站主本人立刻用 GitHub OAuth 登录一次
   （右键头像菜单 → 登录，或访问 https://<域名>/login）
        ↓
4. 确认账号拿到管理员权限：
   - 头像菜单里出现「管理后台」入口
   - 且 https://<域名>/admin 可以正常打开
        ↓
5. 确认数据库里第一个用户就是自己
   （可选，用 wrangler d1 execute 核对，见下）
        ↓
6. 此之后才可以分享博客地址、开放注册
```

### 3.3 核对自己的账号确实是 admin

```bash
# 列出用户与角色，确认只有自己一条并且 role=admin
bunx wrangler d1 execute DB --remote --command \
  "SELECT id, email, name, role, created_at FROM user ORDER BY created_at LIMIT 10;"
```

`--remote` 才会打到生产库。**`--local` 查的是本地库，不要搞混。**

### 3.4 如果被别人抢先注册了怎么办

这是本流程要防的唯一事故。处理方式：

1. **立即**在 Cloudflare 控制台把 Worker 的域名解绑，或把 Worker 回滚到上一个版本，
   让站点无法访问。
2. 确认生产 D1 内容：

   ```bash
   bunx wrangler d1 execute DB --remote --command \
     "SELECT id, email, role, created_at FROM user ORDER BY created_at;"
   ```

3. 决策（二选一，都可行）：

   **方案 A — 提升自己为 admin（保留数据）**
   把自己的 `role` 改成 `admin`，把陌生用户降级或删除：

   ```bash
   # 把自己设为 admin
   bunx wrangler d1 execute DB --remote --command \
     "UPDATE user SET role='admin' WHERE email='<你的邮箱>';"
   ```

   > 注意：`role` 字段由 Better Auth 的 `admin` 插件管理，
   > 手工 UPDATE 后需要让对方重新登录才会生效（会话有 5 分钟 cookie 缓存）。

   **方案 B — 清库重来（数据为空时最干净）**
   首次部署时数据库里本来就没有内容，直接重置：

   ```bash
   bunx wrangler d1 execute DB --remote --command \
     "DELETE FROM session; DELETE FROM account; DELETE FROM user;"
   ```

   然后自己重新登录，重新成为第一个用户。

   > 只有当**确认还没有任何文章数据**时才用方案 B。
   > 已经有文章时不要用，会连带影响作者关联。

4. 恢复站点访问，立即自己登录，再按 3.2 走完验收。

### 3.5 管理员长期安全建议

- **不要**长期保留「任何人都能注册」的状态。后台
  **设置 → 站点 / 通知** 里按需调整，或至少在注册入口开启 Turnstile。
- 开启 Turnstile（`TURNSTILE_SECRET_KEY` + `VITE_TURNSTILE_SITE_KEY`），
  服务端校验在 `src/lib/orpc/procedure.ts` 的 `turnstileMiddleware` 里执行，
  **不是**只有前端验证。
- 定期在后台 **设置 → API Keys** 检查已签发的 API Key，撤销不再使用的。
  > API Key 会**完全冒充其所属管理员的会话**，拥有该管理员的内容管理权限
  > （唯一限制是不能创建/撤销 API Key，见 `src/lib/auth/api-key-guard.ts`）。
  > 因此 API Key 等同于管理员密码，务必最小化使用与及时撤销。
- 后台 **设置 → 维护** 可在需要时重建搜索索引。

---

## 4. 本地开发（已完成验证）

### 4.1 环境

| 组件 | 版本要求 | 本机实测 |
| --- | --- | --- |
| Bun | >= 1.3 | 1.4.2 ✅ |
| Node | 用于工具脚本 | 22.16.0 ✅ |
| Windows | — | Bun 已加入用户级 PATH；husky 钩子额外需要 `~/.config/husky/init.sh`（见下） |

### 4.2 首次初始化

```bash
# 依赖
bun install

# 三份本地配置（都被 .gitignore 忽略）
cp .env.example .env
cp .dev.vars.example .dev.vars
cp wrangler.example.jsonc wrangler.jsonc

# 应用本地 D1 迁移（生成 Miniflare 本地数据库）
bun run db:migrate:local
```

**`bun run db:migrate:local` 这一步不能漏。** 漏掉的话首页会 500，
因为表还没建。它只作用于本地模拟数据库，**不会**碰生产。

### 4.3 启动

```bash
bun dev      # http://localhost:3000
```

### 4.4 本地已验证的行为

| 检查 | 结果 |
| --- | --- |
| `bun run db:migrate:local` | 22 个迁移全部 ✅（0000–0021） |
| `GET /` | 200 |
| `GET /posts` | 200 |
| `GET /friend-links` | 200 |
| `GET /search` | 200 |
| `GET /admin`（未登录） | 307 跳转登录页 —— 预期行为 |
| `bun run check` | ✅ 通过（orpc:contract + oxlint + oxfmt + tsc） |
| `bun run test`（集成） | ✅ 16 文件 / 215 测试通过 |
| `bun run test:node` | ✅ 52 文件 / 258 测试通过 |

本地开发特性：

- 注册账号**不会**真实发信，验证链接直接打印在终端，点开即可激活。
- 本地第一个注册的账号同样自动成为管理员。

### 4.5 本地与生产的隔离

`wrangler.example.jsonc` 里 D1 / R2 / KV 三处都有一行被注释掉的 `"remote": true`。

**保持注释状态。** 这是本地开发不误伤生产的开关：

| 状态 | 效果 |
| --- | --- |
| 注释（默认） | Miniflare 使用 `.wrangler/state` 下的本地 D1 / KV / R2 |
| 取消注释 | 读写**真实的** Cloudflare 资源 |

**任何会修改生产数据库的操作都必须显式执行**，例如：

```bash
bunx wrangler d1 execute DB --remote --command "..."   # --remote 才是生产
bun run db:migrate                                      # 会打生产，见 BACKUP_AND_UPDATE.md
```

### 4.6 Windows 上的两个环境注意点

这两项都已经在本机处理完，换机器时需要重做：

1. **`bun run check` 的类型检查**：仓库脚本用的
   `./node_modules/typescript/bin/tsc` 是无法在 Windows 上直接执行的 POSIX 脚本。
   fork 里已改为调用 `scripts/typecheck.mjs`（用 Node 解析 TypeScript 7 的平台原生二进制）。
   上游原命令保留为 `bun run check:upstream` 以便对照。

2. **husky 的 pre-commit 钩子**：Git for Windows 的 sh 拿不到完整 PATH，
   报 `bun: command not found`。已通过用户级 `~/.config/husky/init.sh`
   把 `$HOME/.bun/bin` 加回 PATH 解决。**这是机器级配置，不在仓库里**。

> 另注：本机 Machine PATH 里有一条损坏条目（`ram Files\nodejs\`，
> 是 `C:\Program Files\nodejs` 被截断的结果）。
> 目前不影响本项目，但建议在 系统属性 → 环境变量 里修掉。

---

## 5. 部署后的验收清单

按顺序逐项确认，**全部通过**才算上线完成：

- [ ] `https://<博客域名>` 首页正常打开，无 500
- [ ] 首页显示站点名称与介绍（默认是「站点名称 / 作者」，需要到后台改成自己的）
- [ ] `https://<博客域名>/rss.xml`、`/atom.xml`、`/feed.json`、`/sitemap.xml`、`/robots.txt` 均可访问
- [ ] **站主本人已用 GitHub 登录，且拿到了管理员权限**
- [ ] `/admin` 可以正常打开
- [ ] 后台能进入「设置 → 站点」，把站点名称、介绍、作者、头像、首页背景改成自己的
- [ ] 后台「设置 → 维护」里执行一次**重建搜索索引**
      （v2 的搜索从 KV 的 Orama 改为 D1 FTS，旧索引不会自动迁入）
- [ ] 上传一张图片成功（验证 R2 绑定）
- [ ] 发布一篇文章，前台能看到（验证 D1 + Public Cache + 搜索索引）
- [ ] 评论一条，前台立即显示（v2 起评论提交后直接公开）
- [ ] 若开启了 Turnstile：在无痕窗口验证注册/评论确实被拦住
- [ ] 最后才把地址分享出去

---

## 6. 域名变更时要做的事

域名目前待定，一旦确定或将来要换，需要**同时**改这几处，
顺序错了会出现「登录回调地址错误」：

1. GitHub OAuth App 的 **Homepage URL** 与 **Authorization callback URL**
2. Cloudflare Builds 的构建变量 `DOMAIN`（改完要**重新触发构建**才生效）
3. Worker 的运行时变量 `DOMAIN` 与 `BETTER_AUTH_URL`（保存并部署即生效）
4. Cloudflare 侧 Custom Domain 绑定

三者必须一致：

```text
博客访问地址：                 https://<域名>
BETTER_AUTH_URL：             https://<域名>
GitHub OAuth Redirect URI：   https://<域名>/api/auth/callback/github
```

同时确认 `DOMAIN` 是**纯域名**（不带 `https://`、不带结尾斜杠），
并且登录时用的是这个域名（不是 Workers 的 `*.workers.dev` 地址）。

> 想回滚域名：把以上四处改回旧值即可，数据库不受影响。

---

## 7. 已知的上游行为与预期现象

区分「上游本来就这样」和「本次部署出错」，避免误判：

| 现象 | 是否正常 |
| --- | --- |
| 未配置 Umami 时日志报 `Post popularity sync failed` | ✅ 正常。cron 每天 00:15 UTC 跑热度同步，缺 Umami 参数就会失败，不影响站点访问 |
| 未配置邮件服务时，邮箱注册/找回密码无法完成 | ✅ 正常。GitHub 登录不依赖邮件；邮件需要在后台配置发送服务 |
| `/admin` 未登录时 307 跳转 | ✅ 正常 |
| 本地开发时图片没有转换效果 | ✅ 正常。Miniflare 的本地图片缩放极慢，项目在 `handleImageRequest` 里刻意对 `localhost` 直接返回 R2 原图 |
| 评论提交后立刻公开、没有审核环节 | ✅ v2 的规则变更（见 ADR `0010-comments-are-public-immediately.md`） |
| 修改标题/正文后前台没变 | ✅ 需要**重新发布**才会更新公开内容快照。自动保存只改编辑稿 |
| 旧版本号提示有更新 | ✅ 正常。更新检查固定查询上游 `du2333/flare-stack-blog` 的 Releases，与本站 fork 版本号无关 |

---

## 8. 首次部署实际执行记录（2026-09-16）

留档用于对照，也便于将来重做时知道哪些步骤是必须的、哪些是可以自动化的。

| # | 动作 | 方式 | 结果 |
| --- | --- | --- | --- |
| 1 | 域名 `omiki.cc` 接入 Cloudflare | 站主（Registrar 购买） | ✅ Active |
| 2 | 开通 R2 服务 | **站主（须接受定价条款 + 付款方式）** | ✅ 无法由脚本代做 |
| 3 | 创建 GitHub OAuth App | **站主**（回调 `https://blog.omiki.cc/api/auth/callback/github`） | ✅ |
| 4 | 创建 D1 `omiki1-blog-db` | API / wrangler | ✅ |
| 5 | 创建 KV `omiki1-blog-cache` | API / wrangler | ✅ |
| 6 | 创建 Queue `omiki1-blog-queue` | API / wrangler | ✅ |
| 7 | 创建 R2 桶 `omiki1-blog-media` | wrangler | ✅ 需先完成第 2 步 |
| 8 | 生成 `BETTER_AUTH_SECRET` | 本机 CSPRNG，32 字节 → 64 位十六进制 | ✅ 存于仓库外的密钥目录 |
| 9 | `bun run wrangler:prepare` | 由 `.env` 生成 `wrangler.jsonc` | ✅ |
| 10 | `bun run db:migrate` | 生产 D1 | ✅ 22 个迁移全绿 |
| 11 | `wrangler secret bulk` | 写入 6 项运行时变量与 Secret | ✅ |
| 12 | `bun run build` | Vite 构建 | ✅ 18.38s，server bundle 9.8 MB |
| 13 | `wrangler deploy --env=""` | 部署 + 绑定自定义域 + 注册 cron | ✅ |
| 14 | 主站构建与部署 | `omiki1-home` → `omiki.cc` | ✅ 381 个静态资源 |
| 15 | 主站安全响应头 | `public/_headers` | ✅ 已在真实响应中验证 |
| 16 | 站主首次登录成为管理员 | **站主** | ⬜ 待完成 |

### 过程中遇到的两个阻碍（都不是代码问题）

1. **账户没有 `workers.dev` 子域**，`wrangler deploy` 报 `code: 10063`。
   Cloudflare 要求先有 workers.dev 子域才能部署。
   控制台侧的做法是「首次打开 Workers & Pages 落地页会自动创建」；
   也可以用 API 直接注册：`PUT /accounts/{id}/workers/subdomain`，body `{"subdomain":"omiki1"}`。
   本站已注册为 `omiki1`，即 `*.omiki1.workers.dev`。

2. **R2 未开通时无法创建桶**，报 `code: 10042 Please enable R2 through the Cloudflare Dashboard`。
   这一步**必须站主本人操作**：需要接受 R2 定价条款并绑定付款方式，
   脚本无法代做，也不应该代做。

### Token 卫生

首次部署使用了一个自定义 API Token。**该 Token 只应作为一次性工具使用，用完立即撤销。**

Token 的存放与使用规则：

- 存放在**任何仓库之外**（本站放在用户主目录下的密钥目录），权限尽量收紧。
- 只存在于环境变量里，命令输出中不得出现其值。
- 不写入 `.env`、`.dev.vars`、`wrangler.jsonc` 或任何入库文件。

**首次部署完成后应做的事：**

1. 打开 <https://dash.cloudflare.com/profile/api-tokens>
2. 找到首次部署用的 Token → **Roll** 或 **Delete**
3. 需要长期自动化时，新建一个**权限最小化**的 Token，并且只放在本机密钥目录

> 如果 Token 曾经出现在聊天记录、截图、终端日志或任何可能被留存的地方，
> **必须视为已泄露并立即撤销**。

---

## 9. 相关文档

| 文档 | 内容 |
| --- | --- |
| **`docs/UPDATING.md`** | **日常更新：改内容 / 改代码 / 同步上游 / 回滚，以及如何接入 Workers Builds** |
| `docs/deployment.md` | 上游官方图文部署指南（每个控制台页面怎么点） |
| `docs/CLOUDFLARE_RESOURCES.md` | 资源名称、binding 名称、变量填写位置（**不含 Secret**） |
| `docs/BACKUP_AND_UPDATE.md` | D1 备份、升级 upstream、迁移安全、恢复 |
| `docs/FORK_CHANGES.md` | 本站对上游做的所有改动与冲突面 |

> **部署完成之后，日常看 `docs/UPDATING.md` 就够了。**
> 本文档记录的是「从零部署」与「管理员初始化」，属于一次性流程。

### 另一个仓库

主站 `omiki.cc` 的代码在**独立仓库** `omiki1/between-tides`（Next.js 16 静态导出），
与本站点没有代码依赖关系，只共用同一个 Cloudflare zone。其部署配置为
该仓库根目录的 `wrangler.jsonc` 与 `public/_headers`。

---

[返回项目 README](../README.md)
