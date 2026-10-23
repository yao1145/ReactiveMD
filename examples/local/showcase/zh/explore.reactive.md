# 选择、探索，再检查你的理解

选择两个主题、缩小观察区间，再拖动坐标点。检查一道练习题，最后在表格或图表中选择项目，观察另一视图同步变化。

<jump to="results" appearance="button" color="#2563eb">跳到结果</jump>

<panel title="试用新组块">

<anchor id="settings">

<section color="#45536f">
这几段正文使用统一颜色。<text color="#a2273a">**这条提醒单独着色。**</text> 链接和控件保留各自的样式。
</section>

<grid>
<card title="最多选择两个主题">
<multi-select bind="subjects" label="感兴趣的主题" max-selected="2" color="#167875">
<option value="math">数学</option>
<option value="physics">物理</option>
<option value="chemistry">化学</option>
</multi-select>

已选 **{{ len(subjects) }} / 2** 项。
<if when="{{ contains(subjects, 'chemistry') }}">
<badge color="#167875">已选择化学</badge>
</if>
</card>
<card title="调整观察区间">
<range-slider label="观察区间" bind-start="low" bind-end="high" initial-start="20" initial-end="80" min="0" max="100" color="#7c3aed">

当前区间：**{{ low }}–{{ high }}**，宽度为 **{{ high - low }}**。
</card>
</grid>

## 拖动一个点

<coordinate label="点的位置" bind-x="px" bind-y="py" initial-x="1" initial-y="2" x-min="-5" x-max="5" y-min="-5" y-max="5" color="#2563eb">

坐标：**({{ px }}, {{ py }})**，距原点 **{{ round(sqrt(px * px + py * py) * 100) / 100 }}**。

## 按步骤理解

<steps label="学习路线" bind="lesson">
<step label="观察" value="observe">
拖动坐标点，观察它到原点的距离如何变化。
</step>
<step label="计算" value="calculate">
距离等于两个坐标的平方和再开平方。
</step>
<step label="练习" value="practice">
完成下方练习，再勾选待办清单。
</step>
</steps>

当前步骤：**{{ lesson }}**。

<quiz type="choice" label="2 + 3 等于多少？" answer="b" explanation="将两个数相加，结果为 5。">
<option value="a">4</option>
<option value="b">5</option>
<option value="c">6</option>
</quiz>

<quiz type="number" label="填写圆周率的近似值" answer="3.14" tolerance="0.01" explanation="答案与 3.14 的差不超过 0.01 即可。">
</quiz>

## 勾选完成的事项

<checklist bind="done" label="探索清单" color="#167875">
- [x] 阅读操作说明
- [ ] 拖动坐标点
- [ ] 检查一道练习题
</checklist>

<progress label="探索进度" value="{{ len(done) / 3 * 100 }}" color="#167875">

<anchor id="results">

## 一次选择，两个视图

选择一个项目，表格与图表同步显示选择。表格的搜索、排序和分页不会改变当前选择。

<table label="项目选择" bind="project" key="项目" initial="内容" page-size="2">
| 项目 | 实际 | 预算 |
| --- | ---: | ---: |
| 内容 | 120 | 150 |
| 视觉 | 230 | 200 |
| 测试 | 90 | 120 |
</table>

<chart kind="bar" title="当前项目" bind="project" key="项目" y="实际,预算">
| 项目 | 实际 | 预算 |
| --- | ---: | ---: |
| 内容 | 120 | 150 |
| 视觉 | 230 | 200 |
| 测试 | 90 | 120 |
</chart>

当前选择：**{{ project }}**。

<jump to="settings" appearance="button" color="#2563eb">返回调整</jump>

</panel>
