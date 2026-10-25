# Reactive MD local interaction syntax specification

Syntax identifier: `local-draft-2`, 2026-10-23. If this is your first time with the syntax, read the [beginner guide](local-guide-en.md) first; this document is the complete specification. Hosts select local interaction mode through `compileLocal` and `LocalReactiveDocument`, see [integration notes](local-integration-en.md). See [Versions and compatibility](compatibility-en.md) for package version relationships, 0.x compatibility rules and migration, [Source revisions and migration](source-versioning-en.md) for the optional revision directive and `reactive-md migrate`, and [0.4.0 release and migration](release-0.4.0-en.md) for the upgrade from `0.3.1` / `local-draft-1`. Complete examples are in the [example index](../examples/local/README.md).

## 1. Positioning and scope

`0.4.0` adds invisible `computed`/`const` declarations and number, string and date functions. See [Reusing calculations and formatting values](computations-formatting-en.md) for declaration syntax, dependency and error rules, function signatures and deterministic defaults.

For cross-field validation, conditional tones, arrays and bounded table-row generation, see [Constraints and collections](constraints-collections-en.md).

See [Diagnostics and counting rules](diagnostics-counting-en.md) for source positions, text lengths and resource units. String `len()` and text-control length constraints count Unicode code points.

Reactive MD is for local interactive documents: authors write Markdown and place input controls; when readers adjust parameters, related text, formulas, charts and diagrams update immediately.

The base language requires only two connection rules: `bind` names an input, and `{{ expression }}` reads it elsewhere. Components handle their own selection, expansion, search, sorting, timing and reset.

This draft does not include external service calls, form submission, asynchronous resources, named actions, event handlers, programmable collection edits, general loop templates or arbitrary scripts. Legacy `state/data/computed/actions` configuration blocks are not part of the new syntax. Expressions can produce string or numeric arrays; checklist and multi-select components produce string arrays. Tables can use prose Markdown or bounded local row generation through `data-table`.

By default a document only keeps in-memory state for the current instance. Reopening starts from initial values; persistence is not part of the author syntax. No language version declaration, component import or YAML is required. A document may optionally declare its revision with one `<!-- reactive-md: local-draft-2 -->` line in the prologue, before the theme and body; unversioned documents use the current revision. See [Source revisions and migration](source-versioning-en.md). Hosts should explicitly select draft parsing mode and must not guess by mixing old and new syntax.

Documents may select a theme with `<theme name="default">` before the body; omission uses `default`. This is static metadata, not a component. Custom themes must be registered by the host and support both color schemes; see the [theme protocol](theme-protocol-en.md).

## 2. Your first document

```markdown
# Cost estimate

<panel title="Adjust the plan">
<slider bind="people" label="People" initial="2" min="1" max="20">
<toggle bind="annual" label="Annual billing">
</panel>

Monthly cost: **{{ people * (annual ? 80 : 100) }} USD**.
```

Slider declares the number `people` with initial value 2; toggle declares the boolean `annual`, off by default. The panel provides restore-defaults by default, restoring its internal parameters at once.

When no cross-component linkage is needed, omit `bind`, for example `<counter label="People" initial="2">`. The component remains interactive; it just has no public variable.

## 3. Markdown and tags

### 3.1 Document structure

Headings, paragraphs, emphasis, links, images, quotes, lists, plain tables, inline code and code fences continue to use Markdown. Component tags may sit in a paragraph or a standalone block, depending on component type. Container contents continue to parse as Markdown; authors do not need to add a `markdown` attribute.

Block component start and end tags each occupy a line. Attributes in a start tag may span multiple lines. A `>` inside a tag ends the tag only when it is outside quotes. Indentation is only for readability: container content is dedented by the common indentation and then parsed as Markdown; indentation inside code fences is preserved.

The inline components `badge`, `tooltip`, `jump` and `text` can be embedded in sentences. Other components are block components; `option`, `tab`, `disclosure`, `node`, `edge` and `step` are child components restricted to specific parent containers.

### 3.2 Two tag shapes

| Type | Form | Rules |
| --- | --- | --- |
| Void component | `<slider bind="a" label="Amplitude">` | No end tag; a trailing `/>` is also accepted |
| Container with content | `<card title="Notes">` and `</card>` | Must be explicitly closed; nesting is allowed |

Void components are fixed to `input`, `textarea`, `number`, `slider`, `range-slider`, `coordinate`, `toggle`, `checkbox`, `date`, `counter`, `timer`, `progress`, `anchor` and `edge`. The declaration tags `computed`, `const` and `validation`, and the structural `column`, also have no body. Every other component listed in this draft uses paired tags. `textarea` text is set through `initial`, so it is a void component.

