# 发布清单

本文件是维护者的手动发布流程。本清单覆盖发布在 `next` 渠道的 `0.4.0` 预览版；`0.3.1` 保持 `latest`，直到另行决定提升。版本规则见[版本与兼容性](compatibility-ch.md)，面向使用者的升级说明见[0.4.0 发布与迁移](release-0.4.0-ch.md)。

## 发布前确认

### 包身份与元数据

非 scope 名称 `reactive-md` 已由已发布的 `0.3.0`、`0.3.1` 建立，`reactive-md/react` 和 `reactive-md/styles.css` 子路径也随这些版本生效。不要把改名当作常规发布准备：改名会破坏导入、状态工具和文档。

1. 除非维护者明确决定改用 scope，否则保持 `reactive-md`。scope 需要对应的 npm 账号或组织权限。
2. 如果改名，同时更新 `package.json` 的 `name`、文档中的导入语句、tarball 文件名说明、示例和两个子路径，并在变更记录中按破坏性变更说明。
3. 核对 `package.json` 的 `repository`、`homepage`、`bugs`、`license`、`engines` 等发布元数据；当前已设置，发布前确认 URL 和最低 Node 版本仍然正确，并确认 `private` 保持移除状态。
4. 确认 `files` 覆盖发布所需内容。当前包含 `dist-library`、`dist-standalone`、`bin`、`cli`、README（`README.md`、`README-en.md`、`README-ch.md`）、中英文贡献指南、变更记录与安全策略、`THIRD_PARTY_NOTICES.md`、`docs` 和 `examples`；新增文档或 notice 时同步加入 `files`。

包名和版本决定 tarball 名称。当前 `0.4.0` 的预期文件名是 `reactive-md-0.4.0.tgz`；改名或改版本后以 `npm pack` 的实际输出为准。

### 第三方 notice

库产物打包了 `remark-gfm@4.0.1`、`remark-parse@11.0.0`、`unified@11.0.5` 及其依赖。独立 HTML 运行时还打包了 React、React DOM 和 scheduler；库的 React 入口使用宿主提供的 peer dependency。`THIRD_PARTY_NOTICES.md` 保留这些打包依赖的版权和许可声明。

维护者在发布前：

1. 运行 `npm run notices`，从已安装依赖重新生成 `THIRD_PARTY_NOTICES.md`。生成脚本覆盖 `remark-gfm`、`remark-parse`、`unified`、`react`、`react-dom` 的依赖树和实际许可证文本，包括 scheduler。
2. 确认 `package.json` 的 `files` 包含 `THIRD_PARTY_NOTICES.md`，并随 tarball 分发。
3. 检查 `npm pack --dry-run` 的输出，确认没有 `node_modules`、`demo/`、`demo/artifacts/`、测试产物或本地缓存。
4. 核对依赖许可证与打包内容一致；新增或升级 Markdown 依赖后重新生成 notice。

## 本地 tarball 安装

完整的本地门禁是：

```sh
npm ci
npm run verify:release
```

`verify:release` 运行 Node 端与浏览器检查，构建包，在仓库外安装真实 tarball，并验证多份能力组合后的文档行为；它自行管理预览服务和浏览器生命周期。CI 通过 `verify:release:node` 和 `verify:release:browser` 分片运行同一门禁。本机需已安装浏览器。

packed 检查会在 `artifacts/release-package/` 保留经过验证的原始安装包，并在同目录的 `package-verification.json` 记录 SHA256 与 npm integrity。完整门禁通过后发布这一安装包；源码、包元数据或随包文档变化后重新验证。

需要手工检查包内容时，直接使用 tarball。在仓库根目录：

```sh
npm pack
```

`npm pack` 会通过 `prepack` 先运行构建和 `npm run notices`，生成 `dist-library/` 与 `THIRD_PARTY_NOTICES.md`。`dist-library/` 是 `package.json` 的 `exports` 指向的目录。随后在一个空目录中验证安装：

