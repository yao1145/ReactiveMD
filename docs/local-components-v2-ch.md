# 新增组块与迁移：local-draft-2

本工作区的 `0.4.0` 是尚未发布的开发版本，语法修订为 `local-draft-2`。本页是[本地交互语法规范](local-interaction-syntax-ch.md)的补充。贡献与验收继续使用 `component-protocol-1`，机器格式保持不变。

## 跳转与正文颜色

```markdown
<jump to="result" appearance="button" color="#2563eb">查看结果</jump>

<section color="#45536f">
普通正文，<text color="#a2273a">**重点提醒**</text>。

第二段继承外层颜色，支持 {{ count }} 等插值。
</section>

<anchor id="result">

## 结果

结果显示在这里。
```

本例中的 `count` 需由一个控件声明，例如 `<counter bind="count" label="数量">`。

| 组块 | 形态 | 属性与规则 |
| --- | --- | --- |
| jump | 行内、成对标签 | `to` 必填，为静态文档内目标名；`appearance=link/button`，默认 link；可选 color；正文为行内 Markdown |
| anchor | 无正文标签 | `id` 必填，匹配 `[A-Za-z_][A-Za-z0-9_-]*`，当前文档内唯一 |
| text | 行内、成对标签 | color 必填，正文为行内 Markdown 与插值 |
| section | 块容器、成对标签 | color 必填，内部继续解析 Markdown；不添加边框和背景 |

jump 可以指向自动生成的标题锚点或显式 anchor，不写前导 `#`。普通 Markdown 链接仍使用 `[结果](#result)`。实际 DOM ID 按文档实例隔离；显式 ID 与标题锚点冲突、跳转目标不存在时编译失败。点击后滚动并移动焦点，隐藏目标显示局部提示，保留读者已填写的参数。

color 是静态颜色名或 `#RGB`、`#RRGGBB`。它不接受表达式、CSS 函数、变量或声明。颜色名由共享校验表限定；无效值给出编译诊断。text/section 的 color 控制文字，内层显式颜色覆盖继承；链接和交互控件保留自身配色。jump/badge 使用文字或强调色；progress 使用填充色；slider、toggle、checkbox、select、choices、radio-group、checklist 以及新输入组块使用激活色。省略时沿用主题。tone 的语义保持不变。

## 待办与多选

checklist 继续接受原有 Markdown 任务列表。勾选后仅该项正文加删除线并变淡，取消勾选后恢复；初始 `[x]` 也呈现完成样式。绑定、隐藏与面板重置保持原有规则。

```markdown
<multi-select bind="subjects" label="主题" max-selected="2" initial="math">
<option value="math">数学</option>
<option value="physics">物理</option>
<option value="chemistry">化学</option>
</multi-select>

已选择 {{ len(subjects) }} 项。
```

multi-select 是有正文容器，只接受 option 子项，label 必填；bind 可省略。公开值为按源码顺序排列的字符串数组，默认空数组；initial 为逗号分隔的静态 value。value 非空、唯一，且不含逗号。max-selected 为非负整数，默认选项数。组件内置搜索、清空，达到上限仍可取消已选项；disabled 可以使用布尔表达式。该绑定为独占 family，保留已有数组大小和字符串预算。

## 区间与二维坐标

```markdown
<range-slider label="观察区间" bind-start="low" bind-end="high"
  initial-start="20" initial-end="80" min="0" max="100" step="1">

区间宽度：{{ high - low }}。

<coordinate label="坐标点" bind-x="px" bind-y="py"
  initial-x="1" initial-y="2"
  x-min="-5" x-max="5" y-min="-5" y-max="5" step="1">

坐标：({{ px }}, {{ py }})。
```

这两个组块均为无正文标签，label 必填，支持 color 与动态 disabled。范围和步长都是静态有限数，step 必须为正。

- range-slider 默认 min=0、max=100、step=1；起点默认 min，终点默认不超过 max 的最大合法步长值。始终满足起点不大于终点，交叉写入被拒绝，不交换端点。
- coordinate 默认两个轴范围均为 -5 到 5，step=1；各轴初值取最接近零的合法值。支持拖动、键盘和数值输入，指针输入吸附到合法步长。
- 每个绑定名独立可选，省略时仍有内部状态；首版各槽位独占拥有绑定，不能与其他控件共享。`x`、`y` 仍是保留名，示例使用 px、py。
- 所有槽位在编译时初始化；多值写入和重置均为原子更新，拒绝写入时状态与 revision 保持不变。

