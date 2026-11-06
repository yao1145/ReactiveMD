# 本地交互语法演示

**中文** · [English](README.md)

这些是 `local-draft-2` 的独立创作示例，说明见[本地交互语法规范](../../docs/reference/local-interaction-syntax-ch.md)。Playground 以[快速计算器](pricing.reactive.md)开始，随后是六个聚焦的[功能演示](showcase/README-ch.md)。组块分布在这六个场景中；诊断有独立的辅助菜单。宿主可通过[本地模式 API](../../docs/integration/local-integration-ch.md) 编译并渲染每份文档。

原有的十一个工作示例和一份故意损坏的诊断文档仍保留在本目录，中文版本在 [zh/](zh/)。六个功能演示位于 [showcase/](showcase/README-ch.md)，中文源码在 [showcase/zh/](showcase/zh/)。每个文件都可独立运行。控件、表达式和可视化都使用本地状态。

新增的 [HTML 兼容示例](html-compat.reactive.md) 组合了富文本 disclosure、Markdown 和绑定计数器。启用作者 CSS、JavaScript 或扩展 HTML 前，请先阅读[临时 HTML 分流政策](../../docs/reference/html-compatibility-ch.md)。

## 从简短示例开始

[工作坊配方](recipes/workshop.reactive.md)（[中文](recipes/workshop-zh.reactive.md)）组合了跨字段校验、条件色调、数字聚合和生成表格行。规则与预算见[条件、校验与集合参考](../../docs/reference/constraints-collections-ch.md)。

[账单配方](recipes/invoice.reactive.md)（[中文](recipes/invoice-zh.reactive.md)）演示共享计算、常量、格式化和 UTC 日期差。[计算参考](../../docs/reference/computations-formatting-ch.md)解释其规则。

从[套餐计算器](pricing.reactive.md)开始，然后选择一个[功能演示](showcase/README-ch.md)。如需最小的状态示例，请阅读最初的[计数器](counter.reactive.md)。如果你刚接触该语法，请阅读[新用户指南](../../docs/guides/local-guide-ch.md)。

## 原有独立示例目录

| 文件 | 内容 |
| --- | --- |
| [counter.reactive.md](counter.reactive.md) | 单行计数器，内置加、减和重置 |
| [pricing.reactive.md](pricing.reactive.md) | 套餐计算器，参数在面板内联动 |
| [comparison.reactive.md](comparison.reactive.md) | 并排比较、就地声明的开关、自行管理选择的标签页 |
| [parameters.reactive.md](parameters.reactive.md) | 实时参数面板，含文本、日期和选项输入 |
| [checklist.reactive.md](checklist.reactive.md) | 固定可勾选列表和增强表格 |
| [charts.reactive.md](charts.reactive.md) | 由表格构建的图表，含 LaTeX 复利公式 |
| [diagram.reactive.md](diagram.reactive.md) | 自动布局的交互图与曲线 |
| [catalog.reactive.md](catalog.reactive.md) | 本地目录搜索、排序和分页 |
| [planning.reactive.md](planning.reactive.md) | 时间线、计时器和分摊计算 |
| [components.reactive.md](components.reactive.md) | 内容卡片、disclosure、标签页和提示组块 |
| [gallery.reactive.md](gallery.reactive.md) | 常用输入、独立组块和原样展示的代码 |
| [diagnostics.reactive.md](diagnostics.reactive.md) | 故意损坏的诊断示例 |

Playground 的示例索引维护在仓库的演示应用中。

## 工作示例的预期行为

下表列出每份文档的初始值和交互检查点。数字遵循正文中的公式。

| 示例 | 初始显示 | 交互检查 |
| --- | --- | --- |
| comparison | Basic 100 USD，Pro 200 USD | 切换年付后变为 80/160；切换标签页无需声明变量；重置后恢复月付 |
| parameters | 日期 2026-10-22、个人用途、名称为空 | 输入名称会更新卡片；选择团队用途会更新描述；勾选开关会显示准备清单；面板重置会恢复字段和开关 |
| checklist | 1/3 项，进度约 33.33% | 全选后显示完成提示；重置只恢复第一项；表格可按价格排序、搜索和分页 |
| charts | 4 项预算对比；储蓄参数 10000、500、5%、20 年；方案柱 40/70 | 利率为 0 时曲线末端读数为 130000；默认复利读数约为 232643.24；5 人时柱为 100/175 |
| diagram | 选中输入节点，a=1，f=1 | 点击计算节点会更新详情和正文；a=0 时曲线变平并出现提示；两条固定曲线同时显示 |
| catalog | 8 行目录，每页 4 行 | 搜索 "visual" 返回 chart/plot/diagram；无匹配时显示空状态；重置会清除查询、排序和页码 |
| planning | 45 分钟时间线，倒计时暂停在 60 秒，每人 88 USD | 计时器启动/暂停/重置；额外费用为 0 时每人支付 80 USD；从 15 开始的参考任务与主段重叠 |
| components | 简明说明，第一个 disclosure 展开 | 选择详细会切换正文；工具提示可通过键盘聚焦；其他 disclosure 可独立展开 |
| pricing | 2 人，每人 100 USD，共 200 USD | 年付为 160 USD；5 人年付为 400 USD 并显示团队提示；重置恢复 200 USD |
| counter | 0 | 三次增量显示 3；三次减量回到 0 并禁用减号；重置回到 0 |
| gallery | Alex、数量 3、Pro、月付、费用 240 USD | 年付为 192 USD；隐藏再显示快递段会保留其勾选；独立计数器和计时器无需 bind；代码块中的 `example` 不会创建变量 |

在 parameters 中，条件清单位于面板之外：其现有勾选在隐藏后仍保留，也不在该面板的重置范围内。gallery 中的独立计数器和计时器同样位于输入面板之外，因此重置输入面板不会影响它们。

## 诊断示例的预期结果

[diagnostics.reactive.md](diagnostics.reactive.md) 故意包含以下 9 类错误。编辑器应收集可恢复的独立诊断，整份文档不得激活交互。

1. `seat` 未声明；消息可以建议已有的参数 `seats`。
2. `seats` 有重复的显式初始值；两处来源都会被报告。
3. `ratio` 的初始值为 12，超过最大值 10。
4. if.when 收到数字 `seats`，但需要布尔值。
5. `slidr` 是未知组块；消息可以建议 `slider`。
6. `on-click` 不属于 counter 或本地交互事件语法。
7. 边目标 `missing` 不存在。
8. 积分可以显示，但在第一版 plot 中不是可计算结构。
9. 图表的 cost 列包含 `20 USD`，即需要纯数字处出现文本。

## 检查入口

`npm test` 检查解析、绑定、表达式、LaTeX、运行时和示例；`npm test (in ReactiveMD-Demo)` 检查 Playground 索引；`npm run check` 运行完整的 Node 端和浏览器门禁，包括实际 tarball 消费和 HTML 导出。各命令见[参与开发指南](../../CONTRIBUTING-ch.md)。

[六个场景](showcase/README-ch.md)包含全部 49 个标签名：Functions 中的区间、坐标和数值题；Forms 中的输入选项；Data 中的联动选择；Layout 中的跳转和正文颜色；Flow 中的分步引导和选择题；Checklists 中的待办和计时。独立 gallery 和交互演示源文件仍作为创作示例保留。
