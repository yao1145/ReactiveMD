# Reactive MD 俄罗斯方块组件包

基于公开扩展 SDK 的 `<tetris>` 组件包。它演示一个自包含交互组件：带种子的
游戏引擎、React 实现、静态/SSR 预览与本地合规套件。

> 状态：测试接入案例。用于端到端验证本地组件 SDK，不随库发布。

## 使用

先在 ReactiveMD 仓库构建 SDK 预览包，再在宿主项目中安装：

```sh
npm install ../ReactiveMD/reactive-md-0.6.1.tgz
npm install ../ReactiveMD/examples/tetris-package
```

使用公开入口装配宿主：

```tsx
import { createLocalConfig } from 'reactive-md/sdk';
import { createReactConfig } from 'reactive-md/react';
import { tetris } from 'reactive-md-tetris-package';
import { tetrisImplementation } from 'reactive-md-tetris-package/react';
import 'reactive-md-tetris-package/styles.css';

export const config = createLocalConfig({ components: [tetris] });
export const reactConfig = createReactConfig(config, {
  components: [tetrisImplementation],
});
```

然后在 Markdown 中写标签：

```md
<tetris label="Tetris" width="10" height="20" speed="600" seed="7">
```

| 属性 | 默认值 | 范围 | 含义 |
| --- | --- | --- | --- |
| `label` | `Tetris` | 文本 | 无障碍标题 |
| `width` | `10` | 6–14 | 棋盘宽度（格） |
| `height` | `20` | 12–24 | 棋盘高度（格） |
| `speed` | `600` | 100–2000 | 下落间隔（毫秒） |
| `seed` | `7` | 0–99999 | 方块序列种子 |
| `debug` | `false` | 布尔 | 显示错误隔离探针 |
| `disabled` | `false` | 布尔 | 暂停输入与重力 |

键盘：方向键移动，`Space` 落底，`P` 暂停，`R` 重开。按钮覆盖鼠标与触屏。
同一种子始终产生相同方块序列，因此静态渲染与水合结果可复现。

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
| `src/tetris-engine.ts` | 纯函数、确定性的游戏规则与种子袋。 |
| `src/manifests.ts` | `<tetris>` 的有界 JSON manifest。 |
| `src/components.tsx` | React 与静态实现，以及宿主配置。 |
| `src/component.css` | 组件结构与方块配色。 |
| `sample/document.reactive.md` | 带显示、锁定与调试开关的示例文档。 |
| `scripts/build.mjs` | Node/SSR 入口、声明、载体页与离线导出。 |
| `scripts/verify.mjs` | manifest、React/SSR 与浏览器合规套件。 |

浏览器套件证明挂载、编辑（暂停/继续）、隐藏/显示、禁用、重置、子组件错误
隔离与卸载。离线证据还要求 hydration、断网上下文与零网络请求。
