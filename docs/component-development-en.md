# Component development guide

This guide is for contributors adding or changing components in Reactive MD. Components include input controls, containers, visualizations and structural children. The shared contract is in the [component protocol](component-protocol-en.md); the author syntax is in the [local interaction syntax specification](local-interaction-syntax-en.md).

The current protocol is `component-protocol-2`, the applicable syntax is `local-draft-2`, and the current package version is `0.4.0`, the preview release on the `next` channel. These three versions represent the contribution contract, the author syntax and the npm release. Updating the protocol document does not automatically change the syntax or public API.

## 1. What to submit

A complete component contribution includes a declaration, implementation, examples and acceptance evidence. Use the template in section 5 to describe the behavior first, then change code according to the implementation surfaces affected. Review needs to answer: how authors can write it, how readers operate it, how it behaves on errors, and what happens to existing documents after an upgrade.

The project currently extends components through repository code. There is no public runtime registrar, loadable component JSON or author import syntax; `LocalComponentSchema`, `LOCAL_COMPONENTS` and renderer-internal contexts are not a stable plugin SDK either. Conformance JSON contains source and expected results, not a component installation package.

Components continue to follow the simple local interaction scope. Inputs are named with `bind`, and outputs are read through expressions. Network services, author scripts, arbitrary HTML, event handlers, author CSS and persisted state are not part of the current author language. Images and links use the host-controlled URL policy; see the [security policy](../SECURITY.md) for details.

## 2. From proposal to acceptance

1. Submit the declaration template in section 5, stating purpose, syntax, state, errors, budgets and version impact. When it overlaps existing components, explain what a combination of existing components or Markdown still lacks.
2. Mark the applicable `CP-*` clauses. A component without bindings, timing or computation may mark the corresponding items as "not applicable" and explain why.
3. Check the implementation locations in the table below. When reusing existing generic logic, explain why no new branch is needed; when a new branch is needed, check the compiler and runtime consumers together.
4. Add a minimal normal example, invalid input and boundary cases. For state, check initialization, rejected writes, sharing, hiding and reset; for computation, check budgets.
5. Run the affected checks from section 6. Keep the commands, results and browser observations, and state outstanding items clearly.
6. Update the syntax, compatibility notes, changelog and relevant examples. Attach the declaration and evidence in the PR so maintainers can verify version and migration impact.

| Implementation surface | Location | What to check |
| --- | --- | --- |
| Tag parsing | `src/local/parser.ts` | `VOID`, `PAIRED`, `INLINE` and the `KNOWN` set generated from them; shape, nesting, code isolation and unknown-region fallback |
| Component declaration | `src/local/schema.ts` | Name, `form`, `childRule`, parent, attribute types and defaults, `binding`, `initialRule` |
| Compilation | `src/local/compiler.ts` | Attributes and child content, expression types, binding family, shared constraints, initial values and budgets |
| State runtime | `src/local/runtime.ts` | Canonical control lookup, write types and constraints, atomic commits, array copies, reset and disposal |
| Controls and layout | `src/local/LocalDocumentView.tsx` | `COMPONENTS`, input drafts, accessible names, keyboard, visibility, reset tokens and effect cleanup |
| Visualization | `src/local/visuals.tsx`, `src/local/math.ts` | `VISUAL_COMPONENTS`, plot or table semantics, local errors, computation budgets, readouts and reset |
| Styles | `src/local/local.css`, `src/local/visuals.css`, `src/theme.css` | Theme variables, class prefixes, focus, narrow screens and styling effects outside the document |
| Budgets and types | `src/local/limits.ts`, `src/local/types.ts`, `src/local/render-types.ts` | Boundaries for new resources; core types do not depend on React; internal nodes do not become a persistence format |
| Evidence and documentation | `tests/`, [conformance data](../examples/conformance/README.md), [syntax specification](local-interaction-syntax-en.md) | Concrete behavior cases, copyable examples, migration and check records |

A new declaration does not automatically synchronize the parser, runtime and renderer. Conversely, when existing generic validation is sufficient, there is no need to add branches just to complete the file checklist.

## 3. How to judge compatibility

Judge by the [compatibility notes](compatibility-en.md) and the CP-COMPAT clauses of the protocol. The project currently requires author-visible syntax changes to establish a new syntax revision and raise the package minor version; "the old valid form still works" does not mean a new tag can be added within the same syntax revision.

