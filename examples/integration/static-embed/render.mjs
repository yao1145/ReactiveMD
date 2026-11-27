import { renderLocalStaticMarkup } from 'reactive-md/react/static/server';
import { prepareEmbed } from './embed.mjs';

const deferred = process.argv.includes('--defer');
const slots = deferred
  ? { resolveExternalSlot: ({ name }) => name === 'references' ? import('./references.mjs').then(module => module.References) : null }
  : { renderExternalSlot: ({ name }) => name === 'references' ? 'References provided by the host' : null };
const result = renderLocalStaticMarkup({ ...prepareEmbed(), ...slots });
if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
console.log(result.markup);
