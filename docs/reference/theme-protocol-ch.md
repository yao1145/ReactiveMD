# Reactive MD 主题协议

**中文** · [English](theme-protocol-en.md)

协议修订：`reactive-md-theme-1`。本功能从 `0.4.0` 起提供；现有外观作为内置 `default` 保留。

源码中的[扩展 SDK 预览](../integration/extension-sdk-ch.md)提供 `defineLocalTheme`、`composeLocalTheme` 和主题包资源约定，构建适配器可将主题 CSS、字体与图片纳入离线导出。语义变量和下述作用域规则继续适用。SDK 预览使用当前源码构建的 tarball。

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
| 背景 | `--paper`、`--surface`、`--document-bg`（默认跟随 `--surface`）、`--surface-subtle`、`--surface-hover`、`--surface-active`、`--image-zoom-backdrop` |
| 文字与边框 | `--ink`、`--ink-soft`、`--ink-muted`、`--line`、`--line-strong` |
| 强调色 | `--accent`、`--accent-hover`、`--accent-soft`、`--accent-line`、`--accent-ink`（填充强调色上的文字）、`--accent-text`（作为文字使用的强调色） |
| 状态 | `--info`、`--info-soft`、`--success`、`--success-soft`、`--success-line`、`--warning`、`--warning-soft`、`--warning-line`、`--danger`、`--danger-soft`、`--danger-line`、`--neutral-soft` |
| 焦点 | `--focus`、`--focus-outline`、`--focus-ring` |
| 数据与代码 | `--chart-1` 至 `--chart-8`、`--chart-grid`、`--chart-axis`、`--code-bg`、`--code-bg-deep`、`--code-ink` |
| 字体 | `--font-sans`、`--font-mono`、`--text-xs` 至 `--text-xl`、`--text-2xl`、`--text-block-title`、`--text-block-subtitle` |
| 行高与字重 | `--leading-tight`、`--leading-snug`、`--leading-normal`、`--leading-relaxed`、`--weight-regular`、`--weight-medium`、`--weight-semibold`、`--weight-bold` |
| 间距 | `--space-1` 至 `--space-7`、`--field-gap` |
| 圆角 | `--radius-control`、`--radius-card`、`--radius-panel`、`--radius-pill`、`--radius-field`、`--radius-field-multiline` |
| 控件 | `--control-height-sm`、`--control-height`、`--control-height-lg`、`--control-padding-x`、`--control-padding-y`、`--control-inset-x`、`--control-selected`、`--control-selected-ink`、`--control-track`、`--control-thumb`、`--disabled-opacity` |
| 表格 | `--table-cell-padding-y`、`--table-cell-padding-x` |
| 动效与阴影 | `--motion-fast`、`--motion-base`、`--motion-slow`、`--ease-standard`、`--shadow-sm`、`--shadow-md` |

已有 `--blue`、`--blue-deep`、`--blue-soft`、`--blue-line` 保留兼容；新主题优先使用强调色变量。组件的局部 `color` 属性覆盖对应局部颜色，其余样式继续使用主题。数据序列、状态提示等保留各自的语义颜色。

## 主题化原生按钮

`reactive-md/styles.css` 包含 `controls.css` 公共按钮样式。组件作者在 `.md-document` 内输出原生 `<button>` 或 `type` 为 `button`、`submit`、`reset` 的 `<input>`，即可获得当前文档的 secondary 外观：

```tsx
<button type="button">暂停</button>
<button type="button" className="md-button-primary">开始</button>
<button type="button" className="game-direction">←</button>
<button type="button" data-rmd-appearance="custom">特殊按钮</button>
```

| 用法 | 外观责任 |
| --- | --- |
| 普通原生按钮、兼容类 `md-button` | 默认 secondary，包含 hover、active、focus-visible 和 disabled |
| `md-button-primary`、`md-button-secondary`、`md-button-quiet` | 显式选择语义变体，可单独使用 |
| 组件自己的 CSS 类 | 按属性覆盖；只改宽度时，颜色、禁用态与焦点仍跟随公共样式 |
| `data-rmd-appearance="custom"` | 当前元素退出公共按钮皮肤，组件负责完整外观与交互状态，仍可读取主题变量 |

