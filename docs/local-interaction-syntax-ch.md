# Reactive MD 本地交互语法规范

本次新增的跳转、正文颜色、多选、区间、坐标、练习题、分步阅读和选择联动，见[新增组块与迁移](local-components-v2-ch.md)。

语法标识：`local-draft-2`，2026-10-23。第一次接触这套语法，建议先读 [新用户入门指南](local-guide-ch.md)；本文是完整规范。宿主通过 `compileLocal` 和 `LocalReactiveDocument` 选择本地交互模式，见 [集成说明](local-integration-ch.md)。包版本关系、0.x 兼容规则和迁移见 [版本与兼容性](compatibility-ch.md)，可选修订指令与 `reactive-md migrate` 见[源码修订与迁移](source-versioning-ch.md)，从 `0.3.1` / `local-draft-1` 升级见[0.4.0 发布与迁移](release-0.4.0-ch.md)。完整示例见 [示例索引](../examples/local/README.md)。

## 1. 定位与范围

`0.4.0` 新增不可见的 `computed`/`const` 声明与数字、字符串、日期函数。声明语法、依赖与错误规则、函数签名及固定默认值见[复用计算与格式化数值](computations-formatting-ch.md)。

跨字段校验、条件样式、数组与有限表格行生成见[条件、校验与本地集合](constraints-collections-ch.md)。

字符长度、源码定位与资源预算的单位见[诊断与计数规则](diagnostics-counting-ch.md)。字符串 `len()` 和文本控件长度约束按 Unicode 码点计数。

Reactive MD 用于本地交互文档：作者写 Markdown、放置输入控件，读者调整参数后，相关文字、公式、图表和图解立即更新。

基础语言只需要掌握两条连接规则：`bind` 为输入命名，`{{ 表达式 }}` 在其他位置读取它。组件负责自己的选择、展开、搜索、排序、计时和重置。

本草案不包含外部服务调用、提交表单、异步资源、命名动作、事件处理器、可编程集合增删、通用循环模板或任意脚本。旧版 `state/data/computed/actions` 配置块不属于新语法。表达式可以产生字符串或数字数组，清单与多选组件继续产生字符串数组。表格可直接写为 Markdown，也可通过带预算的 `data-table` 从本地值生成行。

文档默认只保存当前实例的内存状态。重新打开从初值开始；持久化不属于作者语法。无需声明语言版本、导入组件或编写 YAML。文档可以在前导区、主题和正文之前用一行 `<!-- reactive-md: local-draft-2 -->` 可选地声明修订；无指令文档使用当前修订。见[源码修订与迁移](source-versioning-ch.md)。宿主应明确选择草案解析模式，不能把旧语法与新语法混合猜测解析。

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

块组件的开始与结束标签各占一行。开始标签的属性可以跨多行书写。标签内部的 `>` 只有在引号之外才结束标签。缩进只用于可读性：容器内容按共同缩进量去缩进，再按 Markdown 解析；代码围栏内部的缩进保持原样。

行内组件 `badge`、`tooltip`、`jump`、`text` 可以嵌入句子。其他组件为块组件；`option`、`tab`、`disclosure`、`node`、`edge` 是限定父容器内的子组件。

### 3.2 两种标签形态

| 类型 | 写法 | 规则 |
| --- | --- | --- |
| 无正文组件 | `<slider bind="a" label="振幅">` | 不写结束标签；也接受末尾的 `/>` |
| 有正文容器 | `<card title="说明">` 和 `</card>` | 必须显式闭合，允许嵌套 |

无正文组件固定为 `input`、`textarea`、`number`、`slider`、`range-slider`、`coordinate`、`toggle`、`checkbox`、`date`、`counter`、`timer`、`progress`、`anchor`、`edge`。声明标签 `computed`、`const`、`validation` 以及结构子项 `column` 同样没有正文。其余本草案列出的组件均使用成对标签。`textarea` 的文本通过 `initial` 设置，因此属于无正文组件。

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
| `label="当前人数：{{ people }}"` | 文本插值 |
| `bind="people"` | 静态变量名 |

