# 功能演示

这篇文档收集了函数、表单、图表、布局、流程和计时组件。沿着大纲浏览，直接修改控件，也可以打开源码，把需要的部分复制到自己的文档。

<const name="functionsMonthsPerYear" value="{{ 12 }}">
<computed name="functionsMonthlyRate" value="{{ functionsR / (100 * functionsMonthsPerYear) }}">
<computed name="functionsGrowthFactor" value="{{ pow(1 + functionsMonthlyRate, functionsMonthsPerYear * functionsT) }}">
<computed name="functionsEndingBalance" value="{{ functionsMonthlyRate == 0 ? functionsP + functionsMonthsPerYear * functionsM * functionsT : functionsP * functionsGrowthFactor + functionsM * (functionsGrowthFactor - 1) / functionsMonthlyRate }}">
<computed name="functionsDeposits" value="{{ functionsP + functionsMonthsPerYear * functionsM * functionsT }}">
<computed name="functionsDistance" value="{{ sqrt(functionsPx * functionsPx + functionsPy * functionsPy) }}">
<computed name="functionsWaveHeight" value="{{ functionsA * sin(functionsF * functionsPx) }}">
<computed name="functionsInsideInterval" value="{{ functionsPx >= functionsLow && functionsPx <= functionsHigh }}">

## 用参数改变函数

先把振幅拖到 0，观察波形变成直线；再恢复振幅、提高频率，看看同一区间能容纳多少个波峰。

<grid>
<card>
<panel title="调整波形">
<slider bind="functionsA" label="振幅" initial="1" min="0" max="3" step="0.5">
<slider bind="functionsF" label="频率" initial="1" min="0.5" max="3" step="0.5">
</panel>

当前振幅 **{{ functionsA }}**, 频率 **{{ functionsF }}**.

<if when="{{ functionsA == 0 }}">
<alert title="波形已变为直线">振幅为零时，任何频率对应的函数值都是零。</alert>
</if>
</card>
<card>
<plot min="0" max="12.56" label="可调正弦波" x-label="x" y-label="y">
$$ y = \mathrm{functionsA}\sin(\mathrm{functionsF}x) $$
</plot>
</card>
</grid>

### 用同一组参数继续探索

<tabs label="函数探索">
<tab label="多曲线比较">
两条曲线共用上方的振幅与频率，比较它们的波峰和过零点。

<plot min="0" max="12.56" label="正弦与余弦">
$$ y = \mathrm{functionsA}\sin(\mathrm{functionsF}x) $$
$$ y = \mathrm{functionsA}\cos(\mathrm{functionsF}x) $$
</plot>
</tab>
<tab label="分段函数">
负半轴是直线，正半轴是抛物线；上方振幅同时缩放两段函数。

<plot min="-3" max="3" label="直线与抛物线衔接">
$$
y = \begin{cases}
\mathrm{functionsA}x, & x < 0 \\
\mathrm{functionsA}x^2, & x \ge 0
\end{cases}
$$
</plot>
</tab>
<tab label="应用：储蓄增长">
每月末存入固定金额，按月复利计算。将年利率调到零，比较只存本金时的增长。

<panel title="储蓄参数">
<number bind="functionsP" label="初始金额" initial="10000" min="0" step="100">
<number bind="functionsM" label="每月存入" initial="500" min="0" step="100">
<slider bind="functionsR" label="年利率（%）" initial="5" min="0" max="10" step="0.5">
<slider bind="functionsT" label="年数" initial="20" min="1" max="40">
</panel>

<plot min="0" max="{{ functionsT }}" label="储蓄增长曲线" x-label="年" y-label="金额">
$$
y = \begin{cases}
\mathrm{functionsP} + 12\mathrm{functionsM}x, & \mathrm{functionsR} = 0 \\
\mathrm{functionsP}\left(1+\mathrm{functionsMonthlyRate}\right)^{12x} + \mathrm{functionsM}\frac{\left(1+\mathrm{functionsMonthlyRate}\right)^{12x}-1}{\mathrm{functionsMonthlyRate}}, & \mathrm{functionsR} \ne 0
\end{cases}
$$
</plot>