| Change | Handling |
| --- | --- |
| New tag, new author-visible attribute | Record it as a capability addition, establish a new syntax revision, update `LOCAL_SYNTAX_VERSION`, the package minor version, the syntax specification and conformance data |
| Rename, removal, changed default, binding type, child item or initial-value rule | Record as a breaking change and provide the old form, new form, affected scope and migration checks |
| Implementation fix, optimization or style adjustment that keeps existing semantics, accessibility and resource boundaries | Add regression evidence according to actual impact; classify public API or author semantics changes separately |
| Diagnostic code change | Update the corresponding conformance data and changelog; follow the 0.x diagnostic code compatibility convention and do not depend on message text |
| Change to a MUST clause, required declaration or machine format semantics of this protocol | Raise the protocol revision; judge separately whether syntax or API changes |

A new tag has one more migration impact: the old implementation displays the complete unknown region as inert source, while the new implementation may start executing inner content after recognizing the name. This must be recorded in the proposal with before/after cases. Whether a name joins the core component set is reviewed by maintainers; do not override the meaning of an existing name or quietly add an alias.

This protocol itself adds no author tags or attributes, so it keeps `local-draft-2` and the current package version.

## 4. Filling in a declaration with existing components

The three existing components below show the contracts for a control, a container and a computational visualization. They are executable examples, not design drafts for a new API.

### slider: a numeric control

```markdown
<slider bind="seats" label="People" initial="2" min="1" max="20">

Current cost: {{ seats * 100 }} USD.
```

Declaration points: no body, number family, shareable binding; `min/max/step` are static constraints with defaults `0/100/1`; omitting `initial` takes `min`. Same-name numeric controls must have identical constraints, and there can be at most one explicit initial value.

Acceptance should prove that the initial value is 2, valid writes change the cost, out-of-range and off-step writes are rejected, a rejected write leaves the unchanged complete snapshot and revision, and shared controls read the same value. Without `bind`, check the independent internal state. Panel reset restores compile-time initial values; real dragging and keyboard stepping need browser evidence. Corresponding protocol clauses: CP-STATE-03, 04, 06, 08, 10.

### tabs: a stateful container

```markdown
<panel title="Plan">
<tabs bind="page" label="Plan pages" initial="basic">
<tab label="Basic" value="basic">
<slider bind="a" label="Basic quantity" initial="2" min="0" max="10">
</tab>
<tab label="Advanced" value="advanced">
<slider bind="b" label="Advanced quantity" initial="7" min="0" max="10">
</tab>
</tabs>
</panel>
```

Declaration points: `tabs` accepts only `tab` children, exposes a string value, and owns the binding exclusively. `tab.value` is unique; when omitted, `tab-1`, `tab-2` are generated in source order. Without `initial`, the first tab is selected. Without `bind`, selection stays inside the component.

Acceptance should prove that `b` on the inactive page still initializes to 7, switching preserves child content state, unknown page values are rejected, a second component cannot declare the same binding, and panel reset restores the page and child controls. Arrow keys, Home/End, focus, and the need for the reader to start a paused hidden timer again require corresponding browser checks. Corresponding protocol clauses: CP-STATE-11, CP-VIS and CP-LIFE.

### plot: budget-constrained computation

```markdown
<slider bind="a" label="Amplitude" initial="1" min="0" max="3" step="0.5">
<slider bind="high" label="Right bound" initial="3" min="1" max="10">

<plot label="Sine wave" min="-2" max="{{ high }}">
$$ y = a \sin x $$
</plot>
```

Declaration points: the body is one or more standalone formula blocks, each written `y = expression`; `min/max` may be dynamic and require `min < max`; `samples` is a static integer, default 200, range 2 to 2000. Formula parameters must be declared numeric bindings.

Acceptance should cover valid LaTeX, parameter changes, dynamic ranges, non-numeric parameters and invalid ranges. Each plot has at most 16 curves; the whole document may request at most 20,000 sample points, and computation shares a budget of 2,000,000 steps, including hidden regions. Invalid samples should break the curve; empty data and local errors need explicit display. Pointer and keyboard readouts, narrow screens and legend interaction need separate browser checks. Corresponding protocol clauses: CP-STATE-12, CP-DIAG-04, CP-SEC-03.

## 5. Copyable proposal template

Copy the following into an issue, a PR description or a standalone design document. Replace every placeholder with an actual decision and explain why an item does not apply. Attribute declarations are review material, not a runtime-loadable schema.

