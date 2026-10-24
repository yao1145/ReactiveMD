<const name="unitPrice" value="{{ 12.5 }}">
<computed name="total" value="{{ quantity * unitPrice }}">
<computed name="invoice" value="{{ formatCurrency(total) }}">
<computed name="days" value="{{ startDate == '' || endDate == '' ? null : dateDiff(endDate, startDate) }}">

# Shared invoice calculations

<panel title="Adjust the invoice">
<number bind="quantity" label="Quantity" initial="2" min="0" max="100">
<date bind="startDate" label="Start" initial="2026-10-24">
<date bind="endDate" label="End" initial="2026-10-26">
</panel>

Invoice: **{{ invoice }}**. Per item: {{ formatCurrency(unitPrice) }}.

Days: {{ days == null ? 'Choose both dates' : formatNumber(days, 0) }}.

<if when="{{ total >= 100 }}">
Eligible for bulk delivery.
</if>

<chart kind="bar" title="Invoice total" x="Item" y="Cost">
| Item | Cost |
| --- | --- |
| Invoice | {{ total }} |
| One item | {{ unitPrice }} |
</chart>

<plot label="Scaled invoice" min="0" max="2" samples="21">
$$
y = \mathrm{total} x
$$
</plot>

Other displays of the same number: {{ formatNumber(total, 0) }}, {{ formatScientific(total) }}.
The fraction {{ formatPercent(0.125, 1) }} is independent of the reader's device locale.
