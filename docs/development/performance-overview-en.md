# Performance optimization and current measurement overview

Re-tested 2026-10-29. The full matrix records the row reuse, patch cost selection and CM6 single-editor migration of commit `4a8f1ea`; this round continues optimizing dynamic interpolation rows and deep nesting on top of that commit, with the targeted re-measurements listed separately in part two. The package version is still 0.6.1, and this round has not been released.

## 1. Direction and outcome of each optimization round

The records below are as of each optimization. Cold compilation, steady-state editing and input-to-frame opportunity use different bases, so these numbers cannot be chained into a single speedup ratio. The full matrix and this round's targeted re-measurements are in part two.


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

Node v22.17.0, Intel(R) Core(TM) Ultra 5 125H, Windows x64. Node stress scenarios use independent processes with a 1 GiB old-generation cap; the browser is Edge 135.0.3179.66 in headless mode at a 1440×1000 viewport. Daily development processes remain running on the machine; power policy and CPU frequency were not pinned. Performance scripts run serially.

Typically 3 warmups and 15 measurements; the long-line and dedicated over-budget cases use 5/3, and the independent browser Worker uses 2 warmups and 5 measurements; the summary data is authoritative. P95 uses the nearest rank, which equals the maximum sample at 15 samples and is used only to observe the tail. First calls, public snapshot copies, shared Worker results and main-thread rendering are recorded separately.

RSS is the process high-water mark and includes Node, modules, input and temporary objects; the post-GC heap is the retained amount, and the two are not interchangeable. JSON UTF-8 message size is an estimate; structured-clone cost is measured separately. Input-to-preview ends at the second requestAnimationFrame frame opportunity after commit; CDP Paint is a paint-phase event, and neither indicates GPU display completion. React phases overlap and cannot be summed.

### This round's targeted re-measurement of dynamic rows and deep nesting

The baseline is the `4a8f1ea` production package saved at the start of this round, and post-change data comes from the final build; code hashes and condensed results are in `benchmarks/dynamic-depth-2026-10-29.json`. This round re-measured dynamic lists, dynamic tables, deep containers, protocol recovery and sustained-edit memory. The complete 45-scenario matrix and the other overview tables below retain the `4a8f1ea` measurements.

Each browser group uses 3 warmups and 15 measurements. Before-change samples are retained from this round's first paired measurement, and after-change samples were re-measured on the final build. The table shows median/P95 in ms. Input is driven by an independent textarea fixture to compare the Worker-to-React preview path; CM6 and deep preview get separate real-browser functional verification.

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

This batch's Node shift list regressed; a separate new-process comparison gave 324/508 → 124/255 ms. Both batches show clear jitter, so all raw results are kept and this round computes no unified speedup ratio. The browser table uses final-build measurements.

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

This round's gates: 116 core test files with 1534 tests and 16 Demo files with 254 tests pass; type checking, production/standalone/declaration builds, Demo builds, public package checks and offline packed consumption pass; documentation links and `git diff --check` pass. The deep stress unit tests set a separate 30-second timeout, and performance statistics come from production-package scripts.

Reproduce the targeted tests:

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

### Full compilation and extreme input (4a8f1ea, 45 scenarios)

Calls the public compileLocal; timing includes final result construction and excludes input generation, checking and GC. The node budget defaults to 10000; scenarios marked raised use 250000. Character counts are UTF-16 code units. Budget rejections are listed separately as expected outcomes, and all scenarios should exit normally.


