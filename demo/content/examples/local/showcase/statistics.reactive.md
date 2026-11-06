<const name="budgets" value="{{ [150, 200, 220, 120] }}">
<computed name="expenses" value="{{ [content, visual, interaction, testing] }}">
<computed name="budget" value="{{ sum(budgets) }}">
<computed name="total" value="{{ sum(expenses) }}">
<computed name="remaining" value="{{ budget - total }}">

# One budget, several views

Raise Visual from 230 to 300. The total reaches the {{ formatCurrency(budget, 'USD', 2, 'en-US') }} budget; increase it again to see the overspend warning. Every view reads the same four expense parameters.

<grid>
<card>
<panel title="Workshop expenses">
<number bind="content" label="Content expense" initial="120" min="0" max="1000" step="10">
<number bind="visual" label="Visual expense" initial="230" min="0" max="1000" step="10">
<number bind="interaction" label="Interaction expense" initial="180" min="0" max="1000" step="10">
<number bind="testing" label="Testing expense" initial="90" min="0" max="1000" step="10">
</panel>
</card>
<card>
<grid>
<card title="Total spent">**{{ formatCurrency(total, 'USD', 2, 'en-US') }}**</card>
<card title="Budget remaining">**{{ formatCurrency(remaining, 'USD', 2, 'en-US') }}**</card>
</grid>

<badge tone="{{ remaining >= 0 ? 'success' : 'warning' }}">Budget used: {{ formatPercent(total / budget, 1, 'en-US') }}</badge>

Average item **{{ formatCurrency(average(expenses), 'USD', 2, 'en-US') }}**; smallest **{{ formatCurrency(minOf(expenses), 'USD', 2, 'en-US') }}**, largest **{{ formatCurrency(maxOf(expenses), 'USD', 2, 'en-US') }}**.

<if when="{{ total > budget }}">
<alert tone="warning" title="Over budget">Reduce expenses by **{{ formatCurrency(total - budget, 'USD', 2, 'en-US') }}** to return to the {{ formatCurrency(budget, 'USD', 2, 'en-US') }} budget.</alert>
</if>

<chart bind="selectedExpense" key="Category" title="Actual against budget" y-label="USD">
| Category | Actual | Budget |
| --- | ---: | ---: |
| Content | {{ expenses[0] }} | {{ budgets[0] }} |
| Visual | {{ expenses[1] }} | {{ budgets[1] }} |
| Interaction | {{ expenses[2] }} | {{ budgets[2] }} |
| Testing | {{ expenses[3] }} | {{ budgets[3] }} |
</chart>
</card>
</grid>

## Inspect the data

Search for a category, sort by Actual, or turn the page. Search filters this table; the charts continue to show all four categories.

<table bind="selectedExpense" key="Category" initial="Content" label="Expense details" page-size="2">
| Category | Actual | Budget |
| --- | ---: | ---: |
| Content | {{ expenses[0] }} | {{ budgets[0] }} |
| Visual | {{ expenses[1] }} | {{ budgets[1] }} |
| Interaction | {{ expenses[2] }} | {{ budgets[2] }} |
| Testing | {{ expenses[3] }} | {{ budgets[3] }} |
</table>

Selected expense: **{{ selectedExpense }}**. Choose a row or chart mark to select the same category in the other views. Searching, sorting and paging preserve the selection.

## Change the perspective

<tabs label="Budget perspectives">
<tab label="Share of expenses">
<chart bind="selectedExpense" key="Category" kind="donut" title="Where the money goes">
| Category | Actual |
| --- | ---: |
| Content | {{ expenses[0] }} |
| Visual | {{ expenses[1] }} |
| Interaction | {{ expenses[2] }} |
| Testing | {{ expenses[3] }} |
</chart>
</tab>
<tab label="Budget and actual">
<chart bind="selectedExpense" key="Category" kind="scatter" title="Budget versus actual" x="Budget" y="Actual" x-label="Budget" y-label="Actual">
| Category | Actual | Budget |
| --- | ---: | ---: |
| Content | {{ expenses[0] }} | {{ budgets[0] }} |
| Visual | {{ expenses[1] }} | {{ budgets[1] }} |
| Interaction | {{ expenses[2] }} | {{ budgets[2] }} |
| Testing | {{ expenses[3] }} | {{ budgets[3] }} |
</chart>
</tab>
</tabs>

## How it is written

<accordion>
<disclosure label="Show the key source">

```markdown
<const name="budgets" value="{{ [150, 200, 220, 120] }}">
<number bind="content" label="Content expense" initial="120" min="0" max="1000">
<number bind="visual" label="Visual expense" initial="230" min="0" max="1000">
<number bind="interaction" label="Interaction expense" initial="180" min="0" max="1000">
<number bind="testing" label="Testing expense" initial="90" min="0" max="1000">
<computed name="expenses" value="{{ [content, visual, interaction, testing] }}">
<computed name="total" value="{{ sum(expenses) }}">
Total: {{ formatCurrency(total, 'USD', 2, 'en-US') }}

<chart title="Actual against budget">
| Category | Actual | Budget |
| --- | ---: | ---: |
| Visual | {{ expenses[1] }} | {{ budgets[1] }} |
</chart>
```

</disclosure>
</accordion>
