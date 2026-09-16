# Fork 改动与上游冲突面

这份文档记录 **`omiki1/flare-stack-blog` 相对上游 `du2333/flare-stack-blog` 的每一处改动**。

目的有三个：

1. **同步上游时能预判哪里会冲突。**
2. **几年后回看时能明白当初为什么这样改。**
3. **避免无意识地把上游核心文件改烂**，导致永远无法再同步。

> **命名说明：** 上游 `docs/` 已有既定风格（`deployment.md`、`adr/`、`agents/`、
> `research/`）。本文件名取 `FORK_CHANGES.md` 而非 `PERSONALIZATION.md`，
> 是为了与上游文档并列时语义更直白，也降低将来与上游新增文档撞名的概率。
> 如需改名，改一处文件名并更新 `docs/MY_DEPLOYMENT.md` 第 8 节的引用即可。

---

## 0. 改动总览

| # | 类型 | 文件 | 是否与上游冲突 | 是否影响运行时 |
| --- | --- | --- | --- | --- |
| 1 | 新增 | `.gitattributes` | ⬜ 新增文件，不冲突 | ⬜ 不影响 |
| 2 | 新增 | `scripts/typecheck.mjs` | ⬜ 新增文件，不冲突 | ⬜ 不影响 |
| 3 | 修改 | `package.json`（4 行脚本） | 🟡 **会冲突**（上游常改此文件） | ⬜ 不影响生产构建 |
| 4 | 新增 | `docs/CLOUDFLARE_RESOURCES.md` | ⬜ 新增文件，不冲突 | ⬜ 不影响 |
| 5 | 新增 | `docs/MY_DEPLOYMENT.md` | ⬜ 新增文件，不冲突 | ⬜ 不影响 |
| 6 | 新增 | `docs/BACKUP_AND_UPDATE.md` | ⬜ 新增文件，不冲突 | ⬜ 不影响 |
| 7 | 新增 | `docs/FORK_CHANGES.md`（本文件） | ⬜ 新增文件，不冲突 | ⬜ 不影响 |
| 8 | 新增 | `docs/UPDATING.md` | ⬜ 新增文件，不冲突 | ⬜ 不影响 |
| 9 | 环境 | 用户级 `~/.config/husky/init.sh` | ⬜ **不在仓库内** | ⬜ 不影响 |

**核心结论：目前只有一个文件会让上游同步产生冲突 —— `package.json`，而且只涉及 4 行脚本定义。**

UI、样式、内容、认证、数据库、Cloudflare 绑定**一律未改动**。

---

## 1. `.gitattributes`（新增）

### 改了什么

```gitattributes
* text=auto eol=lf
# 另显式标记二进制资源（png/jpg/webp/woff2/mp3/wav/pdf/zip 等）
```

### 为什么改

Git for Windows 的全局默认是 `core.autocrlf=true`，检出时把所有文本文件写成 CRLF。
而仓库的质量门禁里包含 `oxfmt --check`，它**按原始字节比较**，因此 CRLF 会让
每一个文件都被判为「格式错误」。本机实测：

```text
Format issues found in above 587 files. Run without `--check` to fix.
```

也就是 589 个受检文件里 587 个失败，仓库自带的门禁在 Windows 上**完全无法通过**。
这不是代码问题，是检出方式问题。

有两个修法：

| 方案 | 代价 |
| --- | --- |
| 跑一次 `oxfmt --write` 让工具重写全仓库 | ❌ 产生 587 文件的巨型 diff，与上游彻底无法同步 |
| 声明 `eol=lf`，让检出结果与仓库内容一致 | ✅ 零 diff，且对上游是纯收益 |

选第二个。`.gitattributes` 是仓库级声明，优先级高于用户的 `core.autocrlf` 设置，
因此**不需要站主改自己的 Git 全局配置**，换机器后也自动生效。

### 同步上游时的冲突面

⬜ **不会冲突。** 新增文件。除非上游将来也加 `.gitattributes`，
否则每次 `git merge upstream/...` 都会干净通过。

如果上游真的加了同名文件，把两边内容合并即可（我们的声明是保守的，不覆盖上游特殊规则）。

---

## 2. `scripts/typecheck.mjs`（新增）

