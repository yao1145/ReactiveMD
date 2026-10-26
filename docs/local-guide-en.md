# Reactive MD beginner guide

[中文](local-guide-ch.md)

Add controls to Markdown and use their values in prose, calculations and charts. Start in the [online Playground](https://yaozi.raricy.com/): paste the first example into the editor and change the controls in the preview.

This guide uses `reactive-md@0.5.3` and syntax revision `local-draft-2`. For application setup, see [standalone integration examples](../examples/integration/README.md); for all attributes and rules, see the [syntax specification](local-interaction-syntax-en.md).

## Your first interactive document

```markdown
# Cost estimate

<panel title="Adjust the plan">
<slider bind="people" label="People" initial="2" min="1" max="20">
<toggle bind="annual" label="Annual billing">
</panel>

People: **{{ people }}**.

Monthly cost: **{{ people * (annual ? 80 : 100) }} USD**.
```

Drag the slider or switch annual billing on. Both values in the prose update immediately. The panel's reset button restores the controls to their defaults.

The connections are:

- `bind="people"` names a parameter; `initial="2"` sets its starting value.
- `{{ people }}` reads that value. Expressions such as `people * 100` calculate with it.
- `annual ? 80 : 100` chooses 80 when the toggle is on, otherwise 100. A toggle starts off when `initial` is omitted.

## Tags and parameters

Write lowercase tag and attribute names, with quoted attribute values. Controls such as `<slider>` and `<input>` have no closing tag. Containers such as `<panel>` and `<card>` wrap Markdown and must close with `</panel>` or `</card>`.

Each input needs a `label`. Use `bind` when other content needs its value; omit it for an independent widget such as `<timer label="Focus" duration="60">`.

Parameter names use letters, digits and underscores, starting with a letter or underscore. Names are case-sensitive. Keep display text in `label`; names such as `x`, `y`, `pi`, `e` and built-in function names are reserved.

Two numeric controls can share a parameter:

```markdown
<slider bind="people" label="People" initial="2" min="1" max="20">
<number bind="people" label="Exact count" min="1" max="20" step="1">

Current people: {{ people }}.
```

Match their range and step, and give the parameter only one explicit `initial`. Other shared control types have their own rules in the [syntax specification](local-interaction-syntax-en.md).

## Choose an input

| Need | Component | Value |
| --- | --- | --- |
| Short or multiline text | `input`, `textarea` | String |
| Exact number or adjustable range | `number`, `slider`, `counter` | Number |
| On/off choice | `toggle`, `checkbox` | Boolean |
| Calendar date | `date` | `YYYY-MM-DD` string, or empty |
| One option | `select`, `choices`, `radio-group` | Selected option's string value |
| Several options | `multi-select` | Array of selected values |

```markdown
<input bind="name" label="Name" placeholder="What should we call you?">
<textarea bind="notes" label="Notes" initial="Bring a camera" rows="3">
<date bind="day" label="Workshop date" initial="2026-10-26">

<choices bind="plan" label="Plan">
<option value="basic">Basic</option>
<option value="pro">Pro</option>
</choices>

Hello, {{ name == '' ? 'guest' : name }}. Plan: {{ plan }}.
```

`textarea` takes its text in `initial`, not in a body. Selectors default to the first option; set `initial` to an option's `value` to choose another.

## Calculate and show conditional content

Expressions support arithmetic (`+`, `-`, `*`, `/`), comparisons (`==`, `!=`, `<`, `>=`), boolean operators (`&&`, `||`, `!`) and conditional expressions (`condition ? yes : no`). Use `*` for multiplication. Conditions require booleans, and arithmetic requires numbers.

Use `computed` for a result you want to reuse:

```markdown
<number bind="quantity" label="Quantity" initial="3" min="1" max="20">
<computed name="total" value="{{ quantity * 100 }}">

Total: {{ formatCurrency(total) }}.

<if when="{{ quantity >= 5 }}">
<alert tone="success" title="Group booking">
You have enough people for a group booking.
</alert>
</if>
```

`computed` is an invisible declaration written on its own line at document top level. `const` declares a fixed value. Common functions include `round`, `min`, `max`, `len`, `contains` and `formatNumber`; see [calculations and formatting](computations-formatting-en.md) for signatures and examples.

Use `len(selected)` to count an array, such as a checklist's checked items. Expressions use the built-in language; they cannot run JavaScript or make network requests.

## Add charts and function curves

A chart reads a Markdown table. Put labels in the first column and numbers or complete `{{ expressions }}` in numeric cells. Put units in `y-label` or headers.

```markdown
<slider bind="people" label="People" initial="2" min="1" max="20">

<chart kind="bar" title="Monthly cost" y-label="USD">
| Plan | Cost |
| --- | ---: |
| Basic | {{ people * 20 }} |
| Pro | {{ people * 35 }} |
</chart>
```

Available chart kinds are `bar`, `line`, `area`, `scatter` and `donut`. To add search, sorting and paging to a table, wrap a Markdown table in `<table label="Catalog">...</table>`.

Function curves use LaTeX:

```markdown
<slider bind="a" label="Amplitude" initial="1" min="0" max="3" step="0.5">

<plot min="-6" max="6" label="Sine curve">
$$ y = a \sin x $$
</plot>
```

Each formula block defines one explicit function `y = expression`. Use math parameter names directly, without `{{ }}`. A multi-letter binding such as `amplitude` is written `\mathrm{amplitude}`. Displaying a formula and computing a curve have different supported scopes; see the [plot rules](local-interaction-syntax-en.md).

## Complete exercise: workshop signup page

Paste this whole document into the Playground. Change the group size, apply the discount and check the preparation items.

```markdown
# Weekend photography workshop

<panel title="Signup plan">
<slider bind="people" label="People" initial="4" min="1" max="12">
<toggle bind="member" label="Member discount">
<choices bind="track" label="Course track">
<option value="portrait">Portrait</option>
<option value="landscape">Landscape</option>
</choices>
</panel>

<computed name="total" value="{{ people * (member ? 240 : 300) }}">

Track: {{ track == 'portrait' ? 'Portrait' : 'Landscape' }}.

Total: **{{ formatCurrency(total) }}**.

<if when="{{ people >= 6 }}">
<alert tone="success" title="Group arrangements">
We will contact you to confirm a venue for your group.
</alert>
</if>

<chart title="Budget comparison" y-label="USD">
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

The checklist starts from its `[ ]` / `[x]` marks and exposes an array; `len(prepared)` counts the checked items. The panel reset applies to the controls inside that panel. The checklist here is outside it.

Try adding a `<number>` that shares `people`, or change the chart to compare discounted and full-price totals. Check that the document works with the keyboard and at a narrow screen width.

## Common errors

| Problem | Fix |
| --- | --- |
| A parameter is undeclared | Match the expression's spelling and case to its `bind` or `computed` name. |
| Duplicate `initial` | Keep one explicit initial value per shared parameter. |
| Invalid initial number | Keep it within `min` / `max` and on a valid `step`. |
| An `if` condition has the wrong type | Use a comparison such as `when="{{ people >= 5 }}"`. |
| A chart rejects `20 USD` | Use `20` in the cell and put the unit in the label. |
| A container is unclosed | Check closing tags and nesting; `<card />` does not close a container. |
| A tag or expression displays literally | Check whether it is inside code or escaped. Unknown tags also produce fallback warnings. |
| A table breaks at logical OR | Escape the pipes as `\|\|` inside Markdown table cells. |
| A plot rejects a formula | Check its computable LaTeX scope and use `\mathrm{name}` for multi-letter bindings. |

Fix the first diagnostic before later ones. Compile errors block the preview; fallback warnings preserve the affected source. A runtime calculation error affects the corresponding content while independent content keeps updating.

Use inline code or code fences to show literal tags and expressions. For a literal interpolation in prose, write `\{{ people }}`.

## Where to go next

| Goal | Reference |
| --- | --- |
| Browse runnable documents | [Example directory](../examples/local/README.md) |
| Learn tabs, cards, diagrams and other components | [Syntax specification](local-interaction-syntax-en.md) and [component extensions](local-components-v2-en.md) |
| Add validation or generated tables | [Constraints and collections](constraints-collections-en.md) |
| Export an interactive HTML file | [Shareable documents](shareable-export-en.md) |
| Embed the renderer or editor | [Host integration](local-integration-en.md) and [editor guide](editor-en.md) |
| Check versions and migration | [Versions and compatibility](compatibility-en.md) |

To run the Playground from the repository, install dependencies with `npm ci`, run `npm run dev` and open `http://127.0.0.1:5173`. Development requires Node.js 22.12 or newer.
