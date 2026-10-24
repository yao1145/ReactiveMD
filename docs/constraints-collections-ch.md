# 条件、校验与本地集合

这些能力扩展使用 `local-draft-2` 的 `0.4.0`。[工作坊示例](../examples/local/recipes/workshop-zh.reactive.md)把人数预算、日期区间和已选主题表格放在同一份文档里，[命名计算](computations-formatting-ch.md)保存其中间结果。

## 跨字段校验

```markdown
<number bind="people" label="人数" initial="4" min="1" max="20">
<number bind="capacity" label="房间容量" initial="3" min="1" max="20">
<validation when="{{ people <= capacity }}" message="请选择能容纳 {{ people }} 人的房间。" fields="people capacity">
```

`validation` 是无结束标签的块组件，必须提供 `when`、`message`、`fields`。`when` 包含一个完整的布尔表达式；`message` 是提示文字，可以包含普通插值；`fields` 以空白分隔关联的公开可写绑定名，名称不能重复，也可使用多槽位控件的绑定。规则能读取控件和计算值，允许前向引用。只读声明不能作为关联字段。

约束提示文档当前是否一致。读者可以继续编辑不一致的计划，初始值不满足跨字段规则也能正常显示和修改。例如，人数从四人改为六人后可能暂时超过容量，再换房间即可消除提示。单个控件原有的数字范围、日期合法性等规则继续拒绝非法写入。

`runtime.validate()` 按源码顺序返回当前失败规则的诊断。条件为 false 时使用 `local.validation.failed`，表达式无法求值时使用 `local.validation.expression`，错误也视为失败。一条失败规则不会阻断其他规则。结果按运行时修订缓存，对外返回副本；编辑、原子槽位更新及重置会同步刷新计算与校验。

渲染器显示失败提示，并通过 `aria-describedby` 和 `aria-invalid` 把提示关联到字段或其可访问分组。提示 ID 属于各自文档实例；通过校验后清除错误文字。隐藏内容中的规则继续生效，但隐藏提示不会主动播报。每份文档最多有 100 条规则，隐藏区域也计入；诊断文字沿用 2,000 字符上限。

## 受控的条件样式

```markdown
<badge tone="{{ total <= budget ? 'success' : 'warning' }}">{{ formatCurrency(total) }}</badge>
<alert tone="{{ total <= budget ? 'info' : 'warning' }}">预订前请核对预算。</alert>
```

本版本允许两个现有组件动态设置 `tone`：`badge` 接受 `neutral`、`success`、`warning`，`alert` 接受 `info`、`success`、`warning`。静态值保持原有行为。动态表达式必须是字符串类型，渲染器还会检查结果是否属于组件允许的枚举。表达式错误或非法值会使用默认样式并显示计算提示。这个条件接口不接受作者 CSS 类、样式字符串或动态颜色。

有限枚举可表达警告和成功状态，同时让主题继续控制颜色与对比度。更广泛的条件样式需要另行确定可访问性与主题规则。

## 数组与索引

```markdown
<const name="fixedFees" value="{{ [100, 20, 5] }}">
<computed name="fees" value="{{ [people * 80, includeKit ? people * 20 : 0] }}">

第一项：{{ fees[0] }}。合计：{{ sum(fees) }}。
```

数组字面量只能包含同一种类型的字符串或有限数字，元素表达式可以读取文档命名值。嵌套数组、混合类型、布尔值和 null 元素会被拒绝。`[]` 默认是空数字数组；条件分支直接写空字面量时，可采用另一分支的字符串数组类型，因此字符串多选值也可使用 `show ? subjects : []`。已有清单与多选控件继续产生字符串数组。公开类型 `LocalValue` 增加 `number[]`，`LocalValueKind` 增加 `number-array`，原来的 `array` 继续表示字符串数组。

索引从零开始，`values[0]` 读取第一项。索引必须是有限的安全整数；超出范围的整数（包括负数）返回 null，非整数报错。字符串和其他标量不能作为数组索引。数组不能直接插值显示，应使用索引、`len`、聚合或数据表格。

