```reactive-md
version: "0.1"
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

调整人数和付款方式，比较每月平均费用。年度付款按月价的八折计算。

::::card[你的方案]
::slider{bind="seats" label="人数" min="1" max="20" step="1"}

::toggle{bind="annual" label="年度付款"}

当前人数：:value{value="=seats"}。

每人每月：:value{value="=unitPrice" format="currency" currency="CNY"}。

每月合计：:value{value="=total" format="currency" currency="CNY"}。

:::if{when="=seats >= 5"}
你选择了团队方案，可以继续比较年度付款价格。
:::

::button[恢复默认]{on-click="restore" variant="secondary"}
::::
