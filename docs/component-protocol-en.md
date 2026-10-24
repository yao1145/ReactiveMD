# Reactive MD component protocol

Protocol revision `component-protocol-1` · applicable syntax `local-draft-2` · current package version `0.4.0` (preview)

Components are the building blocks of the Reactive MD language. This protocol defines the shared contract for contribution, implementation and acceptance, connecting author syntax, the compiler, the runtime, the React reference adapter and machine conformance data. Authors writing documents follow the [local interaction syntax specification](local-interaction-syntax-en.md); hosts integrating follow [local mode integration](local-integration-en.md); this document is for contributors, reviewers and tests.

| To learn about | Read |
| --- | --- |
| How to write documents | [Beginner guide](local-guide-en.md), [syntax specification](local-interaction-syntax-en.md) |
| How to add or change components | [Component development guide](component-development-en.md), sections 12 and 13 of this document |
| How to run acceptance | [Language conformance data](../examples/conformance/README.md), section 11 of this document |
| Version and migration rules | [Versions and compatibility](compatibility-en.md) |
| Security boundary | [Security policy](../SECURITY.md) |

## 1. Status, terminology and normative force

### CP-SCOPE-01 Version axes (existing)

Reactive MD maintains the following independent version axes:

| Version axis | Current value | Determines |
| --- | --- | --- |
| Package version | `0.4.0` | npm release, core and React entries, upgrade compatibility rules |
| Syntax revision | `local-draft-2` | Tags, attributes and expressions authors can write |
| Protocol revision | `component-protocol-1` | Component contribution requirements, acceptance gates and machine data semantics |
| Theme protocol | `reactive-md-theme-1` | Theme registration, style variables, color schemes and theme acceptance |

The protocol revision is independent of the package version and syntax version. One package version accepts only one syntax revision. A protocol revision may raise contribution and acceptance requirements without changing author syntax; a syntax revision change does not automatically require a protocol revision.

### CP-SCOPE-02 Normative sources (existing)

When this protocol restates existing behavior, the following files are authoritative:

- Author syntax: [local interaction syntax specification](local-interaction-syntax-en.md).
- Core and React API: [local mode integration](local-integration-en.md).
- Security boundary and host responsibilities: [security policy](../SECURITY.md).
- Versions, diagnostics contract and platform scope: [Versions and compatibility](compatibility-en.md).
- Implementation code: the parser, declaration table, compiler, runtime and renderer under `src/local/`.

This protocol does not copy the full attribute tables. Attribute defaults, allowed values and static/dynamic markers follow `src/local/schema.ts` and the syntax specification.

### CP-SCOPE-03 Normative terms (required)

| Term | Meaning |
| --- | --- |
| MUST | Failing it means not conforming to this protocol; review must not pass |
| MUST NOT | Explicitly prohibited |
| SHOULD | Follow by default; deviations must record rationale and alternative evidence in the proposal |
| MAY | Optional and does not affect conformance |

### CP-SCOPE-04 Clause markers (required)

Each clause carries a marker:

- **(existing)**: restates behavior in current code and published documentation, used for regressions and review.
- **(required)**: a requirement this protocol places on new or changed components; the current implementation may not check it automatically, and review must provide evidence.
- **(boundary)**: a capability this revision explicitly does not promise, which cannot be used as acceptance evidence.

When a clause restating existing behavior conflicts with the syntax specification, integration documentation or code, contributors must record the difference and provide a minimal reproduction. After maintainers confirm the expected behavior, synchronize the specification, implementation and conformance data according to fix or migration rules. New contribution requirements in this protocol are identified by the "required" marker.

### CP-SCOPE-05 Scope (boundary)

This protocol applies to the 43 component names of `local-draft-2`, their compilation, runtime and reference rendering behavior, and the process for submitting new components or changing existing ones to the repository.

This document defines contribution and acceptance contracts. The author tutorial and host API have separate documents; see CP-CORE-03 for the portable HTML scope and CP-CORE-05 for extension interface boundaries.

## 2. Component model

### CP-MODEL-01 Component classification (existing)

`local-draft-2` fixes 43 component names in the following groups:

| Category | Components | Notes |
| --- | --- | --- |
| Input controls | `input`, `textarea`, `number`, `slider`, `toggle`, `checkbox`, `date`, `select`, `choices`, `radio-group`, `option` | Read reader input and optionally expose parameters |
| Self-operating controls | `counter`, `timer`, `checklist`, `progress` | Provide increment/decrement, timing, checking or progress display |
| Organization and structure | `panel`, `card`, `grid`, `tabs`, `tab`, `accordion`, `disclosure`, `if` | Layout, switching, collapsing and conditional display |
| New components | `jump`, `anchor`, `text`, `section`, `multi-select`, `range-slider`, `coordinate`, `quiz`, `steps`, `step` | Declarations are in the extension reference |
| Feedback | `alert`, `badge`, `tooltip`, `jump`, `text` | Alerts and inline explanations |
| Data and visualization | `table`, `chart`, `plot`, `timeline`, `diagram`, `node`, `edge` | Tables, charts, function curves, timelines and diagrams |

