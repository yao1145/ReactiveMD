# 复用计算与格式化数值

这些能力属于使用 `local-draft-2` 的 `0.4.0`。完整语法见[语法规范](local-interaction-syntax-ch.md)，宿主接口见[集成说明](local-integration-ch.md)，可运行文档见[账单示例](../examples/local/recipes/invoice-zh.reactive.md)。

## 命名值

```markdown
<const name="unitPrice" value="{{ 12.5 }}">
<computed name="total" value="{{ quantity * unitPrice }}">
<computed name="invoice" value="{{ formatCurrency(total, 'CNY', 2, 'zh-CN') }}">

<number bind="quantity" label="数量" initial="2" min="0" max="100">

账单：**{{ invoice }}**。

<if when="{{ total >= 100 }}">
达到批量配送门槛。
</if>
```

`computed` 和 `const` 是不可见的无结束标签声明。每条声明独占文档顶层的一行，也接受 `/>`。两者都必须提供 `name` 和完整的 `value="{{ 表达式 }}"`。值支持数字、字符串、布尔值、null、字符串数组或数字数组。编译器推断类型，无需类型标注，也不进行隐式转换。数组字面量与聚合见[集合说明](constraints-collections-ch.md)。

名称沿用 `bind` 的标识符和保留字规则。控件、槽位绑定与声明共用命名空间，声明不能覆盖其他声明或控件。容器内声明是编译错误。代码块、行内代码和注释内的声明保持原有的字面显示或惰性行为。

声明在整个文档中可见，可以先引用后声明。`computed` 可以读取控件、常量和其他计算值。`const` 可以读取其他常量和 `pi` 等内置常量，必须独立于控件与计算值。因此，固定单价、阈值等参数无需显示禁用输入框。常量不提供编辑或重置控件。

编译器从表达式 AST 提取全部分支的依赖，按依赖顺序推断类型。未知名称、重名、自引用和间接循环均产生带源码位置的错误；未执行分支里的环也属于编译错误。运算符和函数沿用普通表达式的类型规则。运行时仍可能出现域错误，例如读者把作为分母的控件改为零。

正文、动态属性、条件和图表表格中的数值单元格都可以读取命名值。可计算 LaTeX 公式中的多字母数字名称写为 `\mathrm{total}`，例如 `y = \mathrm{total} x`。格式化字符串用于正文或标签；图表数值单元格和曲线参数使用原始数字。

## 更新与错误

每个运行时独立缓存计算结果。同一修订内复用中间值；控件修改、原子槽位修改或面板重置成功后更新计算。常量在编译时求值，创建运行时时复制。隐藏内容保留其输入与计算；重置范围沿用现有控件子树规则。

消费者读取失败的计算值时，会收到其表达式错误，不会得到零、null 或上次成功值。独立消费者继续工作；有效输入可让失败的消费者恢复。逻辑与条件运算符保留运行时短路语义，未访问的分支不会读取其中的失败值。静态值非法的常量直接产生编译错误。

`document.bindings` 与 `document.initialState` 描述可写控件。`document.computations` 保存可序列化的声明元数据。`runtime.snapshot().state` 还包含本次修订成功求出的命名值，失败值缺席；需要保留错误语义时使用 `runtime.evaluate(name)`。`set` 和 `setMany` 不能修改声明。对外数组继续防止外部修改污染运行时。

## 数字格式化

四个函数都返回字符串，可选参数按位置传入。

| 函数 | 默认值与示例 |
| --- | --- |
| `formatNumber(value, digits, locale, grouping)` | `digits=2`、`locale="en-US"`、`grouping=true`；`formatNumber(1234.5)` 得到 `"1,234.50"` |
| `formatPercent(value, digits, locale)` | `digits=0`、`locale="en-US"`；`formatPercent(0.125, 1)` 得到 `"12.5%"` |
| `formatScientific(value, digits, locale)` | `digits=2`、`locale="en-US"`；`formatScientific(1234)` 得到 `"1.23E3"` |
| `formatCurrency(value, currency, digits, locale)` | `currency="USD"`、`digits=2`、`locale="en-US"`；`formatCurrency(12.5)` 得到 `"$12.50"` |

