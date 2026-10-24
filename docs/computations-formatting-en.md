# Reusing calculations and formatting values

These additions belong to `0.4.0`, which uses `local-draft-2`. See the [syntax specification](local-interaction-syntax-en.md), [integration API](local-integration-en.md) and [working example](../examples/local/recipes/invoice.reactive.md).

## Named values

```markdown
<const name="unitPrice" value="{{ 12.5 }}">
<computed name="total" value="{{ quantity * unitPrice }}">
<computed name="invoice" value="{{ formatCurrency(total) }}">

<number bind="quantity" label="Quantity" initial="2" min="0" max="100">

Invoice: **{{ invoice }}**.

<if when="{{ total >= 100 }}">
Eligible for bulk delivery.
</if>
```

`computed` and `const` are invisible, void declarations. Write each on its own line at document top level; `/>` is accepted too. Both require `name` and a complete `value="{{ expression }}"`. Their values use the expression types: number, string, boolean, null, string array or numeric array. The compiler infers the type; there is no type annotation or implicit conversion. See [collections](constraints-collections-en.md) for array literals and aggregates.

Names follow the same identifier and reserved-name rules as `bind`. Controls, multi-slot bindings and declarations share one namespace. A declaration cannot replace another declaration or a control. Declarations inside containers are compile errors. Code fences, inline code and comments remain literal or inert.

Declarations are visible throughout the document, including before their source position. A `computed` value may read controls, constants and other computations. A `const` may read other constants and built-in constants such as `pi`; it must remain independent of controls and computations. This supports fixed prices and thresholds without displaying a disabled input. Constants have no editing or reset control.

The compiler extracts dependencies from the expression AST, including all conditional branches. It orders declarations by dependency before inferring types. Unknown names, duplicate names, self references and indirect cycles produce source-positioned errors. A cycle in an unused branch is still a compile error. Type checking uses the same operator and function rules as ordinary expressions; runtime domain errors remain possible, for example division by a control that becomes zero.

Use a named value anywhere an expression is accepted: prose, dynamic attributes, conditions and numeric table cells used by charts. Computable LaTeX formulas read multi-letter numeric names as `\mathrm{total}`, for example `y = \mathrm{total} x`. Formatted strings belong in labels or prose; numeric chart cells and plot parameters need the underlying number.

## Updates and errors

Each runtime owns its calculation cache. Computations are reused within a revision and refreshed after a successful control edit, atomic multi-slot edit or panel reset. Constants are evaluated at compilation and copied into each runtime. Hiding a section keeps its inputs and calculations; reset follows the existing control subtree rules.

A failed calculation propagates its expression error when a consumer reads it. The runtime never substitutes zero, null or a previous successful value. Independent consumers continue to work, and a valid input edit lets failed consumers recover. Runtime logical and conditional operators keep their usual short-circuit behavior: an unvisited branch does not read its failed value. A constant with an invalid static value is a compile error.

`document.bindings` and `document.initialState` describe writable controls. `document.computations` contains serializable declaration metadata. `runtime.snapshot().state` also contains successful named results for the current revision; failed results are absent. Use `runtime.evaluate(name)` to read a result with its error semantics. Declarations cannot be changed through `set` or `setMany`. Returned arrays remain protected from external mutation.

## Number formatting

All four functions return strings. Optional arguments are positional.

| Function | Defaults and example |
| --- | --- |
| `formatNumber(value, digits, locale, grouping)` | `digits=2`, `locale="en-US"`, `grouping=true`; `formatNumber(1234.5)` gives `"1,234.50"` |
| `formatPercent(value, digits, locale)` | `digits=0`, `locale="en-US"`; `formatPercent(0.125, 1)` gives `"12.5%"` |
| `formatScientific(value, digits, locale)` | `digits=2`, `locale="en-US"`; `formatScientific(1234)` gives `"1.23E3"` |
| `formatCurrency(value, currency, digits, locale)` | `currency="USD"`, `digits=2`, `locale="en-US"`; `formatCurrency(12.5)` gives `"$12.50"` |

