# 单次编译入口

当前工作区新增两个单次编译入口。它们返回普通数据，宿主可自行创建运行时或选择呈现方式。这些改动尚未发布到 npm。

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

工厂接受 `LocalCompileOptions`，创建时校验并固定有效配置。无效配置抛出 `CompilerConfigurationError`；作者源码错误返回 `{ ok: false, diagnostics }`。成功结果为 `{ ok: true, document, diagnostics }`，与现有 `LocalCompileResult` 相同。每次 `compile` 都重新编译当前源码，前一次的绑定、诊断和节点不会成为下一次的输入。

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

旧根入口的 `compileLocal(source, options)`、编辑会话和 Worker 继续使用原有默认配置及返回类型。本次保持严格语义；`strict: false` 和局部恢复属于[近期规划](../architecture_roadmap/near-term-plan-ch.md)的任务 2。

这次交付建立 M1 的独立编译路径。Markdown 前端仍加载 Lezer、GFM 和 parse5；standard 的数学预检加载 KaTeX。共享辅助模块仍保留默认组件定义的回退，声明图仍可达现有 SDK 主题协议类型。能力拆分、完整 `.d.ts` 精简及默认预设隐藏依赖的最终移除属于 M4。

构建后运行 `npm run test:compiler-entry`，检查直接 ESM 导入、生产共享 chunk、声明依赖和浏览器消费。源码行为回归使用 `npm test -- tests/compiler-entry.test.ts`。
