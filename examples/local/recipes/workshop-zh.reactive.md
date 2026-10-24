<computed name="costs" value="{{ [seats * 80, materials ? seats * 20 : 0] }}">
<computed name="total" value="{{ sum(costs) }}">

# 校验工作坊计划

<panel title="工作坊计划">
<number bind="seats" label="人数" initial="4" min="1" max="20">
<number bind="budget" label="预算" initial="500" min="0" max="5000">
<toggle bind="materials" label="包含材料">
<date bind="startDate" label="开始日期" initial="2026-10-24">
<date bind="endDate" label="结束日期" initial="2026-10-26">
<multi-select bind="subjects" label="主题" max-selected="3">
<option value="mathematics">数学</option>
<option value="physics">物理</option>
<option value="chemistry">化学</option>
</multi-select>
</panel>

<validation when="{{ total <= budget }}" message="预估 {{ formatCurrency(total, 'CNY', 2, 'zh-CN') }} 已超出预算。" fields="seats budget materials">
<validation when="{{ startDate == '' || endDate == '' || dateCompare(endDate, startDate) >= 0 }}" message="结束日期应不早于开始日期。" fields="startDate endDate">

<badge tone="{{ total <= budget ? 'success' : 'warning' }}">预估：{{ formatCurrency(total, 'CNY', 2, 'zh-CN') }}</badge>

教学：{{ formatCurrency(costs[0], 'CNY', 2, 'zh-CN') }}。材料：{{ formatCurrency(costs[1], 'CNY', 2, 'zh-CN') }}。
平均费用类别：{{ formatCurrency(average(costs), 'CNY', 2, 'zh-CN') }}。

<data-table label="已选主题" rows="{{ subjects }}" key="{{ item }}" max-rows="3">
<column label="主题标识" value="{{ item }}">
<column label="序号" value="{{ index + 1 }}">
<column label="准备工作" value="{{ item == 'chemistry' ? '准备材料' : '准备例题' }}">
</data-table>

选择主题后表格自动生成行。调低预算可查看警告，再修改预算或人数即可消除。重置面板恢复初始计划。
