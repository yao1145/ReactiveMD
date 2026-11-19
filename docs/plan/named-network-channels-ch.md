# ReactiveMD 命名网络通道设计

本文记录命名网络通道的首版契约与验收场景。公开类型位于 `reactive-md/runtime`，浏览器适配器位于 `reactive-md/runtime/browser`，提交按钮由 `reactive-md/plugins/network` 提供。宿主可以直接运行[问卷示例](../../examples/network-survey/)。

## 1. 基本原则与首版范围

ReactiveMD 原生提供提交和订阅两项能力。宿主按文档注册命名通道，指定传输路径、认证方式、允许的操作及数据校验规则。未注册通道时，文档照常在本地运行，创建运行时、打开页面和编辑输入均产生零次通道请求。

| 使用者 | 首版职责 |
| --- | --- |
| 宿主开发者 | 为当前文档和用户开放所需通道，例如允许向 `answers` 提交、从 `results` 订阅。后端按实际身份和资源独立授权。 |
| 文档作者 | 安装了官方可选组件包后，可在文档里声明提交按钮、通道名和要提交的绑定名。 |
| 组件开发者 | 通过同一 SDK 实现提交交互或订阅展示。官方提供一个可运行的订阅示例，图表、计数器等组件自行决定如何使用消息。 |
| 引擎维护者 | 维护公开契约、通道生命周期、官方提交按钮和可选协议适配器，覆盖 HTTP、SSE、WebSocket、WebRTC。 |

提交由读者显式点击触发。已挂载的组件和宿主配置的外部值映射都可以订阅。首版不做输入变化自动上报、离线排队或跨文档连接池。文档只引用通道名，URL、请求头、令牌、WebRTC 信令及对端选择都留在宿主代码里。

## 2. 从一份问卷看数据流

宿主为问卷配置两个通道。下例中的工厂和校验函数展示接线方式，具体名称以实现时的类型声明为准。

```ts
const network = {
  channels: {
    answers: {
      submit: httpSubmit({
        endpoint: '/api/survey/answers',
        validate: validateAnswer, // 仅接受约定字段和类型
      }),
    },
    results: {
      subscribe: sseStream({
        endpoint: '/api/survey/results/events',
        validate: validateCounts, // 例如 { yes: 18, no: 7 }
      }),
    },
  },
}
```

宿主将 `network` 传给交互视图或自行创建的运行时，并注册可选的提交组件。文档作者可以这样写：

```html
<input bind="choice" label="你的选择" required>
<textarea bind="comment" label="补充说明">
<submit-button channel="answers" fields="choice comment" label="提交回答">
```

读者点击时，按钮一次读取两个字段。若值分别为 `"yes"` 和 `""`，默认 HTTP 请求体就是 `{"choice":"yes","comment":""}`。新增第三个输入框不会改变请求体。页面中的计票组件独立订阅 `results`，收到宿主校验过的统计数据后更新自身视图。问卷可以只启用提交，也可以在另一页只展示统计。

## 3. 架构与代码落点

一次提交依次经过「组件 → 文档运行时 → 已注册通道的提交适配器 → 后端」。接收消息走相反方向，适配器先解码，宿主规则校验通过后，运行时才向该通道的监听器分发数据。

| 层 | 现有入口与拟议改动 |
| --- | --- |
| 运行时 | 在 [runtime-services](../../src/runtime-services/runtime.ts) 附近添加协议无关的注册表、订阅管理和取消逻辑。在 [LocalRuntimeOptions](../../src/local/types.ts) 接受宿主配置，在 [createLocalRuntime](../../src/local/runtime/runtime.ts) 建立每个运行时独有的通道会话。 |
| React 与组件 SDK | [交互视图](../../src/local/rendering/document/LocalDocumentViewCore.tsx) 透传配置并处理宿主切换。[组件上下文](../../src/react/component-api.tsx) 在 `ctx.services.network` 暴露操作，不向组件公开端点或凭据。手工构造的旧上下文和 detached runtime 继续可用。 |
| 传输 | 协议实现放在按需导入的浏览器入口。沿用 [runtime/browser](../../src/runtime-services/browser/index.ts) 的加载边界，导入模块时不访问浏览器全局。核心通过可注入的适配器接口工作，可在测试中使用内存替身。 |
| 官方组件 | 参考[可选组件包](../../src/components/plugins/forms.ts)组织方式，建议新增 `reactive-md/plugins/network`。独立注册无正文标签 `submit-button` 的 manifest 与 React 实现。默认和 minimal 预设不隐式加入组件或适配器。 |

