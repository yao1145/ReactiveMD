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
  finalAmount: "=rate == 0 ? principal + monthly * years * 12 : principal * pow(1 + rate / 100 / 12, years * 12) + monthly * (pow(1 + rate / 100 / 12, years * 12) - 1) / (rate / 100 / 12)"
```

# 图表跟着输入变化

## 多系列预算比较

::chart{data="=data.expenses" kind="bar" x="label" y="spent,budget" label="实际费用与预算" y-label="示例单位"}

## 储蓄曲线

这是一个固定利率的数学示例。每月末存入固定金额，利息按月复利。

::::grid{columns="2"}
:::stack
::number{bind="principal" label="初始金额" min="0" step="100"}
::number{bind="monthly" label="每月存入" min="0" step="100"}
:::
:::stack
::slider{bind="rate" label="年利率（%）" min="0" max="10" step="0.5"}
::slider{bind="years" label="年数" min="1" max="40" step="1"}
:::
::::

::stat{label="期末金额" value="=finalAmount" format="currency" currency="CNY"}

::plot{formula="rate == 0 ? principal + monthly * x * 12 : principal * pow(1 + rate / 100 / 12, x * 12) + monthly * (pow(1 + rate / 100 / 12, x * 12) - 1) / (rate / 100 / 12)" min="0" max="=years" samples="80" label="储蓄增长曲线" x-label="年" y-label="金额"}

## 占比与散点

::::grid{columns="2"}
:::card[费用占比]
::chart{data="=data.expenses" kind="donut" x="label" y="spent" label="费用占比"}
:::
:::card[预算散点]
::chart{data="=data.expenses" kind="scatter" x="budget" y="spent" label="预算与实际" x-label="预算" y-label="实际"}
:::
::::
