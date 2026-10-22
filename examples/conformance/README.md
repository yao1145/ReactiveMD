# 语言验收数据

[local-draft-1.json](local-draft-1.json) 是可复制的最小语义验收集，包含源码、编译结果、初始参数、状态写入和预期文本。数据随 npm 包分发，其他工具或实现可以读取同一份 JSON。

- `syntaxVersion` 对应核心导出的 `LOCAL_SYNTAX_VERSION`。
- `ok` 是预期编译结果；失败时 `codes` 是去重后的预期诊断码集合。
- `initial` 检查公开参数的初值；`bindingNames` 在出现时检查完整绑定名集合。
- `actions` 按 `bind` 查找控件并提交 `value`；有 `codes` 时预期写入被拒绝，否则预期成功。
- `text` 用更新后的状态求值，结果应等于 `expectedText`。

运行器见仓库中的 `tests/conformance.test.ts`，执行 `npm test` 即可检查。本集覆盖共享参数、隐藏初始化、写入约束、代码隔离和诊断；完整语法验收还包含其他语言测试及浏览器检查，规则见[语法规范](../../docs/local-interaction-syntax.md)。诊断码的跨版本约定见[兼容说明](../../docs/compatibility.md)。