`option`, `tab`, `disclosure`, `node` and `edge` are structural children that appear only inside their specified parent components. See [section 12 of the syntax specification](local-interaction-syntax-en.md#12-component-reference-and-syntax-scope) for the complete names and purposes.

### CP-MODEL-02 Three shapes (existing)

| Shape | Author form | Current components |
| --- | --- | --- |
| No body (leaf) | `<slider ...>`, no end tag; `<slider ... />` is also accepted | `input`, `textarea`, `number`, `slider`, `toggle`, `checkbox`, `date`, `counter`, `timer`, `progress`, `edge`, `anchor`, `range-slider`, `coordinate` |
| Inline | Paired tags with content embedded in a sentence | `badge`, `tooltip`, `jump`, `text` |
| Container | Paired tags whose content continues to parse as Markdown or child components | The remaining components |

Void components must not carry a body; containers must be explicitly closed, and automatic closing or correction of mismatched tags is not allowed. `textarea` text is set through `initial`, so it is a void component.

### CP-MODEL-03 Declaration contents (required)

A component proposal declaration contains at least the following information; items that do not apply, such as no binding or no computation, must be stated explicitly:

| Information | Content |
| --- | --- |
| Name | Lowercase kebab-case tag name |
| Shape | Void, inline or container |
| Child rules | Allowed direct children; allowed parents for structural children |
| Label requirements | `label` required, optional or not applicable |
| Attribute table | Name, type, static or dynamic, required, default, constraints |
| Binding | Public value type, family, whether exclusive, default initial-value rule |
| Initial-value rules | How the public value is produced when `initial` is omitted |
| Rendering | Reference adapter element, accessible name, keyboard operations and style hooks |
| Diagnostics | Diagnostic categories for structure, attributes, bindings, initial values and budget failures |
| Budgets | Resource limits defined when adding unbounded input, loops, recursion or computation |
| Compatibility classification | Capability addition, breaking change or implementation/editorial change |
| Acceptance evidence | Automated tests, machine conformance data and manual browser checks |

The current declaration table is `src/local/schema.ts`; the tag lexical sets are in `src/local/parser.ts`, semantic validation in `src/local/compiler.ts`, write constraints in `src/local/runtime.ts`, and rendering in `src/local/LocalDocumentView.tsx` and `src/local/visuals.tsx`. Changing only the declaration table does not automatically provide parsing, validation or rendering.

### CP-MODEL-04 Name set (existing)

The 43 names of `local-draft-2` are the complete set for the current syntax. Adding, removing or changing the meaning of a name is an author-visible change and is handled under section 10. Implementations may use undocumented node types internally, but authors can only use the names listed here and in the syntax specification.

## 3. Names, syntax and attributes

### CP-SYNTAX-01 Name spelling (existing)

Tag names and attribute names must use lowercase kebab-case matching `^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$`. Duplicate attribute names, end tags with attributes, and non-conforming tag or attribute names all produce compile diagnostics. Authors cannot define new tags, nor extend components with `class`, `style` or `on-*`.

### CP-SYNTAX-02 Shape and nesting (existing)

- Void components have no end tag; a trailing `/` may be used as self-closing syntax.
- Containers must use a paired end tag; the end tag must match the most recently unclosed container.
- Automatic closing, auto-completion or correction of mismatched tags is not supported.
- `badge`, `tooltip`, `jump` and `text` are inline components and can be embedded in sentences; other components are treated as block content.
- Tags, interpolations and formulas inside code fences and inline code are displayed verbatim and are not activated; Markdown comments produce no display content, components or bindings.

### CP-SYNTAX-03 Attribute values (existing)

Regular attribute values must be enclosed in single or double quotes; boolean attributes may omit their value, which means `true`. Attribute order has no semantics, and duplicate attributes are errors. `&quot;`, `&apos;`, `&amp;`, `&lt;` and `&gt;` in attribute values decode to the corresponding characters; backslashes are not used to escape attribute quotes.

Omitted boolean attributes use the default declared by the component instead of assuming `false` uniformly. For example, `panel.reset` defaults to `true`.

### CP-SYNTAX-04 Static and dynamic values (existing)

Attributes declared static must not contain interpolation. Dynamic attributes may use valid literals; when interpolation is used, a numeric, boolean or enum attribute must be one complete `{{ expression }}` and the result keeps the corresponding type. Text attributes may contain multiple interpolations, and their output is treated as text.

```markdown
<slider bind="people" label="People" initial="2" min="1" max="20">
<number bind="lower" label="Lower bound" initial="-2">
<number bind="upper" label="Upper bound" initial="2">
<if when="{{ people >= 5 }}">
<plot min="{{ lower }}" max="{{ upper }}">
$$ y = x^2 $$
</plot>
</if>
```

`bind`, `initial`, `id`, `value`, `from`, `to`, `kind`, `type` and layout enums are static attributes; `disabled`, `if.when`, `plot.min`, `plot.max` and `node.tone` are dynamic attributes. The complete list follows the `static` and `dynamic` markers in `schema.ts`.

### CP-SYNTAX-05 Labels and accessible names (existing)

Whether `label` is required, optional or not applicable is determined by the component declaration. A required label cannot be missing or whitespace-only; labels may be dynamic text. An input control's `label` is also its accessible name. When an optional label is omitted, the reference adapter must provide a stable accessible-name fallback and must not leave an unnamed control.

### CP-SYNTAX-06 Child rules (existing)

| Child rule | Allowed content | Current components |
| --- | --- | --- |
| No children | No body or child components | Void controls, `progress`, `edge` |
| Inline content | Inline Markdown, no nested component tags | `option`, `badge`, `tooltip` |
| Options | One or more `option` | `select`, `choices`, `radio-group` |
| Tabs | One or more `tab` | `tabs` |
| Disclosures | One or more `disclosure` | `accordion` |
| Cards | One or more `card` | `grid` |
| Diagram | One or more `node`, optional `edge` | `diagram` |
| Table | Exactly one Markdown table | `table`, `chart`, `timeline` |
| Formulas | One or more `$$...$$` formula blocks | `plot` |
| General content | Markdown and components, with component-specific rules | `panel`, `card`, `tab`, `if`, `alert` |

The `checklist` body must be exactly one level of Markdown task list; `node` notes may contain text interpolation but must not contain interactive components. Compilation fails when a structural child appears under the wrong parent, a container lacks a required child, or a child type does not match.

### CP-SYNTAX-07 Markdown context (existing)

Components may sit in a paragraph or a standalone block. Container content is dedented by the common indentation and then parsed as Markdown; indentation inside code fences is preserved. The parser identifies code, math regions and tag boundaries first, then interprets interpolations; the syntax cannot be implemented by string replacement over the whole document.

### CP-SYNTAX-08 Author capability boundary (existing)

Authors cannot execute scripts, write executable HTML, provide author CSS, register event handlers or declare network service calls. Images and links are constrained by the host URL policy in CP-SEC-02. `<script>`, `<style>`, `on-*`, `class`, `style` and legacy directives are not part of `local-draft-2`. Complete unknown tags fall back to source; incomplete or unrecoverable tags produce errors. Document content is never executed as arbitrary HTML.

## 4. Bindings and state

### CP-STATE-01 Binding names (existing)

`bind` must match `[A-Za-z_][A-Za-z0-9_]*`, is case-sensitive, and is at most 128 characters. Expression built-in function names, `x`, `y`, `pi`, `e`, `true`, `false`, `null`, and `__proto__`, `prototype`, `constructor` are reserved names and cannot be used as binding names.

Components without `bind` still have internal state under the internal key `@<node.id>`, but that key does not enter the public parameter set and cannot be referenced by expressions. Public parameters contain only explicitly bound names.

### CP-STATE-02 Binding families (existing)

| family | Public value | Components |
| --- | --- | --- |
| `text` | String | `input`, `textarea` |
| `number` | Finite number | `number`, `slider`, `counter` |
| `boolean` | Boolean | `toggle`, `checkbox` |
| `date` | `YYYY-MM-DD` or empty string | `date` |
| `choice` | Option string | `select`, `choices`, `radio-group` |
| `timer` | Remaining seconds, non-negative number | `timer` |
| `checklist` | String array of selected item IDs | `checklist` |
| `tabs` | Current tab value | `tabs` |
| `diagram` | Current node ID | `diagram` |
| `multi-select` | Option value array in source order, exclusive | `multi-select` |
| `steps` | Current step value, exclusive | `steps` |
| `selection` | Stable row key, empty string when unselected | `table` and `chart` with key |

Each numeric slot of range-slider and coordinate is also exclusive. Bounds, steps, defaults and atomic batch writes are defined in the [extension declarations](local-components-v2-en.md). Selection can be shared by tables and charts only with identical ordered keys. The initialization, rejection, visibility, reset and disposal clauses below continue to apply.

`timer`, `checklist`, `tabs` and `diagram` are also exclusive families: a public parameter can be owned by only one component, and other controls cannot declare a same-name binding. Hosts can still call the public `runtime.set` through the owning node, and writes follow the same validation.

### CP-STATE-03 Shared constraints (existing)

A same-name binding is valid only when all of the following conditions hold:

- All components belong to the same family.
- Numeric bindings have exactly identical `min`, `max` and `step`.
- Selector option value sets and order are exactly identical.
- An exclusive family has only one component.
- The same binding has at most one explicit `initial`.

Shared controls may have different label text and appearance. Violating shared conditions produces a compile error, and the error message points to the conflicting location.

### CP-STATE-04 Initialization (existing)

Public values are initialized once when the document instance is created. Components in conditional regions, inactive tabs and closed disclosure panels also participate in initialization; hiding and showing again does not initialize again.

Without an explicit `initial`, the default is generated according to the component declaration:

| Initial rule | Components | Result |
| --- | --- | --- |
| `empty` | `input`, `textarea`, `date` | Empty string |
| `false` | `toggle`, `checkbox` | `false` |
| `min` | `slider` | `min`, default range 0 to 100 |
| `nearest-zero` | `number`, `counter` | The valid step value within range closest to 0; the smaller value when equidistant |
| `first-option` | Selectors | value of the first option |
| `first-tab` | `tabs` | value of the first tab |
| `first-node` | `diagram` | id of the first node |
| `checked` | `checklist` | IDs of checked items in the task list |
| `duration` | `timer` | `duration`, default 60 |

When a shared binding has no explicit initial value, the default of the first component in the source is used, and all members' constraints are validated.

### CP-STATE-05 Initial-value validation (existing)

An explicit initial value must be static. Compile-time validation covers numeric ranges, steps, date format, option membership, text length, email format and shared constraints. Out-of-range, off-step, unknown-option or type-mismatched values produce errors and are not silently corrected. A valid empty string may represent "not selected yet"; that value remains public until the reader enters something.

`initial` is only document initialization data, not a persistence format. After the source changes, a new instance is created and initialized from the new source.

### CP-STATE-06 Writes and atomicity (existing)

Runtime `set(node, value)` relies on the controls registered in the compiled document and ignores forged node metadata from the caller. A write checks in order:

1. Whether the component has a writable binding.
2. The value type and resource budget.
3. The binding's own range, step and option constraints.
4. Additional constraints on all shared controls, such as required, length, email and date ranges.

When all checks pass, the runtime commits once and all dependent content sees the same new state; when any control rejects, state does not change, revision does not increase, and a runtime diagnostic is returned. Checklist array values are normalized to the source order of items. A write equal to the current value does not commit and does not notify subscribers.

### CP-STATE-07 Input drafts (existing)

Intermediate input in number and text fields that is not yet valid is kept in a renderer-local draft and does not enter public state. Examples include an empty string or a minus sign in a number field, and content that has not passed email or length checks in a text field. Valid input commits immediately; if it is still invalid on blur, a hint is shown while other content keeps reading the last valid value. Panel reset clears drafts.

### CP-STATE-08 Reset (existing)

`runtime.reset(node)` restores all bindings and internal component state within that node's subtree at once, commits once and notifies once. Scope rules:

- Bindings of controls in the subtree return to compile-time initial values; displays of shared variables outside the subtree update in sync.
- Components in the subtree detect reset through `resetToken` and restore local selection, table query, sorting, paging, chart legend, plot readout, tab, disclosure state and timer state.
- Child controls not yet shown in a condition are also within reset scope.
- A panel's restore-defaults uses the same mechanism; an inner reset of a nested panel affects only the inner panel, while an outer reset covers the whole subtree.
- Internal state of components without bindings is also reset; their internal keys still do not enter the public parameter set.

### CP-STATE-09 Display state is not permission (existing)

`disabled` and `if` control only interface display and input. They are not authorization, data validation or server-side permission boundaries. The host must revalidate permissions and business constraints when submitting to the server.

### CP-STATE-10 Representative normative points for slider (existing)

`slider` represents a simple numeric control:

- The family is `number`; `min`, `max` and `step` are static numeric attributes with defaults `0`, `100` and `1`.
- Omitting `initial` takes `min`; an explicit initial value must be within range and on a step based at `min`.
- The runtime rejects out-of-range, non-finite and off-step writes, and keeps the last valid state when rejecting.
- When sharing a binding with other numeric controls, all members' `min`, `max` and `step` must be exactly identical.
- Without `bind`, the control still works, with state stored under the internal key and not exposed to expressions.

### CP-STATE-11 Representative normative points for tabs (existing)

`tabs` represents a container component with public state:

- The public value type is string, the family is `tabs`, and ownership is exclusive; a second component cannot declare a same-name binding.
- `tab.value` is a static unique value; when omitted, `tab-1`, `tab-2` and so on are generated in source order.
- Without `initial`, the first tab is selected; an explicit initial value must point to an existing tab.
- Without `bind`, selection stays inside the component; with `bind`, switching writes the public value.
- Hidden tab content still participates in compilation and initialization, and child content state is preserved; timers inside pause, and the reader must start them again after the tab is shown.
- Panel reset restores the tab initials and child content state together.

### CP-STATE-12 Representative normative points for plot (existing)

`plot` represents a computational visualization:

- The body may contain only whitespace and one or more `$$...$$` formula blocks; each block explicitly writes `y = expression`.
- `min` and `max` may be dynamic and require `min < max`; static ranges are validated at compile time and dynamic ranges at render time. Invalid ranges show a local error instead of being silently clamped.
- `samples` is a static integer from 2 to 2000; each `plot` has at most 16 curves.
- The whole document has at most 20,000 curve sample points, including hidden regions; plotting computation shares a budget of 2,000,000 steps.
- Formulas may reference only declared numeric parameters; undeclared or non-numeric parameters are diagnosed at compile time.
- Non-finite samples form breaks, and the two sides of a break are not connected directly; when there are no valid values, an empty state is shown.
- The reference adapter provides legends and pointer/keyboard readouts; real pointer, keyboard and narrow-screen behavior is checked manually as described in section 11.

## 5. Diagnostics and fallback

### CP-DIAG-01 Diagnostics contract (existing)

`Diagnostic` contains `code`, `message`, `severity`, `range`, `line` and `column`. `line` and `column` start at 1; `range` is an index into the current source string. `code` is a string identifier; `message` is display text, and callers must not parse message or make business decisions based on its full text.

### CP-DIAG-02 Compile results and severity (existing)

Compilation has exactly two outcomes:

- Success: `ok: true`, with the document and diagnostics; diagnostics may contain warnings.
- Failure: `ok: false`, with diagnostics only; the interactive preview is disabled.

Structurally complete but unknown tags and footnotes produce warnings; incomplete structures, mismatched tags, unknown attributes or type errors on known components, binding errors, expression errors and budget overruns produce errors. Errors block successful compilation; warnings do not.

### CP-DIAG-03 Fallback isolation (existing)

Structurally complete unknown tags are displayed as original source with a `local.component.unknown` warning. Controls, interpolations and formulas inside the fallback region are not executed, do not initialize bindings and cause no network actions. Footnote references and definitions are displayed verbatim with a `local.footnote.unsupported` warning. Other prose and interactions keep working.

Unknown tags that cannot be reliably recovered and tag structure errors still block compilation; fallback cannot be used to bypass validation.

### CP-DIAG-04 Runtime error isolation (existing)

When a control write is rejected, a `local.runtime.value` or `local.runtime.binding` diagnostic is returned and public state keeps the last valid value. Local computation errors in expressions, tables, charts or plots are shown near the corresponding content, with "Unable to compute" or a matching empty state, while other independent content keeps updating. A rendering exception in a single component is isolated by an error boundary and retried after the revision changes.

### CP-DIAG-05 Hidden branches are still compiled (existing)

A false condition, inactive tab or closed disclosure affects display only, not compilation. Undeclared variables, type errors, structure errors and budget overruns in hidden branches are still compile errors. At runtime, hiding preserves state and pauses timers; it does not skip validation.

### CP-DIAG-06 Diagnostic code stability (contract)

Existing diagnostic codes keep their meaning within one 0.x minor series; new codes may be added. Removal, renaming or a change of meaning requires a new minor version and migration notes. Messages are localized display text. Tests and machine conformance use codes and structured fields. See [Diagnostics and counting rules](diagnostics-counting-en.md) for units and budget scopes.

## 6. Accessibility, themes and styling

### CP-A11Y-01 Accessible names and states (existing)

Every interactive component must provide an accessible name and expose its current state. Input controls use `label` as their name; containers and visualizations that require independent operation use a stable fallback name when an optional label is omitted. Selectors, tabs, disclosures, checklists, progress, timers, tables, charts, plots and diagrams must expose states such as selection, expansion, progress, remaining time, sorting or readout to assistive technologies. Distinguishing state by color alone does not meet the requirement.

### CP-A11Y-02 Keyboard and focus (existing)

Interactive components must be reachable and operable by keyboard. Tabs support arrow keys, Home and End; diagram nodes support Tab focus and Enter selection; plots support arrow keys, Home and End readouts; table sorting and paging use focusable controls. When a conditional region is hidden and focus is inside it, the reference adapter moves focus out of the hidden content. New components must not leave focus on invisible elements.

### CP-A11Y-03 Manual checks (existing / boundary)

The machine conformance data of this protocol does not cover browser behavior such as real keyboard input, IME composition, 375px narrow screens, screen readers and timer pause. These items require corresponding automated browser checks or the manual checks in section 11. Incomplete checks must be recorded and must not be reported as passed.

### CP-STYLE-01 Global styles and themes (existing)

`reactive-md/styles.css` is a global stylesheet, not isolated through Shadow DOM or CSS Modules. The host imports it explicitly once. Theme variables are declared on `.md-document` and `.reactive-md-theme`. Document selection, registration and color schemes follow the [theme protocol](theme-protocol-en.md). `colorScheme="auto"` reads the nearest explicit ancestor preference or the system, retaining support for `data-theme="dark|light"`.

### CP-STYLE-02 Style hooks are not an API (existing)

Prefer public CSS variables for themes. Component outer `.md-*` and `.local-*` classes and semantic state attributes are styling interfaces under the theme protocol; internal node ordering is not an extension API. Neither React component accepts `className` or `style`; authors cannot write class or style either. New components use existing prefixes and shared variables and work with the built-in default theme in both modes.

### CP-STYLE-03 Styling requirements for new components (required)

New components must:

- Be usable at 375px width without horizontal overflow or unreachable actions.
- Use existing theme variables and `.md-*`, `.local-*` prefixes, without overriding global selectors outside the document.
- Provide visible styles for keyboard focus and non-color cues for selected, disabled, error and empty states.
- Not automatically inject new global styles when JavaScript is imported; styles ship with `styles.css`.
- List added or changed style files and manual check screenshots or records in the proposal.

## 7. Visibility, instances and disposal

### CP-VIS-01 Hidden state is preserved (existing)

When `if` is false, a tab is inactive or a disclosure is closed, content is not displayed, but parameters, tab selection and checklist checks are preserved. Hiding does not reinitialize bindings or skip diagnostics. Toggling display updates only the view and does not create new document state.

### CP-VIS-02 Timing and focus (existing)

Timers in hidden regions pause, and public seconds stop at the pause point; when shown again they stay paused until the reader starts them. When a conditional region is hidden, keyboard focus must not remain in hidden content. Hidden regions still count toward the whole-document plot sample budget.

### CP-LIFE-01 Instance isolation (existing)

Each `LocalReactiveDocument` instance creates an independent runtime and state. The same page can embed multiple copies of the same source, and parameters, timers, tabs, table queries and diagram selections do not affect each other. `LocalDocumentView` uses the runtime passed by the host; when instance isolation is needed, the host must create a separate runtime for each document. Heading anchors are isolated per rendering instance, and table-of-contents links target the current instance.

### CP-LIFE-02 Source changes (existing)

`LocalReactiveDocument` recompiles and creates a new runtime when `source` changes; old instance state is not kept. When the host manages the lifecycle itself, pass the compiled document and runtime to `LocalDocumentView` and dispose the runtime on unmount. Repeated mounts under React StrictMode are handled by deferred disposal logic, which does not release a runtime still in use.

### CP-LIFE-03 Disposal (existing)

`runtime.dispose()` is idempotent and clears subscriptions, expression caches and reset markers; React components clean up their timers and event listeners on unmount. After disposal the host should stop using the instance; lifecycle-checked methods such as `snapshot`, `get` and `set` throw. Host-managed runtimes must call `dispose()` on unmount and handle callbacks still in flight.

### CP-LIFE-04 SSR and persistence scope (boundary)

Static SSR rendering is covered by the pre-release packed check; hydration is unverified. Document state exists only in the current instance's memory; there is no localStorage, cookie, server write or cross-instance sharing. Persist the original `.reactive.md` source; do not persist `LocalDocument`, `LocalNode`, `node.id`, `LocalSnapshot` or runtime parameter state, whose structure is not guaranteed across versions.

## 8. Security and resource budgets

### CP-SEC-01 Untrusted documents (existing)

The renderer and evaluators treat document content as untrusted input:

- They do not execute author scripts or write `dangerouslySetInnerHTML` or `innerHTML`.
- Expressions use their own parser and AST evaluator, not `eval` or `new Function`, and do not support assignment, method calls, property access, prototype paths or imports.
- LaTeX uses a budget-limited parser and renders as native MathML; it does not execute macros, files, network or HTML entry points.
- Expressions, templates, tables and charts do not make network requests.

### CP-SEC-02 URLs and networking (existing)

All images are rejected by default, including relative paths; they load only when the host `urlPolicy` returns `true`. Images with a protocol allow only `http:` and `https:`; dangerous protocols are rejected even if the policy allows them. Links allow relative addresses and `http:`, `https:`, `mailto:` and `tel:` by default; external HTTP links open in a new tab with `noopener noreferrer`. If the policy throws, the address is rejected.

`urlPolicy` is a URL allowlist, not server-side authorization or a sandbox. Hosts still need to configure CSP, network egress, an image proxy or a sandboxed iframe.

### CP-SEC-03 Resource budgets (existing)

| Limit | Value |
| --- | --- |
| Source per document | 1,000,000 characters |
| Syntax nodes created cumulatively during parsing | 10,000 by default, configurable per call by the host |
| A single string value, attribute or template | 100,000 characters |
| A single array | 10,000 items |
| Total string length within an array | 100,000 characters |
| Email address | 254 characters, validated in linear time |
| Number of diagnostics | 100 |
| Text of a single diagnostic | 2,000 characters |
| Curves per plot component | 16 |
| Curve sample points requested by the whole document | 20,000 |
| Shared computation steps for plotting | 2,000,000 |

Here, characters means UTF-16 code units. Text-control `min-length` / `max-length` and string `len()` count Unicode code points. Writes over a limit are rejected and the runtime keeps the last valid state; compile-time overruns return diagnostics. Expressions and math evaluation have additional length, node, depth and token budgets. See [Diagnostics and counting rules](diagnostics-counting-en.md) for all units and scopes. Hidden regions count toward plotting budgets. Hosts still control request size, concurrency and timeouts.

### CP-SEC-04 Host responsibilities (existing)

The host decides who may write, submit and share documents; limits request size, concurrency and execution time for untrusted authors; configures `urlPolicy`, CSP and network egress; revalidates form values, permissions and business constraints on the server; and assesses the rendering process's resource limits before statically rendering untrusted documents.

### CP-SEC-05 Extension trust boundary (boundary)

This language does not provide a sandbox for trusted host extension code. If the host registers or wraps components itself, the host is responsible for the security boundary; `disabled`, conditional visibility or client state in author documents must not be treated as permission control. This revision does not provide a public runtime registration interface; a future SDK would need a separately defined trust model.

## 9. Core and renderer separation

### CP-CORE-01 Entry separation (existing)

The `reactive-md` core entry provides `compileLocal`, `createLocalRuntime`, expressions, LaTeX and version constants, does not depend on React, and can run in Node. `reactive-md/react` provides `LocalReactiveDocument` and `LocalDocumentView` and requires React 19. Styles are imported through the separate `reactive-md/styles.css`.

### CP-CORE-02 Authority layering (existing)

- The declaration table and compiler determine which tags, attributes, structures and initial values are legal.
- The runtime determines whether writes are accepted and whether shared values commit atomically.
- The renderer presents content and collects user input; it does not reinterpret source rejected by the compiler or create public bindings not registered by the compiler.
- The core and reference renderer produce the same binding semantics and state results for the same document.

### CP-CORE-03 HTML is not a cross-implementation protocol (boundary)

SSR HTML, class names and DOM structure in machine acceptance are evidence for the React reference adapter, not a cross-implementation HTML byte protocol. Cross-implementation compatibility is measured by bindings, state, diagnostic codes and text results; visual presentation is the responsibility of each implementation, but must meet accessibility and narrow-screen requirements.

### CP-CORE-04 Implementation surfaces for new components (required)

New components must check the following integration points and change the corresponding implementation according to their behavior; when reusing existing generic validation, explain it in the proposal:

1. The `VOID`, `PAIRED` and `INLINE` shape sets in `src/local/parser.ts` (by shape).
2. The declaration table in `src/local/schema.ts`.
3. Structure, attribute, binding and initial-value validation in `src/local/compiler.ts`.
4. Write constraints in `src/local/runtime.ts` (if a new public value or state is introduced).
5. Reference rendering in `src/local/LocalDocumentView.tsx` and `src/local/visuals.tsx`.
6. Budgets in `src/local/limits.ts` (if new computation or collections are introduced).
7. Styles, tests, examples, syntax documentation, integration documentation and conformance data.

Adding only a `schema.ts` entry does not automatically provide parsing, validation or rendering.

### CP-CORE-05 Extension interface boundary (boundary)

This revision has no runtime-loadable component JSON, `registerComponent` API or author plugin entry point. `LOCAL_COMPONENTS` is an internal frozen table, and public entries do not export a registrar. If a future SDK provides runtime registration, it needs a new protocol revision that defines the trust model, version negotiation, budgets and acceptance methods.

## 10. Compatibility, name governance, revisions and migration

### CP-COMPAT-01 Change classification (required)

| Category | Example | Handling |
| --- | --- | --- |
| Capability addition | New component; new optional attribute on an existing component whose default preserves existing valid forms | Author-visible syntax additions still establish a new syntax revision, raise the package minor version and add acceptance and migration notes |
| Breaking change | Removing or renaming a component; changing shape, required attributes, defaults, structure rules or binding family; changing initial-value rules; lowering an existing budget; changing compile results or public values of existing documents | Requires a new syntax revision, migration notes and old/new examples |
| Implementation or editorial change | Adjusting diagnostic message, internal class names, DOM structure, `node.id` or performance implementation while keeping existing semantics, accessibility and resource boundaries | Usually does not raise the syntax or protocol revision; public API changes follow compatibility rules separately |

Adding a tag makes previously inert regions with that name start executing in old implementations, so it cannot promise that all old sources keep their old behavior. Migration notes must cover this change. Adding or adjusting diagnostic codes also changes the `codes` in machine data, requiring synchronized acceptance and changelog updates; cross-version promises for diagnostic codes continue to follow the compatibility notes.

### CP-COMPAT-02 Syntax revisions (existing)

Author-visible syntax changes establish a new syntax revision, such as `local-draft-2`, raising the package minor version and updating `LOCAL_SYNTAX_VERSION` at the same time. The project does not rewrite sources automatically; after upgrading, authors or hosts migrate according to the changelog. One package version accepts only one syntax revision.

### CP-COMPAT-03 Protocol revisions (required)

The following changes raise the protocol revision, for example from `component-protocol-1` to `component-protocol-2`:

- Changing MUST or MUST NOT clauses.
- Adding required component declaration information or acceptance gates.
- Changing root fields, required fields or comparison semantics of machine conformance data.
- Changing compatibility classification rules or name governance rules.

Editorial changes do not raise the protocol revision. Protocol revisions can ship independently of syntax revisions but must state the applicable syntax and package version in the documentation.

### CP-COMPAT-04 Name governance (required)

- New names must be lowercase kebab-case, semantically clear, and avoid conflicts with the existing 43 names.
- Do not use HTML names such as `script`, `style`, `div`, `span` or `a`, and do not use `on-*`, `class` or `style` as author attributes.
- Within `component-protocol-1`, the existing 43 names are reserved for existing semantics; reusing a name is a breaking change.
- No implicit aliases. An alias needs its own name, documentation and acceptance evidence.
- Structural child names and parent constraints are governed together; do not change only the parent component.

### CP-COMPAT-05 Migration (required)

- Components that already conform to this protocol keep their existing semantics after a protocol revision; new MUST clauses apply to new or changed components by default.
- If a new requirement applies retroactively to existing components, it must be handled as a breaking change with migration notes, old/new behavior comparisons and acceptance updates.
- Breaking changes must not quietly change author syntax without a new syntax revision.
- Migration notes are for users and contributors and include at least the old form, new form, affected scope and verification method.

### CP-COMPAT-06 Persistable content (existing)

Persist only the original `.reactive.md` source and the syntax revision used. `LocalDocument`, `LocalNode`, `node.id`, `initialState`, `LocalSnapshot` and runtime parameter state are current runtime objects, and their structure or field meanings are not guaranteed across versions. Diagnostic line numbers, columns and offsets locate the current source and are not persistence identifiers.

## 11. Acceptance matrix

### CP-ACCEPT-01 Acceptance surfaces (required)

| Acceptance surface | Evidence | Pass condition | Related clauses |
| --- | --- | --- | --- |
| Tag shape and structure | Parser/compiler tests, machine cases | Valid documents pass; mismatches, missing children and wrong parents fail | CP-SYNTAX-01 to 08 |
| Attributes and expressions | Compiler tests, machine cases | Static/dynamic, types, empty interpolation and unknown attributes diagnosed per clause | CP-SYNTAX-03, 04 |
| Bindings and initial values | Runtime tests, machine cases | Shared constraints, defaults and explicit initial validation agree | CP-STATE-01 to 05 |
| Writes and atomicity | Runtime tests, machine cases | State unchanged on rejection; one commit on acceptance; shared controls agree | CP-STATE-06 |
| Drafts and reset | Renderer/runtime tests, machine cases | Drafts never enter public values; reset commits once and restores the subtree | CP-STATE-07, 08 |
| Visibility and lifecycle | Runtime/renderer tests, machine cases | Hiding preserves state; timing pauses; instances isolated; disposal cleans up | CP-VIS-01, 02, CP-LIFE-01 to 03 |
| Fallback and error isolation | Compiler/renderer tests, machine cases | Complete unknown tags fall back inertly; local errors do not affect other content | CP-DIAG-02 to 05 |
| Visualization | Renderer tests, machine cases, manual checks | plot/chart/table/diagram/timeline semantics and budgets correct | CP-STATE-12, CP-SEC-03 |
| Accessibility | Manual browser checks, some automated checks | Names, roles, states, keyboard, focus and 375px usability | CP-A11Y-01 to 03 |
| Security and budgets | Security tests, budget tests, machine cases | No script/network entry points; over-limit rejected while keeping valid state | CP-SEC-01 to 04 |
| Core and renderer separation | Build, package checks, Node consumption tests | Core independent of React; React entry installable separately | CP-CORE-01, 02 |
| Documentation and links | `npm run test:docs` | Relative links and heading anchors valid | CP-SCOPE-02 |
| Machine data format | Conformance runner | Root fields, unique ids, required fields and exact codes pass | CP-ACCEPT-02 |

### CP-ACCEPT-02 Machine conformance data (required)

The root object of a machine conformance set contains only `protocolVersion`, `syntaxVersion` and a non-empty `cases` array. The first two are fixed to `component-protocol-1` and `local-draft-2`; the package version is identified by `package.json` and is not inferred from these fields.

Each case contains at least a unique string `id`, component name `component`, source `source`, boolean `ok` and a deduplicated diagnostic code set `codes`. Optional fields `initial`, `bindingNames`, `actions`, `reset`, `text`, `expectedText`, `htmlIncludes` and `htmlExcludes` follow the [language conformance data notes](../examples/conformance/README.md) and the JSON Schema shipped with the repository. The full format follows that document and the Schema; this protocol defines only the semantic gates.

The runner must:

- Check `protocolVersion` and `syntaxVersion` exactly.
- Validate unique ids, required fields and `codes` as a duplicate-free set of strings; invalid data fails directly instead of being skipped silently.
- Run `actions` in order and check whether each write is accepted; `reset` runs after actions, looks up the compiled node by component name and 0-based `index`, and calls `runtime.reset`.
- Evaluate `text` and `expectedText` after `actions`/`reset`, and check SSR HTML includes/excludes in the final state.
- Call `dispose()` for every runtime in a `finally` block.
- For cases with failed compilation, check only `ok` and `codes`, with no success state, actions or rendering expectations.

`initial` and `reset.expectedState` use partial matching; `bindingNames` checks the complete public binding name set; `text` and `expectedText` must appear in pairs.

The conformance data of this revision should cover representative `slider`, `tabs` and `plot` cases and at least one complete unknown-tag fallback case. It is a representative gate, not full certification of the 43 components.

### CP-ACCEPT-03 Component-level evidence (required)

New or changed components must provide evidence commensurate with the size of their declaration:

- At least one successful compilation case and one failure case covering new attributes, structure or binding constraints.
- If a public value is introduced, at least one initialization case and one rejected-write case.
- If internal state is introduced, at least one reset or hiding-preserves-state case.
- If computation or collections are introduced, at least one budget boundary case.
- If a visualization is introduced, at least one rendering or SSR evidence item, plus a list of manual browser checks.
- If existing semantics change, old/new behavior comparisons and migration evidence.

### CP-ACCEPT-04 Manual browser checks (required)

Component contributions involving the following behavior must provide real browser evidence. Existing automated browser checks may cover corresponding actions; items not yet covered, such as screen reader experience, require manual checks. The machine data in section 11.2 cannot replace this evidence:

- Real keyboard operations, focus order and moving focus out of hidden content.
- Chinese IME composition and blur validation.
- 375px narrow-screen layout, horizontal overflow and touch targets.
- Timer start, pause, resume and behavior after switching to the background.
- Screen reader names and dynamic state announcements.
- Dark theme, theme variable overrides and style isolation.

The currently verified platform is Microsoft Edge (Chromium-based); Linux CI uses Playwright Chromium. Firefox, Safari/WebKit and SSR hydration are unverified.

### CP-ACCEPT-05 Command gate and exemptions (required)

The protocol sample gate uses `npm run test:components`, which runs `examples/conformance/component-protocol-1.json` and language conformance; it does not replace full tests, builds, documentation checks or manual browser checks. See the [contributing guide](../CONTRIBUTING.md) and the [component development guide](component-development-en.md) for the full check commands.

Only SHOULD clauses can be exempted; exemptions must record the rationale, alternative evidence and impact in the proposal. MUST clauses cannot be exempted and can only be changed through a protocol revision.

## 12. Current implementation map

### CP-IMPL-01 Code locations (existing)

| Contract surface | Main location | Notes |
| --- | --- | --- |
| Tag lexing and shapes | `src/local/parser.ts` | `VOID`, `PAIRED`, `INLINE`, unknown-tag fallback, footnote shielding |
| Component declarations | `src/local/schema.ts` | Names, shapes, child rules, attributes, bindings, initial-value rules |
| Compile validation | `src/local/compiler.ts` | Structure, attributes, initial values, shared constraints, expressions, table and plot budgets |
| Runtime | `src/local/runtime.ts` | `get`, `set`, `evaluate`, `text`, `reset`, `resetToken`, `dispose` |
| React reference adapter | `src/local/LocalDocumentView.tsx` | Document container, controls, layout, accessible names, reset and lifecycle |
| Visualization adapter | `src/local/visuals.tsx`, `src/local/math.ts`, `src/local/math-view.tsx` | Tables, charts, plots, timelines, diagrams and math rendering |
| Styles | `src/styles.css`, `src/theme.css`, `src/base.css`, `src/local/local.css`, `src/local/visuals.css` | Global stylesheet, theme variables and component styles |
| Budgets | `src/local/limits.ts` | Shared resource limits |
| Versions | `src/local/version.ts`, `package.json` | Syntax revision and package version |
| Acceptance | `tests/`, `examples/conformance/` | Language tests and machine conformance data |
| Documentation | `docs/`, `README.md`, `CONTRIBUTING.md`, `SECURITY.md` | Syntax, integration, compatibility, security and contribution rules |

### CP-IMPL-02 Current coverage (existing / boundary)

The current implementation covers parsing, declarations, compilation, runtime, React rendering, resource budgets and release checks. Real keyboard input, IME, 375px layout and timer pause require corresponding automated browser checks or manual checks; SSR hydration is unverified. The machine data of `component-protocol-1` is a representative gate, not certification of all 43 components.

### CP-IMPL-03 Extension interfaces (boundary)

If an SDK is provided in the future, it needs a separately defined:

- Machine format and version negotiation for component declarations.
- Trust model and sandbox boundary for the host registration API.
- Budgets, accessibility and acceptance gates for new components.
- Relationship to the `local-draft-2` syntax revision.

These capabilities are future work; they cannot be used as current acceptance evidence and must not be documented as already provided.

## 13. New component proposal template

The tables below are for review. See the [component development guide](component-development-en.md) for the complete process, copyable proposal template and check commands.

### 13.1 Basic information

| Item | Content |
| --- | --- |
| Component name | `<name>` (lowercase kebab-case) |
| Protocol revision | `component-protocol-1` |
| Purpose | What problem it solves and how readers use it |
| Non-goals | Capabilities this component does not take on |
| Version impact | Package version, syntax revision, protocol revision |
| Name and shape | Name, leaf/inline/container, parent, child rules |
| Syntax example | Minimal runnable source |
| Binding | Public value type, family, exclusivity, initial-value rule, sharing conditions |
| Children and structure | Allowed direct children and structural constraints |
| State and reset | Public state, internal state, panel reset behavior |
| Visibility and disposal | Conditional hiding, tab switching, timers and unmount behavior |
| Diagnostics and fallback | Structure, attribute, initial-value and runtime errors, unknown-tag fallback |
| Security and budgets | Budgets for new input, loops, recursion, computation or collections |
| Accessibility | Accessible name, role, state, keyboard and focus |
| Narrow screens and styles | 375px behavior, theme variables, style files and screenshots |
| Compatibility classification | Capability addition, breaking change or implementation/editorial change |
| Migration | Old form, new form, affected scope and verification method |
| Acceptance evidence | Automated tests, machine data, SSR/manual checks |
| Changed files | Parser, declaration table, compiler, runtime, renderer, styles, tests, documentation |
| Clause checklist | Applicable CP-* clauses and evidence listed one by one |

### 13.2 Attribute table

| Attribute | Type | Static/dynamic | Required | Default | Constraints | Failure diagnostics |
| --- | --- | --- | --- | --- | --- | --- |
| `name` | string/number/boolean/enum | static/dynamic | yes/no | value | range, enum, length | expected code |
| ... | | | | | | |

### 13.3 Binding table

| Public value | family | Exclusive | Initial-value rule | Sharing conditions | Reset behavior |
| --- | --- | --- | --- | --- | --- |
| `bindName` | text/number/boolean/date/choice/timer/checklist/tabs/diagram | yes/no | rule | same family, matching range/step/options | restore initial value and trigger reset token |

### 13.4 Clause checklist

| Clause | Evidence | Conclusion |
| --- | --- | --- |
| CP-SYNTAX-01 to 08 | Parser/compiler tests, syntax documentation | Pass/outstanding |
| CP-STATE-01 to 09 | Runtime tests, machine data | Pass/outstanding |
| CP-DIAG-01 to 05 | Failure cases, fallback cases | Pass/outstanding |
| CP-A11Y-01 to 03 | Manual browser records | Pass/outstanding |
| CP-STYLE-01 to 03 | Style files, narrow-screen screenshots | Pass/outstanding |
| CP-VIS-01, 02, CP-LIFE-01 to 03 | Hiding/reset/disposal cases | Pass/outstanding |
| CP-SEC-01 to 04 | Security tests, budget cases | Pass/outstanding |
| CP-CORE-01, 02, 04 | Build, Node consumption, rendering tests | Pass/outstanding |
| CP-COMPAT-01 to 05 | Compatibility notes, migration examples | Pass/outstanding |
| CP-ACCEPT-01 to 05 | Acceptance matrix and command results | Pass/outstanding |

## 14. Revision history

| Revision | Date | Notes |
| --- | --- | --- |
| `component-protocol-1` | 2026-10-23 | Initial version; originally applied to `local-draft-1` and package version `0.3.0`, defining component contribution, acceptance and extension boundaries. |


See [local-draft-2 components and migration](local-components-v2-en.md) for new tags, colors and slot state. This checkout is unreleased.
