import { mountAll } from 'reactive-md/standalone';
import { advancedReactConfig } from './advanced';

const run = () => mountAll(document, { reactConfig: advancedReactConfig });
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run, { once: true });
else queueMicrotask(run);