| Scenario ID | Characters | Result / nodes | First ms | Steady-state median / P95 ms | First-call peak RSS MiB |
| --- | --- | --- | --- | --- | --- |
| plain-10000 | 10000 | success / 2 | 4.32 | 0.10 / 0.72 | 63.94 |
| plain-100000 | 100000 | success / 2 | 7.64 | 0.52 / 1.10 | 63.98 |
| plain-500000 | 500000 | success / 2 | 10.21 | 2.43 / 3.12 | 63.95 |
| plain-1000000 | 1000000 | success / 2 | 12.26 | 5.15 / 8.02 | 64.05 |
| plain-1000001 | 1000001 | local.budget.document | 1.13 | 0.02 / 0.05 | 63.98 |
| article-10 | 1598 | success / 161 | 45.67 | 6.94 / 16.27 | 65.85 |
| article-100 | 15550 | success / 1601 | 139.84 | 37.77 / 62.57 | 82.30 |
| article-600 | 94050 | success / 9601 | 479.75 | 301.98 / 369.22 | 138.63 |
| article-2000 | 315852 | local.budget.nodes | 889.29 | 781.91 / 864.21 | 175.77 |
| article-2000-raised | 315852 | success / 32001 | 1180.89 | 1105.17 / 1300.44 | 194.27 |
| controls-1000 | 68779 | success / 1000 | 224.98 | 136.66 / 160.26 | 113.53 |
| controls-5000 | 352779 | success / 5000 | 826.41 | 622.27 / 791.14 | 201.92 |
| controls-10000 | 707779 | success / 10000 | 1392.64 | 1647.63 / 2294.73 | 330.71 |
| controls-10001 | 707852 | local.budget.nodes | 170.43 | 120.53 / 131.25 | 108.06 |
| controls-12000 | 853779 | local.budget.nodes | 190.92 | 141.34 / 155.13 | 112.27 |
| controls-10000-raised | 707779 | success / 10000 | 1398.86 | 1414.88 / 1677.35 | 330.30 |
| controls-12000-raised | 853779 | success / 12000 | 1596.10 | 1780.85 / 2404.79 | 373.24 |
| shared-controls-5000 | 270000 | success / 5000 | 698.38 | 544.15 / 602.56 | 204.18 |
| conflicting-controls-5000 | 329999 | local.initial.duplicate-peers | 658.93 | 537.97 / 731.30 | 195.88 |
| expressions-1000 | 21960 | success / 4001 | 309.11 | 155.26 / 180.70 | 120.70 |
| expressions-5000 | 113960 | local.budget.nodes | 872.52 | 683.96 / 750.02 | 199.67 |
| expressions-5000-raised | 113960 | success / 20001 | 1026.15 | 864.84 / 979.29 | 213.87 |
| paragraphs-1000 | 6000 | success / 2000 | 22.82 | 8.46 / 14.96 | 66.13 |
| paragraphs-5000 | 30000 | success / 10000 | 74.83 | 53.12 / 65.57 | 83.64 |
| paragraphs-10000 | 60000 | local.budget.nodes | 9.50 | 1.64 / 2.45 | 64.39 |
| paragraphs-20000 | 120000 | local.budget.nodes | 10.95 | 2.21 / 3.88 | 64.65 |
| paragraphs-100000 | 600000 | local.budget.nodes | 18.03 | 8.11 / 12.06 | 66.54 |
| paragraphs-100000-raised | 600000 | success / 200000 | 1889.73 | 1791.24 / 1971.32 | 300.19 |
| formatted-paragraphs-5000 | 285000 | local.budget.nodes | 614.75 | 510.08 / 655.62 | 172.16 |
| formatted-paragraphs-5000-raised | 285000 | success / 40000 | 890.59 | 739.60 / 882.25 | 191.44 |
| containers-50 | 956 | success / 52 | 122.90 | 34.50 / 40.75 | 76.79 |
| containers-100 | 1906 | success / 102 | 229.97 | 112.17 / 126.17 | 79.36 |
| containers-101 | 1925 | local.tag.unclosed.pair, local.budget.nesting | 221.91 | 107.99 / 114.28 | 79.77 |
| containers-1000 | 19006 | local.tag.unclosed.pair, local.budget.nesting | 2316.23 | 2345.12 / 3270.82 | 135.50 |
| unclosed-1000 | 9004 | local.tag.unclosed.pair, local.budget.nesting | 1170.57 | 1156.87 / 1294.90 | 138.63 |
| markdown-depth-100 | 204 | success / 102 | 17.64 | 2.62 / 4.26 | 63.98 |
| markdown-depth-500 | 1004 | success / 502 | 34.16 | 6.71 / 13.08 | 66.80 |
| markdown-depth-1000 | 2004 | success / 1002 | 60.56 | 16.72 / 27.48 | 77.02 |
| markdown-depth-1500 | 3004 | local.budget.markdown-depth | 20.03 | 1.84 / 5.85 | 63.91 |
| markdown-depth-2000 | 4004 | local.budget.markdown-depth | 18.98 | 1.82 / 3.34 | 65.48 |
| markdown-depth-5000 | 10004 | local.budget.markdown-depth | 37.84 | 3.45 / 6.32 | 71.81 |
| math-1000 | 16000 | success / 2000 | 349.64 | 181.27 / 291.72 | 112.90 |
| table-1000 | 28910 | success / 5008 | 445.32 | 267.54 / 341.15 | 136.33 |
| computed-chain-1000 | 45839 | success / 3 | 226.52 | 120.62 / 148.63 | 115.39 |
| computed-chain-5000 | 237839 | success / 3 | 803.20 | 663.79 / 871.36 | 201.66 |