编译器只处理组件 manifest 和静态属性。通道配置、函数、连接及认证信息不进入编译选项、Worker 消息、语义配置摘要、状态文件或导出 HTML。现有图片与链接的 `urlPolicy` 继续由相应渲染逻辑使用。网络授权通过宿主注册表落实。[现有安全边界](../../SECURITY-ch.md)

### 3.1 组件侧公开契约

```ts
type Json = null | boolean | number | string | readonly Json[]
  | { readonly [key: string]: Json }

type ChannelError = {
  code: 'unavailable' | 'invalid-data' | 'rejected' | 'transport'
      | 'unconfirmed' | 'cancelled'
  message: string
}

type SubmitResult =
  | { ok: true; readonly data?: Json }
  | { ok: false; error: ChannelError }

type StreamEvent =
  | { type: 'status'; state: 'connecting' | 'open' | 'closed' }
  | { type: 'data'; value: Json }
  | { type: 'error'; error: ChannelError }

interface ComponentNetwork {
  supports(channel: string, operation: 'submit' | 'subscribe'): boolean
  submit(channel: string, payload: Readonly<Record<string, Json>>,
         options?: { signal?: AbortSignal; idempotencyKey?: string }): Promise<SubmitResult>
  subscribe(channel: string, listener: (event: StreamEvent) => void): () => void
}
```

`supports` 只查询当前授权能力，可以在渲染时调用。它不探测网络可达性。未启用、未知通道和方向不匹配均返回 `false`。直接调用这些操作时，提交返回 `unavailable`；订阅在注册返回后通知一次该错误，随后结束。取消函数可重复调用，取消后不再回调。组件可由此显示“此页面未启用提交”，旧文档的其他控件保持可用。

### 3.2 宿主与适配器契约

每个通道分别声明可选的 `submit` 和 `subscribe`。每个启用的方向都需要宿主提供可解析的 API 路径或协议端点，以及该方向的校验函数。WebRTC 的路径用于信令。空路径、协议不匹配或缺少校验器应在宿主创建配置时报告。配置创建本身不发请求。自定义适配器遵守与内置工厂相同的契约。

| 操作 | 适配器收到 | 适配器负责 |
| --- | --- | --- |
| 提交 | 已通过出站校验的字段对象、本次请求标识、取消信号 | 编码并发送一次，按后端约定解释应答，区分明确拒绝与结果未知。 |
| 打开订阅 | 当前会话的取消信号、报告连接状态和递交解码消息的回调 | 按需建连，交回幂等的释放函数。运行时在分发前统一执行宿主入站校验。异步建连完成时仍须检查取消信号。 |

内置工厂把端点和宿主认证策略封装进适配器。注册表用精确通道名查找配置，不用文档字符串拼接路径。对于不可信文档，宿主应按当前文档授予通道，并在提交规则中列出允许的字段、类型和业务限制。服务端验证用户身份、字段和权限。错误消息使用可展示的摘要，避免把原始请求头、凭据或表单内容带入诊断。

请求标识对应一次发送，用来匹配这次应答。`idempotencyKey` 对应一次逻辑提交，由按钮或调用方生成；适配器按后端约定将它放入请求头或消息体。只有后端实现了按用户、操作和键去重，重试才具备幂等保证。

成功确认可携带 `data`。例如，宿主可在 `httpSubmit` 的 `interpret` 中提取并校验报名编号，返回 `{ ok: true, data: { registrationId } }`。组件从这次 `submit()` 的结果读取回执，官方按钮继续按 `ok` 更新状态。运行时将回执复制为只读 JSON，容量上限为 64 KiB。无效或超限的回执数据会被舍弃，提交的成功确认仍然有效。

## 4. 提交按钮与字段语义

