# Strict parsing and local recovery

**English** · [中文](tolerance-ch.md)

The `strict` option controls structural recovery in compiler factories, `compileLocal`, editing sessions and Workers. It defaults to `true`; omission and explicit `undefined` use the same default. Other non-boolean values are configuration errors.

```ts
import { createStandardCompiler } from 'reactive-md/compiler/standard';

const compiler = createStandardCompiler({ strict: false });
const result = compiler.compile(`<alert>
Unfinished content {{ missing }}.

## Next section

This **Markdown** still renders.
`);

if (result.status === 'recovered') {
  console.log(result.diagnostics, result.recoveries, result.program.nodes);
}
```

Loose mode keeps the damaged region as original source text. Components, expressions and declarations inside it stay inert. Compilation resumes at the next reliable boundary without rewriting the source.

Complete pairs take priority, including components whose bodies cross headings. A stray closing tag becomes literal text by itself. An outer closing tag can terminate an intact outer container while its unclosed inner fragment becomes text. An unmatched, lexically complete opener can recover before an ATX heading with a preceding blank line in the same Markdown container. Code, comments, raw HTML text and unfinished attribute quotes do not supply heading boundaries. Ordinary paragraphs, blank lines and sibling components are not synchronization points; without a reliable heading, recovery extends to the outer boundary or end of file.

Each recovery records `code`, `causeRange`, `affectedRange`, `action` and `boundary`. Ranges are half-open UTF-16 offsets into the original source. Records are sorted and deduplicated.

Each finalized recovery also produces at most one warning at `causeRange`, with the same stable code: `local.recovery.unclosed`, `local.recovery.mismatch`, `local.recovery.stray-close`, `local.html.repair` or `local.html.literal`. The message states what was repaired or kept as literal text, so recovery is never silent. Line and column use the raw UTF-16 source. Warnings are not emitted per token. The existing diagnostics budget applies: when it is full, a warning may be omitted while the recovery record remains in `recoveries`. Recovery inserts no error block in the document body.

Binding errors, computation cycles, invalid initial values, required component attributes and component shape errors remain errors and still fail compilation; recovery does not downgrade them globally. Configuration, version and budget errors also remain fatal. References outside a literal region to declarations removed inside it remain unknown bindings. A failed result can retain recoveries completed before the failure, their warnings and the separate error that caused failure.

## HTML and details

Loose mode repairs omitted or mismatched HTML tags within an isolated fragment using parse5. The existing element, attribute and URL policies still apply; loose mode grants no script, CSS or extended HTML capability. A repaired fragment yields one `local.html.repair` warning. A mixed RMD fragment becomes literal text with one `local.html.literal` warning when ownership and source ranges cannot be preserved. Synthetic nodes carry `synthetic` and `syntheticBoundary` metadata.

Both modes support a details element without blank lines:

```html
<details>
  <summary>1145</summary>
  1145
</details>
```

It renders as a single disclosure in an accordion with no group title. The trigger is `1145` and the panel contains `1145`. It starts collapsed; click, Enter and Space toggle it. Boolean `open` starts it expanded, and static output exposes the body. Rich summaries and nested details retain their content.

## Results and hosts

Factory success results include `status: 'valid' | 'recovered'`, a deeply frozen `program`, diagnostics, recoveries and optional-check coverage in `checks`. A `valid` success has no recovery warning. A `recovered` success includes the program and one warning per recovery. Failures use `status: 'failed'` and contain no program; they may retain recoveries completed before the failure and their warnings. Unrecoverable semantic, type, binding, options, version and budget errors remain errors. Task-one `ok` and `document` aliases remain available; document is a separate plain-data copy.

`compileLocal` keeps its existing result type and adds `recoveries` only when present. Strict results retain their historical field shape. Export options preserve the selected mode so standalone replay compiles the same source with that mode.

Loose editing sessions use the full reference path to avoid reusing blocks across recovery boundaries. Strict mode keeps its existing optimizations. Configuration identity includes strict mode and recovery strategy version 2. Demo and editor defaults remain strict; Demo preview defaults and author checks belong to the later host phase in the [near-term plan](../architecture_roadmap/near-term-plan-ch.md).

See [one-shot compilation](../integration/compiler-en.md) and [HTML compatibility](html-compatibility-en.md).
