# One-shot compilation

**English** · [中文](compiler-ch.md)

ReactiveMD provides minimal and standard one-shot compiler entries. They return plain data for a host to run or render.

```ts
import { createCompiler } from 'reactive-md/compiler';
import { createStandardCompiler } from 'reactive-md/compiler/standard';

const compiler = createCompiler();
const result = compiler.compile('# Notes\n\nOrdinary Markdown.');

const standard = createStandardCompiler();
const interactive = standard.compile('<number bind="count" label="Count" initial="2">\n\n{{ count * 3 }}');

if (interactive.ok) {
  console.log(interactive.document.initialState.count);
}
```

`createCompiler` registers no components by default. `createStandardCompiler` installs the default component preset and the existing KaTeX display checks. Both enforce source, expression, structure and resource limits and preserve original UTF-16 source ranges. Compilation creates no editing session, Worker or runtime and loads no React, theme implementation or CSS. Theme declarations retain a name and source range; the host loads theme resources.

Use standard with the existing React/SSR hosts. The minimal entry reads `config.components`; `config.presets` does not implicitly install the default preset. Extensions that depend on default components need standard. A minimal result has its own `componentConfigKey`, so passing it to the existing renderer with its default configuration reports `local.extension.config-mismatch`. Host configurations without a preset are a later integration step.

Factories accept `LocalCompileOptions`, validate them at creation and retain a snapshot of the effective configuration. Invalid configuration throws `CompilerConfigurationError`. Results use `status: 'valid' | 'recovered' | 'failed'` and retain the task-one `ok/document/diagnostics` read path. Success also includes an independently frozen `program`, recovery records and optional-check coverage. Failure contains no program. Each call compiles its own source without reusing a previous call's bindings, diagnostics or nodes.

In loose mode, each finalized recovery produces at most one warning at `causeRange` with the same stable `code`, explaining the literal fallback or HTML repair. Warnings use the existing diagnostics budget; when it is full, a warning may be omitted while the record remains in `recoveries`. `valid` has no recovery warning; a `recovered` success includes the program and those warnings. Unrecoverable semantic, type, binding, option, version and budget errors remain errors: invalid factory configuration throws `CompilerConfigurationError`, and compile-time errors return `failed`. A failed result may include warnings from completed recoveries alongside the error that caused failure. Strict mode remains the default with its existing diagnostic shape. Recovery fields and public result types are unchanged, and the recovery strategy identity version is 2.

The root `compileLocal(source, options)` entry, editing sessions and Workers keep strict semantics by default and retain their existing result types. Results include `recoveries` and their warnings when present. Pass `strict: false` to enable [local recovery](local-integration-en.md#strict-parsing-and-local-recovery).

One-shot entries always compile a final document: `compileLocal`, `createCompiler().compile` and `createStandardCompiler().compile` do not own a streaming lifecycle, never return `status: 'partial'` or transient diagnostics, and the `sourcePhase` option does not turn them into streaming entries. Submit source that is still being generated through `createLocalCompileSession()`, `LocalCompileScheduler`, a Worker or `LocalReactiveDocument`; see [Streaming source compilation](local-integration-en.md#streaming-source-compilation).

The minimal entry keeps CommonMark, RMD structure, expressions, bindings and budgets. Author capability switches are independent of RMD parsing and bindings. Use the standard or compatibility entry for native HTML fragment parsing and sanitization, GFM, Lezer block planning, KaTeX and plot formula semantics. The minimal runtime and declaration graphs exclude `parse5`, `@lezer/markdown`, `remark-gfm`, KaTeX, the default preset and its authoring copy.

## Incremental sessions and source scanning

Two narrow subpaths serve chat-style hosts that keep one document open and draw their own markers. `reactive-md/compiler` and `reactive-md/compiler/standard` keep their one-shot contracts unchanged.

### `reactive-md/compiler/session`

Exports `createLocalCompileSession`, `LocalCompileSession`, the `LocalIncrementalStats` type and `localCompileOptionsKey`. Keep one session per document, compile each snapshot, and dispose the session when the document closes. Unchanged Markdown blocks are reused between updates.

```ts
import { createLocalCompileSession, localCompileOptionsKey } from 'reactive-md/compiler/session';

const session = createLocalCompileSession();
const optionsKey = localCompileOptionsKey({ strict: false });
const first = session.compile('<number bind="count" label="Count" initial="1">\n\nTotal: {{ count }}', undefined, 'final');
const next = session.compile('<number bind="count" label="Count" initial="2">\n\nTotal: {{ count }}', undefined, 'final');
console.log(first.status, next.status, session.stats.mode, optionsKey);
session.dispose();
```

Cache identity still combines the source, the compile option key and the component configuration key. The session may load the parser and the standard compile assembly because it compiles complete documents. It loads no React, CSS, DOM globals, Worker scheduling, or authoring service, catalog or command modules. The standard assembly may carry preset authoring data such as localized titles, keywords and insertion text.

### `reactive-md/scan`

Exports `analyzeLocalSource` with the read-only `AuthorToken`, `AuthorBinding` and `AuthorAnalysis` types. Ranges are UTF-16 offsets into the submitted source, so a host can place markers beside the same text the compiler reads.

```ts
import { analyzeLocalSource } from 'reactive-md/scan';

const source = '<number bind="count" label="Count" initial="2">\n\nTotal: {{ count }}';
const analysis = analyzeLocalSource(source);
for (const marker of analysis.tokens) console.log(marker.kind, marker.range.start, marker.range.end);
for (const binding of analysis.bindings) console.log(binding.name, binding.declarations, binding.references);
```

The entry returns data only. Completion, rename, formatting, insertion templates, catalog and toolbar commands remain in `reactive-md/authoring`. `analyzeLocalSource(source, options, { diagnostics: false })` skips the compiler diagnostic pass when the host already reports them. The scan graph may include the pure parser, source ranges, compile options, diagnostics and preset authoring data; it excludes the catalog and command services, React, CSS and the incremental session.

After building, run `npm run test:compiler-entry` to check direct ESM imports, production chunks, declaration dependencies and browser consumption. Run `npm test -- tests/compiler-entry.test.ts` for source behavior checks.
