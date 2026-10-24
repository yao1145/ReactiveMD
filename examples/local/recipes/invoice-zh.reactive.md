<const name="unitPrice" value="{{ 12.5 }}">
<computed name="total" value="{{ quantity * unitPrice }}">
<computed name="invoice" value="{{ formatCurrency(total, 'CNY', 2, 'zh-CN') }}">
<computed name="days" value="{{ startDate == '' || endDate == '' ? null : dateDiff(endDate, startDate) }}">

# 共享账单计算

<panel title="调整账单">
<number bind="quantity" label="数量" initial="2" min="0" max="100">
<date bind="startDate" label="开始日期" initial="2026-10-24">
<date bind="endDate" label="结束日期" initial="2026-10-26">
</panel>

账单：**{{ invoice }}**。单价：{{ formatCurrency(unitPrice, 'CNY', 2, 'zh-CN') }}。

天数：{{ days == null ? '请选择两个日期' : formatNumber(days, 0) }}。

<if when="{{ total >= 100 }}">
达到批量配送门槛。
</if>

<chart kind="bar" title="账单总额" x="项目" y="费用">
| 项目 | 费用 |
| --- | --- |
| 账单 | {{ total }} |
| 单件 | {{ unitPrice }} |
</chart>

<plot label="账单倍数" min="0" max="2" samples="21">
$$
y = \mathrm{total} x
$$
</plot>

同一数字的其他显示：{{ formatNumber(total, 0) }}、{{ formatScientific(total) }}。
比例 {{ formatPercent(0.125, 1) }} 的显示不随读者设备地区变化。
