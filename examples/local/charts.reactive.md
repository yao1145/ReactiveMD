# Charts follow their inputs

## Comparing several budget series

<chart title="Actual cost vs budget" y-label="USD">
| Category | Actual cost | Budget |
| --- | ---: | ---: |
| Content | 120 | 150 |
| Visual | 230 | 200 |
| Interaction | 180 | 220 |
| Testing | 90 | 120 |
</chart>

## Savings curve

Deposit a fixed amount at the end of every month, compounded monthly at a fixed annual rate. $P$ is the initial amount, $m$ is the monthly deposit, and $r$ is the annual rate in percent.

<panel title="Adjust savings parameters">
<number bind="P" label="Initial amount" initial="10000" min="0" step="100">
<number bind="m" label="Monthly deposit" initial="500" min="0" step="100">
<slider bind="r" label="Annual rate (%)" initial="5" min="0" max="10" step="0.5">
<slider bind="t" label="Years" initial="20" min="1" max="40">
</panel>

<plot min="0" max="{{ t }}" label="Savings growth" x-label="Years" y-label="Amount">
$$
y =
\begin{cases}
P + 12mx, & r = 0 \\
P\left(1+\frac{r}{1200}\right)^{12x}
+ m\frac{\left(1+\frac{r}{1200}\right)^{12x}-1}{r/1200}, & r \ne 0
\end{cases}
$$
</plot>

Move the pointer to the end of the curve to read the balance at the end of year {{ t }}. Set the annual rate to 0 to compare growth from deposits alone.

## Shares and scatter

<grid>
<card title="Cost share">
<chart kind="donut" title="Share of actual cost">
| Category | Actual cost |
| --- | ---: |
| Content | 120 |
| Visual | 230 |
| Interaction | 180 |
| Testing | 90 |
</chart>
</card>

<card title="Budget vs actual">
<chart kind="scatter" title="Budget scatter" x="Budget" y="Actual" x-label="Budget" y-label="Actual">
| Budget | Actual |
| ---: | ---: |
| 150 | 120 |
| 200 | 230 |
| 220 | 180 |
| 120 | 90 |
</chart>
</card>
</grid>

## Charts read the same parameters

<slider bind="people" label="People" initial="2" min="1" max="20">

<chart title="Plan cost by headcount" y-label="USD">
| Plan | Monthly cost |
| --- | ---: |
| Basic | {{ people * 20 }} |
| Pro | {{ people * 35 }} |
</chart>
