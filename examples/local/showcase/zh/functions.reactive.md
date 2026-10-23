# 用参数改变函数

先把振幅拖到 0，观察波形变成直线；再恢复振幅、提高频率，看看同一区间能容纳多少个波峰。

<grid>
<card>
<panel title="调整波形">
<slider bind="a" label="振幅" initial="1" min="0" max="3" step="0.5">
<slider bind="f" label="频率" initial="1" min="0.5" max="3" step="0.5">
</panel>

当前振幅 **{{ a }}**, 频率 **{{ f }}**.

<if when="{{ a == 0 }}">
<alert title="波形已变为直线">振幅为零时，任何频率对应的函数值都是零。</alert>
</if>
</card>
<card>
<plot min="0" max="12.56" label="可调正弦波" x-label="x" y-label="y">
$$ y = a\sin(fx) $$
</plot>
</card>
</grid>

## 用同一组参数继续探索

<tabs label="函数探索">
<tab label="多曲线比较">
两条曲线共用上方的振幅与频率，比较它们的波峰和过零点。

<plot min="0" max="12.56" label="正弦与余弦">
$$ y = a\sin(fx) $$
$$ y = a\cos(fx) $$
</plot>
</tab>
<tab label="分段函数">
负半轴是直线，正半轴是抛物线；上方振幅同时缩放两段函数。

<plot min="-3" max="3" label="直线与抛物线衔接">
$$
y = \begin{cases}
ax, & x < 0 \\
ax^2, & x \ge 0
\end{cases}
$$
</plot>
</tab>
<tab label="应用：储蓄增长">
每月末存入固定金额，按月复利计算。将年利率调到零，比较只存本金时的增长。

<panel title="储蓄参数">
<number bind="P" label="初始金额" initial="10000" min="0" step="100">
<number bind="m" label="每月存入" initial="500" min="0" step="100">
<slider bind="r" label="年利率（%）" initial="5" min="0" max="10" step="0.5">
<slider bind="t" label="年数" initial="20" min="1" max="40">
</panel>

<plot min="0" max="{{ t }}" label="储蓄增长曲线" x-label="年" y-label="金额">
$$
y = \begin{cases}
P + 12mx, & r = 0 \\
P\left(1+\frac{r}{1200}\right)^{12x} + m\frac{\left(1+\frac{r}{1200}\right)^{12x}-1}{r/1200}, & r \ne 0
\end{cases}
$$
</plot>

将指针移到曲线末端，读取第 **{{ t }}** 年的期末金额。
</tab>
</tabs>

## 看看写法

<accordion>
<disclosure label="展开关键源码">

```markdown
<slider bind="a" label="振幅" initial="1" min="0" max="3" step="0.5">
<slider bind="f" label="频率" initial="1" min="0.5" max="3" step="0.5">
<plot min="0" max="12.56" label="正弦波">
$$ y = a\sin(fx) $$
</plot>
```

</disclosure>
</accordion>
