# Cloudflare 资源与绑定清单

本文件只记录**资源名称、binding 名称、资源用途与归属**。

> **本文件严禁记录任何 Secret。**
> 包括但不限于 `BETTER_AUTH_SECRET`、`GITHUB_CLIENT_SECRET`、`GITHUB_TOKEN`、
> `UMAMI_API_KEY`、`UMAMI_PASSWORD`、`TURNSTILE_SECRET_KEY`、`CLOUDFLARE_D1_TOKEN`、
> 以及任何 API Token / 密码 / 私钥。
> 这里只写「哪个变量名需要在哪个位置填写、填什么类型的值」，具体值由站主本人录入。
>
> 资源 ID（D1 Database ID、KV Namespace ID、Account ID）**不是 Secret**，但属于账号
> 内部标识。本文件记录它们，因为它们是 `wrangler.jsonc` / `.env` 的必需输入，
> 泄露风险远低于 Token（拿到 ID 无法读写资源，还需要有效的 API Token 或账号会话）。
> **仍然只记录 ID 本身，不记录任何能用来认证的值。**

---

## 0. 账号与域名（实际值）

| 项 | 值 | 说明 |
| --- | --- | --- |
| Cloudflare 账号 ID | `ca1645341e22bf174f5658d2d375e331` | 见控制台 URL 中的那段 hash |
| 域名 | `omiki.cc` | 在 Cloudflare Registrar 购买 |
| Zone ID | `b4ac684cd9f2cd7a2e64c3c0bb5adba0` | `omiki.cc` 的 zone |
| 域名状态 | Active / full | 2027-09-16 到期，自动续订 |
| workers.dev 子域 | `omiki1` | 即 `*.omiki1.workers.dev` |

### 两个站点、两个 Worker

本站点是**主站 + 博客后台**的双站点结构，两套相互独立部署：

| 站点 | 域名 | Worker | 代码仓库 | 技术形态 |
| --- | --- | --- | --- | --- |
| 主站 / Portfolio | `omiki.cc` | `omiki1-home` | `omiki1/between-tides` | Next.js 16 静态导出，仅静态资源 |
| 博客 / CMS 后台 | `blog.omiki.cc` | `omiki1-blog` | `omiki1/flare-stack-blog` | TanStack Start SSR + D1/R2/KV/DO/Queue |

> **为什么是两个 Worker 而不是一个：**
> 主站是纯静态产物，不需要任何服务端资源；博客是完整的 Serverless 应用，需要 6 个绑定。
> 用一个 Worker 承载两者会强行给静态站引入一套它不需要的运行时依赖，
> 也违反了「如果一个功能普通静态托管就能完成，不要强行上复杂架构」的原则。
> 两者的唯一共同点是都使用同一个 zone `omiki.cc`。

---

## 1. 命名约定

所有资源统一使用 `omiki1-blog` 前缀，便于在 Cloudflare 控制台里一眼识别归属。

| 资源类型 | 资源名称 | 出现在哪个变量里 | 实际 ID / 值 |
| --- | --- | --- | --- |
| Worker（博客） | `omiki1-blog` | `WORKER_NAME` | — |
| Worker（主站） | `omiki1-home` | — | 静态资源，无变量 |
| D1 数据库 | `omiki1-blog-db` | `D1_DATABASE_ID`（填 **ID**，不是名称） | `4216488c-a345-4f7d-a387-ccbe9b846b84` |
| R2 存储桶 | `omiki1-blog-media` | `BUCKET_NAME`（填**名称**） | 名称即值，2026-09-16 创建 |
| Queue 队列 | `omiki1-blog-queue` | `QUEUE_NAME`（填**名称**） | `8c88a95dc4d74548850f3eac1cde7743` |
| KV 命名空间 | `omiki1-blog-cache` | `KV_NAMESPACE_ID`（填 **ID**，不是名称） | `6a34cbc64ec04ead8e251fc4d3071e97` |

> **易错点：** D1 与 KV 填 **ID**，R2 与 Queue 填 **名称**。
> 这是本项目 `wrangler.example.jsonc` 与 `docs/deployment.md` 的实际约定，
> 官方部署文档「常见问题」里也专门提示了这一点。

### 域名变量

| 变量 | 用途 | 实际值 |
| --- | --- | --- |
| `DOMAIN` | 博客纯域名（无协议、无路径） | `blog.omiki.cc` |
| `BETTER_AUTH_URL` | 完整访问地址（含 `https://`） | `https://blog.omiki.cc` |
| `NEXT_PUBLIC_SITE_URL` | 主站公开地址（写在 `.env.production`） | `https://omiki.cc` |
| `ZONE_NAME` | 仅在 `ROUTE=1` 路由模式下需要 | 未使用（默认 Custom Domain，自动推导） |
| `ROUTE` | 设为 `1` 时改用 Workers Routes 而非 Custom Domain | 未设置 |

域名**不得硬编码**，两个仓库都做到了：

