import { createElement, StrictMode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import { createLocalPerformanceReport } from 'reactive-md/observability';
import { LocalStaticDocumentView } from 'reactive-md/react/static';
import 'reactive-md/styles/minimal.css';
import 'reactive-md/presets/default/packs/css/resources/layout.css';
import { prepareEmbed } from './embed.mjs';

const events = [];
const report = document.querySelector('#report');
const observer = { onTrace(event) {
  events.push(event);
  report.textContent = JSON.stringify(createLocalPerformanceReport(events), null, 2);
} };
const props = prepareEmbed(observer);

function resolveExternalSlot({ name }) {
  return name === 'references' ? import('./references.mjs').then(module => module.References) : null;
}

const container = document.querySelector('#document');
const view = createElement(StrictMode, null, createElement(LocalStaticDocumentView, { ...props, resolveExternalSlot }));
if (container.hasChildNodes()) hydrateRoot(container, view);
else createRoot(container).render(view);
