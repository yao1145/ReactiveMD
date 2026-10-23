# One budget, several views

Raise Visual from 230 to 300. The total reaches the 690 budget; increase it again to see the overspend warning. Every view reads the same four expense parameters.

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
<card title="Total spent">**{{ content + visual + interaction + testing }} credits**</card>
<card title="Budget remaining">**{{ 690 - (content + visual + interaction + testing) }} credits**</card>
</grid>

<if when="{{ content + visual + interaction + testing > 690 }}">
<alert tone="warning" title="Over budget">Reduce expenses by **{{ content + visual + interaction + testing - 690 }}** to return to the 690 budget.</alert>
</if>

<chart title="Actual against budget" y-label="Credits">
| Category | Actual | Budget |
| --- | ---: | ---: |
| Content | {{ content }} | 150 |
| Visual | {{ visual }} | 200 |
| Interaction | {{ interaction }} | 220 |
| Testing | {{ testing }} | 120 |
</chart>
</card>
</grid>

## Inspect the data

Search for a category, sort by Actual, or turn the page. Search filters this table; the charts continue to show all four categories.

<table label="Expense details" page-size="2">
| Category | Actual | Budget |
| --- | ---: | ---: |
| Content | {{ content }} | 150 |
| Visual | {{ visual }} | 200 |
| Interaction | {{ interaction }} | 220 |
| Testing | {{ testing }} | 120 |
</table>

## Change the perspective

<tabs label="Budget perspectives">
<tab label="Share of expenses">
<chart kind="donut" title="Where the money goes">
| Category | Actual |
| --- | ---: |
| Content | {{ content }} |
| Visual | {{ visual }} |
| Interaction | {{ interaction }} |
| Testing | {{ testing }} |
</chart>
</tab>
<tab label="Budget and actual">
<chart kind="scatter" title="Budget versus actual" x="Budget" y="Actual" x-label="Budget" y-label="Actual">
| Category | Actual | Budget |
| --- | ---: | ---: |
| Content | {{ content }} | 150 |
| Visual | {{ visual }} | 200 |
| Interaction | {{ interaction }} | 220 |
| Testing | {{ testing }} | 120 |
</chart>
</tab>
</tabs>

## How it is written

<accordion>
<disclosure label="Show the key source">

```markdown
<number bind="visual" label="Visual expense" initial="230" min="0" max="1000">
<chart title="Actual against budget">
| Category | Actual | Budget |
| --- | ---: | ---: |
| Visual | {{ visual }} | 200 |
</chart>
```

</disclosure>
</accordion>