### 改了什么

新增一个 Node 脚本，用 Node 自身的模块解析定位 TypeScript 7 的**平台原生二进制**，
并把命令行参数原样转发。

```js
// 解析 @typescript/typescript-<platform>-<arch>/lib/tsc[.exe]
packageRoot = dirname(require.resolve(`${platformPackage}/package.json`));
const candidate = join(packageRoot, "lib", binaryName);
```

### 为什么改

仓库的类型检查命令是：

```bash
./node_modules/typescript/bin/tsc --noEmit
```

`node_modules/typescript/bin/tsc` 的内容是：

```js
#!/usr/bin/env node
import "../lib/tsc.js";
```

一个带 shebang 的**无扩展名 POSIX shell 脚本**。它的可执行性依赖两点：

- Linux/macOS 的内核按 shebang 直接执行；
- 或由 Bun 的 shell 模拟执行（上游 CI 就是 `ubuntu-latest` + `oven-sh/setup-bun`）。

在 Windows 上，cmd/PowerShell 与 Bun 的 shell 模拟**都不会**执行无扩展名文件，
于是直接报：

```text
bun: command not found: ./node_modules/typescript/bin/tsc
```

TypeScript 7 是原生编译器，真正干活的是平台相关可选依赖：

```text
node_modules/@typescript/typescript-win32-x64/lib/tsc.exe     (Windows)
node_modules/@typescript/typescript-linux-x64/lib/tsc        (Linux)
```

`node_modules/typescript/lib/getExePath.js` 内部就是这个解析逻辑。
本脚本复用它，保证各平台跑的是**同一个编译器版本**（本机实测 `7.0.2`），
而不是退化成「用 `bunx tsc` 拉一个 TypeScript 6」——那会造成版本不一致，
类型行为可能与上游 CI 不同。

### 同步上游时的冲突面

⬜ **不会冲突。** 新增文件。上游不会创建同名文件。

---

## 3. `package.json`（修改）

### 🔴 这是唯一会冲突的文件

改动很小，只有脚本段四行：

```diff
   "orpc:contract": "bun run i18n:compile && bun scripts/generate-orpc-contract.ts && oxfmt src/lib/orpc/contract.generated.json",
-  "typecheck": "bun run orpc:contract && ./node_modules/typescript/bin/tsc --noEmit",
-  "check": "bun run orpc:contract && oxlint && oxfmt --check && ./node_modules/typescript/bin/tsc --noEmit",
+  "typecheck": "bun run orpc:contract && node scripts/typecheck.mjs --noEmit",
+  "typecheck:upstream": "bun run orpc:contract && ./node_modules/typescript/bin/tsc --noEmit",
+  "check": "bun run orpc:contract && oxlint && oxfmt --check && node scripts/typecheck.mjs --noEmit",
+  "check:upstream": "bun run orpc:contract && oxlint && oxfmt --check && ./node_modules/typescript/bin/tsc --noEmit",
```

上游原命令**完整保留**为 `typecheck:upstream` / `check:upstream`，所以：

- 想知道「上游 CI 会怎么判」→ `bun run check:upstream`
- 想在本机正常跑 → `bun run check`

### 为什么改

见第 2 节。Windows 上原命令无法执行。

### 为什么改 `package.json` 而不是别的做法

考虑过四个方案：

| 方案 | 结论 |
| --- | --- |
| 每次提交前手工敲 `node --experimental-strip-types ./node_modules/typescript/bin/tsc` | ❌ 不可持续，靠记忆，迟早漏 |
| 在 `node_modules/` 里放一个 shim | ❌ `node_modules` 不入库，`bun install` 后丢失 |
| 改全局 Git / 系统配置绕过 | ❌ 解决不了「Bun 不执行无扩展名文件」这个根因 |
| **改 `package.json` 里的脚本路径** | ✅ 唯一稳定方案，且只碰 4 行 |

### 同步上游时的冲突面

🟡 **会冲突，但可控。**

- `package.json` 是上游高频修改的文件（依赖升级、新增脚本）。
  每次上游改动 `scripts` 段落，`git merge` 都可能在这一块报冲突。