`data-rmd-appearance` 是组件输出的 DOM 属性，无须修改 RMD 语法，也不影响后代按钮。公共规则以 `:where()` 保持零选择器权重，不使用 `!important`；组件的普通类选择器可覆盖声明过的属性，包括交互状态中的同一属性。公共按钮不设置外边距，间距由容器 `gap` 或组件布局决定，并保留 `[hidden]` 的隐藏行为。禁用态也适用于禁用 `fieldset` 内的按钮。

主题通过 `--surface`、`--surface-hover`、`--surface-active`、`--ink`、`--line-strong`、`--accent`、`--accent-hover`、`--accent-ink`、`--control-height`、`--control-inset-x`、`--control-padding-y`、`--radius-field`、`--focus-outline` 和现有字体、动效变量调整按钮。棋盘、方块颜色和游戏动画由组件包维护；内置与外部按钮使用同一公共实现。

宿主按公共样式、主题资源、组件资源的顺序加载。SSR 页面应在首屏加载同一 `reactive-md/styles.css`；离线 HTML 应包含公共样式、所选主题和组件 CSS。各文档根节点的变量决定实例外观，切换主题保留组件运行状态。纯编译器入口保持无 CSS 依赖。

自动匹配只作用于文档内的原生按钮。`[role="button"]` 由组件自行设计；文档外的导航、工具栏及宿主按钮保持各自样式。Portal、Shadow DOM 和 iframe 内容需要宿主单独接入主题。下文列出的原生控件和组件类同样使用自动皮肤。

## 主题化原生控件

公共样式对 `.md-document` 内的下列原生控件提供皮肤。匹配依据是真实元素和 input 类型，不从 role、容器类或 `div` 推断控件。键盘操作、校验时机、日期选择器、数字步进和平台交互保持原生；标签、ARIA、状态和行为由组件负责。在匹配元素上设置 `data-rmd-appearance="custom"` 可让该元素退出公共皮肤，主题变量仍可使用。

**输入字段。** 省略 `type` 或类型为 `text`、`search`、`email`、`url`、`tel`、`password`、`number`、`date`、`time`、`datetime-local`、`month`、`week` 的输入、`textarea`，以及单选和多选 `select`，使用主题背景、边框、圆角和控件高度。焦点使用 `--focus` 与 `--focus-ring`。`aria-invalid="true"` 和平台 `:user-invalid` 显示危险色边框；公共样式不处理裸 `:invalid`，校验时机仍由作者控制。只读字段保留主题和焦点；禁用字段使用 `--disabled-opacity`，禁用 `fieldset` 内的控件同样生效。原生日期时间选择器、数字步进和下拉箭头保持可用。字段占满容器宽度、上限 420px，并可在 375px 下收缩。

`.md-field` 与兼容的 `.md-control` 以纵向间距组合标签、控件、提示与错误。`.md-label`、`.md-hint`、`.md-error`、`.md-required` 分别设置这些部分；原生 `label` 和 `legend` 获得基础排版。`required` 或 `aria-required` 由作者写在控件上。`.md-text-input`、`.md-select-input` 作为兼容类继续使用同一皮肤。

**选择与进度。** 原生 `input[type="checkbox"]`、`input[type="radio"]` 保留平台形状，选中标记使用 `--control-selected`，缺失时回退到 `--accent`。原生 checkbox 可通过 `.md-switch`，或在该 checkbox 上设置 `role="switch"` 来选择开关外观；公共样式不会把容器或普通 `div` 变成开关。`input[type="range"]` 在 WebKit 和 Firefox 中设置轨道与滑块，同时保留原生输入语义。`progress` 支持确定与不确定进度；`meter` 保留 low、high、optimum 语义并用状态色显示。`.md-progress`、`.md-meter` 是同一原生元素上的可选类。各类控件分别设置尺寸。

**折叠内容。** 原生 `details`、`summary` 获得基础外观；标记、键盘行为和关闭状态保持原生，公共样式不对关闭元素设置 `display`。`.md-disclosure`、`.md-disclosure-title`、`.md-disclosure-panel` 是作者自有折叠结构上的可选外观类。

**对话框与浮层。** 原生 `dialog` 仅在打开时设置外观，原生 `[popover]` 仅在 `:popover-open` 时设置。公共样式不设置 display、定位或指针行为。`dialog::backdrop` 使用 `--image-zoom-backdrop`，缺失时使用中性回退色。`.md-dialog`、`.md-popover`、`.md-tooltip`、`.md-menu`、`.md-menu-item`、`.md-menu-separator` 为作者自有结构提供外观；打开状态、位置、焦点、键盘处理和挂载位置由作者负责。这些类不会显示已关闭的 dialog 或 popover，尺寸约束保证 375px 下可用。

