import pricingSource from '../../examples/pricing.reactive.md?raw';
import counterSource from '../../examples/counter.reactive.md?raw';
import comparisonSource from '../../examples/comparison.reactive.md?raw';
import formsSource from '../../examples/forms.reactive.md?raw';
import collectionsSource from '../../examples/collections.reactive.md?raw';
import chartsSource from '../../examples/charts.reactive.md?raw';
import diagramSource from '../../examples/diagram.reactive.md?raw';
import asyncSource from '../../examples/async.reactive.md?raw';
import planningSource from '../../examples/planning.reactive.md?raw';
import componentsSource from '../../examples/components.reactive.md?raw';

/**
 * Built-in playground examples. Source text is passed through the real compiler;
 * nothing in the preview is simulated or hard-coded.
 */
export const GALLERY_SOURCE = `\`\`\`reactive-md
version: "0.1"
data:
  basePrice: 80
state:
  name: "小林"
  quantity: 3
  plan: "pro"
  annual: false
  budgetLevel: 50
  express: true
computed:
  planFactor: '=plan == "pro" ? 1 : 0.8'
  estimate: "=round(quantity * data.basePrice * planFactor * (annual ? 0.8 : 1))"
  perPerson: "=round(estimate / quantity)"
actions:
  addOne:
    - set: quantity
      value: "=min(quantity + 1, 20)"
  resetAll:
    - reset: [name, quantity, plan, annual, budgetLevel, express]
\`\`\`

# 组件画廊

同一个文档里放齐 v0.1 的组件。所有值、条件和动作都由 Reactive MD 运行时计算。

**当前称呼**：:value{value="=name"}　~~这是一段删除线~~　\`inline code\`

> 引用块和普通 Markdown 可以随时混排。

::::card[填写你的方案]
::input{bind="name" label="称呼" placeholder="请输入名字"}
::number{bind="quantity" label="=plan == 'pro' ? '数量（专业版）' : '数量（基础版）'" min="1" max="20" step="1"}
:::select{bind="plan" label="方案"}
::option[基础版]{value="basic"}
::option[专业版]{value="pro"}
:::
::toggle{bind="annual" label="年度付款（八折）"}
::toggle{bind="express" label="显示加急清单（条件区域）"}
::slider{bind="budgetLevel" label="预算档位" min="0" max="100" step="10"}
:::row{gap="sm"}
:badge[方案]{tone="neutral"}
:badge[已启用]{tone="success"}
:value{value="=planFactor"} 的计价系数
:::
:::stack{gap="sm"}
**预估费用**：:value{value="=estimate" format="currency" currency="CNY"}

平均每人：:value{value="=perPerson" format="currency" currency="CNY"}
:::
:::if{when="=quantity >= 5"}
数量已达到团队档，费用按当前方案继续累加。
:::
:::row{gap="sm"}
::button[数量加一]{on-click="addOne"}
::button[全部重置]{on-click="resetAll" variant="secondary"}
::button[受条件禁用]{on-click="addOne" variant="quiet" disabled="=quantity < 3"}
:::
::::

### 明细对照

| 条件 | 显示 |
| :--- | ---: |
| 年度付款 | :value{value="=annual ? '已开启' : '未开启'"} |
| 预算档位 | :value{value="=budgetLevel"} |

\`\`\`text
这是一个普通代码围栏，指令不会在其中执行。
\`\`\`

- 列表项一
- 列表项二

:::if{when="=express"}
- [x] 已选加急展示
- [ ] 其他选项仍在设计稿中
:::
`;

export const DIAGNOSTIC_SOURCE = `\`\`\`reactive-md
version: "0.1"
state:
  count: 0
  label: "演示"
computed:
  loopA: "=loopB + 1"
  loopB: "=loopA + 1"
actions:
  broken:
    - set: count
      value: "=count + missing"
\`\`\`

# 诊断示例

这段源码故意包含错误，用来检查诊断的原始行列。

当前数值：:value{value="=count"}。

::button[执行错误动作]{on-click="broken"}

::mystery{label="不存在的组件"}
`;

export interface PlaygroundExample {
  id: string;
  title: string;
  hint: string;
  source: string;
}

export const EXAMPLES: PlaygroundExample[] = [
  { id: 'comparison', title: '并排比较与布局', hint: '网格、标签页与折叠内容', source: comparisonSource },
  { id: 'forms', title: '表单与选择', hint: '原生校验与声明式提交', source: formsSource },
  { id: 'collections', title: '集合与数据表格', hint: '动态列表、清单和排序筛选', source: collectionsSource },
  { id: 'charts', title: '图表与储蓄计算', hint: '多系列图表与动态函数曲线', source: chartsSource },
  { id: 'diagram', title: '交互图解', hint: '节点选择与参数探索', source: diagramSource },
  { id: 'async', title: '异步宿主动作', hint: '加载、错误与服务结果', source: asyncSource },
  { id: 'planning', title: '计划与分账', hint: '时间轴、计时与计算工具', source: planningSource },
  { id: 'components', title: '内容与辅助组件', hint: '视觉、提示、单选和可操作列表', source: componentsSource },
  {
    id: 'pricing',
    title: '方案计算器',
    hint: '人数、年度折扣与实时合计',
    source: pricingSource,
  },
  {
    id: 'counter',
    title: '计数器',
    hint: '最小状态与动作示例',
    source: counterSource,
  },
  {
    id: 'gallery',
    title: '组件画廊',
    hint: '13 个 v0.1 组件全覆盖',
    source: GALLERY_SOURCE,
  },
  {
    id: 'diagnostics',
    title: '诊断示例',
    hint: '故意写错的源码',
    source: DIAGNOSTIC_SOURCE,
  },
];

export const DEFAULT_EXAMPLE_ID = 'pricing';