1. `channel` 是静态通道名。`fields` 是空格分隔的公开可写绑定名，必须非空且无重复。取值来自同一运行时修订。保留数字、布尔值、数组、空串和 `null` 的原类型。字段不存在、属于内部绑定、计算值或外部只读值时，整次提交失败。
2. 在核心中复用 `getParameter` / `getParameters` 的公开参数边界，给按钮提供按名投影的窄接口。组件 SDK 现有的 `snapshot().state` 还含计算值和外部值，不适合充当请求体。宿主的出站校验也适用于自定义组件直接调用 `submit` 的载荷。
3. 提交前检查所选字段。现有文本控件会把无效草稿保留在视图中，此时公开绑定可能仍是上次的合法值。为会保留草稿的控件补充按绑定登记、卸载时撤销的有效性信息。按钮遇到无效草稿或未满足的必填要求时指明字段，保留输入并停止发送。文档已有的提示性校验维持原语义；必须阻止上报的跨字段业务约束写入通道校验器。[输入与校验规则](../reference/local-interaction-syntax-ch.md)
4. 按钮在同一次提交进行中屏蔽重复点击。收到确认后显示成功；明确拒绝或校验失败时显示原因。请求已发出却未收到确认时显示“提交结果未确认”。读者可以手动重试，运行时不自动重发。涉及写入的数据由宿主与后端约定幂等键；重试同一份未确认载荷时沿用原键，编辑后再次提交视为新操作。

按钮采用原生 `button type="button"`，支持键盘激活，状态变化可由辅助技术读出。按钮卸载时取消等待并忽略迟到结果。浏览器取消等待不能撤销后端已经完成的写入。

## 5. 订阅与资源生命周期

运行时以「通道会话实例、通道名」为键管理订阅。两个视图即使使用相同的 `documentId`，也各自拥有会话。首个监听器触发建连，后续监听器复用同一连接并获知当前状态。每个监听器接收加入后的有效消息。需要初始全量数据的宿主应提供快照或在建连时发送当前值。

宿主可在启用 `subscribe` 的通道上提供 `mapExternalValues(value)`。它接收通过入站校验的消息，返回按外部变量名索引的更新对象，或返回 `undefined` 跳过本条消息。运行时按文档的 `<external>` 声明校验整个对象，通过后一次更新全部字段。Markdown 插值、计算和条件块随之更新，读者的输入保持原状。

映射在交互文档会话中生效，并和该会话中的组件共享连接。关闭映射所属的会话会释放订阅及其映射值，文档随即读取宿主通过 `externalValues` 或 `setExternalValues()` 提供的当前值。静态渲染和 SSR 直接读取宿主提供的外部值。

| 事件 | 运行时的行为 |
| --- | --- |
| 监听器离开 | 立即停止向它分发。最后一个监听器离开时中止建连、关闭本会话拥有的连接并取消重连计时器。 |
| 组件挂载或切换通道 | React 组件在 effect 中订阅，清理函数取消旧订阅。监听器异常单独报告，其他监听器继续接收。 |
| 普通源码编辑 | 交互视图可能原地采用新编译结果。保留同一文档、同一配置下仍在使用的订阅，按组件挂载情况和通道名变化增减监听器。 |
| 文档或授权切换 | 宿主以不同的文档身份标识切换文档。替换配置或切换账户也使旧会话失效。React 在切换提交时释放旧会话，丢弃的 render 不影响当前页面。配置引用在普通重渲染中应保持稳定。 |
| 运行时销毁 | 先使会话失效，再取消提交、订阅、重连与确认等待。晚到的消息、建连结果和确认均按会话身份丢弃。复用宿主注入的服务时，只释放该运行时的会话及其资源。 |

同一通道上的消息按适配器交付顺序分发。协议重连后可能重复或遗漏事件；需要连续序号、恢复游标或去重时，由宿主协议携带这些信息。首版按事件分发，不保存通用消息历史。入站数据按宿主形状及配置的大小预算校验，超限或无效消息不会进入组件；连接状态与数据分别通知。网络事件不会自动写入文档绑定。

自定义计票组件可以使用以下模式。示例中的 `isCounts` 将通用 SDK 数据收窄为组件需要的类型。

