# Reactive MD 2048 组件包

基于公开扩展 SDK 的 `<game-2048>` 组件包。它演示一个自包含交互组件：带种子的
游戏引擎、React 实现、静态/SSR 预览与本地合规套件。

> 组件标签必须以字母开头，因此 `<2048>` 不是合法的 SDK 标签名
> （`^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`）。`<game-2048>` 保留了熟悉的数字，同时
> 满足协议要求。

> 状态：测试接入案例。用于端到端验证本地组件 SDK，不随库发布。

## 使用

先在 ReactiveMD 仓库构建 SDK 和组件安装包：

```sh
npm run build:lib
npm pack --ignore-scripts
npm --prefix examples/game-2048-package run build
npm pack ./examples/game-2048-package --ignore-scripts
```

再在宿主项目中安装生成的两个 `.tgz`：

```sh
npm install reactive-md@0.7.0 ../ReactiveMD/reactive-md-game-2048-package-0.1.0.tgz
```

ReactiveMD、React 和 React DOM 声明为 peer dependencies，由宿主提供同一份实例。

使用公开入口装配宿主：

```tsx
import { createReactHost } from 'reactive-md/react';
import { game2048Package } from 'reactive-md-game-2048-package/react';

export const host = createReactHost({ packages: [game2048Package] });
export const { config, reactConfig } = host;
```

然后在 Markdown 中写标签：

```md
<game-2048 label="2048" size="4" seed="7">
```

| 属性 | 默认值 | 范围 | 含义 |
| --- | --- | --- | --- |
| `label` | `2048` | 文本 | 无障碍标题 |
| `size` | `4` | 3–6 | 棋盘每边格数 |
| `target` | `2048` | 8–131072 | 达成胜利所需的方块数值 |
| `seed` | `7` | 0–99999 | 方块生成种子 |
| `debug` | `false` | 布尔 | 显示错误隔离探针 |
| `disabled` | `false` | 布尔 | 暂停输入 |

键盘：方向键或 `W A S D` 移动方块，`R` 重开。按钮覆盖鼠标与触屏。
同一种子始终产生相同开局，因此静态渲染与水合结果可复现。

## 在本仓库 Demo 中体验

组件已登记在
[demo/extensions.ts](https://github.com/yao1145/ReactiveMD/blob/main/demo/extensions.ts)。
Demo 通过依赖声明安装 `demo/vendor/` 中的 npm tarball，从
`reactive-md-game-2048-package/react` 读取实现、CSS 文本与样例，通过
`reactive-md-game-2048-package/notices?raw` 读取署名。修改本包源码后，在仓库
根目录运行 `npm run update:demo-2048`，重新构建、打包和安装；更新后的 tarball、
依赖声明和锁文件一起提交。预览、编辑器目录和离线 HTML 共用这份清单，具体字段见
[Demo 说明](https://github.com/yao1145/ReactiveMD/blob/main/demo/README.md)。

## 命令

```sh
npm run build        # JS、类型、载体页与离线 HTML
npm test             # 完整合规：Node、SSR、浏览器生命周期与离线
npm run test:node    # 仅 manifest、静态与 SSR
npm run typecheck
```

`npm test` 需要 Playwright 与浏览器。Windows 上若只安装了 Edge，可设置
`PLAYWRIGHT_CHANNEL=msedge`。

## 目录

| 路径 | 用途 |
| --- | --- |
| `src/game-engine.ts` | 纯函数、确定性的游戏规则与种子生成器。 |
| `src/manifest.ts` | `<game-2048>` 的有界 JSON manifest。 |
| `src/components.tsx` | React 与静态实现，以及宿主配置。 |
| `src/component.css` | 组件结构与方块配色。 |
| `sample/document.reactive.md` | 带显示、锁定与调试开关的示例文档。 |
| `scripts/build.mjs` | Node/SSR 入口、声明、载体页与离线导出。 |
| `scripts/verify.mjs` | manifest、React/SSR 与浏览器合规套件。 |

浏览器套件证明挂载、编辑（移动方块）、隐藏/显示、禁用、重置、子组件错误
隔离与卸载。离线证据还要求 hydration、断网上下文与零网络请求。