## 主题化组件类

其余公共 UI 由共享类覆盖。共享类提供外观；语义、行为、焦点和位置由作者负责。

| 区域 | 公共类 |
| --- | --- |
| 容器 | `md-card`、`md-card-title`、`md-card-body`、`md-panel`、`md-panel-title`、`md-panel-body`、`md-group` |
| 状态 | `md-badge`、`md-status`，以及 `md-badge-neutral`、`md-badge-success`、`md-badge-warning`、`md-badge-danger`、`md-badge-info` 和对应的 `md-status-*` 变体 |
| 反馈 | `md-alert` 及 `md-alert-success`、`md-alert-warning`、`md-alert-danger`、`md-alert-info`、`md-alert-title`、`md-alert-body`；`md-empty-state`、`md-empty-state-title`、`md-empty-state-description`；`md-spinner`、`md-loading`、`md-skeleton` |
| 导航 | `md-tabs`、`md-tablist`、`md-tab`、`md-tabpanel`、`md-pagination`、`md-page`、`md-steps`、`md-step` |
| 正文 | 标题、段落、链接、列表、引用、分隔线、`kbd`、行内代码和代码块的文档排版；原生表格和 `md-table` |
| 图表 | `md-chart`、`md-chart-axis`、`md-chart-grid`、`md-chart-legend`、`md-chart-node`、`md-chart-edge`、`md-chart-series-line`、`md-chart-series-area` |

标签页和步骤根据 `aria-selected`、`aria-current`、`aria-expanded` 及禁用状态显示外观；`aria-current="step"` 和 `data-state="complete"` 标记步骤进度。表格使用 `md-table-striped` 显示斑马行，使用 `aria-selected="true"` 或 `data-state="selected"` 标记选中行。单元格内边距读取 `--table-cell-padding-y` 和 `--table-cell-padding-x`。

图表序列元素设置 `--series-color`，缺失时回退到 `--chart-1`。`data-series="1"` 至 `"8"` 映射现有 `--chart-1` 至 `--chart-8` 调色板。SVG 几何、可访问名称和交互由作者提供。

文档排版使用共享的字体、间距和行高变量。行内代码和代码块使用 `--code-bg`、`--code-bg-deep`、`--code-ink`；`kbd` 使用控件背景和边框。原生表格与 `md-table` 共用单元格内边距和边框。专用组件保持各自外观。

所有新增皮肤都限制在 `.md-document` 内，基础和状态选择器主体统一用 `:where()` 保持零权重；伪元素追加在该主体之后，不新增 `!important`。组件的普通类选择器无论样式表加载顺序如何，都能覆盖其声明的属性。`[data-rmd-appearance="custom"]` 只让标记的元素退出皮肤，后代仍保留皮肤。隐藏元素保持隐藏。打印保留原生控件值和现有内置打印摘要。

## 密度

在文档根节点或子树上设置 `data-rmd-density="compact"` 或 `"comfortable"`，可通过共享变量调整控件高度和表格单元格内边距。组件和主题仍可覆盖单个尺寸。

## 组件 CSS 与验收

主题可在共享变量之外覆盖现有 `.md-*`、`.local-*` 组件类。文档根类、组件外层类和语义状态属性是主题的样式接口；内部节点的排列不是扩展 API。主题规则遵守文档作用域，并在公共样式之后加载。使用足够明确的根节点与组件选择器覆盖基础规则，避免依赖 `!important`。

主题覆盖范围包括 Markdown 正文、表格、公式、输入控件、容器、反馈、图表与图解。新增组件必须读取共享变量并在 `default` 下可用；自定义主题未添加专门规则时继承公共样式。

符合本协议的主题必须在两种模式下检查全部组件，以及 hover、focus、active、disabled、错误与选中状态。保持键盘焦点可见、文字和控件可读、375px 布局可用，并遵守减少动态效果的系统偏好。改变字号或字体后应检查 SVG 图解的标签、节点和边界。

登记校验确认协议与模式声明；CSS 的实际覆盖、对比度和布局通过浏览器验收。验收应包含同页多主题隔离、显式浅色置于深色宿主、系统切换、状态保留和卸载清理。
