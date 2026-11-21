import { Buffer } from 'node:buffer';
import { parseAst, type Plugin } from 'vite';

/** Emit the engine's fixed author interpreter as a portable inline Worker. */
export function bundleAuthorWorker(): Plugin {
  return {
    name: 'reactive-md-author-worker',
    apply: 'build',
    enforce: 'post',
    transform(code, id) {
      if (!id.replaceAll('\\', '/').endsWith('/src/local/runtime/author-script.worker.ts?worker&inline')) return;
      const first = parseAst(code).body[0];
      const declaration = first?.type === 'VariableDeclaration' ? first.declarations[0] : undefined;
      if (declaration?.id.type !== 'Identifier' || declaration.id.name !== 'jsContent'
        || declaration.init?.type !== 'Literal' || typeof declaration.init.value !== 'string') {
        this.error('Vite did not provide a bundled author interpreter.');
      }
      const encoded = Buffer.from(declaration.init.value, 'utf8').toString('base64');
      // The configured standalone builder disables Worker constructors in
      // extensions. This factory is only emitted for the engine-owned bundle.
      return {
        code: `
export default function AuthorScriptWorker() {
  const Constructor = globalThis.Worker;
  if (typeof Constructor !== "function") throw new Error("Author script workers are unavailable.");
  const bytes = Uint8Array.from(atob(${JSON.stringify(encoded)}), byte => byte.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: "text/javascript" }));
  try {
    const worker = Reflect.construct(Constructor, [url]);
    const release = () => URL.revokeObjectURL(url);
    worker.addEventListener("message", release, { once: true });
    worker.addEventListener("error", release, { once: true });
    const terminate = worker.terminate.bind(worker);
    worker.terminate = () => {
      release();
      terminate();
    };
    return worker;
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}`,
        map: null,
      };
    },
  };
}