第 **{{ functionsT }}** 年的期末金额：**{{ formatCurrency(functionsEndingBalance, 'CNY', 2, 'zh-CN') }}**，其中存入本金 **{{ formatCurrency(functionsDeposits, 'CNY', 2, 'zh-CN') }}**、利息 **{{ formatCurrency(functionsEndingBalance - functionsDeposits, 'CNY', 2, 'zh-CN') }}**。年利率为 **{{ formatPercent(functionsR / 100, 1, 'zh-CN') }}**。曲线和期末计算共用月利率，零利率时直接累计存款。
</tab>
</tabs>

### 探索坐标与区间

选择一个区间，再拖动坐标点。比较横坐标是否落在区间内，并读取波形在该位置的高度。

<panel title="坐标与区间">
<range-slider label="观察区间" bind-start="functionsLow" bind-end="functionsHigh" initial-start="-3" initial-end="3" min="-5" max="5" color="#7c3aed">

当前区间：**{{ functionsLow }}–{{ functionsHigh }}**，宽度为 **{{ functionsHigh - functionsLow }}**。

<coordinate label="点的位置" bind-x="functionsPx" bind-y="functionsPy" initial-x="1" initial-y="2" x-min="-5" x-max="5" y-min="-5" y-max="5" color="#2563eb">

坐标：**({{ functionsPx }}, {{ functionsPy }})**，距原点 **{{ formatNumber(functionsDistance, 2, 'zh-CN') }}**。

{{ functionsInsideInterval ? '横坐标位于观察区间内。' : '横坐标位于观察区间外。' }} 波形在这一横坐标处的高度为 **{{ formatNumber(functionsWaveHeight, 2, 'zh-CN') }}**。

用科学计数法读取同一高度：**{{ formatScientific(functionsWaveHeight, 2, 'zh-CN') }}**，便于比较接近零的数值。

<quiz type="number" label="点 (3, 4) 到原点的距离是多少？" answer="5" tolerance="0.01" explanation="3² + 4² 的平方根是 5，可以把坐标点拖到 (3, 4) 验证。">
</quiz>
</panel>

### 看看写法

<accordion>
<disclosure label="展开关键源码">

```markdown
<slider bind="a" label="振幅" initial="1" min="0" max="3" step="0.5">
<slider bind="f" label="频率" initial="1" min="0.5" max="3" step="0.5">
<coordinate label="点的位置" bind-x="px" bind-y="py" initial-x="1" initial-y="2" x-min="-5" x-max="5" y-min="-5" y-max="5">
<computed name="waveHeight" value="{{ a * sin(f * px) }}">
高度: {{ formatNumber(waveHeight, 2) }} · {{ formatScientific(waveHeight, 2) }}

<plot min="0" max="12.56" label="正弦波">
$$ y = a\sin(fx) $$
</plot>
```

</disclosure>
</accordion>

<computed name="formsOrganizer" value="{{ trim(formsName) == '' ? '你的小组' : trim(formsName) }}">
<computed name="formsUnitCost" value="{{ (formsFormat == 'onsite' ? 80 : 60) + (formsEquipment ? 20 : 0) }}">
<computed name="formsTotal" value="{{ formsSeats * formsUnitCost }}">
<computed name="formsDatesReady" value="{{ formsDate != '' && formsDeadline != '' && dateCompare(formsDeadline, formsDate) <= 0 }}">
<computed name="formsRegistrationGap" value="{{ formsDatesReady ? dateDiff(formsDate, formsDeadline) : null }}">

## 边填写，边生成活动方案

修改称呼和人数，再切换线下或线上形式。调低预算或将报名截止日期设到活动之后，查看相应提示；选择主题，生成准备清单。

<grid>
<card>
<panel title="活动配置">
<input bind="formsName" label="组织者" initial="Alex" placeholder="你的称呼">
<choices bind="formsFormat" label="活动形式" initial="onsite">
<option value="onsite">线下</option>
<option value="online">线上</option>
</choices>
<slider bind="formsSeats" label="参与人数" initial="4" min="1" max="20">
<date bind="formsDate" label="活动日期" initial="2026-11-01">
<date bind="formsDeadline" label="报名截止日期" initial="2026-10-25">
<number bind="formsBudget" label="费用上限" initial="500" min="0" max="5000" step="10">
<validation when="{{ formsDatesReady }}" message="请填写两个日期，并将报名截止日期设为不晚于活动日期。" fields="formsDeadline formsDate">
<validation when="{{ formsTotal <= formsBudget }}" message="预计费用超出上限 {{ formatCurrency(formsTotal - formsBudget, 'CNY', 2, 'zh-CN') }}，请调整人数、材料或费用上限。" fields="formsSeats formsEquipment formsBudget">
<textarea bind="formsNotes" label="补充要求" placeholder="写下小组的具体需要">
<toggle bind="formsEquipment" label="增加材料包（每人 20 元）">
</panel>
</card>

