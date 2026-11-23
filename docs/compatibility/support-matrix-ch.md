# 支持矩阵

**中文** · [English](support-matrix-en.md)

本页是 `reactive-md` 0.9.x、`reactive-md-editor` 0.2.x 和当前 Demo 的公开支持声明，也是支持状态的权威来源。支持状态来自本地检查：每一行都标注检查 ID，由 `npm run support:verify` 执行并记录。兼容规则与版本对应见[版本与兼容性](compatibility-ch.md)。

## 支持等级

| 等级 | 定义 |
| --- | --- |
| `Verified`（已验证） | 所列检查在当前发布线通过，并留有记录。 |
| `Declared`（已声明） | 公布的版本范围或环境在支持范围内；发布前须在该环境中运行检查。 |
| `Unverified`（未验证） | 当前没有支持声明。 |
| `Not supported`（不支持） | 不在支持范围内。 |

## 支持矩阵

| 领域 | 范围 | 等级 | 检查 | 说明 |
| --- | --- | --- | --- | --- |
| Node.js | 22.12+ | Verified | `node-runtime` | 2026-11-23 在 Node 22.x 完成本地验收；检查会记录具体版本。 |
| Node.js | 24 | Declared | `node-runtime` | 在发布环境中用 Node 24 运行同一检查。 |
| React | 19.x（peer `^19.0.0`） | Declared | `react-range` | 以安装的 React 19.3.1 对照 peer 范围检查。 |
| Vite | 8.x（`reactive-md/vite` 的可选 peer `^8.0.0`） | Declared | `vite-range` | 以安装的 Vite 8.3.5 检查。 |
| Chromium（Chrome/Edge） | 引擎浏览器 fixture | Verified | `chromium-core` | 2026-11-23 通过已安装的 Edge/Chromium 渠道本地运行。 |
| Firefox | 引擎浏览器 fixture | Unverified | `firefox-core` | 检查可用，不在当前已验证集合内。 |
| WebKit | 引擎浏览器 fixture | Unverified | `webkit-core` | 检查可用，不在当前已验证集合内。 |
| Safari | Apple 设备 | Unverified | none | 需在实机测试；Playwright WebKit 不是 Safari。 |
| 桌面布局 | 1280-1440 px | Verified | `demo-smoke` | Demo 冒烟测试在 Chromium 下覆盖 1440 px。 |
| 窄屏布局 | 375-390 px | Verified | `demo-smoke` | Demo 冒烟测试覆盖 390 px；引擎 fixture 覆盖 375 px。 |
| SSR 静态渲染 | `react-dom/server` | Declared | `ssr-static` | 在 `npm run build` 之后运行；覆盖静态渲染，不含通用水合。 |
| SSR 水合 | 通用宿主水合 | Not supported | none | 支持的水合路径是 `demo-smoke` 验证的单文件导出。 |
| Worker 编译 | 调度器与编辑器分析 Worker | Verified | `worker-unit` | fast 检查运行 Worker 单元测试套件。 |
| 静态 HTML 导出 | `reactive-md-html/v1` | Verified | `demo-smoke` | Demo 冒烟测试导出文件并在 Chromium 中离线打开。 |
| PDF | `reactive-md/pdf` | Declared | `pdf-static` | 验证环境需要 Playwright Chromium 与 `pdftotext`。 |
| 编辑器包 | `reactive-md-editor` 0.2.0 | Declared | `editor-pack` | 打包消费者覆盖 SSR 导入、Worker 资源和 NodeNext 声明；浏览器 UI 见上方的 Chromium 各行。 |
| 兼容性清单 | 跨包版本集合 | Verified | `compatibility-manifest` | 机器可读的 `compatibility-manifest.json` 校验引擎常量、编辑器包、Demo 候选包和推荐安装命令。 |

## 验证检查

| 检查 | 配置 | 负责方 | 命令 |
| --- | --- | --- | --- |
| `node-runtime` | fast | engine | `built-in` |
| `react-range` | fast | engine | `built-in` |
| `vite-range` | fast | engine | `built-in` |
| `docs-matrix` | fast | engine | `built-in` |
| `worker-unit` | fast | engine | `npm run test -- tests/local-compile-worker.test.ts` |
| `compatibility-manifest` | release | engine | `node scripts/verify-compatibility-manifest.mjs --require-workspace` |
| `chromium-core` | release | engine | `PLAYWRIGHT_ENGINE=chromium node scripts/verify-required-form-browser.mjs` |
| `firefox-core` | release | engine | `PLAYWRIGHT_ENGINE=firefox node scripts/verify-required-form-browser.mjs` |
| `webkit-core` | release | engine | `PLAYWRIGHT_ENGINE=webkit node scripts/verify-required-form-browser.mjs` |
| `ssr-static` | release | engine | `npm run test:boundary` after `npm run build` |
| `pdf-static` | release | engine | `node scripts/verify-pdf.mjs` |
| `demo-smoke` | release | demo | `cd ../ReactiveMD-Demo && npm run test:browser:smoke` |
| `editor-pack` | release | editor | `cd ../ReactiveMD-Editor && npm run check` |

## 运行检查

```sh
npm run support:verify
npm run support:verify -- --profile release
npm run compatibility:verify
npm run support:verify -- --only chromium-core
npm run support:verify -- --include-external --only demo-smoke
```

默认运行 `fast` 配置：内置检查和 Worker 单元测试，不需要浏览器、构建产物或同级仓库。`--profile release` 追加兼容性清单、浏览器、SSR 和 PDF 检查，以及 Demo 和编辑器仓库负责的检查。`--only <id>` 只运行一项检查。`--include-external` 在各自仓库中运行 Demo 和编辑器负责的检查；未传入时这些检查跳过。`--list` 列出全部检查 ID、配置和负责方，不执行检查。`npm run compatibility:verify` 直接检查兼容性清单，需要编辑器与 Demo 仓库存在。

## 证据

每次运行在 `artifacts/support/` 写入带时间戳的记录，并更新 `artifacts/support/latest.json`；该目录已被 Git 忽略。记录包含运行日期、提交、包版本、Node 具体版本、平台、设置时的 Playwright 渠道、配置，以及每项检查的通过、失败或跳过结果。只有当前发布线存在通过记录时，对应行才保持 Verified。发布记录引用发布运行生成的证据摘要。

## 维护

- 支持的运行时、peer 范围或环境变化时更新本矩阵，并在同一次修改中同步中英文版本。
- 包版本、协议修订、Demo 候选包或推荐安装范围变化时，更新 `compatibility-manifest.json`。
- 发布前运行 `npm run support:verify -- --profile release`。
- 只有当前发布线的通过记录才能把行标为 Verified；部分运行、失败或跳过的运行不改变等级。
- 外部检查在各自所属仓库运行。
- 保持检查 ID 稳定。`docs-matrix` 检查两份文档是否都包含全部 ID。