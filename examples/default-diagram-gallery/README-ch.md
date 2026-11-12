# Diagram 与 Gallery 联合验收

在 ReactiveMD 引擎仓库运行：

```powershell
npx vite --config examples/default-diagram-gallery/vite.config.ts
```

打开 http://127.0.0.1:5203/。本页使用当前编译器、runtime、default theme 与默认预设内置的 Gallery，无需注册额外组件。

验收：

- 悬浮或聚焦 Diagram 节点：说明浮层跟随节点位置，支持完整 Markdown、文字选择、长内容滚动及 Escape 关闭。点击节点仍写回当前阶段；浮层查看不改变选择。
- 图解高亮相关节点及连线，支持缩放、重置缩放和适应宽度。窄屏可在图解内部横向浏览。
- Gallery 展示本地图片、RMD 卡片与混合内容，可用触控、滚轮、左右按钮、方向键、Home/End 浏览，并可拖动薄轨道。
- 调整样本数量或核对状态：节点说明与 Gallery 卡片同步更新。恢复默认同时复位交互状态。
- 深色模式与静态预览可在页首切换；静态预览完整展示全部节点说明及 Gallery 项目。
- 底部展开“长文本验收”，检查图解标题、两行节点标签、长英文说明，以及 Gallery 标题、卡片标题和正文；滚动停靠后文字与两端渐隐区之间保留安全距离。

示例图片使用本地原创 SVG，宿主只允许这些已知图片资源。`?url&no-inline` 保留资源 URL，适配 RMD 的图片策略。