```tsx
useEffect(() => {
  if (!visible || !network.supports('results', 'subscribe')) return
  return network.subscribe('results', event => {
    if (event.type === 'data' && isCounts(event.value)) setCounts(event.value)
    if (event.type === 'error') setStatus(event.error.message)
  })
}, [network, visible])
```

组件 SDK 应为同一会话提供稳定的 `network` 引用，避免普通重渲染触发上述 effect 反复退订。订阅协议的重连只能由一处控制，避免原生客户端与适配器同时重连。

## 6. 四种传输如何落地

| 适配器 | 首版能力 | 接入约定 |
| --- | --- | --- |
| HTTP | 单次提交 | 默认向指定路径 POST JSON。宿主可映射请求体并定义业务成功条件。异步受理与业务处理完成由后端响应区分。 |
| SSE | 服务端推送订阅 | 使用宿主指定的事件流端点，解析事件数据并交给入站校验器。原生 EventSource 适合其支持的凭据模式；需要定制请求头时由宿主提供兼容客户端。最后一个订阅者离开时关闭流。问卷上行可另配 HTTP。[SSE 规范](https://html.spec.whatwg.org/multipage/server-sent-events.html) |
| WebSocket | 提交、订阅，可分别授权 | 宿主提供端点、认证及消息编解码。适配器区分业务消息与按请求标识关联的确认。调用 `send` 后等待后端确认，超时或断线按未确认处理。双向复用一条连接时，待确认提交也占用连接，最后一个监听器退出只释放订阅占用。 |
| WebRTC | 通过 RTCDataChannel 提交、订阅 | 宿主提供信令 API、认证及受信任对端的选择逻辑。适配器按需获取数据通道，复用消息校验与确认机制。由适配器创建的资源随会话关闭；对宿主借出的通道或 PeerConnection，仅撤销监听并调用约定的释放回调。[WebRTC 数据通道规范](https://www.w3.org/TR/webrtc/#peer-to-peer-data-api) |

通用 API 规定提交结果与订阅事件，不规定业务后端的 URL 结构或要求四种协议使用同一种线上消息格式。SDK 示例应给出一种可互操作的 WebSocket/WebRTC 消息映射，包括请求标识、确认、拒绝与推送四者的关联方式。超时、关闭和重连后均不自动重放未确认的提交。

## 7. 分步实施与验收

| 顺序 | 交付物 | 可验证的完成条件 |
| --- | --- | --- |
| 1 | 运行时公共类型、宿主配置、会话和内存测试适配器 | 无配置时 I/O 次数为零。未知通道、错误方向、额外字段、非法入站数据均在分发或发送前被拒绝。两个运行时即使同名也互不接收消息。 |
| 2 | React 接线、HTTP 提交、官方可选按钮 | 浏览器测试实际输入、编辑、点击和键盘激活。编辑零请求，双击只有一次发送，请求仅含选择的字段。无效草稿不会发出上次合法值。未确认与明确拒绝可区分，失败后输入保留。 |
| 3 | SSE 适配器、仅用公开 SDK 编写的订阅示例 | 两组件订阅只建一条流，移除其一仍可收消息，移除最后一个关闭连接。覆盖建连中退订、React 重挂载、文档切换和配置撤销后的迟到消息。 |
| 4 | WebSocket、WebRTC 适配器与协议示例 | 用本地受控端点验证确认关联、断线、超时和取消；WebRTC 以一对测试 peer 验证实际 DataChannel 收发及信令失败清理。双向连接须覆盖“订阅已退、提交仍待确认”。 |
| 5 | 包入口、集成说明与边界回归 | 将打包产物安装到独立消费者验证公开导入和类型。运行引擎的 `npm run check`，验证 compiler/Worker 不依赖网络实现，SSR、静态和默认离线 HTML 均不建连，导出内容无宿主端点和凭据。 |

优先以问卷作为端到端验收场景。先运行只有输入框的原文档，再安装按钮并启用 HTTP 提交通道，最后加入两个订阅同一统计通道的组件。逐步检查请求体、建连次数和卸载后的资源，可同时验证已有文档兼容性与第三方组件接入体验。
