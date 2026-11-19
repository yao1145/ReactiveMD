# 参与开发

**中文** · [English](CONTRIBUTING.md)

本仓库维护语言引擎、运行时、SDK 与渲染适配器；[编辑器](https://github.com/yao1145/ReactiveMD-Editor)和 [Demo](https://github.com/yao1145/ReactiveMD-Demo) 分别维护。先阅读[迁移说明](docs/releases/release-0.8.0-ch.md#仓库拆分与导入迁移)与[语法规范](docs/reference/local-interaction-syntax-ch.md)。

使用 Node >=22.12，CI 使用 Node24。在本仓库运行 npm ci、npm run check，完成类型、构建、保留的回归和实际 tarball 消费验证。局部修改先运行直接相关检查；编译入口依赖变化时补充 npm run test:compiler-entry。

引擎公共 API 独立于编辑器 UI，纯目录、插入命令和分析服务放在 reactive-md/authoring。行为变化补针对性回归，保留安全与资源预算，更新公开文档。包版本、语法版本、状态协议与主题版本分别管理。

不提交 dist、依赖或凭据，保留无关改动。PR 描述实际行为和已运行检查。引擎发包仅在授权后使用手动 OIDC 工作流，见[发布流程](#发布流程)；站点部署由 Demo 仓库负责。

## 发布流程

reactive-md 独立维护版本；编辑器从自己的仓库发布 reactive-md-editor，Demo 独立构建站点。

1. 核对分支、本次 diff、目标版本与 registry 状态。更新 package.json、package-lock.json、变更记录及兼容说明；包版本与语法、协议版本分别管理。
2. 运行 npm ci、npm run check、npm run notices，检查 tarball 的 exports、声明路径与 notice。公开包检查在独立目录安装实际 tarball，不需要检出编辑器或 Demo。
3. 提交并推送已授权的发布源码。在对应 ref 手动触发 publish.yml，选择 dist_tag 与 update_latest。工作流使用 Node24、npm ^11.21 和 npm trusted publishing（OIDC）；保留 npm 已配置的工作流文件名。工作流完成检查和构建后打包，仅发布不存在的版本；已存在的版本只更新请求的标签。本机不执行 npm publish 或 npm dist-tag。
4. 确认工作流成功，核对 registry 的版本、渠道和 integrity。授权后给对应源码创建 tag/Release；升级下游 registry 依赖前，在干净消费目录验证公开包。

编辑器首次发包前需单独配置其仓库与 publish.yml 的 npm trusted publisher。正式发布前，下游通过 vendor tarball 和锁文件固定候选组合。推送代码不授权发包或站点部署。