- **冲突解决方式固定：** 保留上游对 `scripts` 的其他所有改动，
  只把 `typecheck` / `check` 两行的编译器路径换回 `node scripts/typecheck.mjs --noEmit`，
  并确认 `typecheck:upstream` / `check:upstream` 仍在。
- 冲突频率预期：**上游每次发版几乎都会碰 `package.json`**，
  所以这一处冲突基本每次都会遇到。这是已知且可接受的成本。

**降低冲突的备选方案（如果将来觉得烦）：**

把编译器路径抽到一个环境无关的 npm script 之外的方式，例如
`"typecheck": "bun run orpc:contract && bun run scripts/typecheck.ts --noEmit"`。
但无论怎么写，`typecheck` / `check` 这两行一定与上游不同，
冲突面不会因为写法而消失。**保持现状即可。**

---

## 4–7. `docs/` 下的四份新文档（新增）

| 文件 | 内容 |
| --- | --- |
| `docs/CLOUDFLARE_RESOURCES.md` | 资源名称、binding 名称、变量填写位置（**不含 Secret**） |
| `docs/MY_DEPLOYMENT.md` | 本站部署流程，含首用户管理员安全初始化 |
| `docs/BACKUP_AND_UPDATE.md` | D1 备份、上游升级、迁移安全、恢复 |
| `docs/FORK_CHANGES.md` | 本文件 |

### 为什么新增而不是改上游文档

`docs/deployment.md` 是上游的通用指南，站主每次同步上游都会拿到最新版本。
如果把本站的具体域名、资源 ID、流程写进去，会有两个后果：

1. 每次上游更新该文件都会冲突；
2. 上游的通用说明会被本站的具体值污染，以后无法判断「哪个是上游的规范」。

因此**纯新增**，让上游文档保持原样。

### 同步上游时的冲突面

⬜ **不会冲突。** 四个都是新增文件。唯一风险是上游将来新增同名文档
（`MY_DEPLOYMENT.md` 几乎不可能；`CLOUDFLARE_RESOURCES.md` 概率也很低）。

---

## 8. 机器级配置（不在仓库内）

这一项**不在 Git 里**，因此不影响上游同步，但换机器时需要重做。

### `~/.config/husky/init.sh`

```sh
export PATH="$HOME/.bun/bin:$PATH"
```