For example:

```markdown
<card title="Plan notes">
Price updates with **People**.

<slider bind="people" label="People" initial="2" min="1" max="20">

Total cost: {{ people * 100 }} USD.
</card>
```

Tag names and attribute names use lowercase kebab-case; an end tag must match the most recently unclosed container. Automatic closing and correction of mismatched tags are not allowed. Legacy directives such as `:::card` are not interpreted as new components.

### 3.3 Attributes

Regular attribute values are enclosed in single or double quotes; boolean attributes may omit their value. Attribute order has no semantics, and duplicate attributes are errors.

| Form | Meaning |
| --- | --- |
| `label="People"` | String |
| `max="20"` | Parsed as a number according to the component attribute definition |
| `required` | Boolean true |
| `required="false"` | Boolean false |
| `disabled="{{ people >= 20 }}"` | Dynamic boolean |
| `label="Current people: {{ people }}"` | Text interpolation |
| `bind="people"` | Static variable name |

Omitted boolean attributes use the component default rather than always assuming false; for example `panel.reset` defaults to true.

`&quot;`, `&apos;`, `&amp;`, `&lt;` and `&gt;` in attribute values decode to the corresponding characters; backslashes are not used to escape attribute quotes. Dynamic values for numeric and boolean attributes must be one complete interpolation and keep the original type; text attributes may contain multiple interpolations.

`bind`, `initial`, `name`, `id`, `value` (option identifier), `to`, `from`, `answer`, `kind`, field mappings and layout enums are static attributes. Input `min/max/step` are static constraints too; plot `min/max` may be dynamic to support adjusting the observed range. The `rows` attribute of `textarea` is a static row count, while `data-table.rows` is a required expression; do not confuse the two.

Unknown components, unknown attributes, wrong positions or wrong attribute types all produce source diagnostics. Registered tags are not executed as arbitrary HTML; authors cannot use `script`, `style`, `onclick` or other script entry points.

### 3.4 Code, math and escaping

Prose such as `Array<T>`, `Map<string, number>`, `x<y` and currency `$5` or `$10` stays text. Complete formulas still use `$...$` or `$$...$$`; an unmatched single dollar sign stays literal.

