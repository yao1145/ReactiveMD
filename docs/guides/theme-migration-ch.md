# 迁移到共享主题基线

所有主题使用相同的组件实现。`reactive-md/styles.css` 提供完整的 default
基线，主题包按需覆盖。主题名称继续通过 `<theme name="...">` 选择。

## 现有主题

现有语义变量继续有效，例如 `--accent`、`--surface`、`--font-sans` 和
`--control-height`。通过 SDK 登记的 CSS 自动进入 `rmd.themes`；直接导入
的 CSS 应明确放在同一层：

```css
@layer rmd.reset, rmd.defaults, rmd.components, rmd.themes, rmd.overrides;

@layer rmd.themes {
  [data-rmd-theme="paper"] {
    --accent: #6750a4;
  }
}
```

组件内部类名可能变化。将针对旧原生滑块、旧图表和内部 CSS Modules
类名的规则迁移到组件变量或公开部件入口。保留仍用于静态输出或原生
控件的规则时，应检查它们实际匹配的元素。

## 改变滑块形状

主题可独立设置宽、高和圆角：

```css
@layer rmd.reset, rmd.defaults, rmd.components, rmd.themes, rmd.overrides;

@layer rmd.themes {
  [data-rmd-theme="paper"] {
    --rmd-slider-thumb-width: 16px;
    --rmd-slider-thumb-height: 28px;
    --rmd-slider-thumb-radius: 2px;
    --rmd-slider-track-height: 4px;
  }
}
```

完整顺序声明必须先于任何 `rmd.*` 层出现，保证主题 CSS 提前加载时也保持
正确优先级。JS 宿主可从 `reactive-md/sdk` 导入 `LOCAL_STYLE_LAYER_ORDER`；
SDK 生成的主题资源已经包含这一声明。

轨道端点、滑块位置和气泡位置会使用这些尺寸。额外装饰可定位到
`[data-rmd-component="slider"] [data-rmd-part="thumb"]`。使用主题根
节点限制覆盖范围，保证同页其他文档保持独立。

文档中的原生 `input[type="range"]` 使用 `--rmd-native-range-*` 变量，
默认保留 18px 滑块；适配组件默认是 22px。要让两者采用相同形状，可同时
设置 `--rmd-native-range-thumb-width`、`--rmd-native-range-thumb-height`、
`--rmd-native-range-thumb-radius` 和 `--rmd-native-range-track-height`。

## 保存原有 soft 外观

`soft` 主题应加载自身的 CSS 资源。仅登记 `soft` 名称时，渲染器会使用
完整的 default 基线。主题 CSS 决定原有配色与造型，交互继续使用共享组件。

## 宿主与导出

公共样式迁入层叠层后，宿主未分层的普通 CSS 声明会优先于这些样式。
宿主有意覆盖文档时，建议将规则放入 `rmd.overrides`；主题自身使用
`rmd.themes`。共享组件样式以 `.md-document` 为边界，承载这些组件的
容器需要使用文档根类；仅需继承变量时可使用 `.reactive-md-theme`。

宿主加载公共样式、所选主题资源和组件资源。SSR 首屏与离线 HTML 使用
同一套样式。主题登记只提供元数据，直接使用 `themes` 属性的宿主仍负责
加载 CSS；SDK 构建适配器可统一收集主题资源。

迁移后检查深浅模式、焦点、禁用和错误状态，以及同页多个主题。至少验证
一次矩形滑块在两端的位置、键盘与拖动操作、375px 布局和静态导出。