宿主 API 扩展：`runtime.get(node, slot?)`、`runtime.set(node, value, slot?)` 保留原调用方式，新增 `runtime.setMany(node, values)`。range-slider 的 slot 为 start/end，coordinate 为 x/y；setMany 使用 slot 名作为对象键。运行时根据已登记的节点和槽位校验，调用方提供的伪造属性不改变权限或约束。

## 练习与分步阅读

```markdown
<quiz type="choice" label="2 + 3 等于多少？" answer="b" explanation="相加得到 5。">
<option value="a">4</option>
<option value="b">5</option>
</quiz>

<quiz type="number" label="圆周率近似值" answer="3.14" tolerance="0.01">
</quiz>

<steps label="学习路线" bind="lesson">
<step label="观察" value="observe">
调整参数，观察结果。
</step>
<step label="练习" value="practice">
检查一道练习题。
</step>
</steps>
```

quiz 的 type 默认 choice，label/answer 必填；choice 接受 option，answer 必须是现有 value。number 的正文为空，answer 为有限数，tolerance 默认为 0 且非负。explanation 可选，可含文本插值。组件内置检查答案、反馈与重试，首版不公开 bind；答案随源码提供，适合自学练习。隐藏后保留草稿与反馈，面板重置清除它们。

steps 只接受一个或多个 step。steps.label 可选，bind 可选且独占；initial 默认第一步 value。step.label 必填，value 可省略，按顺序生成 step-1、step-2 等，同组唯一。组件提供上一步、下一步和当前位置；仅当前内容显示，所有子控件仍参与编译和初始化。切换保留内容状态，隐藏计时器暂停；面板重置恢复初始步骤和子内容。

## 表格与图表选择

```markdown
<table bind="project" key="项目" initial="内容">
| 项目 | 费用 |
| --- | ---: |
| 内容 | 120 |
| 视觉 | 230 |
</table>

<chart bind="project" key="项目">
| 项目 | 费用 |
| --- | ---: |
| 内容 | 120 |
| 视觉 | 230 |
</chart>

当前项目：{{ project }}。
```

key 指定静态标识列，值必须非空、唯一且没有插值。提供 key 才启用选择状态，bind/initial 要求同时提供 key。默认空字符串表示未选；显式 initial 必须是现有标识。表格和图表可以共享 selection family，前提是标识集合与顺序一致，且最多一处显式 initial。

点击或键盘选择写入稳定标识，排序、搜索、分页和隐藏图例都保留选择。表格搜索仍只影响该表。省略 key 的旧文档保持原行为，不增加隐含绑定。

## 兼容、迁移与验收

local-draft-1 中已支持的写法继续有效。新增组块名共 10 个，总计 43 个：jump、anchor、text、section、multi-select、range-slider、coordinate、quiz、steps、step。新名称以前会作为未知源码惰性显示，现在开始解释其中的受支持内容；若原文用于演示标签，放进代码围栏或行内代码。checklist 的完成样式是可见变化。

机器验收沿用 component-protocol-1 的格式，syntaxVersion 更新为 local-draft-2；旧 local-draft-1.json 留作历史数据，新构建运行 local-draft-2.json。新组件另有核心、渲染和可视化用例。错误仍使用带源码位置的 Diagnostic，未知标签、脚注、安全与资源预算保持已有契约。

| 协议条款 | 实现与证据入口 |
| --- | --- |
| CP-SYNTAX、CP-DIAG、CP-SEC | parser/schema/compiler/colors；local-v2-core 与 local-v2-acceptance 测试 |
| CP-STATE、CP-LIFE、CP-VIS | runtime 的规范槽位、数组校验、原子写入与重置；核心测试、浏览器检查 |
| CP-A11Y、CP-STYLE | LocalDocumentView、visuals 及相应样式；SSR 与浏览器检查 |
| CP-CORE、CP-COMPAT、CP-ACCEPT | 独立 core/React 构建、机器验收、打包和本页迁移说明 |

双语可运行示例分布在原有[六个场景](../examples/local/showcase/README.md)：函数场景包含区间、坐标与数值题；表单场景包含多选；统计场景包含表格与图表选择联动；布局场景包含跳转与正文颜色；流程场景包含分步阅读与选择题；清单场景包含待办与计时。自动检查命令为 `npm test`、`npm run test:components`、`npm run build:demo`、`npm run test:docs`、`npm run test:package`。浏览器检查见 Demo 的 `verify-v2.mjs`；实际执行结果在验收后写入 Demo 实现记录。