缺省布尔属性使用组件默认值，不统一假定为 false，例如 `panel.reset` 默认 true。

属性中的 `&quot;`、`&apos;`、`&amp;`、`&lt;`、`&gt;` 解码为相应文字；反斜杠不用于转义属性引号。数值和布尔属性的动态值必须是一个完整插值，结果保持原类型；文本属性可包含多段插值。

`bind`、`initial`、`name`、`id`、`value`（选项标识）、`to`、`from`、`answer`、`kind`、字段映射以及布局枚举是静态属性。输入的 `min/max/step` 也是静态约束；绘图的 `min/max` 可以动态，以支持调整观察区间。`textarea` 的 `rows` 是静态行数，`data-table.rows` 则是必填表达式，两者不要混淆。

未知组件、未知属性、错误位置或错误属性类型都给出源码诊断。注册的标签不直接作为任意 HTML 执行；作者不能使用 `script`、`style`、`onclick` 或其他脚本入口。

### 3.4 代码、公式与转义

正文中的 `Array<T>`、`Map<string, number>`、`x<y` 和货币 `$5`、`$10` 按文字处理；完整公式仍使用 `$...$` 或 `$$...$$`。单个未配对美元符号按文字显示。

支持无属性的 `<b>...</b>`、`<i>...</i>`、`<u>...</u>`、`<s>...</s>`、`<mark>...</mark>` 和 `<br>` / `<br/>`，分别生成加粗、斜体、下划线、删除线、高亮和硬换行节点。它们属于正文格式，不是交互组件；普通单换行仍按 Markdown 软换行处理。

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

本版本通过顶层 `computed` 与 `const` 声明增加只读命名值。简短计算仍可就地书写；需要被正文、条件、公式和图表共享的中间结果使用声明。依赖、错误和缓存规则见[复用计算与格式化数值](computations-formatting-ch.md)。

## 6. 输入与参数面板

所有输入组件支持 `label`、可选 `bind`、可选标量 `initial` 和动态 `disabled`。允许的附加属性如下；未列出的属性不属于本草案。

| 组件 | 附加属性及默认值 |
| --- | --- |
| input | type=text/email；placeholder；required=false；min-length=0；可选 max-length |
| textarea | placeholder；rows=4；required=false；min-length=0；可选 max-length |
| number | 可选 min/max；step=1 |
| slider | min=0；max=100；step=1 |
| range-slider | bind-start/bind-end 与 initial-start/initial-end；min=0；max=100；step=1；可选 color |
| coordinate | bind-x/bind-y 与 initial-x/initial-y；x-min/y-min=-5；x-max/y-max=5；step=1；可选 color |
| counter | min=0；可选 max；step=1 |
| toggle、checkbox | 可选 color |
| date | 可选 min/max 日期；required=false |
| select、choices、radio-group、multi-select | 正文为一个或多个 option；multi-select 增加 max-selected，值为字符串数组 |

`range-slider` 和 `coordinate` 公开彼此独立的数字槽位。省略 `bind-start`/`bind-end` 或 `bind-x`/`bind-y` 时对应槽位只保留内部状态；每个槽位最多一处显式初值。端点交叉会被拒绝，不会自动交换。`multi-select` 的 `label` 必填，支持 `max-selected`，写入按源码顺序规范化。这些组件都支持可选 `color`。完整规则见[local-draft-2 扩展说明](local-components-v2-ch.md)。

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

`panel` 为容器，支持可选 title 和 reset（默认 true）。默认纵向排布，提供“恢复默认”。`reset="false"` 隐藏重置操作。嵌套面板允许：内层重置只影响内层，外层重置包含整个子树；条件中尚未显示的子控件也属于范围。面板重置同时恢复子树中的表格查询、排序、分页、标签页和图解选择。

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

