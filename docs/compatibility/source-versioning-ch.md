# 源码修订与迁移

本文说明 `0.4.0` 中的显式源码修订、编译器的处理方式，以及纯核心 API 与 CLI 迁移工具。语法规则见[语法规范](../reference/local-interaction-syntax-ch.md)，包版本与 API 兼容规则见[版本与兼容性](compatibility-ch.md)，组块升级清单见[0.4.0 发布与迁移](../releases/release-0.4.0-ch.md)。

## 声明修订

源码用一行 HTML 注释声明修订：

```markdown
<!-- reactive-md: local-draft-3 -->
```

该指令属于文档前导区，位于 `<theme>` 声明和正文之前。BOM、空行和普通 Markdown 注释可以出现在它前面。只允许一条指令。

行内代码、代码围栏、数学区域和按原文显示的未知标签示例都不是指令。在文档里展示这一行，不会为周围文档声明版本。

编译行为：

| 源码 | 结果 |
| --- | --- |
| 没有指令 | 按当前修订 `local-draft-3` 解析；不新增警告 |
| `local-draft-3` | 正常解析 |
| `local-draft-1` 或 `local-draft-2` | 以 `local.version.*` 诊断拒绝；先迁移 |
| `local-draft-1` 或其他显式旧修订 | 以 `local.version.*` 诊断拒绝 |
| 未知、格式错误、重复或位置错误的指令 | 以 `local.version.*` 诊断拒绝 |

版本声明被拒绝时不创建运行时。声明旧修订不会选择旧解析器，也不会让文档在现行规则下可读；必须先迁移源码。

在这一声明出现之前构建的读者（包括 `0.3.1`）会把这条注释当作普通 HTML 注释。它们不校验声明，不拒绝旧修订，也不执行这项检查。声明保护的是在本版本及后续版本中打开的文档；依赖这项检查前，先迁移旧文档。

## 查看声明的修订

`inspectLocalSourceVersion` 从 `reactive-md` 导出，不编译，也不创建运行时：

```ts
import { inspectLocalSourceVersion } from 'reactive-md';

const info = inspectLocalSourceVersion(source);
// {
//   declaredVersion: string | null,
//   effectiveVersion: string,
//   supported: boolean,
//   range: SourceRange | null,
//   diagnostics: Diagnostic[]
// }
```

- `declaredVersion` 是指令声明的修订；无指令时为 `null`。
- `effectiveVersion` 是用于解释判定的修订：有声明时取声明值，否则取当前修订。`supported` 为 `false` 时不进行解释。
- `supported` 表示当前编译器是否接受该修订。
- `range` 指向原始源码中的指令；没有指令时为 `null`。
- `diagnostics` 使用 `local.version.*` 前缀报告格式错误、重复、位置错误、旧修订或未知声明。

无指令源码返回 `declaredVersion: null`、`effectiveVersion: 'local-draft-3'`、`supported: true`，不产生版本诊断。

## 检查升级

```ts
import { checkLocalUpgrade } from 'reactive-md';

const check = checkLocalUpgrade(source);
// {
//   ok: boolean,
//   fromVersion: string,
//   toVersion: 'local-draft-3',
//   needsMigration: boolean,
//   diagnostics: Diagnostic[]
// }
```

`fromVersion` 默认取声明的修订；源码没有声明时取当前修订。可以用 `LocalUpgradeOptions` 覆盖：

```ts
type LocalUpgradeOptions = {
  fromVersion?: string;
  allowSemanticChanges?: boolean;
};

const check = checkLocalUpgrade(oldSource, { fromVersion: 'local-draft-1' });
```

无版本声明的历史文档需要传入 `fromVersion: 'local-draft-1'`，才会执行 draft-1 检查。显式 `fromVersion` 与声明不一致时，检查被拒绝。迁移源接受 `local-draft-1`、`local-draft-2` 和当前的 `local-draft-3`；旧版 YAML 修订和未知名称会被拒绝。

`needsMigration` 表示源码需要写入或替换声明：无声明源码需要补上当前指令，当前源码已经完整，draft-1 源码需要替换指令。版本变化本身可以识别、但存在阻止安全迁移的条件时，`ok` 为 `false`。

## 迁移源码

```ts
import { migrateLocalSource } from 'reactive-md';

const result = migrateLocalSource(oldSource, { fromVersion: 'local-draft-1' });
// {
//   ok: boolean,
//   fromVersion: string,
//   toVersion: 'local-draft-3',
//   needsMigration: boolean,
//   diagnostics: Diagnostic[],
//   source: string,
//   changed: boolean,
//   edits: { range: SourceRange; text: string }[]
// }
```

