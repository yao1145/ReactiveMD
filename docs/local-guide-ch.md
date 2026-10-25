# Reactive MD 新用户指南

这份指南面向会写 Markdown、见过一点 HTML、但没有接触过 Reactive MD 的读者。读完之后，你应该能独立写出带输入控件、实时计算、条件内容、图表和图解的本地交互文档。

本文讲的是 `local-draft-2` 本地交互语法。完整规则见 [本地交互语法规范](local-interaction-syntax-ch.md)，可以直接运行的完整文档见 [示例目录](../examples/local/README.md)。更完整的组件和表达式细节以规范为准。包版本、语法修订和迁移规则见 [版本与兼容性](compatibility-ch.md)。

## 目录

需要复用中间结果或格式化输出时，可读[复用计算与格式化数值](computations-formatting-ch.md)，其中附有完整账单示例。

- [1. 先建立直觉](#1-先建立直觉)
- [2. 五分钟：第一份交互文档](#2-五分钟第一份交互文档)
- [3. 标签怎么写](#3-标签怎么写)
- [4. 参数：用 bind 命名，用 initial 给初值](#4-参数用-bind-命名用-initial-给初值)
- [5. 常用输入控件](#5-常用输入控件)
- [6. 表达式：让文字跟着参数变](#6-表达式让文字跟着参数变)
- [7. 条件与内容组织](#7-条件与内容组织)
- [8. 清单、进度、计时与时间轴](#8-清单进度计时与时间轴)
- [9. 表格与图表](#9-表格与图表)
- [10. 图解与函数曲线](#10-图解与函数曲线)
- [11. 常见错误速查](#11-常见错误速查)
- [12. 完整练习：工作坊报名页](#12-完整练习工作坊报名页)
- [13. 下一步](#13-下一步)
- [附录 A：组件速查](#附录-a组件速查)

## 1. 先建立直觉

### 1.1 它解决什么问题

普通 Markdown 写出来的是固定内容。Reactive MD 在这套内容上增加一件事：读者可以改变参数，而文字、公式、表格、图表和图解会立即跟着变化。

例如，把一句固定的话：

```markdown
人数：3。每人 100 元，合计 300 元。
```

改成可调整的版本：

```markdown
<slider bind="people" label="人数" initial="3" min="1" max="20">

人数：**{{ people }}**。每人 100 元，合计 **{{ people * 100 }} 元**。
```

读者拖动滑块，两个数字一起更新。文档作者没有写 JavaScript，也没有写 CSS。

### 1.2 和 Markdown、HTML 的对应关系

你可以把 Reactive MD 看成“Markdown 正文 + 一小套固定 HTML 标签 + 模板表达式”。

| 你已经会的 | 在 Reactive MD 里 |
| --- | --- |
| Markdown 标题、段落、列表、引用、链接、图片 | 原样使用 |
| Markdown 表格 | 原样使用；也可以放进 `<table>` 获得搜索和排序 |
| HTML 标签 | 使用组件标签，以及无属性的 `<b>`、`<i>`、`<u>`、`<s>`、`<mark>`、`<br>` |
| HTML 属性 | 写成 `label="人数"`，属性名小写，值加引号 |
| JavaScript 变量 | 用 `bind="people"` 给控件命名 |
| 模板字符串 `${...}` | 用 `{{ people * 100 }}` 读取和计算 |
| `onclick` 事件 | 不支持，组件自带需要的交互 |
| `class`、`style`、`<script>` | 不支持，样式由组件统一提供 |

### 1.3 数据流只有三步

1. **声明**：输入控件用 `bind` 给一个参数命名，用 `initial` 给出初值。
2. **读取**：正文、表格或属性里的 `{{ 表达式 }}` 读取参数并计算。
3. **更新**：读者操作控件后，所有读取该参数的位置自动刷新。

先记住 `bind` 和 `{{ }}` 这两条连接规则，其余组件都是在这个基础上提供排版、选择、搜索、计时等能力。

## 2. 五分钟：第一份交互文档

### 2.1 完整示例

把下面这段放进 Playground：

```markdown
# 费用估算

<panel title="调整方案">
<slider bind="people" label="人数" initial="2" min="1" max="20">
<toggle bind="annual" label="年度付款">
</panel>

人数：**{{ people }}**。

每月费用：**{{ people * (annual ? 80 : 100) }} 元**。
```

逐行看：

- `<panel>` 是成对标签，用来包住一组相关控件，并自带“恢复默认”按钮。
- `<slider>` 是无正文标签，不需要 `</slider>`。
- `bind="people"` 声明一个数字参数 `people`。
- `initial="2"` 是初值。`min`、`max` 是滑块范围。
- `<toggle>` 声明布尔参数 `annual`，不写 `initial` 时默认关闭。
- `{{ people }}` 显示当前人数，`{{ people * (annual ? 80 : 100) }}` 计算月费。
- `annual ? 80 : 100` 是条件表达式：开启年度付款取 80，否则取 100。

点击面板里的“恢复默认”，人数和开关会一起回到初值。

### 2.2 运行和修改

在仓库根目录执行：

```sh
npm run dev
```

浏览器打开 `http://127.0.0.1:5173`，左侧编辑 Markdown，右侧即时预览。也可以打开线上演示 [yaozi.raricy.com](https://yaozi.raricy.com/)。

推荐先把 [示例目录](../examples/local/README.md) 里的短文档复制到编辑器，改一个数字或文字，观察右侧变化，再回来读后面的章节。

### 2.3 不共享参数的小组件

如果某个控件不需要被正文读取，可以完全省略 `bind`：

```markdown
<counter label="人数" initial="2" min="1" max="20">

<timer label="一分钟专注" duration="60">
```

它们仍然可以操作，只是没有对外公开的变量。适合“人数计数器”“专注计时器”这类独立工具。

## 3. 标签怎么写

### 3.1 两种标签形态

| 形态 | 写法 | 规则 |
| --- | --- | --- |
| 无正文组件 | `<slider bind="a" label="振幅">` | 不写结束标签；也可以写成 `<slider ... />` |
| 有正文容器 | `<card title="说明">` 和 `</card>` | 必须显式闭合，允许嵌套 |

无正文组件固定为：

`input`、`textarea`、`number`、`slider`、`range-slider`、`coordinate`、`toggle`、`checkbox`、`date`、`counter`、`timer`、`progress`、`anchor`、`edge`。声明标签 `computed`、`const`、`validation` 以及结构子项 `column` 也没有正文。

其余组件使用成对标签。特别提醒：`textarea` 的文本通过 `initial` 设置，所以它没有正文；不要写成 `<textarea>内容</textarea>`。

有正文容器可以嵌套 Markdown 和其他组件：

```markdown
<card title="方案说明">
价格随 **人数** 更新。

<slider bind="people" label="人数" initial="2" min="1" max="20">

总费用：{{ people * 100 }} 元。
</card>
```

标签可以换行书写，属性也可以分行：

```markdown
<slider
  bind="people"
  label="人数"
  initial="2"
  min="1"
  max="20">
```

### 3.2 属性规则

- 标签名和属性名使用小写 kebab-case，例如 `<radio-group>`、`page-size="5"`。
- 属性值用双引号或单引号包围。
- 属性顺序没有语义；同一个属性写两次会报错。
- 布尔属性可以省略值，例如 `required` 表示 `true`。
- 布尔值也可以显式写 `required="false"`。
- 属性值里可以出现 `>`，只要它在引号内，不会提前结束标签。
- 属性值里的 `&quot;`、`&apos;`、`&amp;`、`&lt;`、`&gt;` 会解码成对应文字。

动态属性分两种：

```markdown
<!-- 文本属性可以混合普通文字和插值 -->
<toggle bind="locked" label="锁定人数">
<slider bind="people" label="当前人数：{{ people }}" disabled="{{ locked }}">

<!-- 条件必须是完整布尔插值 -->
<if when="{{ people >= 5 }}">
人数已达 5 人。
</if>
```

`bind`、`initial`、`id`、`value`、`from`、`to`、`kind` 这类结构性属性必须是静态文字，不能写插值。

### 3.3 Markdown 仍然是主角

容器内部继续按 Markdown 解析，不需要额外的 `markdown` 属性。标题、强调、链接、图片、引用、列表、普通表格、行内代码和代码围栏都可以照常使用。

```markdown
<card title="参考资料">
- [Markdown 指南](https://commonmark.org/help/)
- 图片：![示意图](images/example.png)（路径替换为你的图片）

> 引用也可以放在卡片里。
</card>
```

代码围栏里的标签、插值和公式标记都按原文显示，不会生成控件：

````markdown
```markdown
<slider bind="example" label="示例">
当前值：{{ example }}。
```
````

HTML 注释 `<!-- ... -->` 会被忽略，不产生组件或变量。正文支持无属性的 `<b>粗体</b>`、`<i>斜体</i>`、`<u>下划线</u>`、`<s>删除线</s>`、`<mark>高亮</mark>` 和 `<br>`（也接受 `<br/>`），这些格式可以嵌套。其他内容使用 Markdown 或对应组件。结构完整的未知标签会保留为源码文本并给出警告，内部标签和插值也按原文显示。事件、`style` 等属性不会获得执行能力。

泛型 `Array<T>`、比较式 `x<y` 和货币 `$5`、`$10` 可以直接写在正文中。公式继续使用 `$x^2$`、`$5$` 或 `$$...$$`。单换行仍是 Markdown 软换行；需要硬换行时使用行尾两个空格或 `<br>`。

脚注使用 `正文[^note]` 引用，在独立段落写 `[^note]: 注释内容`。定义支持 Markdown、上述基础 HTML 和缩进续写的多段内容、列表、代码块。脚注按首次引用顺序编号，集中显示在文末；重复引用共用编号，每处都有返回链接。定义可以先于引用，也可以写在容器内。未定义引用保留原文，未引用定义不显示。脚注内的控件标签和 `{{ 插值 }}` 按文字显示，不建立绑定。

目录使用普通 Markdown 链接：`[参数说明](#参数说明)` 对应 `## 参数说明`。英文标题按小写和连字符命名，例如 `## Hello World` 对应 `#hello-world`；重复标题追加 `-1`、`-2`。标题中的动态文字按参数初值生成锚点，调整参数后目录仍指向同一个标题。渲染器会为同页的不同文档隔离锚点，无需在源码中添加前缀。

缩进只影响可读性：容器内容会按共同缩进量去掉缩进后再解析；代码围栏内部的缩进保持原样。普通正文建议不要额外缩进。

### 3.4 和 HTML 的关键差异

| HTML 习惯 | Reactive MD 的做法 |
| --- | --- |
| `<div>` 包一块内容 | 用 `<card>` 或 `<panel>` |
| `<input type="range">` | 用 `<slider>` |
| `<input type="checkbox">` | 用 `<checkbox>` 或 `<toggle>` |
| `<select>` + `<option>` | 用 `<select>`、`<choices>` 或 `<radio-group>` + `<option>` |
| `onclick="..."` | 不支持事件属性；组件自带交互 |
| `class="..."`、`style="..."` | 不支持作者样式 |
| `<script>`、`<style>` | 不支持 |
| JavaScript 变量 | 用 `bind` 声明参数 |
| 模板字符串 | 用 `{{ 表达式 }}` |
| 元素可以自动闭合或容错 | 成对标签必须严格闭合，错配会报诊断 |

一句话：标签只是“组件的外形”，不是可以随意扩展的 HTML。

## 4. 参数：用 bind 命名，用 initial 给初值

### 4.1 命名规则

`bind` 的值必须匹配 `[A-Za-z_][A-Za-z0-9_]*`，区分大小写。推荐使用有意义的英文或拼音，例如 `people`、`annual`、`budgetLevel`。

以下名称不能用作参数名：

- 绘图保留名：`x`、`y`
- 常量：`pi`、`e`
- 字面量：`true`、`false`、`null`
- 表达式函数名：`abs`、`sqrt`、`round`、`min`、`max`、`len`、`contains` 等

中文不能直接作为 `bind` 名称。控件上的中文放在 `label` 里。

### 4.2 类型和默认值

参数类型由组件决定，不根据输入文字猜测。

| 组件 | 公开值 | 不写 initial 时的初值 |
| --- | --- | --- |
| `input`、`textarea` | 字符串 | 空字符串 |
| `date` | 日期字符串 | 空字符串 |
| `number` | 数字 | 范围内最接近 0 的合法步长值 |
| `slider` | 数字 | `min`，默认范围 0 到 100 |
| `counter` | 数字 | 范围内最接近 0 的合法步长值 |
| `toggle`、`checkbox` | 布尔值 | `false` |
| `select`、`choices`、`radio-group` | 选项字符串 | 第一个选项的 value |
| `multi-select` | 已选选项 value 的字符串数组 | 空数组 |
| `range-slider` | 两个数字，`start` / `end` | start=min；end=范围内不超过 max 的最大合法步长值 |
| `coordinate` | 两个数字，`x` / `y` | 各轴最接近 0 的合法步长值 |
| 带 `key` 的 `table`、`chart` | 稳定行标识字符串 | 空字符串（未选） |
| `tabs` | 页面字符串 | 第一个 tab 的 value |
| `steps` | 步骤字符串 | 第一步的 value |
| `diagram` | 节点 ID 字符串 | 第一个节点的 id |
| `checklist` | 已勾选条目 ID 的字符串数组 | 由任务列表的勾选标记决定 |
| `timer` | 剩余秒数 | `duration`，默认 60 |

### 4.3 initial 的三条规则

1. 一个参数最多写一次显式 `initial`。同一个变量由多个控件共享时，只在其中一个控件上写。
2. `initial` 必须是静态值，不能写 `{{ }}`。
3. 初值必须符合组件约束。数字要在 `min` 和 `max` 之间，并且落在步长上；选择器初值必须是已有选项的 value；日期必须是有效的 `YYYY-MM-DD`。

`timer` 用 `duration` 设置时长，`checklist` 用任务列表的 `[x]` 标记设置初值，两者都不接受 `initial`。

### 4.4 一个变量，多个控件

同类控件可以绑定同一个变量，值会同步：

```markdown
<slider bind="people" label="人数" initial="2" min="1" max="20">
<number bind="people" label="精确人数" min="1" max="20" step="1">

当前人数：{{ people }}。
```

注意：

- 第二个控件不要再写 `initial`。
- 两个控件的数值范围、步长必须一致。
- 文本、数字、布尔、日期、选择等不同家族不能共用一个变量。
- 选择器共享变量时，选项的 value 和顺序必须完全一致。
- `timer`、`checklist`、`tabs`、`diagram`、`multi-select`、`steps` 的公开状态只能由一个组件拥有，不能共享。`range-slider` 与 `coordinate` 的槽位也独占；表格和图表只有在有序 `key` 完全一致时才能共享选择绑定。

### 4.5 不写 bind 的组件

不写 `bind` 时，组件拥有独立内部状态，正文不能读取它。控件仍然需要 `label`，因为 label 同时是它的可访问名称。

```markdown
<counter label="参与人数" initial="2" min="1" max="20">
```

如果之后需要在正文里显示计数值，再补上 `bind="count"`，用 `{{ count }}` 读取。

## 5. 常用输入控件

所有输入组件都支持 `label`、可选 `bind`、可选 `initial` 和动态 `disabled`。控件标签必填。

### 5.1 文本与数字

```markdown
<input bind="name" label="称呼" placeholder="怎么称呼你？">

<textarea bind="message" label="想法" placeholder="例如：一份可调参数的讲义" rows="4">

<number bind="quantity" label="数量" initial="3" min="1" max="20" step="1">

<slider bind="budget" label="预算档位" initial="50" min="0" max="100" step="10">
```

- `input` 默认 `type="text"`，也可以写 `type="email"`。
- `input` 支持 `required`、`min-length`、`max-length`。
- `textarea` 的初始文本写在 `initial` 里，行数用 `rows`。
- `number` 的 `step` 默认 1，`min` 和 `max` 可省略。
- `slider` 的默认范围是 0 到 100，步长默认 1。

### 5.2 开关与日期

```markdown
<toggle bind="annual" label="年度付款">

<checkbox bind="express" label="需要加急">

<date bind="appointment" label="计划日期" initial="2026-10-22">
```

`toggle` 和 `checkbox` 的值都是布尔值，区别主要是外观和使用场景。日期为空字符串时表示尚未选择。

### 5.3 选择器

`select`、`choices`、`radio-group` 的写法相同，只是外观不同：下拉框、选项卡片、单选按钮组。它们的正文由若干 `<option>` 组成。

```markdown
<choices bind="plan" label="方案">
<option value="basic">基础版</option>
<option value="pro">专业版</option>
</choices>
```

规则：

- `option` 必须写 `value`，且在同一组内唯一。
- `value` 是静态字符串，不能写插值。
- 选项正文是普通行内 Markdown，可以加粗，但不能放另一个交互组件。
- 不写 `initial` 时，默认选择第一项。

绑定后的值就是选中的 `value`，所以正文里通常这样判断（假设上面的 `plan` 已声明）：

```markdown
当前方案：**{{ plan == 'pro' ? '专业版' : '基础版' }}**。
```

### 5.4 组合一个小表单

```markdown
<panel title="填写方案">
<input bind="name" label="称呼">
<number bind="quantity" label="数量" initial="3" min="1" max="20">
<choices bind="plan" label="方案">
<option value="basic">基础版</option>
<option value="pro">专业版</option>
</choices>
<toggle bind="annual" label="年度付款">
</panel>

你好，**{{ name == '' ? '朋友' : name }}**。

预估费用：**{{ round(quantity * 80 * (plan == 'pro' ? 1 : 0.8) * (annual ? 0.8 : 1)) }} 元**。
```

这里用到了字符串比较、条件表达式和 `round`。`name` 的初值是空字符串，所以第一次打开时显示“朋友”。

### 5.5 输入约束与禁用

`required`、`min-length`、`max-length` 和 email 格式在首次失焦后显示提示，之后随输入更新。格式无效的文字会保留为编辑草稿，但不会替换最后一次合法的公开值。

`disabled` 可以动态控制：

```markdown
<toggle bind="locked" label="锁定人数">
<slider bind="people" label="人数" initial="2" min="1" max="20" disabled="{{ locked }}">
```

`locked` 为真时，滑块不接受读者输入。动态布尔属性必须是一个完整的 `{{ }}`。

## 6. 表达式：让文字跟着参数变

### 6.1 基本运算

`{{ }}` 里是表达式，不是 JavaScript。它支持：

| 类别 | 写法 |
| --- | --- |
| 数字、字符串、布尔、空值 | `2`、`'文本'`、`true`、`false`、`null` |
| 参数 | `people`、`annual` |
| 算术 | `+`、`-`、`*`、`/`、`%`、一元正负、括号 |
| 比较 | `==`、`!=`、`<`、`<=`、`>`、`>=` |
| 逻辑 | `!`、`&&`、`\|\|` |
| 条件 | `条件 ? 真值 : 假值` |
| 函数 | `round`、`min`、`max`、`sqrt`、`len` 等 |
| 常量 | `pi`、`e` |

例子（假设 `people`、`annual`、`price` 已在文档中声明）：

```markdown
{{ people * 100 }}
{{ people >= 5 ? '团队档' : '个人档' }}
{{ annual && people >= 3 }}
{{ round(price * 0.8 * 100) / 100 }}
```

注意：

- 乘法必须写 `*`。`2x` 在正文表达式里不是乘法。
- 幂用 `pow(x, 2)`，不能写 `x^2`。
- 字符串拼接也用 `+`，但两边必须都是字符串。
- 比较不做隐式类型转换。`'5' == 5` 不会得到 `true`。
- `if` 条件和逻辑运算需要真正的布尔值，不能拿数字代替。

### 6.2 字符串和条件

字符串可以用单引号或双引号，转义使用 `\\`、`\'`、`\"`、`\n`、`\t`。例子（假设 `name` 和 `annual` 已声明）：

```markdown
称呼：{{ name == '' ? '尚未填写' : name }}
付款方式：{{ annual ? '年度' : '月度' }}
```

条件表达式可以嵌套，但不要写得太深。可读性差时，把一部分内容拆到 `if` 容器里。

### 6.3 函数

数组索引与数字聚合、跨字段提示及本地表格生成见[条件、校验与本地集合](constraints-collections-ch.md)。其中的工作坊示例展示了如何在编辑过程中检查关联字段。

| 函数 | 作用 |
| --- | --- |
| `abs(x)` | 绝对值 |
| `sqrt(x)` | 平方根 |
| `floor(x)`、`ceil(x)`、`round(x)` | 向下、向上、四舍五入 |
| `min(a, b, ...)`、`max(a, b, ...)` | 最小、最大值 |
| `pow(base, exponent)` | 幂 |
| `sin`、`cos`、`tan`、`asin`、`acos`、`atan` | 三角函数，使用弧度 |
| `exp(x)`、`log(x)` | 指数和自然对数 |
| `len(value)` | 字符串的 Unicode 码点数或数组长度 |
| `contains(value, needle)` | 字符串子串或数组成员判断 |
| `clamp(value, lower, upper)` | 把值限制在闭区间内 |

`pi` 和 `e` 是常量。`log` 是自然对数；这与 LaTeX 里无下标的 `\log` 默认以 10 为底不同。

### 6.4 常见边界

- 数组不能直接显示。`checklist` 的值是数组，用 `len(done)` 取数量，用 `contains(done, ...)` 判断成员。
- `null` 显示为空字符串。
- 除零、定义域错误、非有限结果和类型错误会在对应内容附近显示“无法计算”，其他独立内容继续更新。
- 表达式没有赋值、方法调用、属性访问、自定义函数或导入。
- 表达式里不能读写 DOM，也不能发起网络请求。

在 GFM 表格中写逻辑或要转义竖线：

```markdown
<toggle bind="ready" label="准备完成">
<toggle bind="approved" label="审核通过">

| 状态 | 说明 |
| --- | --- |
| {{ ready \|\| approved ? '可用' : '不可用' }} | 表格中的 `\|\|` 表示逻辑或 |
```

### 6.5 一个四舍五入的例子

```markdown
<number bind="total" label="账单金额" initial="240" min="0">
<slider bind="people" label="分账人数" initial="3" min="1" max="12">
<slider bind="tip" label="额外费用（%）" initial="10" min="0" max="20">

每人支付 **{{ round(total * (1 + tip / 100) / people * 100) / 100 }} 元**。
```

`round` 只保留整数，再除以 100 就得到两位小数。末尾的零不会补齐，这是正常显示。

## 7. 条件与内容组织

### 7.1 用 if 控制显示

```markdown
<slider bind="people" label="人数" initial="2" min="1" max="20">

<if when="{{ people >= 5 }}">
<alert tone="success" title="团队方案">
人数达到 5 人，可以继续比较付款方式。
</alert>
</if>
```

`when` 必须是完整的布尔插值。下面两种写法都不对：

```markdown
<!-- 错误：数字不是布尔值 -->
<if when="{{ people }}">

<!-- 错误：不是完整插值 -->
<if when="人数 {{ people }} 人">
```

条件为假时内容不显示，但内部参数仍会初始化；隐藏分支里的未知变量或类型错误仍然是编译错误。条件区域重新显示时，已有输入状态会保留。

### 7.2 panel、card 和 grid

- `<panel>`：包住一组参数，默认提供“恢复默认”。适合表单。
- `<card>`：一块内容卡片，适合独立说明。
- `<grid>`：并排布局，直接子项必须是 `<card>`，默认两列。

```markdown
<grid columns="2">
<card title="基础版">
适合个人与小型项目。
</card>

<card title="专业版">
适合需要协作的团队。
</card>
</grid>
```

窄屏会自动变成单列。`columns` 取 1 到 4。

### 7.3 tabs 和 accordion

```markdown
<tabs label="方案说明">
<tab label="功能比较">
| 能力 | 基础版 | 专业版 |
| --- | --- | --- |
| 参数调整 | 支持 | 支持 |
| 图表 | 不支持 | 支持 |
</tab>

<tab label="选购建议">
先确定用途，再比较付款周期。
</tab>
</tabs>

<accordion label="常见问题">
<disclosure label="费用如何计算？">
年度付款按八折计算。
</disclosure>

<disclosure label="可以随时切换吗？">
可以，切换上方开关即可。
</disclosure>
</accordion>
```

- `tab` 的 `label` 必填；不写 `value` 时会自动生成内部值。
- `accordion` 的直接子项是 `disclosure`，多个条目可以同时展开。
- `disclosure` 可以写 `open` 让它初始展开。

标签页切换会保留子内容状态；隐藏区域里的计时器会暂停，恢复显示后仍保持暂停，由读者再次启动。

### 7.4 alert、badge 和 tooltip

```markdown
<alert title="提示">
普通信息提示。
</alert>

<alert tone="warning" title="注意">
面板重置会恢复它内部的全部参数。
</alert>

当前状态：<badge tone="success">已就绪</badge>

把鼠标移到 <tooltip text="输入改变后，相关内容自动更新。">响应式绑定</tooltip> 上查看说明。
```

`alert` 的 `tone` 可选 `info`、`success`、`warning`。`badge` 的 `tone` 可选 `neutral`、`success`、`warning`。`badge` 和 `tooltip` 是行内组件，可以嵌在句子里。

本预览还增加 `jump`、`anchor`、`text`、`section` 用于跳转和受控正文颜色，`multi-select`、`range-slider`、`coordinate` 用于输入，`quiz`、`steps`、`step` 用于练习和分步阅读，`computed`/`const` 用于命名值，`validation` 用于跨字段提示，`data-table`/`column` 用于生成表格行。规则见[扩展说明](local-components-v2-ch.md)、[计算说明](computations-formatting-ch.md)和[集合说明](constraints-collections-ch.md)。

## 8. 清单、进度、计时与时间轴

### 8.1 可勾选清单

```markdown
<checklist bind="done" label="体验清单">
- [x] 读懂示例
- [ ] 调整参数
- [ ] 在窄屏试用
</checklist>

已完成 **{{ len(done) }} / 3** 项。

<progress label="完成进度" value="{{ len(done) / 3 * 100 }}">
```

- `checklist` 的正文必须是非空、单层 Markdown 任务列表。
- `[x]` 是初始勾选状态，重置时恢复到这里。
- 公开值是已选条目的内部 ID 数组，通常用 `len` 取数量。
- `progress` 的 `value` 必须在 0 到 `max` 之间；越界会报诊断，不会悄悄截断。

### 8.2 计时器

```markdown
<timer label="一分钟专注" duration="60">

<timer bind="remaining" label="可读取的倒计时" duration="90">

剩余秒数：{{ remaining }}。
```

`duration` 是正整数秒，默认 60。计时器自带开始、暂停和重置，到零停止。不需要 `initial`。

### 8.3 时间轴

```markdown
<timeline title="半天计划" unit="分钟">
| 事项 | 开始 | 时长 | 说明 |
| --- | ---: | ---: | --- |
| 准备 | 0 | 10 | 列出材料 |
| 写作 | 10 | 25 | 完成主体 |
| 检查 | 35 | 10 | 留出复核时间 |
</timeline>
```

表头必须包含 `事项`、`开始`、`时长`（可选 `说明`），或使用 `Task`、`Start`、`Duration`（可选 `Notes`）。开始时间和时长是非负数，允许区间重叠。按开始时间稳定排序。

## 9. 表格与图表

### 9.1 普通表格和增强表格

普通 Markdown 表格继续作为静态内容：

```markdown
| 方案 | 价格 |
| --- | ---: |
| 基础版 | 100 |
| 专业版 | 200 |
```

把它放进 `<table>` 后，会自动获得搜索、排序和分页：

```markdown
<table label="组件目录" page-size="3">
| 名称 | 分类 | 用途 |
| --- | --- | --- |
| slider | 参数 | 调整数字 |
| toggle | 参数 | 开关 |
| chart | 视觉 | 表格变图表 |
| diagram | 视觉 | 点击节点查看说明 |
</table>
```

`table` 支持 `searchable`、`sortable`、`page-size`。搜索和排序只影响表格内部；面板重置会一并恢复查询、排序和页码。

### 9.2 用表格生成图表

`chart` 的正文是一张 Markdown 表格：

```markdown
<chart kind="bar" title="费用比较" y-label="元">
| 项目 | 实际 | 预算 |
| --- | ---: | ---: |
| 内容 | 120 | 150 |
| 视觉 | 230 | 200 |
</chart>
```

第一列通常作为横轴标签，其余列是数值系列。系列名称直接取表头，图例自动生成。

图表数值可以跟随参数变化，但单元格必须是纯数值，或者是一个只包含插值的完整单元格：

```markdown
<slider bind="people" label="人数" initial="2" min="1" max="20">

<chart title="按人数比较">
| 方案 | 每月费用 |
| --- | ---: |
| 基础版 | {{ people * 20 }} |
| 专业版 | {{ people * 35 }} |
</chart>
```

下面这种写法是错的：

```markdown
| 内容 | 20 元 |
```

`20 元` 是混合文本，不能当作数值列。要么只写 `20`，要么把单位放到表头或图表标签里。

### 9.3 图表类型怎么选

| `kind` | 适合的数据 |
| --- | --- |
| `bar` | 分类之间的比较，默认类型 |
| `line` | 按顺序变化的趋势 |
| `area` | 强调累计或范围趋势 |
| `scatter` | 两组数值的关系 |
| `donut` | 各部分占整体的比例 |

规则简述：

- `bar`、`line`、`area`：第一列是横轴，其余列是数值系列。
- `scatter`：默认第一列是数值横轴，其余是数值纵轴；也可以用 `x`、`y` 指定表头名称。
- `donut`：第一列是标签，第二列是数值；多于两列时必须用 `y` 指定唯一数值列。
- `donut` 的数值必须非负，总和为零时显示“暂无占比”。

`x` 和 `y` 都是静态表头名称。`y` 可以用逗号分隔多个列名，因此列名本身不能包含逗号。

### 9.4 数据规则

- 表头非空且唯一，每行列数一致。
- 单元格可以写插值。
- 纯十进制或科学计数法文本会被读为数值。
- 空行、非数值、缺失列等错误会定位到对应单元格。
- 图表不接受远程 URL、`data` 属性或接口数据；数据必须写在文档里。

## 10. 图解与函数曲线

### 10.1 交互图解

```markdown
<diagram bind="selected" initial="input" label="状态流">
<node id="input" label="输入">
读者通过控件改变参数。
</node>

<node id="view" label="显示">
正文和图表随结果更新。
</node>

<edge from="input" to="view" label="触发更新">
</diagram>

当前环节：{{ selected == 'input' ? '输入' : '显示' }}。
```

- `diagram` 的正文只能包含 `node`、`edge` 和空白。
- `node` 必须写 `id` 和 `label`，正文是静态 Markdown 说明。
- `edge` 写 `from` 和 `to`，两端必须存在，可以加 `label`。
- 节点自动布局，不需要坐标；`direction="down"` 可以改为纵向。
- `initial` 必须是已有节点的 id；不写时默认选中第一个节点。
- 有 `bind` 时公开选中节点 id；无 `bind` 时选择保留在组件内部。

### 10.2 用 LaTeX 画函数曲线

```markdown
<slider bind="a" label="振幅" initial="1" min="0" max="3" step="0.5">

<plot min="-6" max="6" label="正弦曲线" x-label="x" y-label="位移">
$$ y = a \sin x $$
</plot>
```

- `plot` 正文只能有空白和独立公式块。
- 每个 `$$ ... $$` 块定义一条曲线。
- 每块必须写成 `y = 表达式`，只计算显式实函数 y(x)。
- 多条曲线用多个公式块，不要把普通换行当分隔符。

```markdown
<plot min="-5" max="5" label="两条曲线">
$$ y = x^2 $$
$$ y = 2x + 1 $$
</plot>
```

`min` 和 `max` 可以动态，例如 `max="{{ t }}"`；`samples` 是静态整数，范围 2 到 2000；纵轴根据当前范围内的采样值自动确定。

### 10.3 参数名怎么对应

LaTeX 里的参数名映射到文档中的 `bind`：

| 写法 | 对应参数 |
| --- | --- |
| `a`、`f`、`t` | 同名 `bind="a"`、`bind="f"`、`bind="t"` |
| `abx` | `a × b × x` |
| `\mathrm{amplitude}` | `bind="amplitude"` |
| `\alpha`、`\beta`、`\theta` | 同名英文 bind |
| `\pi` | 固定圆周率，不是参数 |
| `x` | 绘图自变量 |
| `y` | 输出标记 |

`x` 和 `y` 不能绑定到控件。多字母参数必须用 `\mathrm{名称}`，命令内部不能有空格或插值。

### 10.4 可计算的 LaTeX 和常见误区

支持的常见写法包括四则运算、隐式乘法、幂、分数、根式、括号、三角与反三角函数、指数对数、绝对值、`min`/`max`、常量和分段函数。

```markdown
<plot min="0" max="10" label="分段函数">
$$
y = \begin{cases}
x, & x < 5 \\
10 - x, & x \ge 5
\end{cases}
$$
</plot>
```

注意：

- LaTeX 里可以写隐式乘法，例如 `2x`、`a\sin x`、`(x+1)(x-1)`。
- 在正文表达式中必须写 `*`，这是两套不同的书写规则。
- `\sin 2x` 表示 `sin(2x)`；复杂参数建议加括号。
- `-x^2` 表示 `-(x^2)`。
- `1/2x` 按 `(1/2)x` 解释，建议用 `\frac` 写清分母。
- `\log x` 默认以 10 为底，`\ln x` 是自然对数；正文表达式的 `log` 是自然对数。
- 积分、导数、求和、矩阵、参数曲线、隐式方程和自定义宏不在首版可计算范围内。排版上能显示，不代表能求值。
- `plot` 里不要写 `{{ }}`，参数直接使用映射后的数学名称。

## 11. 常见错误速查

| 现象或诊断 | 常见原因 | 改法 |
| --- | --- | --- |
| 未知组件 `slidr` 警告，局部显示源码 | 标签拼写错误 | 改成 `slider`；其他内容仍可使用 |
| 缺少 `</card>` | 成对标签没有闭合 | 补上结束标签，并检查嵌套顺序 |
| 引用 `seat` 未声明 | `bind` 名称拼写不一致 | 统一成 `seats` |
| `initial` 重复 | 同一个参数在两个控件上都写了初值 | 只保留一处 |
| 初值超出范围 | `initial="12"` 但 `max="10"` | 调整初值或范围 |
| `if` 条件类型错误 | `when="{{ seats }}"` 得到数字 | 改成 `when="{{ seats >= 5 }}"` |
| `on-click` 不属于组件 | 试图写事件处理器 | 删除事件属性，使用组件自带交互 |
| HTML 标签显示为源码或报告结构错误 | 写了未知标签或缺少结束标签 | 改用 Markdown 或对应组件，并检查闭合 |
| 脚注引用显示原文 | 找不到对应定义 | 检查 `[^note]` 与 `[^note]: 内容` 的标识符 |
| 图表出现“20 元”错误 | 数值列混入文本 | 只写数字，单位放表头 |
| `edge` 指向不存在的节点 | `to` 的 id 拼错 | 统一节点 id |
| 绘图提示不支持积分 | 公式超出首版计算范围 | 换成支持的函数，或只排版不绘图 |
| 表格里的 `\|\|` 出错 | GFM 表格把竖线当成列分隔 | 写成 `\|\|` |
| `sum` 等绑定被拒绝 | 该名称是新增保留函数名 | 重命名绑定并同步修改引用 |
| 两个 anchor 或跳转目标冲突 | 显式 ID 重复或与标题锚点冲突 | 使用唯一的 `anchor.id` 与匹配的 `jump.to` |
| 生成表格提示缺少列 | `data-table` 至少需要一个 `column` | 添加带静态 label 和 value 表达式的 `column` |
| 标签被当成文字显示 | 位于代码围栏或反斜杠转义后 | 这是正常的原文显示 |
| `textarea` 正文不生效 | `textarea` 是无正文组件 | 用 `initial="..."` 设置文本 |
| 成对组件写成 `/>` | `<card ... />` 不会自动闭合 | 改成开始标签加结束标签 |

### 11.1 怎样看诊断

诊断会给出源码位置、严重程度、类别和简短说明，常见的有标签结构、未知语法、绑定、初值、类型、约束、表格、图解和数学问题。

Playground 的左侧编辑器和右侧诊断区会同时定位问题。未知标签的降级警告保留原文，其他内容与交互继续工作；未知区域内的控件不会建立绑定。组件标签未闭合、已知组件的非法属性、表达式或绑定错误、资源上限等仍会阻止编译并停用交互。运行时的局部计算错误只影响对应内容，其他部分继续更新。

调试时先修第一条错误。后面的报错有时只是第一条错误造成的连锁反应。

### 11.2 怎样显示字面量

要在正文中显示 `{{`，写成 `\{{`；要显示标签示例，用反斜杠或行内代码：

```markdown
这里显示一个字面量：\{{ people }}。

行内代码最稳妥：`<slider bind="x" label="示例">`。
```

代码围栏里的内容全部按原文显示，不会生成控件，也不会求值。

## 12. 完整练习：工作坊报名页

把下面这份文档粘贴到 Playground，尝试修改文案和参数，再对照后面的自检清单。

```markdown
# 周末摄影工作坊

<panel title="报名方案">
<slider bind="people" label="人数" initial="4" min="1" max="12">
<toggle bind="annual" label="会员折扣">
<choices bind="track" label="课程方向">
<option value="portrait">人像</option>
<option value="landscape">风光</option>
</choices>
</panel>

课程方向：**{{ track == 'portrait' ? '人像' : '风光' }}**。

每人费用：**{{ annual ? 240 : 300 }} 元**。

合计：**{{ people * (annual ? 240 : 300) }} 元**。

<if when="{{ people >= 6 }}">
<alert tone="success" title="团体安排">
人数达到 6 人，我们会单独联系确认场地。
</alert>
</if>

<chart title="两种方案的预算对比" y-label="元">
| 项目 | 基础 | 完整 |
| --- | ---: | ---: |
| 课程 | {{ people * 300 }} | {{ people * 380 }} |
</chart>

<checklist bind="prepared" label="行前准备">
- [ ] 确认日期
- [ ] 准备器材
- [ ] 查看天气
</checklist>

<progress label="准备进度" value="{{ len(prepared) / 3 * 100 }}">
```

这份文档覆盖了：

- 面板内三个不同类型的参数
- 文本中的条件表达式和算术
- `if` 条件区域
- 由参数驱动的图表数据
- 清单、进度和面板重置

### 12.1 写完一份文档后的自检清单

1. 每个输入控件都有 `label`。
2. 正文引用的每个参数都能在某个控件上找到对应的 `bind`。
3. 同一个参数只有一处显式 `initial`，并且初值在允许范围内。
4. 所有 `if` 条件都是布尔表达式。
5. 图表的数值列没有单位，也没有混合文本。
6. 成对标签都正确闭合，没有把容器写成自闭合。
7. 代码示例都放在代码围栏里。
8. 在窄屏宽度下检查布局，用键盘检查按钮、选项和提示。
9. 点击面板的“恢复默认”，确认参数和组件状态一起恢复。
10. 文档不依赖网络请求、外部数据或事件处理器。

## 13. 下一步

- 想先看成品：打开 [示例目录](../examples/local/README.md)，从计数器、方案计算器和交互图解开始。
- 想了解全部组件和边界：阅读 [本地交互语法规范](local-interaction-syntax-ch.md)。
- 想嵌入自己的 React 应用：阅读 [本地模式集成](local-integration-ch.md)。
- 想看错误示例：打开 [diagnostics.reactive.md](../examples/local/diagnostics.reactive.md)，对照诊断理解常见问题。
- 想启动 Playground：在仓库根目录执行 `npm run dev`，或访问线上演示 [yaozi.raricy.com](https://yaozi.raricy.com/)。

## 附录 A：组件速查

| 用途 | 组件 |
| --- | --- |
| 参数输入 | `input`、`textarea`、`number`、`slider`、`range-slider`、`coordinate`、`toggle`、`checkbox`、`date`、`select`、`choices`、`radio-group`、`multi-select`、`option` |
| 自带操作 | `counter`、`timer`、`checklist`、`progress` |
| 组织内容 | `panel`、`card`、`grid`、`tabs`、`tab`、`accordion`、`disclosure`、`if` |
| 跳转与正文 | `jump`、`anchor`、`text`、`section` |
| 练习与分步 | `quiz`、`steps`、`step` |
| 提示 | `alert`、`badge`、`tooltip` |
| 声明与生成数据 | `computed`、`const`、`validation`、`data-table`、`column` |
| 可视化 | `table`、`chart`、`plot`、`timeline`、`diagram`、`node`、`edge` |

其中 `option`、`tab`、`disclosure`、`node`、`edge`、`step`、`column` 是父组件的结构子项，不能单独放在任意位置。`computed`、`const`、`validation` 是文档声明，不是可见控件。

大多数文章只需要 Markdown，加上两三个输入组件和一个展示组件。先把参数和正文连接起来，再按需要引入图表、图解和 LaTeX 曲线。


新增组块、颜色、槽位状态与迁移规则见[local-draft-2 扩展说明](local-components-v2-ch.md)，升级清单见[0.4.0 发布与迁移](release-0.4.0-ch.md)。`0.4.0` 是 `next` 渠道的预览版。
