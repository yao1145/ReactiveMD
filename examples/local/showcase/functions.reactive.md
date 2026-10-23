# Functions you can shape

Drag Amplitude to 0: the wave becomes a flat line. Restore it, then increase Frequency to fit more waves into the same interval.

<grid>
<card>
<panel title="Shape the wave">
<slider bind="a" label="Amplitude" initial="1" min="0" max="3" step="0.5">
<slider bind="f" label="Frequency" initial="1" min="0.5" max="3" step="0.5">
</panel>

Amplitude **{{ a }}**, frequency **{{ f }}**.

<if when="{{ a == 0 }}">
<alert title="The wave is flat">Multiplying by zero makes every output zero, whatever the frequency.</alert>
</if>
</card>
<card>
<plot min="0" max="12.56" label="Adjustable sine wave" x-label="x" y-label="y">
$$ y = a\sin(fx) $$
</plot>
</card>
</grid>

## Explore the same parameters

<tabs label="Function explorations">
<tab label="Compare curves">
Both curves share the amplitude and frequency above. Compare their peaks and zero crossings.

<plot min="0" max="12.56" label="Sine and cosine">
$$ y = a\sin(fx) $$
$$ y = a\cos(fx) $$
</plot>
</tab>
<tab label="Piecewise function">
The negative side is linear; the positive side is quadratic. Amplitude scales both branches.

<plot min="-3" max="3" label="Linear meets quadratic">
$$
y = \begin{cases}
ax, & x < 0 \\
ax^2, & x \ge 0
\end{cases}
$$
</plot>
</tab>
<tab label="Savings application">
Monthly deposits and monthly compounding turn a formula into a small planning tool. Set the annual rate to zero to compare deposits alone.

<panel title="Savings parameters">
<number bind="P" label="Starting amount" initial="10000" min="0" step="100">
<number bind="m" label="Monthly deposit" initial="500" min="0" step="100">
<slider bind="r" label="Annual rate (%)" initial="5" min="0" max="10" step="0.5">
<slider bind="t" label="Years" initial="20" min="1" max="40">
</panel>

<plot min="0" max="{{ t }}" label="Savings growth" x-label="Years" y-label="Amount">
$$
y = \begin{cases}
P + 12mx, & r = 0 \\
P\left(1+\frac{r}{1200}\right)^{12x} + m\frac{\left(1+\frac{r}{1200}\right)^{12x}-1}{r/1200}, & r \ne 0
\end{cases}
$$
</plot>

Read the curve at year **{{ t }}** to inspect the ending balance.
</tab>
</tabs>

## How it is written

<accordion>
<disclosure label="Show the key source">

```markdown
<slider bind="a" label="Amplitude" initial="1" min="0" max="3" step="0.5">
<slider bind="f" label="Frequency" initial="1" min="0.5" max="3" step="0.5">
<plot min="0" max="12.56" label="Sine wave">
$$ y = a\sin(fx) $$
</plot>
```

</disclosure>
</accordion>
