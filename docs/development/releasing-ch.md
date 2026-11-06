# 引擎发布

reactive-md 独立维护版本；编辑器从自己的仓库发布 reactive-md-editor，Demo 独立构建站点。候选包更新与导入迁移见[三仓库迁移](../integration/repository-split-ch.md)。

1. 核对分支、本次 diff、目标版本与 registry 状态。更新 package.json、package-lock.json、变更记录及兼容说明；包版本与语法、协议版本分别管理。
2. 运行 npm ci、npm run check、npm run notices，检查 tarball 的 exports、声明路径与 notice。公开包检查在独立目录安装实际 tarball，不需要检出编辑器或 Demo。
3. 提交并推送已授权的发布源码。在对应 ref 手动触发 publish.yml，选择 dist_tag 与 update_latest。工作流使用 Node24、npm ^11.21 和 npm trusted publishing（OIDC）；保留 npm 已配置的工作流文件名。工作流完成检查和构建后打包，仅发布不存在的版本；已存在的版本只更新请求的标签。本机不执行 npm publish 或 npm dist-tag。
4. 确认工作流成功，核对 registry 的版本、渠道和 integrity。授权后给对应源码创建 tag/Release；升级下游 registry 依赖前，在干净消费目录验证公开包。

编辑器首次发包前需单独配置其仓库与 publish.yml 的 npm trusted publisher。正式发布前，下游通过 vendor tarball 和锁文件固定候选组合。推送代码不自动发布 npm 或部署站点。
