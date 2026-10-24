# New components and migration: local-draft-2

This checkout targets the unreleased 0.4.0 development version and local-draft-2 syntax. This page supplements the [syntax reference](local-interaction-syntax-en.md). The contribution protocol remains component-protocol-1; its portable fixture format is unchanged.

## Navigation and text color

```markdown
<jump to="result" appearance="button" color="#2563eb">View results</jump>

<section color="#45536f">
Ordinary prose with <text color="#a2273a">**an important reminder**</text>.

Another paragraph inherits the section color.
</section>

<anchor id="result">

## Results
```

jump and text are paired inline components with inline Markdown children. section is a paired block container with no extra border or background. anchor is a leaf. jump.to is a static heading slug or explicit anchor ID without a leading #. appearance is link (default) or button. Explicit IDs match `[A-Za-z_][A-Za-z0-9_-]*`; duplicates, heading collisions and missing targets are compile errors. DOM IDs are namespaced per rendered document. Jumps scroll and move focus; hidden targets show local feedback. Existing Markdown fragment links also resolve explicit anchors.

text/section require color. Other supported components accept an optional color: jump, badge, progress, slider, toggle, checkbox, select, choices, radio-group, checklist, multi-select, range-slider and coordinate. Static named colors from the shared table and #RGB/#RRGGBB are accepted. Expressions, CSS functions, variables and declarations are rejected. Text containers set foreground color; inner values override inheritance. Links and controls keep their own appearance. Other components use color for their accent, selected state or progress fill; tone keeps its semantic meaning. Omitted values use the theme.

## Todo lists and multiple selection

Existing checklist syntax is unchanged. Checked item text is struck through and muted, including initial `[x]` items; unchecking restores it. Only the checked item changes.

```markdown
<multi-select bind="subjects" label="Subjects" max-selected="2" initial="math">
<option value="math">Math</option>
<option value="physics">Physics</option>
</multi-select>
```

multi-select requires a label and one or more option children; bind is optional. Its exclusive string-array binding defaults to empty. initial is a comma-separated list of static values; values must be nonempty, unique and comma-free. max-selected is a nonnegative integer, defaulting to the option count. Writes normalize to source order and obey existing array budgets. Search and Clear are built in. Selected items remain removable at the limit. disabled may be dynamic; reset clears local search and restores initial selection, while hiding preserves them.

## Range and coordinate inputs

```markdown
<range-slider label="Interval" bind-start="low" bind-end="high"
  initial-start="20" initial-end="80" min="0" max="100" step="1">

<coordinate label="Point" bind-x="px" bind-y="py"
  initial-x="1" initial-y="2"
  x-min="-5" x-max="5" y-min="-5" y-max="5" step="1">
```

Both are leaves with required label, optional color and dynamic disabled. Bounds and positive step are static finite numbers. range-slider defaults to 0/100/1, with start=min and end=the largest valid step not exceeding max. Crossing is rejected rather than swapping endpoints. coordinate defaults to -5…5 on both axes, step 1, and the nearest legal zero per axis. It supports pointer dragging, keyboard control and numeric alternatives.

Each optional bind names one exclusive numeric slot; omitted names use internal state. x/y remain reserved parameter names. Slots initialize at compile time and reset atomically. Host APIs extend to `runtime.get(node, slot?)`, `runtime.set(node, value, slot?)` and `runtime.setMany(node, values)`. Slots are start/end for ranges and x/y for coordinates. Every write validates canonical registered slots; invalid batches preserve the entire snapshot and revision. Existing one-value calls remain valid.

## Questions and guided reading

```markdown
<quiz type="choice" label="What is 2 + 3?" answer="b" explanation="The sum is 5.">
<option value="a">4</option>
<option value="b">5</option>
</quiz>

<quiz type="number" label="Approximate pi" answer="3.14" tolerance="0.01">
</quiz>

<steps label="Learning path" bind="lesson">
<step label="Observe" value="observe">
Change a parameter.
</step>
<step label="Practice" value="practice">
Check an answer.
</step>
</steps>
```

quiz requires label/answer. type defaults to choice, with option children and a matching answer. Numeric quizzes have an empty body, finite answer and nonnegative absolute tolerance (default 0). explanation is optional and supports text interpolation. Check answer, feedback and Try again are built in. Draft and feedback stay internal; this revision has no quiz bind. Hiding preserves them and panel reset clears them. Answers are supplied in source for self-study.

steps accepts one or more step children, optional label and exclusive string bind. initial defaults to the first step. Each step requires label; omitted values become step-1, step-2 and so on. Values are unique within a group. Previous/Next and position are built in. Only active content is visible; all bindings still initialize, state persists between steps, and hidden timers pause. Reset restores the initial step and its subtree.

## Table and chart selection

```markdown
<table bind="project" key="Project" initial="Content">
| Project | Cost |
| --- | ---: |
| Content | 120 |
| Visual | 230 |
</table>

<chart bind="project" key="Project">
| Project | Cost |
| --- | ---: |
| Content | 120 |
| Visual | 230 |
</chart>
```

key names a column of static, nonempty, unique text identifiers. Selection is enabled only when key is present; bind/initial require key. Empty string means no selection by default. Explicit initial must match a row. Table/chart can share a selection binding only with identical ordered keys and at most one explicit initial. Mouse or keyboard selection writes row identity. Sorting, searching, pagination and hidden legends preserve selection; table filters still affect only that table. Existing components without key gain no implicit binding.

## Compatibility and acceptance

Previously supported local-draft-1 source remains valid. Ten new names arrive with this extension: jump, anchor, text, section, multi-select, range-slider, coordinate, quiz, steps and step. The same development build also adds the declaration tags computed, const and validation and the structural tags data-table and column, for 48 tag names in the complete `local-draft-2` set; the leading `<theme>` declaration is metadata, not a component. Old builds displayed these unknown regions as inert source; this build interprets their supported content. Put literal examples inside code spans or fences. Checklist completion appearance changes visibly.

Portable fixture syntaxVersion advances to local-draft-2; component-protocol-1 and its data format stay unchanged. local-draft-1.json is retained as historical data. New tests cover compiler/runtime, SSR rendering and visual selection. Canonical state, atomic rejection/reset, instance isolation, hidden-state retention, positioned diagnostics, existing resource budgets and the core/React boundary follow the component protocol. The same development build also reserves new expression function names; see [0.4.0 development preview and migration](release-0.4.0-en.md) for the full rename list.

Run `npm test`, `npm run test:components`, `npm run build:demo` and `npm run test:docs`. Browser checks and the complete release gate use `npm run verify:release`; see the [contributing guide](../CONTRIBUTING.md). Record actual run results with the gate rather than copying an old script name. The bilingual [six scenarios](../examples/local/showcase/README.md) cover all components: ranges, coordinates and numeric questions in Functions; multiple selection in Forms; linked selection in Data; jumps and prose colors in Layout; steps and choice questions in Flow; todos and timing in Checklists.
