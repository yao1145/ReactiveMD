# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目定位

`reactive-md` 是交互式 Markdown（`.reactive.md`）的**语言引擎**：编译器、运行时、语言服务、SDK、React/SSR 渲染、导出与 CLI。编辑器（`reactive-md-editor`）和 Demo 站点已拆到独立仓库，本仓库不再包含 editor 子路径；编辑器只通过 `reactive-md` 与 `reactive-md/authoring` 使用引擎（见 `docs/integration/repository-split-ch.md`）。语法规范见 `docs/reference/local-interaction-syntax-ch.md`。

文档普遍中英双份（`*-ch.md` / `*-en.md`，根目录为 `README-ch.md`、`CHANGELOG-ch.md` 等），修改公开文档时两种语言要同步。

## 常用命令

Node >= 22.12（CI 使用 Node 24）。

```bash
npm ci
npm run typecheck                 # tsc --noEmit
npm test                          # vitest，全部 tests/**/*.test.{ts,tsx}
npx vitest run tests/local-parser.test.ts            # 单个测试文件
npx vitest run tests/local-parser.test.ts -t "名称"  # 按用例名过滤
npm run build                     # typecheck + 库构建 + standalone + 类型声明
npm run check                     # CI 主检查：build + test + 包边界 + 编译入口 + 版本一致性
npm run test:boundary             # 实际 npm pack 后在临时目录安装消费，校验 exports/文件清单
npm run test:compiler-entry       # 编译入口依赖变化时补跑
npm run check:versions            # 包版本 / SDK 版本 / 协议版本 / CHANGELOG / README 安装行一致性
npm run test:preset-scaffold      # CI 额外运行
```

局部修改先跑直接相关的测试文件，再视影响范围跑 `npm run check`。`scripts/verify-*-browser.mjs` 是 Playwright 浏览器验证脚本（默认 `PLAYWRIGHT_CHANNEL=msedge`，可设为 `chromium`），不在 CI 中，按需手动运行；`scripts/benchmark-*.mjs` 为性能基准。

## 架构概览

### 构建产物与入口

`package.json` 的 `exports` 中每个子路径都对应 `vite.lib.config.ts` 里的一个 lib entry（输出到 `dist-library/`），类型声明由 `tsconfig.lib.json` 生成后经 `scripts/finalize-declarations.mjs` 整理。新增/调整公开子路径时，这三处以及 `scripts/verify-public-package.mjs` 的检查要一起改。`dist-standalone/` 由 `vite.standalone.config.ts` 构建（单文件交互 HTML 的运行时）。React、react-dom、vite 都是可选 peer，构建时 external。

### `src/` 主要模块

- `local/` —— 引擎核心（解析 → 编译 → 求值 → 运行时 → 渲染），按职责分为 14 个目录。**务必先读 `src/local/README.md`**：新文件的放置规则，以及“只用精确路径跨目录导入、禁止新增目录级 `index.ts` barrel”的约束（避免 KaTeX/React 被拉进纯编译路径）。`src/local/index.ts` 是唯一 barrel，由包根 `src/index.ts` 再导出。
- `compiler/` —— `reactive-md/compiler` 与 `compiler/standard` 入口（无 React 的编译 API）。
- `sdk/` —— 组件包 manifest、preset、registry、config/assembly 协议；`sdk/version.ts` 定义 SDK 版本与各协议标识。
- `presets/`、`components/`、`themes/default/` —— 默认组件集与默认主题（`components/uiarc` 为内置的第三方 UI 组件，带独立 LICENSE）。
- `react/` —— React 渲染器、组件 API、SSR（`server.tsx`）、`react/runtime`。
- `runtime-services/` —— 状态持久化、调度、浏览器侧服务。
- `authoring/` —— 编辑器无关的作者工具：组件目录、插入命令、模板、i18n。
- `vite/`、`build/` —— Vite 插件（`theme/`、`plugin/` 目录自动发现，见 `docs/integration/directory-discovery-ch.md`）与构建 API。
- `export/`、`standalone/`、`shareable.ts` —— 单文件 HTML 导出与离线包。
- `testing/` —— 对外提供的测试工具（`reactive-md/testing*`）。

`cli/`（纯 `.mjs`，由 `bin/reactive-md.mjs` 调用 `cli/main.mjs`）实现 `init/build/check/lint/migrate` 命令，不经过 TypeScript 构建。

### 版本体系

包版本（`package.json`）、语法版本（`LOCAL_SYNTAX_VERSION`，`src/local/contracts/version.ts`）、SDK/组件/配置/主题协议版本（`src/sdk/version.ts`）**相互独立**，不随发版同步变动。`scripts/check-versions.mjs` 校验它们与 `cli/init.mjs` 脚手架常量、CHANGELOG 首个标题、README 中 `npm install reactive-md@<版本>` 行之间不漂移，发版时需一并更新。

### 测试

测试全部在 `tests/`（vitest，约 140 个文件），`tests/fixtures/` 为样例文档，`tests/browser/` 为浏览器脚本用的 fixture 页面。`examples/conformance/` 存放语法/组件协议的一致性样例与历史版本，`conformance.test.ts` 等会读取它们。

## 约定

- 不提交 `dist-*`、依赖或凭据；行为变化补针对性回归测试，保留安全与资源预算（limits/parse budget），并更新公开文档。
- 提交信息使用 Conventional Commits 风格（`feat(theme): …`、`fix(release): …`、`test: …`），英文。
- 发布只通过手动触发的 `.github/workflows/publish.yml`（npm OIDC），本地不执行 `npm publish`/`npm dist-tag`，流程见 `docs/development/releasing-ch.md`。
