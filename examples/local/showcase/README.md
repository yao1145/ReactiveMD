# Feature tours / 功能演示

The Playground has a short [Quick start](../pricing.reactive.md) and six feature tours. Each tour opens with a suggested interaction, develops one example and ends with expandable source snippets. Choose Show source to edit the whole document. Controls, calculations, validation, layout and visualizations appear within these six scenarios. [Errors & debugging](../diagnostics.reactive.md) is available from the auxiliary menu.

Playground 按“快速体验 + 六个场景”组织。每个场景开头给出明确操作，围绕一个案例展开，结尾可以查看关键源码。点击“显示源码”可编辑完整文档。控件、计算、校验、布局和可视化分布在这六个场景中，“错误与调试”保留在辅助菜单。

| Feature / 功能 | English source | 中文源码 | Try this / 操作提示 |
| --- | --- | --- | --- |
| Functions & formulas / 函数与公式 | [functions](functions.reactive.md) | [functions](zh/functions.reactive.md) | Share the monthly rate between a curve and balance; read currency, decimals and scientific notation / 曲线与期末金额共用月利率，读取货币、小数与科学计数法 |
| Forms & bindings / 表单与联动 | [forms](forms.reactive.md) | [forms](zh/forms.reactive.md) | Check dates and spending, trim the organizer name and generate a plan for up to two selected subjects / 校验日期与费用，整理称呼，并为最多两个所选主题生成准备清单 |
| Data & charts / 数据与统计图表 | [statistics](statistics.reactive.md) | [statistics](zh/statistics.reactive.md) | Aggregate one expense array and select the same category across tables and charts / 汇总同一份费用数组，并在表格与图表间联动选择项目 |
| Content & layout / 内容与布局 | [layout](layout.reactive.md) | [layout](zh/layout.reactive.md) | Move the reading date across workshop day, switch roles and open details / 调整阅读日期，观察活动前后提示，切换角色并展开细节 |
| Diagrams & flow / 图解与流程 | [flow](flow.reactive.md) | [flow](zh/flow.reactive.md) | Follow a constant rate and named total through nodes and explanations / 沿节点追踪固定单价与命名合计，查看各处共享的结果 |
| Checklists & timing / 清单与计时 | [tasks](tasks.reactive.md) | [tasks](zh/tasks.reactive.md) | Generate reflection rows from completed tasks, read percentage progress and start the timer / 按完成事项生成回顾表，读取百分比进度并启动计时 |


The data tour builds one numeric array from four expense controls. Its total, average, minimum, maximum and indexed chart values read that collection. Currency and percentage formatting stay in the prose, so chart inputs remain numeric. Selecting a category links the table and all charts; filtering affects only that table.

统计场景把四个费用控件组成一个数字数组，合计、均值、最小值、最大值以及图表中的索引读数共用该集合。正文使用货币与百分比格式，图表继续读取数字。项目选择在表格与图表间联动，筛选仅影响该表。

Generated tables declare small row budgets: two subject rows in Forms and three completed-task rows in Checklists. Both use the selected item's stable ID as the row key. Workshop validation hints clear when the dates and spending are consistent again. Reading dates are explicit inputs, so calendar guidance is reproducible across machines.

生成表格声明了明确的行预算：表单最多两个主题行，清单最多三个已完成事项行，均以选项的稳定标识作为行键。活动日期和费用重新满足约束后，校验提示自动消失。阅读日期由读者明确选择，同一日期在不同机器上得到相同提示。

Each source is a complete document using the public local interaction syntax. The original [standalone examples](../README.md) remain available for smaller snippets and component regression checks.
