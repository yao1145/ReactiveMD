# 发布清单

本文件是维护者的手动发布流程。Reactive MD 当前为 `0.3.0` 公开预览版。版本规则见[版本与兼容性](compatibility.md)。

## 发布前确认

### 包名与 scope

`package.json` 当前使用非 scope 名称 `reactive-md`。发布前确认：

1. 用 `npm view reactive-md` 或 npm 网站确认名称可用；不要仅凭本仓库的配置判断。
2. 决定继续使用非 scope 名称，还是改成 `@scope/reactive-md`。scope 需要对应的 npm 账号或组织权限。
3. 如果改名，同时更新 `package.json` 的 `name`、文档中的导入语句、tarball 文件名说明和示例。`reactive-md/react`、`reactive-md/styles.css` 子路径也要随包名调整。
4. 核对 `package.json` 的 `repository`、`homepage`、`bugs`、`license`、`engines` 等发布元数据；当前已设置，发布前确认 URL 和最低 Node 版本仍然正确，并确认 `private` 保持移除状态。
5. 确认 `files` 覆盖发布所需内容。当前包含 `dist-library`、中英文 README、`CONTRIBUTING.md`、`CHANGELOG.md`、`SECURITY.md`、`THIRD_PARTY_NOTICES.md`、`docs` 和 `examples`；新增文档或 notice 时同步加入 `files`。

包名和版本决定 tarball 名称。当前 `0.3.0` 的预期文件名是 `reactive-md-0.3.0.tgz`；改名或改版本后以 `npm pack` 的实际输出为准。

### 第三方 notice

运行时会打包 `remark-gfm@4.0.1`、`remark-parse@11.0.0` 和 `unified@11.0.5`，三者均为 MIT。Vite 库构建会把这些依赖及其传递依赖打进 `dist-library` 的库产物（包括拆分的运行时块），因此发布内容应保留它们的版权和许可声明。React 是外部 peer dependency，不随本包打包。

维护者在发布前：

1. 运行 `npm run notices`，从已安装依赖重新生成 `THIRD_PARTY_NOTICES.md`。生成脚本覆盖 `remark-gfm`、`remark-parse`、`unified` 的依赖树和实际许可证文本。
2. 确认 `package.json` 的 `files` 包含 `THIRD_PARTY_NOTICES.md`，并随 tarball 分发。
3. 检查 `npm pack --dry-run` 的输出，确认没有 `node_modules`、`demo/`、`demo/artifacts/`、测试产物或本地缓存。
4. 核对依赖许可证与打包内容一致；新增或升级 Markdown 依赖后重新生成 notice。

## 本地 tarball 安装

发布前用真实 tarball 检查独立安装。在仓库根目录：

```sh
npm ci
npm pack
```

`npm pack` 会通过 `prepack` 先运行构建和 `npm run notices`，生成 `dist-library/` 与 `THIRD_PARTY_NOTICES.md`。`dist-library/` 是 `package.json` 的 `exports` 指向的目录。随后在一个空目录中验证安装：

```sh
mkdir /tmp/reactive-md-consumer
cd /tmp/reactive-md-consumer
npm init -y
npm install /path/to/reactive-md-0.3.0.tgz
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

静态 SSR 渲染由 packed 检查覆盖；水合不在当前检查范围内。安装验证还应确认 tarball 中的 `dist-library/types`、`README.md`、`README.en.md`、`CHANGELOG.md`、`SECURITY.md`、`THIRD_PARTY_NOTICES.md`、`docs` 和 `examples` 完整，并检查 `docs` 中没有指向未打包 `demo/` 文件的本地链接。

## 发布说明

发布说明面向使用者，至少包含：

- 包版本与 `LOCAL_SYNTAX_VERSION`；两者不是同一个版本号。
- 安装方式：`npm install reactive-md@<version>`，并提供可下载 tarball 作为离线安装选项。
- 用户可见变化、破坏性变更和迁移步骤；直接链接 [变更记录](../CHANGELOG.md)。
- 已验证的平台，以及未验证的浏览器、SSR 水合等范围。
- 已知限制和安全说明链接 [SECURITY.md](../SECURITY.md)。

不要写尚未执行的检查结果，也不要把 CI 配置存在写成 CI 已通过。

## 人工发布清单

1. 确认工作区干净，变更已审查；`npm ci` 从锁文件安装成功。
2. 在 Node 22.12 和受支持的较新 LTS（当前为 24）上运行 CI 同等检查：`npm run build`、`npm test`、`npm run test:package`、`npm run test:packed`、`npm run test:docs`、Demo 构建与测试，以及 Chromium 浏览器检查。
3. 确认版本号、`CHANGELOG.md` 和发布说明一致；语法修订变化时同步更新 `LOCAL_SYNTAX_VERSION`。
4. 运行 `npm pack --dry-run` 检查文件列表、大小和许可文件；再实际 `npm pack` 并在空目录安装验证。
5. 检查 tarball 的 SHA256，记录到发布说明或内部发布记录。
6. 合并发布提交，等待 `main` 上的 CI 全部通过。
7. 手动创建并推送 tag，例如 `v0.3.0`。不要在自动发布工作流中保存 npm token。
8. 在维护者本机完成 npm 登录和双因素认证后手动发布 tarball：`npm publish reactive-md-0.3.0.tgz --access public`。使用 scope 包名时改为对应的 `@scope/name`。
9. 在 npm 和 GitHub Releases 上核对包内容、版本、README、许可与发布说明；从公开 registry 重新安装一次。
10. 从 registry 验证 README 中的安装命令可用，核对 registry 的完整性摘要与发布 tarball 一致。

README 中的版本与安装命令应在打包前准备好，并在发布后验证。发布过程中不要提交 token、`.npmrc` 凭据或本机路径。
