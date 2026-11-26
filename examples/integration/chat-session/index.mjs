/**
 * Chat-document worker core.
 *
 * This module is the whole host-side dependency set for a chat compile worker:
 * one incremental session per document from `reactive-md/compiler/session`, and
 * host markers from `reactive-md/scan`. It imports no React, no
 * `reactive-md/authoring`, no template or catalog code, and touches no DOM, so
 * the same file runs inside a Worker, a server process or this Node demo.
 */
import { createLocalCompileSession, localCompileOptionsKey } from 'reactive-md/compiler/session';
import { analyzeLocalSource } from 'reactive-md/scan';

/**
 * Keep one session per chat document. `update` compiles the latest source and
 * republishes markers whose ranges point into that same source revision.
 */
export function createChatDocumentWorker(options) {
  const sessions = new Map();
  const optionsKey = localCompileOptionsKey(options);

  function open(documentId) {
    let entry = sessions.get(documentId);
    if (!entry) {
      entry = { session: createLocalCompileSession(), markers: [] };
      sessions.set(documentId, entry);
    }
    return entry;
  }

  function close(documentId) {
    const entry = sessions.get(documentId);
    if (!entry) return false;
    entry.session.dispose();
    sessions.delete(documentId);
    return true;
  }

  return {
    optionsKey,
    update({ documentId, source }) {
      const entry = open(documentId);
      const result = entry.session.compile(source, options, 'final');
      // The compiled document is reused when it belongs to the same source;
      // diagnostics stay with the compile result, so the scan stays read-only.
      const analysis = analyzeLocalSource(source, options, {
        document: result.ok ? result.document : undefined,
        diagnostics: false,
      });
      entry.markers = analysis.tokens
        .filter((token) => token.kind === 'tag' || token.kind === 'binding')
        .map((token) => ({
          kind: token.kind,
          start: token.range.start,
          end: token.range.end,
          text: source.slice(token.range.start, token.range.end),
        }));
      return {
        documentId,
        ok: result.ok,
        status: result.status,
        diagnostics: result.diagnostics,
        markers: entry.markers,
        stats: entry.session.stats,
        optionsKey,
      };
    },
    close,
    closeAll() {
      for (const documentId of [...sessions.keys()]) close(documentId);
    },
  };
}

const worker = createChatDocumentWorker();
const documentId = 'chat-7';
const source = [
  '<number bind="count" label="Guests" initial="2">',
  '',
  'Invite {{ count }} guests.',
  '',
  'Add notes in the next message.',
].join('\n');

const first = worker.update({ documentId, source });
const reused = worker.update({ documentId, source });
const edited = worker.update({ documentId, source: `${source}\n\nBring a notebook.` });

console.log(`first: ${first.stats.mode}, reused: ${reused.stats.mode}, edited: ${edited.stats.mode}`);
console.log(`status: ${edited.status}, markers: ${edited.markers.map((marker) => `${marker.kind} "${marker.text}"`).join(', ')}`);
console.log(`diagnostics: ${edited.diagnostics.length}, option key: ${edited.optionsKey}`);
worker.closeAll();