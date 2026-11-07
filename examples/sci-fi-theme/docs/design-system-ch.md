# SCI-FI / SF-01 — 设计系统

**中文** · [English](design-system.md)

**状态**：参考主题包 · 1.0.0 · 亮色与暗色
**宿主**：Reactive MD 主题协议 `reactive-md-theme-1`
**范围**：文档组件、宿主界面、tokens 与组件契约

SF-01 是一套用于技术文档与控制界面的硬科幻界面语言。冷峻、直角、工程化：强栅格、外露边线、等宽机器标签和少量冷色信号。它不是把消费级主题调暗，而是从 token 层移除圆润几何、柔和阴影和装饰性渐变。

完整英文规范见 [design-system.md](design-system.md)。

---

## 1. 设计原则

| 原则 | 具体表现 |
| --- | --- |
| 信号先于装饰 | 状态由描边、2px 信号线和标签表达，不依赖投影或大面积色块 |
| 直角 | 所有组件圆角 0–4px，token 层移除胶囊几何 |
| 模块化 | 面板、卡片、图表各自成块，1px 边框与共享边线 |
| 工程密度 | 4px 间距基数、34px 控件高度、10.5–12px 机器标签 |
| 冷而非霓虹 | 仅一个青色强调族；紫、琥珀、红只承担状态语义 |
| 机器口吻 | 标签、元数据、数值、导航使用等宽大写；正文保持无衬线 |
| 扁平 | 高度只由 1px 环表达，不使用模糊投影 |

---

## 2. Token 架构

三层单向依赖：

```
原始层 primitive → 语义层 semantic → 组件层 component
```

| 层级 | 前缀 | 示例 | 文件 |
| --- | --- | --- | --- |
| 原始层 | `--sf-*` | `--sf-cyan-700`、`--sf-radius-1` | `src/tokens.css` |
| 语义层 | 共享契约 | `--surface`、`--ink`、`--accent`、`--line` | `src/tokens.css` |
| 组件层 | `--sf-*` | `--sf-panel-head-bg`、`--sf-field-border` | `src/tokens.css` |

组件规则只消费语义层和组件层，不直接使用原始色值。共享语义名与 Reactive MD 主题协议一致，已有宿主无需额外适配。

### 2.1 语义色

| 角色 | Token | 亮色 | 暗色 |
| --- | --- | --- | --- |
| 页面 | `--paper` | `#e8edf1` | `#070b10` |
| 文档表面 | `--surface` | `#f7f9fb` | `#0b1118` |
| 次级表面 | `--surface-subtle` | `#eef2f5` | `#0e1620` |
| 主文字 | `--ink` | `#0a121a` | `#e5edf4` |
| 次文字 | `--ink-soft` | `#354555` | `#a8b9c8` |
| 弱文字 | `--ink-muted` | `#5f7183` | `#74889a` |
| 边线 | `--line` | `#ccd6df` | `#1f2c3a` |
| 强边线 | `--line-strong` | `#a7b5c2` | `#32475c` |
| 强调填充 | `--accent` | `#096b87` | `#17c3e6` |
| 强调文字 | `--accent-text` | `#055f79` | `#5fdcf5` |
| 强调上的文字 | `--accent-ink` | `#ffffff` | `#03161c` |
| 成功 | `--success` | `#076b4f` | `#3ddc97` |
| 警告 | `--warning` | `#8a5a00` | `#f4b942` |
| 危险 | `--danger` | `#b0253b` | `#ff6b81` |
| 代码表面 | `--code-bg` | `#0a1017` | `#05090e` |

亮色是冷纸张控制台，暗色是主要仪表模式。代码块在两种模式下都保持深色，作为终端模块。

对比度下限由测试断言：正文 ≥ 7:1，次级/弱文字 ≥ 4.5:1，强调文字 ≥ 4.5:1，状态文字 ≥ 4.5:1，图表序列 ≥ 3:1。

### 2.2 组件 token