### Long-document editing across block types (24 scenarios)

The same target block sits among 1000 ordinary paragraphs; version numbers have fixed width, and the fenced-delimiter scenario actively changes the boundary. Independent process per scenario, alternating full compilation and session compilation order. The table includes the cost of publishing an independent public snapshot; syntax highlighting, plot sampling and DOM layout are outside this table.

| Target block | Single-block full ms | Long-document full ms | Session median / P95 ms | Final mode | Reused blocks |
| --- | --- | --- | --- | --- | --- |
| Ordinary paragraph, about 512 characters | 0.09 | 7.88 | 13.86 / 20.54 | incremental | 1000 |
| Ordinary paragraph, about 8 Ki characters | 0.38 | 7.53 | 13.07 / 15.19 | incremental | 1000 |
| Formatted paragraph, about 512 characters | 2.65 | 29.61 | 14.93 / 18.71 | incremental | 1000 |
| Level-2 heading, about 80 characters | 0.69 | 27.80 | 12.83 / 17.66 | incremental | 1000 |
| Unordered list, 20 items | 0.89 | 12.28 | 13.70 / 18.27 | incremental | 1000 |
| Unordered list, 100 items | 3.15 | 14.58 | 17.37 / 21.99 | incremental | 1000 |
| Ordered list, 20 items | 0.89 | 11.76 | 13.45 / 15.81 | incremental | 1000 |
| Markdown table, 20×4 | 1.64 | 11.39 | 14.08 / 17.66 | incremental | 1000 |
| Markdown table, 100×4 | 4.66 | 15.97 | 22.32 / 27.41 | incremental | 1000 |
| Markdown table, 200×4 | 8.97 | 20.18 | 30.39 / 44.42 | incremental | 1000 |
| Blockquote, 10 paragraphs | 1.85 | 29.70 | 13.66 / 17.28 | incremental | 1000 |
| Fenced code, 60 lines | 0.85 | 30.35 | 14.39 / 18.90 | incremental | 1000 |
| Fenced code, 300 lines | 2.78 | 29.67 | 13.83 / 18.49 | incremental | 1000 |
| Indented code, 60 lines | 1.21 | 66.05 | 14.42 / 22.71 | incremental | 1000 |
| Display formula, 20 items | 3.42 | 51.20 | 15.18 / 22.10 | incremental | 1000 |
| Display formula, 80 items | 6.65 | 54.16 | 18.03 / 23.94 | incremental | 1000 |
| Expression paragraph, 20 interpolations | 2.92 | 48.98 | 14.66 / 22.29 | incremental | 1000 |
| Slider initial value change | 0.90 | 49.82 | 53.89 / 84.76 | full | 0 |
| Panel interior, 50 paragraphs | 3.22 | 48.92 | 47.80 / 58.14 | full | 0 |
| ReactiveMD table, 20×4 | 3.05 | 49.69 | 55.93 / 70.05 | full | 0 |
| Bar chart data, 20 rows | 2.23 | 47.79 | 53.12 / 90.45 | full | 0 |
| Plot formula, 1 curve | 1.62 | 49.35 | 54.03 / 74.35 | full | 0 |
| Diagram node body, 20 nodes | 6.24 | 49.13 | 53.47 / 89.76 | full | 0 |
| Fenced delimiter change, 60 lines of code | 1.27 | 28.70 | 39.01 / 49.05 | full | 0 |


### Fast/general mixed parsing and long lines

