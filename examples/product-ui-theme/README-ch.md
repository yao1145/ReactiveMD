# PRODUCT UI / PU-01 — Reactive MD 产品界面主题

现已成为内置 `default` 主题、同时作为参考与镜像包保留的温暖产品界面设计系统。包含完整的亮色与暗色 token 契约，以及覆盖浮层、表单、导航、反馈、数据和代码组件的样式。

视觉语言是现代产品界面，而不是文档皮肤：温暖的米白纸张、白色面板、近黑文字、单一亮蓝强调色和克制的层级表达。边框与阴影遵循明确的表面预算：每一层嵌套只有一道边框，正文只有一个带边框的内容容器（`.md-panel`），阴影只用于浮层。几何形状是圆角矩形而非胶囊——输入框与控件 8px、按钮 10px、卡片 12px、面板 14px；胶囊圆角只用于徽标和开关。动效遵循 motion-prompt `ui` pack：短时缓动过渡，对话框从 96% 缩放进入、浮层从 98% 进入，面板 220ms、开关 180ms、计数器 160ms、滑块拇指 1.08/1.15。

**中文** · [English](README.md) · [设计系统规范](docs/design-system.md)

## 包含内容

| 资源 | 路径 | 作用 |
| --- | --- | --- |
| 原始层、语义层与产品组件 tokens | `src/tokens.css` | 亮暗两套完整的表面、状态与组件变量 |
| 浮层样式 | `src/overlays.css` | 对话框、浮层、菜单与 tooltip 的外观和动效 |
| 表单样式 | `src/forms.css` | 输入框、下拉、开关、复选、单选、滑块与计数器 |
| 导航样式 | `src/navigation.css` | 选项卡、步骤、折叠面板与 disclosure |
| 反馈样式 | `src/feedback.css` | 徽标、提示块、进度、校验与空状态 |
| 文档间距层 | `src/spacing.css` | 章节、块级与行内内容的节奏 |
| 直接引入样式表 | `src/product-ui.css` | 依次引入上述六层 |
| 主题包 | `src/theme.ts` | 通过 `defineLocalTheme` 校验、作用域化并冻结资源 |
| 示例文档 | `demo/document.reactive.md` | 覆盖全部组件族的产品文档 |
| 示例宿主 | `demo/main.tsx`、`demo/demo.css` | 在文档根之外复用同一套 tokens |
| 设计规范 | `docs/design-system.md` | token 表、组件契约与动效契约 |

`product-ui` 是内置 `default` 主题的视觉语言。核心 `reactive-md/styles.css` 已包含这一层，因此没有 `<theme>` 声明、或声明 `<theme name="default">` 的文档无需宿主登记即可获得该外观。

本目录将该层作为独立参考包镜像保留。宿主仍可以显式名称 `product-ui` 注册它，文档再通过 `<theme name="product-ui">` 选择。所有 CSS 规则都限定在主题根节点，因此不会影响宿主页面或其他文档实例。

示例中的 `soft` 模式同样不是内置主题，而是与 sci-fi 示例类似的外部示例主题：宿主在 `themes` 属性中登记 `{ name: 'soft', protocol: 'reactive-md-theme-1', colorSchemes: ['light', 'dark'] }`，原始默认外观由 `reactive-md/styles.css` 中的核心基线样式提供。只有宿主登记了该名称，文档才能通过 `<theme name="soft">` 选择它。

## 快速开始

内置默认主题无需注册：

```tsx
import { LocalReactiveDocument } from 'reactive-md/react';
import 'reactive-md/styles.css';

<LocalReactiveDocument
  source={source}
  colorScheme="light"
  locale="en"
/>
```

```markdown
# 产品工作区
```

省略声明即选择 `default`，`<theme name="default">` 等价。

### 外部 soft 示例

若要与原始外观对比，先登记示例名称，再在源码中选择：

```tsx
import { LOCAL_THEME_PROTOCOL } from 'reactive-md';
import { LocalReactiveDocument } from 'reactive-md/react';
import 'reactive-md/styles.css';

const softTheme = {
  name: 'soft',
  protocol: LOCAL_THEME_PROTOCOL,
  colorSchemes: ['light', 'dark'],
} as const;

<LocalReactiveDocument
  source={source}
  themes={[softTheme]}
  colorScheme="light"
  locale="en"
/>
```

```markdown
<theme name="soft">

# 产品工作区
```

`soft` 没有独立样式表。所有文档共用的核心基线 CSS 提供旧外观；登记只负责让该名称可选。示例在 [`demo/soft-theme-definition.ts`](demo/soft-theme-definition.ts) 中本地登记该定义。

### 显式注册 product-ui

镜像包仍可按自己的名称注册：

```tsx
import { LocalReactiveDocument } from 'reactive-md/react';
import 'reactive-md/styles.css';
import { productUiTheme } from 'reactive-md-product-ui-theme';

<LocalReactiveDocument
  source={source}
  themes={[productUiTheme]}
  colorScheme="light"
  locale="en"
/>
```

```markdown
<theme name="product-ui">

# 产品工作区
```

如果宿主自行管理注册，也可以直接引入样式表：

```ts
import 'reactive-md/styles.css';
import 'reactive-md-product-ui-theme/styles.css';
```

