# 命名网络通道问卷示例

一个可操作的问卷页面：读者提交回答，两个自定义计票组件同时订阅同一份统计。
页面不依赖任何外部服务；默认使用内存适配器，也可以切到本地 HTTP + SSE 端点。

所有导入都走公开包入口（`reactive-md/sdk`、`reactive-md/react/minimal`、
`reactive-md/plugins/network`、`reactive-md/runtime`、
`reactive-md/runtime/browser`），渲染与构建复用仓库的 `dist-library` 与 Vite。

## 运行

依赖复用仓库根目录已安装的 Vite、React 和 `dist-library`，不需要单独安装。
在仓库根目录执行：

```sh
npx vite --config examples/network-survey/vite.config.ts
```

打开 `http://localhost:4318`。默认是内存适配器：提交经过 220 ms 模拟往返，
计票组件立刻收到新值。需要真实 HTTP 请求时改用：

```sh
npx vite --config examples/network-survey/vite.config.ts --mode http
```

`vite.config.ts` 优先把 `reactive-md/*` 指向 `dist-library`。如果这次构建还没有
生成 `reactive-md-plugin-network.js`（例如尚未运行 `npm run build:lib`），它会整体
回退到仓库的 `src/`，页面照样能启动；重新构建后自动使用打包产物。

`--mode http` 启动时，同一端口提供两个受控端点：

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| `POST` | `/api/survey/answers` | 接收 `{"choice":"yes","comment":""}`，成功返回 `{ok:true,counts}`；字段不符返回 422。 |
| `GET` | `/api/survey/results/events` | `text/event-stream`：连接时发一次当前计数，每次提交广播 `data: {"yes":n,"no":n}`，每 5 秒重发快照，每 15 秒一个心跳。 |

在 `http` 模式页面加 `?transport=memory` 可退回内存适配器；默认模式下加
`?transport=http` 会尝试连接端点（没有 `--mode http` 时请求失败，正好可以看
按钮的拒绝提示）。

页面底部的「宿主连接记录」实时显示提交次数、已确认/拒绝次数、通道打开与
释放次数、当前连接数。

把示例复制到仓库外单独使用时，在 `examples/network-survey` 内执行
`npm install && npm run dev`；此时需要仓库已发布或本地链接的 `reactive-md`。
本仓库内推荐上面的根目录命令。

## 浏览器验收

在引擎仓库根目录运行以下命令。脚本使用 Playwright Chromium、本机回环服务和两个本机 WebRTC peer。

```powershell
node scripts/verify-network-browser.mjs
```

如果机器已安装 Microsoft Edge，可以用 `$env:PLAYWRIGHT_CHANNEL = 'msedge'` 指定浏览器。也可以用 `npx playwright install chromium` 安装 Playwright 的 Chromium。

| 验收项 | 通过条件 |
| --- | --- |
| HTTP 提交 | 键入有效值期间没有 POST。把已保存的合法输入改成不合法草稿后，提交提示字段错误，保留草稿。聚焦按钮按 Enter 发出一次请求，HTTP 503 后双击重试也只发一次，并沿用原幂等键。请求只含所选字段。 |
| 问卷写入去重 | 示例后端记下第一票后，测试丢弃响应。浏览器用相同幂等键重试并收到首次结果，票数只增加一次。同键换载荷返回 409，另一位参与者可以独立使用同一个键。 |
| React 与 SSE | 两个组件收到同一条流的数据。编辑普通正文和移除第一个组件时连接保持，最后一个组件卸载后连接关闭。切换文档时替换连接，撤销授权后释放旧流。 |
| WebSocket | 浏览器连接本地受控端点，收到推送，并按 `requestId` 将乱序回复分给两个提交。带 emoji 的超限确认被丢弃，合法拒绝仍能结算对应提交。 |
| WebRTC | 两个真实的 `RTCPeerConnection` 建立 DataChannel，完成推送与提交。最后一个订阅退出时，待确认的提交继续占用连接。确认到达后调用一次宿主的释放函数。 |

手动复核时，按前面的步骤启动示例的 HTTP/SSE 模式。打开开发者工具的 Network 面板，筛选 `/api/survey/`。选项和备注编辑期间没有 POST，聚焦「提交回答」后按 Enter，新 POST 的 Payload 只有 `choice` 和 `comment`。再用下面的开关核对 EventStream 和页面连接记录。自动验收夹具提供文本约束及可控回复，用于复核无效草稿、双击和未确认重试。

## 观察生命周期

1. 页面默认挂载两个订阅组件，它们订阅同一个 `results` 通道：
   “通道打开”为 1，“当前连接”为 1。
2. 取消「显示实时计票」。组件隐藏并退订，计票明细继续接收消息，连接计数保持为 1。
3. 取消「显示计票明细」。最后一个监听者离开，“通道释放”加 1，“当前连接”归 0。
   重新勾选后会建立新连接。
4. 点击「提交回答」：一次点击只读取 `choice` 与 `comment` 的快照。编辑输入
   不发送任何请求；提交失败时输入保留，成功后计数在两个组件里同步出现。

## 代码位置