Covers simple blocks interleaved with links and escapes, native and component tables, dynamic cells, 5000 controls, very long indented lines inside containers, and large over-budget lists.

| Scenario | Median / P95 ms | Process peak RSS MiB |
| --- | --- | --- |
| ordinary-1000 | 10.63 / 14.03 | 101.95 |
| mixed-80 | 32.65 / 42.82 | 164.93 |
| table-1000 | 45.24 / 56.52 | 174.41 |
| component-table-500 | 35.50 / 44.30 | 152.65 |
| component-dynamic-table-500 | 100.19 / 129.04 | 191.91 |
| controls-5000 | 490.59 / 591.58 | 533.31 |
| indented-line-16000 | 5.85 / 7.94 | 73.05 |
| indented-line-64000 | 6.60 / 17.72 | 74.18 |
| indented-line-256000 | 25.82 / 29.74 | 71.91 |
| over-budget-list-50000 | 54.54 / 55.79 | 212.41 |


Cache recovery of an independent body after 200 consecutive component-context changes:

| Context edit median / P95 ms | Index rebuilds during consecutive changes | Restore body ms | Index builds during restore |
| --- | --- | --- | --- |
| 42.15 / 82.14 | 0 | 121.50 | 1 |


Full compilation scale for pure blocks:

| Scenario | Median / P95 ms | Peak RSS MiB |
| --- | --- | --- |
| bullet-100 | 3.12 / 5.09 | 77.60 |
| bullet-500 | 16.45 / 21.92 | 115.81 |
| bullet-1500 | 55.05 / 75.23 | 174.01 |
| table-100 | 4.33 / 10.23 | 80.65 |
| table-500 | 21.36 / 28.69 | 118.31 |
| table-1000 | 54.18 / 71.87 | 185.18 |
| component-table-100 | 7.05 / 14.13 | 99.87 |
| component-table-500 | 33.44 / 46.50 | 136.01 |


Full compilation versus session editing in the same build, including full snapshot publishing:

| Document | Full median ms | Session median ms | First session ms | Compiled / reused blocks |
| --- | --- | --- | --- | --- |
| paragraphs-5000 | 44.59 | 64.33 | 220.07 | 1 / 4999 |
| formatted-paragraphs-1000 | 119.28 | 51.92 | 296.79 | 1 / 999 |
| article-600 | 282.14 | 62.05 | 546.19 | 1 / 1799 |
| article-2000 | 908.57 | 223.06 | 1511.52 | 1 / 5999 |


### This round's row reuse and patch cost A/B

The baseline is the saved f7a7ab8 production package. One session per scenario, 3 warmups and 15 measurements. The production Worker handler runs inside Node; responses are applied only after structuredClone. Worker timing excludes cross-thread transfer; the clone column is local copy time. equal is a fixed-length middle edit, shift alternately adds and removes characters and shifts later ranges, and rewrite changes every row.

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


Equal-length single-row edits mainly reduce transfer, main-thread patch application and React node replacement. Shift edits must update later ranges and still clone objects; a whole-block rewrite encodes first and then decides to send a full result, so Worker encoding cost may rise. The real-browser measurements below cannot be replaced by Node handler data for end-to-end latency.

### Real Worker and end-to-end preview

An independent module Worker per input, 2 warmups and 5 measurements. The table isolates React; round-trip includes source and result copying, scheduling and main-thread receipt.

| Scenario | Worker median / P95 ms | Round-trip median / P95 ms | Result |
| --- | --- | --- | --- |
| article-100 | 33.20 / 38.60 | 35.90 / 40.80 | success |
| article-600 | 178.30 / 214.70 | 193.20 / 228.00 | success |
| controls-1000 | 66.90 / 88.80 | 70.30 / 92.90 | success |
| controls-5000 | 371.90 / 433.70 | 392.90 / 453.30 | success |
| controls-10000 | 717.40 / 758.60 | 763.40 / 795.60 | success |
| paragraphs-5000 | 33.50 / 41.00 | 45.70 / 53.30 | success |
| plain-1000000 | 4.30 / 7.90 | 7.90 / 11.30 | success |
| markdown-depth-500 | no successful samples | no successful samples | transfer-error |
| markdown-depth-1000 | 10.80 / 21.80 | 11.00 / 23.00 | local.parse |
| markdown-depth-2000 | 2.70 / 3.80 | 3.00 / 4.10 | local.budget |


