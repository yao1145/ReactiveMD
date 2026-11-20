# Host network channels

**English** · [中文](network-host-ch.md)

ReactiveMD documents request named channels. The host chooses which channels to open and configures their endpoints, credentials, validation and transport.

## Enable a channel

Pass a `NetworkConfig` to `LocalReactiveDocument`. Install the optional network component package in the React configuration when the document uses `<submit-button>`.

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

<submit-button channel="answers" fields="choice" label="Send answer">

Current yes votes: {{ yesCount }}
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
          || 'Choose an answer before submitting.',
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

The host's `reactConfig` includes the network preset required by `<submit-button>`. A custom component can access the same service at `context.services.network` and call `supports`, `submit` or `subscribe` for a known channel.

`<submit-button>` snapshots the listed bindings at activation and sends that snapshot once. The default HTTP adapter includes the operation's idempotency key in the `Idempotency-Key` header. The host should enforce idempotency on the receiving service when retries must not repeat a write.

## Subscriptions and external values

Document listeners on the same channel share a host connection. Hiding or unmounting a listener removes its subscription. The transport closes when the last listener leaves. A channel's `mapExternalValues` callback maps validated data to declared `<external>` values. The runtime validates and applies each mapped update as one write. The host supplies external values on load, independently of document state files.

The core network contract accepts plain JSON, validates input and output, and defaults to a 64 KiB encoded payload budget. Configure a smaller `maxBytes` for a channel when its schema allows it. Submit and subscribe adapters receive abort signals for operation and channel lifetimes. Listener exceptions are isolated and can be reported through `onListenerError`.

`reactive-md/runtime/browser` provides `httpSubmit`, `sseStream`, `webSocketChannel` and `webRtcChannel`. Hosts can also implement `SubmitAdapter` and `SubscribeAdapter` for another transport. Keep authentication, authorization, endpoint selection and server-side validation in the host/backend.

Static rendering and static exports use an unavailable network service. Supply a `NetworkConfig` only in a trusted live host. The [network survey example](../../examples/network-survey/README.md) demonstrates in-memory and HTTP/SSE adapters, lifecycle sharing, response validation, idempotent retries, WebSocket and WebRTC.
