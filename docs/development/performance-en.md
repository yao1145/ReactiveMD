# Performance measurements

Stage measurements for scheduling, result application, React commits, browser layout/paint, and the editor/preview optimizations are recorded in the [render pipeline report (Chinese)](render-pipeline-optimization-2026-10-29-ch.md).

For repeated source edits, `createLocalCompileSession()` reuses unchanged compiled blocks. The built-in Worker, default fallback and React document component manage sessions automatically. See [session integration](../integration/local-integration-en.md#incremental-compilation-for-editing) and the [implementation, invalidation rules and measurements (Chinese)](incremental-compilation-2026-10-28-ch.md).

Segmented source mappings, shared line indexing, block-local fast-path fallback, direct node generation and exact budget preflight are covered in the [parser pipeline measurements (Chinese)](parser-pipeline-optimization-2026-10-28-ch.md).

Build the language package in the source repository root, then run:

```sh
npm run build
npm run benchmark
```

The script warms up 3 times and measures 20 times per scenario, reporting the median and P95; raw results are written to `artifacts/benchmark.json`. Use `npm run benchmark -- --iterations 50 --output artifacts/benchmark-50.json` to change the iteration count and output location. The report includes the package version, Node version, operating system and CPU information.

## Local baseline

2026-10-22, Reactive MD 0.3.0, Node 22.17.0, Windows x64, Intel Core Ultra 5 125H. Other development processes were running on the machine during measurement. This baseline predates the 0.4.0 release; re-run the benchmark before using it as a release comparison.

| Scenario | Median | P95 |
| --- | ---: | ---: |
| Compile the cost example, 378 characters | 2.51 ms | 5.83 ms |
| Compile a 250-row responsive table, 7,161 characters | 17.04 ms | 28.05 ms |
| Compile a 100-section article, 15,550 characters | 45.34 ms | 59.81 ms |
| 100 consecutive state writes and expression evaluations | 0.20 ms | 0.34 ms |
| Three curves, 200 sample points each | 0.55 ms | 1.61 ms |

Timing includes correctness assertions; one measurement of a runtime scenario includes 100 updates. The plotting scenario includes breakpoint checks for regular functions and non-grid asymptotes.

These numbers measure compilation, evaluation and sampling in Node; they do not include browser layout, painting or input-to-frame latency. Use them to compare versions under the same conditions; they set no cross-machine pass thresholds and do not imply that every document within the source limit takes the same time. CI saves measurement reports for Node 24; the [first CI run](https://github.com/yao1145/ReactiveMD/actions/runs/39782886373) passed and produced a report.

## Large documents in the host

Document source is limited to 1,000,000 UTF-16 code units, and plotting and expressions have separate computation budgets; see the [security policy](../../SECURITY.md) for details. Resource limits bound the work, but the compile API remains synchronous. Editors can coalesce compilations triggered by consecutive input; when handling untrusted or large documents, compile in a host Worker or a separate process, with the host controlling concurrency and timeouts.

The syntax node budget defaults to 10,000, and hosts can adjust it per call with `compileLocal(source, { limits: { maxSyntaxNodes: 50_000 } })`, see the [Core API](../integration/local-integration-en.md#core-api). After raising the budget, measure compilation, memory and final preview rendering costs together.

## Rendering optimization contract

The reference renderer uses dependency information produced by the compiler to skip subtrees that cannot read a changed parameter. This is an internal rendering optimization, not an author-visible feature or a new public API.

- The public contract is semantic: state values, rendered text, diagnostics, accessibility attributes, static SSR output and interactive behavior remain the same as an unconditioned render. Only the amount of recomputation changes.
- `document.dependencies` is a frozen, serializable internal map. It marks subtrees whose reads cannot be decided statically as `null`; those subtrees are rendered conservatively. Hosts and alternative renderers must not depend on its shape, and may ignore it.
- Source changes, instance disposal, panel reset and visibility changes that can alter hidden state still update the affected subtrees. The optimization never suppresses a diagnostic or a validation hint.
- `npm run verify:memo` compares the optimized renderer with the unconditioned baseline on the same documents and state revisions. `npm run verify:release` includes that check. A rendering optimization is acceptable only when both produce equivalent observable output.

## Playground live editing

The Playground calls the public `compileLocal` in a separate module Worker and coalesces edits within 150 ms. The scheduler keeps at most one task being compiled and one latest source waiting to compile; stale results never replace the current preview or diagnostics. The editor and export always use the latest source; while waiting for compilation, the preview shows "Compiling" and keeps the previous preview. The preview component reuses the same document, avoiding a full preview rebuild on every keystroke.

Source persistence is deferred, and pending writes are flushed when switching examples or leaving the page. If the Worker is unavailable or fails, the page shows a fallback notice and compiles on the main thread after coalescing edits; that mode still has the cost of blocking on large documents. In normal Worker mode, React rendering, layout and painting after receiving compile results still run on the main thread.

The synchronous compile API and `LocalReactiveDocument` keep their existing behavior. Other hosts can refer to `demo/src/local-compile-worker.ts` and the scheduler to move compilation into a Worker they control.

### Re-measurement

After building the language package in the repository root, run:

```sh
node scripts/benchmark-large-documents.mjs
```

The script warms up 3 times, measures 20 times, checks compilation results for 10-, 100-, 300- and 600-section articles and saves the median and P95. With the Playground running, run the following browser checks from the repository root; the default server is `http://127.0.0.1:5184`, which `DEMO_URL` can override.

```sh
node demo/scripts/verify-editing.mjs
node demo/scripts/benchmark-editing.mjs
```

The editing benchmark types 10 consecutive characters at the end of a 300-section article of about 47,000 characters, with a 20 ms interval between keystrokes, and records the latency from the input event to the next `requestAnimationFrame` callback plus main-thread long tasks. This metric observes input responsiveness and is not the time until painting completes; long-task statistics include the final preview render. `EDITING_SECTIONS` adjusts the number of sections and `EDITING_REPORT` sets the report path. All reports are written to the ignored `artifacts/` directory.

On 2026-10-22, a before/after comparison was run on the same 46,969-character article on the Windows machine above with local Edge. Both sides used the Vite development server and a 1440 × 1000 viewport; the original version was `94fd72e`, and the optimized version includes the Worker scheduling and preview reuse described in this section.

| Metric | Original | Optimized |
| --- | ---: | ---: |
| Median latency from input to next frame callback | 147.3 ms | 9.5 ms |
| Maximum latency from input to next frame callback | 157.9 ms | 36.9 ms |
| Total time to type 10 consecutive characters | 2,302 ms | 538 ms |

The raw reports are `artifacts/benchmark-editing-before.json` and `artifacts/benchmark-editing-after.json`. This is a single local observation; machine load affects the numbers. The optimization mainly reduces main-thread work triggered by keystrokes; the algorithm and single-compile speed of synchronous `compileLocal` itself are unchanged.
