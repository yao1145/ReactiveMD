# Reactive MD 新用户指南

在 Markdown 中加入控件，正文、计算结果和图表就会随读者的操作更新。打开[在线 Playground](https://yaozi.raricy.com/)，把示例粘贴到编辑器，在预览中直接试用。

本文对应当前工作区，语法修订为 `local-draft-3`。每一节先给一份可运行的示例，再解释其中的写法；文末汇总全部组块。

## 1. 第一份交互文档

```markdown
# 费用估算

<panel title="调整方案">
<slider bind="people" label="人数" initial="2" min="1" max="20">
<toggle bind="annual" label="按年付费">
</panel>

人数：**{{ people }}**。

每月费用：**{{ people * (annual ? 80 : 100) }} 元**。
```

把整段粘贴到 Playground。拖动滑块或开启按年付费，正文中的数值会立即更新。面板的“恢复默认”会把控件恢复到初始值。

这份文档只有两条连接规则：

- `bind="people"` 给控件命名，`initial="2"` 设置初值。
- `{{ people }}` 读取这个名称，`people * 100` 这样的表达式用它计算。

`annual ? 80 : 100` 是条件表达式：开关打开时取 80，否则取 100。`<toggle>` 省略 `initial` 时默认关闭。

试着改三处：

1. 把 `initial="2"` 改成 `initial="6"`，预览的初值随之改变。
2. 把 `max="20"` 改成 `max="50"`，滑块可以拖到更远。
3. 把 `label="人数"` 改成 `label="参与人数"`，只改显示文字，绑定名称不变。

## 2. 标签与参数

组件用类似 HTML 的标签写在 Markdown 中。标签名和属性名使用小写，属性值加引号，属性顺序不影响结果。

```markdown
<panel title="报名">
<slider bind="people" label="人数" initial="2" min="1" max="20">
<number bind="people" label="精确人数" min="1" max="20" step="1">
</panel>

当前人数：{{ people }}。
```

上面的滑块和数字框共享同一个参数 `people`。拖动滑块时数字框同步变化，修改数字框时滑块也会移动。

标签有两种形态：

| 形态 | 例子 | 规则 |
| --- | --- | --- |
| 无正文组件 | `<slider bind="people" label="人数">` | 不写结束标签 |
| 有正文容器 | `<panel title="报名">...</panel>` | 必须写结束标签，可以嵌套 |

输入控件都需要 `label`。需要读取控件的值时加 `bind`；控件不需要被正文或其他组件读取时，可以省略 `bind`，例如 `<timer label="专注计时" duration="60">` 仍然可以独立使用。

参数名由英文字母、数字和下划线组成，以字母或下划线开头，区分大小写。`x`、`y`、`pi`、`e` 和内置函数名是保留名称。中文显示文字放在 `label` 中。

多个控件共享参数时，类型必须相同。数字控件的 `min`、`max` 和 `step` 要一致，同一个参数只写一次显式 `initial`。

## 3. 常量、变量与数组

文档中的数据有三种来源：

- **变量**：由控件的 `bind` 产生，读者可以修改。
- **常量**：用 `<const>` 声明固定值，读者不能修改。
- **计算值**：用 `<computed>` 声明，由变量、常量和公式计算得到。

变量的类型由控件决定：文本控件产生字符串，数字控件产生数字，开关产生布尔值，多选产生数组。

```markdown
<const name="unitPrice" value="{{ 80 }}">
<computed name="total" value="{{ people * unitPrice }}">

<slider bind="people" label="人数" initial="3" min="1" max="20">

人数：**{{ people }}**，合计：**{{ total }}** 元。
```

`const` 和 `computed` 都是不可见声明，各占文档顶层的一行，不需要结束标签。两者都必须写 `name` 和完整的 `value="{{ 表达式 }}"`。

- `const` 适合固定单价、活动日期、阈值等不随读者变化的值。它只能读取其他常量和 `pi` 等内置常量。
- `computed` 适合保存中间结果。它可以读取控件、常量和其他计算值，正文、图表和条件都能复用。
- 声明可以先引用后声明，名称不能与控件或其他声明重复。

数组用来保存一组值。多选控件和清单控件会产生字符串数组，也可以用数组字面量声明数字数组。

```markdown
<const name="fees" value="{{ [100, 20, 5] }}">
<multi-select bind="topics" label="主题">
<option value="math">数学</option>
<option value="physics">物理</option>
<option value="chemistry">化学</option>
</multi-select>

第一项费用：{{ fees[0] }}
费用合计：{{ sum(fees) }}
已选主题：{{ len(topics) }} 项
```

数组的索引从 0 开始，`fees[0]` 是第一项。负索引和超出范围的整数返回 `null`。`len` 返回数组长度或字符串长度，`sum`、`average`、`minOf`、`maxOf` 用于数字数组，`contains` 检查数组是否包含某个值。

数组不能直接写进 `{{ }}` 显示，需要用 `len`、索引或聚合函数转换。数组中只能放同一种类型的值：全部是数字，或全部是字符串。

## 4. 计算表达式

`{{ }}` 中可以写表达式。这门表达式语言只做本地计算，不执行 JavaScript，也不发起网络请求。

```markdown
<slider bind="people" label="人数" initial="2" min="1" max="20">
<toggle bind="annual" label="按年付费">

每人每月：**{{ annual ? 80 : 100 }} 元**
每月合计：**{{ people * (annual ? 80 : 100) }} 元**
全年合计：**{{ people * (annual ? 80 : 100) * 12 }} 元**
```

常用的表达式写法：

| 类别 | 写法 | 例子 |
| --- | --- | --- |
| 数字和字符串 | 数字、单引号或双引号字符串 | `2`、`0.5`、`'基础版'` |
| 算术 | `+ - * / %` | `people * 100` |
| 比较 | `== != < <= > >=` | `people >= 5` |
| 逻辑 | `! && \|\|` | `people > 0 && people < 10` |
| 条件 | `条件 ? 成立时的值 : 否则的值` | `annual ? 80 : 100` |
| 函数 | 数学、字符串、日期和格式化函数 | `round(2.6)`、`len(topics)` |

几条规则：

- 乘法必须写 `*`，`2x` 不会被当成乘法。
- 条件必须是布尔值。不要写 `0 < people < 10`，要写 `people > 0 && people < 10`。
- `+` 只能同时加两个数字或连接两个字符串，不会自动转换类型。
- 比较不会把字符串和数字互相转换。

常用函数可以直接在正文中使用：

```markdown
四舍五入：{{ round(2.6) }}
较小值：{{ min(3, 8) }}
格式化金额：{{ formatCurrency(1234.5, 'CNY', 2, 'zh-CN') }}
```

`formatCurrency` 的参数依次是数值、货币代码、小数位和地区。`formatNumber`、`formatPercent`、`formatScientific` 的写法类似。

除零、类型错误或结果不是有限数字时，对应位置显示“无法计算”，其他内容继续更新。在 Markdown 表格中写逻辑或 `||` 时，要转义为 `\|\|`。

## 5. 输入控件

按读者要输入的数据类型选择控件：

| 需要 | 控件 | 参数值 |
| --- | --- | --- |
| 短文本或多行文本 | `input`、`textarea` | 字符串 |
| 精确数字、滑动调节或加减 | `number`、`slider`、`counter` | 数字 |
| 开关或勾选 | `toggle`、`checkbox` | 布尔值 |
| 日期 | `date` | `YYYY-MM-DD` 字符串，或空字符串 |
| 单选 | `select`、`choices`、`radio-group` | 已选选项的字符串值 |
| 多选 | `multi-select` | 已选值组成的数组 |

```markdown
<input bind="name" label="姓名" placeholder="怎么称呼你？">
<textarea bind="notes" label="备注" initial="带上相机" rows="3">
<date bind="day" label="活动日期" initial="2026-10-26">
<number bind="quantity" label="数量" initial="3" min="1" max="20">
<toggle bind="gift" label="需要礼盒">
<choices bind="plan" label="方案">
<option value="basic">基础版</option>
<option value="pro">专业版</option>
</choices>

你好，{{ name == '' ? '访客' : name }}。
你选择的是 {{ plan == 'basic' ? '基础版' : '专业版' }} 方案，共 {{ quantity }} 件，日期 {{ day }}。
```

省略 `initial` 时，各组件的默认值不同：

- `input`、`textarea` 为空字符串，`date` 为空字符串表示尚未选择。
- `number`、`counter` 使用范围内最接近 0 的合法值；`slider` 默认取 `min`。
- `toggle`、`checkbox` 为 `false`。
- `select`、`choices`、`radio-group` 默认选中第一项。

`number` 和 `slider` 用 `min`、`max`、`step` 限制范围和步长。`counter` 自带减、加和恢复初值按钮。`textarea` 的文字写在 `initial` 中，没有标签正文。

`option` 的 `value` 是公开给表达式的值，标签文字只负责显示。可以用 `initial` 指定默认选项的 `value`。

`multi-select` 的 `label` 必填，`max-selected` 限制最多选择几项。`checklist` 用 `[ ]` 和 `[x]` 标记初始状态，公开值是已勾选条目的数组。

需要区间时用 `range-slider`，需要二维坐标时用 `coordinate`。它们分别用 `bind-start`/`bind-end` 和 `bind-x`/`bind-y` 公开两个数字。

## 6. 图表与函数

### 图表

图表读取 Markdown 表格。第一列写标签，数值单元格写纯数字或完整的 `{{ 表达式 }}`。

```markdown
<slider bind="people" label="人数" initial="2" min="1" max="20">

<chart kind="bar" title="每月费用" y-label="元">
| 方案 | 费用 |
| --- | ---: |
| 基础版 | {{ people * 20 }} |
| 专业版 | {{ people * 35 }} |
</chart>
```

`kind` 默认为 `bar`，还支持 `line`、`area`、`scatter` 和 `donut`。单位放在 `y-label` 或表头中，单元格只写数字。

图表会自动更新。需要搜索、排序和分页时，把同样的 Markdown 表格放进 `<table label="目录">...</table>`。

### 函数曲线

函数曲线使用 LaTeX。每个 `$$...$$` 公式块定义一条 `y = 表达式` 曲线。

```markdown
<slider bind="a" label="振幅" initial="1" min="0" max="3" step="0.5">

<plot min="-6" max="6" label="正弦曲线">
$$ y = a \sin x $$
</plot>
```

公式中的参数直接使用数学名称，不写 `{{ }}`。单个字母对应同名 `bind`，例如 `a` 对应 `bind="a"`。多字母参数写成 `\mathrm{amplitude}`，对应 `bind="amplitude"`。

`x` 是绘图自变量，`y` 是输出标记，两者不能绑定到控件。`plot` 的 `min` 和 `max` 控制横轴范围。

## 7. 模块化布局

内容变多时，用容器分区。容器只负责组织内容，绑定和表达式规则不变。

### tabs 与 tab

```markdown
<tabs label="查看说明">
<tab label="怎么用">
拖动滑块，结果会立即更新。
</tab>
<tab label="计费规则">
按年付费时每人每月 80 元，否则 100 元。
</tab>
</tabs>
```

`tabs` 把内容分成多个页面，默认显示第一项。`tabs` 的 `label` 可选；需要读取当前页面时加 `bind`。`tab` 的 `label` 必填，`value` 可省略；省略时按顺序生成 `tab-1`、`tab-2`。切换页面会保留各页内部的状态。

### grid 与 card

```markdown
<slider bind="people" label="人数" initial="4" min="1" max="12">

<grid columns="2">
<card title="每月费用">
**{{ people * 100 }} 元**
</card>
<card title="全年费用">
**{{ people * 100 * 12 }} 元**
</card>
</grid>
```

`grid` 把卡片排成网格，`columns` 是最大列数，取 1 到 4，容器变窄时会自动减少列数。`grid` 的直接子项必须是 `card`。

`card` 是一块内容卡片，`title` 可选，正文继续使用 Markdown。

### panel

```markdown
<panel title="费用参数">
<slider bind="people" label="人数" initial="2" min="1" max="20">
<toggle bind="annual" label="按年付费">
</panel>

每月费用：**{{ people * (annual ? 80 : 100) }} 元**。
```

`panel` 把相关控件放在一起，并提供“恢复默认”按钮。重置只作用于面板内部；嵌套面板时，内层重置只影响内层，外层重置包含整个子树。设置 `reset="false"` 可以隐藏重置按钮。

### div 与 align

```markdown
<div align="center">

**周末摄影工作坊**

<badge tone="success">报名中</badge>

</div>
```

`<div align="center">` 把内部内容居中。`align` 还接受 `left`、`right` 和 `justify`，大小写不敏感，并忽略首尾空白。`div` 内部的 Markdown、插值和控件继续生效，嵌套元素可以设置自己的对齐。

`p` 和 `h1` 至 `h6` 也支持同样的静态 `align` 属性：

```markdown
<p align="right">右对齐的 **Markdown** 段落。</p>
```

这些对齐在默认模式下直接可用，不需要开启 CSS 或扩展 HTML。对齐使用 `align` 属性；`style` 和事件属性不会执行。

## 8. 高级功能

### if 与 alert

```markdown
<number bind="people" label="人数" initial="3" min="1" max="30">

<if when="{{ people >= 5 }}">
<alert tone="success" title="团体优惠">
人数达到 5 人，可以申请团体价格。
</alert>
</if>
```

`if` 的 `when` 必须是完整的布尔插值，写成 `when="{{ people >= 5 }}"`。条件为真时显示内部内容，为假时隐藏。

`alert` 是一块提示，`tone` 可取 `info`、`success` 或 `warning`，默认 `info`。`title` 可选，正文继续使用 Markdown。

### accordion 与 disclosure

```markdown
<accordion label="常见问题">
<disclosure label="可以退款吗？" open>
活动开始前 7 天可免费取消。
</disclosure>
<disclosure label="需要带什么？">
带上笔记本电脑和充电器。
</disclosure>
</accordion>
```

`accordion` 是一组可以展开的条目，适合常见问题和补充说明。它包含一个或多个 `disclosure`，`label` 可选。

`disclosure` 的 `label` 必填。默认收起，加上 `open` 后初始展开。多个条目可以同时打开，条目内部可以继续写 Markdown 和组件。

### anchor 与 jump

```markdown
<jump to="details" appearance="button">查看细节</jump>

<anchor id="details">

## 细节

这里是跳转目标。
```

`jump` 创建行内跳转，`to` 写目标名称，不带前导 `#`。`appearance` 可取 `link` 或 `button`，默认 `link`。

`anchor` 标记一个显式跳转目标，`id` 必填，在文档内唯一。`jump` 也可以指向标题自动生成的锚点，例如 `## 细节` 对应 `to="细节"`；标题重复时会自动加后缀，显式 `anchor` 的名称更容易控制。目标不存在或 ID 重复会产生编译错误。

## 9. 其它功能

### color

```markdown
<slider bind="people" label="人数" initial="4" min="1" max="10" color="#2563eb">

<section color="#45536f">
当前 **{{ people }}** 人，<text color="#a2273a">**请确认场地容量**</text>。
</section>
```

`color` 可以给 `slider`、`toggle`、`checkbox`、`select`、`choices`、`radio-group`、`checklist` 等交互控件设置强调色，`jump`、`badge` 和 `progress` 也接受 `color`。`section` 设置整段文字颜色，`text` 设置行内文字颜色，内层颜色会覆盖外层。

颜色写静态颜色名或 `#RGB`、`#RRGGBB`。它不接受表达式、CSS 函数或变量。

### badge

```markdown
<slider bind="people" label="人数" initial="4" min="1" max="10">

当前 <badge>{{ people }} 人</badge>，<badge tone="{{ people >= 8 ? 'warning' : 'success' }}">{{ people >= 8 ? '需要更大场地' : '场地合适' }}</badge>。
```

`badge` 是行内标签，适合状态和简短标记。`tone` 可取 `neutral`、`success` 或 `warning`，默认 `neutral`。`tone` 可以是静态值，也可以根据条件动态设置。

### tooltip

```markdown
<slider bind="people" label="人数" initial="4" min="1" max="10">

人数达到 <tooltip text="8 人以上会提示场地容量。">8 人</tooltip> 时，请确认场地。
```

`tooltip` 是行内说明，`text` 必填。读者用指针悬停或键盘聚焦时可以看到说明，适合补充一个短语或名称。

## 常见错误

| 现象 | 原因与修改 |
| --- | --- |
| 引用了未声明参数 | 检查表达式与 `bind`、`const`、`computed` 名称的拼写和大小写。 |
| 同名参数写了两次 `initial` | 同一共享参数只保留一个显式初值。 |
| 数字初值无效 | 确认初值在 `min` / `max` 内，并符合 `step`。 |
| `if` 条件不生效 | 写成 `when="{{ people >= 5 }}"` 这样的完整布尔插值。 |
| 图表数值列报错 | 单元格写纯数字或完整插值，单位移到 `y-label` 或表头。 |
| 数组显示为空白或报错 | 不要直接写 `{{ topics }}`，改用 `len`、索引或 `sum` 等聚合函数。 |
| 容器内容跑到外面 | 检查结束标签和嵌套顺序，容器必须显式闭合。 |
| 标签或插值显示为原文 | 检查是否写在代码中或被转义；未知标签会产生降级警告。 |
| 表格中的逻辑或破坏了分列 | 在 Markdown 表格单元格内将竖线转义为 `\|\|`。 |
| 绘图拒绝公式 | 检查 LaTeX 是否在可计算范围内，多字母参数写成 `\mathrm{name}`。 |
| 计算结果显示“无法计算” | 检查除零、类型不匹配或非有限结果；其他内容仍会正常更新。 |
| 声明没有生效 | 把 `const`、`computed` 放到文档顶层，并确认名称没有与控件重复。 |

先修复第一条诊断，再看后续问题。编译错误会阻止预览；未知标签的警告会保留相关源码；运行时计算出错只影响对应内容。

展示标签与表达式原文时，使用行内代码或代码围栏。正文中需要字面插值时写 `\{{ people }}`。

## 组块全集

下面按用途列出 `local-draft-3` 的全部 49 个标签。“形态”一列说明写法：无正文组件不写结束标签，容器必须显式闭合，行内组件可以放进句子，子项只能出现在指定父容器内，声明不渲染为界面。

多数交互控件都支持 `label`、可选 `bind`、可选 `initial` 和动态 `disabled`。表中只列出常用的关键属性。

### 输入与选择

| 标签 | 形态 | 主要属性 | 用途 |
| --- | --- | --- | --- |
| `input` | 无正文 | `label`、`bind`、`initial`、`type=text/email`、`placeholder`、`required`、`min-length`、`max-length` | 单行文本；值为字符串 |
| `textarea` | 无正文 | `label`、`bind`、`initial`、`placeholder`、`rows=4`、`required`、`min-length`、`max-length` | 多行文本；正文写在 `initial` |
| `number` | 无正文 | `label`、`bind`、`initial`、`min`、`max`、`step=1` | 数字输入；默认取范围内最接近 0 的合法值 |
| `slider` | 无正文 | `label`、`bind`、`initial`、`min=0`、`max=100`、`step=1`、`color` | 滑动数字；默认取 `min` |
| `range-slider` | 无正文 | `label`、`bind-start`、`bind-end`、`initial-start`、`initial-end`、`min`、`max`、`step`、`color` | 两个数字组成区间 |
| `coordinate` | 无正文 | `label`、`bind-x`、`bind-y`、`initial-x`、`initial-y`、`x-min`、`x-max`、`y-min`、`y-max`、`step`、`color` | 二维坐标 |
| `toggle` | 无正文 | `label`、`bind`、`initial`、`color` | 开关；布尔值，默认 `false` |
| `checkbox` | 无正文 | `label`、`bind`、`initial`、`color` | 勾选框；布尔值，默认 `false` |
| `date` | 无正文 | `label`、`bind`、`initial`、`min`、`max`、`required`（三者均可动态） | 日期；值为 `YYYY-MM-DD` 或空字符串 |
| `counter` | 无正文 | `label`、`bind`、`initial`、`min=0`、`max`、`step=1` | 数字加减；自带减、加、恢复 |
| `select` | 容器 | `label`、`bind`、`initial`、`color`；子项 `option` | 下拉单选；默认第一项 |
| `choices` | 容器 | `label`、`bind`、`initial`、`color`；子项 `option` | 选项卡片单选 |
| `radio-group` | 容器 | `label`、`bind`、`initial`、`color`；子项 `option` | 单选按钮组 |
| `multi-select` | 容器 | `label`、`bind`、`initial`、`max-selected`、`color`；子项 `option` | 多选；值为字符串数组 |
| `option` | 子项 | `value` 必填；正文为显示文字 | 用于 `select`、`choices`、`radio-group`、`multi-select` 和 `quiz` |

### 自带操作与进度

| 标签 | 形态 | 主要属性 | 用途 |
| --- | --- | --- | --- |
| `checklist` | 容器 | `label`、`bind`、`color`；正文为 Markdown 任务列表 | 勾选清单；值为已勾选条目 ID 数组 |
| `timer` | 无正文 | `label`、`bind`、`duration=60` | 倒计时；自带开始、暂停、重置；值为剩余秒数 |
| `progress` | 无正文 | `label`、`value` 必填、`max=100`、`color` | 进度条；`value` 可使用表达式 |

### 内容组织

| 标签 | 形态 | 主要属性 | 用途 |
| --- | --- | --- | --- |
| `panel` | 容器 | `title`、`reset=true` | 控件分组；重置内部状态 |
| `card` | 容器 | `title` | 内容卡片；正文继续使用 Markdown |
| `grid` | 容器 | `columns=2`（1–4） | 卡片网格；直接子项必须是 `card` |
| `tabs` | 容器 | `label`、`bind`、`initial`；子项 `tab` | 标签页；默认第一项 |
| `tab` | 子项 | `label` 必填、`value` 可选 | 标签页子项；省略 `value` 时按顺序生成 |
| `accordion` | 容器 | `label`；子项 `disclosure` | 折叠条目组 |
| `disclosure` | 子项 | `label` 必填、`open=false` | 可展开条目；多个可同时打开 |
| `if` | 容器 | `when` 必填，完整布尔插值 | 条件显示；条件为假时隐藏 |

### 跳转与文字颜色

| 标签 | 形态 | 主要属性 | 用途 |
| --- | --- | --- | --- |
| `jump` | 行内 | `to` 必填、`appearance=link/button`、`color` | 跳转到标题锚点或显式 `anchor` |
| `anchor` | 无正文 | `id` 必填且文档内唯一 | 显式跳转目标 |
| `text` | 行内 | `color` 必填 | 行内文字颜色 |
| `section` | 容器 | `color` 必填 | 整段文字颜色；内部继续解析 Markdown |

### 练习与分步

| 标签 | 形态 | 主要属性 | 用途 |
| --- | --- | --- | --- |
| `quiz` | 容器 | `type=choice/number`、`label`、`answer`、`explanation`、`tolerance`；choice 子项 `option` | 练习题；不公开 `bind` |
| `steps` | 容器 | `label`、`bind`、`initial`；子项 `step` | 分步阅读；默认第一步 |
| `step` | 子项 | `label` 必填、`value` 可选 | 步骤子项；省略 `value` 时按顺序生成 |

### 提示

| 标签 | 形态 | 主要属性 | 用途 |
| --- | --- | --- | --- |
| `alert` | 容器 | `title`、`tone=info/success/warning` | 提示块 |
| `badge` | 行内 | `tone=neutral/success/warning`、`color` | 状态标签；`tone` 可静态或动态 |
| `tooltip` | 行内 | `text` 必填 | 行内说明；悬停或键盘聚焦时显示 |

### 声明与本地数据

| 标签 | 形态 | 主要属性 | 用途 |
| --- | --- | --- | --- |
| `external` | 声明 | `name`、`type=string/number/boolean/string-array/number-array` 必填 | 顶层只读宿主数据；可被表达式和计算读取，阅读器不能写入 |
| `computed` | 声明 | `name`、`value` 必填 | 顶层计算值；可读控件、常量和其他计算值；不渲染 |
| `const` | 声明 | `name`、`value` 必填 | 顶层常量；只能读常量和内置常量；不渲染 |
| `validation` | 声明 | `when`、`message`、`fields` 必填 | 跨字段校验；失败时显示提示 |
| `data-table` | 容器 | `label`、`rows`、`key`、`max-rows=100`；子项 `column` | 从本地数组生成表格行；行内可用 `item`、`index` |
| `column` | 子项 | `label`、`value` 必填 | `data-table` 的列；单元格只输出文本 |

### 可视化

| 标签 | 形态 | 主要属性 | 用途 |
| --- | --- | --- | --- |
| `table` | 容器 | `label`、`searchable=true`、`sortable=true`、`page-size=10`、`key`、`bind`、`initial` | 增强表格；正文为 Markdown 表格 |
| `chart` | 容器 | `kind=bar`、`title`、`x`、`y`、`x-label`、`y-label`、`key`、`bind`、`initial` | 图表；正文为 Markdown 表格 |
| `plot` | 容器 | `min=-10`、`max=10`、`samples=200`、`label`、`x-label`、`y-label` | 函数曲线；正文为一个或多个 `$$...$$` 公式块 |
| `timeline` | 容器 | `title`、`unit="分钟"` | 时间轴；正文表格使用 `事项`、`开始`、`时长`，可选 `说明` |
| `diagram` | 容器 | `label`、`bind`、`initial`、`direction=right/down`；子项 `node`、`edge` | 交互图解 |
| `node` | 子项 | `id` 必填且唯一、`label` 必填、`tone` 可动态 | 图解节点 |
| `edge` | 子项 | `from`、`to` 必填、`label` | 图解连线 |

以上共 49 个标签。`option`、`tab`、`disclosure`、`node`、`edge`、`step`、`column` 是结构子项，只能放在对应父容器内，不能单独使用。

`table` 和 `chart` 的 `bind`、`initial` 需要同时提供 `key`，用于公开选中行的稳定标识。`plot` 的每个 `$$...$$` 块定义一条 `y = 表达式` 曲线，每个 `plot` 最多 16 条曲线。

另有 `<theme name="default">`，写在正文之前，用于选择整份文档的主题。它是文档级元数据，不计入 49 个标签。

默认模式还支持 P0 HTML 的 `div`、`span`、`p`、`h1` 至 `h6` 等元素。其中 `div`、`p` 和 `h1` 至 `h6` 接受静态 `align`（`left`、`center`、`right`、`justify`）。这些是 HTML 元素，不计入上面的 49 个标签。