<card title="你的活动方案">
**{{ formsOrganizer }}** · {{ formsDate }}

{{ formsFormat == 'onsite' ? '线下活动' : '线上活动' }} · **{{ formsSeats }}** 人

每人费用： **{{ formatCurrency(formsUnitCost, 'CNY', 2, 'zh-CN') }}**

预计总费用： **{{ formatCurrency(formsTotal, 'CNY', 2, 'zh-CN') }}**

<badge tone="{{ formsTotal <= formsBudget ? 'success' : 'warning' }}">费用上限：{{ formatCurrency(formsBudget, 'CNY', 2, 'zh-CN') }}</badge>

<if when="{{ formsDatesReady }}">
报名于 **{{ formsDeadline }}** 截止，比活动提前 **{{ formsRegistrationGap }}** 天。
</if>

补充要求： {{ trim(formsNotes) == '' ? '暂未填写。' : trim(formsNotes) }}

<if when="{{ formsFormat == 'onsite' }}">
<alert title="线下准备">预订至少能容纳 {{ formsSeats }} 人的场地，并准备公共屏幕。</alert>
</if>
<if when="{{ formsFormat == 'online' }}">
<alert title="线上准备">提前分享会议链接，确认每位参与者都能打开活动文档。</alert>
</if>
</card>
</grid>

### 试一次完整的修改

选择线上、调到 6 人并增加材料包，总费用变为 **¥480.00**。点击活动配置的恢复默认，回到初始的 **¥320.00**。

### 为小组安排合适的学习内容

选择经验水平、活动节奏和主题，让学习安排与上方的费用方案一起明确下来。

<panel title="学习偏好">
<select bind="formsLevel" label="经验水平" initial="intro">
<option value="intro">第一次参与</option>
<option value="advanced">已有使用经验</option>
</select>

<radio-group bind="formsPace" label="活动节奏" initial="guided">
<option value="guided">跟随步骤练习</option>
<option value="independent">自主探索</option>
</radio-group>

<multi-select bind="formsSubjects" label="活动主题" max-selected="2" color="#167875">
<option value="math">数学</option>
<option value="physics">物理</option>
<option value="chemistry">化学</option>
</multi-select>

<checkbox bind="formsAccessible" label="提供书面步骤说明">

| 配置 | 当前安排 |
| --- | --- |
| 水平 | {{ formsLevel == 'intro' ? '从一个完整示例开始' : '比较几种不同方法' }} |
| 节奏 | {{ formsPace == 'guided' ? '一起按步骤练习' : '留出自主探索时间' }} |
| 主题 | 已选择 {{ len(formsSubjects) }} / 2 项 |

<data-table label="主题准备清单" rows="{{ formsSubjects }}" key="{{ item }}" max-rows="2">
<column label="主题" value="{{ item == 'math' ? '数学' : item == 'physics' ? '物理' : '化学' }}">
<column label="准备事项" value="{{ item == 'chemistry' ? '准备材料与操作说明' : '准备一个完整例题' }}">
<column label="配套说明" value="{{ formsAccessible ? '附书面步骤' : '现场讲解' }}">
</data-table>

<if when="{{ contains(formsSubjects, 'chemistry') }}">
<badge color="#167875">加入一个化学示例</badge>
</if>
<if when="{{ formsAccessible }}">
<alert title="准备书面说明">为每一步写明参数名称和预期结果，方便参与者自行查阅。</alert>
</if>
</panel>

### 看看写法

<accordion>
<disclosure label="展开关键源码">

```markdown
<const name="rate" value="{{ 80 }}">
<computed name="total" value="{{ seats * rate }}">
<slider bind="seats" label="参与人数" initial="4" min="1" max="20">
<number bind="budget" label="费用上限" initial="500" min="0" max="5000">
<validation when="{{ total <= budget }}" message="请调整人数或费用上限。" fields="seats budget">
<badge tone="{{ total <= budget ? 'success' : 'warning' }}">{{ formatCurrency(total, 'CNY', 2, 'zh-CN') }}</badge>

<multi-select bind="subjects" label="主题" max-selected="2">
<option value="math">数学</option>
<option value="physics">物理</option>
</multi-select>
<data-table label="准备清单" rows="{{ subjects }}" key="{{ item }}" max-rows="2">
<column label="主题" value="{{ item == 'math' ? '数学' : '物理' }}">
</data-table>
```

