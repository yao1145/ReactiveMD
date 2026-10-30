import { mountAll } from 'reactive-md/standalone';
import { reactConfig } from './extensions';

// Built by the host into an IIFE before creating the offline HTML.
const run = () => mountAll(document, { reactConfig });
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true });
else queueMicrotask(run);
