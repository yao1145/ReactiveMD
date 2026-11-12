# 横向画廊

**中文** · [English](gallery-en.md)

`<gallery>` 与 `<gallery-item>` 属于默认预设，也包含在 `layoutPack` 中。使用默认 React 适配器与 `reactive-md/styles.css` 即可渲染，无需注册额外插件。

```markdown
<gallery label="研究切片" item-width="280">
<gallery-item label="01 · 记录">
普通 Markdown 内容。
</gallery-item>
<gallery-item label="02 · 结果">
<card title="分析结果">
卡片也可以作为画廊内容。
</card>
</gallery-item>
</gallery>
```

- `gallery.label` 必填，作为画廊标题和可访问名称。
- `item-width` 默认 280，取 180–480 的整数，支持表达式；窄容器中自动缩小。
- 直接子项只能为 `gallery-item`，至少一项；每项可包含 Markdown、图片和组件。
- `gallery-item.label` 可选，以 h3 显示，长标题省略并保留完整名称。
- 原生 `x mandatory` 停靠配合 32px 边缘留白，滚动结束后停靠到项目。普通滚轮转为平滑横向滚动，到首尾后交还页面。
- 左右按钮平滑翻页，方向键翻页，Home/End 到首尾；支持触控板、触控横滑与薄滚动条拖动。
- 静态渲染与打印把所有项目排成网格，完整显示标题和正文。

图片仍使用宿主的 URL 策略与原有图片查看器。交互参考 [UIArc Scroll Area](https://uiarc.dev/components/scroll-area)，无新增运行时依赖。
