# Performance optimization and current measurement overview

**English** · [中文](performance-overview-ch.md)

Re-tested 2026-11-20. Part 1 preserves each round's original record. Part 2's compilation, long-document editing, mixed parsing, incremental sessions, Worker, runtime stages and memory tables were re-measured on the 0.8.0 codebase at commit `8b0ccdc`; the full matrix was run twice on the same machine and the tables use the second pass. The editor and demo now live in separate repositories, so the CM6 full-editor, React rendering and targeted A/B comparisons cannot be re-run here; their 2026-10-29 records are retained and marked.

## 1. Direction and outcome of each optimization round

The records below are as of each optimization. Cold compilation, steady-state editing and input-to-frame opportunity use different bases, so these numbers cannot be chained into a single speedup ratio. The current full matrix and the 2026-10-29 targeted re-measurements are in part two.


| Commit | Direction | Optimization outcome at the time and basis |
| --- | --- | --- |
| ea80662 | Ordinary paragraphs produce a LocalNode directly; Markdown without replacements reuses the first-pass AST, avoiding duplicate parsing and per-character mapping | Relative to df59896, first compilation of 5000 ordinary paragraphs 517.4 → 87.0 ms; 100k paragraphs rejected under the default budget 16339.7 → 29.9 ms, peak RSS 1003.8 → 69.4 MiB; after raising the budget to 250k nodes, successful compilation 19918.7 → 2297.8 ms. All are first calls in an independent Node process. |
| 6ac6916 | Added a block-level incremental session that locates changes with Lezer TreeFragment and keeps unmodified blocks; wired into the Worker, fallback compilation and React component | Full and incremental measured as pairs in the same build, 3 warmups and 15 measurements. A 600-section article 1030.09 → 30.65 ms, compiling only 1 block and reusing 1799; 5000 ordinary paragraphs 60.20 → 15.99 ms. Establishing a session for the first time has additional cost. |
| fb05509 | Deferred block-cache rebuilds during consecutive component-context changes; fast scanning for simple lists and tables; fewer copies of private results | Compared against the production package saved before the change. 100-item list session edit 15.08 → 5.70 ms, 200×4 table 30.78 → 10.82 ms (21 measurements); of 200 consecutive context changes the last 199 build no index, and restoring the body builds one. |
| 658a3b6 | Contiguous range mapping and shared row index; per-block fast/general dispatch; direct node production and upfront budgets; parse and semantic caches; shared results, bidirectional Worker patches, runtime reuse and cancellable idle preparation | Relative to fb05509, inside a container a 256k-indented long line 9846.93 → 25.09 ms, 80 mixed blocks 82.21 → 39.61 ms. Browser component-context Worker 80 → 60 ms, body 29 → 11 ms. The dynamic list preview regressed once from 394.3 to 503.5 ms; patches for huge lists and tables are still close to full results. |
| 047b547 | 20 ms Demo debounce; retained preview and runtime, stable highlighting and reference keys; later top-level paragraphs use content-visibility:auto | Relative to the production package and Demo snapshot saved before that round's change, the old full editor's input-to-frame opportunity: 800 dynamic paragraphs 705.5 → 182.5 ms; 2400 paragraphs 2401.9 → 644.6 ms; 1000-row dynamic table 837.1 → 446.3 ms (median, 15 samples). The baseline already includes earlier optimizations and is not the original fb05509. |
| f7a7ab8 | Introduced CM6 and made it the Demo default; source creates DOM per viewport; shared Worker author analysis; fixed const/computed and HTML syntax highlighting, restored the old color scheme | Two editors on the same prototype package: 800 paragraphs input-to-frame opportunity 93.7 → 15.0 ms, source DOM 4015 → 294; 2400 paragraphs 301.7 → 24.0 ms, DOM 12015 → 294; 1000-row dynamic table 223.8 → 16.5 ms. These are prototype records; this round re-measured through the single CM6 entry point. |
| 4a8f1ea | The previous-block row plan avoids the 512-entry LRU order scan on eviction; keeps unmodified row IDs and objects, updating ranges on shifts; sends a full success result instead of an unprofitable patch; copies short strings in caches; removed the old textarea source editor | A/B, real preview DOM, cache memory and the CM6 full matrix are below. /editor and /editor/codemirror share components, styles and runtime; the old textareaRef/getTextarea are removed, and the document form textarea remains supported. |
| This round (based on 4a8f1ea) | Simple dynamic rows reuse the validated placeholder plan, and the first-pass masking scan also skips Markdown inside expressions; deep node traversal, snapshot publishing, dependency summaries, runtime and view indexing use explicit stacks; negotiated flat result transfer; deep single-child container chains use fewer React memo wrappers | Compilation and preview comparisons for dynamic lists and tables are in the targeted re-measurement. Real Edge passed compilation and transfer of 1000-level references, lists and mixed nesting, and deep preview edits preserve parameter 13; 1001-level Markdown is rejected by budget. |


This round also confirmed a cache retention problem: short row strings could indirectly reference the old full text. Before the fix, for the same 1000-item list, the post-GC heap grew from 23.52 to 27.54 MiB between edits 100 and 200; after copying cache keys and inline token text, an independent re-measurement gave 20.26 → 20.34 MiB. A formal 500-edit long-row measurement follows below.