Deep Markdown still has separate limits in the browser: the compilation result of the 500-level case may not be postMessage-able; 1000 levels returns a parse failure in that browser, and 2000 levels is rejected by the depth budget. A subsequent ordinary request on the same Worker recovers. A successful Node compilation does not mean the result graph can be cloned and rendered in the browser.

The following uses the same controlled input fixture, a real module Worker and the production React profiling preview, comparing f7a7ab8 with this round. 3 warmups and 15 measurements per scenario, with version order alternating for regular scenarios; the dynamic table was re-measured after a pause in before/after order, so time-of-day drift exists. The fixture isolates compilation and preview; real CM6 typing is measured separately in the next section.

| Scenario | Worker median / P95 ms: before → after | Input-to-frame opportunity ms: before → after | Response median B: before → after |
| --- | --- | --- | --- |
| context | 37.00 / 68.00 → 34.00 / 48.00 | 93.80 / 118.40 → 88.60 / 103.00 | 1428 → 1435 |
| body | 13.00 / 25.00 → 10.00 / 27.00 | 59.70 / 74.70 → 58.40 / 74.40 | 1356 → 1414 |
| paragraphs | 21.00 / 51.00 → 25.00 / 48.00 | 96.00 / 124.80 → 100.30 / 122.90 | 12929 → 12968 |
| list | 80.00 / 113.00 → 71.00 / 109.00 | 238.00 / 271.30 → 136.40 / 187.00 | 1057284 → 14913 |
| table | 46.00 / 65.00 → 31.00 / 52.00 | 134.80 / 173.30 → 89.20 / 115.50 | 599741 → 8584 |
| Dynamic list | 262.00 / 336.00 → 259.00 / 421.00 | 469.30 / 573.80 → 326.60 / 507.60 | 1404760 → 15445 |
| Dynamic table | 124.00 / 220.00 → 115.00 / 377.00 | 233.40 / 398.40 → 170.70 / 450.50 | 608116 → 8685 |


### Current CM6 full editor and rendering phases

Uses the current single CM6 editor, the shared author-analysis Worker, the real LocalPreview, a stateful session and native input in the middle. React phases are instrumented only in the benchmark build; the production library does not contain these hooks. Later positions shift as editing grows.

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
| compile:interactive-article | 31.1000 | 38.8000 |
| update:runtime-set | 0.0004 | 0.0016 |
| plot:3-curves-200-samples | 0.2800 | 0.3750 |
| render:final | 6.7000 | 29.3000 |
| interaction:update-plot-render | 8.8000 | 17.4000 |
| locality:100-sections | 11.8000 | 43.2000 |
| locality:1-section | 4.1000 | 16.3000 |
| locality:unreferenced | 10.5000 | 16.2000 |
| visuals:10-tables | 10.6000 | 29.5000 |
| visuals:1-table | 4.7000 | 6.6000 |
| visuals:unreferenced | 2.1000 | 2.7000 |
| charts:4-charts | 13.4000 | 19.3000 |
| charts:1-chart | 7.1000 | 8.8000 |
| charts:unreferenced | 1.9000 | 4.0000 |


### Sustained-edit memory, budgets and protocol recovery

Node uses independent child processes and performs an explicit GC before each snapshot. The previous version's preview stays alive until the replacement result completes; the heap is measured after results and sessions are released.

| Scenario | Count / scale | Retained heap after GC MiB | After releasing session MiB | Steady-state heap growth MiB |
| --- | --- | --- | --- | --- |
| longEdit | 500 | 22.242 | 15.466 | 0.156 |
| longRows | 500 | 20.658 | 11.61 | 0.13 |
| cacheEviction | 260 | 20.75 | 15.235 | not applicable |
| rapidCancel | 120 | 19.12 | 13.256 | not applicable |
| longText | 1000000 | 12.182 | 12.17 | not applicable |
| manyComponents | 5000 controls / 352779 characters | 29.485 | 13.189 | not applicable |
| deepContainers | 1000/1001 levels | not applicable | 11.338 | not applicable |


