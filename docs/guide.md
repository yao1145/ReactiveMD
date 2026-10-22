# Reactive MD v0.2 作者指南

本文保留 v0.2 directive/YAML 语法。Playground 使用的新语法见 [本地交互规范](local-interaction-syntax.md) 和 [本地示例](../examples/local/README.md)；宿主通过 [本地 API](local-integration.md) 显式选择模式。

这份指南写给文档作者。你只需要 Markdown、少量 YAML 和公式，不用写 JavaScript 或 CSS。读完后你能独立完成计算器、表单、清单、筛选表、图表、图解和异步查询文档。

本页的语法版本是 0.2。`compile` 仍接受 `0.1` 和 `0.2`；本地模式通过 `compileLocal` 编译，无需声明版本。

## 阅读导航

- [先跑起来](#先跑起来)
- [文档结构](#文档结构)
- [Markdown 兼容](#markdown-兼容)
- [配置块与 YAML](#配置块与-yaml)
- [状态、数据与计算](#状态数据与计算)
- [组件语法](#组件语法)
- [表达式](#表达式)
- [绑定与约束](#绑定与约束)
- [动作与事务](#动作与事务)
- [事件](#事件)
- [集合 each](#集合-each)
- [布局与组织](#布局与组织)
- [输入与表单](#输入与表单)
- [数据展示](#数据展示)
- [图表与函数图](#图表与函数图)
- [图解、时间线与计时](#图解时间线与计时)
- [异步动作](#异步动作)
- [保存、重跑与流式接收](#保存重跑与流式接收)
- [反馈与媒体组件](#反馈与媒体组件)
- [44 个组件索引](#44-个组件索引)
- [诊断与排错](#诊断与排错)
- [从需求到文档](#从需求到文档)
- [完整文档清单与参考](#完整文档清单与参考)
- [发布前检查](#发布前检查)

## 先跑起来

在仓库根目录安装依赖并启动 Playground：

```sh
npm install
npm run dev
```

`npm run dev` 会先构建语言包，再启动 demo。地址是 `http://127.0.0.1:5173`。

目录按职责划分：

```text
reactive-md/
  src/          语言、运行时、React 渲染器
  examples/     可复用的 .reactive.md 示例
  demo/         Playground，独立 package.json
  docs/         指南与参考
  scripts/      参考文档生成脚本
```

demo 只通过 `reactive-md`、`reactive-md/react` 等公开入口使用库，不直接引用 `src` 内部文件。其他命令：

| 命令 | 作用 |
| --- | --- |
| `npm run build` | 只构建语言包 |
| `npm run build:demo` | 构建语言包和 demo |
| `npm test` | 语言单元测试 |
| `npm run test:demo` | demo 示例文档检查 |
| `npm run test:browser` | 浏览器回归检查 |
| `npm run test:intelligent` | 扩展能力浏览器检查 |

写文档时直接用 Playground 就够了。编辑器停止输入后会自动编译，右侧是可以真实操作的预览。

### 完整文档：计数器

下面是一份完整文档。复制到 Playground 左侧即可运行。

````markdown
```reactive-md
version: "0.2"
state:
  count: 0
computed:
  doubled: "=count * 2"
actions:
  increment:
    - set: count
      value: "=count + 1"
  decrement:
    - set: count
      value: "=count - 1"
  reset:
    - reset: [count]
```

# 计数器

当前计数：:value{value="=count"}。

翻倍后的值：:value{value="=doubled"}。

::button[加一]{on-click="increment"}

::button[减一]{on-click="decrement" variant="secondary"}

::button[归零]{on-click="reset" variant="quiet"}
````

这份文档做了四件事：

1. 配置块声明版本、初始状态、计算值和动作。
2. 正文用普通 Markdown 写标题和段落。
3. `:value{value="=count"}` 把状态显示在句子中间。
4. `::button[加一]{on-click="increment"}` 在点击时执行动作。

状态变化后，引用它的文本和计算值自动更新。页面不会重新编译文档。

## 文档结构

一个 `.reactive.md` 文件由三部分组成：

1. 可选的普通 YAML frontmatter。
2. 可选的 `reactive-md` 配置块。
3. Markdown 正文和组件。

配置块最多一个，必须是根级围栏代码块，放在正文之前。普通 frontmatter 可以放在更前面：

    ---
    title: 方案说明
    ---

    ```reactive-md
    version: "0.2"
    state:
      seats: 2
    ```

    # 方案说明

没有配置块也能显示普通 Markdown 和不依赖状态的组件。配置块重复、放在列表或容器里、放在正文之后，都会得到诊断。

文件名推荐使用 `*.reactive.md`。扩展名只是约定，解析器看的是内容。

## Markdown 兼容

正文继续使用标准 Markdown 和 GFM：

- 标题、段落、强调、加粗、删除线。
- 有序列表、无序列表、任务列表。
- 引用、分隔线、行内代码、围栏代码块。
- 链接、图片、GFM 表格。
- 自动链接和 URL。

代码围栏只显示，不执行。`reactive-md` 围栏是配置块，其他语言的围栏照常显示。原始 HTML 按文本显示，不会解析或执行。链接允许 http、https、mailto、tel 和相对地址；图片允许 http、https 和相对地址。`javascript:` 和 `data:` 地址会被拒绝。

脚注暂不渲染，需要注释时写成普通段落或小字说明。

Markdown 负责叙述，组件负责交互。把长表格、清单和代码放在正文里，把需要变化的部分做成 `value`、输入控件或图表。

## 配置块与 YAML

配置块的内容是 YAML。顶层只允许五个字段：

| 字段 | 内容 |
| --- | --- |
| `version` | 必填，`"0.2"` 或 `"0.1"` |
| `data` | 只读 JSON 数据 |
| `state` | 可写状态 |
| `computed` | 命名表达式 |
| `actions` | 命名动作 |

```yaml
version: "0.2"
data:
  plans:
    - {id: basic, title: 基础, price: 20}
    - {id: team, title: 团队, price: 45}
state:
  seats: 2
  annual: false
computed:
  total: "=seats * (annual ? 16 : 20)"
actions:
  reset:
    - reset: [seats, annual]
```

YAML 只使用简单结构。以下写法会被拒绝：

- 重复键。
- 锚点 `&name`、别名 `*name`、合并键 `<<`。
- 自定义标签，例如 `!Thing`。
- 非有限数字，例如 `.inf`、`.nan`。


日期建议写成带引号的字符串，例如 `"2026-10-22"`，便于与其他 YAML 工具保持一致；本语言将普通日期值作为字符串读取。

缩进用两个空格。含冒号、井号、引号或前后空格的值要加引号。数组和对象既可以写成块结构，也可以写成行内结构：

```yaml
data:
  rows:
    - {id: a, label: 第一项, value: 10}
    - {id: b, label: 第二项, value: 20}
  tags: [基础, 视觉, 工具]
```

`data` 和 `state` 的值必须是 JSON 兼容类型：字符串、有限数字、布尔值、null、数组、对象。`data` 和 `state` 中对象的键不能是 `__proto__`、`prototype`、`constructor`。

### 名称规则

`state` 与 `computed` 共享一个命名空间，名字要匹配 `[A-Za-z_][A-Za-z0-9_]*`，不能与另一个同类重名。

保留名不能使用：

- `data`、`resources`、`event`。
- 所有内置函数名，例如 `min`、`len`、`sort`。
- `true`、`false`、`null`。
- `__proto__`、`prototype`、`constructor`。

动作有独立命名空间，名字规则相同，不能叫 `data`。

字段名和动作名用英文标识符，值可以用中文。这样做能避免表达式中的名称解析问题。

### 初始类型固定

`state` 中每个名字的类型由初始值决定。`seats: 2` 之后只能写数字，`annual: false` 之后只能写布尔值，`tasks: []` 之后只能写数组。写入其他类型会得到 `action-type` 或 `binding-type` 诊断。

初始值为 `null` 时，动作可以写入任意 JSON。内置控件没有 null 绑定类型，所以可绑定字段不要初始化为 null。

## 状态、数据与计算

三个概念分工清楚：

| 名称 | 是否可写 | 怎么读 | 典型用途 |
| --- | --- | --- | --- |
| `state` | 是，通过绑定或动作 | `seats` | 用户输入、选中项、列表内容 |
| `data` | 否 | `data.plans` | 固定选项、示例数据、默认文案 |
| `computed` | 否 | `total` | 由状态和常量算出的结果 |

### state

`state` 保存会变化的值。输入控件通过 `bind` 写它，按钮和表单通过动作写它。

```yaml
state:
  count: 0
  name: ""
  tags: []
  task: {id: a, title: 写文档}
```

读取时直接写名字。嵌套字段用点路径，例如 `task.title`。但不要试图直接修改嵌套字段：动作以整个值为单位替换。要改任务标题，用 `update` 替换整个数组元素，或者用 `set` 写入一个新对象。

### data

`data` 是只读常量。适合放选项、产品目录、图表数据、节点和步骤。表达式中通过 `data` 根读取：

```yaml
data:
  plans:
    - {id: basic, title: 基础, price: 20}
computed:
  firstPlan: "=data.plans"
```

对象和数组可以整体读取，也可以用点路径读字段：`data.plans`、`data.firstPlan.title`。路径必须静态写死，不能写 `data[filter]`。

### computed

`computed` 的值是字符串表达式，必须以单个 `=` 开头：

```yaml
computed:
  unitPrice: "=annual ? data.monthlyPrice * 0.8 : data.monthlyPrice"
  total: "=seats * unitPrice"
```

计算值只读。它们按依赖关系求值，运行时会检测循环。`a` 依赖 `b`，`b` 依赖 `a` 会得到 `computed-cycle` 诊断。

依赖是静态收集的。三元表达式两个分支里出现的名字都算依赖，即使某个分支当前不会执行。分支里的未知名称也会在编译时报告。

计算值是增量的。写入 `seats` 后，只重算直接或间接依赖 `seats` 的计算值。没有被影响的计算值保持原值。

根级 `computed` 看不到 `each` 的行变量。需要逐行计算时，把表达式写在 `each` 子树里的动态属性上，或者用集合函数在根级处理整个数组。

计算值也会在初始状态验证。初始状态里出现除零、未知字段、类型错误或非有限结果，编译会失败并给出位置。

### 完整文档：方案计算器

````markdown
```reactive-md
version: "0.2"
data:
  monthlyPrice: 100
state:
  seats: 2
  annual: false
computed:
  unitPrice: "=annual ? data.monthlyPrice * 0.8 : data.monthlyPrice"
  total: "=seats * unitPrice"
actions:
  restore:
    - reset: [seats, annual]
```

# 方案计算器

调整人数和付款方式，金额会立即更新。年度付款按月价的八折计算。

::::card[你的方案]
::slider{bind="seats" label="人数" min="1" max="20" step="1"}

::toggle{bind="annual" label="年度付款"}

当前人数：:value{value="=seats"}。

每人每月：:value{value="=unitPrice" format="currency" currency="CNY"}。

每月合计：:value{value="=total" format="currency" currency="CNY"}。

:::if{when="=seats >= 5"}
这是团队规模，可以继续比较年度付款。
:::

::button[恢复默认]{on-click="restore" variant="secondary"}
::::
````

## 组件语法

组件有三种形态，冒号数量决定形态：

| 形态 | 写法 | 例子 |
| --- | --- | --- |
| 行内 | `:name{...}` | `:value{value="=total"}` |
| 单行块 | `::name{...}` | `::button[重置]{on-click="reset"}` |
| 容器 | `:::name` 开始，`:::` 结束 | `:::card[标题]`、正文、`:::` |

行内组件嵌在段落、标题或列表项里。单行块组件独占一行。容器组件包住 Markdown 和其他组件。

容器嵌套时，外层使用的冒号要比内层多。外层用四个冒号开始，就用四个冒号结束：

```markdown
::::card[外层]
:::stack
内层内容
:::
::::
```

结束行只写冒号。容器没有闭合会得到 `container-unclosed` 诊断。配置围栏没有闭合会得到 `config-unclosed`。

### 属性

属性写在 `{}` 里，值统一加引号：

```markdown
::slider{bind="seats" label="人数" min="1" max="20" step="1"}
```

属性类型由组件 schema 决定：

- 数字属性写 `min="1"`，字符串写 `label="人数"`，布尔写 `disabled="true"`，枚举写 `variant="secondary"`。
- `bind` 写状态名，不加等号。
- 事件属性写动作名，例如 `on-click="reset"`。
- `id` 可选，用于稳定标识组件。同一文档内不能重复。

### 动态属性与等号转义

schema 中标记为动态的属性可以接受表达式：

```markdown
::button[提交]{on-click="submit" disabled="=!consent"}

::input{bind="name" label="=data.nameLabel"}
```

表达式以单个 `=` 开头。要显示一个真正以等号开头的字符串，用两个等号转义：

```markdown
:value{value="==说明：等号是普通字符"}
```

这行显示 `=说明：等号是普通字符`。转义只用于动态属性和动作值。非动态属性按字面量处理，不需要也不应该写表达式。

动作里的值也遵循同一规则：

```yaml
actions:
  setNote:
    - set: note
      value: "==以等号开头的文本"
```

### 标签从哪里来

不同组件的可见标签来源不同。写错来源会得到 `component-label` 诊断。

| 标签来源 | 组件 |
| --- | --- |
| `[方括号]` 必填 | `badge`、`option`、`button`、`submit`、`tooltip`、`link-button` |
| `[方括号]` 可选 | `card`、`icon`、`spinner` |
| `label` 属性必填 | `input`、`number`、`slider`、`toggle`、`select`、`textarea`、`checkbox`、`radio-group`、`choices`、`date`、`checklist`、`stat`、`disclosure`、`tab`、`chart`、`plot`、`diagram`、`timeline`、`timer` |
| `label` 属性可选 | `progress`、`alert`、`form`、`tabs`、`table`、`list` |
| 不使用标签 | `value`、`stack`、`row`、`grid`、`if`、`each`、`accordion`、`divider`、`spacer`、`image` |

例如：

```markdown
::button[加一]{on-click="increment"}

::input{bind="name" label="姓名"}

::option[个人使用]{value="personal"}

:::card[方案说明]
正文
:::
```

`button`、`option` 的方括号标签里只能放纯文本，不要放链接、图片或组件。

## 表达式

表达式出现在三个地方：

1. `computed` 的值，整体以 `=` 开头。
2. 动态属性，例如 `label="=name"`、`when="=visible"`。
3. 动作的 `value`、`at` 和 `input` 值。

表达式不是 JavaScript。它有自己的词法、类型检查和执行预算。

### 值和路径

表达式支持：

- 数字：`0`、`2.5`、`1e3`。
- 字符串：`"文本"` 或 `'文本'`，支持常见转义。
- 布尔：`true`、`false`。
- `null`。
- 根状态名、计算名、`data`、`resources`。
- 静态点路径：`task.title`、`data.plans`、`resources.search.status`。
- 动作里的 `event`，以及当前作用域的 `each` 局部名。

不能使用：

- 数组或对象字面量。数组、对象放在 YAML 的 `data` 或 `state` 里。
- 动态下标，例如 `data[key]`。
- 赋值、函数定义、箭头函数。
- 全局对象、`window`、`Math`、JavaScript 方法。
- 函数调用后的字段访问，例如 `at(data.rows, 0).title`。先用 `pluck` 取字段，或使用 `each` 的行变量。
- `===`、`!==`、`??`、`in`、可选链。

### 运算符

| 类别 | 运算符 | 说明 |
| --- | --- | --- |
| 一元 | `-`、`!` | 负号要求数字，逻辑非要求布尔 |
| 算术 | `+`、`-`、`*`、`/`、`%` | `+` 只能数字加数字或字符串加字符串 |
| 比较 | `<`、`<=`、`>`、`>=` | 两边同为数字或同为字符串 |
| 相等 | `==`、`!=` | 深度比较，数组和对象按内容比较 |
| 逻辑 | `&&`、`||` | 两边必须是布尔，短路求值 |
| 条件 | `test ? a : b` | test 必须是布尔，分支同类型或一端为 null |

优先级从高到低是：一元、乘除取余、加减、比较、相等、与、或、三元。需要时加括号。

`+` 不做隐式转换。数字和字符串相加会报类型错误。字符串拼接用两个字符串相加，或 `concat`。

逻辑运算符没有 truthiness。`count && 1` 不合法，写成 `count != 0 && ...`。

三元表达式的两个分支必须同类型，或者一端为 null。一端为 null 会让静态类型取另一端，但运行时仍可能得到 null。需要数字或字符串的属性要提供同类型兜底，避免运行时属性校验失败。

### 函数

表达式只提供下面的纯函数。没有自定义函数，也没有 `Math`。

| 函数 | 用法与边界 |
| --- | --- |
| `min(a, b, ...)` | 至少一个数字参数，返回最小值 |
| `max(a, b, ...)` | 至少一个数字参数，返回最大值 |
| `round(x)` | 单参数，取最接近的整数；恰好半值时向正无穷方向取整，例如 `round(-1.5)` 为 -1。没有小数位参数 |
| `abs(x)` | 绝对值 |
| `sqrt(x)` | 平方根，负数会产生非有限结果 |
| `floor(x)`、`ceil(x)` | 向下、向上取整 |
| `sin(x)`、`cos(x)`、`tan(x)` | 弧度制 |
| `log(x)` | 自然对数，`x` 必须大于 0 |
| `exp(x)` | 自然指数，溢出会产生非有限结果 |
| `pow(a, b)` | 幂，两个数字参数 |
| `clamp(n, min, max)` | 截到闭区间，要求 `min <= max` |
| `len(value)` | 字符串的 Unicode 码点数或数组长度 |
| `contains(value, needle)` | 字符串包含，或数组中存在相等标量（字符串、数字、布尔值、null） |
| `range(start, end, step?)` | 生成数组，终点不包含，默认步长 1，步长不能为 0 |
| `sum(array, field?)` | 数字数组或对象指定字段求和，空数组返回 0 |
| `avg(array, field?)` | 同上求平均，空数组返回 0 |
| `at(array, index)` | 整数索引。越界或负数返回 null |
| `slice(value, start, end?)` | 字符串或数组切片，索引为整数 |
| `concat(a, b)` | 两个字符串或两个数组连接，不混合 |
| `pluck(array, field)` | 取对象数组的某个字段，所有项都要有该字段 |
| `where(array, field, value?)` | 按字段相等筛选；省略 value 时按字段真值筛选 |
| `sort(array, field?, direction?)` | 稳定排序，direction 为 `asc` 或 `desc`，默认 `asc` |
| `random(seed, index)` | 确定性伪随机数，范围 `[0, 1)` |

几个容易写错的地方：

- `round` 只有一个参数。保留两位小数写成 `round(x * 100) / 100`。
- `min`、`max` 接收多个参数，不接收数组。`max(pluck(rows, 'price'))` 会报类型错误。要取最大值，可以排序后取最后一项：`at(sort(pluck(rows, 'price')), len(rows) - 1)`。
- `at(...)` 后面不能再接 `.field`。
- `range(0, 5)` 得到 `[0, 1, 2, 3, 4]`。`range(5, 0, -1)` 得到 `[5, 4, 3, 2, 1]`。
- `sum`、`avg` 的字段参数必须是字符串；字段缺失或值不是数字会报错。
- `where` 省略 value 时使用布尔转换。`0`、`""`、`false`、`null` 为假，空数组和空对象为真。
- `sort` 的字段值必须同类型，数字、字符串或布尔值。混合类型会报错。
- `random` 只用于稳定的伪随机效果，同一个 seed 和 index 总得到同一个数。

### 运算边界

表达式按预算执行，防止文档拖慢页面：

- 表达式长度、AST 节点数和嵌套深度有上限。
- 单次求值有步数上限。
- 数组长度和字符串长度有上限。
- 非有限数字、除零和取余零会报错。
- `sqrt` 负数、`log` 非正数、`exp` 溢出会报非有限结果错误。

把复杂公式拆成几个 `computed`，每一步都有名字，诊断也更容易定位。

### 常用写法

默认值用三元：

```yaml
computed:
  displayName: "=name == '' ? '匿名' : name"
```

避免除零：

```yaml
computed:
  ratio: "=total == 0 ? 0 : done / total"
```

字符串拼接：

```yaml
computed:
  title: "=concat('方案：', planName)"
```

条件分支里不使用的值也要类型正确。编译期会检查两个分支，运行期只执行一个。

## 绑定与约束

`bind` 把一个输入控件连接到根状态。它只写状态名，不写表达式，也不能指向 `computed`、`data` 或行变量。

```markdown
::slider{bind="seats" label="人数" min="1" max="20" step="1"}

::toggle{bind="annual" label="年度付款"}

::input{bind="name" label="姓名"}
```

### 绑定类型

| 控件 | 绑定类型 |
| --- | --- |
| `input`、`textarea`、`select`、`tabs`、`radio-group`、`choices`、`date` | 字符串 |
| `number`、`slider`、`timer` | 数字 |
| `toggle`、`checkbox`、`disclosure` | 布尔值 |
| `checklist` | 数组 |
| `diagram` | 字符串，可选 |

状态的初始值必须匹配绑定类型。`seats: 2` 可以绑 `slider`，`seats: "2"` 不行。`checked: []` 可以绑 `checklist`。`selected: ""` 可以绑 `diagram`。

### 数字约束

`number`、`slider` 会把 `min`、`max`、`step` 编译成绑定约束：

- `min`、`max` 是闭区间。
- `step` 从 `min` 开始计算；没有 `min` 时从 0 开始。
- `slider` 必须写 `min` 和 `max`，`step` 默认 1。
- 浮点步长有很小的误差容限。

初始值必须满足约束。多个控件绑定同一个状态时，所有范围取交集，初始值要同时满足全部约束。隐藏的控件也参与约束。一个状态被两个滑块绑定时，即使另一个滑块在折叠页签里，写入也要通过它的范围检查。

选项约束适用于 `select`、`radio-group`、`choices`。初始状态必须在每个控件的选项集合中。多个控件绑同一个字符串状态时，选项要有交集。

### 文本校验不是绑定约束

`required`、`min-length`、`max-length`、`pattern` 和日期的 `min`、`max` 在表单提交时校验。它们不限制 `bind` 写入。

这表示用户输入时，状态可能先写入不满足长度的字符串；点击提交时才会看到字段错误。数字输入的 `min`、`max`、`step` 同时是绑定约束，写入时就会检查。

### 输入草稿

文本输入有两个提交模式：

- `commit="input"`，默认值。每次输入合法内容就写入状态。
- `commit="blur"`，失焦时写入。

中文组合输入期间不会写入，组合结束后再提交。数字输入允许空字符串、`-`、`.` 这类中间态停在输入框里，不写入状态。失焦时仍不合法，会显示错误，状态保留最后一次合法值。

绑定写入失败时，输入框保留当前草稿并显示字段错误。状态、计算值和 revision 都不变。

### 自定义组件

宿主可以注册自定义组件并声明自己的绑定类型，包括对象。作者文档只在组件注册后使用它。注册、渲染器和宿主生命周期见 [集成说明](integration.md)。

## 动作与事务

动作写在 `actions` 下，每个动作是非空步骤列表：

```yaml
actions:
  increment:
    - set: count
      value: "=count + 1"
  clear:
    - reset: [count, note]
  add:
    - append: tasks
      value: "=data.nextTask"
  removeOne:
    - remove: tasks
      at: "=i"
  replaceOne:
    - update: tasks
      at: "=i"
      value: "=data.replacement"
```

### 六种步骤

| 写法 | 作用 | 目标 |
| --- | --- | --- |
| `set` | 替换整个值 | 任意状态 |
| `reset` | 恢复配置中的初始值 | 状态名列表 |
| `append` | 向数组末尾追加一个值 | 数组状态 |
| `remove` | 删除指定索引的元素 | 数组状态 |
| `update` | 替换指定索引的整个元素 | 数组状态 |
| `call` | 调用宿主 capability | 只能是动作的唯一一步 |

每个步骤只能包含一个操作。重复写同一个目标状态会得到 `action-duplicate-target` 诊断。`reset` 列表里也不能重复同一个名字。

`set` 的值必须匹配状态的初始类型。`append`、`update` 接受任意 JSON 值。`remove`、`update` 的 `at` 必须是整数且在数组范围内。

`reset` 恢复的是配置里的初始值，不是上一次的值。它常用于“恢复默认”和“重新填写”。

### 旧快照与原子提交

一个动作的所有右值在开始时读取同一份旧快照。动作先算出候选状态，再统一校验和提交：

1. 求值所有步骤。
2. 检查目标类型、数组索引和集合操作。
3. 检查所有受影响状态的绑定约束。
4. 重算受影响的计算值。
5. 校验动态属性。
6. 一次提交，并把 revision 加一。

任何一步失败，整个动作不生效。状态、计算值和 revision 都保持旧版本，诊断返回给界面。

因此交换两个值是安全的：

```yaml
state:
  left: "甲"
  right: "乙"
actions:
  swap:
    - set: left
      value: "=right"
    - set: right
      value: "=left"
```

第二步读取的是旧快照里的 `left`，不会读到第一步刚写入的 `right`。

动作里没有 `if` 和循环。需要条件时，用三元表达式决定写入的值：

```yaml
- set: status
  value: "=score >= 60 ? '通过' : '待复核'"
```

需要不同操作时，写多个动作，由不同按钮或条件区域触发。

### 无变化不增版本

动作成功但所有目标值都和旧值相同，返回成功，revision 不变，也不通知订阅者。绑定写入同一个值也这样处理。

### 输入事件是两次提交

输入控件先写绑定，再执行 `on-change` 动作。这是两个独立提交：

1. 绑定写入成功，状态和 revision 更新。
2. 动作执行。动作失败不会撤销第 1 步。

动作读取的是写入后的新状态，同时可以通过 `event.value` 拿到这次写入的值。

## 事件

组件事件写成 `on-事件名="动作名"`。动作名是静态字符串，不能是表达式。

| 事件 | 触发组件 | `event` 内容 |
| --- | --- | --- |
| `on-click` | `button` | 无 |
| `on-change` | `input`、`number`、`slider`、`toggle`、`select` | `{ value }` |
| `on-submit` | `form` | `{ values }` |
| `on-select` | `list`、`chart` | 见下 |

`list` 的 `on-select` 提供 `{ item, index, value }`：`item` 是整行对象，`index` 是当前数组位置，`value` 是这一项的 `id`。

`chart` 的 `on-select` 提供 `{ item, index, series, value }`：`item` 是数据行，`index` 是数据行位置，`series` 是纵轴字段名，`value` 是点击的数值。

`button` 的 `on-click` 不传事件对象，动作里不要读 `event`。

`form` 的 `on-submit` 用 `event.values` 读取表单字段。字段名默认是绑定名，写了 `name` 属性时用 `name`。值来自提交时的状态。

### 当前派发范围

v0.2 的渲染器实际派发 `on-change` 的控件是 `input`、`number`、`slider`、`toggle`、`select`。

`textarea`、`checkbox`、`radio-group`、`choices`、`date`、`checklist`、`tabs`、`disclosure`、`diagram`、`form` 接受 `on-change` 属性，但当前不会触发动作。需要读取这些控件的值时，用表单的 `on-submit`，或在旁边的按钮动作里读取根状态。

`diagram` 的选中通过 `bind` 写回节点 ID，不依赖 `on-select`。`timer` 每秒写绑定状态，也没有动作事件。

这是 v0.2 的现状。写文档时优先使用可靠的组合：输入控件加 `on-change`，复杂控件用表单提交或按钮动作。

### 按钮和表单的异步状态

按钮触发宿主动作时会显示进行中状态，并提供取消请求的按钮。表单提交宿主动作时也提供取消。错误显示在控件附近，同时进入诊断面板。

## 集合 each

`each` 遍历数组，为每一项渲染一份子树：

```markdown
::::each{items="=tasks" as="task" index="i" key="id"}
:::card
### :value{value="=task.title"}

::button[移除]{on-click="remove"}
:::
::::
```

- `items` 必须是对象数组，可来自数组表达式或 JSON 属性字面量。
- `as` 设置当前项名称，默认 `item`。
- `index` 设置零基索引名称，默认 `index`。
- `key` 必填，写当前项的稳定字段名，或者写 `index`。

`as` 和 `index` 要匹配标识符规则，不能相同，不能使用保留名。避免使用状态名或计算名作为局部名，否则子树里会遮蔽根名称。

`key` 字段的值必须是字符串或数字，且在数组里唯一。空字符串、缺失字段、重复键都会让组件显示错误。集合变化时保持 key 稳定，组件才能正确复用。

### 作用域

行变量在 `each` 子树内可见，包括嵌套的组件和动作。根级 `computed` 看不到行变量。

```markdown
:value{value="=task.title"}
:value{value="=i"}
```

在行内按钮触发动作时，动作可以读取 `task`、`i` 和自定义局部名。动作在 `each` 外部触发时，没有这些值。

### 绑定仍在根上

`bind` 只指向根状态。`each` 里放一个 `::input{bind="note"}`，每一行都会编辑同一个 `note`，不是各自一份。

逐项编辑要用集合动作：

```markdown
::::each{items="=tasks" as="task" index="i" key="id"}
::button[完成]{on-click="complete"}
::::
```

```yaml
actions:
  complete:
    - update: tasks
      at: "=i"
      value: "=data.doneTask"
```

如果要编辑每行的文本，可以给每行一个输入草稿并配合 `on-change`，但最终仍要写入根状态或集合状态。更简单的做法是用表单收集一个值，再用按钮把值 `update` 到指定索引。

### 空集合

`items` 为空数组时，`each` 不渲染任何内容，不报错。需要空状态提示时，用 `if` 配合 `len(tasks) == 0`。

### 完整文档：会变化的集合

````markdown
```reactive-md
version: "0.2"
data:
  nextTask:
    id: review
    title: 复核交互
    description: 检查键盘和手机布局
  replacement: 已复核
  checks:
    - {id: source, label: 读懂源文档}
    - {id: state, label: 调整状态并观察结果}
    - {id: mobile, label: 在手机宽度试用}
  products:
    - {name: 文档, category: 基础, price: 20}
    - {name: 表单, category: 输入, price: 45}
    - {name: 图表, category: 视觉, price: 80}
    - {name: 图解, category: 视觉, price: 65}
    - {name: 列表, category: 基础, price: 30}
    - {name: 计划, category: 工具, price: 35}
state:
  tasks:
    - {id: design, title: 设计文档, description: 写下状态和组件}
    - {id: build, title: 实现交互, description: 用输入和动作连接内容}
  labels: [待办, 进行中, 待复核]
  checked: []
computed:
  total: "=len(tasks)"
  progress: "=len(checked) / 3 * 100"
actions:
  add:
    - append: tasks
      value: "=data.nextTask"
  remove:
    - remove: tasks
      at: "=i"
  mark:
    - update: labels
      at: "=i"
      value: "=data.replacement"
```

# 会变化的集合

当前任务数：:value{value="=total"}。

::::each{items="=tasks" as="task" index="i" key="id"}
:::card
### :value{value="=task.title"}

:value{value="=task.description"}

状态：:value{value="=at(labels, i)"}

::button[标记复核]{on-click="mark" disabled="=at(labels, i) == '已复核'"}

::button[移除任务]{on-click="remove" variant="secondary"}
:::
::::

::button[添加复核任务]{on-click="add" disabled="=contains(pluck(tasks, 'id'), 'review')"}

::divider

::checklist{bind="checked" label="体验清单" items="=data.checks"}

::progress{label="完成进度" value="=progress" max="100"}

## 费用表

::table{data="=data.products" label="组件费用示例" searchable="true" sortable="true" page-size="3"}
````

## 布局与组织

布局组件决定内容怎么排，不改变状态：

| 组件 | 用途 |
| --- | --- |
| `stack` | 纵向排列，`gap` 为 `sm`、`md`、`lg` |
| `row` | 横向排列，适合按钮和短控件 |
| `grid` | 网格，`columns`、`gap`、`min-width` 控制列数和最小宽度 |
| `card` | 分组内容，可带方括号标题 |
| `if` | 条件显示，`when` 必须是布尔 |
| `tabs` | 页签，绑定一个字符串状态 |
| `accordion` | 一组折叠项，只接受 `disclosure` |
| `disclosure` | 单个折叠项，可绑定布尔状态 |

`grid` 的 `columns` 会限制在 1 到 12，卡片按 `min-width` 自动换行。窄屏时网格会减少列数。

`if` 隐藏时子组件卸载，根状态保留。输入框里的草稿、组件的本地展开状态可能重置。焦点在隐藏内容里时，会移回文档容器。

`tabs` 必须绑定一个字符串状态，子节点只能是 `tab`。`tab` 需要 `value` 和 `label`。点击页签会把 `value` 写入绑定状态。隐藏的页签仍然留在文档中，状态和控件值保留；表单校验跳过隐藏的字段。

`disclosure` 的 `label` 必填。不写 `bind` 时展开状态只属于组件；写 `bind` 后写入布尔状态，重新渲染也能恢复。`accordion` 只是分组容器，不强制一次只展开一个。

### 怎么选布局

- 两三个方案并排比较：`grid` 加 `card`。
- 表单字段：`stack`，或者直接顺序排列。
- 按钮、状态标签：`row`。
- 长说明和补充材料：`disclosure` 或 `accordion`。
- 同一位置切换不同视图：`tabs`，绑定到 `view`。
- 只有满足条件才出现的内容：`if`。

不要为了省空间把关键信息藏进折叠项。折叠适合次要说明和常见问题。

### 完整文档：布局、页签与折叠

````markdown
```reactive-md
version: "0.2"
state:
  annual: false
  view: details
computed:
  basic: "=annual ? 80 : 100"
  pro: "=annual ? 160 : 200"
  viewLabel: "=view == 'details' ? '功能比较' : '选购建议'"
  heading: "=concat('当前查看：', viewLabel)"
actions:
  restore:
    - reset: [annual, view]
```

# 布局、页签与折叠

::toggle{bind="annual" label="按年付款，享受八折"}

::::grid{columns="2" gap="md"}
:::card[基础方案]
适合个人与小型项目。

::stat{label="每月费用" value="=basic" format="currency" currency="CNY" hint="按当前付款方式折算"}

:badge[本地文档]{tone="neutral"}
:::
:::card[专业方案]
适合需要协作与扩展的团队。

::stat{label="每月费用" value="=pro" format="currency" currency="CNY" hint="按当前付款方式折算"}

:badge[支持宿主扩展]{tone="success"}
:::
::::

:value{value="=heading"}。

::::tabs{bind="view" label="方案说明"}
:::tab{value="details" label="功能比较"}
| 能力 | 基础方案 | 专业方案 |
| --- | --- | --- |
| 本地交互 | 支持 | 支持 |
| 团队协作 | 个人使用 | 多人共享 |
| 宿主扩展 | 内置组件 | 自定义组件 |
:::
:::tab{value="notes" label="选购建议"}
先根据参与人数选择方案，再比较付款周期带来的费用变化。
:::
::::

::::accordion
:::disclosure{label="费用如何计算？"}
年度付款使用每月标价的八折，界面会折算成每月费用。
:::
:::disclosure{label="可以随时切换吗？"}
可以。上方开关和页签都会写回文档状态。
:::
::::

::button[恢复默认]{on-click="restore" variant="secondary"}
````

## 输入与表单

输入控件都通过 `bind` 写根状态：

| 控件 | 用途 | 常见属性 |
| --- | --- | --- |
| `input` | 单行文本 | `label`、`placeholder`、`commit`、`required`、`min-length`、`max-length`、`pattern`、`name` |
| `number` | 数字 | `label`、`min`、`max`、`step`、`required`、`name` |
| `slider` | 滑块 | `label`、`min`、`max`、`step`、`name` |
| `toggle` | 开关 | `label`、`name` |
| `select` | 下拉选择 | `label`、`name`，子节点是 `option` |
| `textarea` | 多行文本 | `label`、`rows`、`required`、`min-length`、`max-length`、`pattern`、`commit`、`name` |
| `checkbox` | 单个勾选 | `label`、`name` |
| `radio-group` | 单选组 | `label`、`name`，子节点是 `option` |
| `choices` | 按钮式单选 | `label`、`name`，子节点是 `option` |
| `date` | 日期 | `label`、`min`、`max`、`required`、`name` |
| `checklist` | 多选清单 | `label`、`items`、`name` |

`label` 是可见文字，也是无障碍名称。不要用占位符代替标签。

`name` 控制表单提交时的字段名。省略时使用绑定名。两个字段绑定同一个状态时，用不同的 `name` 区分。

### 选项控件

`select`、`radio-group`、`choices` 只接受 `option` 子节点：

```markdown
:::select{bind="plan" label="方案"}
::option[基础]{value="basic"}
::option[团队]{value="team"}
:::
```

`option` 的方括号是显示文字，`value` 是写入状态的字符串。选项值必须唯一。初始状态必须是其中一个选项，否则编译会报告绑定约束错误。需要空选项时，显式添加 `value=""` 的 option，并将状态初始化为空字符串。

### 日期

`date` 绑定字符串，格式是 `YYYY-MM-DD`。`min`、`max` 也写 ISO 日期。格式不对会在编译时得到 `component-range` 诊断。

### 清单

`checklist` 绑定字符串数组。`items` 是对象数组，每项需要字符串 `id` 和可读的 `label`：

```markdown
::checklist{bind="checked" label="体验清单" items="=data.checks"}
```

用户勾选后，整个选中 ID 数组写回状态。`items` 可以来自 `data`，也可以来自状态。重复 `id` 会显示组件错误。

### 表单

`form` 把字段和提交动作组织在一起：

```markdown
::::form{on-submit="submit" label="预约交流"}
::input{bind="name" label="姓名" name="name" required="true"}

::submit[提交预约]
::::
```

`form` 需要一个 `on-submit` 动作。`submit` 必须放在 `form` 里，用方括号写文字。表单不能嵌套。

提交时：

1. 检查当前可见且启用的字段。
2. 找到第一个无效字段，聚焦并显示浏览器校验提示。
3. 通过后，把字段值组成 `event.values` 交给动作。

`event.values` 的键是 `name` 或绑定名。值包括字符串、数字、布尔值和数组：

```yaml
actions:
  submit:
    - set: submitted
      value: true
    - set: summary
      value: "=event.values.name + ' / ' + event.values.email"
```

动作也可以直接读根状态。`event.values` 适合提交到宿主，或者把多个字段合成一条摘要。

### 校验属性

| 属性 | 适用 | 行为 |
| --- | --- | --- |
| `required` | 文本、日期、数字、多行文本 | 提交时不能为空 |
| `min-length`、`max-length` | 文本、多行文本 | 提交时检查长度 |
| `pattern` | 文本、多行文本 | 正则表达式，提交时检查 |
| `min`、`max` | 日期、数字、滑块 | 日期在提交时检查；数字和滑块同时是绑定约束 |
| `step` | 数字、滑块 | 绑定约束 |
| `disabled` | 所有输入 | 禁用后不能编辑，也不参与提交校验 |

`pattern` 按整个值匹配。写 `[^@ ]+@[^@ ]+[.][^@ ]+` 表示一个简单邮箱格式。正则写错不会在编译时发现，浏览器会忽略无效正则。

文本长度和格式只在提交时拦住。输入过程中状态仍会更新。需要即时限制时，用 `computed` 或按钮的 `disabled` 表达派生状态。

### 完整文档：预约表单

````markdown
```reactive-md
version: "0.2"
state:
  name: ""
  email: ""
  role: personal
  appointment: "2026-10-22"
  message: ""
  consent: false
  submitted: false
  summary: ""
actions:
  submit:
    - set: submitted
      value: true
    - set: summary
      value: "=event.values.name + ' · ' + event.values.email"
  again:
    - reset: [name, email, role, appointment, message, consent, submitted, summary]
```

# 预约表单

填写信息并勾选确认。提交时会检查可见且启用的字段。

::::form{on-submit="submit" label="预约交流"}
::input{bind="name" label="姓名" name="name" required="true" min-length="2" placeholder="至少两个字"}

::input{bind="email" label="邮箱" name="email" required="true" pattern="[^@ ]+@[^@ ]+[.][^@ ]+" placeholder="name@example.com"}

:::choices{bind="role" label="使用方式"}
::option[个人使用]{value="personal"}
::option[团队使用]{value="team"}
:::

::date{bind="appointment" label="希望交流的日期" required="true"}

::textarea{bind="message" label="想实现什么交互？" required="true" min-length="3" rows="4" placeholder="描述你的文档或工具"}

::checkbox{bind="consent" label="确认以上内容可以用于本次交流"}

::submit[提交预约]{disabled="=!consent"}
::::

::::if{when="=submitted"}
:::alert{tone="success" label="已记录本地提交"}
谢谢 :value{value="=name"}。你选择的日期是 :value{value="=appointment"}。

联系信息：:value{value="=summary"}。
:::
::button[重新填写]{on-click="again" variant="secondary"}
::::
````

## 数据展示

### table

`table` 展示对象数组。适合结构化数据、搜索结果和费用表：

```markdown
::table{data="=data.products" label="组件费用" searchable="true" sortable="true" page-size="3"}
```

- `data` 每项必须是对象。
- `columns` 可选，写 `[{key, label}]` 形式的数组。省略时从数据键推断。
- `searchable` 默认 `true`，提供本地搜索。
- `sortable` 默认 `true`，点击表头排序。
- `page-size` 默认 5，范围 1 到 100。

单元格按文本显示。数字排序按数值比较，字符串按本地化顺序比较。缺失值排在后面。表格没有行点击事件。

`columns` 是 JSON 数组。在指令属性里写 JSON 时，用单引号包住整个值，内部用双引号：

```markdown
::table{data="=data.rows" columns='[{"key":"name","label":"名称"},{"key":"price","label":"价格"}]' label="价目"}
```

更推荐把列定义放进 `data.columns`，然后用 `columns="=data.columns"`，可读性更好。

### list

`list` 展示可点击的条目列表：

```markdown
::list{items="=data.articles" label="阅读顺序" on-select="choose"}
```

每项需要 `id`、`title`，可选 `description`。`id` 可以是字符串或数字，必须唯一。

点击条目触发 `on-select`，动作拿到 `event.item`、`event.index` 和 `event.value`。列表的选中高亮是组件本地状态；要保存选择，就在动作里写入根状态：

```yaml
actions:
  choose:
    - set: selected
      value: "=event.value"
```

### checklist 与进度

`checklist` 适合多选清单。把选中 ID 数组绑定到状态，再用 `len` 计算进度：

```yaml
computed:
  progress: "=len(checked) / len(data.checks) * 100"
```

```markdown
::checklist{bind="checked" label="体验清单" items="=data.checks"}

::progress{label="完成进度" value="=progress" max="100"}
```

`progress` 的 `value` 必须是数字，显示时会裁到 0 到 `max`。

### 组件错误

表格、列表和清单的 `data`、`items` 形状不对时，编译通常能通过，因为动态数组要到运行时才知道内容。组件会在原位显示错误，例如“data 必须是 JSON 数组”“items 第 2 项缺少字符串 id”。这类错误不在编辑器行号上，先检查 `data` 的结构。

### 完整文档：筛选、列表与表格

````markdown
```reactive-md
version: "0.2"
data:
  items:
    - {id: doc, title: 文档写作, category: 基础, price: 20}
    - {id: form, title: 表单交互, category: 基础, price: 45}
    - {id: chart, title: 图表展示, category: 视觉, price: 80}
    - {id: diagram, title: 图解说明, category: 视觉, price: 65}
    - {id: list, title: 列表与表格, category: 数据, price: 30}
    - {id: plan, title: 计划工具, category: 工具, price: 35}
  articles:
    - {id: state, title: 理解状态, description: 找出用户可以改变的内容。}
    - {id: compute, title: 写下关系, description: 用计算值连接状态与结果。}
    - {id: view, title: 放置组件, description: 选择适合当前任务的表达方式。}
state:
  filter: all
  selected: ""
computed:
  ranked: "=filter == 'all' ? sort(data.items, 'price', 'desc') : sort(where(data.items, 'category', filter), 'price', 'desc')"
actions:
  choose:
    - set: selected
      value: "=event.value"
```

# 筛选、列表与表格

:::select{bind="filter" label="按类别筛选"}
::option[全部]{value="all"}
::option[基础]{value="基础"}
::option[视觉]{value="视觉"}
::option[数据]{value="数据"}
::option[工具]{value="工具"}
:::

当前筛选：:value{value="=filter"}。

::table{data="=ranked" label="按价格从高到低" searchable="true" sortable="true" page-size="3"}

## 可选择的阅读列表

::list{items="=data.articles" label="阅读顺序" on-select="choose"}

已选主题：:value{value="=selected"}。

## 逐项渲染

::::each{items="=ranked" as="item" index="i" key="id"}
:::card
### :value{value="=item.title"}

类别：:value{value="=item.category"}

价格：:value{value="=item.price" format="number"}
:::
::::
````

## 图表与函数图

### chart

`chart` 从对象数组生成图形：

```markdown
::chart{data="=data.expenses" kind="bar" x="label" y="spent,budget" label="实际费用与预算"}
```

- `data` 每项是对象。
- `x` 是横轴或标签字段，默认 `label`。
- `y` 是一个字段名，或用逗号分隔的多个字段名，默认 `value`。
- `kind` 为 `bar`、`line`、`area`、`scatter`、`donut`，默认 `bar`。
- `label` 必填，是图表标题。
- `x-label`、`y-label` 可选，是坐标轴标题。

多系列用逗号分隔，图例会为每个系列提供开关。缺失值或非数字值按空缺处理：柱形跳过，折线在空缺处断开。

`donut` 只使用第一个 `y` 系列，忽略负值，零值不占扇区。`scatter` 在每一行的 `x` 都是数字时使用数值横轴，否则按类别排列。

图表下方有“查看数据表”，键盘可以聚焦图形点并读取数值。

`chart` 的 `on-select` 不会自动写状态。动作需要自己决定写入什么：

```yaml
actions:
  choosePoint:
    - set: selectedLabel
      value: "=event.item.label"
```

### plot

`plot` 在区间上采样一个公式：

```markdown
::plot{formula="amplitude * sin(frequency * x)" min="0" max="12.56" samples="180" label="正弦波"}
```

- `formula` 是不带等号的表达式字符串。
- `x` 是局部变量，表示当前采样点。
- 公式可以读取根状态、计算值和 `data`。
- `min`、`max` 可以是动态数字。
- `samples` 默认 60，范围 2 到 500。
- `label` 必填，`x-label`、`y-label` 可选。

公式必须返回有限数字。采样点求值失败时，曲线在该处断开，并显示说明。所有点都失败时显示组件错误。`max` 必须大于 `min`。

`plot` 没有动作事件，适合展示参数变化后的曲线。

### 完整文档：图表与函数图

````markdown
```reactive-md
version: "0.2"
data:
  expenses:
    - {label: 内容, spent: 120, budget: 150}
    - {label: 视觉, spent: 230, budget: 200}
    - {label: 交互, spent: 180, budget: 220}
    - {label: 测试, spent: 90, budget: 120}
state:
  principal: 10000
  monthly: 500
  rate: 5
  years: 20
computed:
  budgetTotal: "=sum(data.expenses, 'budget')"
  averageSpent: "=avg(data.expenses, 'spent')"
  finalAmount: "=rate == 0 ? principal + monthly * years * 12 : principal * pow(1 + rate / 100 / 12, years * 12) + monthly * (pow(1 + rate / 100 / 12, years * 12) - 1) / (rate / 100 / 12)"
```

# 图表与函数图

## 多系列费用

::chart{data="=data.expenses" kind="bar" x="label" y="spent,budget" label="实际费用与预算" y-label="金额"}

::chart{data="=data.expenses" kind="line" x="label" y="spent" label="实际费用趋势" y-label="金额"}

::chart{data="=data.expenses" kind="area" x="label" y="budget" label="预算面积" y-label="金额"}

::::grid{columns="2"}
:::card[费用占比]
::chart{data="=data.expenses" kind="donut" x="label" y="spent" label="费用占比"}
:::
:::card[预算与实际]
::chart{data="=data.expenses" kind="scatter" x="budget" y="spent" label="预算与实际" x-label="预算" y-label="实际"}
:::
::::

::stat{label="预算合计" value="=budgetTotal" format="currency" currency="CNY"}

::stat{label="平均实际支出" value="=averageSpent" format="currency" currency="CNY"}

## 储蓄曲线

::number{bind="principal" label="初始金额" min="0" step="100"}

::number{bind="monthly" label="每月存入" min="0" step="100"}

::slider{bind="rate" label="年利率（%）" min="0" max="10" step="0.5"}

::slider{bind="years" label="年数" min="1" max="40" step="1"}

::stat{label="期末金额" value="=finalAmount" format="currency" currency="CNY"}

::plot{formula="rate == 0 ? principal + monthly * x * 12 : principal * pow(1 + rate / 100 / 12, x * 12) + monthly * (pow(1 + rate / 100 / 12, x * 12) - 1) / (rate / 100 / 12)" min="0" max="=years" samples="80" label="储蓄增长曲线" x-label="年" y-label="金额"}
````

## 图解、时间线与计时

### diagram

`diagram` 画节点和箭头：

```markdown
::diagram{nodes="=data.nodes" edges="=data.edges" bind="selected" label="状态流"}
```

- `nodes` 每项需要 `id`、`label`，可选 `x`、`y`、`description`。
- `edges` 每项需要 `from`、`to`，可选 `label`。
- 所有节点都有有限 `x`、`y` 时按坐标归一化布局；否则自动排成圆环。
- `bind` 可选，绑定字符串状态。选中节点时把节点 ID 写回该状态。
- `label` 必填。

点击节点，或用 Tab 聚焦后按回车，可以选中。方向键在节点间移动焦点。选中的节点说明显示在图下方。

`diagram` 不派发 `on-select`。要保存选择，使用 `bind`。初始状态最好是一个节点 ID，否则图下方没有选中说明。

### timeline

`timeline` 展示时间区间：

```markdown
::timeline{items="=data.steps" label="45 分钟工作计划"}
```

每项需要 `start` 和 `duration`，单位是分钟，必须是非负有限数字。`id`、`title`、`description` 可选。`title` 缺省时使用“项目 1”这类名称。零时长会画成一条细线。重复 `id` 仍按顺序显示，但会有提示。

### timer

`timer` 是倒计时：

```markdown
::timer{bind="remaining" duration="60" label="一分钟专注计时"}
```

- `bind` 绑定秒数，必须是数字状态。
- `duration` 是初始时长，必须是大于 0 的秒数。
- `label` 必填。

点击开始后每秒写一次绑定状态，归零时停止并显示“计时完成”。暂停和重置会立即更新状态。依赖剩余秒数的计算值每秒重算一次。外部改变绑定值时，停止状态下的计时器会同步新值。

### 完整文档：图解、时间线与计时

````markdown
```reactive-md
version: "0.2"
data:
  nodes:
    - {id: input, label: 输入, x: 100, y: 120, description: 用户通过控件改变文档状态。}
    - {id: compute, label: 计算, x: 320, y: 120, description: 依赖图只重算受影响的计算值。}
    - {id: view, label: 视图, x: 540, y: 120, description: 组件订阅新状态并显示结果。}
  edges:
    - {from: input, to: compute, label: 状态变化}
    - {from: compute, to: view, label: 订阅更新}
  steps:
    - {id: prepare, title: 准备材料, start: 0, duration: 10, description: 列出所需内容。}
    - {id: main, title: 完成主体, start: 10, duration: 25, description: 集中完成主要部分。}
    - {id: parallel, title: 整理参考, start: 15, duration: 15, description: 可以与主体阶段并行。}
    - {id: review, title: 检查与交付, start: 35, duration: 10, description: 留出复核时间。}
state:
  selected: input
  remaining: 60
  amplitude: 1
  frequency: 1
```

# 图解、时间线与计时

点击节点或用 Tab 聚焦后按回车，选择一个环节。

::diagram{nodes="=data.nodes" edges="=data.edges" bind="selected" label="响应式状态流"}

当前环节：:value{value="=selected"}。

::timeline{items="=data.steps" label="45 分钟工作计划"}

::timer{bind="remaining" duration="60" label="一分钟专注计时"}

## 改变输入，观察曲线

::slider{bind="amplitude" label="振幅" min="0.5" max="3" step="0.5"}

::slider{bind="frequency" label="频率" min="0.5" max="3" step="0.5"}

::plot{formula="amplitude * sin(frequency * x)" min="0" max="12.56" samples="180" label="正弦波" x-label="x" y-label="位移"}
````

## 异步动作

文档不能直接发网络请求。它引用宿主注册的 capability，由宿主决定能访问什么服务。

```yaml
actions:
  search:
    - call: catalog.search
      input:
        query: "=query"
```

`call` 必须是动作里唯一的一步，不能和 `set`、`reset` 等混用。`input` 的值在触发时求值，可以读状态、行变量和事件。

宿主执行后，结果放进 `resources.<动作名>`：

| 字段 | 内容 |
| --- | --- |
| `status` | `idle`、`pending`、`success`、`error` |
| `data` | 成功时的 JSON 结果 |
| `error` | 失败时的错误文本，成功和空闲时为 null |
| `requestId` | 请求编号 |

初始状态是 `idle`。触发后先变成 `pending`，成功是 `success`，失败是 `error`。取消后回到 `idle`。

```markdown
查询状态：:value{value="=resources.search.status"}。

:::if{when="=resources.search.status == 'pending'"}
:spinner{label="正在查询"}
:::

:::if{when="=resources.search.status == 'error'"}
:value{value="=resources.search.error"}
:::
```

同一个动作发起新请求时，旧请求会被取消，迟到的结果不会覆盖新请求。不同动作互不影响。按钮和表单会显示进行中状态，并提供取消入口。

结果使用前先判断状态。表格需要数组，可以给一个空数组兜底：

```markdown
::table{data="=resources.search.status == 'success' ? resources.search.data : data.empty" label="结果"}
```

`resources` 只对带 `call` 的动作存在。读取 `resources.other.status` 时，如果 `other` 不是宿主动作，编译会报路径不存在。

### 宿主提供什么

capability 的名字、实现、凭据和权限都在宿主。作者只写名字。Playground 内置一个本地 `catalog.search`，用于演示查询、取消和失败重试。它不访问外部服务。其他宿主需要注册同名 capability，具体接口见 [集成说明](integration.md)。

按钮和表单提交宿主动作时不需要额外写法，渲染器会自动使用异步派发。

### 完整文档：异步查询

````markdown
```reactive-md
version: "0.2"
data:
  empty: []
state:
  query: ""
actions:
  search:
    - call: catalog.search
      input:
        query: "=query"
```

# 异步查询

输入关键词，查询宿主提供的组件目录。输入 `error` 可以检查失败与重试。

:::form{on-submit="search" label="查询组件目录"}
::input{bind="query" label="组件关键词" placeholder="例如：图表、表单、输入"}

::submit[查询目录]
:::

查询状态：:value{value="=resources.search.status"}。

:::if{when="=resources.search.status == 'pending'"}
:spinner{label="正在查询本地目录"}
:::

:::if{when="=resources.search.status == 'error'"}
:value{value="=resources.search.error"}
:::

:::if{when="=resources.search.status == 'success'"}
::table{data="=resources.search.status == 'success' ? resources.search.data : data.empty" label="查询结果" page-size="5"}
:::
````

## 保存、重跑与流式接收

成功编译后，源码和状态会按示例自动保存。刷新页面后，如果源码和文档结构都匹配，会恢复上次的状态；结构变化或源码不同，就回到初始状态，并给出一条恢复警告。

以下操作会从初始状态开始：

- 修改源码后重新编译。
- 点击“重新运行”。
- 点击“重置文档状态”。

“恢复示例”把源码恢复成示例原文，并从初始状态开始。

成功编译后会自动保存，不需要手动保存；编译失败的源码不会覆盖上次保存的版本。示例选择也会记住。每个示例有独立的文档 ID，状态不会串到另一个示例。

### 流式播放

工具栏的流式按钮把当前文档按片段依次送入编译器，模拟模型逐段输出：

- 已成功编译的前缀会提交并显示。
- 未闭合的配置块或容器会等待后续片段。
- 已提交部分的兼容状态会保留。
- 每次提交创建新运行时，旧运行时的未完成请求会取消。
- 最后一片仍有错误时，显示正式诊断。

流式适合检查“文档逐步出现”的阅读体验。作者写文档时不需要手动分片。

### 其他作者工具

- 格式化：按当前语法重排文档。格式化失败时保留原文。
- 导入和导出：读写 `.reactive.md` 文件。
- 组件清单：查看 44 个组件的 schema，并导出 JSON。
- 主题和简洁视图：调整预览外观，不改变文档语义。

宿主如何保存、恢复和流式接收，见 [集成说明](integration.md)。作者只需要知道：状态恢复要求源码和结构兼容，重新编译会重置状态。

## 反馈与媒体组件

这些组件负责提示、状态和轻量视觉：

- `badge` 显示短标签，`tone` 可选 `neutral`、`success`、`warning`。
- `alert` 显示整段提示，`tone` 可选 `info`、`success`、`warning`、`danger`。
- `progress` 显示进度，`value` 必须是数字。
- `stat` 强调一个数值，支持文本、数字和货币格式。
- `tooltip` 在悬停或聚焦时显示说明。
- `icon` 使用内置图标名，不加载外部图标库。
- `divider` 和 `spacer` 分隔内容。
- `spinner` 表示加载中。
- `link-button` 渲染成链接，只接受安全地址。
- `image` 显示图片，`src` 支持 http、https 和相对地址，`alt` 必填。

图片资源由宿主提供。下面的片段假设宿主已把图片放在对应路径：

```markdown
::image{src="/media/flow.svg" alt="状态流示意图" caption="由宿主提供的图片" fit="contain"}
```

`data:` 图片和脚本协议地址会被拒绝。图片加载失败时显示替代文本，不会破坏整篇文档。

### 完整文档：反馈与媒体组件

````markdown
```reactive-md
version: "0.2"
state:
  score: 72
  visible: true
actions:
  toggle:
    - set: visible
      value: "=!visible"
```

# 反馈与媒体组件

:badge[已保存]{tone="success"} :icon{name="info" label="说明"} 把鼠标移到 :tooltip[状态快照]{text="每次交互产生一份只读状态，旧版本不会被改写。"} 上查看说明。

::progress{label="完成度" value="=score" max="100"}

::stat{label="当前得分" value="=score" format="number" hint="满分 100"}

:::alert{tone="info" label="静态提示"}
这条提示始终显示，适合放操作说明或范围说明。
:::

::::if{when="=visible"}
:::alert{tone="success" label="条件内容"}
这段内容由 `visible` 控制。隐藏后状态仍然保留。
:::
::::

::button[切换条件内容]{on-click="toggle"}

::divider

::spacer{size="sm"}

::link-button[示例链接]{href="https://example.com" variant="secondary"}
````

## 44 个组件索引

完整属性、默认值和动态标记见 [组件参考](components.md)。下面按用途列出组件、形态和关键点。

### 内容与数值

| 组件 | 形态 | 绑定 | 用途与关键属性 |
| --- | --- | --- | --- |
| `value` | 行内 | 无 | 显示标量。`value` 必填，`format` 为 `text`、`number`、`currency`，货币还要 `currency`；数字和货币格式要求数字值 |
| `badge` | 行内 | 无 | 短标签，方括号写文字，`tone` 为 `neutral`、`success`、`warning` |
| `stat` | 单行块 | 无 | 强调数值。`label`、`value` 必填，支持 `format`、`currency`、`hint`；数字和货币格式要求数字值 |
| `progress` | 单行块 | 无 | 进度条。`value` 必填，`max` 默认 100，`label` 可选 |

### 输入控件

| 组件 | 形态 | 绑定 | 用途与关键属性 |
| --- | --- | --- | --- |
| `input` | 单行块 | 字符串 | 单行文本。`label` 必填，支持 `placeholder`、`commit`、`required`、长度、`pattern` |
| `number` | 单行块 | 数字 | 数字输入。`label` 必填，支持 `min`、`max`、`step` |
| `slider` | 单行块 | 数字 | 滑块。`label`、`min`、`max` 必填，`step` 默认 1 |
| `toggle` | 单行块 | 布尔 | 开关。`label` 必填 |
| `select` | 容器 | 字符串 | 下拉框。`label` 必填，子节点为 `option` |
| `option` | 单行块 | 无 | 选项。方括号写文字，`value` 必填 |
| `textarea` | 单行块 | 字符串 | 多行文本。`label` 必填，`rows` 默认 4 |
| `checkbox` | 单行块 | 布尔 | 单个勾选。`label` 必填 |
| `radio-group` | 容器 | 字符串 | 单选组。`label` 必填，子节点为 `option` |
| `choices` | 容器 | 字符串 | 按钮式单选。`label` 必填，子节点为 `option` |
| `date` | 单行块 | 字符串 | 日期，值为 `YYYY-MM-DD`。支持 `min`、`max`、`required` |
| `checklist` | 单行块 | 数组 | 多选清单。`label`、`items` 必填，写入选中 ID 数组 |

### 表单与动作

| 组件 | 形态 | 绑定 | 用途与关键属性 |
| --- | --- | --- | --- |
| `form` | 容器 | 无 | 表单。`on-submit` 必填，`label` 可选 |
| `submit` | 单行块 | 无 | 提交按钮。方括号写文字，支持 `variant`、`disabled` |
| `button` | 单行块 | 无 | 动作按钮。方括号写文字，`on-click` 必填，支持 `variant`、`disabled` |

### 布局与结构

| 组件 | 形态 | 绑定 | 用途与关键属性 |
| --- | --- | --- | --- |
| `card` | 容器 | 无 | 分组内容。方括号标题可选 |
| `stack` | 容器 | 无 | 纵向排列，`gap` 为 `sm`、`md`、`lg` |
| `row` | 容器 | 无 | 横向排列，`gap` 同上 |
| `grid` | 容器 | 无 | 网格。`columns` 默认 2，`min-width` 默认 220 |
| `if` | 容器 | 无 | 条件显示。`when` 必填且必须是布尔 |
| `tabs` | 容器 | 字符串 | 页签。`bind` 必填，`label` 可选，子节点为 `tab` |
| `tab` | 容器 | 无 | 页签页。`value`、`label` 必填 |
| `accordion` | 容器 | 无 | 折叠组，子节点为 `disclosure` |
| `disclosure` | 容器 | 布尔，可选 | 折叠项。`label` 必填，`open` 默认 false |
| `each` | 容器 | 无 | 遍历数组。`items`、`key` 必填，`as`、`index` 可命名 |

### 反馈与媒体

| 组件 | 形态 | 绑定 | 用途与关键属性 |
| --- | --- | --- | --- |
| `alert` | 容器 | 无 | 提示块。`tone` 为 `info`、`success`、`warning`、`danger` |
| `tooltip` | 行内 | 无 | 悬停或聚焦说明。方括号文字必填，`text` 必填 |
| `image` | 单行块 | 无 | 图片。`src`、`alt` 必填，`caption`、`fit` 可选 |
| `icon` | 行内 | 无 | 内置图标。`name` 必填，取值见组件参考 |
| `divider` | 单行块 | 无 | 分隔线 |
| `spacer` | 单行块 | 无 | 空白，`size` 为 `sm`、`md`、`lg` |
| `spinner` | 行内 | 无 | 加载指示，`label` 默认“加载中” |
| `link-button` | 单行块 | 无 | 链接按钮。方括号文字、`href` 必填，`variant` 可选 |

### 数据展示

| 组件 | 形态 | 绑定 | 用途与关键属性 |
| --- | --- | --- | --- |
| `table` | 单行块 | 无 | 对象数组表格。`data` 必填，支持 `columns`、搜索、排序、分页 |
| `list` | 单行块 | 无 | 可点击列表。`items` 必填，`on-select` 可选 |

### 图表与时间

| 组件 | 形态 | 绑定 | 用途与关键属性 |
| --- | --- | --- | --- |
| `chart` | 单行块 | 无 | 五类图表。`data`、`label` 必填，`kind`、`x`、`y` 控制图形 |
| `plot` | 单行块 | 无 | 公式曲线。`formula`、`label` 必填，`min`、`max`、`samples` 控制采样 |
| `diagram` | 单行块 | 字符串，可选 | 节点图。`nodes`、`label` 必填，`edges`、`bind` 可选 |
| `timeline` | 单行块 | 无 | 时间线。`items`、`label` 必填，时间为分钟 |
| `timer` | 单行块 | 数字 | 倒计时。`bind`、`duration`、`label` 必填 |

## 诊断与排错

编译诊断包含代码、消息、严重程度、原始文档范围、行号和列号。Playground 显示行号和列号，点击诊断会跳到编辑器对应位置。

编译失败时预览停用，旧预览不能再操作。运行时错误显示在字段旁边，同时进入诊断面板。警告不阻止预览。

### 常见问题

| 提示或现象 | 常见原因 | 处理 |
| --- | --- | --- |
| `Unsupported Reactive MD version` | 版本不是 `0.1` 或 `0.2` | 写 `version: "0.2"` |
| `Unknown configuration field` | 顶层字段拼错或多写了字段 | 只使用 `version`、`data`、`state`、`computed`、`actions` |
| `Duplicate configuration field` / YAML 重复键 | 同一个键写了两遍 | 删除重复项，合并内容 |
| `YAML aliases/anchors/tags/merge are not allowed` | 使用了 YAML 高级特性 | 展开写，不用锚点、别名、合并键、自定义标签 |
| 配置块位置或数量错误 | 配置块不在根级、不在正文前、出现多个 | 只保留一个，放在正文之前 |
| `... is not closed` | 围栏或容器缺少结束 | 补上反引号围栏或相同数量的冒号 |
| `Unknown component` | 组件名拼错 | 看提示里的 Did you mean，查组件参考 |
| `must be used as an inline/leaf/container directive` | 冒号数量与形态不符 | 行内一个冒号，单行块两个，容器三个起 |
| `requires a label in [brackets]` | 该组件必须用方括号写文字 | 例如 `::button[提交]` |
| `does not accept a label` / `takes its label from the label attribute` | 标签来源写错 | 按“标签从哪里来”表调整 |
| `requires the "..." attribute` | 缺少必填属性 | 补 `label`、`value`、`items`、`data` 等 |
| `Unknown attribute` | 属性名拼错或该组件不支持 | 查组件参考，注意连字符 |
| `Expected one of ...` / `Expected a finite number` | 枚举值或数字格式不对 | 用允许的枚举值，数字不要加单位 |
| `does not support the on-... event` | 事件名不适用于该组件 | 按钮用 `on-click`，输入用 `on-change`，表单用 `on-submit`，列表和图表用 `on-select` |
| `references unknown action` / `requires an on-click action` | 事件指向的动作不存在或按钮缺少动作 | 在 `actions` 中定义，或补事件属性 |
| `Unknown name` / `path does not exist` / `Missing field` | 变量名或 `data` 路径拼错 | 检查根名称、字段名和作用域 |
| `Expected number, got string` | 表达式类型不对 | 数字不要加引号；字符串比较要两边都是字符串 |
| `Circular computed dependency` | 计算值互相依赖 | 拆开循环，引入一个状态或中间计算 |
| `Action ... writes ... more than once` | 同一动作重复写一个状态 | 合并步骤，`reset` 列表也不要重复 |
| `cannot write ... not a declared state` | 动作目标不是状态 | 把目标加入 `state`，或写 `data` 以外的正确名称 |
| `cannot use collection operations ... not array` | 对非数组用了 `append`、`remove`、`update` | 把状态初始化为数组，或改用 `set` |
| 索引越界 / `requires an integer index` | 删除后索引失效，或 `at` 不是整数 | 用当前 `each` 的索引，操作前判断范围 |
| `Value ... is not on the step` / `below the minimum` / `not one of the allowed options` | 初始值或写入值不满足绑定约束 | 调整初始值、`min`、`max`、`step` 或选项 |
| `Duplicate each key` / 缺少 key 字段 | 集合项没有稳定唯一键 | 给每项唯一 `id`，`key="id"` |
| `option must be a direct child` / `tabs may only contain tab` / `Forms cannot be nested` | 组件嵌套不符合规则 | 按容器子节点规则调整 |
| `No capability registered` | 宿主没有注册 `call` 名称 | 在宿主注册 capability；Playground 用内置 `catalog.search` |
| 属性必须是布尔值 / 有限数字 | 动态属性返回了错误类型 | 用比较表达式得到布尔，用数字计算得到数字 |
| table/list/checklist 显示数据形状错误 | `data` 或 `items` 不是数组，或项缺少字段 | 检查 YAML 数据结构，空数组用 `[]` |
| plot 公式错误或曲线断开 | 公式带等号、返回非数字、区间不合法 | 去掉 `formula` 前导等号，保证返回有限数字，`max` 大于 `min` |
| timer 报 duration 错误 | `duration` 不是正数 | 写大于 0 的秒数 |
| 恢复状态警告 | 文档结构或绑定约束变化 | 正常现象，会回到初始状态；确认新结构后继续编辑 |

### 排查顺序

1. 先看第一条错误。后面的错误常常是第一条的连锁反应。
2. 点击诊断，确认是配置、组件、表达式还是动作。
3. 检查配置块位置和 YAML 缩进。
4. 检查名称是否声明、类型是否匹配、路径是否存在。
5. 用 `value` 或 `stat` 临时显示中间计算值。
6. 在运行时观察区查看 `state`、`computed` 和 `revision`。
7. 修完后重新运行，确认初始状态没有错误。

表达式问题优先看类型。字符串和数字不能相加，布尔不能用数字代替，数组不能直接当数字用。

## 从需求到文档

写文档时按这个顺序推进：

1. 写下读者要完成的任务，用普通 Markdown 写正文。
2. 找出必须变化的值，放进 `state`，确定初始类型。
3. 找出固定数据，放进 `data`。
4. 写下由状态推导的结果，放进 `computed`。
5. 选择控件，把输入绑定到状态。
6. 写下动作，把用户操作变成状态变化。
7. 用布局组件组织内容，最后处理空状态、错误和移动端。

### 常见配方

| 需求 | 状态 | 计算与动作 | 组件 |
| --- | --- | --- | --- |
| 计算器 | 输入数字 | `computed` 公式，`reset` 动作 | `slider`、`number`、`value`、`stat`、`button` |
| 预约表单 | 字段和提交标记 | `on-submit` 动作读 `event.values` | `form`、`input`、`choices`、`date`、`textarea`、`checkbox`、`submit` |
| 清单进度 | 选中 ID 数组 | `len(checked)` 计算进度 | `checklist`、`progress`、`value` |
| 筛选表 | 筛选字符串 | `where`、`sort` 生成结果数组 | `select`、`table`、`each` |
| 参数图表 | 参数数字 | `computed` 公式，`plot` 采样 | `slider`、`number`、`chart`、`plot` |
| 引导说明 | 选中节点 ID | `diagram` 的 `bind` | `diagram`、`timeline`、`card`、`tabs` |
| 异步查询 | 查询词 | `call` 动作，`resources` 状态 | `form`、`input`、`submit`、`spinner`、`table` |
| 倒计时练习 | 剩余秒数 | `timer` 绑定，`computed` 换算进度 | `timer`、`progress`、`stat` |

### 写作习惯

- 状态名用名词，例如 `seats`、`tasks`、`view`。
- 计算名用结果，例如 `total`、`unitPrice`、`ranked`。
- 动作名用动词，例如 `add`、`remove`、`submit`、`restore`。
- 固定数据放 `data`，不要复制到多个状态里。
- 每个 `each` 的 `key` 用稳定 ID，不要用会变化的标题。
- 长公式拆成多个 `computed`，让诊断和阅读都更清楚。
- 关键操作旁边保留“恢复默认”或“重新填写”。
- 移动端检查 375px 宽度，确认没有横向溢出。

## 完整文档清单与参考

指南包含 10 份完整交互文档，以及“文档结构”章节中的一份结构示例，都可以直接复制到 Playground：

1. 计数器：状态、计算、动作、按钮。
2. 方案计算器：`data`、`computed`、滑块、开关、条件、货币格式。
3. 预约表单：表单、文本、选项、日期、校验、`event.values`。
4. 会变化的集合：`each`、`key`、索引、追加、删除、替换、清单、进度、表格。
5. 图表与函数图：五类图表、统计函数、公式曲线。
6. 布局、页签与折叠：网格、卡片、页签、折叠、计算标题。
7. 图解、时间线与计时：节点绑定、时间线、倒计时、正弦曲线。
8. 异步查询：宿主 capability、`resources`、状态分支、加载指示。
9. 反馈与媒体组件：标签、图标、提示、进度、统计、条件提示。
10. 筛选、列表与表格：`where`、`sort`、下拉筛选、可选择列表、逐项渲染。

更多可复用示例在 [examples](../examples)：

- [计数器](../examples/counter.reactive.md)
- [方案计算器](../examples/pricing.reactive.md)
- [方案比较](../examples/comparison.reactive.md)
- [集合与清单](../examples/collections.reactive.md)
- [表单](../examples/forms.reactive.md)
- [图表](../examples/charts.reactive.md)
- [图解](../examples/diagram.reactive.md)
- [计划与计时](../examples/planning.reactive.md)
- [组件展示](../examples/components.reactive.md)
- [异步查询](../examples/async.reactive.md)

语法细节见 [语言参考](language-reference.md)，组件属性和默认值见 [组件参考](components.md)。自定义组件、宿主 capability、持久化、流式接收和 React 嵌入属于宿主开发接口，见 [集成说明](integration.md)。

当前范围不包含地图和小游戏。真实网络请求、AI 服务和权限策略由宿主实现，文档只引用 capability 名称。

## 发布前检查

- 配置块只有一个，版本是 `0.2`。
- 所有状态、计算和动作名称都已声明，类型匹配。
- 每个输入控件的 `bind` 指向状态，初始值满足范围和选项。
- 初始状态能通过编译，没有计算错误。
- 每个按钮都有 `on-click`，表单有 `on-submit`，提交按钮在表单内。
- `each` 的 `key` 唯一且稳定。
- 渲染、搜索和分页能处理空数组。
- 移动端 375px 宽度没有横向溢出。
- 键盘可以操作输入、按钮、页签和图表。
- 错误状态有说明，异步操作可以取消。
