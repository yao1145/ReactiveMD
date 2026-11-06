# 严格模式与局部恢复

**中文** · [English](tolerance-en.md)

`strict` 控制单次编译、旧 `compileLocal`、编辑会话和 Worker 的结构恢复行为。默认值为 `true`；省略和显式 `undefined` 使用相同默认值。其他非布尔值是配置错误。

```ts
import { createStandardCompiler } from 'reactive-md/compiler/standard';

const compiler = createStandardCompiler({ strict: false });
const result = compiler.compile(`前文。

<alert>
尚未闭合的内容 {{ missing }}。

## 后续章节

这里的 **Markdown** 继续渲染。
`);

if (result.status === 'recovered') {
  console.log(result.recoveries, result.program.nodes);
}
```

宽松模式将 `<alert>` 起到后续同层标题前的片段保留为原始文本。片段中的组件、插值和声明不执行；后面的章节照常编译。源码本身不被改写。

恢复遵循以下边界：

- 完整配对优先。合法组件可以跨越标题，内部标题不会截断它。
- 孤立结束标签只降级该标签。外层容器能正常闭合时，未闭合的内层片段降级到外层结束标签之前。
- 起始标签完整且找不到闭合时，可以在前有空行、处于相同 Markdown 容器的 ATX 标题前继续解析。代码、注释、原始 HTML 文本及未结束引号中的标题不能作为边界。
- 普通段落、空行和兄弟组件不是同步点。找不到可靠标题或起始标签词法未结束时，降级到可靠外层边界或文件末尾。

恢复记录包含 `code`、`causeRange`、`affectedRange`、`action` 和 `boundary`。范围使用原始源码的 UTF-16 半开区间 `[start, end)`；`source.slice(start, end)` 得到实际片段。记录稳定排序并去重，恢复本身不增加正文错误块或一批 warning。

绑定、计算循环、初值、组件必填属性和形态错误仍会使编译失败；版本、配置和预算错误同样保留。正常区域引用已降级片段内的声明时，该引用仍是未知绑定错误。失败结果也可能保留此前已经完成的恢复记录。

## HTML 与 details

宽松模式在已确定的局部 HTML 片段内使用 parse5 处理省略标签、错配和合成节点。修复继续服从原有元素、属性和 URL 策略，`strict: false` 不授予脚本、CSS 或扩展 HTML 权限。无法保留混合 RMD 归属和源范围的片段整体显示为文本。合成节点带有 `synthetic` 与 `syntheticBoundary`，不会虚构原始标签位置。

两种模式均支持以下无空行写法：

```html
<details>
  <summary>1145</summary>
  1145
</details>
```

它呈现为一个空标题 accordion 内的单个 disclosure：按钮标题为 `1145`，面板正文为 `1145`。默认折叠，点击、Enter 和空格可切换；`open` 属性使初始状态展开，静态呈现显示正文。富文本 summary 和嵌套 details 保留各自内容。

## 结果与宿主

新工厂的成功结果包含 `status: 'valid' | 'recovered'`、深只读且逐层冻结的 `program`、`diagnostics`、`recoveries` 和可选检查覆盖 `checks`。失败为 `status: 'failed'`，不包含 program。任务 1 的 `ok`、`document` 读取方式继续可用，document 是独立的普通数据副本。

旧 `compileLocal` 保留原有返回类型，并在有恢复时附加 `recoveries`。默认严格结果保持既有字段形状。运行时、SSR 和 standalone 接收同一源码对应的编译结果；导出选项保留所选 strict 模式，重新挂载时使用同一模式。

编辑会话在宽松模式下使用完整参考路径，避免复用跨越恢复边界的旧块；恢复策略版本与 strict 模式参与配置身份。严格模式保留现有优化。Demo 的宽松预览默认设置和作者检查面板按[近期规划](../architecture_roadmap/near-term-plan-ch.md)后续宿主阶段推进。

参见[单次编译入口](../integration/compiler-ch.md)和 [HTML 兼容](html-compatibility-ch.md)。