</disclosure>
</accordion>

<const name="statisticsBudgets" value="{{ [150, 200, 220, 120] }}">
<computed name="statisticsExpenses" value="{{ [statisticsContent, statisticsVisual, statisticsInteraction, statisticsTesting] }}">
<computed name="statisticsBudget" value="{{ sum(statisticsBudgets) }}">
<computed name="statisticsTotal" value="{{ sum(statisticsExpenses) }}">
<computed name="statisticsRemaining" value="{{ statisticsBudget - statisticsTotal }}">

## 一份预算，多种观察方式

把视觉费用从 230 调到 300，总费用恰好达到 690 元预算；继续增加，观察超支提示。下方各视图读取同一组费用参数。

<grid>
<card>
<panel title="活动费用">
<number bind="statisticsContent" label="内容费用" initial="120" min="0" max="1000" step="10">
<number bind="statisticsVisual" label="视觉费用" initial="230" min="0" max="1000" step="10">
<number bind="statisticsInteraction" label="交互费用" initial="180" min="0" max="1000" step="10">
<number bind="statisticsTesting" label="测试费用" initial="90" min="0" max="1000" step="10">
</panel>
</card>
<card>
<grid>
<card title="费用合计">**{{ formatCurrency(statisticsTotal, 'CNY', 2, 'zh-CN') }}**</card>
<card title="预算余额">**{{ formatCurrency(statisticsRemaining, 'CNY', 2, 'zh-CN') }}**</card>
</grid>

<badge tone="{{ statisticsRemaining >= 0 ? 'success' : 'warning' }}">预算使用率：{{ formatPercent(statisticsTotal / statisticsBudget, 1, 'zh-CN') }}</badge>

每项平均 **{{ formatCurrency(average(statisticsExpenses), 'CNY', 2, 'zh-CN') }}**，最低 **{{ formatCurrency(minOf(statisticsExpenses), 'CNY', 2, 'zh-CN') }}**，最高 **{{ formatCurrency(maxOf(statisticsExpenses), 'CNY', 2, 'zh-CN') }}**。

<if when="{{ statisticsTotal > statisticsBudget }}">
<alert tone="warning" title="费用已超出预算">需要减少 **{{ formatNumber(statisticsTotal - statisticsBudget, 2, 'zh-CN') }}** 元，才能回到 690 元预算内。</alert>
</if>

<chart bind="statisticsSelectedExpense" key="项目" title="实际费用与预算比较" y-label="元">
| 项目 | 实际 | 预算 |
| --- | ---: | ---: |
| 内容 | {{ statisticsExpenses[0] }} | {{ statisticsBudgets[0] }} |
| 视觉 | {{ statisticsExpenses[1] }} | {{ statisticsBudgets[1] }} |
| 交互 | {{ statisticsExpenses[2] }} | {{ statisticsBudgets[2] }} |
| 测试 | {{ statisticsExpenses[3] }} | {{ statisticsBudgets[3] }} |
</chart>
</card>
</grid>

### 查看数据明细

搜索项目、按实际费用排序，或翻页查看。搜索只筛选此表，图表继续展示全部四个项目。

<table bind="statisticsSelectedExpense" key="项目" initial="内容" label="费用明细" page-size="2">
| 项目 | 实际 | 预算 |
| --- | ---: | ---: |
| 内容 | {{ statisticsExpenses[0] }} | {{ statisticsBudgets[0] }} |
| 视觉 | {{ statisticsExpenses[1] }} | {{ statisticsBudgets[1] }} |
| 交互 | {{ statisticsExpenses[2] }} | {{ statisticsBudgets[2] }} |
| 测试 | {{ statisticsExpenses[3] }} | {{ statisticsBudgets[3] }} |
</table>

当前选择：**{{ statisticsSelectedExpense }}**。点击行首圆圈或图表中的数据项，其他视图会同步显示选择。搜索、排序和分页保留当前选择。

### 换一种观察角度