| 组件 | Tokens |
| --- | --- |
| 面板 | `--sf-panel-bg`、`--sf-panel-head-bg`、`--sf-panel-border`、`--sf-panel-rule`、`--sf-corner-ink` |
| 表格 | `--sf-table-bg`、`--sf-table-head-bg`、`--sf-table-row-hover`、`--sf-table-row-selected` |
| 表单 | `--sf-field-bg`、`--sf-field-border`、`--sf-field-hover`、`--sf-label-ink` |
| 导航 | `--sf-nav-bg`、`--sf-nav-active-bg`、`--sf-signal-ink` |
| 图表容器 | `--sf-chart-frame`、`--sf-chart-head`、`--chart-grid`、`--chart-axis` |
| 焦点/禁用 | `--sf-glow`、`--focus-outline`、`--sf-hatch`、`--disabled-opacity` |

---

## 3. 排版

| 角色 | Token | 字号 | 字重 | 大小写 | 字体 |
| --- | --- | --- | --- | --- | --- |
| 文档标题 | `--text-2xl` | 28px（移动端 24px） | 650 | 大写 | 无衬线 |
| 章节标题 | `--text-xl` | 21px | 700 | 大写 | 无衬线 |
| 小节标题 | `--sf-type-label` | 11.5px | 600 | 大写 | 等宽 |
| 正文 | `--text-md` | 15px | 400 | 正常 | 无衬线 |
| 小号正文 | `--text-sm` | 13px | 400 | 正常 | 无衬线 |
| 微观元数据 | `--sf-type-micro` | 10.5px | 600 | 大写 | 等宽 |
| 字段值/代码 | `--text-sm` | 13px | 400 | 保持原样 | 等宽 |

规则：

1. 大写与字距只用于标签、导航和元数据，正文永不大写。
2. 数值使用等宽数字（tabular numerals）。
3. 标签字距 `0.16em`，数值不加字距。
4. 只使用一套无衬线和一套等宽字体，不引入第三种字体。
5. 中文正文与英文共用无衬线栈；`text-transform` 对汉字无效，不能依赖大小写表达语义。

行高：展示 1.15，标签 1.4，正文 1.7。

---

## 4. 栅格、间距、边框与高度

| 属性 | 约定 |
| --- | --- |
| 基数 | 4px |
| 间距 | `4 / 8 / 12 / 16 / 24 / 32 / 48` |
| 文档宽度 | 880px 居中 |
| 文档内边距 | 桌面 32px，移动端 12–16px |
| 背景栅格 | 桌面 48px、移动端 32px，3–5% 墨色 |
| 组件栅格 | 1px 缝隙直接作为共享边线 |
| 列模型 | 12 列，16px gutter |
| 边框 | 1px 结构线；2px 信号线（左缘、激活页签、焦点） |
| 圆角 | 默认 0；微型标记 2px；上限 4px |
| 高度 | `--shadow-*` 仅为 1px 环，不使用模糊投影 |
| 焦点 | 2px 外框、2px 偏移；表单额外使用 `--sf-glow` |

面板、卡片、表格和图表容器共享边线。不要在有边框的模块里再嵌套一圈无区分度的边框；层级通过表面色阶表达，而不是阴影。

---

## 5. 组件契约

| 组件 | 关键约定 |
| --- | --- |
| 文档表面 | 880px、1px 外框、2px 顶部强调线、淡栅格背景；h1 大写带 72px 强调下划线，h2 带 2px 左信号线 |
| 面板 | 1px 边框、无圆角；左上与右下 8px 角标；头部为等宽大写标签；主体 12/16/16px 内边距 |
| 卡片与网格 | 卡片 = 头部条 + 主体；网格 1px 缝隙形成矩阵，卡片等高 |
| 表格 | 1px 全格线；表头等宽大写；偶数行浅底；悬停提亮；选中行 accent-soft + 2px 内嵌左线 |
| 表单标签 | 10.5px 等宽大写，`--sf-label-ink`；提示文字等宽、弱化 |
| 输入/下拉/多行 | 34px 高、1px 描边、无圆角、13px 等宽；悬停改描边，焦点 accent + 2px 外框，错误 danger 内嵌线，禁用 45° 斜线 |
| 滑块 | 4px 轨道 + 1px 强边线；14px 方形滑块；数值为带框等宽读数 |
| 选择控件 | 16px 方形；选中填充 accent，勾/点使用 accent-ink；选项卡片选中时 accent-soft + 2px 内嵌左线 |
| 按钮 | 28/34/40px 高、无圆角、11.5px 等宽大写；主按钮填充 accent，次按钮 surface + 1px 描边，静默按钮透明 |
| 选项卡 | 等宽分段、1px 框、1px 接缝；选中项 accent-soft + 2px 顶部信号线 |
| 步骤/折叠 | 1px 行、等宽大写触发器；展开项 accent-soft + 2px 内嵌左线 |
| 徽标/提示/进度 | 徽标方形描边；提示块 1px 框 + 2px 左信号线；进度条 10px 框 + 8px 斜纹填充 |
| 图表容器 | 1px 强边线、表面填充、右下 8px 角标；标题转为 10.5px 等宽大写条；坐标文字等宽，网格 55% 透明 |
| 代码/公式 | 代码块在两种模式下均为深色终端模块；工具栏 34px；展示公式夹在 1px 线之间 |

