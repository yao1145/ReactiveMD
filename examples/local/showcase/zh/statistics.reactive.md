# 一份预算，多种观察方式

把视觉费用从 230 调到 300，总费用恰好达到 690 元预算；继续增加，观察超支提示。下方各视图读取同一组费用参数。

<grid>
<card>
<panel title="活动费用">
<number bind="content" label="内容费用" initial="120" min="0" max="1000" step="10">
<number bind="visual" label="视觉费用" initial="230" min="0" max="1000" step="10">
<number bind="interaction" label="交互费用" initial="180" min="0" max="1000" step="10">
<number bind="testing" label="测试费用" initial="90" min="0" max="1000" step="10">
</panel>
</card>
<card>
<grid>
<card title="费用合计">**{{ content + visual + interaction + testing }} 元**</card>
<card title="预算余额">**{{ 690 - (content + visual + interaction + testing) }} 元**</card>
</grid>

<if when="{{ content + visual + interaction + testing > 690 }}">
<alert tone="warning" title="费用已超出预算">需要减少 **{{ content + visual + interaction + testing - 690 }}** 元，才能回到 690 元预算内。</alert>
</if>

<chart title="实际费用与预算比较" y-label="元">
| 项目 | 实际 | 预算 |
| --- | ---: | ---: |
| 内容 | {{ content }} | 150 |
| 视觉 | {{ visual }} | 200 |
| 交互 | {{ interaction }} | 220 |
| 测试 | {{ testing }} | 120 |
</chart>
</card>
</grid>

## 查看数据明细

搜索项目、按实际费用排序，或翻页查看。搜索只筛选此表，图表继续展示全部四个项目。

<table label="费用明细" page-size="2">
| 项目 | 实际 | 预算 |
| --- | ---: | ---: |
| 内容 | {{ content }} | 150 |
| 视觉 | {{ visual }} | 200 |
| 交互 | {{ interaction }} | 220 |
| 测试 | {{ testing }} | 120 |
</table>

## 换一种观察角度

<tabs label="预算视角">
<tab label="费用占比">
<chart kind="donut" title="费用流向">
| 项目 | 实际 |
| --- | ---: |
| 内容 | {{ content }} |
| 视觉 | {{ visual }} |
| 交互 | {{ interaction }} |
| 测试 | {{ testing }} |
</chart>
</tab>
<tab label="预算与实际">
<chart kind="scatter" title="预算与实际散点" x="预算" y="实际" x-label="预算" y-label="实际">
| 项目 | 实际 | 预算 |
| --- | ---: | ---: |
| 内容 | {{ content }} | 150 |
| 视觉 | {{ visual }} | 200 |
| 交互 | {{ interaction }} | 220 |
| 测试 | {{ testing }} | 120 |
</chart>
</tab>
</tabs>

## 看看写法

<accordion>
<disclosure label="展开关键源码">

```markdown
<number bind="visual" label="视觉费用" initial="230" min="0" max="1000">
<chart title="实际费用与预算比较">
| 项目 | 实际 | 预算 |
| --- | ---: | ---: |
| 视觉 | {{ visual }} | 200 |
</chart>
```

</disclosure>
</accordion>