<tabs label="预算视角">
<tab label="费用占比">
<chart bind="statisticsSelectedExpense" key="项目" kind="donut" title="费用流向">
| 项目 | 实际 |
| --- | ---: |
| 内容 | {{ statisticsExpenses[0] }} |
| 视觉 | {{ statisticsExpenses[1] }} |
| 交互 | {{ statisticsExpenses[2] }} |
| 测试 | {{ statisticsExpenses[3] }} |
</chart>
</tab>
<tab label="预算与实际">
<chart bind="statisticsSelectedExpense" key="项目" kind="scatter" title="预算与实际散点" x="预算" y="实际" x-label="预算" y-label="实际">
| 项目 | 实际 | 预算 |
| --- | ---: | ---: |
| 内容 | {{ statisticsExpenses[0] }} | {{ statisticsBudgets[0] }} |
| 视觉 | {{ statisticsExpenses[1] }} | {{ statisticsBudgets[1] }} |
| 交互 | {{ statisticsExpenses[2] }} | {{ statisticsBudgets[2] }} |
| 测试 | {{ statisticsExpenses[3] }} | {{ statisticsBudgets[3] }} |
</chart>
</tab>
</tabs>

### 看看写法

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

<const name="layoutWorkshopDay" value="{{ '2026-11-01' }}">
<computed name="layoutReadingPhase" value="{{ layoutReadingDate == '' ? 'undated' : dateCompare(layoutReadingDate, layoutWorkshopDay) < 0 ? 'before' : dateCompare(layoutReadingDate, layoutWorkshopDay) == 0 ? 'during' : 'after' }}">
<computed name="layoutDaysUntil" value="{{ layoutReadingDate == '' ? null : dateDiff(layoutWorkshopDay, layoutReadingDate) }}">

## 让一份活动指南更好读

先并排比较两张卡片，再将阅读日期改到活动当天或之后，观察提示变化。切换阅读角色、展开常见问题，找到需要的内容。

<anchor id="reading-start">

<section color="#45536f">
先找到需要的阅读深度。<text color="#a2273a">**把重要提醒放在读者看得见的位置。**</text> 段落可以统一着色，局部文字可以单独强调。
</section>

<jump to="reading-details" appearance="button" color="#2563eb">跳到常见问题</jump>

<panel title="阅读时间">
<date bind="layoutReadingDate" label="你在哪天阅读？" initial="2026-10-24">
</panel>

<badge tone="{{ layoutReadingPhase == 'before' ? 'neutral' : layoutReadingPhase == 'undated' ? 'warning' : 'success' }}">{{ layoutReadingPhase == 'before' ? '活动前：准备' : layoutReadingPhase == 'during' ? '活动当天：动手探索' : layoutReadingPhase == 'after' ? '活动后：回顾' : '选择阅读日期' }}</badge>

<if when="{{ layoutReadingPhase == 'before' }}">
距离 **{{ layoutWorkshopDay }}** 的活动还有 **{{ layoutDaysUntil }}** 天，先从准备卡片开始。
</if>
<if when="{{ layoutReadingPhase == 'after' }}">
活动已过去 **{{ layoutDaysUntil == null ? 0 : -layoutDaysUntil }}** 天。回顾一次有效的探索，并向同伴分享。
</if>

<grid>
<card title="活动之前">
准备一份简短的 Markdown 文档，想好一个希望读者能动手探索的问题。

<badge>准备</badge>
</card>
<card title="活动之中">
给文档加入输入控件，展示参数改变时，解释和结果如何随之变化。

<badge tone="success">动手体验</badge>
</card>
</grid>

### 选择你的阅读角色

<tabs label="活动角色">
<tab label="参与者">
#### 让一个想法可以交互

1. 找到一个读者可以调整的数字。
2. 把它连接到一句话或一张图。
3. 请同伴操作，观察结果。

把参数命名后， <tooltip text="命名后的输入控件，可以让正文和图表读取它当前的值。">响应式绑定</tooltip> 会将输入和解释连接起来。
</tab>
<tab label="组织者">
#### 引导一次探索

先展示结果，再邀请大家做一次明确的调整。讨论发生了什么，最后展开源码，解释其中的关系。

> 可以这样提问：如果把这个值翻倍，会发生什么？
</tab>
</tabs>

<anchor id="reading-details">

### 按需展开细节

