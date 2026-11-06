# 语言一致性数据

**中文** · [English](README.md)

[local-draft-2.json](local-draft-2.json) 是一份可复制的最小语义一致性套件，包含源文档、编译结果、初始参数、状态写入和期望文本。该数据随 npm 包分发，便于其他工具或实现读取同一份 JSON。

- `syntaxVersion` 与核心导出的 `LOCAL_SYNTAX_VERSION` 一致。
- `ok` 是期望的编译结果；`codes` 是去重后的期望诊断码集合，省略时表示不期望产生诊断。成功编译仍可能包含降级警告。
- `initial` 检查公开参数的初始值；`bindingNames` 存在时，检查完整的绑定名集合。
- `actions` 按 `bind` 查找控件并提交 `value`；存在 `codes` 时表示期望该写入被拒绝，否则期望写入成功。
- `text` 使用更新后的状态求值，结果应等于 `expectedText`。

运行器位于仓库的 `tests/conformance.test.ts`；运行 `npm test` 即可检查。该套件覆盖共享参数、隐藏初始化、写入约束、代码隔离、诊断、多槽控件、多选、生成表格选择以及一次计算值聚合重算。它不覆盖校验提示、生成表格渲染、HTML 导出、作者工具或浏览器行为；这些有专门的测试和发布门禁。完整的语法一致性还包括其他语言测试和浏览器检查，规则见[语法规范](../../docs/reference/local-interaction-syntax-ch.md)。诊断码的跨版本保证见[兼容性说明](../../docs/compatibility/compatibility-ch.md)。

一致性源文件不带版本号，使用当前的 `local-draft-2` 修订。可选的序言版本声明属于编译元数据，不会改变这些语义用例。版本拒绝与迁移行为有专门的测试和历史 fixture。见[源码修订与迁移](../../docs/compatibility/source-versioning-ch.md)。

## 组块协议一致性

[component-protocol-1.json](component-protocol-1.json) 为[组块协议](../../docs/development/component-protocol-ch.md)提供代表性用例，覆盖 `slider`、`tabs`、`plot` 以及未知组块的延迟降级。协议修订现为 `component-protocol-2`，现有 `component-protocol-1.json` 仍是冻结的作者组件基线。[JSON Schema](component-protocol-1.schema.json) 定义了该一致性文件的格式，便于其他实现的工具读取。这份 JSON 是测试输入与期望结果；组件提案的声明模板见[开发指南](../../docs/development/component-development-ch.md)。

```sh
npm run test:components
```

该命令运行组块协议用例和现有的语言一致性数据。新增组块应补充自己的用例、单元测试和受影响的渲染器检查；通过本套件只能证明这些具体用例通过。

### 文件与用例字段

文件根对象包含 `protocolVersion`、`syntaxVersion` 和非空的 `cases` 数组。目前分别为 `component-protocol-1` 和 `local-draft-2`。包版本由 `package.json` 单独标识，不从这两个字段推断。

| 字段 | 规则 |
| --- | --- |
| `id` | 必填，在文件内唯一；描述一种可观察行为 |
| `component` | 必填，标注主要受测组块；源文档也可使用其他组块 |
| `source` | 必填，原始文档源码 |
| `ok` | 必填，编译是否期望成功 |
| `codes` | 必填，去重后的编译诊断码集合；没有时为 `[]`，忽略顺序，按集合精确比较 |
| `initial` | 可选，成功编译后的初始状态期望，按给定键做部分匹配 |
| `bindingNames` | 可选，公开绑定名的完整集合；不含匿名组块的内部状态键 |
| `actions` | 可选，按顺序写入具名绑定；每项需要 `bind`、`value`、`codes`，可包含 `expectedState` |
| `reset` | 可选，写入后重置指定节点；需要 `component` 和 `expectedState`，`index` 默认为同名组块中按源码顺序的第 0 个 |
| `text`、`expectedText` | 可选，必须成对出现；在写入和重置之后求值，结果精确比较 |
| `htmlIncludes`、`htmlExcludes` | 可选，在最终状态执行 React 静态渲染，检查列出的每个片段存在或不存在 |

`initial` 与 `expectedState` 的值使用语言现有的 `LocalValue`：字符串、有限数字、布尔值、`null` 或字符串数组。公开可写控件不产生数字数组；数字数组可供表达式和计算值使用。`actions[].codes` 是该次写入返回的诊断码集合；没有时仍需写 `[]`。被拒绝的写入应保留最后一个有效状态。运行器按 `bind` 找到编译后的控件并调用 `runtime.set`；它不模拟浏览器输入事件。

执行顺序固定：校验数据格式和唯一 ID，编译并比较诊断，检查初始状态和公开绑定名，按顺序执行写入，然后重置，最后检查文本和可选的渲染结果。每个创建的运行时最后都会被释放。`ok: false` 的用例只能使用编译期字段，不能添加状态、动作或渲染期望；未知字段、缺失字段和非法值都应判定为不一致。

`reset` 在当前实例上调用 `runtime.reset(node)`；节点按组块名和索引查找，一致性文件不保存 `node.id`。该检查验证运行时重置语义；点击重置按钮仍需要渲染器或浏览器检查。

### 可移植范围

编译结果、诊断集合、状态变化和表达式文本是可移植的语义期望。HTML 片段只检查本仓库的 React 参考渲染器；其他渲染器应验证等价的用户行为，不必生成相同的 DOM 或 CSS 类名。

这些用例不能证明真实键盘操作、焦点移动、中文输入法、375px 布局、计时暂停，或释放后的计时器清理。涉及这些行为的贡献仍需相应的浏览器证据；验证方法见[开发指南](../../docs/development/component-development-ch.md)。诊断码的跨版本稳定性仍遵循[兼容性说明](../../docs/compatibility/compatibility-ch.md)。
