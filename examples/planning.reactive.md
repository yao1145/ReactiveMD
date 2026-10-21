```reactive-md
version: "0.2"
data:
  steps:
    - {id: prepare, title: 准备材料, start: 0, duration: 10, description: 先列出所需内容。}
    - {id: main, title: 完成主体, start: 10, duration: 25, description: 集中完成主要部分。}
    - {id: parallel, title: 整理参考, start: 15, duration: 15, description: 可以与主体阶段并行。}
    - {id: review, title: 检查与交付, start: 35, duration: 10, description: 留出复核时间。}
state:
  remaining: 60
  people: 3
  total: 240
  tip: 10
computed:
  perPerson: "=total * (1 + tip / 100) / people"
```

# 计划、计时和简单工具

::timeline{items="=data.steps" label="45 分钟工作计划"}

::timer{bind="remaining" duration="60" label="一分钟专注计时"}

## 聚餐分账

::number{bind="total" label="账单金额" min="0"}

::slider{bind="people" label="分账人数" min="1" max="12"}

::slider{bind="tip" label="额外费用（%）" min="0" max="20"}

::stat{label="每人支付" value="=perPerson" format="currency" currency="CNY" hint="按人数平均分摊"}