The default path accepts the [P0 HTML subset](html-compatibility-en.md#p0-html-in-the-default-mode): text formatting, headings, containers, disclosures, quotations, code, lists, links and images. It produces controlled nodes and reuses the current theme and renderer. Ordinary single newlines remain Markdown soft breaks. Under the temporary routing policy, enabling author CSS, JavaScript or extended HTML sends the entire source to native HTML and stops Markdown and ReactiveMD interpretation.

Reference a footnote with `[^note]` and define it with `[^note]: Note text`. Continuation paragraphs, lists and code blocks use Markdown indentation. Definitions support Markdown and the basic HTML above. Notes appear at the end in first-reference order; repeated references share a number and each has a return link. Identifiers are case-insensitive and the first duplicate definition wins. Undefined references stay literal; unused definitions stay hidden. Controls and interpolations inside notes remain text and create no bindings or executable expressions.

Tags, interpolations and formula markers inside inline code and code fences are displayed verbatim. The source revision directive in the prologue is the recognized version comment; other Markdown comments `<!-- ... -->` produce no components or variables.

Use `\{{` in prose to display a literal `{{`, and `\<slider>` or inline code to show a tag example. These backslash escapes belong only to the Markdown context and do not apply to LaTeX sources.

The parser identifies code, math regions and tag boundaries first, then interprets interpolations; syntax cannot be implemented by string replacement over the whole document. Markdown inside tags, nested containers, multi-line attributes and original line/column positions must be preserved.

## 4. Parameters, bindings and initial values

### 4.1 Naming and types

`bind` uses `[A-Za-z_][A-Za-z0-9_]*` and is case-sensitive. Variable types are determined by the component, not guessed from text content. `x`, `y`, `pi`, `e`, `true`, `false`, `null` and expression built-in function names are reserved.

| Component | Public value | Default initial value |
| --- | --- | --- |
| input, textarea | String | Empty string |
| date | Date string or empty string | Empty string |
| number | Number | The valid step value within range closest to 0 |
| slider | Number | min, with a default range of 0 to 100 |
| counter | Number | The valid step value within range closest to 0 |
| toggle, checkbox | Boolean | false |
| select, choices, radio-group | Option string | value of the first option |
| multi-select | String array of selected option values | Empty array |
| range-slider | Two numbers, `start` / `end` slots | start=min; end=the largest valid step not exceeding max |
| coordinate | Two numbers, `x` / `y` slots | The valid step value on each axis closest to 0 |
| table, chart with `key` | Stable row key string | Empty string (unselected) |
| tabs | Page string | value of the first tab |
| steps | Step string | value of the first step |
| diagram | Node ID string | id of the first node |
| checklist | String array of selected item IDs | Determined by the task list check marks |
| timer | Remaining seconds | duration, default 60 |

Scalar components use `initial` to override the default. `range-slider` and `coordinate` use `initial-start`/`initial-end` and `initial-x`/`initial-y` for their slots; `multi-select` accepts a comma-separated `initial` list of static option values. `timer` uses `duration` and `checklist` uses the check marks in its body; neither accepts `initial`. A `table` or `chart` selection accepts `initial` only together with `key`. Dates use real, valid `YYYY-MM-DD`; an empty string means not yet selected.

`bind` may be omitted. Unnamed components have independent internal state and do not derive a variable name from the tag. A control's `label` is required and may use dynamic text; it is also the control's accessible name.

### 4.2 Same-name controls and declaration order

The compiler collects bindings across the whole document before rendering, including bindings in conditional regions. Prose can reference parameters that appear later. Declarations and initial values do not change with condition truth, mount count or scroll position.

Number, text or boolean inputs of the same kind may bind the same variable and stay in sync; types must match, and numeric ranges and steps must be identical. When `select/choices/radio-group` share a variable, the value set and order must also be identical. Label text may differ.

A variable may have at most one explicit `initial`. Without an explicit initial value, the default of the first control in the source is used, and all associated constraints are validated. Later controls omitting `initial` share the existing initial value. The public state of `timer/checklist/tabs/diagram/multi-select/steps` is owned by exactly one component and does not accept a second same-name owner or writes from other controls. Each numeric slot of `range-slider` and `coordinate` is exclusive too. A `table` and a `chart` may share a selection binding only when their ordered `key` sets are identical.

Referencing an undeclared variable is an immediate error and does not silently create an empty value. Component initial values are document initialization data; showing a hidden control again does not initialize it again.

### 4.3 Updates, input drafts and reset

Valid input commits immediately and updates everything that depends on it. Composition input with a Chinese IME commits when composition ends; intermediate states such as an empty string or a minus sign in a number field remain only as an editing draft. If the value is still invalid on blur, an error is shown while other content keeps reading the last valid value.

Numeric constraints use finite numbers, `step > 0`, `min <= max`. Steps are based on min, or on 0 when min is absent, with an implementation-defined floating-point tolerance. An explicit initial outside the range or off the step is an error, not silently corrected. Default initial values are generated from constraints; when two valid values are equidistant from 0, the smaller one is used, and an error occurs when no step value is available.

Disabled controls do not accept reader input. A panel reset commits all parameters and component internal state inside it at once, triggers one consistent view update, and clears editing drafts. Displays of shared variables outside the panel change accordingly.

When a conditional region is hidden, existing state, tab selection and checklist checks are preserved. Timers in hidden regions pause and stay paused when shown again until the reader starts them. Disposing a document releases timers, subscriptions and component state.

## 5. Text interpolation and expressions

```markdown
People: {{ people }}.
Total: {{ people * 100 }} USD.
Billing: {{ annual ? 'annual' : 'monthly' }}.
```

Interpolation can appear in paragraphs, headings, emphasis, lists, plain table cells and attributes that allow dynamic values. Strings, finite numbers and booleans display directly; null displays as empty; arrays must first be converted with functions such as `len` and are not implicitly output as JSON. Output is treated as text.

### 5.1 Expression set

| Category | Supported |
| --- | --- |
| Literals | Numbers, single- or double-quoted strings, true, false, null |
| Parameters | bind names declared in the document |
| Arithmetic | `+ - * / %`, unary plus/minus, parentheses |
| Comparison | `== != < <= > >=` |
| Logic | `!`, `&&`, `\|\|` |
| Conditional | `condition ? trueValue : falseValue` |
| Math functions | abs, sqrt, floor, ceil, round, min, max, pow, sin, cos, tan, asin, acos, atan, exp, log |
| Common functions | len, contains, clamp |
| Formatting | formatNumber, formatPercent, formatScientific, formatCurrency |
| Strings | trim, lower, upper, startsWith, endsWith, replace, slice |
| Dates | dateCompare, dateDiff |
| Array aggregates | sum, average, minOf, maxOf |
| Constants | pi, e |

Precedence runs from function calls/parentheses, unary operators, multiplication/division/remainder, addition/subtraction, relational comparison, equality comparison, logical AND, logical OR, to conditional expressions; conditional expressions are right-associative and other binary operators are left-associative. Logic and conditional expressions short-circuit.

`+` accepts two numbers or two strings. Comparisons do not implicitly convert between strings and numbers; relational comparison accepts only two numbers or two strings; logical operations and if conditions must be booleans. Expression string escapes use `\\`, `\'`, `\"`, `\n`, `\t`.

min/max accept one or more numbers; pow takes a base and an exponent; clamp takes a value, lower bound and upper bound. Other math functions take one number, trigonometric functions use radians, and log is the natural logarithm. round rounds half values toward positive infinity. len computes the number of Unicode code points in a string or the length of an array; contains checks a substring or array membership.

Multiplication in prose expressions must be written `*`; use `pow` for exponents. LaTeX math regions follow their own mathematical writing rules. Expressions have no assignment, method calls, property access, custom functions or imports, and do not provide legacy runtime contexts such as `event` or `resources`.

Pipes in GFM tables must be written `\|`, for example logical OR as `\|\|`. Table parsing handles Markdown pipe escapes first, then sends cell expressions to the evaluator.

### 5.2 Calculation errors

Division by zero, domain errors, non-finite results and type errors are shown near the corresponding content. When the parameter itself is valid, the user's new input is kept, and other independent content keeps updating; the error result shows "Unable to compute" instead of reusing an old number as a new result.

This build adds named read-only values through top-level `computed` and `const` declarations. Short calculations can still be written in place; use declarations for intermediate results shared by prose, conditions, formulas and charts. See [Reusing calculations and formatting values](computations-formatting-en.md) for dependency, error and caching rules.

## 6. Inputs and parameter panels

All input components support `label`, optional `bind`, optional scalar `initial` and dynamic `disabled`. Additional attributes are listed below; unlisted attributes are not part of this draft.

| Component | Additional attributes and defaults |
| --- | --- |
| input | type=text/email; placeholder; required=false; min-length=0; optional max-length |
| textarea | placeholder; rows=4; required=false; min-length=0; optional max-length |
| number | optional min/max; step=1 |
| slider | min=0; max=100; step=1 |
| range-slider | bind-start/bind-end and initial-start/initial-end; min=0; max=100; step=1; optional color |
| coordinate | bind-x/bind-y and initial-x/initial-y; x-min/y-min=-5; x-max/y-max=5; step=1; optional color |
| counter | min=0; optional max; step=1 |
| toggle, checkbox | Optional color |
| date | optional min/max dates; required=false |
| select, choices, radio-group, multi-select | Body is one or more options; multi-select adds max-selected and uses a string-array value |

`range-slider` and `coordinate` expose independent number slots. Omit a slot's `bind-start`/`bind-end` or `bind-x`/`bind-y` to keep that slot internal; provide at most one explicit initial per slot. Crossing endpoints is rejected, not silently swapped. `multi-select` requires `label`, accepts `max-selected`, and normalizes writes to source order. These components also accept an optional `color`. See [local-draft-2 components and migration](local-components-v2-en.md) for the complete rules.

Selector example:

```markdown
<choices bind="plan" label="Usage" initial="personal">
<option value="personal">Personal</option>
<option value="team">Team</option>
</choices>
```

option.value is a non-empty, static, unique string; the body is the option's inline text, may contain emphasis, and must not contain another interactive component. select is a dropdown, choices is option cards, and radio-group is a radio button group; binding rules are the same.

`required`, length and email format show hints after the first blur and update with input afterwards. Controls allow an empty initial document value; hints do not produce submissions or network operations. New text with an invalid format remains a draft and does not replace the last valid public value. An empty initial value is public as an empty string until the reader fills it in.

`counter` has built-in decrement, increment and restore-initial buttons, and disables the corresponding action at range boundaries. `timer` supports label, optional bind and duration (positive integer seconds, default 60); it has built-in start, pause and reset, stops at zero, updates according to actual elapsed time, and does not accumulate timing error after switching to the background.

`panel` is a container supporting an optional title and reset (default true). It lays out vertically by default and provides restore-defaults. `reset="false"` hides the reset action. Nested panels are allowed: an inner reset affects only the inner panel, while an outer reset covers the whole subtree; child controls not yet shown in a condition are also in scope. Panel reset also restores table queries, sorting, paging, tab selection and diagram selection in the subtree.

## 7. Layout and content exploration

| Container | Attributes | Body and default behavior |
| --- | --- | --- |
| card | optional title | Regular Markdown; a content card |
| grid | columns=2 (integer 1–4, maximum column count) | Direct children are card; fewer columns in narrow containers, including nested grids and embedded documents |
| tabs | optional label, bind, initial | One or more tab, first selected by default |
| tab | label required, optional value | Regular Markdown |
| accordion | optional label | One or more disclosure |
| disclosure | label required; open=false | Click to expand; multiple entries can be open at once |
| if | when required, complete boolean interpolation | Shows Markdown and components when true |
| alert | optional title; tone=info/success/warning, default info | Regular Markdown |
| badge | tone=neutral/success/warning, default neutral | Inline text |
| tooltip | text required | Focusable inline explanatory text |

When tab has no value, `tab-1`, `tab-2` and so on are generated in source order; values in the same group must be unique. Without bind, tabs do not name page state; with bind, the current value is exposed publicly. Switching tabs preserves child content state and pauses hidden timers. The initial `open` state inside accordion is restored on reset.

When if's when is false, content is not displayed, but internal parameters are still initialized according to section 4. Unknown variables or type errors in hidden branches are still compile errors.

### 7.1 Navigation, color and guided reading

| Container or inline tag | Attributes | Body and default behavior |
| --- | --- | --- |
| jump | to required; appearance=link/button, default link; optional color | Inline Markdown; scrolls to a heading slug or explicit anchor |
| anchor | id required and unique | No body; marks an explicit jump target |
| text | color required | Inline Markdown and interpolation; sets foreground color |
| section | color required | Block Markdown; sets inherited foreground color without a border or background |
| quiz | type=choice/number, default choice; label and answer required; optional explanation and tolerance | Choice quizzes contain options; numeric quizzes have an empty body. No public bind |
| steps | optional label, bind and initial; exclusive string binding | One or more step children; first step selected by default |
| step | label required; optional value | Markdown body; omitted values become step-1, step-2 and so on |

`jump.to` and `anchor.id` match heading slugs or explicit IDs. Duplicate anchors, heading collisions and missing targets are compile errors. `quiz` answers are supplied in source for self-study; drafts and feedback stay inside the component and panel reset clears them. `steps` keeps inactive step content initialized and preserves its state; hidden timers pause. See [local-draft-2 components and migration](local-components-v2-en.md) for color validation and slot details.

Base layout uses Markdown; images use `![description](path)`, links use `[text](address)`, and horizontal rules use `---`. Images load only after the host explicitly allows them through a URL policy; by default no image requests are made. See [Image and link policy](local-integration-en.md#image-and-link-policy) for integration. This draft does not provide author tags for row, stack, spacer, icon, image or link-button, and does not expose class/style.

## 8. Checklists

```markdown
<checklist bind="done" label="Try it out">
- [x] Read the source document
- [ ] Adjust parameters and observe the result
- [ ] Try it at phone width
</checklist>

Completed {{ len(done) }} / 3 items.
<progress label="Completion" value="{{ len(done) / 3 * 100 }}">
```

The checklist body is a non-empty, single-level Markdown task list, checked by the reader by default. Plain Markdown task lists remain static content. Items may contain inline Markdown but must not contain nested task lists or interactive components.

Fixed entries generate internal IDs `item-1`, `item-2` and so on in order; the public value is an array of checked IDs in source order, and `[]` when nothing is selected. Entries are not added, removed or reordered during a document instance; they are regenerated after editing the source and creating a new instance. Reset restores the initial state specified by `[x]` / `[ ]`. Supports label, optional bind and dynamic disabled.

progress is a void component; label/value are required, max defaults to 100, and value may be dynamic; max must be a positive finite number, value must be between 0 and max, and out-of-range values show a diagnostic instead of being silently clamped.

## 9. Tables and statistical charts

### 9.1 Shared data rules

The bodies of table, chart and timeline are each one Markdown table. Headers are non-empty and unique, and every row has the same number of columns; cells may contain interpolation. The first column is usually a label, and other columns read types according to the component.

Plain text cells display Markdown; plain decimal or scientific-notation text cells can be read as numbers, and a single complete interpolation keeps its result type. Mixed text such as `{{ price }} USD` is a display string and cannot be used as a numeric chart column. Legend labels take the plain text of headers.

There is no need to declare a YAML array first, and remote URLs, data attributes or API return values are not accepted. Errors such as empty rows, non-numeric values or missing columns are located at the corresponding cell.

### 9.2 Enhanced tables

```markdown
<table label="Component catalog" page-size="3">
| Name | Category | Price |
| --- | --- | ---: |
| Document | Basic | 20 |
| Form | Input | 45 |
| Chart | Visual | 80 |
</table>
```

table supports optional label, searchable=true, sortable=true and page-size=10 (positive integer). It provides a search box, sortable headers and paging by default; paging controls are hidden when there is only one page. With `key` naming a static, nonempty, unique identifier column, `bind` and `initial` can expose the selected row as a stable string; without `key`, selection stays inside the renderer.

Search is a case-insensitive substring match over the displayed text of all columns, trimming whitespace from the query; sorting uses the full column type, numerically for numeric columns and by Unicode code point order for text otherwise, preserving the original order of equal rows. Clicking a header cycles ascending, descending and source order. Search or sort changes return to the first page, and reactive data changes clamp the current page to the valid range. No matches shows "No matching results". These interactions affect only the table.

### 9.3 Charts

```markdown
<chart kind="bar" title="Cost and budget">
| Item | Actual | Budget |
| --- | ---: | ---: |
| Content | 120 | 150 |
| Visual | 230 | 200 |
</chart>
```

chart.kind defaults to bar and supports bar, line, area, scatter and donut. Supports optional title, x, y, x-label and y-label. x/y are static header names; y may be a comma-separated list of column names, so column names cannot contain commas.

| Type | Default column rules |
| --- | --- |
| bar, line, area | First column is the horizontal axis; other columns are numeric series |
| scatter | First column is the numeric horizontal axis and the rest are numeric vertical axes; x/y may also specify them |
| donut | First column is the label and second is the value; with more than two columns, y must specify the single numeric column |

line/area determine the horizontal axis as numeric or categorical from the full column type and connect in source order. donut values must be non-negative, and a zero total shows "No share to display". Series names become legends automatically; pointer and keyboard readouts are provided by default without event logic.

Numeric columns update with parameters. Calculation errors display in the corresponding chart and are not replaced with 0. With `key`, a chart can expose selection through `bind`, using the same stable row-key rules as `table`; a table and chart may share that binding only when their ordered keys match.

### 9.4 Timelines

timeline supports optional title and unit (display text, default "minutes"), and its body is a table with either `Task`, `Start` and `Duration` columns or `事项`, `开始` and `时长` columns, plus optional `Notes` or `说明`. These column names are fixed headers; start and duration are non-negative numbers. Sorting is stable by start time, overlapping intervals are allowed, and notes are viewed with a pointer or keyboard. Table content may use interpolation.

## 10. LaTeX math and function plots

### 10.1 Display and plotting

Prose `$...$` is inline math and `$$...$$` is a display formula. Inline math pairs on the same line, its content cannot start or end with whitespace; use `\$` to display a literal dollar sign. Display formulas may span lines and can also be written as `$$ y = x^2 $$`. Unclosed math delimiters are errors. Standalone formulas are for layout and create no state or functions. Each `$$...$$` block inside a plot container defines one curve; the math content keeps normal LaTeX syntax and does not need `{{ }}`.

```markdown
<slider bind="a" label="Amplitude" initial="1" min="0" max="5">

<plot min="-10" max="10">
$$ y = a \sin x + \frac{x^2}{10} $$
</plot>
```

The plot body may contain only whitespace and one or more display formula blocks. Each block writes `y = expression` and computes only explicit real functions y(x). Use multiple formula blocks for multiple curves; do not use plain line breaks as separators.

plot supports min=-10, max=10 (dynamic allowed, requiring min < max), samples=200 (static integer 2–2000), optional label, x-label="x" and y-label="y". Each plot has at most 16 curves; the sum of curves multiplied by their sample counts across the whole document is at most 20,000, including hidden regions. Curves share a computation budget, and exceeding it stops computation and reports an error. The vertical axis is determined automatically from finite sample values in the current range; if there are no valid values, an empty state is shown. Constant curves should add visible vertical-axis headroom.

### 10.2 Computable LaTeX

The following math forms must be supported by plotting computation in this draft. Formula layout and computation capability are validated separately; being able to lay out a formula does not mean it can be evaluated.

| Math content | Syntax |
| --- | --- |
| Numbers, four operations | `2`, `0.5`, `+`, `-`, `/`, `\cdot`, `\times` |
| Implicit multiplication | `2x`, `ax`, `a\sin x`, `(x+1)(x-1)` |
| Exponents | `x^2`, `x^{a+1}`, `e^x` |
| Fractions | `\frac{a}{b}`, `\dfrac{a}{b}`, `\tfrac{a}{b}` |
| Roots | `\sqrt{x}`, `\sqrt[3]{x}` |
| Grouping | `(...)`, `{...}`, `\left(...\right)` |
| Trigonometric functions | `\sin`, `\cos`, `\tan`, `\arcsin`, `\arccos`, `\arctan` |
| Exponential and logarithm | `\exp(x)`, `\ln x`, `\log x`, `\log_{2}x` |
| Absolute value | `\lvert x\rvert`, `\left\lvert x\right\rvert` |
| Other functions | `\min(a,b)`, `\max(a,b)` |
| Constants | `\pi`, `e` |
| Piecewise functions | `\begin{cases} ... \end{cases}` |
| Piecewise conditions | `=`, `\ne`/`\neq`, `<`, `>`, `\le`/`\leq`, `\ge`/`\geq` |

Trigonometric functions use radians; ln is the natural logarithm, log without a base is base 10 by convention, and with a subscript it uses the written base. Roots compute real numbers; odd integer roots allow negative numbers, while negative inputs to even roots are invalid samples. Absolute value accepts both paired vertical bars and `\left|...\right|`; bars must be paired, and missing boundaries are not guessed.

Multiplication must use `*` in expression contexts and may be omitted in LaTeX. LaTeX multiplication and division (including implicit multiplication) share precedence and associate left to right; exponents bind before unary minus, so `-x^2` is `-(x^2)`. `1/2x` is interpreted as `(1/2)x`; use fractions to make the denominator explicit.

A function without parentheses reads the product of the following term and ends at addition/subtraction, comparison, comma or the next function command; for example `\sin 2x` is sin(2x), `\sin x + a` is sin(x)+a, and `\sin x\cos x` is sin(x)cos(x). Use parentheses for complex arguments. `\sin^2 x` is supported and means `(sin x)^2`; inverse trigonometric functions use explicit names such as arcsin, and `\sin^{-1}` is not guessed to mean the inverse function.

`\left`, `\right`, the math spacing commands `\,`, `\;`, `\!`, `\quad` and `%` comments to end of line do not change computation. In piecewise functions, `&` separates values from conditions and `\\` separates branches; the first branch whose condition is true is used. `\text{otherwise}` may serve as the final default branch; if no branch matches, the point is undefined. Conditions support only a single comparison; express complex piecewise behavior with multiple branches.

Implicit equations, parametric curves, matrices, sums, integrals, derivatives and custom macros are not in the first version's computable set. When these structures are encountered, keep displaying the formula and point out the command or structure that cannot be computed; do not guess a plot from another formula. The math renderer must disable file, network, HTML and macro execution entry points.

### 10.3 Parameter name mapping

A single Latin letter maps to a same-name bind, for example `a` maps to `bind="a"`. Adjacent plain letters mean multiplication: `abx` is a×b×x.

Multi-letter names are written as `\mathrm{amplitude}` and read as `bind="amplitude"` as a whole. This is a Reactive MD naming convention; the command must contain a complete valid bind name, with no spaces or interpolation.

`\alpha`, `\beta`, `\gamma`, `\theta`, `\omega`, `\lambda`, `\mu` and `\sigma` map to same-name English binds. Other Greek parameters use `\mathrm{name}` for explicit references in the first version; `\pi` is fixed as the circle constant.

`x` is the plot variable and `y` is the output marker; neither can be bound to a control. Parameters must be numbers; undeclared parameters and wrong types are diagnosed before plotting.

### 10.4 Breaks, readouts and updates

Curves are recomputed when parameters change. Division by zero, non-real results and overflow points form breaks, and the two sides of a break are not connected directly. The plotting implementation must also subdivide suspected discontinuous intervals to avoid incorrect connections when asymptotes cross finite sample points.

A legend and pointer/keyboard readouts are provided by default. The curve legend uses the respective math formulas; move the pointer to the end of a curve to read that point's value.

## 11. Interactive diagrams

```markdown
<diagram bind="selected" initial="input" label="Reactive state flow" direction="right">
<node id="input" label="Input">
The reader changes parameters through controls.
</node>
<node id="compute" label="Compute">
Recompute formulas and results.
</node>
<node id="view" label="Display">
Update prose and charts.
</node>
<edge from="input" to="compute" label="State change">
<edge from="compute" to="view" label="Update result">
</diagram>
```

diagram supports optional label, bind and initial, with direction=right/down (default right). The body contains only node, edge and whitespace. At least one node is required; node requires id and label, and its body is static Markdown notes that may contain text interpolation but not interactive controls.

node.id is a `[A-Za-z_][A-Za-z0-9_-]*` unique within the current diagram. edge requires from/to and supports an optional label; both ends must exist. Fully duplicate from/to/label combinations are errors, while parallel edges with different labels are allowed. Cycles and self-loops are allowed.

Nodes are laid out automatically from relationships, with source order determining order within a layer; cycles are grouped as a whole before layout. The first version requires no coordinates and provides no author coordinate overrides.

Nodes are clickable and keyboard-selectable by default, and the selected notes appear in the diagram's detail area. With bind, the selected node id is public; without bind, selection stays inside the component. initial must point to an existing node and defaults to the first. The labels of diagram and edge, as well as node.label, support text interpolation. node also supports dynamic tone=neutral/success/warning, default neutral.

## 12. Component reference and syntax scope

| Purpose | Draft components |
| --- | --- |
| Parameter input | input, textarea, number, slider, range-slider, coordinate, toggle, checkbox, date, select, choices, radio-group, multi-select, option |
| Built-in actions | counter, timer, checklist, progress |
| Content organization | panel, card, grid, tabs, tab, accordion, disclosure, if |
| Navigation and prose | jump, anchor, text, section |
| Assessment and reading | quiz, steps, step |
| Hints | alert, badge, tooltip |
| Declarations and generated data | computed, const, validation, data-table, column |
| Visualization | table, chart, plot, timeline, diagram, node, edge |

48 tag names in total. `option`, `tab`, `disclosure`, `node`, `edge`, `step` and `column` are structural children of parent components. `computed`, `const` and `validation` are document declarations; they are parsed as tags but are not rendered controls. The leading `<theme>` declaration is metadata and is not counted here. Most articles only need Markdown and two or three input/display components. Plain amounts can be written directly as `{{ total }} USD`; currency formatting and statistic cards are not entry-level requirements.

This draft does not accept legacy tags such as form, submit, button, each, list, spinner, stat or value, nor set/reset action attributes or on-* event attributes. The panel reset is a fixed boolean option, not a programmable action.

## 13. Diagnostics and acceptance rules

Diagnostics include severity, category, a short explanation, source line/column and a fix suggestion. A structurally complete unknown tag region is displayed from escaped original source with a `local.component.unknown` warning; its controls and interpolations are not executed. Normal footnotes produce no unsupported-syntax warning. Other prose and interactions keep working. Component tag structures that cannot be reliably recovered, attribute or expression errors on known components, binding errors and resource budget problems still block compilation. Runtime local computation errors are isolated as described in section 5.

| Category | Example | What it should explain |
| --- | --- | --- |
| Tag structure | card unclosed, wrong nesting | The required end tag and start position |
| Unknown tag warning | slidr | Unknown name, spelling suggestion and local source fallback |
| Invalid syntax | on-click, actions configuration block | Attribute or legacy syntax not in the current mode |
| Binding | references seats but only seat is declared | The missing parameter and candidate names |
| Initial value | initial written twice for a same-name parameter | Both conflict positions |
| Type | using a string as an if condition | Actual type and expected boolean type |
| Constraint | slider initial value exceeds max | Valid range and current value |
| Table | numeric column contains "20 USD" | Column name, row number and that a number is required |
| Diagram | edge points to a nonexistent node | The missing node ID |
| Declaration | computed inside a container or a duplicate name | Top-level placement, the conflicting name or control |
| Data table | data-table without a column, or a duplicated key | Required column and unique stable key |
| Validation | fields names a read-only declaration | Writable public binding names |
| Math | integral or missing parameter in a plot | The math fragment and supported scope |

Implementation acceptance must cover:

1. Every regular new example compiles according to this specification; the diagnostics example reports the expected errors it lists.
2. Headings, tables, lists and code inside Markdown containers parse normally; tags and interpolations inside code and comments are inactive.
3. Components without bind work independently; bindings across components stay in sync, and an explicit initial value is applied only once.
4. Forward references, conditional hiding, tab switching and panel reset follow the same state rules.
5. Parameter panels, checklists, local catalog search and timing operations require no scripts, configuration blocks or service calls.
6. Chart values preserve types, and empty data, error values and zero proportions have explicit displays.
7. Regular LaTeX fractions, implicit multiplication, functions, parameters and piecewise functions are computable; unsupported structures are diagnosed clearly; discontinuities are not connected incorrectly.
8. Diagram auto-layout, detail display and bound selection work; missing edge endpoints are errors.
9. Chinese IME input, keyboard operation, accessible names and 375px narrow screens work.
10. Document instances are independent, disposal cleans up, and no unintended network actions occur; complex or excessive math input can be halted by the execution budget.

These rules cover compiler, runtime and browser acceptance. See the [example index](../examples/local/README.md) for example mappings and expected observations, and the [language conformance data](../examples/conformance/README.md) for the machine-readable minimum acceptance set. Actual repository check records stay in the repository and are not part of the package.


See [local-draft-2 components and migration](local-components-v2-en.md) for new tags, colors and slot state, and [0.4.0 release and migration](release-0.4.0-en.md) for the upgrade checklist. `0.4.0` is the preview release on the `next` channel.