`digits` must be an integer from 0 to 20. It fixes both minimum and maximum fraction digits, including for currencies such as JPY. `grouping` must be a boolean. Supported locales are exactly `en-US`, `zh-CN`, `de-DE`, `fr-FR` and `ja-JP`; omission always uses `en-US`, independently of the renderer's UI language or device settings. Unsupported locales are errors. Currency codes must be three uppercase ASCII letters accepted by `Intl.NumberFormat`; this is a syntax check, not a registry of circulating currencies.

Formatting uses decimal `halfExpand` rounding: ties round away from zero, so `formatNumber(1.005)` gives `"1.01"` and `formatNumber(-1.005)` gives `"-1.01"`. Zero displays without a negative sign. Arithmetic still uses finite JavaScript numbers; `round(x)` retains its existing `Math.round` rule, with ties toward positive infinity. Formatting changes presentation, not the source number.

A null value formats as an empty string. Other argument types remain strict: strings are not converted into numbers. Explicitly guard optional dates or text before applying their functions. Locale-specific punctuation, currency symbols and spacing follow the host's `Intl` data; hosts that need byte-identical text across platforms should pin their runtime and locale data.

## Strings

| Function | Behavior |
| --- | --- |
| `trim(text)` | Remove leading and trailing JavaScript Unicode whitespace |
| `lower(text)`, `upper(text)` | Default Unicode case conversion, independent of locale |
| `startsWith(text, search)`, `endsWith(text, search)` | Case-sensitive literal checks; empty search matches |
| `replace(text, search, replacement)` | Replace every non-overlapping literal match; empty search is an error; replacement text such as `$&` stays literal |
| `slice(text, start, end)` | Unicode code point indices; end is exclusive and defaults to the length; negative indices count from the end; indices are integers and clamp to bounds |

These functions require strings, including when the value is null. No regular expressions or property access are available. Code points are distinct from grapheme clusters: a combined emoji or an accented letter can contain several code points. All results keep the existing string budget of 100,000 UTF-16 code units. Replacement expansion is checked before constructing an oversized result.

## Dates

`dateCompare(a, b)` returns `-1`, `0` or `1`. `dateDiff(a, b, unit)` returns the signed difference **a minus b**; the default unit is `"days"`. Other units are `"hours"`, `"minutes"`, `"seconds"` and `"milliseconds"`.

Both arguments must be valid `YYYY-MM-DD` strings in years `0001` through `9999`, matching date controls. The calendar is Gregorian; leap days are validated. Each date means midnight UTC. Device timezone and daylight saving changes therefore do not change the result: `dateDiff("2026-03-09", "2026-03-08", "hours")` is `24`. Timestamps, timezone suffixes and ambiguous regional date strings are rejected.

An empty date control contains `""`; this is an absent date, not epoch zero. Empty or invalid dates produce a domain error; null produces a type error. Guard optional dates explicitly:

```markdown
<computed name="days" value="{{ startDate == '' || endDate == '' ? null : dateDiff(endDate, startDate) }}">
Days: {{ days == null ? 'Choose both dates' : formatNumber(days, 0) }}
```

## Diagnostics and limits

Declaration diagnostics use `local.computation.*`: `placement`, `name`, `reserved`, `duplicate`, `value`, `unknown`, `cycle`, `const`, `expression` and `budget`. Expression type errors keep the existing `local.expression.*` codes. Diagnostics include source ranges, lines and columns. The graph uses an iterative dependency order, so long chains do not require recursive evaluation. Existing source, syntax-node, expression and value budgets still apply; cycle reports are capped by the diagnostic budget.

## Compatibility

Existing expressions and `round(x)` keep their behavior. The new function names are reserved identifiers in this release. Rename any pre-existing bindings with these names and update their references before upgrading. The [changelog](../CHANGELOG.md) lists this addition.
