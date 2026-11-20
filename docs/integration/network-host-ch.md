# 宿主网络通道

[English](network-host-en.md) · **中文**

ReactiveMD 文档按名称使用通道。宿主决定开放哪些通道，并配置端点、凭据、校验和传输方式。

## 开放通道

将 `NetworkConfig` 传给 `LocalReactiveDocument`。如果文档使用 `<submit-button>`，还需在 React 配置中安装可选的网络组件包。

```tsx
import { createReactHost, LocalReactiveDocument } from 'reactive-md/react/minimal';
import { minimalReactPresetPackage } from 'reactive-md/presets/minimal/react';
import networkPreset from 'reactive-md/plugins/network';
import type { Json, NetworkConfig } from 'reactive-md/runtime';
import { httpSubmit, sseStream } from 'reactive-md/runtime/browser';

const host = createReactHost({ presets: [minimalReactPresetPackage, networkPreset] });
const reactConfig = host.reactConfig;
const source = `
<external name="yesCount" type="number">
<select bind="choice" label="Choice" initial="yes">
<option value="yes">Yes</option>
<option value="no">No</option>

<submit-button channel="answers" fields="choice" label="提交答案">

当前赞成票：{{ yesCount }}
`;

function isCountSnapshot(value: Json): value is { readonly yes: number; readonly no: number } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && 'yes' in value && typeof value.yes === 'number'
    && 'no' in value && typeof value.no === 'number';
}

const network: NetworkConfig = {
  channels: {
    answers: {
      submit: httpSubmit({
        endpoint: '/api/answers',
        validate: payload => typeof payload.choice === 'string'
          || '提交前请选择答案。',
      }),
    },
    results: {
      subscribe: sseStream({
        endpoint: '/api/results/events',
        validate: isCountSnapshot,
      }),
      mapExternalValues: value => isCountSnapshot(value)
        ? { yesCount: value.yes }
        : undefined,
    },
  },
};

function Survey() {
  return <LocalReactiveDocument source={source} network={network} reactConfig={reactConfig} />;
}
```

宿主的 `reactConfig` 已包含 `<submit-button>` 所需的网络预设。自定义组件也可以从 `context.services.network` 获取同一服务，并对已知通道调用 `supports`、`submit` 或 `subscribe`。

`<submit-button>` 在激活时读取所列绑定的快照，并发送一次。默认 HTTP 适配器会把操作幂等键放入 `Idempotency-Key` 请求头。需要避免重试重复写入时，接收服务应执行幂等校验。

## 订阅与外部变量

同一通道的文档监听器共享一条宿主连接。隐藏或卸载监听器会退订。最后一个监听器离开时，传输连接关闭。通道的 `mapExternalValues` 回调可以把经过校验的订阅数据映射为已声明的 `<external>` 值。运行时会校验并一次性写入每次映射结果。加载文档时由宿主提供外部变量，独立于文档状态文件。

核心网络契约接受普通 JSON，校验输入和输出，默认编码负载上限为 64 KiB。需要更紧的 schema 预算时，可为通道设置较小的 `maxBytes`。提交与订阅适配器会收到操作和通道生命周期的 abort signal。监听器抛出的异常会被隔离，也可以通过 `onListenerError` 上报。

`reactive-md/runtime/browser` 提供 `httpSubmit`、`sseStream`、`webSocketChannel` 和 `webRtcChannel`。宿主也可以为其他传输自行实现 `SubmitAdapter` 与 `SubscribeAdapter`。认证、授权、端点选择和服务端校验应由宿主或后端负责。

静态渲染和静态导出使用不可用的网络服务。只在可信的实时宿主中传入 `NetworkConfig`。[网络问卷示例](../../examples/network-survey/README.md)展示内存与 HTTP/SSE 适配器、生命周期共享、响应校验、幂等重试、WebSocket 和 WebRTC。
