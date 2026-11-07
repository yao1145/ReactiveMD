# 组件运行时服务：身份、随机、调度与状态

**中文** · 设计草案与首批实现记录

更新日期：2026-11-07。状态：P0–P3 的契约与最小实现已落地；示例包迁移和导出 CLI 的 sidecar 接线仍待后续版本。

本文记录组件运行时服务的设计决定。它不是作者语法规范；作者语法仍以[本地交互语法规范](../reference/local-interaction-syntax-ch.md)为准。

## 1. 问题与边界

两个小游戏暴露了同一类缺口：随机、时间、手势和保存逻辑都在组件内重复实现。现有实现本身是确定性的，问题不在“无法复现”，而在缺少统一的宿主接入、生命周期和保存协议。

| 层 | 职责 | 不承担 |
| --- | --- | --- |
| 编译器 | 解析、语义校验、生成可序列化文档 | 定时器、随机消费、DOM、存储 |
| 运行时服务 | 身份、种子派生、调度接口、组件状态协议 | 直接访问 `window`、`localStorage` |
| 浏览器适配层 | 页面可见性、时钟、动画帧、存储后端 | 业务策略、状态格式 |
| React 辅助层 | `useTicker`、`useSwipe`、`useKeys`、`useComponentState` | 标签、读屏文案、业务动作 |

`reactive-md/compiler` 与 `reactive-md/compiler/standard` 不导入这些模块。现有 `npm run test:compiler-entry` 继续守住该边界。

## 2. 身份契约

`local-<serial>` 节点 ID 只在一份已编译文档内稳定。插入前文会改变后续 ID，因此不能作为持久身份。

| 身份 | 来源 | 用途 |
| --- | --- | --- |
| 文档身份 | 宿主 `documentId`，否则源码摘要 | 状态命名空间、种子默认值 |
| 组件持久身份 | 包属性 `state-key` | 跨编辑恢复 |
| 组件会话身份 | `node.id` | 当前文档内的实例隔离 |
| 组件种子 | 显式 `seed` > 宿主 `randomSeed` > 派生值 | 随机流 |

规则：

- 没有 `state-key` 时，只保证同一份源码、同一会话内可恢复。
- 未提供 `documentId` 时，运行时以创建时的源码摘要作为身份；同一运行时对象内后续的源码编辑仍沿用该身份。需要严格按源码失效时，由宿主在编辑后创建新运行时。
- 重复 `state-key` 产生 `local.runtime.state.duplicate-key`，第二个实例不读写该记录。
- 同一 seed 只保证同一随机序列；完整回放还需要相同输入、时间策略和规则版本。

## 3. 随机

随机状态属于组件状态，由纯函数推进。宿主不提供隐式推进的可变生成器。

```ts
const random = createRandom(seed);
const step = nextRandom(random);
// step.value 是 [0, 1) 的样本，step.state 是可保存的新位置
```

- 算法 `mulberry32`，版本 `1`。
- `deriveRandom(seed, label)` / `ctx.services.random.derive(label)` 是纯派生，不注册全局流，不依赖调用顺序。
- 保存时记录 `{ algorithm, version, state }`，不能只保存种子。
- 不在渲染函数或 React 更新函数中消费随机数；Strict Mode 会重复调用它们。

## 4. 时间与调度

| 概念 | 语义 |
| --- | --- |
| `now()` | 单调时间，用于测量真实经过时间 |
| `activeNow()` | 扣除挂起时段后的时间 |
| `scheduler.every` | 周期回调 |
| `scheduler.after` | 一次性回调 |
| `scheduler.frame` | 动画帧，带 delta |

两种后台策略：

- `pause`：隐藏时停止，恢复后不补步。游戏默认。
- `wall-clock`：隐藏时停止回调，恢复时按真实时间结算一次。倒计时默认。

生命周期：页面可见性由注入端口驱动；`dispose()` 取消全部订阅；静态/SSR 不启动调度；测试可注入手动时钟。订阅数量和最小间隔有预算。

## 5. 输入

`useSwipe` 负责 pointer capture、阈值、方向锁定、取消和监听清理；`preventScroll` 才设置 `touch-action: none`。组件仍负责业务动作、滚动策略、键盘等价操作和可访问名称。

`useKeys` 只绑定到聚焦元素，默认忽略输入框和可编辑区域，只拦截实际处理的按键。

## 6. 组件状态

两个接口分开：

| 接口 | 决定 |
| --- | --- |
| 组件状态协议 | 保存什么、版本、校验、迁移 |
| 持久化后端 | 内存、浏览器存储或宿主其他实现 |

记录格式：

```json
{
  "format": "reactive-md-component-state/v1",
  "component": "example/game",
  "componentVersion": "1.0.0",
  "stateVersion": 1,
  "key": "doc:...:state:demo",
  "documentId": "...",
  "data": {},
  "random": { "algorithm": "mulberry32", "version": 1, "state": 123 }
}
```

边界：

- 重置只恢复组件初始状态；“删除已保存进度”是独立的 `clear()`。自动保存开启时，重置后的状态可以按正常流程再次保存。
- 恢复失败时跳过该实例并报告原因，其余文档继续工作。未知组件、版本不兼容、结构无效都走同一路径。
- 第一版采用显式保存，不做跨标签页同步；两个打开的文档不会悄悄覆盖彼此。

预算：单组件 16 KiB，单文档 256 KiB，最大嵌套 16 层，单数组/对象 10,000 项。状态数据必须是 JSON 安全的普通数据。

## 7. 公开入口

| 入口 | 内容 |
| --- | --- |
| `reactive-md/runtime` | 身份、随机、调度、组件状态协议的纯类型和纯函数 |
| `reactive-md/react/runtime` | `useTicker`、`useFrame`、`useSwipe`、`useKeys`、`useComponentState` |

`LocalReactiveDocument` 新增 `documentId`、`randomSeed`、`componentState` 和 `onComponentStateChange`。`componentState` 只在创建新运行时生效；运行中恢复请调用 `runtime.services.state.restore()`。使用 `LocalDocumentView` 的宿主通过自己创建的 `createLocalRuntime` 选项接入。

## 8. 已落地与后续

已落地：

- `src/runtime-services/`：身份、PRNG、调度器、状态注册表、运行时服务工厂。
- `src/react/runtime/`：四个 React 钩子。
- `LocalComponentContext.services` 与 `LocalRuntime.services`。
- Tetris 示例迁移到 `useTicker`，2048 示例迁移到 `useSwipe`。
- 单元测试覆盖随机、调度、状态、恢复失败、重复 key、预算和上下文注入。

后续：

- 为两个游戏补真实浏览器下的后台切换和触控验收。
- 导出 CLI 将组件状态 sidecar 写入单文件 HTML。
- 浏览器存储后端、尺寸测量、无障碍播报按真实组件需求增加。

## 9. 验证

```sh
npm run typecheck
npx vitest run tests/runtime-services-random.test.ts tests/runtime-services-scheduler.test.ts tests/component-state.test.ts tests/runtime-services-context.test.tsx tests/react-runtime-hooks.test.tsx
npm run check
```

完整检查仍以根目录 [AGENTS-ch.md](../../AGENTS-ch.md) 和[贡献指南](../../CONTRIBUTING-ch.md)为准。