显式注册时，`defineLocalTheme` 会拒绝网络资源和宿主全局选择器，并把所有规则限定到 `[data-rmd-theme="product-ui"]`。源 CSS 本身已按该作用域编写，因此直接引入与主题包注册的效果一致。内置 `default` 层使用同一套规则，仅作用域根名称不同。

## Token 摘要

| 层级 | 示例 |
| --- | --- |
| 原始层 | `--pu-paper`、`--pu-blue-500`、`--pu-radius-lg` |
| 语义层 | `--paper`、`--surface`、`--ink`、`--line`、`--accent`、`--accent-text`、`--focus`、`--chart-1` |
| 组件层 | `--pu-focus-halo`、`--pu-segmented-track`、`--pu-chip-bg`、`--pu-rail-fill` |

核心约定：

- 圆角：输入框与控件 `8px`，按钮 `10px`，卡片 `12px`，面板 `14px`；`999px` 仅用于徽标和开关。
- 层级表达：阴影只用于浮层和可选的示例文档窗口；内容表面改用边框、分隔线与背景层级来区分。暗色模式下阴影 token 加深，但使用范围不变。
- 动效：`150 / 220 / 300ms`，缓动为 `cubic-bezier(0.22, 0.61, 0.36, 1)`。
- 强调色：单一亮蓝；填充控件使用 `--accent-ink` 作为文字色。
- 亮暗两种模式都定义完整语义 token；正文与次级文字满足对比度下限。

## 层级与边框

边框与阴影按预算使用，让文档读起来是一整个工作区，而不是一叠卡片。

- 每一层嵌套只有一道边框。示例中的文档窗口是唯一醒目的窗口边框；窗口内的内容不重复这层框架。
- `.md-panel` 是唯一带边框的内容容器。`.md-card` 只是带背景的指标块，没有边框，也没有阴影。
- `.md-group`、清单、多选、计时器与测验不是卡片：没有外层边框、背景或阴影。
- 清单与多选是列表行，带可见复选框与行分隔线，不是 chip 或按钮。
- 折叠面板与 disclosure 是容器内的分隔线列表，不是逐项卡片；展开态使用强调色文字与强调色左边线，而不是填充标题栏。
- 阴影只属于浮层：对话框、popover、菜单与 tooltip（以及可选的示例文档窗口）。内容表面不使用阴影。
- 控件保留必要的边框：输入框、开关、滑块、分段选择与按钮是控件，不是卡片。

表面规则位于 `src/feedback.css`（面板、卡片、group、清单、多选与数据展示）、`src/navigation.css`（disclosure 列表）和 `src/forms.css`（控件）。核心层 `src/local/rendering/local.css` 负责布局、尺寸与基础行为，主题层只负责外观。计时器与测验的基础皮肤来自核心层，因此这里的契约是移除它们的卡片外框，而不是再加一层。

## 组件覆盖

| 类别 | 组件 |
| --- | --- |
| 结构 | 文档窗口（示例宿主）、面板、卡片（指标块）、group、空状态 |
| 浮层 | 原生对话框、原生 popover、菜单、tooltip |
| 表单 | 输入框、多行文本、数字、下拉、滑块、开关、复选、单选、分段选择、计数器 |
| 选择 | 清单与多选，均为列表行样式，带可见复选框与分隔线 |
| 本地组件 | 计时器、测验 |
| 操作 | 主按钮、次按钮、静默按钮 |
| 导航 | 选项卡、步骤、折叠面板与 disclosure（分隔线列表）、锚点 |
| 反馈 | 徽标、提示块、进度、校验提示、错误与空状态 |
| 数据 | Markdown 表格、增强表格、图表、函数曲线、关系图、时间线 |
| 代码 | 围栏代码块、行内代码、展示公式 |

## 运行示例

在仓库根目录执行：

```sh
npm run product:dev          # Vite 开发服务器 http://127.0.0.1:4318
```

示例通过 Vite alias 直接引用仓库源码中的 `reactive-md`，开发主题时无需先构建发布包。顶栏可在内置 `default`（产品界面）与宿主登记的 `soft` 示例（原始外观）之间切换主题，也可切换亮暗模式。等价的直接命令为：

```sh
npx vite --config examples/product-ui-theme/vite.config.ts
```

## 设计说明

- 这套产品界面语言就是内置 `default`；示例中的 `soft` 是外部登记的示例主题，通过核心基线样式保留最初的默认外观。
- 亮色是温暖的纸张工作区；暗色是柔和的近黑产品表面，而不是简单反色的纸页。
- 面板是唯一带边框的内容容器；卡片是只有背景的指标块。嵌套的 group、选择列表与 disclosure 使用分隔线，而不是再加一层卡片边框。真实容器保持 12–14px 圆角，输入框与按钮保持 8–10px，让密集产品表单依然平静。
- 选中态使用强调色、accent-soft 填充和可见的焦点光晕。状态色只表达语义，不替代强调色作为通用高亮。
- 对话框与浮层的入场只使用短时变换；减少动效的用户直接看到终态，不播放缩放。
- 打印时移除宿主界面和阴影，让文档内容保留在白色表面上。

## 许可

MIT，与主仓库一致。