The historical implementation basis includes Lezer's incremental fragments, GFM container rules and CM6 viewport management; these approaches fall back conservatively according to current semantics. Reference definitions, footnotes, HTML, BOM, declaration or container context changes and code delimiter changes can still trigger a full compilation. This round brings simple dynamic interpolation rows into the fast path; links, escapes, nesting and complex inline formatting continue to fall back per block.

## 2. Current compilation and rendering performance overview

### Measurement conditions and coverage

Node v22.17.0, Intel(R) Core(TM) Ultra 5 125H, Windows x64. Node stress scenarios use independent processes with a 1 GiB old-generation cap; the browser is Edge 135.0.3179.66 in headless mode at a 1440×1000 viewport. Daily development processes remain running on the machine; power policy and CPU frequency were not pinned. Performance scripts run serially. This round was re-run on 2026-11-20 on the same machine; two full matrices were run back to back and several scenarios varied in both directions, so the tables use the second pass and its per-sample data is in the summary. Stages that depend on the demo or editor repositories were not included.

Typically 3 warmups and 15 measurements; the long-line and dedicated over-budget cases use 5/3, and the independent browser Worker uses 2 warmups and 5 measurements; the summary data is authoritative. P95 uses the nearest rank, which equals the maximum sample at 15 samples and is used only to observe the tail. First calls, public snapshot copies, shared Worker results and main-thread rendering are recorded separately.

RSS is the process high-water mark and includes Node, modules, input and temporary objects; the post-GC heap is the retained amount, and the two are not interchangeable. JSON UTF-8 message size is an estimate; structured-clone cost is measured separately. Input-to-preview ends at the second requestAnimationFrame frame opportunity after commit; CDP Paint is a paint-phase event, and neither indicates GPU display completion. React phases overlap and cannot be summed.

### Targeted re-measurement from 2026-10-29: dynamic rows and deep nesting (historical, not re-run)

The baseline is the `4a8f1ea` production package saved at the start of that round, and post-change data comes from that round's final build; code hashes and condensed results are in `benchmarks/dynamic-depth-2026-10-29.json`. That round re-measured dynamic lists, dynamic tables, deep containers, protocol recovery and sustained-edit memory. The original record is kept here; current measurements are in the tables below.

Each browser group uses 3 warmups and 15 measurements. Before-change samples are retained from that round's first paired measurement, and after-change samples were re-measured on the final build. The table shows median/P95 in ms. Input is driven by an independent textarea fixture to compare the Worker-to-React preview path; CM6 and deep preview get separate real-browser functional verification.

| Dynamic scenario | Worker compile, before → after | Input to preview frame opportunity, before → after | Median response size, before → after |
| --- | --- | --- | --- |
| 1000-item dynamic list | 268/342 → 175/253 | 339.6/408.9 → 280.6/396.7 | 15444 → 15453 B |
| 500-row dynamic table | 213/310 → 66/89 | 286/373.1 → 134.4/159.1 | 8688 → 8693 B |

Node in-process Worker-handler comparisons also use 3 warmups and 15 measurements; the table below lists only the compilation phase and excludes patch encoding, cloning or React.

| Scenario | Compile median/P95, before → after ms |
| --- | --- |
| 1000-item dynamic list, equal-length edit | 148/212 → 104/129 |
| 1000-item dynamic list, shift edit | 195/291 → 266/368 |
| 500-row dynamic table, equal-length edit | 111/202 → 86/106 |
| 500-row dynamic table, shift edit | 115/230 → 110/185 |

This batch's Node shift list regressed; a separate new-process comparison gave 324/508 → 124/255 ms. Both batches show clear jitter, so all raw results are kept and that round computes no unified speedup ratio. The browser table uses final-build measurements.

Deep Node comparisons use independent processes, 1 warmup and 3 measurements, through the public `compileLocal()` path. The component limit remains 100 levels and the Markdown limit 1000 levels; over-limit rows record rejection time.

| Scenario and result | Compile median, before → after ms | First-call peak RSS, before → after MiB |
| --- | --- | --- |
| containers-50, success | 37.38 → 16.87 | 71.28 → 67.26 |
| containers-100, success | 109.42 → 32.91 | 81.17 → 70.29 |
| containers-101, local.budget.nesting | 107.89 → 11.14 | 79.43 → 67.12 |
| containers-1000, local.budget.nesting | 4587.18 → 88.83 | 138.18 → 97.64 |
| markdown-depth-500, success | 10.25 → 12.37 | 67.17 → 67.19 |
| markdown-depth-1000, success | 22.29 → 20.08 | 77.91 → 76.86 |
| markdown-depth-1500, local.budget.markdown-depth | 3.19 → 2.8 | 64.17 → 64.04 |

500-level blockquotes are slightly slower in this batch of Node measurements; the main gain of the deep work is fewer duplicate parses of component bodies, earlier termination of over-limit input, and removal of browser call-stack and result-transfer failures. A 1000-level list still takes hundreds of milliseconds, and general container parsing still has room for improvement.

The real Edge module Worker passed 100/500/1000-level blockquotes, 1000-level lists and 500 groups of mixed reference/list nesting, and leaf expressions were correct after deep edits. A corrupted flat frame recovers with exactly one full request, after which a 1001-level budget rejection and an ordinary document return to normal. CM6 and the React preview passed 500/1000-level references, 1000-level unordered/ordered lists and mixed nesting; the original DOM depth is preserved, the expression edited from `n * 2` to `n * 3` displays 39, the parameter stays 13, only one Worker is created, and page and console errors are empty.

