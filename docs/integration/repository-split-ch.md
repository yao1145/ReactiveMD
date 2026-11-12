# 三仓库迁移

**中文** · [English](repository-split-en.md)

三个仓库独立安装、构建、维护版本和发布：

| 仓库 | 准备发布的版本 | 交付 |
| --- | --- | --- |
| [ReactiveMD](https://github.com/yao1145/ReactiveMD) | reactive-md@0.8.0 | 编译器、运行时、语言服务、SDK、React/SSR、导出 |
| [ReactiveMD-Editor](https://github.com/yao1145/ReactiveMD-Editor) | reactive-md-editor@0.1.0（未发布） | CodeMirror、工具栏、导航、诊断呈现、编辑器 Worker |
| [ReactiveMD-Demo](https://github.com/yao1145/ReactiveMD-Demo) | 私有网站包 0.1.0 | 示例网站、组件装配、静态资源和部署 |

## 导入路径

引擎 0.8 移除了旧 editor 子路径。这是包 API 的破坏性迁移；文档语法和状态协议版本保持原值。已发布的 0.7 包仍保留原入口。

| 原路径 | 新路径 |
| --- | --- |
| reactive-md/editor | reactive-md-editor |
| reactive-md/editor/codemirror | reactive-md-editor/codemirror |
| reactive-md/editor/styles.css | reactive-md-editor/styles.css |
| reactive-md/editor/codemirror/styles.css | reactive-md-editor/codemirror/styles.css |

编辑器只通过 reactive-md 和 reactive-md/authoring 使用引擎。通用 Worker、编译会话和语言服务仍由引擎维护；纯作者命令和组件目录可直接从 reactive-md/authoring 使用。

## 独立消费与更新

三个仓库已独立维护。发布准备使用真实引擎 tarball 构建编辑器，再让 Demo 安装两个实际 tarball。编辑器按公共 API 的兼容性声明引擎 peer 范围；开发安装与 Demo 用内容哈希 vendor 文件名及 lockfile integrity 固定候选组合。发布顺序为先引擎 0.8.0，再编辑器 0.1.0。

更新候选组合时，在引擎运行 npm run check、npm run notices，然后 npm pack --ignore-scripts。将生成包复制到编辑器和 Demo 的 vendor 目录，在各自目录 npm install 更新锁文件。运行编辑器 npm run check，打包编辑器并复制到 Demo/vendor；最后在 Demo npm install、npm test、npm run build，并运行本次涉及的浏览器检查。候选包内容变化时要更新实际 tarball 和锁文件，不能只修改版本字符串。

正式发布后，把 vendor 依赖改为对应 registry 版本范围并更新锁文件，在干净目录重新安装验证。编辑器根据引擎公共 API 兼容性声明 peer 范围，三个仓库无需同步版本号。

## 验证与发布职责

引擎 CI 使用一个 Node24 作业：类型、构建、核心回归、真实打包消费。编辑器负责自身类型、构建、命令/坐标/分析控制回归和公开引擎消费；Demo 负责网站构建、文档/导出回归及桌面和手机交互。删除旧阶段快照验收与重复矩阵，历史可通过拆分前提交追溯。

引擎与编辑器各自使用手动 publish.yml 和 npm OIDC。编辑器首次发布前需在 npm 配置对应仓库与工作流的 trusted publisher。Demo 独立构建站点产物，生产发布遵循其 AGENTS.md 的 SHA256 校验、相对软链接原子切换和回滚流程。提交或推送不自动发布 npm 或部署站点。

Candidate tarball filenames include a SHA256 prefix. Use the exact vendor filenames in package.json; update those paths and lockfile integrity whenever package contents change.
