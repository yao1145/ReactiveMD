# Diagnostics and counting rules

[中文](diagnostics-counting-ch.md)

This page defines the 0.4.x diagnostics contract, text-length units and resource-budget scopes.

## Diagnostics contract

The machine fields of `Diagnostic` are `code`, `severity`, `range`, `line` and `column`. Its `message` contains default English display text. Hosts call `formatLocalDiagnostic(diagnostic, 'zh')` or `'en'` for localized messages; the editor and CLI use the same function. Optional template identifiers and parameters support localization. Unknown host diagnostics use their original `message`, subject to the display-length limit.

```ts
import { compileLocal, formatLocalDiagnostic } from 'reactive-md';

const result = compileLocal(source);
for (const diagnostic of result.diagnostics) {
  console.log(diagnostic.code, formatLocalDiagnostic(diagnostic, 'zh'));
}
```

Changing language preserves codes, severity and source locations. Existing diagnostic codes keep their meaning within one `0.x` minor series. New codes may be added; an existing code must not be reused for a different error category. Removing, renaming or changing a code's meaning requires a new minor version and migration notes. Display wording may improve; machine consumers should use codes and structured fields.

Ranges are zero-based UTF-16 indexes with half-open intervals `[start, end)`. Lines and columns are one-based; columns count UTF-16 code units. LF advances the line, and CRLF occupies two source code units. Positions always refer to the original, unnormalized source.

When the diagnostic limit is reached, new warnings may be omitted; a new error takes priority over an existing warning. Compile errors make `ok` false. Rejected runtime writes preserve committed state and revision.

## Text length

| Purpose | Unit |
| --- | --- |
| Source offsets, diagnostic columns, source and string resource budgets | UTF-16 code units, equivalent to JavaScript `string.length` |
| String `len()`, text-control `min-length` / `max-length` | Unicode code points |
| Array `len()` and array limits | Elements |

`😀` occupies two UTF-16 code units and one code point. An `e` followed by a combining accent has two code points. `👩‍💻` occupies five UTF-16 code units and three code points. Length validation does not combine grapheme clusters or normalize Unicode. An unpaired UTF-16 surrogate counts as one string-iteration item.

Compiler initial-value checks, runtime writes and the reference renderer share these rules. Independent string resource budgets are checked in UTF-16 first; the email limit of 254 also uses UTF-16. `countLocalCodePoints(value)` uses the same unit as text constraints.

The document budget counts original source. Attribute values are counted after supported HTML entities are decoded. Concatenation and interpolation also check output length. For example, `&amp;` in an attribute occupies five source code units and one decoded code unit. Line endings inside a quoted attribute still count toward its value length.

## Resource budgets

Length limits include the boundary value; larger inputs are rejected. Independent compilation or evaluation starts a fresh corresponding budget. Cache hits still require the operation's input and state validation.

| Resource | Limit and unit | Scope |
| --- | --- | --- |
| Document source | 1,000,000 UTF-16 code units | Original source for one compilation |
| Syntax nodes | Default 10,000 nodes | All constructions during one parse, including intermediate nodes; configurable per call |
| Component nesting | 100 levels | Current component parse call chain |
| Tag, attribute and binding names | 128 UTF-16 code units | Each name |
| Theme name | 64 UTF-16 code units | Each theme name |
| String values, attributes and templates | 100,000 UTF-16 code units | Each value or template, including concatenated output |
| Array | 10,000 items | Each array |
| Sum of array member strings | 100,000 UTF-16 code units | All string members of one array |
| Email | 254 UTF-16 code units | Each nonempty email value |
| Compile diagnostics | 100 entries | One compilation, shared by parser and compiler |
| Diagnostic message | 2,000 UTF-16 code units | Each displayed message; excess text is truncated |
| Diagnostic template parameters | At most 16; string values at most 256 UTF-16 units each, total value text at most 2,000 | Serializable parameters of one diagnostic; excess values are truncated or omitted |
| Expression source | 4,000 UTF-16 code units | Each expression |
| Expression AST | 2,000 nodes | Cumulative constructions for one expression |
| Expression parse / AST depth | 100 / 200 levels | Parser call depth / final AST depth |
| Expression evaluation | 10,000 node visits, depth 250 | Each evaluation; short-circuited branches count only when visited |
| LaTeX source | 50,000 UTF-16 code units | Each formula |
| LaTeX tokens / AST | 20,000 tokens / 5,000 nodes | Parsing one formula; tokens include EOF |
| LaTeX parse / evaluation depth | 120 / 1,000 levels | Corresponding call chains |
| Standalone LaTeX evaluation | Default 20,000 node visits | Each `evaluate`; an explicit shared budget accumulates across calls |
| Plot curves | 16 curves | Each `<plot>` |
| Samples per curve | 2 to 2,000 points | Each sampling request, including endpoints |
| Document sample points | 20,000 points | Sum of curve counts times requested samples, including hidden regions |
| Validation rules | 100 rules per document | Includes rules in hidden regions |
| Generated rows per `<data-table>` | 1,000 maximum, 100 default | Declared `max-rows` for one table |
| Columns per `<data-table>` | 20 columns | One table |
| Document generated rows | 2,000 rows | Sum of declared `max-rows` over every `data-table`, including hidden tables |
| Document generated cells | 10,000 cells | Sum of declared rows times columns over every `data-table` |
| Generated table text | 100,000 UTF-16 code units | Header, cell, empty/error text and encoded row keys for one table |
| Per-curve computation | `max(1,000,000, samples × 1024)` node visits | One `samplePlot`, including extra discontinuity checks |
| Document plot computation | 2,000,000 node visits | All plot sampling in one runtime revision; a new revision resets it |

Evaluation steps count AST node visits, not milliseconds. Standalone `samplePlot` callers pass a shared budget to accumulate across curves. The reference renderer maintains a document budget and sampling cache.

Expression compilation caches hold at most 500 entries; formula compilation caches hold 512; each runtime's expression cache holds 200. These entry limits manage memory without changing input validity. A full formula cache is cleared before the next insertion. Caching never bypasses evaluation budgets.

## Validation

Regression cases cover Unicode lengths, UTF-16 locations, CRLF, budget boundaries, equivalent machine fields across languages, and error retention after warnings fill the diagnostic limit. Editor and CLI checks use real diagnostic objects. Business logic does not depend on complete message text. See [Versions and compatibility](../compatibility/compatibility-en.md) and [Author tools](../integration/author-tools-en.md).
