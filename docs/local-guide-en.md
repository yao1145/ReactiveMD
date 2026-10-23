# Reactive MD beginner guide

This guide is for readers who know Markdown and have seen a little HTML but have not used Reactive MD. By the end, you should be able to write local interactive documents with input controls, live calculations, conditional content, charts and diagrams on your own.

This document covers the `local-draft-1` local interaction syntax. See the [local interaction syntax specification](local-interaction-syntax-en.md) for complete rules and the [example directory](../examples/local/README.md) for complete documents you can run directly. The specification is the authoritative source for more complete component and expression details. See [Versions and compatibility](compatibility-en.md) for package versions, syntax revisions and migration rules.

## Table of contents

- [1. Build intuition first](#1-build-intuition-first)
- [2. Five minutes: your first interactive document](#2-five-minutes-your-first-interactive-document)
- [3. How to write tags](#3-how-to-write-tags)
- [4. Parameters: name with bind, set initial values with initial](#4-parameters-name-with-bind-set-initial-values-with-initial)
- [5. Common input controls](#5-common-input-controls)
- [6. Expressions: make text follow parameters](#6-expressions-make-text-follow-parameters)
- [7. Conditions and content organization](#7-conditions-and-content-organization)
- [8. Checklists, progress, timers and timelines](#8-checklists-progress-timers-and-timelines)
- [9. Tables and charts](#9-tables-and-charts)
- [10. Diagrams and function curves](#10-diagrams-and-function-curves)
- [11. Common errors at a glance](#11-common-errors-at-a-glance)
- [12. Complete exercise: workshop signup page](#12-complete-exercise-workshop-signup-page)
- [13. Next steps](#13-next-steps)
- [Appendix A: Component reference](#appendix-a-component-reference)

## 1. Build intuition first

### 1.1 What problem does it solve

Plain Markdown produces fixed content. Reactive MD adds one thing on top: readers can change parameters, and prose, formulas, tables, charts and diagrams update immediately.

For example, take a fixed sentence:

```markdown
People: 3. At 100 USD each, the total is 300 USD.
```

Turn it into an adjustable version:

```markdown
<slider bind="people" label="People" initial="3" min="1" max="20">

People: **{{ people }}**. At 100 USD each, the total is **{{ people * 100 }} USD**.
```

The reader drags the slider and both numbers update together. The document author wrote no JavaScript and no CSS.

### 1.2 How it maps to Markdown and HTML

You can think of Reactive MD as Markdown prose plus a small fixed set of HTML-style tags plus template expressions.

| What you already know | In Reactive MD |
| --- | --- |
| Markdown headings, paragraphs, lists, quotes, links, images | Used as-is |
| Markdown tables | Used as-is; you can also put them in `<table>` for search and sorting |
| HTML tags | Use only the component tags listed in the docs, such as `<slider>`, `<card>` |
| HTML attributes | Write `label="People"`, lowercase attribute names, quoted values |
| JavaScript variables | Name controls with `bind="people"` |
| Template strings `${...}` | Read and compute with `{{ people * 100 }}` |
| `onclick` events | Not supported; components provide the interactions they need |
| `class`, `style`, `<script>` | Not supported; components provide styling |

### 1.3 Data flow in three steps

1. **Declare**: input controls name a parameter with `bind` and give an initial value with `initial`.
2. **Read**: `{{ expression }}` in prose, tables or attributes reads parameters and computes values.
3. **Update**: when the reader operates a control, every place that reads that parameter refreshes automatically.

Remember the two connection rules, `bind` and `{{ }}`; every other component builds layout, selection, search, timing and similar capabilities on top of them.

## 2. Five minutes: your first interactive document

### 2.1 Complete example

Paste the following into the Playground:

```markdown
# Cost estimate

<panel title="Adjust the plan">
<slider bind="people" label="People" initial="2" min="1" max="20">
<toggle bind="annual" label="Annual billing">
</panel>

People: **{{ people }}**.

Monthly cost: **{{ people * (annual ? 80 : 100) }} USD**.
```

Line by line:

- `<panel>` is a paired tag that wraps a group of related controls and includes a restore-defaults button.
- `<slider>` is a void tag and does not need `</slider>`.
- `bind="people"` declares a numeric parameter `people`.
- `initial="2"` is the initial value. `min` and `max` are the slider range.
- `<toggle>` declares the boolean parameter `annual`; when `initial` is omitted it defaults to off.
- `{{ people }}` displays the current count, and `{{ people * (annual ? 80 : 100) }}` computes the monthly cost.
- `annual ? 80 : 100` is a conditional expression: annual billing takes 80, otherwise 100.

Click restore-defaults in the panel and both the count and the toggle return to their initial values.

### 2.2 Run and modify

In the repository root, run:

```sh
npm run dev
```

Open `http://127.0.0.1:5173` in a browser; edit Markdown on the left and see a live preview on the right. You can also open the online demo at [yaozi.raricy.com](https://yaozi.raricy.com/).

A good start is to copy a short document from the [example directory](../examples/local/README.md) into the editor, change a number or some text, watch the right side, and then come back to the following sections.

### 2.3 Small widgets without shared parameters

If a control does not need to be read by the prose, you can omit `bind` entirely:

```markdown
<counter label="People" initial="2" min="1" max="20">

<timer label="One-minute focus" duration="60">
```

They remain interactive; they just have no public variable. This suits standalone tools such as a people counter or a focus timer.

## 3. How to write tags

### 3.1 Two tag shapes

| Shape | Form | Rules |
| --- | --- | --- |
| Void component | `<slider bind="a" label="Amplitude">` | No end tag; `<slider ... />` is also accepted |
| Container with content | `<card title="Notes">` and `</card>` | Must be closed explicitly; nesting is allowed |

Void components are fixed to:

`input`, `textarea`, `number`, `slider`, `toggle`, `checkbox`, `date`, `counter`, `timer`, `progress`, `edge`.

All other components use paired tags. In particular, `textarea` text is set through `initial`, so it has no body; do not write `<textarea>content</textarea>`.

Containers with content can nest Markdown and other components:

```markdown
<card title="Plan notes">
Price updates with **People**.

<slider bind="people" label="People" initial="2" min="1" max="20">

Total cost: {{ people * 100 }} USD.
</card>
```

Tags can span lines, and attributes can be split across lines:

```markdown
<slider
  bind="people"
  label="People"
  initial="2"
  min="1"
  max="20">
```

### 3.2 Attribute rules

- Tag and attribute names use lowercase kebab-case, for example `<radio-group>`, `page-size="5"`.
- Attribute values are enclosed in double or single quotes.
- Attribute order has no meaning; writing the same attribute twice is an error.
- Boolean attributes may omit their value, for example `required` means `true`.
- Boolean values can also be written explicitly as `required="false"`.
- Attribute values may contain `>`; as long as it is inside quotes, it does not end the tag early.
- `&quot;`, `&apos;`, `&amp;`, `&lt;` and `&gt;` in attribute values decode to the corresponding characters.

Dynamic attributes come in two kinds:

```markdown
<!-- Text attributes can mix plain text and interpolation -->
<toggle bind="locked" label="Lock people count">
<slider bind="people" label="Current people: {{ people }}" disabled="{{ locked }}">

<!-- Conditions must be a complete boolean interpolation -->
<if when="{{ people >= 5 }}">
The group has reached 5 people.
</if>
```

Structural attributes such as `bind`, `initial`, `id`, `value`, `from`, `to` and `kind` must be static text and cannot contain interpolation.

### 3.3 Markdown is still in charge

Container contents continue to parse as Markdown; no extra `markdown` attribute is needed. Headings, emphasis, links, images, quotes, lists, plain tables, inline code and code fences all work as usual.

```markdown
<card title="References">
- [Markdown guide](https://commonmark.org/help/)
- Image: ![diagram](images/example.png) (replace the path with your own image)

> Quotes can also go inside cards.
</card>
```

Tags, interpolations and formula markers inside code fences are displayed verbatim and do not create controls:

````markdown
```markdown
<slider bind="example" label="Example">
Current value: {{ example }}.
```
````

HTML comments `<!-- ... -->` are ignored and produce no components or variables. Raw HTML is not executed as web elements; organize content with Markdown or the matching components. Structurally complete unknown tags are kept as source text with a warning, and their inner tags and interpolations are displayed verbatim as well. `style`, event attributes and similar on known components are still compile errors.

Footnotes currently preserve the reference marker and definition source and produce a `local.footnote.unsupported` warning. Tags and interpolations inside footnote content are displayed verbatim.

Tables of contents use ordinary Markdown links: `[Parameter description](#parameter-description)` corresponds to `## Parameter description`. English headings are named in lowercase with hyphens, for example `## Hello World` corresponds to `#hello-world`; duplicate headings get `-1`, `-2` appended. Dynamic text in headings generates anchors from initial parameter values, so the table of contents keeps pointing at the same heading after parameters change. The renderer isolates anchors for different documents on the same page, so no prefix is needed in the source.

Indentation only affects readability: container content is dedented by the common indentation before parsing; indentation inside code fences is preserved. Plain prose is best left unindented.

### 3.4 Key differences from HTML

| HTML habit | Reactive MD approach |
| --- | --- |
| `<div>` wrapping a block | Use `<card>` or `<panel>` |
| `<input type="range">` | Use `<slider>` |
| `<input type="checkbox">` | Use `<checkbox>` or `<toggle>` |
| `<select>` + `<option>` | Use `<select>`, `<choices>` or `<radio-group>` + `<option>` |
| `onclick="..."` | Event attributes are not supported; components provide interactions |
| `class="..."`, `style="..."` | Author styles are not supported |
| `<script>`, `<style>` | Not supported |
| JavaScript variables | Declare parameters with `bind` |
| Template strings | Use `{{ expression }}` |
| Elements can self-close or tolerate errors | Paired tags must close strictly; mismatches produce diagnostics |

In one sentence: tags are only the outward shape of components, not HTML you can freely extend.

## 4. Parameters: name with bind, set initial values with initial

### 4.1 Naming rules

`bind` values must match `[A-Za-z_][A-Za-z0-9_]*` and are case-sensitive. Prefer meaningful English names, for example `people`, `annual`, `budgetLevel`.

The following names cannot be used as parameter names:

- Plot reserved names: `x`, `y`
- Constants: `pi`, `e`
- Literals: `true`, `false`, `null`
- Expression function names: `abs`, `sqrt`, `round`, `min`, `max`, `len`, `contains` and so on

Chinese cannot be used directly as a `bind` name. Put display text in `label` instead.

### 4.2 Types and defaults

Parameter types are determined by the component, not guessed from input text.

| Component | Public value | Initial value when initial is omitted |
| --- | --- | --- |
| `input`, `textarea` | String | Empty string |
| `date` | Date string | Empty string |
| `number` | Number | The valid step value within range closest to 0 |
| `slider` | Number | `min`, with a default range of 0 to 100 |
| `counter` | Number | The valid step value within range closest to 0 |
| `toggle`, `checkbox` | Boolean | `false` |
| `select`, `choices`, `radio-group` | Option string | value of the first option |
| `tabs` | Page string | value of the first tab |
| `diagram` | Node ID string | id of the first node |
| `checklist` | String array of checked item IDs | Determined by the task list check marks |
| `timer` | Remaining seconds | `duration`, default 60 |

### 4.3 Three rules for initial

1. A parameter has at most one explicit `initial`. When several controls share a variable, write it on only one of them.
2. `initial` must be a static value and cannot contain `{{ }}`.
3. The initial value must satisfy the component constraints. Numbers must be between `min` and `max` and land on a step; selector initial values must be the value of an existing option; dates must be valid `YYYY-MM-DD`.

`timer` uses `duration` for its length, and `checklist` uses the `[x]` marks in its task list for initial state; neither accepts `initial`.

### 4.4 One variable, several controls

Controls of the same kind can bind the same variable and stay in sync:

```markdown
<slider bind="people" label="People" initial="2" min="1" max="20">
<number bind="people" label="Exact count" min="1" max="20" step="1">

Current people: {{ people }}.
```

Notes:

- Do not write `initial` on the second control.
- The numeric range and step must match on both controls.
- Different families such as text, number, boolean, date and choice cannot share a variable.
- When selectors share a variable, option values and order must be identical.
- The public state of `timer`, `checklist`, `tabs` and `diagram` can be owned by only one component and cannot be shared.

### 4.5 Components without bind

Without `bind`, a component keeps independent internal state, and the prose cannot read it. The control still needs `label`, because label is also its accessible name.

```markdown
<counter label="Participants" initial="2" min="1" max="20">
```

If you later need to show the count in the prose, add `bind="count"` and read it with `{{ count }}`.

## 5. Common input controls

All input components support `label`, optional `bind`, optional `initial` and dynamic `disabled`. A control label is required.

### 5.1 Text and numbers

```markdown
<input bind="name" label="Name" placeholder="What should we call you?">

<textarea bind="message" label="Thoughts" placeholder="For example: a handout with adjustable parameters" rows="4">

<number bind="quantity" label="Quantity" initial="3" min="1" max="20" step="1">

<slider bind="budget" label="Budget tier" initial="50" min="0" max="100" step="10">
```

- `input` defaults to `type="text"` and also supports `type="email"`.
- `input` supports `required`, `min-length` and `max-length`.
- `textarea` initial text goes in `initial`, and the number of rows in `rows`.
- `number` has `step` default 1; `min` and `max` are optional.
- `slider` has a default range of 0 to 100 and a default step of 1.

### 5.2 Toggles and dates

```markdown
<toggle bind="annual" label="Annual billing">

<checkbox bind="express" label="Expedited service">

<date bind="appointment" label="Planned date" initial="2026-10-22">
```

`toggle` and `checkbox` both have boolean values; the difference is mainly appearance and use case. An empty date string means not yet selected.

### 5.3 Selectors

`select`, `choices` and `radio-group` are written the same way and differ only in appearance: dropdown, option cards and radio button group. Their bodies contain one or more `<option>` elements.

```markdown
<choices bind="plan" label="Plan">
<option value="basic">Basic</option>
<option value="pro">Pro</option>
</choices>
```

Rules:

- `option` must have a `value`, unique within the group.
- `value` is a static string and cannot contain interpolation.
- The option body is regular inline Markdown and can be bold, but cannot contain another interactive component.
- When `initial` is omitted, the first option is selected by default.

The bound value is the selected `value`, so prose usually tests it like this (assuming `plan` above is declared):

```markdown
Current plan: **{{ plan == 'pro' ? 'Pro' : 'Basic' }}**.
```

### 5.4 Compose a small form

```markdown
<panel title="Configure a plan">
<input bind="name" label="Name">
<number bind="quantity" label="Quantity" initial="3" min="1" max="20">
<choices bind="plan" label="Plan">
<option value="basic">Basic</option>
<option value="pro">Pro</option>
</choices>
<toggle bind="annual" label="Annual billing">
</panel>

Hello, **{{ name == '' ? 'friend' : name }}**.

Estimated cost: **{{ round(quantity * 80 * (plan == 'pro' ? 1 : 0.8) * (annual ? 0.8 : 1)) }} USD**.
```

This uses string comparison, a conditional expression and `round`. `name` starts as an empty string, so the first render shows "friend".

### 5.5 Input constraints and disabling

`required`, `min-length`, `max-length` and email format show hints after the first blur and update with input afterwards. Text with an invalid format stays as an editing draft but does not replace the last valid public value.

`disabled` can be controlled dynamically:

```markdown
<toggle bind="locked" label="Lock people count">
<slider bind="people" label="People" initial="2" min="1" max="20" disabled="{{ locked }}">
```

When `locked` is true, the slider does not accept reader input. A dynamic boolean attribute must be one complete `{{ }}`.

## 6. Expressions: make text follow parameters

### 6.1 Basic operations

Inside `{{ }}` is an expression, not JavaScript. It supports:

| Category | Form |
| --- | --- |
| Numbers, strings, booleans, null | `2`, `'text'`, `true`, `false`, `null` |
| Parameters | `people`, `annual` |
| Arithmetic | `+`, `-`, `*`, `/`, `%`, unary plus/minus, parentheses |
| Comparison | `==`, `!=`, `<`, `<=`, `>`, `>=` |
| Logic | `!`, `&&`, `\|\|` |
| Conditional | `condition ? trueValue : falseValue` |
| Functions | `round`, `min`, `max`, `sqrt`, `len` and so on |
| Constants | `pi`, `e` |

Examples (assuming `people`, `annual` and `price` are declared in the document):

```markdown
{{ people * 100 }}
{{ people >= 5 ? 'Team tier' : 'Individual tier' }}
{{ annual && people >= 3 }}
{{ round(price * 0.8 * 100) / 100 }}
```

Notes:

- Multiplication must be written `*`. `2x` is not multiplication in a prose expression.
- Use `pow(x, 2)` for exponents; `x^2` is not accepted.
- String concatenation also uses `+`, but both sides must be strings.
- Comparison does not do implicit type conversion. `'5' == 5` does not yield `true`.
- `if` conditions and logical operations need real booleans; numbers cannot stand in for them.

### 6.2 Strings and conditions

Strings can use single or double quotes; escapes are `\\`, `\'`, `\"`, `\n`, `\t`. Example (assuming `name` and `annual` are declared):

```markdown
Name: {{ name == '' ? 'Not provided' : name }}
Billing: {{ annual ? 'Annual' : 'Monthly' }}
```

Conditional expressions can nest, but do not go too deep. When readability suffers, split part of the content into an `if` container.

### 6.3 Functions

| Function | Purpose |
| --- | --- |
| `abs(x)` | Absolute value |
| `sqrt(x)` | Square root |
| `floor(x)`, `ceil(x)`, `round(x)` | Round down, round up, round to nearest |
| `min(a, b, ...)`, `max(a, b, ...)` | Minimum, maximum |
| `pow(base, exponent)` | Exponentiation |
| `sin`, `cos`, `tan`, `asin`, `acos`, `atan` | Trigonometric functions, in radians |
| `exp(x)`, `log(x)` | Exponential and natural logarithm |
| `len(value)` | Unicode code points in a string or array length |
| `contains(value, needle)` | Substring or array membership test |
| `clamp(value, lower, upper)` | Clamp a value to a closed interval |

`pi` and `e` are constants. `log` is the natural logarithm; this differs from LaTeX, where `\log` without a subscript is base 10 by default.

### 6.4 Common boundaries

- Arrays cannot be displayed directly. A `checklist` value is an array; use `len(done)` for the count and `contains(done, ...)` for membership.
- `null` displays as an empty string.
- Division by zero, domain errors, non-finite results and type errors show "Unable to compute" near the corresponding content, while other independent content keeps updating.
- Expressions have no assignment, method calls, property access, custom functions or imports.
- Expressions cannot read or write the DOM and cannot make network requests.

To write logical OR in a GFM table, escape the pipes:

```markdown
<toggle bind="ready" label="Ready">
<toggle bind="approved" label="Approved">

| Status | Notes |
| --- | --- |
| {{ ready \|\| approved ? 'Available' : 'Unavailable' }} | `\|\|` in a table means logical OR |
```

### 6.5 A rounding example

```markdown
<number bind="total" label="Bill amount" initial="240" min="0">
<slider bind="people" label="People splitting" initial="3" min="1" max="12">
<slider bind="tip" label="Extra charge (%)" initial="10" min="0" max="20">

Each person pays **{{ round(total * (1 + tip / 100) / people * 100) / 100 }} USD**.
```

`round` keeps only the integer part; dividing by 100 afterwards gives two decimal places. Trailing zeros are not padded, which is normal display behavior.

## 7. Conditions and content organization

### 7.1 Use if to control display

```markdown
<slider bind="people" label="People" initial="2" min="1" max="20">

<if when="{{ people >= 5 }}">
<alert tone="success" title="Team plan">
The group has reached 5 people, so you can compare billing options.
</alert>
</if>
```

`when` must be a complete boolean interpolation. Neither of these is correct:

```markdown
<!-- Wrong: a number is not a boolean -->
<if when="{{ people }}">

<!-- Wrong: not a complete interpolation -->
<if when="People: {{ people }}">
```

When the condition is false, content is hidden, but internal parameters are still initialized; unknown variables or type errors in hidden branches are still compile errors. When the conditional region is shown again, existing input state is preserved.

### 7.2 panel, card and grid

- `<panel>`: wraps a group of parameters and provides restore-defaults by default. Good for forms.
- `<card>`: a content card for standalone explanations.
- `<grid>`: side-by-side layout; direct children must be `<card>`, two columns by default.

```markdown
<grid columns="2">
<card title="Basic">
For individuals and small projects.
</card>

<card title="Pro">
For teams that need collaboration.
</card>
</grid>
```

Narrow screens switch to a single column automatically. `columns` accepts 1 to 4.

### 7.3 tabs and accordion

```markdown
<tabs label="Plan details">
<tab label="Feature comparison">
| Capability | Basic | Pro |
| --- | --- | --- |
| Parameter adjustment | Yes | Yes |
| Charts | No | Yes |
</tab>

<tab label="Buying advice">
Decide on the use case first, then compare billing periods.
</tab>
</tabs>

<accordion label="FAQ">
<disclosure label="How is the cost calculated?">
Annual billing is calculated at 80%.
</disclosure>

<disclosure label="Can I switch at any time?">
Yes, just use the toggle above.
</disclosure>
</accordion>
```

- `tab` requires `label`; when `value` is omitted, an internal value is generated.
- `accordion` direct children are `disclosure`, and multiple entries can be expanded at once.
- `disclosure` accepts `open` to start expanded.

Tab switching preserves child content state; timers in hidden regions pause and stay paused when shown again until the reader starts them.

### 7.4 alert, badge and tooltip

```markdown
<alert title="Note">
General information.
</alert>

<alert tone="warning" title="Careful">
A panel reset restores all parameters inside it.
</alert>

Status: <badge tone="success">Ready</badge>

Hover over <tooltip text="When input changes, related content updates automatically.">reactive binding</tooltip> for details.
```

`alert` tone can be `info`, `success` or `warning`. `badge` tone can be `neutral`, `success` or `warning`. `badge` and `tooltip` are inline components and can sit inside sentences.

## 8. Checklists, progress, timers and timelines

### 8.1 Checklists

```markdown
<checklist bind="done" label="Try it out">
- [x] Read the example
- [ ] Adjust parameters
- [ ] Try it on a narrow screen
</checklist>

Completed **{{ len(done) }} / 3** items.

<progress label="Completion" value="{{ len(done) / 3 * 100 }}">
```

- The `checklist` body must be a non-empty, single-level Markdown task list.
- `[x]` is the initial checked state, which reset restores.
- The public value is an array of internal IDs of selected items; usually use `len` for the count.
- `progress` `value` must be between 0 and `max`; out-of-range values produce diagnostics and are not silently clamped.

### 8.2 Timers

```markdown
<timer label="One-minute focus" duration="60">

<timer bind="remaining" label="Readable countdown" duration="90">

Remaining seconds: {{ remaining }}.
```

`duration` is a positive integer number of seconds, default 60. The timer has built-in start, pause and reset and stops at zero. It does not need `initial`.

### 8.3 Timelines

```markdown
<timeline title="Half-day plan" unit="minutes">
| Task | Start | Duration | Notes |
| --- | ---: | ---: | --- |
| Prepare | 0 | 10 | List materials |
| Write | 10 | 25 | Complete the main body |
| Review | 35 | 10 | Leave time for a second pass |
</timeline>
```

The header must contain `Task`, `Start` and `Duration`, with optional `Notes`. Start times and durations are non-negative numbers, overlapping intervals are allowed, and sorting is stable by start time.

## 9. Tables and charts

### 9.1 Plain and enhanced tables

Plain Markdown tables remain static content:

```markdown
| Plan | Price |
| --- | ---: |
| Basic | 100 |
| Pro | 200 |
```

Put one inside `<table>` to get search, sorting and paging automatically:

```markdown
<table label="Component catalog" page-size="3">
| Name | Category | Purpose |
| --- | --- | --- |
| slider | Parameter | Adjust a number |
| toggle | Parameter | On/off switch |
| chart | Visual | Turn a table into a chart |
| diagram | Visual | Click a node to see notes |
</table>
```

`table` supports `searchable`, `sortable` and `page-size`. Search and sorting affect only the table; a panel reset also restores the query, sorting and page number.

### 9.2 Build charts from tables

The `chart` body is a Markdown table:

```markdown
<chart kind="bar" title="Cost comparison" y-label="USD">
| Item | Actual | Budget |
| --- | ---: | ---: |
| Content | 120 | 150 |
| Visual | 230 | 200 |
</chart>
```

The first column is usually the horizontal-axis label, and the remaining columns are numeric series. Series names come directly from headers, and the legend is generated automatically.

Chart values can follow parameters, but cells must be pure numbers or a complete cell containing only interpolation:

```markdown
<slider bind="people" label="People" initial="2" min="1" max="20">

<chart title="Comparison by people">
| Plan | Monthly cost |
| --- | ---: |
| Basic | {{ people * 20 }} |
| Pro | {{ people * 35 }} |
</chart>
```

The following is wrong:

```markdown
| Item | 20 USD |
```

`20 USD` is mixed text and cannot be used as a numeric column. Write only `20`, or put the unit in the header or chart label.

### 9.3 Choosing a chart type

| `kind` | Suitable data |
| --- | --- |
| `bar` | Comparisons between categories; the default |
| `line` | Trends that change in order |
| `area` | Emphasizing cumulative or range trends |
| `scatter` | Relationships between two numeric values |
| `donut` | Proportions of parts in a whole |

Rules in brief:

- `bar`, `line`, `area`: first column is the horizontal axis, remaining columns are numeric series.
- `scatter`: first column is the numeric horizontal axis and the rest are numeric vertical axes by default; `x` and `y` can also name headers.
- `donut`: first column is the label and second is the value; with more than two columns, `y` must name the single numeric column.
- `donut` values must be non-negative; a zero total shows "No share to display".

`x` and `y` are static header names. `y` may be a comma-separated list of column names, so column names themselves cannot contain commas.

### 9.4 Data rules

- Headers are non-empty and unique, and every row has the same column count.
- Cells may contain interpolation.
- Plain decimal or scientific-notation text is read as a number.
- Errors such as empty rows, non-numeric values or missing columns are located at the corresponding cell.
- Charts do not accept remote URLs, `data` attributes or API data; data must be written in the document.

## 10. Diagrams and function curves

### 10.1 Interactive diagrams

```markdown
<diagram bind="selected" initial="input" label="State flow">
<node id="input" label="Input">
The reader changes parameters through controls.
</node>

<node id="view" label="Display">
Prose and charts update with the result.
</node>

<edge from="input" to="view" label="Trigger update">
</diagram>

Current stage: {{ selected == 'input' ? 'Input' : 'Display' }}.
```

- The `diagram` body may contain only `node`, `edge` and whitespace.
- `node` requires `id` and `label`; its body is static Markdown notes.
- `edge` takes `from` and `to`; both ends must exist, and `label` is optional.
- Nodes are laid out automatically, with no coordinates needed; `direction="down"` switches to vertical layout.
- `initial` must be the id of an existing node; when omitted, the first node is selected.
- With `bind`, the selected node id is public; without `bind`, selection stays inside the component.

### 10.2 Draw function curves with LaTeX

```markdown
<slider bind="a" label="Amplitude" initial="1" min="0" max="3" step="0.5">

<plot min="-6" max="6" label="Sine curve" x-label="x" y-label="Displacement">
$$ y = a \sin x $$
</plot>
```

- The `plot` body may contain only whitespace and standalone formula blocks.
- Each `$$ ... $$` block defines one curve.
- Each block must be written `y = expression`; only explicit real functions y(x) are computed.
- Use multiple formula blocks for multiple curves; do not treat ordinary line breaks as separators.

```markdown
<plot min="-5" max="5" label="Two curves">
$$ y = x^2 $$
$$ y = 2x + 1 $$
</plot>
```

`min` and `max` may be dynamic, for example `max="{{ t }}"`; `samples` is a static integer from 2 to 2000; the vertical axis is determined automatically from samples in the current range.

### 10.3 How parameter names map

Parameter names in LaTeX map to `bind` names in the document:

| Form | Corresponding parameter |
| --- | --- |
| `a`, `f`, `t` | Same-name `bind="a"`, `bind="f"`, `bind="t"` |
| `abx` | `a × b × x` |
| `\mathrm{amplitude}` | `bind="amplitude"` |
| `\alpha`, `\beta`, `\theta` | Same-name English bind |
| `\pi` | Fixed circle constant, not a parameter |
| `x` | Plot variable |
| `y` | Output marker |

`x` and `y` cannot be bound to controls. Multi-letter parameters must use `\mathrm{name}`, and the command cannot contain spaces or interpolation.

### 10.4 Computable LaTeX and common pitfalls

Supported forms include the four operations, implicit multiplication, exponents, fractions, roots, grouping, trigonometric and inverse trigonometric functions, exponential and logarithm, absolute value, `min`/`max`, constants and piecewise functions.

```markdown
<plot min="0" max="10" label="Piecewise function">
$$
y = \begin{cases}
x, & x < 5 \\
10 - x, & x \ge 5
\end{cases}
$$
</plot>
```

Notes:

- LaTeX allows implicit multiplication, for example `2x`, `a\sin x`, `(x+1)(x-1)`.
- Prose expressions must use `*`; these are two different writing rules.
- `\sin 2x` means `sin(2x)`; use parentheses for complex arguments.
- `-x^2` means `-(x^2)`.
- `1/2x` is interpreted as `(1/2)x`; use `\frac` to make the denominator explicit.
- `\log x` is base 10 by default, and `\ln x` is the natural logarithm; `log` in prose expressions is the natural logarithm.
- Integrals, derivatives, sums, matrices, parametric curves, implicit equations and custom macros are not computable in the first version. Being able to display them does not mean they can be evaluated.
- Do not write `{{ }}` inside `plot`; parameters use the mapped math names directly.

## 11. Common errors at a glance

| Symptom or diagnostic | Common cause | Fix |
| --- | --- | --- |
| Unknown component `slidr` warning, local source display | Misspelled tag | Change to `slider`; other content still works |
| Missing `</card>` | A paired tag is not closed | Add the end tag and check nesting order |
| Reference to undeclared `seat` | Inconsistent `bind` spelling | Use `seats` consistently |
| Duplicate `initial` | Initial value written on two controls for one parameter | Keep only one |
| Initial value out of range | `initial="12"` but `max="10"` | Adjust the initial value or range |
| `if` condition type error | `when="{{ seats }}"` yields a number | Change to `when="{{ seats >= 5 }}"` |
| `on-click` is not part of the component | Attempting an event handler | Remove the event attribute and use component interactions |
| HTML tags display as source or report structure errors | Unknown tag or missing end tag | Use Markdown or the matching component, and check closing |
| Footnote displays as source with a warning | Footnote layout not yet supported | Turn it into prose notes for now |
| Chart shows a "20 USD" error | Text mixed into a numeric column | Write only the number and put the unit in the header |
| `edge` points to a nonexistent node | Typo in the `to` id | Use consistent node ids |
| Plot says integrals are unsupported | Formula outside the first version's computable scope | Use a supported function, or display it without plotting |
| `\|\|` in a table errors | GFM tables treat pipes as column separators | Write `\|\|` |
| Tags display as text | Inside a code fence or after a backslash escape | This is expected verbatim display |
| `textarea` body has no effect | `textarea` is a void component | Set text with `initial="..."` |
| Paired component written as `/>` | `<card ... />` does not close automatically | Use a start tag plus an end tag |

### 11.1 How to read diagnostics

Diagnostics give the source location, severity, category and a short explanation; common categories include tag structure, unknown syntax, bindings, initial values, types, constraints, tables, diagrams and math problems.

The Playground's left editor and right diagnostics panel locate problems together. Fallback warnings for unknown tags and footnotes preserve the source while other content and interactions keep working; controls inside unknown regions do not create bindings. Unclosed tags, invalid attributes on known components, expression or binding errors and resource limits still block compilation and disable interaction. Runtime local computation errors affect only the corresponding content, and other parts keep updating.

When debugging, fix the first error. Later errors are sometimes only knock-on effects of the first one.

### 11.2 How to show literals

To display `{{` in prose, write `\{{`; to display a tag example, use a backslash or inline code:

```markdown
This shows a literal: \{{ people }}.

Inline code is safest: `<slider bind="x" label="Example">`.
```

Everything inside a code fence is displayed verbatim; it creates no controls and is not evaluated.

## 12. Complete exercise: workshop signup page

Paste the following document into the Playground, try changing the copy and parameters, and then check yourself against the list that follows.

```markdown
# Weekend photography workshop

<panel title="Signup plan">
<slider bind="people" label="People" initial="4" min="1" max="12">
<toggle bind="annual" label="Member discount">
<choices bind="track" label="Course track">
<option value="portrait">Portrait</option>
<option value="landscape">Landscape</option>
</choices>
</panel>

Track: **{{ track == 'portrait' ? 'Portrait' : 'Landscape' }}**.

Cost per person: **{{ annual ? 240 : 300 }} USD**.

Total: **{{ people * (annual ? 240 : 300) }} USD**.

<if when="{{ people >= 6 }}">
<alert tone="success" title="Group arrangements">
The group has reached 6 people; we will contact you separately to confirm the venue.
</alert>
</if>

<chart title="Budget comparison for two plans" y-label="USD">
| Item | Basic | Full |
| --- | ---: | ---: |
| Course | {{ people * 300 }} | {{ people * 380 }} |
</chart>

<checklist bind="prepared" label="Before the workshop">
- [ ] Confirm the date
- [ ] Prepare equipment
- [ ] Check the weather
</checklist>

<progress label="Preparation progress" value="{{ len(prepared) / 3 * 100 }}">
```

This document covers:

- Three different kinds of parameters inside a panel
- Conditional expressions and arithmetic in prose
- An `if` conditional region
- Chart data driven by parameters
- Checklists, progress and panel reset

### 12.1 Self-check after writing a document

1. Every input control has a `label`.
2. Every parameter referenced in prose has a matching `bind` on some control.
3. Each parameter has only one explicit `initial`, and the initial value is within the allowed range.
4. All `if` conditions are boolean expressions.
5. Chart numeric columns have no units and no mixed text.
6. All paired tags close correctly, and no container is written as self-closing.
7. All code examples are inside code fences.
8. Check the layout at narrow widths, and check buttons, options and hints with the keyboard.
9. Click restore-defaults in the panel and confirm parameters and component state restore together.
10. The document does not depend on network requests, external data or event handlers.

## 13. Next steps

- To see finished documents: open the [example directory](../examples/local/README.md) and start with the counter, the plan calculator and the interactive diagram.
- To learn all components and boundaries: read the [local interaction syntax specification](local-interaction-syntax-en.md).
- To embed Reactive MD in your React app: read [local mode integration](local-integration-en.md).
- To see an error example: open [diagnostics.reactive.md](../examples/local/diagnostics.reactive.md) and use the diagnostics to understand common problems.
- To start the Playground: run `npm run dev` in the repository root, or visit the online demo at [yaozi.raricy.com](https://yaozi.raricy.com/).

## Appendix A: Component reference

| Purpose | Components |
| --- | --- |
| Parameter input | `input`, `textarea`, `number`, `slider`, `toggle`, `checkbox`, `date`, `select`, `choices`, `radio-group`, `option` |
| Built-in actions | `counter`, `timer`, `checklist`, `progress` |
| Content organization | `panel`, `card`, `grid`, `tabs`, `tab`, `accordion`, `disclosure`, `if` |
| Hints | `alert`, `badge`, `tooltip` |
| Visualization | `table`, `chart`, `plot`, `timeline`, `diagram`, `node`, `edge` |

`option`, `tab`, `disclosure`, `node` and `edge` are structural children of parent components and cannot be placed anywhere on their own.

Most articles only need Markdown plus two or three input components and one display component. Connect parameters to prose first, then add charts, diagrams and LaTeX curves as needed.
