<const name="budgets" value="{{ [150, 200, 220, 120] }}">
<computed name="expenses" value="{{ [content, visual, interaction, testing] }}">
<computed name="budget" value="{{ sum(budgets) }}">
<computed name="total" value="{{ sum(expenses) }}">
<computed name="remaining" value="{{ budget - total }}">

# 一份预算，多种观察方式

把视觉费用从 230 调到 300，总费用恰好达到 690 元预算；继续增加，观察超支提示。下方各视图读取同一组费用参数。

<grid>
<card>
<panel title="活动费用">
<number bind="content" label="内容费用" initial="120" min="0" max="1000" step="10">
<number bind="visual" label="视觉费用" initial="230" min="0" max="1000" step="10">
<number bind="interaction" label="交互费用" initial="180" min="0" max="1000" step="10">
<number bind="testing" label="测试费用" initial="90" min="0" max="1000" step="10">
</panel>
</card>
<card>
<grid>
<card title="费用合计">**{{ formatCurrency(total, 'CNY', 2, 'zh-CN') }}**</card>
<card title="预算余额">**{{ formatCurrency(remaining, 'CNY', 2, 'zh-CN') }}**</card>
</grid>

<badge tone="{{ remaining >= 0 ? 'success' : 'warning' }}">预算使用率：{{ formatPercent(total / budget, 1, 'zh-CN') }}</badge>

每项平均 **{{ formatCurrency(average(expenses), 'CNY', 2, 'zh-CN') }}**，最低 **{{ formatCurrency(minOf(expenses), 'CNY', 2, 'zh-CN') }}**，最高 **{{ formatCurrency(maxOf(expenses), 'CNY', 2, 'zh-CN') }}**。

<if when="{{ total > budget }}">
<alert tone="warning" title="费用已超出预算">需要减少 **{{ formatNumber(total - budget, 2, 'zh-CN') }}** 元，才能回到 690 元预算内。</alert>
</if>

<chart bind="selectedExpense" key="项目" title="实际费用与预算比较" y-label="元">
| 项目 | 实际 | 预算 |
| --- | ---: | ---: |
| 内容 | {{ expenses[0] }} | {{ budgets[0] }} |
| 视觉 | {{ expenses[1] }} | {{ budgets[1] }} |
| 交互 | {{ expenses[2] }} | {{ budgets[2] }} |
| 测试 | {{ expenses[3] }} | {{ budgets[3] }} |
</chart>
</card>
</grid>

## 查看数据明细

搜索项目、按实际费用排序，或翻页查看。搜索只筛选此表，图表继续展示全部四个项目。

<table bind="selectedExpense" key="项目" initial="内容" label="费用明细" page-size="2">
| 项目 | 实际 | 预算 |
| --- | ---: | ---: |
| 内容 | {{ expenses[0] }} | {{ budgets[0] }} |
| 视觉 | {{ expenses[1] }} | {{ budgets[1] }} |
| 交互 | {{ expenses[2] }} | {{ budgets[2] }} |
| 测试 | {{ expenses[3] }} | {{ budgets[3] }} |
</table>

当前选择：**{{ selectedExpense }}**。点击行首圆圈或图表中的数据项，其他视图会同步显示选择。搜索、排序和分页保留当前选择。

## 换一种观察角度

<tabs label="预算视角">
<tab label="费用占比">
<chart bind="selectedExpense" key="项目" kind="donut" title="费用流向">
| 项目 | 实际 |
| --- | ---: |
| 内容 | {{ expenses[0] }} |
| 视觉 | {{ expenses[1] }} |
| 交互 | {{ expenses[2] }} |
| 测试 | {{ expenses[3] }} |
</chart>
</tab>
<tab label="预算与实际">
<chart bind="selectedExpense" key="项目" kind="scatter" title="预算与实际散点" x="预算" y="实际" x-label="预算" y-label="实际">
| 项目 | 实际 | 预算 |
| --- | ---: | ---: |
| 内容 | {{ expenses[0] }} | {{ budgets[0] }} |
| 视觉 | {{ expenses[1] }} | {{ budgets[1] }} |
| 交互 | {{ expenses[2] }} | {{ budgets[2] }} |
| 测试 | {{ expenses[3] }} | {{ budgets[3] }} |
</chart>
</tab>
</tabs>

## 看看写法

<accordion>
<disclosure label="展开关键源码">

```markdown
<const name="budgets" value="{{ [150, 200, 220, 120] }}">
<number bind="content" label="内容费用" initial="120" min="0" max="1000">
<number bind="visual" label="视觉费用" initial="230" min="0" max="1000">
<number bind="interaction" label="交互费用" initial="180" min="0" max="1000">
<number bind="testing" label="测试费用" initial="90" min="0" max="1000">
<computed name="expenses" value="{{ [content, visual, interaction, testing] }}">
<computed name="total" value="{{ sum(expenses) }}">
合计: {{ formatCurrency(total, 'CNY', 2, 'zh-CN') }}

<chart title="实际费用与预算比较">
| 项目 | 实际 | 预算 |
| --- | ---: | ---: |
| 视觉 | {{ expenses[1] }} | {{ budgets[1] }} |
</chart>
```

</disclosure>
</accordion>