- 博客：`DOMAIN` 只出现在 `.env` / `.dev.vars` 与 `src/lib/env/server.env.ts` 的 schema 里，
  `wrangler.jsonc` 由 `scripts/prepare-wrangler-config.ts` 在构建期从环境变量生成。
- 主站：域名只出现在两处 —— `.env.production` 的 `NEXT_PUBLIC_SITE_URL` 与
  `wrangler.jsonc` 的 `routes[].pattern`。

**换域名时的完整清单见 `docs/MY_DEPLOYMENT.md` 第 6 节。**

---

## 2. 绑定清单（Worker 运行时 bindings）

以下 binding 名称来自 `wrangler.example.jsonc`，是项目**已有且稳定**的约定。
**不要重命名任何一项**，否则需要同步修改 `src/` 下的引用与测试。

| binding | 类型 | 资源 | 用途 |
| --- | --- | --- | --- |
| `DB` | D1 Database | `omiki1-blog-db` | 主关系型数据库：文章、用户、评论、分类、标签、媒体元数据、搜索索引、系统配置 |
| `R2` | R2 Bucket | `omiki1-blog-media` | 媒体对象存储：文章封面、正文图片、头像 |
| `KV` | KV Namespace | `omiki1-blog-cache` | 公开内容缓存（Public Cache）、文章热度快照、版本更新检查缓存 |
| `QUEUE` | Queue Producer + Consumer | `omiki1-blog-queue` | 异步任务：通知邮件、Webhook 派发 |
| `RATE_LIMITER` | Durable Object | 类 `RateLimiter` | 令牌桶限流：注册、找回密码、评论、友链申请 |
| `POST_PUBLISHER` | Durable Object | 类 `PostPublisher` | 文章发布串行化与公开内容快照更新 |

### 绑定的补充说明

- **`QUEUE` 同时是生产者和消费者。** `wrangler.example.jsonc` 里
  `queues.producers` 和 `queues.consumers` 指向同一个队列，
  consumer 配置为 `max_batch_size: 10` / `max_batch_timeout: 5` / `max_retries: 3`。
  只创建队列本身即可，不需要再建第二个。
- **Durable Object 的 `migrations` 列表不可删改。** `wrangler.example.jsonc`
  里的四条记录（`rate-limiter-v1`、`password-hasher-v1`、`password-hasher-v2`、
  `post-publisher-v1`）是 Cloudflare 侧 DO 类迁移历史。
  其中 `password-hasher-v2` 的 `deleted_classes` 是**有意保留**的历史记录，
  删除它会导致 DO 迁移状态不一致。**禁止清理这份列表。**
- **`R2` 与 `KV` 的 `remote: true` 保持注释状态。** 模板里这三行（含 D1）都被注释掉了。
  这是刻意的：日常本地开发使用 Miniflare 模拟，不碰生产数据。
  只有明确要针对生产做一次性操作时才临时打开，用完立即恢复。

---

## 3. 非 binding 的 Cloudflare 能力

这些功能通过控制台开关或 Worker 配置启用，**没有 binding**：

| 能力 | 位置 | 用途 | 是否必需 |
| --- | --- | --- | --- |
| Custom Domain | Worker → Settings → Domains & Routes | 把 `DOMAIN` 绑定到 Worker | ✅ 必需 |
| Workers Builds | Compute → Workers & Pages → 连接 GitHub | 自动构建与部署 | ✅ 必需 |
| Cron Trigger | `wrangler.example.jsonc` 的 `triggers.crons` = `15 0 * * *` | 每天 00:15 UTC 同步文章热度 | ✅ 随 Worker 自动创建 |
| Workers Caching | `wrangler.example.jsonc` 的 `cache.enabled` + `exports` | 公开页面边缘缓存与按 tag 清除 | ✅ 随 Worker 自动创建 |
| Observability | `wrangler.example.jsonc` 的 `observability.enabled` | 日志与错误追踪 | ✅ 随 Worker 自动创建 |
| Image Transformations | 账号侧栏 → Images → Transformations | R2 图片按宽度/质量实时缩放与格式转换 | ⬜ 可选，开启后图片更省流量 |
| Turnstile | 账号侧栏 → Turnstile | 注册/登录/评论/友链的人机验证 | ⬜ 可选，正式上线建议开启 |
| Umami | 第三方（Cloud 或自托管） | 访问统计与文章热度数据源 | ⬜ 可选 |

### 关于 Cron 与热度同步

`triggers.crons` 触发 `src/server.ts` 的 `scheduled()`，调用
`postPopularityService.sync()`。它需要 Umami 的 API 参数才能工作：

- 未配置 Umami → 该任务会记录失败日志并抛出 `Post popularity sync failed`。
  这**不影响**站点正常访问，只是热度排序不可用。
- 因此：**如果暂时不打算上 Umami，这是预期行为，不需要修。**
  若日志噪音无法接受，再考虑去掉 cron 配置（这会是一次有意的配置分叉，需记录在
  `docs/FORK_CHANGES.md`）。