迁移只写入或替换元数据注释，保留正文。正文原始字节、UTF-8 BOM 和 CRLF 换行保持不变；操作幂等，已迁移到当前版本的源码返回 `changed: false` 和相同文本。`edits` 定位每处替换。迁移被阻止时不产生迁移结果，调用方传入的内容保持不变。

把 `local-draft-1` 源码迁移到 `local-draft-3` 之前，迁移会阻止：

- 使用 17 个新增保留表达式名的绑定：`sum`、`average`、`minOf`、`maxOf`、`formatNumber`、`formatPercent`、`formatScientific`、`formatCurrency`、`trim`、`lower`、`upper`、`startsWith`、`endsWith`、`replace`、`slice`、`dateCompare`、`dateDiff`；
- 代码之外出现的、在旧修订中不执行的新增标签名：`jump`、`anchor`、`text`、`section`、`multi-select`、`range-slider`、`coordinate`、`quiz`、`steps`、`step`、`computed`、`const`、`validation`、`data-table`、`column`、`external`；
- 表达式中的数组语法或新增内置函数调用；字符串字面量中的文本不触发此检查；
- 源码当前的编译错误。

诊断给出准确位置。迁移不重命名标识符、不改写表达式，也不激活原先按原文显示的标签；这些属于作者对源码的修改。

文本控件需要一次明确的兼容决定。`input` 或 `textarea` 带大于零的 `min-length`，或带 `max-length` 时，astral Unicode 的读者语义会改变：draft-2 按 Unicode 码点计数，draft-1 按 UTF-16 代码单元计数。除非允许语义变化，迁移会阻止这些控件：

```ts
migrateLocalSource(oldSource, {
  fromVersion: 'local-draft-1',
  allowSemanticChanges: true,
});
```

开启后迁移继续，并为每个受影响的控件返回警告。新的码点上限就是预期读者行为时使用该选项。

清单完成样式是有记录的兼容例外。这项视觉变化本身不阻止迁移，也不按核心运行时语义失败处理。

迁移会改变源码摘要。现有 `reactive-md-state/v1` 文件随后无法通过摘要校验，迁移后应重新导出状态文件。迁移不会改写状态文件。

## CLI

```sh
reactive-md migrate doc.reactive.md
reactive-md migrate - --from local-draft-1 -o doc.reactive.md
reactive-md migrate doc.reactive.md --check
reactive-md migrate doc.reactive.md --check --json
reactive-md migrate old.reactive.md --from local-draft-1 --accept-semantic-changes -o new.reactive.md
```

| 选项 | 含义 |
| --- | --- |
| `[file\|-]` | 输入文件；`-` 表示标准输入 |
| `--from local-draft-1\|local-draft-2\|local-draft-3` | 源修订；默认取声明或当前修订 |
| `--check` | 只报告是否需要迁移，从不写入 |
| `--json` | 标准输出结构化报告，且是唯一的 stdout 内容 |
| `-o, --output <file>` | 新建文件；拒绝任何已存在的路径，包括输入文件本身 |
| `--accept-semantic-changes` | 允许文本控件长度语义变化，并报告警告 |
| `--locale en\|zh` | 诊断和摘要的显示语言 |

默认把迁移后的源码写到标准输出。输入文件不会被覆盖；`-o` 使用独占创建，目标已存在即报错。没有 `-o` 时，请重定向 stdout 保存结果。

`--check` 从不写入。它输出诊断和摘要；带 `--json` 时输出 JSON 报告。需要迁移或被阻止时退出 `1`，源码已是当前版本时退出 `0`。普通迁移被阻止时退出 `1`，成功时退出 `0`。用法和 I/O 错误退出 `2`。不要把源码文本混入 JSON 报告。

命令一次迁移一份源码。本版本不提供 `--write`、不就地覆盖，也不提供破坏性批量操作。

## 范围

迁移处理声明的元数据变化，并检查正文能否跨越修订边界。它不是旧版读取器：不解释 YAML `state`/`data`/`computed`/`actions` 配置块、directive 或其他 draft 之前的语法，也不改写正文。在 `local-draft-3` 下已经无法编译的源码会保持阻止状态，直到作者修复报告的位置。

`0.6.0` 同时提供于 `latest` 与 `next` 渠道。本页说明从 `0.4.0` 起提供的迁移工具。