`len` 支持两种数组；`contains` 在字符串数组中接受字符串，在数字数组中接受数字，原有字符串子串检查不变。每个数组最多 10,000 项；数组字面量还计入既有表达式长度、AST 节点和求值预算。字符串数组内容继续受字符预算限制。运行时返回数组副本，快照数组被冻结。

## 简单数字聚合

| 函数 | 结果 |
| --- | --- |
| `sum(values)` | 数字数组之和，空数组返回 `0` |
| `average(values)` | 算术平均值，空数组返回 null |
| `minOf(values)` | 最小项，空数组返回 null |
| `maxOf(values)` | 最大项，空数组返回 null |

聚合只接受数字数组，不自动转换看起来像数字的字符串。结果使用有限的 JavaScript 数字，求和或结果溢出会产生表达式错误；`average` 先求和再除以项数，中间求和溢出也会报错。空聚合产生的 null 沿用现有可空表达式规则，需要时先判断再参与数值运算。标量 `min`、`max`、`round` 保持原有签名与行为。

## 从本地值生成表格行

```markdown
<const name="subjects" value="{{ ['mathematics', 'physics', 'chemistry'] }}">

<data-table label="主题准备工作" rows="{{ subjects }}" key="{{ item }}" max-rows="3">
<column label="主题" value="{{ item }}">
<column label="序号" value="{{ index + 1 }}">
<column label="准备工作" value="{{ item == 'chemistry' ? '准备材料' : '准备例题' }}">
</data-table>
```

`data-table` 是成对的块组件，必须提供可访问名称 `label`、完整数组表达式 `rows`，以及完整字符串或数字表达式 `key`。子内容只能是 1 至 20 个无结束标签的 `column` 声明。列必须提供静态标题 `label` 和完整的标量 `value` 表达式；单元格只输出文本，null 为空单元格。

每行有两个局部名称：`item` 是当前字符串或数字，`index` 是当前从零开始的位置。列表达式中这两个名称覆盖同名全局值，其他引用仍读取文档环境。`rows` 自身使用普通文档作用域。

键表达式只能依赖 `item`，且至少引用它一次，不能依赖 `index` 或其他文档值。表格检查键是否为非空字符串或有限数字，并确保唯一。数字键和字符串键属于不同标识，数字正负零视为同一标识；条目重排时保留 React 行身份。需要重复显示值时，应以不同的本地 ID 组成 `rows`，再根据 ID 生成显示列。重复键或非法键会使整张表显示错误。

`max-rows` 是 1 至 1,000 的静态整数，默认 100。整份文档各表声明的行预算总和最多 2,000，行预算乘列数的总和最多 10,000 个单元格，隐藏表格也计入。每张生成表还有 100,000 个 UTF-16 代码单元的预算，覆盖表头、单元格、错误或空状态占位文字及编码后的行键。渲染器在显示行之前检查预算，超出时显示错误，不截断数据。

空数组显示表头与空状态。数据源或键求值失败时清除表格行并显示错误；单元格表达式失败只影响该单元格，其余内容继续显示。组件只生成原生表格行，不重复任意文档区块或控件。原有 Markdown 表格及其图表输入保持原有行为。

## 集成与兼容性

`LocalDocument.validations` 保存可序列化的 `LocalValidation` 元数据，宿主可随时调用 `runtime.validate()`，调用不会修改状态。编译后的文档仍可用 `structuredClone` 传递给 Worker。对象生命周期和持久化规则见[集成说明](local-integration-ch.md)。

新增聚合函数名 `sum`、`average`、`minOf`、`maxOf` 成为保留字，升级前需重命名冲突绑定及其引用。对 `LocalValueKind` 做穷举检查的宿主应加入 `number-array`；可写多选与清单控件仍只接受字符串。预览版发布在 `next` 渠道。
