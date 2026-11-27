import { compileLocal } from 'reactive-md';
import { createReactHost } from 'reactive-md/react/packed';
import card from 'reactive-md/presets/default/packs/react/component/card';
import conditional from 'reactive-md/presets/default/packs/react/component/if';

const source = `# Read-only embed

The original placeholder is {{ visitor.name }}.

<card title="Selected layout card">

This paragraph uses the selected layout component.

</card>

<if when="true">

The conditional branch stays static.

</if>

<unknown-widget />

<external slot="references" />

<external slot="references" />

The surrounding document stays visible.`;

export function prepareEmbed(observer) {
  const host = createReactHost({ presets: [card, conditional] });
  let traceId;
  const result = compileLocal(source, {
    ...host.compileOptions,
    embedding: { expressions: 'literal', onUnsupported: 'fallback', allowImages: false, allowExternalSlots: true },
    observer: observer && { onTrace(event) {
      traceId = event.traceId;
      observer.onTrace({ ...event, documentId: 'static-embed', sourceRevision: 1, sourcePhase: 'final' });
    } },
  });
  if (!result.ok || result.document.requiresRuntime) throw new Error(JSON.stringify(result.diagnostics));
  return { document: result.document, reactConfig: host.reactConfig,
    trace: { observer, traceId, documentId: 'static-embed', sourceRevision: 1, sourcePhase: 'final' } };
}