<accordion label="活动常见问题">
<disclosure label="需要提前准备什么？" open>
准备浏览器、一篇短文和一个具体问题，就可以开始。
</disclosure>
<disclosure label="这些布局如何搭配？">
卡片用于比较相关信息，标签页区分阅读情境，折叠内容保留随时可查的补充细节。
</disclosure>
</accordion>

<alert title="保持阅读主线">先呈现主要解释，再让读者决定何时展开补充内容。</alert>

<jump to="reading-start" appearance="button" color="#2563eb">返回阅读概览</jump>

### 看看写法

<accordion>
<disclosure label="展开关键源码">

```markdown
<const name="workshopDay" value="{{ '2026-11-01' }}">
<date bind="readingDate" label="阅读日期" initial="2026-10-24">
<computed name="daysUntil" value="{{ readingDate == '' ? null : dateDiff(workshopDay, readingDate) }}">
<grid>
<card title="活动日期">{{ workshopDay }}</card>
<card title="相隔天数">{{ daysUntil }}</card>
</grid>
<accordion>
<disclosure label="阅读更多">在这里补充细节。</disclosure>
</accordion>
```

</disclosure>
</accordion>

<const name="flowRate" value="{{ 80 }}">
<computed name="flowTotal" value="{{ flowPeople * flowRate }}">

## 跟随一个数值走过文档

先调整人数，再依次选择输入、计算和显示节点，跟随同一个数值，观察它如何变成最终结果。

<panel title="试一个数值">
<slider bind="flowPeople" label="人数" initial="4" min="1" max="12">
</panel>

<diagram bind="flowSelected" initial="input" label="从输入到解释">
<node id="input" label="输入: {{ flowPeople }}">
滑块用 people 命名当前数值，目前是 **{{ flowPeople }}**.
</node>
<node id="compute" label="计算: {{ flowPeople }} × {{ flowRate }}">
每人费用 80 元，总费用为 **{{ flowPeople }} × {{ flowRate }} = {{ flowTotal }}**.
</node>
<node id="view" label="显示: {{ flowTotal }}">
正文读取只读的 total：活动费用为 **{{ formatCurrency(flowTotal, 'CNY', 2, 'zh-CN') }}**。计算节点、这里和下方说明共用这一个结果。
</node>
<edge from="input" to="compute" label="参数变化">
<edge from="compute" to="view" label="结果更新">
</diagram>

正在查看： **{{ flowSelected == 'input' ? '输入' : flowSelected == 'compute' ? '计算' : '显示' }}**.

<if when="{{ flowSelected == 'input' }}">
<alert title="从可调整的输入开始">试着调到 6 人，再选择计算节点，跟进计算过程。</alert>
</if>
<if when="{{ flowSelected == 'compute' }}">
<alert title="让关系可见">命名计算 total = people * rate 的结果是 **{{ flowTotal }}**.</alert>
</if>
<if when="{{ flowSelected == 'view' }}">
<alert tone="success" title="文档呈现计算结果">当前 {{ flowPeople }} 人，总费用为 **{{ flowTotal }}**.</alert>
</if>

### 用键盘继续探索

按 Tab 聚焦图中的节点，用方向键移动焦点，再按 Enter 或空格键选择。节点说明和图下正文会跟随选择同步更新。

### 按步骤解释这个流程

<steps label="讲解路线" bind="flowLesson">
<step label="读取输入" value="observe">
先查看输入节点，当前人数为 **{{ flowPeople }}**。
</step>
<step label="核对计算" value="calculate">
选择计算节点。每人 80 元，因此 **{{ flowPeople }} × {{ flowRate }} = {{ flowTotal }}**。
</step>
<step label="解释结果" value="practice">
选择显示节点，向同伴说明人数变化为何会改变合计。

<quiz type="choice" label="哪个表达式用于计算总费用？" answer="total" explanation="总费用等于人数乘以每人的费用。">
<option value="total">people × 80</option>
<option value="sum">people + 80</option>
<option value="fixed">80</option>
</quiz>

<counter label="讲解轮数" initial="0" min="0" max="10">
</step>
</steps>

当前步骤：**{{ flowLesson }}**。向同伴讲清一次结果后，可以记录一轮讲解。

### 看看写法

<accordion>
<disclosure label="展开关键源码">

