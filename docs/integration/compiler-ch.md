# 单次编译入口

**中文** · [English](compiler-en.md)

ReactiveMD 提供最小和标准两个单次编译入口。它们返回普通数据，宿主可自行创建运行时或选择呈现方式。

```ts
import { createCompiler } from 'reactive-md/compiler';
import { createStandardCompiler } from 'reactive-md/compiler/standard';

const compiler = createCompiler();
const result = compiler.compile('# 说明\n\n普通 Markdown 正文。');

const standard = createStandardCompiler();
const interactive = standard.compile('<number bind="count" label="数量" initial="2">\n\n{{ count * 3 }}');

if (interactive.ok) {
  console.log(interactive.document.initialState.count);
}
```

`createCompiler` 默认不注册组件；`createStandardCompiler` 显式装配默认组件预设和现有 KaTeX 显示预检。两者均执行源码、表达式、结构和资源预算检查，使用原始 UTF-16 源码范围。单次调用不创建编辑会话、Worker 或运行时，也不加载 React、主题实现和 CSS。主题声明只记录名称与源码位置，主题资源由宿主加载。

接入现有 React/SSR 宿主时使用 standard。最小入口只采用 `config.components`，`config.presets` 不会隐式安装默认预设；依赖默认组件的扩展应选择 standard。最小结果具有独立的 `componentConfigKey`，直接交给现有默认配置的渲染器会报告 `local.extension.config-mismatch`。支持无预设宿主配置属于后续宿主边界工作。

工厂接受 `LocalCompileOptions`，创建时校验并固定有效配置。无效配置抛出 `CompilerConfigurationError`。编译结果用 `status` 区分 `valid`、`recovered` 和 `failed`，同时保留任务 1 的 `ok/document/diagnostics` 读取方式。成功时还提供独立且逐层冻结的 `program`、恢复记录 `recoveries` 与检查覆盖 `checks`；失败时不包含 program。每次 `compile` 都重新编译当前源码，前一次的绑定、诊断和节点不会成为下一次的输入。

宽松模式下，每个最终恢复在 `causeRange` 上产生至多一条 warning，使用与记录相同的稳定 `code`，并说明片段被降级为惰性源文本或经过 HTML 修复。warning 受现有诊断预算约束；预算已满时可以省略 warning，`recoveries` 仍保留记录。`valid` 不包含恢复 warning；`recovered` 成功结果包含 program 和这些 warning。无法恢复的语义、类型、绑定、选项、版本和预算错误仍为 error：无效工厂配置抛出 `CompilerConfigurationError`，编译期错误返回 `failed`。失败结果可同时包含此前恢复产生的 warning 和导致失败的 error。严格模式仍为默认，诊断形状不变。恢复记录的字段和公共结果类型不变，恢复策略身份版本为 2。

```ts
import { createCompiler, CompilerConfigurationError } from 'reactive-md/compiler';

try {
  const compiler = createCompiler({ limits: { maxSyntaxNodes: 1000 } });
  const result = compiler.compile('{{ missing }}');
  console.log(result.ok, result.diagnostics);
} catch (error) {
  if (error instanceof CompilerConfigurationError) console.error(error.message);
  else throw error;
}
```

旧根入口的 `compileLocal(source, options)`、编辑会话和 Worker 默认保持严格语义，并保留原有返回类型。有恢复时会附加 `recoveries` 及对应 warning。显式传入 `strict: false` 可启用[局部恢复](local-integration-ch.md#严格解析与局部恢复)。

单次入口始终只做最终编译：`compileLocal`、`createCompiler().compile` 和 `createStandardCompiler().compile` 不承担流式生命周期，不会返回 `status: 'partial'` 或暂态诊断，`sourcePhase` 选项也不会把它们变成流式入口。仍在生成中的源码应交给 `createLocalCompileSession()`、`LocalCompileScheduler`、Worker 或 `LocalReactiveDocument`；见[流式源码编译](local-integration-ch.md#流式源码编译)。

最小入口保留 CommonMark、RMD 结构、表达式、绑定与预算。作者能力开关独立于 RMD 解析和绑定。原生 HTML 片段解析和净化、GFM、Lezer 块规划、KaTeX 和绘图公式语义由标准入口与兼容入口提供。最小入口的运行与声明依赖图不包含 `parse5`、`@lezer/markdown`、`remark-gfm`、KaTeX、默认预设及其作者信息。

构建后运行 `npm run test:compiler-entry`，检查直接 ESM 导入、生产共享 chunk、声明依赖和浏览器消费。源码行为回归使用 `npm test -- tests/compiler-entry.test.ts`。
