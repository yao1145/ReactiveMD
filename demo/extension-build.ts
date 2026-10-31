import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build, type Plugin } from 'vite';
import { buildLocalStandaloneBundle, LocalBuildError } from 'reactive-md/build';

const root = fileURLToPath(new URL('../', import.meta.url));
const registration = fileURLToPath(new URL('./extensions.ts', import.meta.url));
const virtualId = 'virtual:demo-extension-bundle';
const resolvedId = `\0${virtualId}`;

/** Convert TS/JSX package registrations to a Node entry for the public builder. */
export async function buildDemoExtensionBundle(
  watch: (file: string) => void = () => {},
  registrationEntry = registration,
) {
  const result = await build({
    root, configFile: false, logLevel: 'warn', publicDir: false,
    // Package code must travel with the generated host module, even when npm
    // installed it under demo/node_modules rather than the repository root.
    ssr: { noExternal: true },
    // A dev server sets NODE_ENV=development; exported files still use React's
    // production runtime, which does not implement jsxDEV.
    oxc: { jsx: { development: false } },
    plugins: [{
      name: 'demo-extension-node-entry',
      resolveId(id) { return id === 'virtual:demo-extension-node' ? '\0demo-extension-node' : null; },
      load(id) {
        if (id !== '\0demo-extension-node') return null;
        return `export { config, reactConfig, resources, notices } from ${JSON.stringify(registrationEntry.replaceAll('\\', '/'))};\nexport const root = ${JSON.stringify(root)};\nexport const allowlist = [root];`;
      },
      moduleParsed(info) { if (!info.id.startsWith('\0')) watch(info.id.split('?')[0]); },
    }],
    build: {
      write: false, ssr: true, minify: false,
      rolldownOptions: {
        input: 'virtual:demo-extension-node',
        external: [/^reactive-md(?:\/|$)/, /^react(?:\/|$)/, /^react-dom(?:\/|$)/],
        output: { format: 'es', codeSplitting: false },
      },
    },
  });
  if (Array.isArray(result) || !('output' in result)) throw new Error('Unexpected extension Node build output.');
  const chunks = result.output.filter(item => item.type === 'chunk');
  if (chunks.length !== 1 || result.output.some(item => item.type !== 'chunk')) {
    throw new Error('Demo extension Node entry must be one module with inline resources.');
  }
  const code = chunks[0].code;
  const digest = createHash('sha256').update(code).digest('hex').slice(0, 20);
  const directory = new URL('../artifacts/demo-extensions/', import.meta.url);
  await mkdir(directory, { recursive: true });
  const entry = new URL(`host-${digest}.mjs`, directory);
  await writeFile(entry, code);
  try {
    return await buildLocalStandaloneBundle({ entry });
  } catch (error) {
    // A preview-only package can still be used by the Demo. Carry its precise
    // capability diagnostics to the export dialog instead of breaking the site.
    if (error instanceof LocalBuildError && error.diagnostics.length > 0
      && error.diagnostics.every(item => item.code === 'local.extension.export-capability')) {
      return { error: error.message, diagnostics: error.diagnostics };
    }
    throw error;
  }
}

/** Lazy in dev; Vite includes the verified offline runtime in production builds. */
export function demoExtensionBundle(): Plugin {
  let pending: ReturnType<typeof buildDemoExtensionBundle> | undefined;
  const watched = new Set<string>();
  return {
    name: 'demo-extension-bundle',
    resolveId(id) { return id === virtualId ? resolvedId : null; },
    async load(id) {
      if (id !== resolvedId) return null;
      pending ??= buildDemoExtensionBundle(file => watched.add(file)).catch(error => { pending = undefined; throw error; });
      const bundle = await pending;
      for (const file of watched) this.addWatchFile(file);
      return `export default ${JSON.stringify(bundle)};`;
    },
    watchChange(id) { if (watched.has(id)) pending = undefined; },
    handleHotUpdate(context) {
      if (!watched.has(context.file)) return;
      pending = undefined;
      const module = context.server.moduleGraph.getModuleById(resolvedId);
      if (module) context.server.moduleGraph.invalidateModule(module);
      // The exporting module caches its dynamic import. Reload both consumers.
      context.server.ws.send({ type: 'full-reload' });
    },
  };
}