```markdown
# Component proposal: <name>

## Purpose and boundaries

- Concrete document need to solve:
- Reader-triggered actions and observable results:
- Capability missing from existing components or Markdown combinations:
- Non-goals of this component:

## Version and name

| Item | Decision |
| --- | --- |
| Package version | Current value, target value and rationale |
| Syntax revision | Current value, target value and migration impact |
| Protocol revision | component-protocol-2, or describe the new revision |
| Name | Lowercase kebab-case; conflict check and maintainer decision |
| Shape | leaf / inline / container |
| Parent, direct children | Allowed scope, count, nesting and whitespace rules |

## Syntax

Provide a minimal runnable document and one form that must be rejected.

## Attributes

| Attribute | Type and unit | Static or dynamic | Required | Default | Constraints and failure diagnostics |
| --- | --- | --- | --- | --- | --- |
| To fill in | string/number/boolean/enum | Whether interpolation is allowed, how types are preserved | Yes/No | Specific value or none | Range, enum, length, code |

## State

- Whether there is a bind; value type and family; whether it is exclusive:
- How explicit and default initial values are produced:
- Conditions under which a same-name binding may be shared:
- Valid writes, invalid writes, atomicity and subscriptions:
- Input drafts and internal UI state:
- Scope of panel reset, shared values and internal state:
- Hiding, showing again, source changes, instance isolation:
- Timers, subscriptions, event listeners and disposal:

## Diagnostics and fallback

| Trigger | Phase | severity and code | Location | Expected result |
| --- | --- | --- | --- | --- |
| To fill in | compile/runtime/render | warning/error, specific code | Source range | Reject, keep the old state or show locally |

Describe the old implementation's behavior when displaying the unknown tag as source, and what changes once the name is recognized.

## Security, budgets and presentation

- How untrusted input is validated; responsibilities of trusted host code:
- Budgets for input length, collection size, computation count, recursion or sampling:
- Who sets budgets, at which phases they are checked, and the result when exceeded:
- Accessible name, role, state, keyboard and focus:
- 375px, touch targets, dark theme and style scoping:
- Style files and theme variables added or changed:

## Compatibility and migration

- Change classification and rationale:
- Old form, old result:
- New form, new result:
- Affected source, host API, diagnostics, budgets or rendering behavior:
- Migration method and post-upgrade verification:

## Files and acceptance

| Applicable CP-* clauses | Files to change | Cases or checks | Actual results and evidence |
| --- | --- | --- | --- |
| To fill in | Real paths; explain reuse when no change is needed | Normal, invalid, boundary, state or browser checks | Pass/fail/not run |

- Portable conformance data and component-specific tests:
- Commands actually run and their results:
- Browser, viewport, specific actions and observations:
- Outstanding evidence; rationale and alternative evidence for SHOULD deviations:
```

Proposals must satisfy applicable MUST clauses. SHOULD deviations record the reason, impact and alternative evidence. Existing components do not automatically become "certified" because the template exists.

## 6. Choosing checks by impact

Install existing dependencies in the root directory before running checks; see the [contributing guide](../CONTRIBUTING.md) for the environment and full commands. Behavior changes must have tests that directly cover the behavior; the table below is used to determine the scope of checks.

| Change | Minimum useful checks |
| --- | --- |
| Protocol, guide or links only | `npm run test:docs`; verify the rules against the current syntax, security and compatibility documentation |
| Conformance data or runner | `npm run test:components`, `npm run typecheck` |
| Parsing, compilation, bindings or runtime | Targeted tests for the component, `npm run test:components`, `npm run build`; run related regressions or `npm test` for shared logic changes |
| React, styles or interaction | Corresponding renderer tests, `npm run build:demo`, and affected browser actions |
| Public entries, types or distribution files | After building, run `npm run test:package`, `npm run test:packed` |
| Documentation, syntax, examples or versions | `npm run test:docs`, compilation of the corresponding examples and a migration review |
| Full release gate | `npm run verify:release`; it covers the Node-side and browser checks, packed consumption and combined document behavior. Use it before release or when a change spans several of the rows above |

`npm run test:components` runs the protocol's representative `slider`, `tabs` and `plot` cases plus existing language conformance data. See the [conformance notes](../examples/conformance/README.md) for file format, field meaning and execution order. New components keep adding their own cases; this command does not prove that all 48 tag names or all browser behavior are certified. Added `tests/**/*.test.ts` or `.tsx` files are also run by the existing `npm test` and CI.

Browser checks must record the specific environment and actions. Check real keyboard and focus, IME drafts, 375px layout, touch, themes, reset, hiding and showing again, timer pause and unmount cleanup as applicable to the component. Existing automated browser checks can provide evidence for corresponding behavior; items not yet covered, such as screen reader experience, require manual checks. Static SSR proves only server output, not real input, effect lifecycles or hydration.

List the commands actually run and observations in the PR. State not run, failed and not applicable separately; do not treat checked boxes as verification evidence.


See [local-draft-2 components and migration](local-components-v2-en.md) for new tags, colors and slot state. `0.4.0` is the preview release on the `next` channel.
