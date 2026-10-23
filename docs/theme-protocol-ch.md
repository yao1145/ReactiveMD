# Reactive MD 主题协议

协议修订：`reactive-md-theme-1`。本功能属于尚未发布的工作区版本；现有外观作为内置 `default` 保留。

## 文档选择主题

在正文之前写一行声明：

```markdown
<theme name="default">

# 文档标题
```

也接受 `<theme name="default" />`。省略声明时使用 `default`。声明前允许空白、BOM 和注释；声明只允许出现一次，不能嵌入组件。`name` 是静态字符串，使用小写 kebab-case，首字符为字母，最多 64 个字符。声明不接受表达式或其他属性。

声明是文档元数据，不属于组块，不生成可见组件。编译结果的 `document.theme` 保存选择，`document.themeRange` 保存声明在原文中的位置；正文节点继续使用原始源码位置。代码围栏、行内代码、注释和转义中的示例保持字面含义。

无效声明产生 `local.theme.*` 警告并使用 `default`。重复声明不改变第一次的选择；正文之后或组件内的声明不影响主题。正常正文和控件继续工作。

## 宿主登记主题

主题由开发者提供 CSS 和登记信息。宿主先导入公共样式，再导入主题 CSS，并通过 `themes` 提供允许选择的主题：

```tsx
import { LOCAL_THEME_PROTOCOL, type LocalThemeDefinition } from 'reactive-md';
import { LocalReactiveDocument } from 'reactive-md/react';
import 'reactive-md/styles.css';
import './paper-theme.css';

const paperTheme = {
  name: 'paper',
  protocol: LOCAL_THEME_PROTOCOL,
  colorSchemes: ['light', 'dark'],
} as const satisfies LocalThemeDefinition;

export function Article({ source }: { source: string }) {
  return <LocalReactiveDocument source={source} themes={[paperTheme]} colorScheme="auto" />;
}
```

此示例说明登记方式；仓库仅内置 `default`，不提供 `paper` 的设计或 CSS。

| 字段 | 要求 |
| --- | --- |
| `name` | 符合文档名称规则；`default` 保留；同一宿主列表中唯一 |
| `protocol` | 必须为 `reactive-md-theme-1`，可使用 `LOCAL_THEME_PROTOCOL` |
| `colorSchemes` | 必须同时包含 `light` 和 `dark` |

宿主负责加载 CSS；登记信息不触发下载或注入样式。文档按名称选择宿主允许的主题，不接受 CSS、样式地址或脚本。主题 CSS 属于宿主信任的代码，宿主负责审查其作用域和资源引用。

未知主题、所选名称重复、所选登记信息无效、协议不兼容或缺少深浅模式时，渲染器警告并回退到 `default`。纯核心宿主可调用 `resolveLocalTheme(name, themes, range?, source?)`，得到 `{ name, diagnostics }`。编译器只处理声明，不查询宿主的主题列表。

## 深浅模式与实例作用域

两个 React 组件均接受 `themes` 和 `colorScheme`。主题名称决定风格，`colorScheme` 决定该风格的深浅版本：

| 值 | 行为 |
| --- | --- |
| `light` | 当前文档使用浅色，包括处于深色宿主中时 |
| `dark` | 当前文档使用深色 |
| `auto`（默认） | 读取最近祖先的显式模式，否则跟随系统偏好；服务端输出以浅色开始 |

祖先的显式模式支持 `data-color-scheme="light|dark"` 和已有的 `data-theme="light|dark"`。浏览器中祖先属性或系统偏好变化会更新文档。显式 `colorScheme` 优先。

渲染器在当前文档根节点输出：

```html
<article class="md-document local-document"
         data-rmd-theme="paper"
         data-color-scheme="dark">
```

每个实例独立选择主题与模式。主题 CSS 的每条规则必须限制在该主题根节点及其后代，例如 `[data-rmd-theme="paper"][data-color-scheme="dark"]`。不得使用会影响宿主的全局 `body`、`:root` 或无作用域的元素规则。

改变 `themes` 或 `colorScheme` 不创建新运行时。`LocalReactiveDocument` 更换 `source` 时仍遵从既有规则，重新编译并创建运行时；宿主需要保留参数时可自行管理 `LocalDocumentView` 的文档和运行时。

## 共享样式变量

公共组件 CSS 提供结构、交互与默认样式。自定义主题继承完整的默认变量，按需覆盖；浅色和深色规则必须分别设计与验收。

| 用途 | 公共变量 |
| --- | --- |
| 背景 | `--paper`、`--surface`、`--document-bg`（默认跟随 `--surface`）、`--surface-subtle`、`--surface-hover`、`--surface-active` |
| 文字与边框 | `--ink`、`--ink-soft`、`--ink-muted`、`--line`、`--line-strong` |
| 强调色 | `--accent`、`--accent-hover`、`--accent-soft`、`--accent-line` |
| 状态 | `--info`、`--info-soft`、`--success`、`--success-soft`、`--success-line`、`--warning`、`--warning-soft`、`--warning-line`、`--danger`、`--danger-soft`、`--danger-line`、`--neutral-soft` |
| 焦点 | `--focus`、`--focus-outline`、`--focus-ring` |
| 数据与代码 | `--chart-1` 至 `--chart-8`、`--chart-grid`、`--chart-axis`、`--code-bg`、`--code-bg-deep`、`--code-ink` |
| 字体 | `--font-sans`、`--font-mono`、`--text-xs` 至 `--text-xl`、`--text-2xl`、`--text-block-title`、`--text-block-subtitle` |
| 行高与字重 | `--leading-tight`、`--leading-snug`、`--leading-normal`、`--leading-relaxed`、`--weight-regular`、`--weight-medium`、`--weight-semibold`、`--weight-bold` |
| 间距 | `--space-1` 至 `--space-7`、`--field-gap` |
| 圆角 | `--radius-control`、`--radius-card`、`--radius-panel`、`--radius-pill` |
| 控件 | `--control-height-sm`、`--control-height`、`--control-height-lg`、`--control-padding-x`、`--control-padding-y`、`--disabled-opacity` |
| 动效与阴影 | `--motion-fast`、`--motion-base`、`--motion-slow`、`--ease-standard`、`--shadow-sm`、`--shadow-md` |

已有 `--blue`、`--blue-deep`、`--blue-soft`、`--blue-line` 保留兼容；新主题优先使用强调色变量。组件的局部 `color` 属性覆盖对应局部颜色，其余样式继续使用主题。数据序列、状态提示等保留各自的语义颜色。

## 组件 CSS 与验收

主题可在共享变量之外覆盖现有 `.md-*`、`.local-*` 组件类。文档根类、组件外层类和语义状态属性是主题的样式接口；内部节点的排列不是扩展 API。主题规则遵守文档作用域，并在公共样式之后加载。使用足够明确的根节点与组件选择器覆盖基础规则，避免依赖 `!important`。

主题覆盖范围包括 Markdown 正文、表格、公式、输入控件、容器、反馈、图表与图解。新增组件必须读取共享变量并在 `default` 下可用；自定义主题未添加专门规则时继承公共样式。

符合本协议的主题必须在两种模式下检查全部组件，以及 hover、focus、active、disabled、错误与选中状态。保持键盘焦点可见、文字和控件可读、375px 布局可用，并遵守减少动态效果的系统偏好。改变字号或字体后应检查 SVG 图解的标签、节点和边界。

登记校验确认协议与模式声明；CSS 的实际覆盖、对比度和布局通过浏览器验收。验收应包含同页多主题隔离、显式浅色置于深色宿主、系统切换、状态保留和卸载清理。
