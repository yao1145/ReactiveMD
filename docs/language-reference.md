# Reactive MD v0.2 语言参考

第一次使用请先读 [详细用法指南](guide.md)。本文用于查阅语法和运行语义，组件属性见 [组件参考](components.md)。

Reactive MD 在标准 Markdown 中加入状态、纯表达式和声明式组件。作者编写 Markdown、YAML 和公式；组件提供交互、布局和默认样式。实现采用 TypeScript，Markdown 使用 remark、GFM 与 directive 解析。v0.1 文档继续可用。

## 配置与数据

文档开头最多放置一个根级 `reactive-md` 围栏，普通 frontmatter 可放在它之前。支持的字段为 `version`、`data`、`state`、`computed` 和 `actions`。无配置的普通 Markdown 也可显示。

````markdown
```reactive-md
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

::slider{bind="seats" label="人数" min="1" max="20"}

::toggle{bind="annual" label="年度付款"}

合计：:value{value="=total" format="currency" currency="CNY"}。

::button[重置]{on-click="reset" variant="secondary"}
````

`data` 只读，通过 `data.plans` 访问。`state` 可写，包含 JSON 标量、数组或对象。`computed` 为命名表达式，按依赖计算并检测循环。状态和计算名使用标识符，共享命名空间；`data`、`resources`、`event` 与内置函数名保留。动作有独立命名空间。

YAML 拒绝重复键、锚点、别名、合并键和自定义标签。数字必须有限。状态快照深度冻结；文档中的对象不具有原型访问能力。

## 组件语法

| 形态 | 示例 |
| --- | --- |
| 行内 | `:value{value="=total"}` |
| 单行块 | `::button[重置]{on-click="reset"}` |
| 容器 | `:::card[标题]`、正文、`:::` |

容器嵌套时外层使用更多冒号，并以相同数量显式结束。普通段落、表格、图片、引用和代码围栏继续使用 Markdown。

```markdown
::::grid{columns="2"}
:::card[基础方案]
每人 20 元。
:::
:::card[团队方案]
每人 45 元。
:::
::::
```

属性统一加引号，按照组件 schema 转换类型。`max="20"` 是数字，`disabled="false"` 是布尔值；允许动态值的属性用 `=表达式`。字符串以等号开头时使用两个等号转义，例如 `value="==说明"` 显示 `=说明`。`bind` 和事件值使用静态名称。

布局、标签、必填属性、枚举与事件见自动生成的 [44 个组件参考](components.md)。未知组件、拼错的属性、不合法的形态和缺少必需的绑定会产生源码诊断。

## 表达式

表达式支持数字、字符串、布尔值、`null`、括号、`+ - * / %`、比较、`== !=`、`! && ||` 和三元条件。字符串连接可用 `concat`。引用根状态、计算值、只读数据或当前组件的局部变量，例如 `seats`、`data.plans`、`task.title`。

数组和对象字面量写在 YAML 中。表达式使用 `at` 和 `pluck` 访问集合；例如 `at(pluck(data.plans, 'price'), 1)`。函数调用后接 `.field`、动态下标、赋值、函数定义和 JavaScript 方法调用不属于语法。

| 函数 | 用法 |
| --- | --- |
| `min`、`max` | 数值参数的最小值、最大值 |
| `round`、`abs`、`sqrt`、`floor`、`ceil` | 单个数值参数 |
| `sin`、`cos`、`tan` | 弧度制三角函数 |
| `log`、`exp` | 自然对数、自然指数 |
| `pow(a, b)` | 幂 |
| `clamp(n, min, max)` | 截取到闭区间 |
| `len(value)` | 字符串的 Unicode 码点数或数组长度 |
| `contains(value, needle)` | 字符串包含或数组中的标量匹配 |
| `range(start, end, step?)` | 生成数组，终点不包含，默认步长 1 |
| `sum(array, field?)`、`avg(array, field?)` | 数值数组或对象指定字段的和、平均值；空数组均返回 0 |
| `at(array, index)` | 整数索引；越界返回 null |
| `slice(value, start, end?)` | 字符串或数组的切片 |
| `concat(a, b)` | 连接两个字符串或两个数组 |
| `pluck(array, field)` | 对象字段投影 |
| `where(array, field, value?)` | 按字段相等筛选；省略值时按字段真值筛选 |
| `sort(array, field?, direction?)` | 稳定排序；方向为 `asc` 或 `desc`，默认 `asc` |
| `random(seed, index)` | 确定性伪随机数，范围 `[0, 1)` |

函数有类型和执行预算限制；除零、非有限结果、非法字段访问或超量数组会给出错误。

## 绑定与动作

`bind` 指向根状态名。输入的类型、范围、步长与选项由组件约束；临时的空数字草稿保留在输入框中，合法后再写入状态。文本输入支持中文组合输入，也可设置 `commit="blur"`。

事件引用命名动作。一个本地动作的所有右值读取同一个旧快照，写入与计算成功后一次提交；失败保留原状态。同一动作不能重复写同一个根状态。

```yaml
actions:
  increment:
    - set: count
      value: "=count + 1"
  clear:
    - reset: [count, tasks]
  add:
    - append: tasks
      value: "=data.nextTask"
  remove:
    - remove: tasks
      at: "=i"
  replace:
    - update: tasks
      at: "=i"
      value: "=data.replacement"
