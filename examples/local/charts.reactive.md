# 图表跟着输入变化

## 多系列预算比较

<chart title="实际费用与预算" y-label="元">
| 项目 | 实际费用 | 预算 |
| --- | ---: | ---: |
| 内容 | 120 | 150 |
| 视觉 | 230 | 200 |
| 交互 | 180 | 220 |
| 测试 | 90 | 120 |
</chart>

## 储蓄曲线

每月末存入固定金额，按固定年利率、每月复利计算。$P$ 为初始金额，$m$ 为每月存入金额，$r$ 为年利率的百分数。

<panel title="调整储蓄参数">
<number bind="P" label="初始金额" initial="10000" min="0" step="100">
<number bind="m" label="每月存入" initial="500" min="0" step="100">
<slider bind="r" label="年利率（%）" initial="5" min="0" max="10" step="0.5">
<slider bind="t" label="年数" initial="20" min="1" max="40">
</panel>

<plot min="0" max="{{ t }}" label="储蓄增长曲线" x-label="年" y-label="金额">
$$
y =
\begin{cases}
P + 12mx, & r = 0 \\
P\left(1+\frac{r}{1200}\right)^{12x}
+ m\frac{\left(1+\frac{r}{1200}\right)^{12x}-1}{r/1200}, & r \ne 0
\end{cases}
$$
</plot>

把指针移到曲线末端，可以读取第 {{ t }} 年的期末金额。将年利率调到 0，可以比较只存入本金时的变化。

## 占比与散点

<grid>
<card title="费用占比">
<chart kind="donut" title="各项实际费用占比">
| 项目 | 实际费用 |
| --- | ---: |
| 内容 | 120 |
| 视觉 | 230 |
| 交互 | 180 |
| 测试 | 90 |
</chart>
</card>

<card title="预算与实际">
<chart kind="scatter" title="预算散点" x="预算" y="实际" x-label="预算" y-label="实际">
| 预算 | 实际 |
| ---: | ---: |
| 150 | 120 |
| 200 | 230 |
| 220 | 180 |
| 120 | 90 |
</chart>
</card>
</grid>

## 图表读取同一份参数

<slider bind="people" label="人数" initial="2" min="1" max="20">

<chart title="按人数比较方案费用" y-label="元">
| 方案 | 每月费用 |
| --- | ---: |
| 基础版 | {{ people * 20 }} |
| 专业版 | {{ people * 35 }} |
</chart>
