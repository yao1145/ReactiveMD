# 语言验收数据

[local-draft-1.json](local-draft-1.json) 是可复制的最小语义验收集，包含源码、编译结果、初始参数、状态写入和预期文本。数据随 npm 包分发，其他工具或实现可以读取同一份 JSON。

- `syntaxVersion` 对应核心导出的 `LOCAL_SYNTAX_VERSION`。
- `ok` 是预期编译结果；`codes` 是去重后的预期诊断码集合，省略时应无诊断。编译成功时也可能包含降级警告。
- `initial` 检查公开参数的初值；`bindingNames` 在出现时检查完整绑定名集合。
- `actions` 按 `bind` 查找控件并提交 `value`；有 `codes` 时预期写入被拒绝，否则预期成功。
- `text` 用更新后的状态求值，结果应等于 `expectedText`。

运行器见仓库中的 `tests/conformance.test.ts`，执行 `npm test` 即可检查。本集覆盖共享参数、隐藏初始化、写入约束、代码隔离和诊断；完整语法验收还包含其他语言测试及浏览器检查，规则见[语法规范](../../docs/local-interaction-syntax.md)。诊断码的跨版本约定见[兼容说明](../../docs/compatibility.md)。

## 组块协议验收

[component-protocol-1.json](component-protocol-1.json) 为[组块协议](../../docs/component-protocol.md)提供代表性用例，覆盖 `slider`、`tabs`、`plot` 以及未知组块的惰性降级。[JSON Schema](component-protocol-1.schema.json) 定义验收文件格式，可供其他实现的工具读取。这个 JSON 是测试输入和预期结果，组件提案的声明模板见[开发指南](../../docs/component-development.md)。

```sh
npm run test:components
```

该命令运行组块协议用例和原有语言验收数据。新增组块应补充自己的用例、单元测试和受影响的渲染器检查；通过本集合只证明这些具体用例通过。

### 文件与用例字段

文件根对象包含 `protocolVersion`、`syntaxVersion` 和非空的 `cases`。当前分别为 `component-protocol-1` 和 `local-draft-1`。包版本另由 `package.json` 标识，不由这两个字段推断。

| 字段 | 规则 |
| --- | --- |
| `id` | 必填，在文件内唯一；描述一个可观察的行为 |
| `component` | 必填，标明主要验收的组块；源码可同时使用其他组块 |
| `source` | 必填，原始文档源码 |
| `ok` | 必填，预期编译是否成功 |
| `codes` | 必填，编译诊断码的去重集合；无诊断时为 `[]`，忽略顺序、精确比较集合 |
| `initial` | 可选，编译成功后的初始状态期望，按给定键部分匹配 |
| `bindingNames` | 可选，完整公开绑定名集合；不包含匿名组块的内部状态键 |
| `actions` | 可选，依次写入命名绑定；每项必填 `bind`、`value`、`codes`，可选 `expectedState` |
| `reset` | 可选，写入完成后重置指定节点；必填 `component` 和 `expectedState`，`index` 默认为同名组件源码顺序中的第 0 个 |
| `text`、`expectedText` | 可选，必须成对；在写入和重置后求值并精确比较结果 |
| `htmlIncludes`、`htmlExcludes` | 可选，在最终状态做 React 静态渲染，逐项检查包含或不包含的片段 |

`initial`、`expectedState` 的值使用语言现有的 `LocalValue`：字符串、有限数字、布尔值、`null` 或字符串数组。`actions[].codes` 是该次写入返回的诊断码集合，无诊断仍须写 `[]`；被拒绝的写入应保留上一次合法状态。运行器通过 `bind` 查找已编译的控件，调用 `runtime.set`，不模拟浏览器输入事件。

执行顺序固定为：校验数据格式及唯一 ID，编译并比较诊断，检查初始状态及公开绑定名，依序写入，再重置，最后检查文本和可选渲染结果。创建的运行时均在结束时销毁。`ok: false` 的用例只允许编译期字段，不能附加状态、动作或渲染期望；未知字段、缺失字段和不合法值应当让验收失败。

`reset` 调用当前实例的 `runtime.reset(node)`，节点按组块名和索引查找；验收文件不保存 `node.id`。这项检查验证运行时重置语义，点击重置按钮仍需渲染器或浏览器检查。

### 可移植范围

编译结果、诊断集合、状态变化和表达式文本是可移植的语义期望。HTML 片段只检查本仓库的 React 参考渲染器；其他渲染器应验证同等用户行为，无需生成相同 DOM 或 CSS 类名。

这些用例不会证明真实键盘操作、焦点移动、中文输入法、375px 布局、计时器暂停或销毁后的计时清理。涉及这些行为的贡献仍需提交相应浏览器证据，检查方法见[开发指南](../../docs/component-development.md)。诊断码的跨版本稳定性继续遵守[兼容说明](../../docs/compatibility.md)。
