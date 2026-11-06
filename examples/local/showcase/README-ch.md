# 功能演示

**中文** · [English](README.md)

Playground 默认打开[傅里叶级数课堂](../scenarios/classroom-zh.reactive.md)，另有[社区阅读角提案](../scenarios/proposal-zh.reactive.md)、[活动意向调研](../scenarios/survey-zh.reactive.md)和[文学博客](../scenarios/blog-zh.reactive.md)。下面六份源文件合成一篇连续的[功能演示](zh/features.reactive.md)，从单个菜单入口打开。使用其大纲导航；没有分类选择器。

修改这六份源文件后，运行 `npm run update:feature-demo (in ReactiveMD-Demo)`。生成器通过 SDK 重命名活动绑定，保留代码示例原文，并检查合并文档能否编译。历史示例 ID 继续支持旧链接和草稿。

| 功能 | 英文源码 | 中文源码 | 操作提示 |
| --- | --- | --- | --- |
| 函数与公式 | [functions](functions.reactive.md) | [functions](zh/functions.reactive.md) | 曲线与期末金额共用月利率，读取货币、小数与科学计数法 |
| 表单与联动 | [forms](forms.reactive.md) | [forms](zh/forms.reactive.md) | 校验日期与费用，整理称呼，并为最多两个所选主题生成准备清单 |
| 数据与统计图表 | [statistics](statistics.reactive.md) | [statistics](zh/statistics.reactive.md) | 汇总同一份费用数组，并在表格与图表间联动选择项目 |
| 内容与布局 | [layout](layout.reactive.md) | [layout](zh/layout.reactive.md) | 调整阅读日期，观察活动前后提示，切换角色并展开细节 |
| 图解与流程 | [flow](flow.reactive.md) | [flow](zh/flow.reactive.md) | 沿节点追踪固定单价与命名合计，查看各处共享的结果 |
| 清单与计时 | [tasks](tasks.reactive.md) | [tasks](zh/tasks.reactive.md) | 按完成事项生成回顾表，读取百分比进度并启动计时 |

统计场景把四个费用控件组成一个数字数组，合计、均值、最小值、最大值以及图表中的索引读数共用该集合。正文使用货币与百分比格式，图表继续读取数字。项目选择在表格与图表间联动，筛选仅影响该表。

生成表格声明了明确的行预算：表单最多两个主题行，清单最多三个已完成事项行，均以选项的稳定标识作为行键。活动日期和费用重新满足约束后，校验提示自动消失。阅读日期由读者明确选择，同一日期在不同机器上得到相同提示。

每份源码都是使用公开本地交互语法的完整文档。原有的[独立示例](../README-ch.md)仍保留，用于更小的片段和组块回归检查。
