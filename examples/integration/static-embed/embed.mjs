import { compileLocal } from 'reactive-md';
import { createReactHost, deriveLocalReactPreset } from 'reactive-md/react/packed';
import layout from 'reactive-md/presets/default/packs/react/layout';

const source = `# Read-only embed

The original placeholder is {{ visitor.name }}.

<if when="true">

This paragraph uses the selected layout component.

</if>

<slider bind="zoom" />

<external slot="references" />

<external slot="references" />

The surrounding document stays visible.`;

export function prepareEmbed(observer) {
  const layoutSubset = deriveLocalReactPreset(layout, { include: ['if'] });
  const host = createReactHost({ presets: [layoutSubset] });
  let traceId;
  const result = compileLocal(source, {
    ...host.compileOptions,
    embedding: { expressions: 'literal', onUnsupported: 'fallback', allowImages: false, allowInteractive: false, allowExternalSlots: true },
    observer: observer && { onTrace(event) {
      traceId = event.traceId;
      observer.onTrace({ ...event, documentId: 'static-embed', sourceRevision: 1, sourcePhase: 'final' });
    } },
  });
  if (!result.ok || result.document.requiresRuntime) throw new Error(JSON.stringify(result.diagnostics));
  return { document: result.document, reactConfig: host.reactConfig, css: host.css,
    trace: { observer, traceId, documentId: 'static-embed', sourceRevision: 1, sourcePhase: 'final' } };
}
