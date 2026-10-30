# 第二阶段组件迁移清单

状态：46 个组件迁移完成，3 个内核声明保留。基线：`d227fc09c503f8094883c33be87ad0a13d866213`，包版本 `0.6.1`。

清单包含迁移前的全部 49 个声明。46 个渲染或结构组件由默认预设提供，`computed`、`const`、`external` 继续作为内核语言声明。每个组件的属性、绑定与规则以 `src/presets/default-components.ts` 中经过公开校验的 manifest 为准。

表内“原结构”记录迁移前的语义要求，用于核对兼容性；实现文件位于 `src/components/`。结构子项也拥有普通注册项，由容器通过公共内容投影消费。

| 声明 | 原绑定 family / 槽位 | 原结构 | 实现 | 当前验收状态 |
| --- | --- | --- | --- | --- |
| `input` | text | none | `controls.tsx / InputView` | 基线与回归通过 |
| `textarea` | text | none | `controls.tsx / TextareaView` | 基线与回归通过 |
| `number` | number | none | `controls.tsx / NumberView` | 基线与回归通过 |
| `slider` | number | none | `controls.tsx / SliderView` | 基线与回归通过 |
| `range-slider` | start:number, end:number | none | `controls.tsx / RangeSliderView` | 基线与回归通过 |
| `coordinate` | x:number, y:number | none | `controls.tsx / CoordinateView` | 基线与回归通过 |
| `toggle` | boolean | none | `controls.tsx / ToggleView` | 基线与回归通过 |
| `checkbox` | boolean | none | `controls.tsx / CheckboxView` | 基线与回归通过 |
| `date` | date | none | `controls.tsx / DateView` | 基线与回归通过 |
| `select` | choice | options | `controls.tsx / SelectView` | 基线与回归通过 |
| `choices` | choice | options | `controls.tsx / ChoicesView` | 基线与回归通过 |
| `radio-group` | choice | options | `controls.tsx / RadioGroupView` | 基线与回归通过 |
| `multi-select` | multi-select | options | `controls.tsx / MultiSelectView` | 基线与回归通过 |
| `option` | 无 | inline | `layout.tsx / OptionView` | 基线与回归通过 |
| `counter` | number | none | `controls.tsx / CounterView` | 基线与回归通过 |
| `timer` | timer | none | `controls.tsx / TimerView` | 基线与回归通过 |
| `checklist` | checklist | content | `controls.tsx / ChecklistView` | 基线与回归通过 |
| `progress` | 无 | none | `controls.tsx / ProgressView` | 基线与回归通过 |
| `jump` | 无 | inline | `layout.tsx / JumpView` | 基线与回归通过 |
| `anchor` | 无 | none | `layout.tsx / AnchorView` | 基线与回归通过 |
| `text` | 无 | inline | `layout.tsx / TextView` | 基线与回归通过 |
| `section` | 无 | any | `layout.tsx / SectionView` | 基线与回归通过 |
| `quiz` | 无 | quiz | `controls.tsx / QuizView` | 基线与回归通过 |
| `panel` | 无 | any | `layout.tsx / PanelView` | 基线与回归通过 |
| `card` | 无 | any | `layout.tsx / CardView` | 基线与回归通过 |
| `grid` | 无 | cards | `layout.tsx / GridView` | 基线与回归通过 |
| `tabs` | tabs | tabs | `layout.tsx / TabsView` | 基线与回归通过 |
| `tab` | 无 | any | `layout.tsx / TabView` | 基线与回归通过 |
| `steps` | steps | steps | `layout.tsx / StepsView` | 基线与回归通过 |
| `step` | 无 | any | `layout.tsx / StepView` | 基线与回归通过 |
| `accordion` | 无 | disclosures | `layout.tsx / AccordionView` | 基线与回归通过 |
| `disclosure` | 无 | any | `layout.tsx / DisclosureView` | 基线与回归通过 |
| `if` | 无 | any | `layout.tsx / IfView` | 基线与回归通过 |
| `alert` | 无 | any | `layout.tsx / AlertView` | 基线与回归通过 |
| `badge` | 无 | inline | `layout.tsx / BadgeView` | 基线与回归通过 |
| `tooltip` | 无 | inline | `layout.tsx / TooltipView` | 基线与回归通过 |
| `computed` | 无 | none | 内核声明 | 基线与回归通过 |
| `const` | 无 | none | 内核声明 | 基线与回归通过 |
| `external` | 无 | none | 内核声明 | 基线与回归通过 |
| `validation` | 无 | none | `layout.tsx / ValidationView` | 基线与回归通过 |
| `data-table` | 无 | columns | `data-table.tsx / DataTableView` | 基线与回归通过 |
| `column` | 无 | none | `visuals.tsx / ColumnView` | 基线与回归通过 |
| `table` | selection | table | `visuals.tsx / TableView` | 基线与回归通过 |
| `chart` | selection | table | `visuals.tsx / ChartView` | 基线与回归通过 |
| `plot` | 无 | plot | `visuals.tsx / PlotView` | 基线与回归通过 |
| `timeline` | 无 | table | `visuals.tsx / TimelineView` | 基线与回归通过 |
| `diagram` | diagram | diagram | `visuals.tsx / DiagramView` | 基线与回归通过 |
| `node` | 无 | content | `visuals.tsx / NodeView` | 基线与回归通过 |
| `edge` | 无 | none | `layout.tsx / EdgeView` | 基线与回归通过 |

## 验收依据

- `tests/sdk-phase2-baseline.test.tsx`：使用迁移前产物记录的 85 组用例，核对诊断、初始状态、绑定约束、状态写入和静态输出。基线保存在 `tests/fixtures/sdk-phase2-baseline.json`。
- `tests/sdk-phase2-boundary.test.ts`：检查默认定义通过公开 validator、实现模块的导入边界、全部外部别名的语义，以及 Worker 数据克隆、编译结果补丁和增量编辑。
- 各组件原有编译、运行时、React 与浏览器回归继续约束交互行为。
- `examples/integration/extension-sdk/advanced.tsx`：独立消费项目中的坐标、集合和 Markdown 容器。`scripts/verify-sdk-consumer.mjs` 从真实安装包验收类型、SSR、静态模式及桌面/手机断网恢复。

完整结果见[统一验收记录](extension-sdk-acceptance-ch.md)。每行的 manifest 由同名默认定义提供，结构与状态由通用内核规则执行；组件结构样式沿用公共 `src/styles.css`，无需新增内置专用分发。