| 路径 | 作用 |
| --- | --- |
| `sample/document.reactive.md` | 问卷正文、提交按钮及两个按可见性订阅的组件。 |
| `src/components.tsx` | `defineLocalComponent` 清单、`defineReactComponent` 实现、订阅 effect、`createReactHost` 装配。 |
| `src/host.ts` | 宿主通道注册表、示例参与者标识和连接统计。 |
| `src/main.tsx` | 页面外壳，通过 `externalValues` 控制统计组件可见性，展示连接记录。 |
| `vite.config.ts` | 公开入口别名、`--mode http` 的受控端点。 |

两个订阅组件都读 `context.visible`，并在 effect 里返回订阅的取消函数：

```tsx
useEffect(() => {
  if (!visible || network === undefined) return
  return network.subscribe(channel, (event) => {
    if (event.type === 'data' && isCounts(event.value)) setCounts(event.value)
    if (event.type === 'error') setProblem(event.error.message)
  })
}, [network, channel, visible])
```

`network` 来自 `context.services.network`，在该文档会话内保持同一引用，所以普通
重渲染不会退订。组件看不到地址、请求头或凭据。隐藏或卸载组件时 effect 清理，
运行时在最后一个监听者离开后关闭连接并取消重连计时器。

## HTTP 接线

`src/host.ts` 的 HTTP 分支就是下面这段；`--mode http` 只负责提供端点：

```ts
import { httpSubmit, sseStream } from 'reactive-md/runtime/browser'

const participant = crypto.randomUUID().replaceAll('-', '')

const network = {
  channels: {
    answers: {
      submit: httpSubmit({
        endpoint: '/api/survey/answers',
        validate: payload => payload.choice === 'yes' || payload.choice === 'no',
        headers: { 'X-Survey-Participant': participant },
        // 可选：用服务端错误信息替换纯状态码摘要。
        interpret: response => response.status >= 400 && response.status < 500 ? {
          ok: false,
          error: { code: 'rejected', message: `HTTP ${response.status}` },
        } : undefined,
      }),
    },
    results: {
      subscribe: sseStream({
        endpoint: '/api/survey/results/events',
        validate: value => Number.isInteger(value?.yes) && Number.isInteger(value?.no),
      }),
    },
  },
}
```

`httpSubmit` 默认 POST JSON，并按 `2xx` 确认、`4xx` 明确拒绝、其余为未确认；
`interpret` 返回 `undefined` 时沿用这套规则。`timeoutMs` 默认 15 秒，覆盖等待响应和读取响应体。
配置 `interpret` 时，适配器按 `maxResponseBytes` 流式限制响应体，默认 64 KiB。
超时、超限或读不到完整确认时返回 `unconfirmed`，按钮可用原幂等键重试。

示例后端按 `X-Survey-Participant`、提交操作和 `Idempotency-Key` 保存首次计票结果。
同键同载荷返回首次快照，同键不同载荷返回 409。记录保存在当前开发服务进程中，最多 1024 条。
生产接入应使用服务端认证会话确定用户身份，并将幂等记录与业务写入放在同一事务中。

`sseStream` 的重连由
客户端的 `EventSource` 负责；最后一个监听者离开时适配器移除监听并关闭它。
`validate` 在发送前与分发前由运行时调用。

## WebSocket / WebRTC 的确认映射

两个双向适配器使用同一套 JSON 消息（`src/runtime-services/browser/duplex.ts`）：

| 方向 | 消息 | 关联方式 |
| --- | --- | --- |
| 客户端提交 | `{"type":"submit","requestId":"1","payload":{...},"idempotencyKey":"..."}` | `requestId` 由运行时生成。 |
| 服务端确认 | `{"type":"ack","requestId":"1"}` | 匹配同一 `requestId`，提交返回 `{ok:true}`。 |
| 服务端拒绝 | `{"type":"reject","requestId":"1","message":"..."}` | 返回 `rejected`，`message` 为可展示摘要。 |
| 服务端推送 | `{"type":"data","value":...}` | 不含请求标识，交给入站校验后广播给监听者。 |

替换工厂即可复用同一套组件与通道名：

```ts
import { webSocketChannel, webRtcChannel } from 'reactive-md/runtime/browser'

const resultsOverWebSocket = webSocketChannel({
  endpoint: 'wss://survey.example/events',
  validateSubmit: payload => payload.choice === 'yes' || payload.choice === 'no',
  validateSubscribe: value => Number.isInteger(value?.yes),
  // reconnect 默认关闭；需要时传 { delayMs, maxDelayMs, attempts }。
})

const answersOverDataChannel = webRtcChannel({
  endpoint: 'peer:survey-host',
  validateSubmit: validateAnswer,
  // 宿主负责信令、认证和对端选择；适配器只使用交回的通道。
  connect: async (endpoint, signal) => hostPeer(endpoint, signal),
})
```

- 一条连接承载该会话的提交与订阅。最后一个订阅者离开后，仍有待确认提交时
  连接保持；确认或超时后释放。
- 超时（默认 15 秒）、断线或重连后都不自动重放提交；调用方拿到
  `unconfirmed` 后可手动重试，并复用同一 `idempotencyKey`。
- `data` 与 `ack`/`reject` 共用一个消息通道，`data` 不带 `requestId`。
- WebRTC 的 `release` 由宿主提供；适配器只移除自己的监听并调用它，不会关闭
  借出的数据通道或 PeerConnection。

## 类型检查

在仓库根目录执行：

```sh
npx tsc -p examples/network-survey/tsconfig.json --noEmit
```

`tsconfig.json` 用 `paths` 指向仓库源码，因此不依赖已发布的类型包。