`digits` 必须是 0 至 20 的整数，同时固定最少与最多小数位；JPY 等货币也遵守该规则。`grouping` 必须是布尔值。地区只接受 `en-US`、`zh-CN`、`de-DE`、`fr-FR`、`ja-JP`，省略时固定为 `en-US`，与界面语言、设备设置无关；不支持的地区会报错。货币代码必须是 `Intl.NumberFormat` 接受的三个大写 ASCII 字母。这是代码形式检查，不是流通货币名录验证。

格式化采用十进制 `halfExpand` 舍入，中点向远离零的方向舍入：`formatNumber(1.005)` 为 `"1.01"`，`formatNumber(-1.005)` 为 `"-1.01"`。零不显示负号。表达式运算仍使用有限的 JavaScript 数字；原有 `round(x)` 保留 `Math.round` 的中点向正无穷规则。格式化只改变显示，不改变源数值。

null 格式化为空字符串，其余参数严格检查类型，不把字符串自动转为数字。地区对应的标点、货币符号与空格来自宿主的 `Intl` 数据；跨平台需要逐字一致时，宿主应固定运行时及地区数据版本。

## 字符串

| 函数 | 规则 |
| --- | --- |
| `trim(text)` | 去除首尾 JavaScript Unicode 空白 |
| `lower(text)`、`upper(text)` | 使用不依赖地区的默认 Unicode 大小写映射 |
| `startsWith(text, search)`、`endsWith(text, search)` | 区分大小写的字面匹配，空搜索串匹配成功 |
| `replace(text, search, replacement)` | 替换全部不重叠的字面匹配；空搜索串报错；`$&` 等替换文本保持字面含义 |
| `slice(text, start, end)` | 按 Unicode 码点索引，终点不包含在结果内，默认到末尾；负索引从末尾计算；索引必须为整数，超界时截到边界 |

这些函数要求字符串，null 也会产生类型错误。函数不接受正则表达式或属性访问。码点不等于字素簇，一个组合表情或带组合重音的字母可能包含多个码点。所有结果沿用 100,000 个 UTF-16 代码单元的字符串预算；替换函数在分配超大结果前检查扩张长度。

## 日期

`dateCompare(a, b)` 返回 `-1`、`0` 或 `1`。`dateDiff(a, b, unit)` 返回有符号的 **a 减 b**，默认单位为 `"days"`，还支持 `"hours"`、`"minutes"`、`"seconds"`、`"milliseconds"`。

两项输入必须是有效的 `YYYY-MM-DD` 字符串，年份为 `0001` 至 `9999`，与日期控件一致，按公历校验闰日。每个日期表示 UTC 零点，因此设备时区和夏令时不会改变结果：`dateDiff("2026-03-09", "2026-03-08", "hours")` 为 `24`。时间戳、时区后缀和有歧义的地区日期格式会被拒绝。

空日期控件的值为 `""`，表示未选择日期。空串或非法日期产生域错误，null 产生类型错误。可选日期应先判断：

```markdown
<computed name="days" value="{{ startDate == '' || endDate == '' ? null : dateDiff(endDate, startDate) }}">
天数：{{ days == null ? '请选择两个日期' : formatNumber(days, 0) }}
```

## 诊断与预算

声明诊断采用 `local.computation.*`：`placement`、`name`、`reserved`、`duplicate`、`value`、`unknown`、`cycle`、`const`、`expression`、`budget`。表达式类型错误沿用 `local.expression.*`。诊断包含源码范围、行号和列号。计算图采用迭代式依赖排序，长链不依赖递归求值。源码、语法节点、表达式和值继续遵守现有预算，循环诊断数量也受诊断预算限制。

## 兼容性

现有表达式和 `round(x)` 保持原有行为。新增函数名称成为本版本的保留标识符；升级前应重命名使用这些名称的旧绑定，并同步修改引用。[变更记录](../CHANGELOG-ch.md)记载了此次扩展。
