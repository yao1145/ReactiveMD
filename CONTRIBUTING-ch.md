# 参与开发

本仓库维护语言引擎、运行时、SDK 与渲染适配器；[编辑器](https://github.com/yao1145/ReactiveMD-Editor)和 [Demo](https://github.com/yao1145/ReactiveMD-Demo) 分别维护。先阅读[迁移说明](docs/integration/repository-split-ch.md)与[语法规范](docs/reference/local-interaction-syntax-ch.md)。

使用 Node >=22.12，CI 使用 Node24。在本仓库运行 npm ci、npm run check，完成类型、构建、保留的回归和实际 tarball 消费验证。局部修改先运行直接相关检查；编译入口依赖变化时补充 npm run test:compiler-entry。

引擎公共 API 独立于编辑器 UI，纯目录、插入命令和分析服务放在 reactive-md/authoring。行为变化补针对性回归，保留安全与资源预算，更新公开文档。包版本、语法版本、状态协议与主题版本分别管理。

不提交 dist、依赖或凭据，保留无关改动。PR 描述实际行为和已运行检查。引擎发包仅在授权后使用手动 OIDC 工作流，见[发布流程](docs/development/releasing-ch.md)；站点部署由 Demo 仓库负责。
