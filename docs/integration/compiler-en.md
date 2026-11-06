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

The minimal entry keeps CommonMark, RMD structure, expressions, bindings and budgets. GFM syntax, native HTML parsing and repair, Lezer block planning, KaTeX display and plot formula semantics are capabilities installed by the standard and compatibility assemblies. Omitting one produces an explicit capability diagnostic instead of silently changing meaning; for example, the minimal entry rejects `enableCss` with `local.capability.html`. The minimal runtime and declaration graphs no longer reach `parse5`, `@lezer/markdown`, `remark-gfm` or KaTeX, and they no longer load the default preset or its authoring copy. The standard entry keeps the full experience.

After building, run `npm run test:compiler-entry` to check direct ESM imports, production chunks, declaration dependencies and browser consumption. Run `npm test -- tests/compiler-entry.test.ts` for source behavior checks.