```markdown
<const name="rate" value="{{ 80 }}">
<computed name="total" value="{{ people * rate }}">
<slider bind="people" label="人数" initial="4" min="1" max="12">
<diagram bind="selected" initial="input" label="一个简单流程">
<node id="input" label="输入: {{ people }}">读取人数。</node>
<node id="compute" label="计算: {{ total }}">{{ people }} × {{ rate }} = {{ total }}</node>
<node id="view" label="显示: {{ total }}">{{ formatCurrency(total, 'CNY', 2, 'zh-CN') }}</node>
<edge from="input" to="compute">
<edge from="compute" to="view">
</diagram>
当前节点: {{ selected }}
```

</disclosure>
</accordion>

<const name="tasksPreparationCount" value="{{ 3 }}">
<computed name="tasksReadyCount" value="{{ len(tasksDone) }}">
<computed name="tasksCompletion" value="{{ tasksReadyCount / tasksPreparationCount }}">
<computed name="tasksReadyToShare" value="{{ tasksReadyCount == tasksPreparationCount }}">

## 完成一次专注活动

勾选准备步骤、清点到场人数，再启动一段专注计时。同一页集中呈现活动安排、完成进度和时间。

<panel title="活动准备进度">
<checklist color="#167875" bind="tasksDone" label="一起做好准备">
- [x] 选定一个要探索的问题
- [ ] 打开文档，调整一个参数
- [ ] 向同伴解释观察到的结果
</checklist>

已完成： **{{ tasksReadyCount }} / {{ tasksPreparationCount }}**。勾选后，下表会补上对应的回顾问题。

<progress color="#167875" label="准备进度" value="{{ tasksCompletion * 100 }}">

<badge tone="{{ tasksReadyToShare ? 'success' : 'neutral' }}">{{ formatPercent(tasksCompletion, 0, 'zh-CN') }} 已完成</badge>

<data-table label="已完成的准备" rows="{{ tasksDone }}" key="{{ item }}" max-rows="3">
<column label="事项" value="{{ item == 'item-1' ? '选定探索问题' : item == 'item-2' ? '调整文档参数' : '向同伴解释结果' }}">
<column label="回顾问题" value="{{ item == 'item-1' ? '希望了解什么？' : item == 'item-2' ? '调整后有什么变化？' : '如何解释这一结果？' }}">
</data-table>

<if when="{{ tasksReadyToShare }}">
<alert tone="success" title="可以开始分享了">问题、示例和观察结果都已准备就绪。</alert>
</if>
</panel>

<grid>
<card title="到场人数">
<counter bind="tasksCount" label="已到场人数" initial="0" min="0" max="20">
已到场： **{{ tasksCount }}**.
</card>
<card title="一分钟探索">
<timer label="专注计时器" duration="60">
准备好后开始；需要讨论时暂停，下一轮探索时重置。
</card>
</grid>

### 查看完整活动安排

<timeline title="45 分钟活动安排">
| 事项 | 开始 | 时长 | 说明 |
| --- | ---: | ---: | --- |
| 确定问题 | 0 | 10 | 确定一个要探索的主题 |
| 动手探索 | 10 | 25 | 调整控件，比较结果 |
| 整理观察 | 15 | 15 | 与探索阶段同步记录 |
| 交流分享 | 35 | 10 | 分享一个有用的发现 |
</timeline>

恢复活动准备进度的默认值，会重置该清单。人数计数器和计时器位于面板外，各自保留状态。

### 记录分享后的待办

已完成事项会加上删除线。隐藏再展开这份清单，已经勾选的事项仍会保留。

<toggle bind="tasksFollowUp" label="显示后续待办" initial="true">
<if when="{{ tasksFollowUp }}">
<checklist label="分享之后" color="#167875">
- [ ] 保存一个有用的观察结果
- [ ] 把文档分享给同伴
</checklist>
</if>

### 看看写法

<accordion>
<disclosure label="展开关键源码">

```markdown
<checklist bind="done" label="准备步骤">
- [x] 选定问题
- [ ] 探索结果
</checklist>
<computed name="completion" value="{{ len(done) / 2 }}">
<progress label="进度" value="{{ completion * 100 }}">
{{ formatPercent(completion, 0) }}

<data-table label="已完成事项" rows="{{ done }}" key="{{ item }}" max-rows="2">
<column label="事项" value="{{ item == 'item-1' ? '选定问题' : '探索结果' }}">
</data-table>
```

</disclosure>
</accordion>
