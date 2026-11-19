import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const library = (name: string) => here(`../../dist-library/${name}`);

const MAX_BODY_BYTES = 16 * 1024;
const MAX_COMMENT_LENGTH = 2000;
const MAX_RECORDED_SUBMISSIONS = 1024;

interface SurveyAnswer {
  readonly choice: 'yes' | 'no';
  readonly comment: string;
}

interface RecordedSubmission {
  readonly answer: SurveyAnswer;
  readonly result: { readonly ok: true; readonly counts: Readonly<Record<SurveyAnswer['choice'], number>> };
}

/**
 * Resolve every public entry through `dist-library`, as a consumer would. If
 * the library has not been rebuilt since the network plugin landed, fall back
 * to the repository sources in one block so the page keeps one renderer and
 * one React context. Never mix the two for a single entry.
 */
function reactiveMdAliases(): { find: string; replacement: string }[] {
  const built = existsSync(library('reactive-md-plugin-network.js'));
  if (!built) {
    return [
      { find: 'reactive-md/styles.css', replacement: here('../../src/styles.css') },
      { find: 'reactive-md/react/minimal', replacement: here('../../src/react/minimal.tsx') },
      { find: 'reactive-md/react', replacement: here('../../src/react/index.ts') },
      { find: 'reactive-md/runtime/browser', replacement: here('../../src/runtime-services/browser/index.ts') },
      { find: 'reactive-md/runtime', replacement: here('../../src/runtime-services/index.ts') },
      { find: 'reactive-md/plugins/network', replacement: here('../../src/components/plugins/network.ts') },
      { find: 'reactive-md/presets/minimal/react', replacement: here('../../src/components/minimal-preset.ts') },
      { find: 'reactive-md/presets/minimal', replacement: here('../../src/presets/minimal.ts') },
      { find: 'reactive-md/sdk', replacement: here('../../src/sdk/index.ts') },
      { find: 'reactive-md', replacement: here('../../src/index.ts') },
    ];
  }
  return [
    { find: 'reactive-md/styles.css', replacement: library('reactive-md.css') },
    { find: 'reactive-md/react/minimal', replacement: library('reactive-md-react-minimal.js') },
    { find: 'reactive-md/react', replacement: library('reactive-md-react.js') },
    { find: 'reactive-md/runtime/browser', replacement: library('reactive-md-runtime-browser.js') },
    { find: 'reactive-md/runtime', replacement: library('reactive-md-runtime.js') },
    { find: 'reactive-md/plugins/network', replacement: library('reactive-md-plugin-network.js') },
    { find: 'reactive-md/presets/minimal/react', replacement: library('reactive-md-minimal-react-preset.js') },
    { find: 'reactive-md/presets/minimal', replacement: library('reactive-md-minimal-preset.js') },
    { find: 'reactive-md/sdk', replacement: library('reactive-md-sdk.js') },
    { find: 'reactive-md', replacement: library('reactive-md.js') },
  ];
}
/**
 * Controlled survey endpoint served by the Vite dev server in `--mode http`.
 * The demo needs no separate service and no extra dependency.
 *
 *   POST /api/survey/answers         JSON {choice, comment} -> {ok: true}
 *   GET  /api/survey/results/events  text/event-stream of {yes, no}
 *
 * Counts live in the dev-server process. Every accepted answer is broadcast to
 * open streams; opening and closing an event stream is logged, which mirrors
 * the in-page connection ledger.
 */
