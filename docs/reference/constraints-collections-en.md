# Constraints, conditional tones and local collections

These additions extend `0.4.0`, which uses `local-draft-2`. The [workshop example](../../examples/local/recipes/workshop.reactive.md) combines a participant budget, a date interval and a selected-subject table. [Named calculations](computations-formatting-en.md) hold its intermediate results.

## Cross-field validation

```markdown
<number bind="people" label="Participants" initial="4" min="1" max="20">
<number bind="capacity" label="Room capacity" initial="3" min="1" max="20">
<validation when="{{ people <= capacity }}" message="Choose a room for at least {{ people }} people." fields="people capacity">
```

`validation` is a void block component with required `when`, `message` and `fields` attributes. `when` must contain one complete boolean expression. `message` is text with optional ordinary interpolations. `fields` lists distinct public writable binding names, separated by whitespace; names from multi-slot controls are accepted too. A rule can read controls and computed values, including values declared later. Fields identify the controls associated with its hint; read-only declarations cannot be fields.

Constraints report the current consistency of a document. Readers can still edit an inconsistent plan, including one whose initial values fail a cross-field rule. For example, changing the participant count from four to six can temporarily exceed room capacity; changing the room then clears the hint. Existing individual control rules, such as numeric bounds and invalid calendar dates, keep their write-rejection behavior.

`runtime.validate()` returns diagnostics for all current failed rules in source order. It reports `local.validation.failed` when `when` is false and `local.validation.expression` when an expression cannot be evaluated. Errors count as failures. One failed rule does not stop independent rules. The result is cached for the current runtime revision and returned as defensive copies. Edits, atomic slot updates and resets refresh calculations and validation together.

The renderer displays failed-rule hints and associates them with the corresponding controls or their accessible groups using `aria-describedby` and `aria-invalid`. Hint IDs belong to the mounted document instance. Success removes the error text. Rules in hidden content remain active, as do their bindings; hidden hints do not announce themselves. A document supports at most 100 validation rules, including hidden regions. Diagnostic messages retain the existing 2,000-character bound.

## Conditional visual emphasis

```markdown
<badge tone="{{ total <= budget ? 'success' : 'warning' }}">{{ formatCurrency(total) }}</badge>
<alert tone="{{ total <= budget ? 'info' : 'warning' }}">Review the estimate before booking.</alert>
```

This build supports dynamic `tone` on two existing components. `badge` accepts `neutral`, `success` and `warning`; `alert` accepts `info`, `success` and `warning`. Static values retain their existing behavior. Dynamic expressions must have string type, and the renderer checks the returned value against the component's allowed tones. An error or unsupported value uses the default tone and a visible computation hint. CSS classes, author styles and colors remain outside this conditional API.

The limited enum covers warning and success emphasis while keeping theme colors and contrast under host control. More general conditional styling would need separate accessibility and theme rules.

## Arrays and indexing

```markdown
<const name="fixedFees" value="{{ [100, 20, 5] }}">
<computed name="fees" value="{{ [people * 80, includeKit ? people * 20 : 0] }}">

First fee: {{ fees[0] }}. Total: {{ sum(fees) }}.
```

Array literals contain only strings or only finite numbers. Expressions inside a literal can read the document's named values. Nested arrays, mixed element types, booleans and null elements are rejected. `[]` is an empty numeric array by default; a direct empty literal in a conditional branch adopts a string-array sibling's kind, so `show ? subjects : []` works for string selections. Existing checklist and multi-select values remain string arrays. The public type `LocalValue` gains `number[]`, and `LocalValueKind` gains `number-array`; its existing `array` kind continues to mean a string array.

Indexing is zero based: `values[0]` reads the first element. The index must be a finite safe integer. An integer outside the collection, including a negative index, returns null; a non-integer index is an error. Indexing a string or a scalar is a type error. Arrays themselves cannot be interpolated as text; use an index, `len`, an aggregate or a data table.

`len` counts both kinds of array. `contains` accepts a string member for a string array and a number for a numeric array. String containment keeps its existing behavior. Every array is bounded by 10,000 elements; array literals also consume the existing expression-length, AST-node and evaluation budgets. The total contents of a string array keep the existing character budget. Returned runtime arrays are copied, and snapshot arrays are frozen.

## Numeric aggregates

| Function | Result |
| --- | --- |
| `sum(values)` | Sum of a numeric array; empty input gives `0` |
| `average(values)` | Arithmetic mean; empty input gives null |
| `minOf(values)` | Smallest numeric member; empty input gives null |
| `maxOf(values)` | Largest numeric member; empty input gives null |

Aggregates accept numeric arrays, with no conversion of numeric-looking strings. Results use finite JavaScript numbers; an overflow in the sum or result is an expression error. `average` divides the sum by the count, so an overflowing intermediate sum is also an error. Null from an empty aggregate follows existing nullable-expression rules, so guard it before numeric operations when needed. Scalar `min`, `max` and `round` keep their existing signatures and behavior.

## Generate table rows from local values

```markdown
<const name="subjects" value="{{ ['mathematics', 'physics', 'chemistry'] }}">

<data-table label="Subject preparation" rows="{{ subjects }}" key="{{ item }}" max-rows="3">
<column label="Subject" value="{{ item }}">
<column label="Position" value="{{ index + 1 }}">
<column label="Preparation" value="{{ item == 'chemistry' ? 'Prepare materials' : 'Prepare examples' }}">
</data-table>
```

`data-table` is a paired block component. It requires an accessible `label`, a complete array expression in `rows`, and a complete string or number expression in `key`. Its only children are 1 to 20 void `column` declarations. A column requires a static `label` and a complete scalar `value` expression. Cells output plain text; null gives an empty cell.

Each row has two local names: `item` is the current string or number, and `index` is its current zero-based position. These names shadow same-named document values inside column expressions. Other references use the normal document environment. The source `rows` expression uses ordinary document scope.

Keys depend only on `item`, including at least one reference to it. They cannot depend on `index` or other document values. The table checks that every evaluated key is a nonempty string or finite number and is unique. Numeric and string keys have distinct identities; signed numeric zeros have the same identity. React rows retain their identities when their items reorder. For records with repeated display values, use a collection of distinct local IDs as `rows` and derive the display cells from those IDs. Duplicate or invalid keys produce a whole-table error.

`max-rows` is a static integer from 1 to 1,000, defaulting to 100. Across the document, declared row budgets may total at most 2,000 and row budgets multiplied by their column counts may total at most 10,000 cells. Hidden tables count too. Each generated table also has a budget of 100,000 UTF-16 code units for header text, cell text, error/empty placeholders and encoded row keys. The renderer checks budgets before exposing rows; exceeding them reports an error without truncating the data.

An empty array displays the headers and an empty-state message. Failure of the row source or a key clears the table's rows and displays an error. A cell-expression failure is shown in that cell while independent cells remain readable. The component creates native table rows, not arbitrary repeated document sections or controls. Markdown tables and their existing chart inputs keep their original behavior.

## Integration and compatibility

`LocalDocument.validations` contains serializable `LocalValidation` metadata. Hosts can call `runtime.validate()` at any time without changing state. The compiled document remains transferable to a Worker with `structuredClone`. The [core integration guide](../integration/local-integration-en.md) describes its lifetime and persistence rules.

The aggregate names `sum`, `average`, `minOf` and `maxOf` become reserved identifiers. Rename conflicting bindings and their references before using this release. Hosts with exhaustive `LocalValueKind` checks should add `number-array`; writable multi-select and checklist controls still require strings. The preview is published on the `next` channel.
