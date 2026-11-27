import { hydrateRoot } from 'react-dom/client';
import { implementations, view } from './view.mjs';

const events = [];
const diagnostics = [];
const requests = [];
const trace = { traceId: 'deferred-browser', documentId: 'deferred-browser', sourceRevision: 1, sourcePhase: 'final',
  observer: { onTrace: event => events.push(event) } };
const root = hydrateRoot(document.querySelector('main'), view(({ name, signal }) => new Promise((resolve, reject) => {
  requests.push({ name, signal, resolve, reject });
}), trace, next => diagnostics.push(...next)));

window.deferredFixture = { events, diagnostics, requests,
  resolve(name) { requests.findLast(request => request.name === name)?.resolve(implementations[name]); },
  fail(name) { requests.findLast(request => request.name === name)?.reject(new Error('Host lookup failed')); },
  unmount() { root.unmount(); },
};