```sh
mkdir /tmp/reactive-md-consumer
cd /tmp/reactive-md-consumer
npm init -y
npm install /path/to/reactive-md-0.4.0.tgz
```

核心入口可在 Node 中直接检查：

```sh
node --input-type=module -e "import { compileLocal, LOCAL_SYNTAX_VERSION } from 'reactive-md'; console.log(LOCAL_SYNTAX_VERSION, compileLocal('# ok').ok)"
```

React 入口需要另装 React 19：

```sh
npm install react@19 react-dom@19
```

```tsx
import { LocalReactiveDocument } from 'reactive-md/react';
import 'reactive-md/styles.css';
```

静态 SSR 渲染由 packed 检查覆盖。单文件导出的静态首屏水合由 Playwright Chromium 和本地 Edge 浏览器检查覆盖；该路径之外的通用 SSR 水合尚未验证。安装验证还应确认 tarball 中的 `dist-library/types`、`dist-standalone`、`bin`、`cli`、`README.md`、`README-en.md`、`README-ch.md`、`CHANGELOG-ch.md`、`SECURITY-ch.md`、`THIRD_PARTY_NOTICES.md`、`docs` 和 `examples` 完整，并检查 `docs` 中没有指向未打包 `demo/`、`src/`、`tests/` 或 `.tasks/` 文件的本地链接。

## 发布说明

发布说明面向使用者，至少包含：

- 包版本、`LOCAL_SYNTAX_VERSION`、组块协议修订与主题协议修订；这些不是同一个版本号。
- 安装方式：`npm install reactive-md@next`，或使用 `npm install reactive-md@<version>` 固定版本；并提供可下载 tarball 作为离线安装选项。
- 用户可见变化、破坏性变更和迁移步骤；直接链接[变更记录](../CHANGELOG-ch.md)，本轮同时链接[0.4.0 发布说明](release-0.4.0-ch.md)。
- 已验证的平台，以及未验证的浏览器、通用 SSR 水合等范围。
- 已知限制和安全说明链接 [SECURITY-ch.md](../SECURITY-ch.md)。

不要写尚未执行的检查结果，也不要把 CI 配置存在写成 CI 已通过。

## 人工发布清单

1. 确认工作区干净，变更已审查；`npm ci` 从锁文件安装成功。
2. 在 Node 22.12 和受支持的较新 LTS（当前为 24）上运行 `npm run verify:release`。这是维护者和 CI 共用的完整门禁，不要用一组自行挑选的命令代替。
3. 确认版本号、`CHANGELOG-ch.md` 和发布说明一致。语法变化时更新 `LOCAL_SYNTAX_VERSION`；组块或主题协议修订仅在各自契约变化时更新，这些版本轴保持独立。
4. 检查门禁保留的安装包，包括文件列表、大小和许可文件。手动重新运行 `npm pack` 会产生新候选包，需要单独完成安装验证。
5. 核对安装包的 SHA256 与 `artifacts/release-package/package-verification.json` 一致，并记录到发布说明或内部发布记录。
6. 合并发布提交，等待 `main` 上的 CI 全部通过。
7. 手动创建并推送 tag，例如 `v0.4.0`。不要在自动发布工作流中保存 npm token。
8. 在维护者本机完成 npm 登录和双因素认证后，手动发布已经验证的预览版安装包：`npm publish artifacts/release-package/reactive-md-0.4.0.tgz --access public --tag next`。预览版使用 `next` 分发标签；是否更新稳定版的 `latest` 标签另行决定。
9. 在 npm 和 GitHub Releases 上核对包内容、版本、README、许可与发布说明；从公开 registry 重新安装一次。
10. 从 registry 验证 README 中的安装命令可用，核对 registry 的完整性摘要与发布 tarball 一致。

README 中的版本与安装命令应在打包前准备好，并在发布后验证。发布过程中不要提交 token、`.npmrc` 凭据或本机路径。