CM6 main-thread heap, with the probe array cleared and GC through CDP while host compilation state stays mounted; Worker heap not measured:

| Checkpoint | Heap after GC MiB | Source DOM |
| --- | --- | --- |
| edit-50 | 13.14 | 74 |
| edit-2000 | 14.47 | 74 |
| editor-unmounted-host-retained | 13.31 | 0 |


Protocol recovery re-measurement passed the old Worker, out-of-order responses, a stale baseline, corrupted patches, option switching and cancelled preparation tasks. The stale baseline and corrupted patch each recover with one full request; cost selection returns a full success result directly rather than retrying after a failure. The public LocalReactiveDocument commits the correct document after a pausable, interruptible React transition and preserves input values. Huge static and dynamic lists and tables each received a real-browser single-row edit; the preview DOM of unchanged rows kept the same object and the input value stayed 13.

### Current limits and where to optimize next

- In the public snapshot path for 5000 ordinary short paragraphs, a session edit takes 64.33 ms, slower than full compilation at 44.59 ms. Sharing and full snapshot publishing still cost the whole tree; the public snapshot and the Worker's private sharing path should be optimized separately.
- The previous round's full matrix showed tail regressions for dynamic tables and lists. This round's browser comparison improved median and P95, but Node shift lists still regress in batches; continue tracking how allocation and GC affect the tail.
- Simple dynamic interpolation rows are on the fast path. Dynamic blocks containing links, escapes or complex inline formatting can still fall back; the next step can study local updates to row-fragment parsing and semantic summaries, continuing to validate with full-result diffs.
- Shift edits in large lists and tables relocate many ranges; patch encoding and cost estimation for whole-block rewrites can still increase Worker time, so reduce duplicate traversal before encoding first.
- CM6 still synchronizes with the host through a full source string, and author analysis also produces a whole result; long single lines, very long strings and large dependency graphs still involve linear work.
- The preview is suited to further row-level and block-level subscriptions and to viewport-deferred visualization. Before truly unmounting offscreen preview, state, anchors, native find, cross-block selection and printing must be preserved.
- Default depth budgets remain Markdown 1000 levels and components 100 levels. Deep results transfer after negotiating `flat-v1` through the public scheduler; custom Workers that hand deep `compileLocal()` results directly to native `postMessage()` are still limited by the browser call stack. Deep results currently send a complete flat snapshot each time; subtree patches can be studied later. Physical Chinese IME, mobile keyboards and assistive technology need manual acceptance on target devices.

### Reproduce and verify

Full serial matrix:

```powershell
npm run build
npm run build --workspace=@reactive-md/demo
node scripts/benchmark-performance-overview.mjs
# Add a comparison when a saved old production package exists:
node scripts/benchmark-performance-overview.mjs --baseline=artifacts/next-editing/before-library
# Re-measure by phase; do not run other performance processes at the same time:
node scripts/benchmark-performance-overview.mjs --only=render,cm6
```

The full matrix covers compilation stress, 24 block types, mixed parsing, context recovery, snapshot copying, row reuse, Node and browser memory, Worker transfer, protocol recovery, native CM6 input, React phases, table/chart dependency locality and plot sampling. The default CM6 memory check is 2000 inputs.

Functional gates passed by the full `4a8f1ea` matrix: production build, type checking, standalone and declaration generation, public package boundaries and offline packed consumption; 1504 tests in 112 core test files and 254 tests in 16 Demo files; 8 browser checks of the unified editor, plus CM6, real workbench, author tools, images, diagnostics, document save/export and long-document preview regressions.

The rendering semantic diff completed 350 steps of state, selection, reset, language and Tab operations with an identical final state; the optimized and baseline normalized markup are both 45806 characters and byte-identical, and page and console errors are empty.

The full matrix's per-sample JSON, event records and CDP traces are in `artifacts/performance-overview/`, `artifacts/render-pipeline/` and `artifacts/cm6/`, and this round's targeted results are in `artifacts/dynamic-depth/`; all are locally ignored artifacts. The committable condensed summaries are `benchmarks/performance-overview-2026-10-29.json` and `benchmarks/dynamic-depth-2026-10-29.json`, each retaining its measurement basis and code provenance. The original historical reports can be read from the corresponding Git commits.
