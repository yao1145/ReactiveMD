# 0.4.1 发布说明

`reactive-md@0.4.1` 是兼容 0.4.0 的补丁版。语法仍为 `local-draft-2`，组块协议为 `component-protocol-1`，主题协议为 `reactive-md-theme-1`；现有 0.4.0 文档无需迁移。

```sh
npm install reactive-md@0.4.1
```

本版本发布于 `latest` 和 `next`。离线安装可下载 [npm 安装包](https://registry.npmjs.org/reactive-md/-/reactive-md-0.4.1.tgz)。

## 变化

文档采用更柔和的底色、较少的边框、低饱和图表配色和更平滑的控件动效。输入框和按钮使用气泡圆角；滑块轨道采用统一样式，并支持 `color` 设置背景色。表格占满容器并均衡分配列宽，用三角形表示排序方向；环形图更充分地利用可用空间。

LaTeX 使用正文字号和黑白文字颜色，分段函数的表达式与条件保持分离。坐标控件增加网格、箭头轴、虚线投影和可拖动的坐标标注点。quiz 输入框占满可用宽度，题目和操作区整体垂直居中。Playground 在工具栏插入后保留编辑器滚动位置，日期输入框适应窄屏。

本次更新调整外观和交互，编译器、运行时与状态文件契约保持不变。使用自定义样式的宿主应检查新的默认外观。完整变化见[变更记录](../CHANGELOG-ch.md)；从较早 minor 版本升级时，参阅[0.4.0 迁移指南](release-0.4.0-ch.md)。

## 验证与限制

发布检查覆盖核心与 Demo 测试、类型、包入口、文档链接、离线安装包消费、静态 SSR、独立 HTML 和浏览器交互。CI 目标为 Node 22.12、24 与 Chromium；本地浏览器检查使用 Windows 上的 Microsoft Edge。导出 HTML 以外的通用 SSR 水合、Firefox 和 WebKit 尚未验证。

项目仍处于 0.x 预览阶段。安全边界和宿主职责见 [SECURITY-ch.md](../SECURITY-ch.md)。
