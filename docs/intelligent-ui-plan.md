# Reactive MD Intelligent UI 能力与完成记录

本轮以 OpenAI 于 2026-10-07 发布的 [Intelligent UI 说明](https://openai.com/index/gpt-6-for-everyone/) 中公开展示的能力作为验收基线：文字与图形混排、按钮与表单、图表、并排比较、交互图解、计划、计算器，以及可渐进呈现的组件。按用户最新要求，小游戏和地图移出本轮范围。ChatKit 的公开组件文档作为表单、布局和动作的补充参考，不作为 Intelligent UI 的私有协议。

目标是把这些能力实现为 Reactive MD 的语言、组件与宿主接口。作者继续使用 Markdown、YAML 与受限表达式。模型如何选择布局属于生成端；本项目交付可供生成端消费的组件清单、语言示例和流式文档入口。

## 验收矩阵

| 能力 | Reactive MD 实现 | 验收证据 |
| --- | --- | --- |
| 文本与视觉混排 | 原有 Markdown、图片、图标、提示、统计与进度组件 | 正文、视觉组件和普通代码围栏混排 |
| 并排比较 | grid、card、tabs、tab、accordion、disclosure | 比较示例，375px 自动改单列 |
| 表单与选择 | form、submit、textarea、checkbox、radio-group、choices、date、checklist | 必填/格式校验、选择、提交结果 |
| 数据展示 | sortable/searchable/paginated table、list、each | 排序筛选、列表作用域和集合更新 |
| 图表 | bar/line/area/scatter/donut chart、formula plot | 图例、提示、键盘选择、输入驱动曲线 |
| 交互图解 | diagram 节点、连线与选中说明 | 图形选择与文本/状态双向联动 |
| 计划与计时 | timeline、timer | 计划排布、启动/暂停/重置计时 |
| 即时工具 | 分账、储蓄、比较与交互说明示例 | 全部由声明式文档驱动 |
| 渐进呈现 | 文档会话增量接收、完整结构提交与最终错误诊断 | 任意分片、未闭合块、不中断已提交交互 |
| 状态保留 | JSON 状态、文档 ID 隔离、恢复校验、localStorage 适配器 | 刷新恢复、跨文档隔离、旧 schema 拒绝 |
| 宿主动作 | capability 注册、异步资源状态、取消、latest-wins 与销毁 | 真实异步本地目录服务与确定性单测 |
| 作者与集成工具 | schema 清单、格式化、导入导出、主题/简洁视图、嵌入接口 | 项目构建、导出重载、主题与键盘检查 |

矩阵中的各项已实现并通过验证。44 个内置组件、完整语言语义与宿主契约分别记录在 [组件参考](components.md)、[语言参考](language-reference.md) 和 [宿主集成](integration.md)。

## 实施分工

1. 固定兼容 v0.1 的 TypeScript 扩展契约。状态扩大到 JSON；作用域通过 locals 显式传递；外部调用通过宿主 capability 接入。
2. Claude Code 的核心任务负责编译、表达式、schema、集合动作与异步运行时。表单/布局任务与图表/图解任务各自负责独立渲染模块，不交叉修改文件。
3. 主代理实现文档会话、持久化、流式播放、作者工具和整体集成，并补充完整语言示例。
4. 主代理核对实际文件，执行原有回归、扩展语义测试、浏览器交互、桌面/手机截图及生产构建。

外部服务由宿主注入，示例使用真实的本地目录过滤与异步取消流程。文档不包含密钥；语言运行时不需要 OpenAI API 凭据。接入模型时，生成端输出本语言源文档或向流式会话写入分片即可。

语言测试在 `tests/`，demo 条目测试在 `demo/tests/`，14 项基础和 26 项扩展浏览器检查在 `demo/scripts/`。语言与 demo 独立构建，浏览器结果保存在 `demo/artifacts/`；详细记录见 [Demo 实现与验证](../demo/IMPLEMENTATION.md)。