```

`set` 替换根状态，`reset` 恢复配置中的初值。`append` 追加一个值；`remove` 删除零基索引；`update` 替换索引处整个值。索引必须为范围内的整数。集合值通过 JSON 数据或表达式传递。

输入事件先提交绑定，再执行 `on-change`，动作可读 `event.value` 和更新后的根状态。这是两个独立提交：后续动作失败不会撤销已成功的输入写入。

## 集合与作用域

`each` 渲染集合中的每个值。`as` 和 `index` 设置当前项与零基索引的局部名称，默认 `item` 和 `index`。`key` 是当前项的稳定标量字段名，必须提供；集合更新时应保持键唯一。

```markdown
::::each{items="=tasks" as="task" index="i" key="id"}
:::card
### :value{value="=task.title"}

::button[移除]{on-click="remove"}
:::
::::
```

局部变量在 `each` 子树内可见，并传入其动作；根级 `computed` 不能读取行局部变量。绑定仍指向根状态，编辑单项时使用集合动作。完整示例见 [collections.reactive.md](../examples/collections.reactive.md)。

## 表单与选择

```markdown
:::form{on-submit="submit" label="预约"}
::input{bind="name" name="name" label="姓名" required="true" min-length="2"}

::textarea{bind="message" label="需求" required="true" rows="4"}

::submit[提交]
:::
```

表单提交前验证当前可见且启用的控件，并定位首个错误。`input`、`textarea` 支持长度和模式校验；日期支持范围，数值支持范围与步长。嵌套表单会被拒绝。

提交动作通过 `event.values` 读取表单绑定值，字段名默认是绑定名，`name` 可覆盖。动作也能直接读取根状态。`radio-group`、`choices`、`select` 使用 `option`；`checklist` 将选中 ID 数组写入根状态。可运行示例见 [forms.reactive.md](../examples/forms.reactive.md)。

## 图表、图解与计划

| 组件 | 数据约定 |
| --- | --- |
| `chart` | 对象数组；`x` 为横轴/标签字段，`y` 为一个或逗号分隔的多个数值字段；支持 bar/line/area/scatter/donut |
| `plot` | `formula` 是无前导等号的公式，在局部 `x` 上采样；可读根状态与计算值 |
| `diagram` | `nodes` 为 `{id, label, x, y, description?}` 数组；`edges` 为 `{from, to, label?}` 数组；可绑定选中节点 ID |
| `timeline` | `items` 为 `{id, title, start, duration, description?}` 数组；start/duration 使用数值分钟 |
| `timer` | `bind` 为剩余秒数，`duration` 为初始时长；用户启动后计时 |

```markdown
::chart{data="=data.expenses" kind="bar" x="label" y="spent,budget" label="费用与预算"}

::plot{formula="amplitude * sin(frequency * x)" min="0" max="12.56" samples="180" label="正弦波"}
```

图表提供图例、键盘/指针读数和数据表。数据或公式不合法时显示组件错误；曲线中的无效采样形成间断。参见 [charts](../examples/charts.reactive.md)、[diagram](../examples/diagram.reactive.md)、[planning](../examples/planning.reactive.md)。

## 异步宿主动作

```yaml
actions:
  search:
    - call: catalog.search
      input:
        query: "=query"
```

`call` 是动作中的唯一一步，名字引用宿主白名单中注册的 capability。输入在触发时求值，结果放入 `resources.search`，包含 `status`、`data`、`error` 和 `requestId`。状态为 idle/pending/success/error；取消回到 idle。

```markdown
:::if{when="=resources.search.status == 'pending'"}
:spinner{label="正在查询"}
:::
```

同一动作的新请求取消旧请求，迟到结果不会覆盖新请求。UI 为异步按钮和表单提供取消入口，宿主也可调用 `runtime.cancel('search')`。不同动作独立运行。结果消费需判断状态，并为组件提供正确类型的兜底值，见 [async.reactive.md](../examples/async.reactive.md)。宿主注册、会话和嵌入接口见 [集成说明](integration.md)。