function surveyApi(): Plugin {
  return {
    name: 'reactive-md-survey-api',
    configureServer(server) {
      const counts = { yes: 3, no: 1 };
      const clients = new Set<ServerResponse>();
      const recordedSubmissions = new Map<string, RecordedSubmission>();

      const sendJson = (response: ServerResponse, status: number, value: unknown): void => {
        response.statusCode = status;
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        response.setHeader('Cache-Control', 'no-store');
        response.end(JSON.stringify(value));
      };

      const broadcast = (): void => {
        if (clients.size === 0) return;
        const frame = `data: ${JSON.stringify(counts)}\n\n`;
        for (const client of clients) client.write(frame);
      };
      // Re-send the snapshot so a component that joins the already-open stream
      // starts from the current counts instead of waiting for the next answer.
      const snapshotTimer = setInterval(broadcast, 5000);
      server.httpServer?.on('close', () => {
        clearInterval(snapshotTimer);
        for (const client of clients) client.end();
        clients.clear();
      });

      const readBody = (request: IncomingMessage): Promise<string> => new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let size = 0;
        let tooLarge = false;
        request.on('data', (chunk: Buffer) => {
          if (tooLarge) return;
          size += chunk.length;
          if (size > MAX_BODY_BYTES) {
            tooLarge = true;
            reject(new Error(`The request body exceeds ${MAX_BODY_BYTES} bytes.`));
            return;
          }
          chunks.push(chunk);
        });
        request.on('end', () => {
          if (!tooLarge) resolve(Buffer.concat(chunks).toString('utf8'));
        });
        request.on('error', reject);
      });

      const invalidAnswer = (body: unknown): string | undefined => {
        if (typeof body !== 'object' || body === null || Array.isArray(body)) return 'The body must be a JSON object.';
        const keys = Object.keys(body).sort();
        if (keys.length !== 2 || keys[0] !== 'choice' || keys[1] !== 'comment') {
          return 'The body must contain exactly choice and comment.';
        }
        const { choice, comment } = body as Record<string, unknown>;
        if (choice !== 'yes' && choice !== 'no') return 'choice must be "yes" or "no".';
        if (typeof comment !== 'string') return 'comment must be a string.';
        if (comment.length > MAX_COMMENT_LENGTH) return `comment must be at most ${MAX_COMMENT_LENGTH} characters.`;
        return undefined;
      };

      server.middlewares.use('/api/survey', (request, response, next) => {
        const url = request.url ?? '';

        if (url === '/answers') {
          if (request.method !== 'POST') {
            sendJson(response, 405, { error: 'Use POST for /api/survey/answers.' });
            return;
          }
          const key = request.headers['idempotency-key'];
          const participant = request.headers['x-survey-participant'];
          if (key !== undefined && (typeof key !== 'string' || !/^[\x21-\x7e]{1,128}$/.test(key)
            || typeof participant !== 'string' || !/^[a-f0-9]{32}$/.test(participant))) {
            sendJson(response, 400, { error: 'Send a valid Idempotency-Key and X-Survey-Participant.' });
            return;
          }
          const recordKey = key === undefined ? undefined : JSON.stringify([participant, 'POST /api/survey/answers', key]);
          void readBody(request).then((text) => {
            let body: unknown;
            try {
              body = JSON.parse(text);
            } catch {
              sendJson(response, 400, { error: 'The body is not valid JSON.' });
              return;
            }
            const problem = invalidAnswer(body);
            if (problem !== undefined) {
              sendJson(response, 422, { error: problem });
              return;
            }
            const answer = body as SurveyAnswer;
            // Check, increment and record synchronously before responding or publishing.
            const recorded = recordKey === undefined ? undefined : recordedSubmissions.get(recordKey);
            if (recorded !== undefined) {
              if (recorded.answer.choice !== answer.choice || recorded.answer.comment !== answer.comment) {
                sendJson(response, 409, { error: 'This idempotency key is already associated with a different answer.' });
              } else {
                sendJson(response, 200, recorded.result);
              }
              return;
            }
            if (recordKey !== undefined && recordedSubmissions.size >= MAX_RECORDED_SUBMISSIONS) {
              sendJson(response, 429, { error: 'This demo has reached its submission limit.' });
              return;
            }
            counts[answer.choice] += 1;
            const result = { ok: true as const, counts: { ...counts } };
            if (recordKey !== undefined) recordedSubmissions.set(recordKey, { answer, result });
            console.log(`[survey] answer recorded: ${answer.choice} -> ${JSON.stringify(counts)}`);
            broadcast();
            sendJson(response, 200, result);
          }, () => {
            sendJson(response, 413, { error: 'The request body is too large.' });
          });
          return;
        }

        if (url === '/results/events') {
          if (request.method !== 'GET') {
            sendJson(response, 405, { error: 'Use GET for /api/survey/results/events.' });
            return;
          }
          response.writeHead(200, {
            'Content-Type': 'text/event-stream; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            Connection: 'keep-alive',
            'X-Accel-Buffering': 'no',
          });
          response.write(`data: ${JSON.stringify(counts)}\n\n`);
          clients.add(response);
          console.log(`[survey] SSE client opened (${clients.size} open)`);
          const heartbeat = setInterval(() => response.write(': ping\n\n'), 15_000);
          const close = (): void => {
            if (!clients.delete(response)) return;
            clearInterval(heartbeat);
            console.log(`[survey] SSE client released (${clients.size} open)`);
          };
          // `IncomingMessage` reports `close` when the request body is complete,
          // not when the socket goes away, so only the response is authoritative.
          response.on('close', close);
          request.on('aborted', close);
          return;
        }

        next();
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  root: here('./'),
  plugins: [react(), ...(mode === 'http' ? [surveyApi()] : [])],
  resolve: { alias: reactiveMdAliases() },
  server: { port: 4318, strictPort: true },
  build: { outDir: here('./dist'), emptyOutDir: true, target: 'es2022' },
}));