---

## 4. Secret 与变量：填写位置总表

**本表只写变量名与填写位置，不写值。**

### 构建时变量（Cloudflare Builds → Settings → Builds → Variables）

| 变量 | 值类型 | 说明 |
| --- | --- | --- |
| `WORKER_NAME` | 普通文本 | 必须与 Worker Project name 完全一致 |
| `DOMAIN` | 普通文本 | 纯域名，无协议 |
| `D1_DATABASE_ID` | 普通文本 | D1 的 **ID / UUID** |
| `BUCKET_NAME` | 普通文本 | R2 桶**名称** |
| `QUEUE_NAME` | 普通文本 | 队列**名称** |
| `KV_NAMESPACE_ID` | 普通文本 | KV 的 **ID** |
| `VITE_TURNSTILE_SITE_KEY` | 普通文本 | 可选。Turnstile **Site Key**（公开值，会进前端产物） |
| `VITE_UMAMI_WEBSITE_ID` | 普通文本 | 可选。Umami Website ID |
| `BUN_VERSION` | 普通文本 | 可选，例如 `1.3.5`，固定构建环境 Bun 版本 |

### 运行时变量与机密（Worker → Settings → Runtime variables and secrets）

| 变量 | 是否勾选 Secret | 说明 |
| --- | --- | --- |
| `BETTER_AUTH_SECRET` | ✅ **Secret** | 认证会话密钥，至少 32 字符 |
| `GITHUB_CLIENT_SECRET` | ✅ **Secret** | GitHub OAuth App 的 Client Secret |
| `TURNSTILE_SECRET_KEY` | ✅ **Secret** | 可选。Turnstile Secret Key |
| `UMAMI_API_KEY` | ✅ **Secret** | 可选。Umami Cloud 用；与用户名密码二选一 |
| `UMAMI_PASSWORD` | ✅ **Secret** | 可选。自托管 Umami 用 |
| `GITHUB_TOKEN` | ✅ **Secret** | 可选。降低更新检查的 GitHub API 限流 |
| `BETTER_AUTH_URL` | ⬜ 普通文本 | 例如 `https://blog.example.com` |
| `DOMAIN` | ⬜ 普通文本 | 与构建时 `DOMAIN` 保持一致 |
| `GITHUB_CLIENT_ID` | ⬜ 普通文本 | OAuth App 的 Client ID（公开值） |
| `ENVIRONMENT` | ⬜ 普通文本 | 生产填 `prod` |
| `LOCALE` | ⬜ 普通文本 | 可选，`zh` 或 `en`，默认 `zh` |
| `UMAMI_WEBSITE_ID` | ⬜ 普通文本 | 可选，与构建时的 `VITE_UMAMI_WEBSITE_ID` 填同一个 |
| `UMAMI_SRC` | ⬜ 普通文本 | 可选，例如 `https://cloud.umami.is` |
| `UMAMI_API_URL` | ⬜ 普通文本 | 可选，例如 `https://api.umami.is/v1` |
| `UMAMI_USERNAME` | ⬜ 普通文本 | 可选 |

> **不要**把 `ENVIRONMENT` 在生产环境设为 `dev`。
> `src/lib/env/server.env.ts` 的 `isNotInProduction()` 以该值判断环境，
> 设为 `dev` 会让邮件走「只打印到控制台」的开发分支。

### D1 相关（仅本地工具使用，不进 Worker）

以下三项只给 `bun db:studio` / `bun db:push` 等本地 Drizzle 工具用，
写在本地 `.env` 里即可，**不要**填进 Cloudflare 的构建变量或运行时变量：

| 变量 | 说明 |
| --- | --- |
| `CLOUDFLARE_ACCOUNT_ID` | 账号 ID（本地工具用） |
| `CLOUDFLARE_DATABASE_ID` | 同 `D1_DATABASE_ID` |
| `CLOUDFLARE_D1_TOKEN` | D1 API Token，**属于 Secret**，只放本地 |

---

## 5. 相关文件

| 文件 | 作用 |
| --- | --- |
| `wrangler.example.jsonc` | 模板。**不要直接编辑**，改由环境变量替换占位符 |
| `scripts/prepare-wrangler-config.ts` | 把模板占位符替换为实际值，生成 `wrangler.jsonc` |
| `.env.example` | 构建时变量模板 |
| `.dev.vars.example` | 运行时变量模板 |
| `wrangler.jsonc` | 生成物，已被 `.gitignore` 忽略，**不进版本库** |
| `docs/deployment.md` | 上游官方图文部署指南 |
| `docs/MY_DEPLOYMENT.md` | 本站主自己的部署流程（含首用户管理员安全步骤） |
| `docs/BACKUP_AND_UPDATE.md` | D1 备份、升级与恢复流程 |

---

[返回项目 README](../README.md)