The implementation includes three constraints: the fast plan validates placeholder positions and types produced by the current parse every time, and the first-pass expression masking plan only supplies Markdown facts and must not generate body nodes; deep results negotiate `flatResults: "flat-v1"` into flat records plus references, while ordinary documents keep the existing patches; single-child Markdown container chains above 32 levels build native wrappers iteratively, reducing React memo component layers while preserving native DOM structure. Copying, sharing, flat encoding/decoding, runtime indexing and view projection of 6000-level data have separate unit verification.

A 1000-item dynamic list edited 500 times consecutively: post-GC heap growth over edits 50–500 is 0.463 MiB, retained heap 18.146 MiB, and 13.095 MiB after releasing the session; the parse cache ends at 524 entries, still within the 672-entry cap.

The implementation references [Lezer's context and incremental reuse constraints](https://lezer.codemirror.net/docs/guide/) and [V8's iterative traversal approach](https://v8.dev/blog/json-stringify). Flat records reference [the object index table of @ungap/structured-clone](https://github.com/ungap/structured-clone/blob/main/esm/serialize.js); that implementation's visitor is still recursive, whereas this round implements iterative traversal for the compiler's ordinary data with no new dependency.

That round's gates: 116 core test files with 1534 tests and 16 Demo files with 254 tests pass; type checking, production/standalone/declaration builds, Demo builds, public package checks and offline packed consumption pass; documentation links and `git diff --check` pass. The deep stress unit tests set a separate 30-second timeout, and performance statistics come from production-package scripts.

Reproduce the targeted tests (the commands below belong to that round; the CM6 fixture used by `--preview` moved to the editor repository):

```powershell
npm run build
node scripts/benchmark-row-reuse.mjs --case=dynamic --out=artifacts/dynamic-depth/rows-after-final.json
node scripts/verify-deep-worker-browser.mjs --preview
$env:EDITING_BEFORE="artifacts/dynamic-depth/before-library"
$env:EDITING_DYNAMIC_ROWS="1"
$env:EDITING_CASES="list,table"
node scripts/benchmark-editing-comparison.mjs
$env:EDITING_MEMORY_CASES="longRows"
$env:EDITING_MEMORY_REPORT="artifacts/dynamic-depth/dynamic-memory.json"
node scripts/benchmark-editing-memory.mjs
```

Per-sample results and failure reproductions are kept in `artifacts/dynamic-depth/`. The old-package snapshot is a local artifact; re-running the comparison requires saving an identical baseline production package first.

### Full compilation and extreme input (8b0ccdc, 45 scenarios)

Calls the public compileLocal; timing includes final result construction and excludes input generation, checking and GC. The node budget defaults to 10000; scenarios marked raised use 250000. Character counts are UTF-16 code units. Budget rejections are listed separately as expected outcomes, and all scenarios should exit normally.


| Scenario ID | Characters | Result / nodes | First ms | Steady-state median / P95 ms | First-call peak RSS MiB |
| --- | --- | --- | --- | --- | --- |
| plain-10000 | 10000 | success / 2 | 12.14 | 0.17 / 0.83 | 67.89 |
| plain-100000 | 100000 | success / 2 | 18.77 | 0.62 / 1.32 | 69.16 |
| plain-500000 | 500000 | success / 2 | 22.23 | 3.73 / 6.79 | 70.13 |
| plain-1000000 | 1000000 | success / 2 | 21.02 | 5.36 / 6.59 | 71.16 |
| plain-1000001 | 1000001 | local.budget.document | 9.21 | 0.05 / 0.21 | 69.45 |
| article-10 | 1598 | success / 161 | 61.92 | 6.33 / 11.67 | 73.51 |
| article-100 | 15550 | success / 1601 | 125.82 | 28.62 / 42.80 | 83.66 |
| article-600 | 94050 | success / 9601 | 450.76 | 339.55 / 406.06 | 125.39 |
| article-2000 | 315852 | local.budget.nodes | 738.17 | 518.00 / 829.54 | 160.56 |
| article-2000-raised | 315852 | success / 32001 | 1147.08 | 838.71 / 1054.24 | 177.64 |
| controls-1000 | 68779 | success / 1000 | 264.14 | 136.45 / 156.61 | 119.97 |
| controls-5000 | 352779 | success / 5000 | 921.47 | 831.04 / 905.37 | 206.09 |
| controls-10000 | 707779 | success / 10000 | 1745.31 | 1477.54 / 1791.96 | 342.32 |
| controls-10001 | 707852 | local.budget.nodes | 197.23 | 149.45 / 173.64 | 115.06 |
| controls-12000 | 853779 | local.budget.nodes | 259.77 | 179.85 / 215.00 | 119.33 |
| controls-10000-raised | 707779 | success / 10000 | 1652.14 | 1502.26 / 1986.24 | 338.87 |
| controls-12000-raised | 853779 | success / 12000 | 2195.87 | 1897.38 / 2221.06 | 391.69 |
| shared-controls-5000 | 270000 | success / 5000 | 845.98 | 629.16 / 813.83 | 215.34 |
| conflicting-controls-5000 | 329999 | local.initial.duplicate-peers | 856.53 | 684.66 / 872.58 | 198.07 |
| expressions-1000 | 21960 | success / 4001 | 259.66 | 84.07 / 131.19 | 106.48 |
| expressions-5000 | 113960 | local.budget.nodes | 435.23 | 194.96 / 225.71 | 146.44 |
| expressions-5000-raised | 113960 | success / 20001 | 712.13 | 502.46 / 696.91 | 157.50 |
| paragraphs-1000 | 6000 | success / 2000 | 35.12 | 10.68 / 18.20 | 78.88 |
| paragraphs-5000 | 30000 | success / 10000 | 101.65 | 54.03 / 60.55 | 92.74 |
| paragraphs-10000 | 60000 | local.budget.nodes | 18.27 | 1.79 / 7.25 | 72.91 |
| paragraphs-20000 | 120000 | local.budget.nodes | 17.83 | 2.33 / 4.25 | 72.98 |
| paragraphs-100000 | 600000 | local.budget.nodes | 23.95 | 6.92 / 11.95 | 79.15 |
| paragraphs-100000-raised | 600000 | success / 200000 | 1839.39 | 2007.70 / 2364.49 | 291.53 |
| formatted-paragraphs-5000 | 285000 | local.budget.nodes | 609.26 | 507.34 / 594.79 | 176.37 |
| formatted-paragraphs-5000-raised | 285000 | success / 40000 | 1012.14 | 828.23 / 981.74 | 206.25 |
| containers-50 | 956 | success / 52 | 75.31 | 16.42 / 19.85 | 79.57 |
| containers-100 | 1906 | success / 102 | 106.02 | 33.63 / 40.69 | 82.22 |
| containers-101 | 1925 | local.budget.nesting | 57.15 | 11.00 / 20.12 | 77.44 |
| containers-1000 | 19006 | local.budget.nesting | 213.41 | 110.43 / 134.72 | 101.30 |
| unclosed-1000 | 9004 | local.budget.nesting | 130.10 | 63.69 / 81.02 | 82.53 |
| markdown-depth-100 | 204 | success / 102 | 35.97 | 3.03 / 5.84 | 70.54 |
| markdown-depth-500 | 1004 | success / 502 | 53.59 | 8.77 / 14.23 | 78.91 |
| markdown-depth-1000 | 2004 | success / 1002 | 80.30 | 19.77 / 31.34 | 86.86 |
| markdown-depth-1500 | 3004 | local.budget.markdown-depth | 25.95 | 1.89 / 5.13 | 72.34 |
| markdown-depth-2000 | 4004 | local.budget.markdown-depth | 30.74 | 2.49 / 4.45 | 73.88 |
| markdown-depth-5000 | 10004 | local.budget.markdown-depth | 49.46 | 4.97 / 7.78 | 82.66 |
| math-1000 | 16000 | success / 2000 | 406.93 | 194.00 / 218.00 | 121.20 |
| table-1000 | 28910 | success / 5008 | 196.79 | 60.20 / 80.78 | 96.14 |
| computed-chain-1000 | 45839 | success / 3 | 296.67 | 137.38 / 168.25 | 118.54 |
| computed-chain-5000 | 237839 | success / 3 | 902.24 | 625.79 / 751.97 | 208.96 |


### Long-document editing across block types (24 scenarios)

The same target block sits among 1000 ordinary paragraphs; version numbers have fixed width, and the fenced-delimiter scenario actively changes the boundary. Independent process per scenario, alternating full compilation and session compilation order. The table includes the cost of publishing an independent public snapshot; syntax highlighting, plot sampling and DOM layout are outside this table.

| Target block | Single-block full ms | Long-document full ms | Session median / P95 ms | Final mode | Reused blocks |
| --- | --- | --- | --- | --- | --- |
| Ordinary paragraph, about 512 characters | 0.22 | 11.05 | 15.21 / 22.42 | incremental | 1000 |
| Ordinary paragraph, about 8 Ki characters | 0.24 | 9.90 | 15.94 / 21.03 | incremental | 1000 |
| Formatted paragraph, about 512 characters | 3.36 | 40.03 | 20.27 / 23.92 | incremental | 1000 |
| Level-2 heading, about 80 characters | 0.83 | 37.30 | 16.83 / 20.78 | incremental | 1000 |
| Unordered list, 20 items | 1.93 | 23.12 | 14.36 / 22.48 | incremental | 1000 |
| Unordered list, 100 items | 7.19 | 25.18 | 20.96 / 29.45 | incremental | 1000 |
| Ordered list, 20 items | 1.66 | 22.02 | 15.24 / 20.90 | incremental | 1000 |
| Markdown table, 20×4 | 2.43 | 22.43 | 15.41 / 20.44 | incremental | 1000 |
| Markdown table, 100×4 | 5.72 | 32.02 | 26.48 / 33.35 | incremental | 1000 |
| Markdown table, 200×4 | 15.04 | 37.64 | 33.75 / 63.07 | incremental | 1000 |
| Blockquote, 10 paragraphs | 2.12 | 33.93 | 14.74 / 22.42 | incremental | 1000 |
| Fenced code, 60 lines | 1.64 | 39.44 | 17.34 / 21.56 | incremental | 1000 |
| Fenced code, 300 lines | 3.47 | 41.13 | 18.93 / 23.55 | incremental | 1000 |
| Indented code, 60 lines | 1.58 | 93.63 | 20.17 / 41.95 | incremental | 1000 |
| Display formula, 20 items | 3.53 | 72.09 | 19.64 / 35.87 | incremental | 1000 |
| Display formula, 80 items | 8.07 | 72.58 | 24.87 / 42.12 | incremental | 1000 |
| Expression paragraph, 20 interpolations | 2.51 | 68.18 | 18.68 / 32.43 | incremental | 1000 |
| Slider initial value change | 1.73 | 79.63 | 91.34 / 144.33 | full | 0 |
| Panel interior, 50 paragraphs | 6.03 | 79.72 | 74.44 / 83.49 | full | 0 |
| ReactiveMD table, 20×4 | 4.87 | 77.61 | 96.41 / 127.31 | full | 0 |
| Bar chart data, 20 rows | 4.29 | 67.02 | 81.17 / 105.50 | full | 0 |
| Plot formula, 1 curve | 3.64 | 71.66 | 84.50 / 112.96 | full | 0 |
| Diagram node body, 20 nodes | 9.06 | 66.52 | 70.31 / 107.23 | full | 0 |
| Fenced delimiter change, 60 lines of code | 1.49 | 39.16 | 54.30 / 68.21 | full | 0 |


### Fast/general mixed parsing and long lines

Covers simple blocks interleaved with links and escapes, native and component tables, dynamic cells, 5000 controls, very long indented lines inside containers, and large over-budget lists.

| Scenario | Median / P95 ms | Process peak RSS MiB |
| --- | --- | --- |
| ordinary-1000 | 12.81 / 19.20 | 108.34 |
| mixed-80 | 53.82 / 67.16 | 167.36 |
| table-1000 | 84.78 / 97.55 | 178.88 |
| component-table-500 | 41.29 / 64.94 | 163.93 |
| component-dynamic-table-500 | 35.70 / 40.62 | 119.51 |
| controls-5000 | 671.72 / 1066.59 | 548.40 |
| indented-line-16000 | 10.64 / 12.23 | 93.00 |
| indented-line-64000 | 21.97 / 31.13 | 91.98 |
| indented-line-256000 | 75.08 / 85.49 | 89.41 |
| over-budget-list-50000 | 349.35 / 352.36 | 532.13 |


Cache recovery of an independent body after 200 consecutive component-context changes:

| Context edit median / P95 ms | Index rebuilds during consecutive changes | Restore body ms | Index builds during restore |
| --- | --- | --- | --- |
| 52.80 / 93.53 | 0 | 124.58 | 1 |


Full compilation scale for pure blocks:

| Scenario | Median / P95 ms | Peak RSS MiB |
| --- | --- | --- |
| bullet-100 | 8.27 / 14.95 | 84.77 |
| bullet-500 | 26.40 / 31.44 | 133.75 |
| bullet-1500 | 90.62 / 124.96 | 191.04 |
| table-100 | 8.71 / 14.94 | 100.35 |
| table-500 | 39.94 / 49.41 | 142.10 |
| table-1000 | 89.38 / 133.26 | 195.25 |
| component-table-100 | 12.16 / 20.38 | 103.84 |
| component-table-500 | 46.24 / 61.33 | 145.66 |


Full compilation versus session editing in the same build, including full snapshot publishing:

| Document | Full median ms | Session median ms | First session ms | Compiled / reused blocks |
| --- | --- | --- | --- | --- |
| paragraphs-5000 | 70.04 | 81.39 | 365.93 | 1 / 4999 |
| formatted-paragraphs-1000 | 147.40 | 58.84 | 390.44 | 1 / 999 |
| article-600 | 213.85 | 74.87 | 609.83 | 1 / 1799 |
| article-2000 | 767.36 | 271.56 | 1196.28 | 1 / 5999 |


### Row reuse and patch cost (8b0ccdc)

The current production package runs the production Worker handler inside Node, one session per scenario, 3 warmups and 15 measurements; responses are applied only after structuredClone. Worker timing excludes cross-thread transfer; the clone column is local copy time. equal is a fixed-length middle edit, shift alternately adds and removes characters and shifts later ranges, and rewrite changes every row.

| Scenario | Worker median ms | Compile median ms | Encode median ms | Clone median ms | Patch apply ms | Response B | Shared nodes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| list-equal | 86.07 | 79.00 | 6.00 | 0.15 | 4.13 | 14900 | 5998 |
| list-shift | 116.62 | 110.00 | 5.00 | 0.49 | 5.71 | 38001 | 3002 |
| table-equal | 50.50 | 47.00 | 4.00 | 0.16 | 3.05 | 8565 | 3504 |
| table-shift | 68.20 | 59.00 | 9.00 | 0.45 | 3.45 | 20156 | 1759 |
| dynamic-list-equal | 167.81 | 157.00 | 10.00 | 0.27 | 6.39 | 15436 | 7997 |
| dynamic-list-shift | 204.73 | 197.00 | 10.00 | 0.69 | 7.92 | 38536 | 4003 |
| dynamic-table-equal | 60.61 | 57.00 | 4.00 | 0.19 | 2.68 | 8681 | 3505 |
| dynamic-table-shift | 66.12 | 63.00 | 3.00 | 0.36 | 3.01 | 20274 | 1760 |
| paragraphs-equal | 8.41 | 7.00 | 1.00 | 0.11 | 1.19 | 11184 | 1602 |
| list-rewrite | 127.97 | 104.00 | 28.00 | 21.97 | 0.00 | 906084 | 0 |

Equal-length single-row edits mainly reduce transfer, main-thread patch application and React node replacement. Shift edits must update later ranges and still clone objects; a whole-block rewrite encodes first and then decides to send a full result, so Worker encoding cost may rise. Real-browser end-to-end latency is in the next section; Node handler data cannot replace it.

The 2026-10-29 round ran the same comparison against a saved f7a7ab8 production package. That baseline is not retained in this repository, so it was not re-run this round; its results remain in `benchmarks/performance-overview-2026-10-29.json`.

### 2026-10-29 row reuse and patch cost A/B (historical, not re-run)

The baseline is that round's saved f7a7ab8 production package. One session per scenario, 3 warmups and 15 measurements. The production Worker handler runs inside Node; responses are applied only after structuredClone. Worker timing excludes cross-thread transfer; the clone column is local copy time. equal is a fixed-length middle edit, shift alternately adds and removes characters and shifts later ranges, and rewrite changes every row.

| Scenario | Worker median ms: before → after | Clone median ms: before → after | Patch apply ms: before → after | Response B: before → after | Shared nodes: before → after |
| --- | --- | --- | --- | --- | --- |
| list-equal | 64.51 → 58.51 | 17.78 → 0.12 | 29.29 → 3.73 | 1046617 → 14900 | 4 → 5998 |
| list-shift | 63.60 → 82.15 | 19.81 → 0.46 | 28.21 → 4.71 | 1046667 → 38000 | 2 → 3002 |
| table-equal | 38.87 → 31.14 | 13.18 → 0.10 | 16.88 → 2.14 | 591190 → 8565 | 4 → 3504 |
| table-shift | 40.58 → 48.02 | 11.49 → 0.28 | 18.03 → 2.83 | 591237 → 20156 | 2 → 1759 |
| dynamic-list-equal | 199.45 → 174.49 | 30.99 → 0.22 | 42.75 → 6.10 | 1396442 → 15432 | 5 → 7997 |
| dynamic-list-shift | 196.83 → 201.79 | 27.69 → 0.51 | 44.03 → 9.47 | 1396492 → 38532 | 3 → 4003 |
| dynamic-table-equal | 91.72 → 70.99 | 14.12 → 0.16 | 22.20 → 2.15 | 603521 → 8674 | 5 → 3505 |
| dynamic-table-shift | 84.61 → 83.23 | 12.44 → 0.30 | 19.61 → 2.43 | 603570 → 20267 | 3 → 1760 |
| paragraphs-equal | 7.98 → 8.36 | 0.10 → 0.10 | 1.23 → 1.14 | 11145 → 11184 | 1602 → 1602 |
| list-rewrite | 73.39 → 97.10 | 18.77 → 21.86 | 28.70 → 0.00 | 1090461 → 905965 | 4 → 0 |


In that round, equal-length single-row edits mainly reduced transfer, main-thread patch application and React node replacement. Shift edits must update later ranges and still clone objects; a whole-block rewrite encodes first and then decides to send a full result, so Worker encoding cost may rise. The real-browser measurements in the previous section cannot be replaced by Node handler data for end-to-end latency.

### Real Worker and end-to-end preview

An independent module Worker per input, 2 warmups and 5 measurements. The table isolates React; round-trip includes source and result copying, scheduling and main-thread receipt.

| Scenario | Worker median / P95 ms | Round-trip median / P95 ms | Result |
| --- | --- | --- | --- |
| article-100 | 28.90 / 39.40 | 31.40 / 43.20 | success |
| article-600 | 140.80 / 165.50 | 159.50 / 182.30 | success |
| controls-1000 | 100.80 / 117.50 | 107.30 / 122.60 | success |
| controls-5000 | 383.70 / 613.30 | 415.60 / 638.60 | success |
| controls-10000 | 804.30 / 871.20 | 870.50 / 925.80 | success |
| paragraphs-5000 | 36.40 / 45.80 | 52.40 / 61.70 | success |
| plain-1000000 | 9.00 / 12.50 | 12.80 / 17.80 | success |
| markdown-depth-500 | no successful samples | no successful samples | RangeError |
| markdown-depth-1000 | no successful samples | no successful samples | RangeError |
| markdown-depth-2000 | 4.10 / 5.30 | 4.40 / 5.50 | local.budget.markdown-depth |


Deep Markdown still has separate limits in the browser: the compilation results of the 500- and 1000-level cases trigger a RangeError (call-stack overflow) through native postMessage; 2000 levels is rejected by the depth budget and returns normally. A subsequent ordinary request on the same Worker recovers. A successful Node compilation does not mean the result graph can be cloned and rendered directly in the browser; the public scheduler negotiates `flat-v1` flat results.

**2026-10-29 historical record:** the following comparison uses the same controlled input fixture, a real module Worker and the production React profiling preview, comparing f7a7ab8 with that round's build. 3 warmups and 15 measurements per scenario, with version order alternating for regular scenarios; the dynamic table was re-measured after a pause in before/after order, so time-of-day drift exists. It requires the saved baseline package and was not re-run this round. The fixture isolates compilation and preview; real CM6 typing is measured separately in the next section.

| Scenario | Worker median / P95 ms: before → after | Input-to-frame opportunity ms: before → after | Response median B: before → after |
| --- | --- | --- | --- |
| context | 37.00 / 68.00 → 34.00 / 48.00 | 93.80 / 118.40 → 88.60 / 103.00 | 1428 → 1435 |
| body | 13.00 / 25.00 → 10.00 / 27.00 | 59.70 / 74.70 → 58.40 / 74.40 | 1356 → 1414 |
| paragraphs | 21.00 / 51.00 → 25.00 / 48.00 | 96.00 / 124.80 → 100.30 / 122.90 | 12929 → 12968 |
| list | 80.00 / 113.00 → 71.00 / 109.00 | 238.00 / 271.30 → 136.40 / 187.00 | 1057284 → 14913 |
| table | 46.00 / 65.00 → 31.00 / 52.00 | 134.80 / 173.30 → 89.20 / 115.50 | 599741 → 8584 |
| Dynamic list | 262.00 / 336.00 → 259.00 / 421.00 | 469.30 / 573.80 → 326.60 / 507.60 | 1404760 → 15445 |
| Dynamic table | 124.00 / 220.00 → 115.00 / 377.00 | 233.40 / 398.40 → 170.70 / 450.50 | 608116 → 8685 |


### 2026-10-29 CM6 full editor and rendering phases (historical, not re-run)

That round used the then-current single CM6 editor, the shared author-analysis Worker, the real LocalPreview, a stateful session and native input in the middle. The CM6 editor and its benchmark fixtures have moved to the ReactiveMD-Editor repository. React phases are instrumented only in the benchmark build; the production library does not contain these hooks. Later positions shift as editing grows.

| Scenario | Input-to-frame opportunity median / P95 ms | Input-to-dispatch ms | Worker round-trip ms | Receive and apply ms | Editor render ms | Preview render ms |
| --- | --- | --- | --- | --- | --- | --- |
| paragraphs800 | 107.60 / 191.50 | 23.00 | 51.80 | 6.00 | 8.60 | 6.40 |
| paragraphs2400 | 464.50 / 575.90 | 28.40 | 293.50 | 27.80 | 45.70 | 40.70 |
| table1000 | 429.20 / 510.50 | 23.50 | 331.10 | 4.00 | 17.00 | 14.20 |
| controls1000 | 118.50 / 290.30 | 23.70 | 48.50 | 1.00 | 6.90 | 4.70 |
| controls5000 | 760.50 / 962.20 | 52.40 | 418.70 | 7.20 | 60.40 | 50.20 |


| Scenario | commitRoot ms | DOM mutation ms | Layout Effects ms | Styles ms | Layout ms | Paint ms | Preview article replacements |
| --- | --- | --- | --- | --- | --- | --- | --- |
| paragraphs800 | 17.80 | 1.30 | 2.30 | 4.08 | 6.84 | 4.10 | 0 |
| paragraphs2400 | 78.50 | 4.50 | 12.20 | 17.14 | 17.38 | 8.30 | 0 |
| table1000 | 36.40 | 4.40 | 3.20 | 3.22 | 26.81 | 5.87 | 0 |
| controls1000 | 34.10 | 2.30 | 4.30 | 3.24 | 20.28 | 9.12 | 0 |
| controls5000 | 177.70 | 18.50 | 47.40 | 33.13 | 66.03 | 36.71 | 0 |


Each rendering scenario also checks body/control DOM and focus retention, parameter 13 preserved, author initial values reset, the final commit of fast edits and new-session reset. Long paragraphs additionally check that offscreen text is still findable natively and that printing restores the full layout.

Real CM6 continuous typing, 3 warmups and 15 measurements; source DOM includes the toolbar and author panel.

| Scenario | Characters | Input-to-frame opportunity median / P95 ms | Source DOM | Mounted lines / total lines | Cumulative Layout ms | Long tasks |
| --- | --- | --- | --- | --- | --- | --- |
| paragraphs800 | 101529 | 15.30 / 20.10 | 294 | 47 / 1601 | 230.48 | 0 |
| paragraphs2400 | 306129 | 27.60 / 39.80 | 294 | 47 / 4801 | 423.58 | 16 |
| table1000 | 17949 | 16.80 / 21.10 | 228 | 71 / 1004 | 366.18 | 0 |


CM6 source row DOM grows with the viewport. The preview keeps the document DOM, and later ordinary paragraphs use content-visibility:auto; this is not whole-area virtualization of the preview. Huge lists, tables and complex visualizations can still bear whole-block DOM, layout and paint costs.

### Runtime, formula and visualization updates

This group is a Vite development fixture, 5 warmups and 15 measurements; it separates runtime.set, three-curve sampling, React updates, forced layout and local dependency scope, and cannot be compared directly with the production React profiling numbers above.

| Phase | Median ms | P95 ms |
| --- | --- | --- |
| compile:interactive-article | 22.1000 | 27.6000 |
| update:runtime-set | 0.0008 | 0.0021 |
| plot:3-curves-200-samples | 0.2850 | 0.4600 |
| render:final | 7.5000 | 22.7000 |
| interaction:update-plot-render | 11.2000 | 14.2000 |
| locality:100-sections | 8.3000 | 25.8000 |
| locality:1-section | 4.3000 | 5.9000 |
| locality:unreferenced | 9.7000 | 11.9000 |
| visuals:10-tables | 9.2000 | 20.6000 |
| visuals:1-table | 4.4000 | 6.9000 |
| visuals:unreferenced | 3.7000 | 5.6000 |
| charts:4-charts | 8.6000 | 13.7000 |
| charts:1-chart | 5.1000 | 6.6000 |
| charts:unreferenced | 3.2000 | 4.2000 |


### Sustained-edit memory, budgets and protocol recovery

Node uses independent child processes and performs an explicit GC before each snapshot. The previous version's preview stays alive until the replacement result completes; the heap is measured after results and sessions are released.

| Scenario | Count / scale | Retained heap after GC MiB | After releasing session MiB | Steady-state heap growth MiB |
| --- | --- | --- | --- | --- |
| longEdit | 500 | 25.615 | 17.316 | 0.302 |
| longRows | 500 | 24.663 | 13.721 | 0.175 |
| cacheEviction | 260 | 25.710 | 19.179 | n/a |
| rapidCancel | 120 | 24.262 | 15.328 | n/a |
| longText | 1000000 | 13.756 | 13.741 | n/a |
| manyComponents | 5000 controls / 352779 characters | 29.973 | 15.056 | n/a |
| deepContainers | 1000/1001 levels | n/a | 13.029 | n/a |


**2026-10-29 historical record:** CM6 main-thread heap, with the probe array cleared and GC through CDP while host compilation state stays mounted; Worker heap not measured. This data depends on the split editor repository and was not re-measured this round:

| Checkpoint | Heap after GC MiB | Source DOM |
| --- | --- | --- |
| edit-50 | 13.14 | 74 |
| edit-2000 | 14.47 | 74 |
| editor-unmounted-host-retained | 13.31 | 0 |


The protocol re-measurement passed the old Worker, out-of-order responses, a stale baseline, corrupted patches, option switching, cancelled preparation and consecutive concurrent commits; page errors were empty. The stale baseline and corrupted patch each recover with one full request; cost selection returns a full success result directly rather than retrying after a failure. The public LocalReactiveDocument commits the correct document after a pausable, interruptible React transition and preserves input values; both the interrupted and final commits kept the value 13. The 2026-10-29 round additionally edited one row in huge static and dynamic lists and tables in a real browser; the preview DOM of unchanged rows kept the same object and the input value stayed 13.

### Current limits and where to optimize next

- In the public snapshot path for 5000 ordinary short paragraphs, a session edit takes 81.39 ms, slower than full compilation at 70.04 ms. Sharing and full snapshot publishing still cost the whole tree; the public snapshot and the Worker's private sharing path should be optimized separately.
- The 2026-10-29 full matrix showed tail regressions for dynamic tables and lists, and that round's browser comparison improved median and P95. In this re-measurement, list shift edits are still slower than equal-length edits; continue tracking how allocation and GC affect the tail.
- Simple dynamic interpolation rows are on the fast path. Dynamic blocks containing links, escapes or complex inline formatting can still fall back; the next step can study local updates to row-fragment parsing and semantic summaries, continuing to validate with full-result diffs.
- Shift edits in large lists and tables relocate many ranges; patch encoding and cost estimation for whole-block rewrites can still increase Worker time, so reduce duplicate traversal before encoding first. In this re-measurement, rejecting a 50000-item over-budget list took about 349 ms, so the traversal before rejection is worth analyzing.
- CM6 still synchronizes with the host through a full source string, and author analysis also produces a whole result; long single lines, very long strings and large dependency graphs still involve linear work.
- The preview is suited to further row-level and block-level subscriptions and to viewport-deferred visualization. Before truly unmounting offscreen preview, state, anchors, native find, cross-block selection and printing must be preserved.
- Default depth budgets remain Markdown 1000 levels and components 100 levels. Deep results transfer after negotiating `flat-v1` through the public scheduler; custom Workers that hand deep `compileLocal()` results directly to native `postMessage()` are still limited by the browser call stack. Deep results currently send a complete flat snapshot each time; subtree patches can be studied later. Physical Chinese IME, mobile keyboards and assistive technology need manual acceptance on target devices.

### Reproduce and verify

Full serial matrix (stages runnable in this repository):

```powershell
npm run build
node scripts/benchmark-performance-overview.mjs --skip=render,cm6
# Add a comparison when a saved old production package exists:
node scripts/benchmark-performance-overview.mjs --skip=render,cm6 --baseline=artifacts/next-editing/before-library
# Re-measure by phase; do not run other performance processes at the same time:
node scripts/benchmark-performance-overview.mjs --only=compiler,blocks,parser,fast,incremental,memory,rows,worker,protocol,stages
```

This round covers compilation stress, 24 block types, mixed parsing, context recovery, snapshot copying, row reuse, Node and browser memory, Worker transfer, protocol recovery, runtime stages, table/chart dependency locality and plot sampling. Native CM6 input, React rendering phases and the f7a7ab8 baseline comparison depend on the split demo/editor repositories or a baseline package that was not retained, so they were not included.

Functional gates passed by the 2026-10-29 `4a8f1ea` matrix: production build, type checking, standalone and declaration generation, public package boundaries and offline packed consumption; 1504 tests in 112 core test files and 254 tests in 16 Demo files; 8 browser checks of the unified editor, plus CM6, real workbench, author tools, images, diagnostics, document save/export and long-document preview regressions.

The 2026-10-29 rendering semantic diff completed 350 steps of state, selection, reset, language and Tab operations with an identical final state; the optimized and baseline normalized markup are both 45806 characters and byte-identical, and page and console errors are empty. This round ran `npm run build` (type checking, production/standalone/declaration builds) successfully but did not re-run the full test gates.

This round's per-sample JSON is in `artifacts/performance-overview-run2/`; it is a locally ignored artifact. The committable condensed summary is `benchmarks/performance-overview-2026-11-20.json`, which retains the measurement basis, code provenance and package hashes. The 2026-10-29 round's per-sample artifacts are in `artifacts/performance-overview/`, `artifacts/render-pipeline/` and `artifacts/cm6/`, with summaries in `benchmarks/performance-overview-2026-10-29.json` and `benchmarks/dynamic-depth-2026-10-29.json`. The original historical reports can be read from the corresponding Git commits.
