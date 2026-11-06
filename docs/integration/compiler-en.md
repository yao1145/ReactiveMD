# One-shot compilation

**English** · [中文](compiler-ch.md)

The current workspace adds two compiler entries. They return plain data for a host to run or render. These changes have not been published to npm.

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

The root `compileLocal(source, options)` entry, editing sessions and Workers keep strict semantics by default and retain their existing result types. Results include `recoveries` and their warnings when present. Pass `strict: false` to enable [local recovery](../reference/tolerance-en.md).

This delivery establishes the independent M1 compilation path. The Markdown frontend still loads Lezer, GFM and parse5; standard display checks load KaTeX. Shared helpers retain fallback default component definitions, and declarations can still reach existing SDK theme protocol types. Capability splitting, full declaration isolation and removal of the remaining implicit preset dependencies belong to M4.

After building, run `npm run test:compiler-entry` to check direct ESM imports, production chunks, declaration dependencies and browser consumption. Run `npm test -- tests/compiler-entry.test.ts` for source behavior checks.