`jump.to` 与 `anchor.id` 匹配标题锚点或显式 ID。重复 anchor、与标题锚点冲突或目标不存在都是编译错误。`quiz` 的答案随源码提供，适合自学；草稿和反馈保留在组件内部，面板重置会清除。`steps` 中未激活的步骤仍参与初始化并保留状态；隐藏计时器暂停。颜色校验和槽位细节见[local-draft-2 扩展说明](local-components-v2-ch.md)。

基础排版使用 Markdown；图片用 `![说明](路径)`，链接用 `[文字](地址)`，分隔线用 `---`。图片需由宿主通过 URL 策略明确允许后才加载，默认不产生图片请求，集成方式见[图片与链接策略](local-integration-ch.md#图片与链接策略)。本草案不提供 row、stack、spacer、icon、image、link-button 等对应的作者标签，也不开放 class/style。

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

checklist 正文是非空、单层 Markdown 任务列表，默认由读者勾选。普通 Markdown 任务列表仍是静态内容。条目可含行内 Markdown，但不能含嵌套任务列表或交互组件。

固定条目依次生成 `item-1`、`item-2` 等内部 ID；公开值为按源码顺序排列的已勾选 ID 数组，未选择时为 []。文档实例期间条目不增删、重排；编辑源码并新建实例后重新生成。重置恢复 `[x]` / `[ ]` 指定的初始状态。支持 label、可选 bind、动态 disabled。

progress 是无正文组件，label/value 必填，max 默认 100，支持动态 value；max 必须为正有限数，value 在 0 到 max 之间，越界显示诊断，不悄悄截断。

## 9. 表格与统计图表

### 9.1 共同的数据规则

table、chart、timeline 的正文各为一张 Markdown 表格。表头非空且唯一，每行列数一致；单元格可以有插值。第一列通常为标签，其他列根据组件要求读取类型。

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

table 支持可选 label、searchable=true、sortable=true、page-size=10（正整数）。默认提供搜索框、可排序表头和分页；只有一页时隐藏分页控件。`key` 指定静态、非空、唯一的标识列后，`bind` 与 `initial` 可以把选中行公开为稳定字符串；没有 `key` 时选择只保留在渲染器内部。

搜索是全列显示文本的大小写不敏感子串匹配，去掉查询首尾空白；排序使用完整列的类型，数值列按数值，其余按文本 Unicode 码点顺序，保持同值行的原始顺序。表头点击依次升序、降序、恢复源码顺序。搜索或排序变化回到第一页，响应式数据变化后把当前页限制到有效范围。无匹配项显示“没有匹配结果”。这些交互只影响表格内部。

### 9.3 图表

```markdown
<chart kind="bar" title="费用与预算">
| 项目 | 实际 | 预算 |
| --- | ---: | ---: |
| 内容 | 120 | 150 |
| 视觉 | 230 | 200 |
</chart>
```

chart.kind 默认为 bar，支持 bar、line、area、scatter、donut。支持可选 title、x、y、x-label、y-label。x/y 为静态表头名称，y 可使用逗号分隔的多个列名，因此列名不能包含逗号。

| 类型 | 默认列规则 |
| --- | --- |
| bar、line、area | 第一列为横轴，其余列为数值系列 |
| scatter | 第一列为数值横轴，其余为数值纵轴；也可用 x/y 指定 |
| donut | 第一列为标签，第二列为数值；多于两列时必须用 y 指定唯一数值列 |

line/area 的横轴按整列类型确定为数值轴或分类轴，按源码顺序连接。donut 数值必须非负，总和为零时显示“暂无占比”。系列名称自动成为图例；默认提供指针与键盘读数，无需事件逻辑。

数值列会随参数更新。计算错误显示在对应图表，不将错误值替换为 0。提供 `key` 时，图表可以通过 `bind` 公开选择，使用与 `table` 相同的稳定行标识规则；表格与图表只有在有序 key 一致时才能共享该绑定。

### 9.4 时间轴

timeline 支持可选 title、unit（显示文本，默认“分钟”），正文为包含 `事项`、`开始`、`时长` 三列（可选 `说明`）或 `Task`、`Start`、`Duration` 三列（可选 `Notes`）的表格。这些列名是固定表头；开始和时长为非负数。按开始时间稳定排序，允许重叠区间，说明通过指针或键盘查看。表格内容可以使用插值。

## 10. LaTeX 公式与函数绘图

### 10.1 显示与绘图

正文 `$...$` 是行内数学，`$$...$$` 是独立公式。行内数学在同一行配对，内容首尾不能是空白；用 `\$` 显示普通美元符号。独立公式可以跨行，也可以写成 `$$ y = x^2 $$`。未闭合的数学定界符报错。单独公式用于排版，不创建状态、不发布函数。plot 容器内的每个 `$$...$$` 块定义一条曲线，数学内容保持正常 LaTeX 写法，不需要 `{{ }}`。

```markdown
<slider bind="a" label="振幅" initial="1" min="0" max="5">

<plot min="-10" max="10">
$$ y = a \sin x + \frac{x^2}{10} $$
</plot>
```

plot 正文只能是空白和一个或多个独立公式块。每块写 `y = 表达式`，只计算显式实函数 y(x)。多曲线用多个公式块，不把普通换行作为分隔符。

plot 支持 min=-10、max=10（可动态，要求 min < max）、samples=200（静态整数 2–2000）、可选 label、x-label="x"、y-label="y"。每个 plot 最多 16 条曲线；整篇文档的曲线数乘各自采样数之和最多 20,000，包括隐藏区域。各曲线共享计算预算，超限会停止计算并报告。纵轴依据当前范围内的有限采样值自动确定；没有有效值则给出空态。常量曲线应增加可见纵轴余量。

### 10.2 可计算的 LaTeX

下面是本草案绘图计算必须支持的数学写法。公式排版与计算能力分别校验；能够排版不代表能够求值。

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

隐式方程、参数曲线、矩阵、求和、积分、导数以及自定义宏不在首版可计算集合中。遇到这些结构应保留公式显示并指出不能计算的命令或结构，不能按另一个公式猜测绘图。数学渲染器须禁用文件、网络、HTML 和宏执行入口。

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

| 用途 | 草案组件 |
| --- | --- |
| 参数输入 | input、textarea、number、slider、range-slider、coordinate、toggle、checkbox、date、select、choices、radio-group、multi-select、option |
| 自带操作 | counter、timer、checklist、progress |
| 组织内容 | panel、card、grid、tabs、tab、accordion、disclosure、if |
| 跳转与正文 | jump、anchor、text、section |
| 练习与分步 | quiz、steps、step |
| 提示 | alert、badge、tooltip |
| 声明与生成数据 | computed、const、validation、data-table、column |
| 可视化 | table、chart、plot、timeline、diagram、node、edge |

共 48 个标签名。`option`、`tab`、`disclosure`、`node`、`edge`、`step`、`column` 为父组件的结构子项。`computed`、`const`、`validation` 是文档声明，按标签解析但不渲染为控件。开头的 `<theme>` 声明是元数据，不计入这里。大部分文章只需 Markdown 和两三个输入/展示组件。普通金额可以直接写 `{{ total }} 元`；货币格式、统计卡片不作为入门必需品。

本草案不接受旧版 form、submit、button、each、list、spinner、stat、value 等标签，也不接受 set/reset 动作属性或 on-* 事件属性。面板的 reset 是固定布尔选项，不是可编程动作。

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

这些规则用于编译器、运行时和浏览器验收。示例映射及预期观察点见[示例索引](../examples/local/README.md)，机器可读的最小验收集见[语言验收数据](../examples/conformance/README.md)。实际仓库检查记录保留在仓库内，不属于发布包。


新增组块、颜色、槽位状态与迁移规则见[local-draft-2 扩展说明](local-components-v2-ch.md)，升级清单见[0.4.0 发布与迁移](release-0.4.0-ch.md)。`0.4.0` 是 `next` 渠道的预览版。