**原因：** 仓库的 `.husky/pre-commit` 内容是 `bun lint`，
它由 Git for Windows 自带的 MSYS `sh` 执行。本机的
**Machine PATH 里有一条损坏条目**（`ram Files\nodejs\`，是
`C:\Program Files\nodejs` 被截断的结果），导致 Git 的 sh 拿不到完整 PATH，
找不到 `bun`，于是每次提交都失败：

```text
.husky/pre-commit: line 1: bun: command not found
husky - pre-commit script failed (code 127)
```

husky 9 固定会 source `${XDG_CONFIG_HOME:-$HOME/.config}/husky/init.sh`
（见 `node_modules/husky/.../h` 脚本），这是官方提供的注入点。
在这里补 PATH 即可，**不需要改仓库任何文件**。

> **建议在 系统属性 → 环境变量 里把那条损坏的 Machine PATH 条目修好**
> （`ram Files\nodejs\` → `C:\Program Files\nodejs\`）。
> 修好后这个 init.sh 仍可保留，无害。

### 另外做过的一次性操作

- Bun 已加入**用户级** PATH（`C:\Users\<用户>\.bun\bin`）。
- `flare-stack-blog` 仓库本地设了 `core.autocrlf=false`
  （`.gitattributes` 生效后这一项已非必需，保留无害）。
- 在 `C:\Users\<用户>\.bun\bin\` 下加了一个 `bun` 的 sh shim
  （内容为 `exec "$(dirname "$0")/bun.exe" "$@"`），
  因为该目录原本只有 `bun.exe`，MSYS shell 认不出。

---

## 9. 明确保持原样的部分

以下内容**全部没有改动**，这是有意的。列出它们是为了让「将来要不要改」有据可依。

| 领域 | 保持原样的理由 |
| --- | --- |
| **Better Auth 认证系统** | `src/lib/auth/*`。成熟且与 D1 schema、会话策略耦合紧密，重写没有收益只有风险 |
| **D1 Schema 与迁移框架** | `src/lib/db/schema/*`、`migrations/*`、`drizzle.config.ts`。已有 22 个迁移，改动会破坏升级路径 |
| **Durable Objects** | `RateLimiter`、`PostPublisher`。限流与发布串行化的正确实现，无需干预 |
| **Queues** | 通知邮件与 Webhook 的异步解耦 |
| **权限与 API 认证** | `src/lib/auth/api-key-guard.ts`、`src/lib/orpc/procedure.ts` 的 procedure 分层 |
| **缓存架构** | `src/features/cache/*`（Workers Caching + KV 双层） |
| **Cloudflare 绑定名称** | `DB` / `R2` / `KV` / `QUEUE` / `RATE_LIMITER` / `POST_PUBLISHER`。改名需要同步改 `src/` 与全部测试 |
| **`wrangler.example.jsonc`** | 完全未改。所有配置通过环境变量替换占位符 |
| **前端技术栈** | React 19 / TanStack Start / Tailwind 4 / TipTap / oRPC / Drizzle 全部保留 |
| **Fuwari 视觉体系** | `src/styles.css` 的 `--fuwari-*` token 未改 |
| **上游 `docs/` 原有文档** | `deployment.md`、`adr/*`、`agents/*`、`research/*` 一字未改 |

---

## 10. 将来做 UI 个性化时的规则

第 4 阶段的个性化**尚未开始**。开始之前先约定规则，避免把 fork 变成无法同步的状态。

### 优先级：新增 > 配置 > 修改

```text
1. 新增组件 / 新增配置文件 / 新增样式文件    ← 首选，零冲突
2. 通过后台「设置 → 站点」配置                ← 零代码改动
3. 修改现有文件                              ← 最后手段，必须登记到本文件
```

### 具体约束

1. **优先走后台配置。** 站点名称、介绍、作者、头像、首页背景色相（`--fuwari-hue`）、
   导航链接、社交链接，后台「设置 → 站点」都能改，**不需要碰代码**。
   改之前先确认后台改不了，再考虑写代码。

2. **个性化样式放独立文件。** 例如新增 `src/styles/site-custom.css` 并在
   `src/styles.css` 末尾 `@import`。这样上游改 `styles.css` 时冲突面只有一行 `@import`。

3. **新增组件而不是改组件。** 例如要换首页 Hero，优先新建
   `src/features/home/components/my-hero.tsx`，只在原有位置的 1–2 行做替换，
   而不是把原组件整体重写。

4. **不要碰认证、数据库、Cloudflare bindings。** UI 个性化必须与这三者解耦。

5. **每改一处就登记到本文件第 0 节的表里**，注明：改了什么、为什么、
   哪个文件、冲突预期。这是这份文档存在的意义。

6. **改动后必须跑**：
   ```bash
   bun run check && bun run test && bun run test:node
   ```
   不允许为了让检查通过而关掉 TypeScript / ESLint / 测试。

### 上游同步时的检查动作

每次合并上游后，按本文件第 0 节表格逐项确认：

- 新增文件是否被上游覆盖？（几乎不会）
- `package.json` 的四行脚本是否还在？（**最可能丢的就是这个**）
- 如果上游修改了 `styles.css`、`src/features/home/*` 等你改过的文件，
  按本文件第 10 节的约束解决冲突，优先保留双方的功能而不是二选一。

---

## 11. 变更日志

| 日期 | 上游基线 | 改动 | 提交 |
| --- | --- | --- | --- |
| 2026-09-15 | v2.0.1 | 新增 `.gitattributes`、`scripts/typecheck.mjs`，修改 `package.json` 四行脚本 —— 让 `bun run check` 在 Windows 可用并固定 LF 行尾 | `a49eee1a` |
| 2026-09-15 | v2.0.1 | 新增 `docs/CLOUDFLARE_RESOURCES.md`、`docs/MY_DEPLOYMENT.md`、`docs/BACKUP_AND_UPDATE.md` | `6ce6a9e1` |
| 2026-09-15 | v2.0.1 | 新增 `docs/FORK_CHANGES.md`（本文件） | 见 git log |

---

[返回项目 README](../README.md)