---

## 6. 状态编码

| 状态 | 描边 | 填充 | 信号 |
| --- | --- | --- | --- |
| 默认 | 1px line / line-strong | surface | 无 |
| 悬停 | accent 描边 | 提亮一阶 | 无 |
| 焦点 | 2px accent 外框（2px 偏移） | 不变 | 可选 3px 光晕 |
| 选中/当前 | accent 描边 | accent-soft | 2px 内嵌左/顶线 |
| 按下 | accent 描边 | surface-active | 1px 内嵌 accent |
| 禁用 | line | 45° 斜线 | 38% 透明 |
| 错误 | danger 描边 + 内嵌线 | 不变 | danger 文字 |
| 成功 | success 描边 | success-soft | success 标签 |

任何状态都不依赖投影，也不只依赖颜色。

---

## 7. 可访问性

- AA 对比度下限属于测试的一部分，而不是设计意图。
- 键盘焦点始终可见，不移除焦点环。
- 页签、步骤和折叠面板使用渲染器提供的 `aria-selected` / `aria-expanded`，并用描边进一步强化。
- 390px 宽度下文档改为贴边布局，控件保持 34px 目标高度，表格横向滚动，12 列矩阵折叠。
- `prefers-reduced-motion` 下移除过渡。
- 大写只作用于标签，不作用于正文；中文不依赖 `text-transform`，字距也不应影响可读性。
- 状态不仅靠色相：同时改变边框、标签和左侧信号线。

---

## 8. 使用方式

### 直接引入 CSS

```ts
import 'reactive-md/styles.css';
import 'reactive-md-sci-fi-theme/styles.css';
```

### 注册主题

```tsx
import { LOCAL_THEME_PROTOCOL, type LocalThemeDefinition } from 'reactive-md';
import { LocalReactiveDocument } from 'reactive-md/react';
import 'reactive-md/styles.css';
import './tokens.css';
import './components.css';

const sciFi = {
  name: 'sci-fi',
  protocol: LOCAL_THEME_PROTOCOL,
  colorSchemes: ['light', 'dark'],
} as const satisfies LocalThemeDefinition;

<LocalReactiveDocument
  source={source}
  themes={[sciFi]}
  colorScheme="dark"
/>
```

### 文档选择

```markdown
<theme name="sci-fi">

# 轨道转移控制台
```

### 主题包

`src/theme.ts` 通过 `defineLocalTheme` 校验并冻结资源，把每条规则限定到 `[data-rmd-theme="sci-fi"]`。导出、SSR 或离线管线可直接使用 `sciFiThemeResources`。

---

## 9. 应该 / 不应该

| 应该 | 不应该 |
| --- | --- |
| 用 1px 线分隔模块 | 用模糊卡片阴影制造层级 |
| 每个模块只保留一个强调动作 | 把所有选中项都填成强调色 |
| 元数据使用等宽大写 | 将正文整段大写 |
| 保持 4px 间距节奏 | 混用 3/5/7px 的随意间距 |
| 选中态使用 2px 内嵌信号线 | 用光晕作为主要选中提示 |
| 窄屏让表格横向滚动 | 把表格字号压到 13px 以下 |
| 图表框与面板头对齐 | 让坐标标签漂到框外 |
| 组件规则使用 `--sf-*` token | 在组件里硬编码十六进制色值 |

---

## 10. 验证

```sh
npm run sci-fi:test         # token、作用域、对比度、圆角与间距
npm run sci-fi:typecheck    # 示例类型检查
npm run sci-fi:build        # 生产构建
npm run sci-fi:screenshot   # 重新生成截图，运行时错误则失败
```

截图脚本会在控制台错误、页面错误或渲染诊断出现时失败，并输出暗色、亮色、组件特写和 390px 布局。
