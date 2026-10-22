# 本地交互语法 Demo

这些文件是 `local-draft-1` 的完整作者示例，对应 [本地交互语法规范](../../docs/local-interaction-syntax.md)。Playground 直接加载本目录；宿主通过 [本地模式 API](../../docs/local-integration.md) 编译和渲染。

本目录有 11 份正常示例、1 份故意含错的诊断示例。每份文件独立使用，不共享参数。正常示例均没有 YAML 配置、命名动作、事件处理或外部调用。

## 从短示例开始

建议先看 [计数器](counter.reactive.md)、[方案计算器](pricing.reactive.md) 和 [交互图解](diagram.reactive.md)，再看较长的图表与参数面板。日常写作只需用到其中少数组件。

## 完整目录

| 文件 | 内容 |
| --- | --- |
| [counter.reactive.md](counter.reactive.md) | 一行计数器，自带加、减和重置 |
| [pricing.reactive.md](pricing.reactive.md) | 方案计算器，面板内参数联动 |
| [comparison.reactive.md](comparison.reactive.md) | 并排比较，开关就地声明，标签页内部管理选择 |
| [parameters.reactive.md](parameters.reactive.md) | 实时参数面板，含输入、日期和选择器 |
| [checklist.reactive.md](checklist.reactive.md) | 固定可勾选清单与增强表格 |
| [charts.reactive.md](charts.reactive.md) | 表格生成图表，复利公式使用 LaTeX |
| [diagram.reactive.md](diagram.reactive.md) | 自动布局的交互图解与曲线 |
| [catalog.reactive.md](catalog.reactive.md) | 本地目录搜索、排序和分页 |
| [planning.reactive.md](planning.reactive.md) | 时间轴、计时器与分账计算 |
| [components.reactive.md](components.reactive.md) | 内容卡片、折叠、标签页与提示组件 |
| [gallery.reactive.md](gallery.reactive.md) | 常用输入、独立组件和原样代码 |
| [diagnostics.reactive.md](diagnostics.reactive.md) | 故意含错的诊断示例 |

Playground 的示例索引位于 [demo/src/examples.ts](../../demo/src/examples.ts)。

## 正常示例的预期行为

下表列出每份文档的初值与交互验收点。数值按正文公式计算。

| 示例 | 初始显示 | 交互检查 |
| --- | --- | --- |
| comparison | 基础 100 元，专业 200 元 | 开启年度付款变为 80/160；切换标签页不用声明变量；恢复默认回到月付 |
| parameters | 日期 2026-10-22，个人使用，称呼未填 | 输入称呼更新卡片；选择团队更新说明；勾选开关显示准备清单；面板重置恢复字段和开关 |
| checklist | 1/3 项，进度约 33.33% | 全选后显示完成提示；重置恢复仅第一项勾选；表格按价格排序、搜索和分页 |
| charts | 4 组预算比较；储蓄参数 10000、500、5%、20 年；方案柱高 40/70 | 利率调为 0 时曲线终点为 130000；默认复利终点约 232643.24；人数调为 5 时柱高 100/175 |
| diagram | 选中输入节点，a=1、f=1 | 点击计算节点更新详情和正文；a=0 时曲线变平并出现提示；两条固定曲线同时显示 |
| catalog | 8 行目录，每页 4 行 | 搜索“视觉”得到 chart/plot/diagram；无匹配显示空态；恢复默认清空查询、排序和页码 |
| planning | 45 分钟时间轴，倒计时暂停在 60 秒，每人 88 元 | timer 开始/暂停/重置；额外费用改为 0 时每人 80 元；开始 15 的参考任务与主体时间重叠 |
| components | 简洁说明，首个折叠项展开 | 选择详细后切换正文；提示可用键盘聚焦；其他折叠项独立展开 |
| pricing | 2 人，每人 100 元，合计 200 元 | 年付后 160 元；年付 5 人为 400 元且显示团队提示；重置回到 200 元 |
| counter | 0 | 连续加三次显示 3；减三次回到 0 后禁用减号；重置回到 0 |
| gallery | 小林、数量 3、专业版、月付，费用 240 元 | 年付后 192 元；加急区隐藏再出现保留勾选；独立计数器和计时器无需 bind；代码中的 example 不生成变量 |

parameters 中条件清单位于面板外：它的已有勾选在隐藏后保留，不属于该面板的重置范围。gallery 的独立计数器与计时器也位于输入面板外，输入面板重置不影响它们。

## 诊断示例的预期结果

[diagnostics.reactive.md](diagnostics.reactive.md) 故意包含以下 9 类错误。编辑器应收集可恢复的独立诊断，文件整体不能激活交互。

1. `seat` 未声明，可提示已有参数 `seats`。
2. `seats` 的显式 initial 重复，指出两处来源。
3. `ratio` 初值 12 超过最大值 10。
4. if.when 的 `seats` 为数字，要求布尔值。
5. `slidr` 是未知组件，可提示 slider。
6. `on-click` 不属于 counter，也不属于本地交互事件语法。
7. edge 的目标 `missing` 不存在。
8. 积分可以显示，但不属于首版绘图的可计算结构。
9. 图表费用列的 `20 元` 是文本，需要纯数值。

## 检查入口

`npm test` 检查解析、绑定、表达式、LaTeX、运行时和示例；`npm run test:demo` 检查 Playground 索引；启动应用后用 `npm run test:browser` 检查实际交互。`npm run test:docs` 检查文档链接。实际运行结果见 [实现说明](../../demo/IMPLEMENTATION.md)。
