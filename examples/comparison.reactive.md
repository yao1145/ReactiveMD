```reactive-md
version: "0.2"
state:
  view: details
  annual: false
computed:
  basic: "=annual ? 80 : 100"
  pro: "=annual ? 160 : 200"
```

# 放在一起，比较更清楚

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

::::tabs{bind="view" label="方案说明"}
:::tab{value="details" label="功能比较"}
| 能力 | 基础方案 | 专业方案 |
| --- | --- | --- |
| 本地交互 | 支持 | 支持 |
| 团队协作 | 个人使用 | 多人共享 |
| 宿主扩展 | 内置组件 | 自定义组件 |
:::
:::tab{value="notes" label="选购建议"}
先根据实际参与人数选择方案，再比较付款周期带来的费用变化。
:::
::::

::::accordion
:::disclosure{label="费用如何计算？"}
年度付款使用每月标价的八折，界面会将它折算成每月费用。
:::
:::disclosure{label="可以随时切换吗？"}
这个文档是交互示例。切换上方开关即可比较两种付款周期。
:::
::::
