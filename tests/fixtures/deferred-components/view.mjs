import { createElement } from 'react';
import { compileLocal } from 'reactive-md';
import { createDeferredReactConfig } from 'reactive-md/react/packed';
import { LocalStaticDocumentView } from 'reactive-md/react/static';
import { createLocalConfig, defineLocalComponent, LOCAL_COMPONENT_PROTOCOL } from 'reactive-md/sdk';
import { defineReactComponent } from 'reactive-md/react/unstyled';

const components = ['immediate-card', 'deferred-card', 'aborted-card'].map(name => defineLocalComponent({
  protocol: LOCAL_COMPONENT_PROTOCOL, id: `test/${name}`, name, version: '1.0.0',
  form: 'leaf', props: {}, capabilities: { static: true, interactive: false, ssr: true, offline: true },
}));
export const implementations = Object.fromEntries(components.map(definition => [definition.name,
  defineReactComponent(definition, { render: () => createElement('b', null, definition.name) }),
]));
const config = createLocalConfig({ presets: [], components });
const compiled = compileLocal('Before\n\n<immediate-card />\n\n<deferred-card />\n\n<deferred-card />\n\n<aborted-card />\n\nAfter', { config });
if (!compiled.ok || compiled.document.requiresRuntime) throw new Error(JSON.stringify(compiled.diagnostics));

export function view(resolver, trace, onDiagnostics) {
  const reactConfig = createDeferredReactConfig(config, { components: [], resolver,
    resolveSync: ({ name }) => name === 'immediate-card' ? implementations[name] : null });
  return createElement(LocalStaticDocumentView, { document: compiled.document, reactConfig, trace, onDiagnostics });
}
