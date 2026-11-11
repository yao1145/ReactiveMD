# Default theme 图表验收

在引擎仓库运行：

```powershell
npx vite --config examples/default-charts/vite.config.ts
```

访问 http://127.0.0.1:5202/。页面通过公开包入口加载真正的编译器、runtime 和 `LocalDocumentView`。仓库内开发时 Vite 映射到当前源代码。

依次检查柱状、折线、面积、饼图、散点及原有环形图。柱状图仅读取当前一根柱；折线和面积图共享同轮读数；散点图显示最近点坐标；饼图和环形图显示值与占比。图例支持高亮和隐藏。拖动滑块或切换数据检查短动画，点击数据检查选择写回，恢复默认检查交互状态重置。

页面还提供明暗切换、静态预览、外部 runtime 更新，以及负值、缺失值和长标签样例。源码由 document.ts 生成，可在页面底部展开查看。
