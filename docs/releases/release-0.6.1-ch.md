# 0.6.1 发布说明

`reactive-md@0.6.1` 将公式展示从原生 MathML 切换为 KaTeX，同时更新 `latest` 与 `next`。语法修订 `local-draft-2`、组块协议 `component-protocol-2` 和主题协议 `reactive-md-theme-1` 保持不变。

```sh
npm install reactive-md
# 或固定版本
npm install reactive-md@0.6.1
```

离线安装可下载 [npm 安装包](https://registry.npmjs.org/reactive-md/-/reactive-md-0.6.1.tgz)。

## 公式展示

KaTeX 使用配套数学字体排版行内与独立公式，输出可视 HTML、用于辅助技术的 MathML，以及保留原始 LaTeX 的注释。积分、分式、矩阵、多行对齐、公式编号与 mhchem 化学式使用同一渲染器。编译诊断与实际展示共用 KaTeX 的语法支持范围，新增有效写法包括 `matrix`、`\overset`、`\displaystyle` 和 `\limits`。

标准样式内嵌 20 个 WOFF2 字体文件，预览、打印及单文件 HTML 均可离线显示公式；禁用 JavaScript 的静态 HTML 也保留排版。行内公式跟随文字基线，并在 KaTeX 允许的位置换行。超宽独立公式可横向滚动，编号与正文之间预留间距。

## 兼容性

现有导入继续有效。使用无样式 React 入口时，加载 `reactive-md/styles.css`，或由宿主提供 KaTeX 样式和字体。内嵌渲染器与字体会增加下载体积。

`align` 现在自动按行编号；无需自动编号时使用 `align*` 或 `aligned`。显式 `\tag` 用于独立公式。无效或不支持的公式现在整条回退为有界原文，并在对应源码位置给出 `local.math.display` 警告。

绘图求值保留现有解析器、函数支持范围和参数更新逻辑。作者自定义宏、HTML、文件与网络命令继续关闭；输入长度、嵌套、记号数、宏展开与作者指定尺寸均受预算限制。详见[语法参考](../reference/local-interaction-syntax-ch.md)和[安全策略](../../SECURITY-ch.md)。

KaTeX 及其字体替代独立的 `mhchemparser` 依赖；随包 mhchem 扩展的上游版权与 Apache-2.0 声明保留在 `THIRD_PARTY_NOTICES.md`。
