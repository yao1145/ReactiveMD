# Reactive MD 本地交互语法规范

**中文** · [English](local-interaction-syntax-en.md)

语法标识：`local-draft-3`，2026-10-31。第一次接触这套语法，建议先读 [新用户入门指南](../guides/local-guide-ch.md)；本文是完整规范。宿主通过 `compileLocal` 和 `LocalReactiveDocument` 选择本地交互模式，见 [集成说明](../integration/local-integration-ch.md)。包版本关系、0.x 兼容规则和迁移见 [版本与兼容性](../compatibility/compatibility-ch.md)，可选修订指令与 `reactive-md migrate` 见[源码修订与迁移](../compatibility/source-versioning-ch.md)。完整示例见 [示例索引](../../examples/local/README.md)。

## 1. 定位与范围

默认文档路径接受 [P0 HTML](html-compatibility-ch.md#默认支持的-p0-html) 子集；作者 CSS、JavaScript 和扩展 HTML 的开关见 [HTML 部分兼容](html-compatibility-ch.md)。开启任一作者能力时，按照暂时性分流政策将整篇源码交给原生 HTML 路径，并停止 Markdown 与 ReactiveMD 解释。

命名计算、格式化、跨字段校验、条件色调、数组与生成表格行属于本规范：`computed`/`const` 声明见 [5.4 命名值](#54-命名值)，数字、字符串与日期函数见 [5.5 格式化、字符串与日期](#55-格式化字符串与日期)，跨字段校验见 [4.4 跨字段校验](#44-跨字段校验)，数组与聚合见 [5.6 数组与聚合](#56-数组与聚合)，条件色调见 [7.2 条件色调](#72-条件色调)，生成表格见 [9.5 生成表格](#95-生成表格)。

字符长度、源码定位与资源预算的单位见[诊断与计数规则](diagnostics-counting-ch.md)。字符串 `len()` 和文本控件长度约束按 Unicode 码点计数。

Reactive MD 用于本地交互文档：作者写 Markdown、放置输入控件，读者调整参数后，相关文字、公式、图表和图解立即更新。

基础语言只需要掌握两条连接规则：`bind` 为输入命名，`{{ 表达式 }}` 在其他位置读取它。组件负责自己的选择、展开、搜索、排序、计时和重置。

本规范不包含外部服务调用、提交表单、异步资源、命名动作、事件处理器、可编程集合增删、通用循环模板或任意脚本。旧版 `state/data/computed/actions` 配置块不属于新语法。表达式可以产生字符串或数字数组，清单与多选组件继续产生字符串数组。表格可直接写为 Markdown，也可通过带预算的 `data-table` 从本地值生成行。

文档默认只保存当前实例的内存状态。重新打开从初值开始；持久化不属于作者语法。无需声明语言版本、导入组件或编写 YAML。文档可以在前导区、主题和正文之前用一行 `<!-- reactive-md: local-draft-3 -->` 可选地声明修订；无指令文档使用当前修订。见[源码修订与迁移](../compatibility/source-versioning-ch.md)。宿主应明确选择草案解析模式，不能把旧语法与新语法混合猜测解析。

文档可在正文前用 `<theme name="default">` 选择整份文档的主题，省略时为 `default`。这是静态元数据声明，不是组件；自定义主题须由宿主登记并同时支持深浅模式，见[主题协议](theme-protocol-ch.md)。

## 2. 第一份文档

```markdown
# 费用估算

<panel title="调整方案">
<slider bind="people" label="人数" initial="2" min="1" max="20">
<toggle bind="annual" label="年度付款">
</panel>

每月费用：**{{ people * (annual ? 80 : 100) }} 元**。
```

滑块声明数值 `people`，初值为 2；开关声明布尔值 `annual`，默认关闭。面板默认提供“恢复默认”，一次恢复其内部参数。

不需要跨组件联动时省略 `bind`，例如 `<counter label="人数" initial="2">`。组件仍可交互，只是没有公开变量。

## 3. Markdown 与标签

### 3.1 文档结构

标题、段落、强调、链接、图片、引用、列表、普通表格、行内代码和代码围栏继续使用 Markdown。组件标签可以位于段落或独立块中，其位置由组件类型决定。容器内部继续解析 Markdown，不要求作者额外添加 `markdown` 属性。

代码围栏支持常见编程语言，以及 `latex` / `tex`、`cattca`、`mermaid`、`jinja` / `jinja2`、`dockerfile` / `docker` 和 `vue` 的语法高亮。Vue 单文件组件中的模板、JavaScript / TypeScript、CSS / SCSS 分别高亮；Cattca 按 Markdown 正文与命令块高亮。Mermaid 围栏展示带高亮的源码。无语言标注时，在受限的常用语言集合中自动识别，并在工具栏显示识别出的语言；识别证据不足时保留纯文本。用 `text`、`txt`、`plaintext` 或 `nohighlight` 明确指定纯文本。未知语言和超过 20,000 字符的代码块保留原文；高亮与复制均保留源码空白。

块组件的开始与结束标签各占一行。开始标签的属性可以跨多行书写。标签内部的 `>` 只有在引号之外才结束标签。缩进只用于可读性：容器内容按共同缩进量去缩进，再按 Markdown 解析；代码围栏内部的缩进保持原样。

行内组件 `badge`、`tooltip`、`jump`、`text` 可以嵌入句子。其他组件为块组件；`option`、`tab`、`disclosure`、`node`、`edge`、`step`、`column` 是限定父容器内的结构子项。

### 3.2 两种标签形态

| 类型 | 写法 | 规则 |
| --- | --- | --- |
| 无正文组件 | `<slider bind="a" label="振幅">` | 不写结束标签；也接受末尾的 `/>` |
| 有正文容器 | `<card title="说明">` 和 `</card>` | 必须显式闭合，允许嵌套 |

无正文组件固定为 `input`、`textarea`、`number`、`slider`、`range-slider`、`coordinate`、`toggle`、`checkbox`、`date`、`counter`、`timer`、`progress`、`anchor`、`edge`。声明标签 `external`、`computed`、`const`、`validation` 以及结构子项 `column` 同样没有正文。其余本规范列出的组件均使用成对标签。`textarea` 的文本通过 `initial` 设置，因此属于无正文组件。

例如：

```markdown
<card title="方案说明">
价格随 **人数** 更新。

<slider bind="people" label="人数" initial="2" min="1" max="20">

总费用：{{ people * 100 }} 元。
</card>
```

标签名和属性名使用小写 kebab-case；结束标签必须与最近尚未关闭的容器匹配。不允许自动闭合或纠正错配标签。`:::card` 等旧 directive 不作为新组件解释。

### 3.3 属性

普通属性用单引号或双引号包围；布尔属性允许省略值。属性顺序无语义，重复属性报错。

| 写法 | 含义 |
| --- | --- |
| `label="人数"` | 字符串 |
| `max="20"` | 依据组件属性定义解析为数字 |
| `required` | 布尔值 true |
| `required="false"` | 布尔值 false |
| `disabled="{{ people >= 20 }}"` | 动态布尔值 |
| `max="{{ rooms * 4 }}"` | 动态数值约束（`number`、`slider`） |
| `min="{{ departure }}"` | 动态日期边界（`date`） |
| `required="{{ business }}"` | 动态必填（`input`、`textarea`、`date`） |
| `label="当前人数：{{ people }}"` | 文本插值 |
| `bind="people"` | 静态变量名 |

缺省布尔属性使用组件默认值，不统一假定为 false，例如 `panel.reset` 默认 true。

属性中的 `&quot;`、`&apos;`、`&amp;`、`&lt;`、`&gt;` 解码为相应文字；反斜杠不用于转义属性引号。数值和布尔属性的动态值必须是一个完整插值，结果保持原类型；文本属性可包含多段插值。

`bind`、`initial`、`name`、`id`、`value`（选项标识）、`to`、`from`、`answer`、`kind`、字段映射以及布局枚举是静态属性。`number`、`slider` 的 `min/max`，`date` 的 `min/max/required`，以及 `input`、`textarea` 的 `required` 可以使用一个完整插值动态求值；`step`、长度限制、选项列表和 range-slider/coordinate 的边界仍为静态。绘图的 `min/max` 也可以动态，以支持调整观察区间。`textarea` 的 `rows` 是静态行数，`data-table.rows` 则是必填表达式，两者不要混淆。

动态约束在写入和显示时检查。其他参数使范围收窄、已有值不再合法时，保留该值并在控件上显示约束错误，绝不自动裁剪或静默改成最近合法值。同名绑定必须声明相同的静态范围和步长；边界为动态时，表达式也必须相同。

未知组件、未知属性、错误位置或错误属性类型都给出源码诊断。注册的标签不直接作为任意 HTML 执行；作者不能使用 `script`、`style`、`onclick` 或其他脚本入口。

### 3.4 代码、公式与转义

正文中的 `Array<T>`、`Map<string, number>`、`x<y` 和货币 `$5`、`$10` 按文字处理；完整公式仍使用 `$...$` 或 `$$...$$`。单个未配对美元符号按文字显示。

默认路径支持 [P0 HTML 清单](html-compatibility-ch.md#默认支持的-p0-html)中的文字格式、标题、容器、折叠、引用、代码、列表、链接和图片。它们生成受控节点，复用现有主题和渲染方式。普通单换行仍按 Markdown 软换行处理。

脚注用 `[^note]` 引用，定义写为 `[^note]: 内容`，续写段落、列表和代码块按 Markdown 缩进。定义支持 Markdown 与上述基础 HTML。按首次引用顺序生成文末编号列表，重复引用共享编号并分别提供返回链接；标识符不区分大小写，重复定义采用第一条。未定义引用保留为文字，未引用定义不显示。脚注内的控件和插值保持为文字，不建立绑定或执行表达式。

行内代码和代码围栏内的标签、插值、公式标记全部按原文显示。前导区中的源码修订指令是会被识别的版本注释；其他 Markdown 注释 `<!-- ... -->` 不产生组件或变量。

正文用 `\{{` 显示字面量 `{{`，用 `\<slider>` 或行内代码显示标签示例。反斜杠的这类转义只属于 Markdown 上下文，不应用到 LaTeX 源码。

解析器先识别代码、数学区域和标签边界，再解释插值；不能通过对整篇文档的字符串替换实现语法。标签内 Markdown、嵌套容器、跨行属性与原始行列位置必须保留。

## 4. 参数、绑定与初值

### 4.1 命名和类型

`bind` 使用 `[A-Za-z_][A-Za-z0-9_]*`，区分大小写。变量类型由组件确定，不由文本内容猜测。`x`、`y`、`pi`、`e`、`true`、`false`、`null` 和表达式内置函数名保留。

| 组件 | 公开值 | 缺省初值 |
| --- | --- | --- |
| input、textarea | 字符串 | 空字符串 |
| date | 日期字符串或空字符串 | 空字符串 |
| number | 数字 | 在范围内最接近 0 的合法步长值 |
| slider | 数字 | min，默认范围 0 到 100 |
| counter | 数字 | 在范围内最接近 0 的合法步长值 |
| toggle、checkbox | 布尔值 | false |
| select、choices、radio-group | 选项字符串 | 第一项的 value |
| multi-select | 已选选项 value 的字符串数组 | 空数组 |
| range-slider | 两个数字，`start` / `end` 槽位 | start=min；end=不超过 max 的最大合法步长值 |
| coordinate | 两个数字，`x` / `y` 槽位 | 各轴最接近 0 的合法步长值 |
| 带 `key` 的 table、chart | 稳定的行标识字符串 | 空字符串（未选） |
| tabs | 页面字符串 | 第一项的 value |
| steps | 步骤字符串 | 第一步的 value |
| diagram | 节点 ID 字符串 | 第一节点的 id |
| checklist | 已选条目 ID 的字符串数组 | 由任务列表的勾选标记决定 |
| timer | 剩余秒数 | duration，默认 60 |

标量组件用 `initial` 覆盖默认值。`range-slider` 和 `coordinate` 分别用 `initial-start`/`initial-end` 与 `initial-x`/`initial-y` 设置槽位；`multi-select` 的 `initial` 是逗号分隔的静态选项 value 列表。`timer` 使用 `duration`，`checklist` 使用正文的勾选标记，两者不接受 `initial`。`table` 或 `chart` 的选择状态只有在同时提供 `key` 时才接受 `initial`。日期使用真实有效的 `YYYY-MM-DD`；空字符串表示尚未选择。

`bind` 可省略。未命名组件拥有独立内部状态，不从标签推导变量名。控件的 `label` 必填，可使用动态文本；这同时是控件的可访问名称。

### 4.2 同名控件和声明顺序

编译器在渲染前收集整个文档的绑定，包括条件区域中的绑定。正文可以引用后面才出现的参数。声明与初值不因条件真假、挂载次数或滚动位置改变。

同类数值、文本或布尔输入可以绑定同一变量，值保持同步；类型必须相同，数值范围和步长必须一致。`select/choices/radio-group` 共享变量时，value 集合与顺序也必须相同。标签文字可不同。

同一变量最多出现一次显式 `initial`。没有显式初值时，采用源码中首个控件的默认值，并校验所有关联约束。后续控件省略 `initial` 表示共享已有初值。`timer/checklist/tabs/diagram/multi-select/steps` 的公开状态各由一个组件拥有，不接受第二个同名拥有者或其他控件写入。`range-slider` 和 `coordinate` 的每个数值槽位也独占绑定。`table` 与 `chart` 只有在有序 `key` 集合完全一致时才能共享选择绑定。

引用未声明变量直接报错，不自动创建空值。组件的初值是文档初始化数据，重新显示隐藏控件不会再次初始化。

### 4.3 更新、输入草稿和重置

输入合法后立即提交，更新所有依赖它的内容。中文输入法组合输入结束后提交；数字框中的空串、负号等中间状态只保留为编辑草稿。失焦时仍不合法则提示错误，其他内容继续读取最后一次合法值。

数值约束使用有限数字，`step > 0`，`min <= max`。步长以 min 为基点，没有 min 时以 0 为基点，允许实现约定的浮点误差容限。显式 initial 越界或不在步长上时报错，不静默修正。默认初值按约束生成；与 0 等距的两个合法值取较小值，无可用步长值时报错。

禁用控件不接受读者输入。面板重置一次提交其内部全部参数和组件内部状态，触发一次一致的视图更新，并清除编辑草稿。共享变量在面板外的显示也随之改变。

条件区域隐藏时保留已有状态、标签页选择和清单勾选。隐藏区域中的计时器暂停，恢复显示后保持暂停，由读者再次启动。文档销毁后释放计时、订阅与组件状态。

### 4.4 跨字段校验

```markdown
<number bind="people" label="人数" initial="4" min="1" max="20">
<number bind="capacity" label="房间容量" initial="3" min="1" max="20">
<validation when="{{ people <= capacity }}" message="请选择能容纳 {{ people }} 人的房间。" fields="people capacity">
```

`validation` 是无结束标签的声明，必须提供 `when`、`message`、`fields`。`when` 是一个完整的布尔表达式；`message` 是提示文字，可以包含普通插值；`fields` 以空白分隔关联的公开可写绑定名，名称不能重复；多槽位控件的槽位绑定也可以列入。规则能读取控件和计算值，允许前向引用；只读声明不能作为关联字段。

约束提示文档当前是否一致。读者可以继续编辑不一致的计划，初始值不满足跨字段规则也能正常显示和修改：人数从四人改为六人后可能暂时超过容量，再换房间即可消除提示。单个控件原有的数字范围、日期合法性等规则继续拒绝非法写入。

`runtime.validate()` 按源码顺序返回当前失败规则的诊断。条件为 false 时使用 `local.validation.failed`，表达式无法求值时使用 `local.validation.expression`，错误也视为失败。一条失败规则不会阻断其他规则。结果按运行时修订缓存，对外返回副本；编辑、原子槽位更新及重置会同步刷新计算与校验，调用本身不修改状态。

渲染器显示失败提示，并通过 `aria-describedby` 和 `aria-invalid` 把提示关联到字段或其可访问分组。提示 ID 属于各自的文档实例；通过校验后清除错误文字。隐藏内容中的规则继续生效，但隐藏的提示不会主动播报。每份文档最多 100 条规则，隐藏区域也计入；诊断文字沿用 2,000 字符上限。`LocalDocument.validations` 保存可序列化的 `LocalValidation` 元数据；宿主可随时调用 `runtime.validate()`，编译后的文档仍可用 `structuredClone` 传递给 Worker。

## 5. 文本插值和表达式

```markdown
人数：{{ people }}。
合计：{{ people * 100 }} 元。
付款方式：{{ annual ? '年度' : '月度' }}。
```

插值可以出现在段落、标题、强调、列表、普通表格单元格及允许动态值的属性中。字符串、有限数字和布尔值直接显示，null 显示为空；数组需要先用 `len` 等函数转换，不隐式输出 JSON。输出按文本处理。

### 5.1 表达式集合

| 类别 | 支持内容 |
| --- | --- |
| 字面量 | 数字、单/双引号字符串、true、false、null |
| 参数 | 文档中声明的 bind 名称 |
| 算术 | `+ - * / %`、一元正负、括号 |
| 比较 | `== != < <= > >=` |
| 逻辑 | `!`、`&&`、`\|\|` |
| 条件 | `条件 ? 真值 : 假值` |
| 数学函数 | abs、sqrt、floor、ceil、round、min、max、pow、sin、cos、tan、asin、acos、atan、exp、log |
| 常用函数 | len、contains、clamp |
| 格式化 | formatNumber、formatPercent、formatScientific、formatCurrency |
| 字符串 | trim、lower、upper、startsWith、endsWith、replace、slice |
| 日期 | dateCompare、dateDiff |
| 数组聚合 | sum、average、minOf、maxOf |
| 常量 | pi、e |

优先级依次为函数/括号、一元运算、乘除余数、加减、大小比较、相等比较、逻辑与、逻辑或、条件表达式；条件表达式右结合，其余二元运算左结合。逻辑和条件表达式短路求值。

`+` 接受两个数字或两个字符串。比较不做字符串与数字的隐式转换；大小比较只接受两个数字或两个字符串；逻辑操作和 if 条件必须是布尔值。表达式字符串的转义使用 `\\`、`\'`、`\"`、`\n`、`\t`。

min/max 接受一个或多个数字；pow 接受底数和指数；clamp 接受值、下界、上界。其他数学函数接受一个数字，三角函数使用弧度，log 为自然对数。round 的半值向正无穷舍入。len 计算字符串 Unicode 码点数或数组长度；contains 检查字符串子串或数组成员。

正文公式的乘法必须写 `*`，幂使用 `pow`。LaTeX 数学区域单独采用数学书写规则。表达式没有赋值、方法调用、属性访问、自定义函数或导入，也不提供 `event`、`resources` 等旧版运行上下文。

GFM 表格中的竖线须写成 `\|`，例如逻辑或写 `\|\|`。表格解析先处理 Markdown 竖线转义，再把单元格中的表达式送入求值器。

### 5.2 计算错误

除零、定义域错误、非有限结果和类型错误显示在对应内容附近。参数本身合法时仍保留用户的新输入，其他独立内容正常更新；出错结果显示“无法计算”，不沿用旧数值冒充新结果。

### 5.3 宿主提供的只读外部数据

文档可以声明由宿主提供的只读值：

```markdown
<external name="exchangeRate" type="number">
<external name="inventory" type="number">
<computed name="priceCny" value="{{ priceUsd * exchangeRate }}">

价格：{{ priceCny }} 元
```

`name` 与绑定使用相同的标识符和保留名规则；`type` 为 `string`、`number`、`boolean`、`string-array` 或 `number-array`。声明必须独占一行并位于文档顶层，不能与控件参数或其他 external 重名，不会出现在渲染结果或状态文件中。文本插值、条件、图表和 computed 可以读取它们；`setParameter()` 不能写入。

宿主通过 `LocalReactiveDocument` 的 `externalValues` 或 `runtime.setExternalValues()` 提供值，值按声明类型和常规容量预算校验。值缺失时只影响读取它的表达式，其他内容继续工作；值到达后相关结果自动重算。缺失值不会被隐式转换为 `0`、`false` 或空字符串。静态导出和 SSR 行为相同：由宿主集成传入值，导出文件本身不抓取也不嵌入外部数据。

在交互文档中，宿主也可通过命名通道的 `mapExternalValues` 将一条订阅消息写入多个已声明的外部变量。正文插值、计算表达式和条件块可直接读取这些值。批量更新外部变量时会保留读者的输入。[命名通道的宿主配置](../plan/named-network-channels-ch.md#5-订阅与资源生命周期)

顶层 `computed` 与 `const` 声明提供只读命名值，见 [5.4 命名值](#54-命名值)。简短计算仍可就地书写；需要被正文、条件、公式和图表共享的中间结果使用声明。

### 5.4 命名值

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

`computed` 和 `const` 是不可见的无结束标签声明。每条声明独占文档顶层的一行，也接受 `/>`。两者都必须提供 `name` 和完整的 `value="{{ 表达式 }}"`。值支持数字、字符串、布尔值、null、字符串数组或数字数组；编译器推断类型，无需类型标注，也不进行隐式转换。

名称沿用 `bind` 的标识符和保留字规则。控件、槽位绑定与声明共用命名空间，声明不能覆盖其他声明或控件。容器内声明是编译错误。代码块、行内代码和注释内的声明保持原有的字面显示。

声明在整个文档中可见，可以先引用后声明。`computed` 可以读取控件、常量、其他计算值和 `<external>` 只读值。`const` 只能读取其他常量和 `pi` 等内置常量，必须独立于控件、计算值与外部数据；固定单价、阈值等参数因此无需显示禁用输入框。常量不提供编辑或重置控件。

编译器从表达式 AST 提取全部分支的依赖，按依赖顺序推断类型。未知名称、重名、自引用和间接循环都产生带源码位置的错误；未执行分支里的环也是编译错误。运算符和函数沿用普通表达式的类型规则。运行时仍可能出现域错误，例如读者把作为分母的控件改为零。

正文、动态属性、条件和图表表格中的数值单元格都可以读取命名值。可计算 LaTeX 公式中的多字母数字名称写为 `\mathrm{total}`，例如 `y = \mathrm{total} x`。格式化字符串用于正文或标签；图表数值单元格和曲线参数使用原始数字。

每个运行时独立缓存计算结果。同一修订内复用中间值；控件修改、原子槽位修改或面板重置成功后更新计算。常量在编译时求值，创建运行时时复制。隐藏内容保留其输入与计算，重置范围沿用控件子树规则。消费者读取失败的计算值时收到其表达式错误，不会得到零、null 或上次成功值；独立消费者继续工作，有效输入可让失败的消费者恢复。逻辑与条件运算符保留运行时短路语义，未访问的分支不会读取其中的失败值。静态值非法的常量直接产生编译错误。

`document.bindings` 与 `document.initialState` 描述可写控件。`document.computations` 保存可序列化的声明元数据，`document.externals` 保存只读外部声明。`runtime.snapshot().state` 还包含本次修订成功求出的命名值，失败值缺席；需要保留错误语义时使用 `runtime.evaluate(name)`。`set` 和 `setMany` 不能修改声明。对外数组继续防止外部修改污染运行时。

声明诊断采用 `local.computation.*`：`placement`、`name`、`reserved`、`duplicate`、`value`、`unknown`、`cycle`、`const`、`expression`、`budget`；表达式类型错误沿用 `local.expression.*`，诊断包含源码范围、行号和列号。计算图采用迭代式依赖排序，长链不依赖递归求值；源码、语法节点、表达式和值的既有预算继续生效，循环诊断数量也受诊断预算限制。

表达式函数名是保留标识符，控件不能绑定 [5.1](#51-表达式集合)中列出的 `sum`、`formatNumber`、`dateDiff` 等名称，编译器给出保留名诊断。已有文档中同名的旧绑定需改名，并同步修改引用。

### 5.5 格式化、字符串与日期

四个格式化函数都返回字符串，可选参数按位置传入。

| 函数 | 默认值与示例 |
| --- | --- |
| `formatNumber(value, digits, locale, grouping)` | `digits=2`、`locale="en-US"`、`grouping=true`；`formatNumber(1234.5)` 得到 `"1,234.50"` |
| `formatPercent(value, digits, locale)` | `digits=0`、`locale="en-US"`；`formatPercent(0.125, 1)` 得到 `"12.5%"` |
| `formatScientific(value, digits, locale)` | `digits=2`、`locale="en-US"`；`formatScientific(1234)` 得到 `"1.23E3"` |
| `formatCurrency(value, currency, digits, locale)` | `currency="USD"`、`digits=2`、`locale="en-US"`；`formatCurrency(12.5)` 得到 `"$12.50"` |

`digits` 必须是 0 至 20 的整数，同时固定最少与最多小数位；JPY 等货币也遵守该规则。`grouping` 必须是布尔值。地区只接受 `en-US`、`zh-CN`、`de-DE`、`fr-FR`、`ja-JP`，省略时固定为 `en-US`，与界面语言、设备设置无关；不支持的地区会报错。货币代码必须是 `Intl.NumberFormat` 接受的三个大写 ASCII 字母，这是代码形式检查，不是流通货币名录验证。

格式化采用十进制 `halfExpand` 舍入，中点向远离零的方向舍入：`formatNumber(1.005)` 为 `"1.01"`，`formatNumber(-1.005)` 为 `"-1.01"`。零不显示负号。表达式运算仍使用有限的 JavaScript 数字；`round(x)` 保留 `Math.round` 的中点向正无穷规则。格式化只改变显示，不改变源数值。

null 格式化为空字符串，其余参数严格检查类型，不把字符串自动转为数字；应用函数前先判断可选日期或文本。地区对应的标点、货币符号与空格来自宿主的 `Intl` 数据；跨平台需要逐字一致时，宿主应固定运行时及地区数据版本。

| 函数 | 规则 |
| --- | --- |
| `trim(text)` | 去除首尾 JavaScript Unicode 空白 |
| `lower(text)`、`upper(text)` | 使用不依赖地区的默认 Unicode 大小写映射 |
| `startsWith(text, search)`、`endsWith(text, search)` | 区分大小写的字面匹配，空搜索串匹配成功 |
| `replace(text, search, replacement)` | 替换全部不重叠的字面匹配；空搜索串报错；`$&` 等替换文本保持字面含义 |
| `slice(text, start, end)` | 按 Unicode 码点索引，终点不包含在结果内，默认到末尾；负索引从末尾计算；索引必须为整数，超界时截到边界 |

这些函数要求字符串，null 也产生类型错误；不接受正则表达式或属性访问。码点不等于字素簇，一个组合表情或带组合重音的字母可能包含多个码点。所有结果沿用 100,000 个 UTF-16 代码单元的字符串预算；替换函数在分配超大结果前检查扩张长度。

`dateCompare(a, b)` 返回 `-1`、`0` 或 `1`。`dateDiff(a, b, unit)` 返回有符号的 **a 减 b**，默认单位为 `"days"`，还支持 `"hours"`、`"minutes"`、`"seconds"`、`"milliseconds"`。

两项输入必须是有效的 `YYYY-MM-DD` 字符串，年份为 `0001` 至 `9999`，与日期控件一致，按公历校验闰日。每个日期表示 UTC 零点，因此设备时区和夏令时不会改变结果：`dateDiff("2026-03-09", "2026-03-08", "hours")` 为 `24`。时间戳、时区后缀和有歧义的地区日期格式会被拒绝。

空日期控件的值为 `""`，表示未选择日期。空串或非法日期产生域错误，null 产生类型错误。可选日期应先判断：

```markdown
<computed name="days" value="{{ startDate == '' || endDate == '' ? null : dateDiff(endDate, startDate) }}">
天数：{{ days == null ? '请选择两个日期' : formatNumber(days, 0) }}
```

### 5.6 数组与聚合

```markdown
<const name="fixedFees" value="{{ [100, 20, 5] }}">
<computed name="fees" value="{{ [people * 80, includeKit ? people * 20 : 0] }}">

第一项：{{ fees[0] }}。合计：{{ sum(fees) }}。
```

数组字面量只能包含同一种类型的字符串或有限数字，元素表达式可以读取文档命名值。嵌套数组、混合类型、布尔值和 null 元素会被拒绝。`[]` 默认是空数字数组；条件分支直接写空字面量时，可采用另一分支的字符串数组类型，因此字符串多选值也可使用 `show ? subjects : []`。已有清单与多选控件继续产生字符串数组。公开类型 `LocalValue` 增加 `number[]`，`LocalValueKind` 增加 `number-array`，原来的 `array` 继续表示字符串数组。

索引从零开始，`values[0]` 读取第一项。索引必须是有限的安全整数；超出范围的整数（包括负数）返回 null，非整数报错。字符串和其他标量不能作为数组索引。数组不能直接插值显示，应使用索引、`len`、聚合或数据表格。

`len` 支持两种数组；`contains` 在字符串数组中接受字符串，在数字数组中接受数字，原有字符串子串检查不变。每个数组最多 10,000 项；数组字面量还计入既有表达式长度、AST 节点和求值预算。字符串数组内容继续受字符预算限制。运行时返回数组副本，快照数组被冻结。

| 函数 | 结果 |
| --- | --- |
| `sum(values)` | 数字数组之和，空数组返回 `0` |
| `average(values)` | 算术平均值，空数组返回 null |
| `minOf(values)` | 最小项，空数组返回 null |
| `maxOf(values)` | 最大项，空数组返回 null |

聚合只接受数字数组，不自动转换看起来像数字的字符串。结果使用有限的 JavaScript 数字，求和或结果溢出会产生表达式错误；`average` 先求和再除以项数，中间求和溢出也会报错。空聚合产生的 null 沿用可空表达式规则，需要时先判断再参与数值运算。标量 `min`、`max`、`round` 保持原有签名与行为。

聚合函数名与格式化、字符串、日期函数名都是保留标识符，冲突的旧绑定需要改名。对 `LocalValueKind` 做穷举检查的宿主应加入 `number-array`；可写多选与清单控件仍只接受字符串数组。

## 6. 输入与参数面板

所有输入组件支持 `label`、可选 `bind`、可选初值和动态 `disabled`。允许的附加属性如下；未列出的属性不属于本规范。

| 组件 | 附加属性及默认值 |
| --- | --- |
| input | type=text/email；placeholder；required=false（可动态）；min-length=0；可选 max-length |
| textarea | placeholder；rows=4；required=false（可动态）；min-length=0；可选 max-length |
| number | 可选 min/max（可动态）；step=1 |
| slider | min=0；max=100（均可动态）；step=1 |
| range-slider | bind-start/bind-end 与 initial-start/initial-end；min=0；max=100；step=1；可选 color |
| coordinate | bind-x/bind-y 与 initial-x/initial-y；x-min/y-min=-5；x-max/y-max=5；step=1；可选 color |
| counter | min=0；可选 max；step=1 |
| toggle、checkbox | 可选 color |
| date | 可选 min/max 日期（可动态）；required=false（可动态） |
| select、choices、radio-group、multi-select | 正文为一个或多个 option；multi-select 增加 max-selected，值为字符串数组 |

`multi-select` 是有正文容器，正文为一个或多个 `option` 子项，`label` 必填，`bind` 可省略；公开值为按源码顺序排列的字符串数组，默认空数组，该绑定为独占 family。`initial` 是逗号分隔的静态选项 value 列表；option.value 非空、唯一且不含逗号。`max-selected` 为非负整数，默认选项数。组件内置搜索和清空，达到上限后仍可取消已选项，`disabled` 可以使用布尔表达式；写入按源码顺序规范化，并保留已有数组大小和字符串预算。重置清除本地搜索并恢复初始选择，隐藏时保留搜索与选择。

`range-slider` 和 `coordinate` 是无正文组件，`label` 必填，支持 `color` 与动态 `disabled`。每个 `bind-start`/`bind-end` 或 `bind-x`/`bind-y` 命名一个独占的数值槽位，省略时该槽位只保留内部状态，不能与其他控件共享；每个槽位最多一处显式初值。`x`、`y` 仍是保留参数名。范围与步长都是静态有限数，`step` 必须为正。`range-slider` 默认 `min=0`、`max=100`、`step=1`，起点默认 `min`，终点默认不超过 `max` 的最大合法步长值；`coordinate` 两个轴默认 -5 到 5，各轴初值取最接近零的合法值，支持拖动、键盘和数值输入，指针输入吸附到合法步长。端点交叉会被拒绝，不会自动交换。所有槽位在编译时初始化；多值写入和重置均为原子更新，拒绝写入时状态与 revision 保持不变。

宿主使用 `runtime.get(node, slot?)`、`runtime.set(node, value, slot?)` 和 `runtime.setMany(node, values)` 读写槽位：`range-slider` 的槽位名为 `start`/`end`，`coordinate` 为 `x`/`y`，`setMany` 以槽位名作为对象键。运行时按登记的节点和槽位校验，非法批量写入保留整个快照与 revision，原有单值调用保持有效；调用方伪造的属性不改变权限或约束。

选择器示例：

```markdown
<choices bind="plan" label="使用方式" initial="personal">
<option value="personal">个人使用</option>
<option value="team">团队使用</option>
</choices>
```

option.value 为非空、静态、唯一字符串；正文是选项的行内文字，可含强调，不能含另一个交互组件。select 是下拉框，choices 是选项卡片，radio-group 是单选按钮组，绑定规则相同。

`required`、长度和 email 格式在首次失焦后显示提示，之后随输入更新。控件允许文档初始值为空；提示不产生提交或网络操作。格式无效的新文本保留为草稿，不替换最后合法的公开值。空初值在读者填写前公开为空字符串。

`counter` 自带减、加和恢复初值按钮，到达范围边界时禁用对应操作。`timer` 支持 label、可选 bind、duration（正整数秒，默认 60）；自带开始、暂停、重置，到零停止，按实际经过时间更新，切到后台不累计计时误差。

`panel` 为容器，支持可选 title 和 reset（默认 true）。默认纵向排布，提供“恢复默认”。`reset="false"` 隐藏重置操作。嵌套面板允许：内层重置只影响内层，外层重置包含整个子树；条件中尚未显示的子控件也属于范围。面板重置同时恢复子树中的表格查询、排序、分页、标签页、表格与图表选择以及图解选择。

## 7. 布局与内容探索

| 容器 | 属性 | 正文与默认行为 |
| --- | --- | --- |
| card | 可选 title | 普通 Markdown；一块内容卡片 |
| grid | columns=2（整数 1–4，表示最大列数） | 直接子项为 card；按容器可用宽度减少列数，适用于嵌套网格和嵌入文档 |
| tabs | 可选 label、bind、initial | 一个或多个 tab，默认选第一项 |
| tab | label 必填，可选 value | 普通 Markdown |
| accordion | 可选 label | 一个或多个 disclosure |
| disclosure | label 必填；open=false | 点击展开，多个条目可同时打开 |
| if | when 必填，完整布尔插值 | 为真时显示 Markdown 与组件 |
| alert | 可选 title；tone=info/success/warning，默认 info | 普通 Markdown |
| badge | tone=neutral/success/warning，默认 neutral | 行内文字 |
| tooltip | text 必填 | 可聚焦的行内说明文字 |

tab 未写 value 时，按源码顺序生成 `tab-1`、`tab-2` 等；同组 value 必须唯一。tabs 无 bind 时不用命名页面状态，有 bind 时对外公开当前 value。标签切换保留子内容状态，隐藏计时器暂停。accordion 内 open 初值在重置时恢复。

if 的 when 为假时不显示内容，内部参数仍按第 4 节初始化。未知变量或类型错误在隐藏分支中仍是编译错误。

### 7.1 跳转、颜色与分步阅读

| 容器或行内标签 | 属性 | 正文与默认行为 |
| --- | --- | --- |
| jump | to 必填；appearance=link/button，默认 link；可选 color | 行内 Markdown；滚动到标题锚点或显式 anchor |
| anchor | id 必填且文档内唯一 | 无正文；标记显式跳转目标 |
| text | color 必填 | 行内 Markdown 与插值；设置前景色 |
| section | color 必填 | 块级 Markdown；设置可继承的前景色，不添加边框或背景 |
| quiz | type=choice/number，默认 choice；label 与 answer 必填；可选 explanation、tolerance | 选择题含 option；数字题正文为空；不公开 bind |
| steps | 可选 label、bind、initial；字符串绑定独占 | 一个或多个 step；默认选第一步 |
| step | label 必填；可选 value | Markdown 正文；省略 value 时生成 step-1、step-2 等 |

`jump.to` 与 `anchor.id` 匹配标题锚点或显式 ID，`to` 不写前导 `#`。重复 anchor、与标题锚点冲突或目标不存在都是编译错误。`anchor.id` 匹配 `[A-Za-z_][A-Za-z0-9_-]*`，实际 DOM ID 按文档实例隔离。点击后滚动并移动焦点；目标隐藏时显示局部提示，并保留读者已填写的参数。普通 Markdown 片段链接 `[结果](#result)` 同样指向显式 anchor。

`color` 是静态颜色名或 `#RGB`、`#RRGGBB`，不接受表达式、CSS 函数、变量或声明；颜色名由共享校验表限定，无效值给出编译诊断。`text` 和 `section` 必须提供 `color`，设置前景色且不添加边框或背景，内层显式颜色覆盖继承，链接和交互控件保留自身配色。`jump`、`badge`、`progress`、`slider`、`toggle`、`checkbox`、`select`、`choices`、`radio-group`、`checklist`、`multi-select`、`range-slider` 和 `coordinate` 可选 `color`：`jump` 与 `badge` 用于文字或强调色，`progress` 用于填充色，输入组块用于激活、选中与进度显示，省略时沿用主题。`tone` 的语义保持不变。

`quiz` 的 `type` 默认 choice，`label` 与 `answer` 必填；choice 接受 `option`，`answer` 必须是现有 value。number 的正文为空，`answer` 为有限数，`tolerance` 默认为 0，为非负的绝对误差。`explanation` 可选，可含文本插值。组件内置检查答案、反馈与重试，不公开 `bind`；答案随源码提供，适合自学练习。隐藏后保留草稿与反馈，面板重置清除它们。

`steps` 只接受一个或多个 `step`。`steps.label` 可选，`bind` 可选且独占；`initial` 默认第一步 value。`step.label` 必填，`value` 可省略，按顺序生成 `step-1`、`step-2` 等，同组唯一。组件提供上一步、下一步和当前位置；仅当前内容显示，所有子控件仍参与编译和初始化。切换保留内容状态，隐藏计时器暂停；面板重置恢复初始步骤和子内容。

基础排版使用 Markdown；图片用 `![说明](../路径)`，链接用 `[文字](../地址)`，分隔线用 `---`。图片需由宿主通过 URL 策略明确允许后才加载，默认不产生图片请求，集成方式见[图片与链接策略](../integration/local-integration-ch.md#图片与链接策略)。本规范不提供 row、stack、spacer、icon、image、link-button 等对应的作者标签，也不开放 class/style。

### 7.2 条件色调

```markdown
<badge tone="{{ total <= budget ? 'success' : 'warning' }}">{{ formatCurrency(total) }}</badge>
<alert tone="{{ total <= budget ? 'info' : 'warning' }}">预订前请核对预算。</alert>
```

`badge` 与 `alert` 的 `tone` 可以用字符串表达式动态设置。`badge` 接受 `neutral`、`success`、`warning`，`alert` 接受 `info`、`success`、`warning`；静态值保持原有行为。表达式必须是字符串类型，渲染器还会检查结果是否属于组件允许的枚举。表达式错误或非法值会回退默认 `tone`，并显示计算提示，不影响其他内容。

有限枚举可表达警告和成功状态，同时让主题继续控制颜色与对比度。这个条件接口不引入作者 CSS、样式字符串或动态颜色。

## 8. 可勾选清单

```markdown
<checklist bind="done" label="体验清单">
- [x] 读懂源文档
- [ ] 调整参数并观察结果
- [ ] 在手机宽度试用
</checklist>

已完成 {{ len(done) }} / 3 项。
<progress label="完成进度" value="{{ len(done) / 3 * 100 }}">
```

checklist 正文是非空、单层 Markdown 任务列表，默认由读者勾选。普通 Markdown 任务列表仍是静态内容。条目可含行内 Markdown，但不能含嵌套任务列表或交互组件。勾选后仅该项正文加删除线并变淡，取消勾选后恢复；初始 `[x]` 条目也呈现完成样式。

固定条目依次生成 `item-1`、`item-2` 等内部 ID；公开值为按源码顺序排列的已勾选 ID 数组，未选择时为 []。文档实例期间条目不增删、重排；编辑源码并新建实例后重新生成。重置恢复 `[x]` / `[ ]` 指定的初始状态。支持 label、可选 bind、动态 disabled。

progress 是无正文组件，label/value 必填，max 默认 100，支持动态 value；max 必须为正有限数，value 在 0 到 max 之间，越界显示诊断，不悄悄截断。

## 9. 表格与统计图表

### 9.1 共同的数据规则

ReactiveMD 的 table、chart、timeline 组件正文各为一张 Markdown 表格。表头非空且唯一，每行列数一致；单元格可以有插值。第一列通常为标签，其他列根据组件要求读取类型。

`<table>` 也可使用原生 HTML 表格正文；两种语法按正文结构区分，共用渲染样式。HTML 写法支持合并单元格，默认不添加表格交互，详见 [HTML 表格兼容](html-compatibility-ch.md#两种表格写法)。

普通文本单元格显示 Markdown；纯十进制或科学计数法文本单元格可读为数值，单个完整插值保留其结果类型。混合文本如 `{{ price }} 元` 是显示字符串，不能用作图表的数值列。图例标签取表头的纯文本。

不要求先声明 YAML 数组，也不接受远程 URL、data 属性或接口返回值。空行、非数值、缺失列等错误定位到对应单元格。

### 9.2 增强表格

```markdown
<table label="组件目录" page-size="3">
| 名称 | 分类 | 价格 |
| --- | --- | ---: |
| 文档 | 基础 | 20 |
| 表单 | 输入 | 45 |
| 图表 | 视觉 | 80 |
</table>
```

table 支持可选 label、searchable=true、sortable=true、page-size=10（正整数）。默认提供搜索框、可排序表头和分页；只有一页时隐藏分页控件。

搜索是全列显示文本的大小写不敏感子串匹配，去掉查询首尾空白；排序使用完整列的类型，数值列按数值，其余按文本 Unicode 码点顺序，保持同值行的原始顺序。表头点击依次升序、降序、恢复源码顺序。搜索或排序变化回到第一页，响应式数据变化后把当前页限制到有效范围。无匹配项显示“没有匹配结果”。这些交互只影响表格内部。

`key` 指向静态、非空、唯一的文本列，列值不能包含插值。只有提供 `key` 时才启用选择状态，`bind` 与 `initial` 也要求同时提供 `key`；空字符串表示未选，显式 `initial` 必须匹配现有行。点击或键盘选择写入稳定标识符，排序、搜索、分页和图表隐藏图例都保留选择；面板重置恢复文档初始选择。`table` 与 `chart` 只有在有序 `key` 集合完全一致时才能共享选择绑定，且最多一处显式初值。没有 `key` 的文档保持原行为，不增加隐含绑定。

### 9.3 图表

```markdown
<chart kind="bar" title="费用与预算">
| 项目 | 实际 | 预算 |
| --- | ---: | ---: |
| 内容 | 120 | 150 |
| 视觉 | 230 | 200 |
</chart>
```

chart.kind 默认为 bar，支持 bar、line、area、scatter、donut、pie。支持可选 title、x、y、x-label、y-label。x/y 为静态表头名称，y 可使用逗号分隔的多个列名，因此列名不能包含逗号。

| 类型 | 默认列规则 |
| --- | --- |
| bar、line、area | 第一列为横轴，其余列为数值系列 |
| scatter | 第一列为数值横轴，其余为数值纵轴；也可用 x/y 指定 |
| donut | 第一列为标签，第二列为数值；多于两列时必须用 y 指定唯一数值列 |
| pie | 与 donut 使用相同的表格规则，以实心饼图显示占比 |

line/area 的横轴按整列类型确定为数值轴或分类轴，按源码顺序连接。donut/pie 数值必须非负，总和为零时显示“暂无占比”。系列名称自动成为图例；默认提供指针与键盘读数，无需事件逻辑。

default theme 的交互图表提供主题化提示框、图例聚焦与 200ms 数据过渡。折线和面积图读取同一行的可见系列；柱状图仅读取当前一根柱；散点图定位最近点；饼图和环形图显示数值及当前可见总和中的占比。静态模式保留完整数据图形，关闭悬浮交互与动效。

数值列会随参数更新。计算错误显示在对应图表，不将错误值替换为 0。提供 `key` 时，图表可以通过 `bind` 公开选择，使用与 `table` 相同的稳定行标识和选择保留规则。

### 9.4 时间轴

timeline 支持可选 title、unit（显示文本，默认“分钟”），正文为包含 `事项`、`开始`、`时长` 三列（可选 `说明`）或 `Task`、`Start`、`Duration` 三列（可选 `Notes`）的表格。这些列名是固定表头；开始和时长为非负数。按开始时间稳定排序，允许重叠区间，说明通过指针或键盘查看。表格内容可以使用插值。

### 9.5 生成表格

```markdown
<const name="subjects" value="{{ ['mathematics', 'physics', 'chemistry'] }}">

<data-table label="主题准备工作" rows="{{ subjects }}" key="{{ item }}" max-rows="3">
<column label="主题" value="{{ item }}">
<column label="序号" value="{{ index + 1 }}">
<column label="准备工作" value="{{ item == 'chemistry' ? '准备材料' : '准备例题' }}">
</data-table>
```

`data-table` 是成对的块组件，必须提供可访问名称 `label`、完整数组表达式 `rows`，以及完整字符串或数字表达式 `key`。子内容只能是 1 至 20 个无结束标签的 `column` 声明。列必须提供静态标题 `label` 和完整的标量 `value` 表达式；单元格只输出文本，null 为空单元格。

每行有两个局部名称：`item` 是当前字符串或数字，`index` 是当前从零开始的位置。列表达式中这两个名称覆盖同名全局值，其他引用仍读取文档环境；`rows` 自身使用普通文档作用域。

键表达式只能依赖 `item`，且至少引用它一次，不能依赖 `index` 或其他文档值。表格检查键是否为非空字符串或有限数字，并确保唯一。数字键和字符串键属于不同标识，数字正负零视为同一标识；条目重排时保留 React 行身份。需要重复显示值时，应以不同的本地 ID 组成 `rows`，再根据 ID 生成显示列。重复键或非法键会使整张表显示错误。

`max-rows` 是 1 至 1,000 的静态整数，默认 100。整份文档各表声明的行预算总和最多 2,000，行预算乘列数的总和最多 10,000 个单元格，隐藏表格也计入。每张生成表还有 100,000 个 UTF-16 代码单元的预算，覆盖表头、单元格、错误或空状态占位文字及编码后的行键。渲染器在显示行之前检查预算，超出时显示错误，不截断数据。

空数组显示表头与空状态。数据源或键求值失败时清除表格行并显示错误；单元格表达式失败只影响该单元格，其余内容继续显示。组件只生成原生表格行，不重复任意文档区块或控件。原有 Markdown 表格及其图表输入保持原有行为。

## 10. LaTeX 公式与函数绘图

### 10.1 显示与绘图

公式由 KaTeX 排版，使用随包提供的数学字体，输出用于显示的 HTML 和用于辅助技术的 MathML。标准样式中的字体已内联，预览、打印及导出的单文件 HTML 均可离线显示公式；使用 `reactive-md/react/unstyled` 时，宿主需加载 `reactive-md/styles.css` 或提供 KaTeX 样式及字体。公式展示与绘图求值分别处理。

正文用 `$...$` 或 `\(...\)` 写行内公式，用 `$$...$$` 或 `\[...\]` 写独立公式。美元定界的行内公式在同一行配对，允许首尾空白，例如 `$ x $`、`$x $`、`$ x$`；内容须包含非空白字符。普通金额文本（如 `$5 and $10`）保持字面含义，普通美元符号也可写 `\$`。反斜线定界的公式允许首尾空白和跨行，例如句子中的 `\(\frac{a}{b}\)`，或独立公式 `\[x^2 + 1\]`。未闭合的公式定界符报错；没有配对的单个美元符号保留为文本。代码、注释和 Markdown 链接目标中的定界符保持字面含义；正文中展示写法时，转义开头的反斜线或使用代码。

独立公式用于排版，不创建状态、不发布函数。plot 容器内每个 `$$...$$` 块定义一条曲线，数学内容保持正常 LaTeX 写法，不需要 `{{ }}`。plot 仍只接受 `$$...$$`，不接受 `\(...\)` 或 `\[...\]`。

排版支持 KaTeX 的数学命令和环境，包括 `cases`、`aligned`、`align`、`align*`、`matrix`、`pmatrix`、`bmatrix`、`vmatrix`。用 `&` 分列，`\\` 换行；对齐环境按右、左交替对齐列，矩阵单元格居中，并显示对应括号。`align` 与 `aligned` 均在公式定界符内使用；独立公式的编号通过 `\tag{1}` 显式添加，`\tag*{A}` 不加括号。`\displaystyle`、`\textstyle`、`\limits` 和 `\nolimits` 控制公式尺寸与上下限布局。

| 排版内容 | 命令示例 |
| --- | --- |
| 字体与文本 | `\mathbb{R}`、`\mathcal{F}`、`\mathscr{L}`、`\mathfrak{g}`、`\textbf{文字}` |
| 组合数、标注与边框 | `\binom{n}{k}`、`\underbrace{a+b}_{n}`、`\overrightarrow{AB}`、`\underline{x}`、`\boxed{x}` |
| 上下标注与带标签箭头 | `\stackrel{!}{=}`、`\underset{x}{\lim}`、`\xrightarrow[下方]{上方}`、`\xrightleftharpoons[k_2]{k_1}` |
| 逻辑、关系与符号 | `\implies`、`\iff`、`\not\in`、`\cong`、`\mapsto`、`\mid`、`\ll`、`\oplus`、`\varnothing`、`\therefore`、`\because`、`\triangle`、`\circ`、`\dagger`、`\vdots`、`\ddots` |
| 箭头、定界符与尺寸 | `\rightleftharpoons`、`\longrightarrow`、`\Longleftrightarrow`、`\downarrow`、`\lfloor`、`\rfloor`、`\lceil`、`\rceil`、`\bigl(`、`\bigr)`、`\Bigg(` |
| 函数与同余 | `\sec`、`\csc`、`\cot`、`\sinh`、`\cosh`、`\lg`、`\pmod{n}` |

`align` 按行自动编号；使用 `align*` 或 `aligned` 可省略自动编号。编号计数在每个文档内独立。

化学式使用 mhchem 语法 `\ce{...}`，例如 `$\ce{H2O}$`、`$\ce{SO4^2-}$`、`$\ce{^{14}_{6}C}$`、`$$\ce{2 H2 + O2 -> 2 H2O}$$`、`$$\ce{A <=>[正向][逆向] B}$$`。分子下标、离子电荷、同位素、系数、物态、化学键和反应箭头由 KaTeX 的 mhchem 扩展排版。无效或不支持的公式给出 `local.math.display` 警告，整条公式按有界的原始文本显示。输入和转换受资源预算限制，作者自定义宏、HTML、文件和网络入口关闭。这些排版语法可在普通公式中使用；绘图计算支持的语法见下一节。

```markdown
<slider bind="a" label="振幅" initial="1" min="0" max="5">

<plot min="-10" max="10">
$$ y = a \sin x + \frac{x^2}{10} $$
</plot>
```

plot 正文只能是空白和一个或多个独立公式块。每块按以下四种形式之一定义一条曲线：

```markdown
<plot min="-10" max="10">
$$ y = a \sin x + \frac{x^2}{10} $$
$$ \begin{cases} x = t - \sin t \\ y = 1 - \cos t \end{cases} $$
$$ r = a(1 + \cos\theta) $$
$$ (x^2 + y^2)^2 = 2a^2(x^2 - y^2) $$
</plot>
```

第一块是显式 `y = f(x)`。第二块是参数方程：`x` 与 `y` 写成 `t` 的函数，`t` 从 `min` 取到 `max`，两轴按采样点自动适配。其余关于 `x` 和 `y` 的方程按隐式处理，在 `min` 到 `max` 的方形区域内追踪等值线，两轴再按追踪结果适配。多曲线用多个公式块，不把普通换行作为分隔符。

第三块是极坐标 `r = f(\theta)`：`min`、`max` 指定角度范围，单位为弧度。直接输入的 `θ` 与 `\theta` 等价，也可混用。它们是曲线内的局部角变量，其他数字参数可读取文档绑定。每个采样点按 `x = r cos(θ)`、`y = r sin(θ)` 转为平面坐标，两轴按结果自动适配；负半径保留方向，无法求值的半径形成断点。以下示例在一周角内均匀采样 1000 点：

```markdown
<plot min="0" max="{{ 2 * pi }}" points="1000">
$$ r = 1 + \cos\theta $$
</plot>
```

plot 支持 min=-10、max=10（可动态，要求 min < max）、points=200（静态整数 2–2000）、可选 label、x-label="x"、y-label="y"；属性值须加引号，例如 `points="1000"`。旧属性 `samples` 继续有效，同时设置时以 `points` 为准；两者都省略时默认 200。每个 plot 最多 16 条曲线。显式、参数或极坐标曲线请求指定数量的采样点，包含区间两端；隐式曲线每轴使用指定数量的网格点（上限 100、下限 32），按网格面积计入请求点数。整篇文档所有曲线合计最多请求 20,000 点，包括隐藏区域。各曲线共享计算预算，超限会停止计算并报告。纵轴依据当前范围内的有限采样值自动确定；没有有效值则给出空态。常量曲线应增加可见纵轴余量。

### 10.2 可计算的 LaTeX

下面是本规范绘图计算必须支持的数学写法。公式排版与计算能力分别校验；能够排版不代表能够求值。

| 数学内容 | 写法 |
| --- | --- |
| 数字、四则运算 | `2`、`0.5`、`+`、`-`、`/`、`\cdot`、`\times` |
| 隐式乘法 | `2x`、`ax`、`a\sin x`、`(x+1)(x-1)` |
| 幂 | `x^2`、`x^{a+1}`、`e^x` |
| 分数 | `\frac{a}{b}`、`\dfrac{a}{b}`、`\tfrac{a}{b}` |
| 根式 | `\sqrt{x}`、`\sqrt[3]{x}` |
| 分组 | `(...)`、`{...}`、`\left(...\right)` |
| 三角函数 | `\sin`、`\cos`、`\tan`、`\arcsin`、`\arccos`、`\arctan` |
| 指数对数 | `\exp(x)`、`\ln x`、`\log x`、`\log_{2}x` |
| 绝对值 | `\lvert x\rvert`、`\left\lvert x\right\rvert` |
| 其他函数 | `\min(a,b)`、`\max(a,b)` |
| 常量 | `\pi`、`e` |
| 分段函数 | `\begin{cases} ... \end{cases}` |
| 分段条件 | `=`、`\ne`/`\neq`、`<`、`>`、`\le`/`\leq`、`\ge`/`\geq` |

三角函数用弧度；ln 为自然对数，无底数的 log 约定为以 10 为底，带下标时使用所写底数。根式计算实数，奇数整数次根允许负数，偶数次根的负数输入为无效采样。绝对值同时接受成对竖线及 `\left|...\right|`；竖线必须配对，不能猜测缺失的边界。

乘法必须在表达式语境中使用 `*`，在 LaTeX 中允许省略。LaTeX 乘除（含隐式乘法）同级、从左到右，幂先于一元负号，因此 `-x^2` 为 `-(x^2)`。`1/2x` 按 `(1/2)x` 解释，建议用分式写清分母。

无括号函数读取紧随的一项乘积，遇加减、比较、逗号或下一个函数命令结束，例如 `\sin 2x` 是 sin(2x)，`\sin x + a` 是 sin(x)+a，`\sin x\cos x` 是 sin(x)cos(x)。复杂参数建议用括号。支持 `\sin^2 x` 表示 `(sin x)^2`；反三角函数使用 arcsin 等明确名称，不把 `\sin^{-1}` 猜测为反函数。

`\left`、`\right`、数学空白命令 `\,`、`\;`、`\!`、`\quad` 和 `%` 到行尾的注释不改变计算。分段函数的 `&` 分隔值和条件，`\\` 分隔分支；按顺序取首个条件为真的分支。可用 `\text{otherwise}` 作为最后默认分支，没有命中分支则该点无定义。条件仅支持单次比较；用多个分支表达复杂分段。

矩阵、求和、积分、导数以及自定义宏不在可计算集合中。遇到这些结构应保留公式显示并指出不能计算的命令或结构，不能按另一个公式猜测绘图。参数方程的 `cases` 块中，`t` 是参数，分支不能读取 `x`。数学渲染器须禁用文件、网络、HTML 和宏执行入口。

### 10.3 参数名映射

单个拉丁字母对应同名 bind，例如 `a` 对应 `bind="a"`。相邻普通字母表示乘法，`abx` 是 a×b×x。

多字母名称写成 `\mathrm{amplitude}`，整体读取 `bind="amplitude"`。这是 Reactive MD 的名称映射约定；命令内部必须是合法完整 bind 名称，不允许空格或插值。

`\alpha`、`\beta`、`\gamma`、`\theta`、`\omega`、`\lambda`、`\mu`、`\sigma` 分别映射同名英文 bind。其他希腊参数首版使用 `\mathrm{名称}` 显式引用；`\pi` 固定为圆周率。

`x` 是绘图自变量，`y` 是输出标记；两者不能绑定到控件。参数必须为数字；未声明参数、错误类型在绘图前诊断。

### 10.4 断点、读数与更新

参数变化后重新计算曲线。除零、非实结果、溢出点形成断点，不把断点两侧直接连起来。绘图实现还需细分检测疑似不连续区间，避免渐近线跨过有限采样点时出现错误连线。

默认提供图例和指针/键盘读数。曲线图例使用各自的数学公式；把指针移到曲线末端即可读取该点的值。

## 11. 交互图解

```markdown
<diagram bind="selected" initial="input" label="响应式状态流" direction="right">
<node id="input" label="输入">
读者通过控件改变参数。
</node>
<node id="compute" label="计算">
重新计算公式与结果。
</node>
<node id="view" label="显示">
更新正文与图表。
</node>
<edge from="input" to="compute" label="状态变化">
<edge from="compute" to="view" label="更新结果">
</diagram>
```

diagram 支持可选 label、bind、initial，direction=right/down（默认 right）。正文只包含 node、edge 和空白。至少一个 node；node 必填 id 和 label，正文为静态 Markdown 说明，可含文本插值但不能包含交互控件。

node.id 为当前图解内唯一的 `[A-Za-z_][A-Za-z0-9_-]*`。edge 必填 from/to，可选 label；两端必须存在。完全重复的 from/to/label 组合报错，不同标签的平行边允许。允许环和自环。

节点按关系自动布局，源码顺序用于确定同层顺序；环按整体分组后布局。首版不要求坐标，也不提供作者坐标覆盖。

节点默认可点击、可用键盘选择，选中说明在图解内的详情区展示。有 bind 时公开选中节点 id；无 bind 时选择保留在组件内部。initial 必须指向现有节点，默认选择第一个。diagram 与 edge 的 label 以及 node.label 支持文本插值。node 另支持动态 tone=neutral/success/warning，默认 neutral。

## 12. 组件速查与语法裁剪

| 用途 | 组件 |
| --- | --- |
| 参数输入 | input、textarea、number、slider、range-slider、coordinate、toggle、checkbox、date、select、choices、radio-group、multi-select、option |
| 自带操作 | counter、timer、checklist、progress |
| 组织内容 | panel、card、grid、tabs、tab、accordion、disclosure、if |
| 跳转与正文 | jump、anchor、text、section |
| 练习与分步 | quiz、steps、step |
| 提示 | alert、badge、tooltip |
| 声明与生成数据 | external、computed、const、validation、data-table、column |
| 可视化 | table、chart、plot、timeline、diagram、node、edge |

共 49 个标签名。`option`、`tab`、`disclosure`、`node`、`edge`、`step`、`column` 为父组件的结构子项。`external`、`computed`、`const`、`validation` 是文档声明，按标签解析但不渲染为控件。开头的 `<theme>` 声明是元数据，不计入这里。大部分文章只需 Markdown 和两三个输入/展示组件。普通金额可以直接写 `{{ total }} 元`；货币格式、统计卡片不作为入门必需品。

本规范不接受旧版 form、submit、button、each、list、spinner、stat、value 等标签，也不接受 set/reset 动作属性或 on-* 事件属性。面板的 reset 是固定布尔选项，不是可编程动作。

## 13. 诊断与验收规则

诊断包含严重程度、类别、简短解释、源码行列与修复建议。结构完整的未知标签区域按转义后的原始源码显示，给出 `local.component.unknown` 警告，内部控件和插值不执行。正常脚注不产生不支持警告。其他正文与交互继续工作。无法可靠恢复的组件标签结构、已知组件的属性或表达式错误、绑定错误和资源预算问题仍阻止编译。运行时局部计算错误按第 5 节隔离。

| 类别 | 例子 | 应说明什么 |
| --- | --- | --- |
| 标签结构 | card 未闭合、错误嵌套 | 需要的结束标签及开始位置 |
| 未知标签警告 | slidr | 未知名称、拼写建议以及局部源码降级 |
| 非法语法 | on-click、actions 配置块 | 属性或旧语法不在当前模式 |
| 绑定 | 引用 seats，但只声明 seat | 不存在的参数及候选名称 |
| 初值 | 同名参数写两次 initial | 两处冲突位置 |
| 类型 | 把字符串作为 if 条件 | 实际类型与期望布尔类型 |
| 约束 | slider 初值超出 max | 合法范围和当前值 |
| 表格 | 数值列含“20 元” | 列名、行号以及应填写数字 |
| 图解 | edge 指向不存在的节点 | 缺失的节点 ID |
| 声明 | computed 放在容器内或名称重复 | 顶层位置、冲突名称或控件 |
| 数据表 | data-table 缺少 column，或 key 重复 | 必需的列和唯一稳定键 |
| 校验 | fields 包含只读声明 | 可写的公开绑定名 |
| 数学 | 绘图中使用积分或缺失参数 | 对应数学片段和支持范围 |

实现验收必须覆盖：

1. 每份普通新 demo 都按本规范编译；诊断 demo 报出其列出的预期错误。
2. Markdown 容器内的标题、表格、列表和代码正常解析；代码及注释内的标签、插值不激活。
3. 不带 bind 的组件可独立操作；跨组件绑定同步，显式初值只应用一次。
4. 前向引用、条件隐藏、标签页切换和面板重置遵守同一套状态规则。
5. 参数面板、清单、本地目录搜索和计时操作不需要脚本、配置块或服务调用。
6. 图表数值保留类型，空数据、错误值和零占比有明确显示。
7. 正常 LaTeX 分数、隐式乘法、函数、参数、分段函数可计算；不支持的结构明确诊断；不连续点不错误连线。
8. 图解自动布局、详情显示与绑定选择工作；缺失边端点报错。
9. 中文输入法、键盘操作、可访问名称和 375px 窄屏可用。
10. 文档实例独立、销毁清理、无意外网络动作；复杂或超量数学输入能够被执行预算中止。

这些规则用于编译器、运行时和浏览器验收。示例映射及预期观察点见[示例索引](../../examples/local/README.md)，机器可读的最小验收集见[语言验收数据](../../examples/conformance/README.md)。实际仓库检查记录保留在仓库内，不属于发布包。

## 14. 宿主组件（宿主扩展）

宿主组件不属于可移植的作者标签集合。宿主通过编译选项 `hostComponents` 登记 schema 后，文档可以用 `leaf`、`inline` 或 `container` 形态使用该标签。inline 与 container 使用结束标签；正文遵循普通 Markdown 与 ReactiveMD 规则，容器渲染器可以通过 `ctx.render()` 渲染子内容。没有对应 schema 时，同一标签是未知组件，保留惰性的源码回退。

宿主 schema 可以声明 `string`、`number` 或 `boolean` 的标量绑定。此时组件隐式接受 `bind`、`initial` 和动态 `disabled`，并加入内置绑定 family：静态 `min`、`max`、`step` 一致时，`number` 绑定可以与 `<number>` 或 `<slider>` 配对。宿主渲染器收到当前 `value`、带校验的 `setValue`、`disabled`、`resetToken`、解析后的 `props` 和 `report` 函数。宿主 schema 是普通数据；渲染器是宿主可信代码，不进入 Worker。

`<external>` 只读声明与动态约束属性属于当前修订；宿主组件的形态与绑定由[组块协议](../development/component-protocol-ch.md)决定，而不是作者语法修订。

语法修订、包版本与迁移规则见[版本与兼容性](../compatibility/compatibility-ch.md)。
