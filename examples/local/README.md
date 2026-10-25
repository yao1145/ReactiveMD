# Local interaction syntax demo

These are standalone authoring examples for `local-draft-2`, described in the [local interaction syntax specification](../../docs/local-interaction-syntax-en.md). The Playground starts with a [quick calculator](pricing.reactive.md), followed by six focused [feature tours](showcase/README.md). Components are distributed across these six scenarios; diagnostics has an auxiliary menu. Hosts can compile and render every document through the [local mode API](../../docs/local-integration-en.md).

The original eleven working examples and one intentionally broken diagnostics document remain in this directory, with Chinese versions in [zh/](zh/). The six feature tours live in [showcase/](showcase/README.md), with Chinese sources in [showcase/zh/](showcase/zh/). Each file runs independently. Controls, expressions and visualizations use local state.

The new [HTML compatibility example](html-compat.reactive.md) combines rich disclosures, Markdown and a bound counter. See the [temporary HTML routing policy](../../docs/html-compatibility-en.md) before enabling author CSS, JavaScript or extended HTML.

## Start with the short examples

The [workshop recipe](recipes/workshop.reactive.md) ([中文](recipes/workshop-zh.reactive.md)) combines cross-field validation, conditional tones, numeric aggregates and generated table rows. See the [constraints and collections reference](../../docs/constraints-collections-en.md) for rules and budgets.

The [invoice recipe](recipes/invoice.reactive.md) ([中文](recipes/invoice-zh.reactive.md)) demonstrates shared calculations, constants, formatting and UTC date differences. The [calculation reference](../../docs/computations-formatting-en.md) explains its rules.

Start with the [plan calculator](pricing.reactive.md), then choose a [feature tour](showcase/README.md). For the smallest possible state example, read the original [counter](counter.reactive.md). If you are new to the syntax, read the [new user guide](../../docs/local-guide-en.md).

## Original standalone catalog

| File | Contents |
| --- | --- |
| [counter.reactive.md](counter.reactive.md) | One-line counter with built-in plus, minus and reset |
| [pricing.reactive.md](pricing.reactive.md) | Plan calculator with parameters linked inside a panel |
| [comparison.reactive.md](comparison.reactive.md) | Side-by-side comparison, a switch declared in place, tabs that manage their own selection |
| [parameters.reactive.md](parameters.reactive.md) | Live parameter panel with text, date and choice inputs |
| [checklist.reactive.md](checklist.reactive.md) | Fixed checkable list and an enhanced table |
| [charts.reactive.md](charts.reactive.md) | Charts built from tables, with a compound-interest formula in LaTeX |
| [diagram.reactive.md](diagram.reactive.md) | Auto-laid-out interactive diagram and curves |
| [catalog.reactive.md](catalog.reactive.md) | Local catalog search, sorting and paging |
| [planning.reactive.md](planning.reactive.md) | Timeline, timer and bill-splitting calculation |
| [components.reactive.md](components.reactive.md) | Content cards, disclosures, tabs and hint components |
| [gallery.reactive.md](gallery.reactive.md) | Common inputs, standalone components and code shown as-is |
| [diagnostics.reactive.md](diagnostics.reactive.md) | Intentionally broken diagnostics example |

The Playground example index is maintained in the repository's demo application.

## Expected behavior of the working examples

The table below lists the initial values and interaction checkpoints for each document. Numbers follow the formulas in the prose.

| Example | Initial display | Interaction checks |
| --- | --- | --- |
| comparison | Basic 100 USD, Pro 200 USD | Annual billing changes them to 80/160; switching tabs needs no declared variable; reset returns to monthly billing |
| parameters | Date 2026-10-22, personal use, name empty | Entering a name updates the card; selecting team use updates the description; checking the switch shows the preparation checklist; panel reset restores fields and switches |
| checklist | 1/3 items, progress about 33.33% | Selecting all shows the completion notice; reset restores only the first item; the table sorts by price, searches and pages |
| charts | 4 budget comparisons; savings parameters 10000, 500, 5%, 20 years; plan bars 40/70 | With the rate at 0 the end-of-curve readout is 130000; the default compound readout is about 232643.24; with 5 people the bars are 100/175 |
| diagram | Input node selected, a=1, f=1 | Clicking the compute node updates the details and prose; at a=0 the curve flattens and a notice appears; both fixed curves are shown together |
| catalog | 8 catalog rows, 4 rows per page | Searching for "visual" returns chart/plot/diagram; no match shows the empty state; reset clears the query, sorting and page |
| planning | 45-minute timeline, countdown paused at 60 seconds, 88 USD per person | timer start/pause/reset; with the extra charge at 0 each person pays 80 USD; the reference task starting at 15 overlaps the main section |
| components | Concise explanation, first disclosure open | Selecting detailed switches the prose; the tooltip is keyboard-focusable; other disclosures open independently |
| pricing | 2 people, 100 USD each, 200 USD total | Annual billing gives 160 USD; annual billing for 5 people is 400 USD and shows the team notice; reset returns to 200 USD |
| counter | 0 | Three increments show 3; three decrements return to 0 and disable minus; reset returns to 0 |
| gallery | Alex, quantity 3, Pro, monthly billing, cost 240 USD | Annual billing gives 192 USD; hiding and showing the express section keeps its checks; the standalone counter and timer need no bind; `example` in the code block creates no variable |

In parameters, the conditional checklist sits outside the panel: its existing checks survive hiding and are outside that panel's reset scope. The standalone counter and timer in gallery also sit outside the input panel, so resetting the input panel does not affect them.

## Expected results of the diagnostics example

[diagnostics.reactive.md](diagnostics.reactive.md) intentionally contains the following 9 error classes. The editor should collect recoverable, independent diagnostics, and the document as a whole must not activate interactions.

1. `seat` is not declared; the message can suggest the existing parameter `seats`.
2. `seats` has a duplicate explicit initial; both sources are reported.
3. `ratio` has initial value 12, above the maximum 10.
4. if.when receives `seats`, a number, where a boolean is required.
5. `slidr` is an unknown component; the message can suggest `slider`.
6. `on-click` is not part of counter or the local interaction event syntax.
7. The edge target `missing` does not exist.
8. The integral can be displayed but is not a computable structure in the first plot version.
9. The chart's cost column contains `20 USD`, text where a plain number is required.

## Check entry points

`npm test` checks parsing, bindings, expressions, LaTeX, the runtime and examples; `npm run test:demo` checks the Playground index; `npm run verify:release` runs the complete Node-side and browser gate, including real-tarball consumption and HTML export. See the [contributing guide](../../CONTRIBUTING.md) for individual commands.

The [six scenarios](showcase/README.md) include all 48 tag names: intervals, coordinates and numeric questions in Functions; input choices in Forms; linked selection in Data; jumps and prose colors in Layout; guided steps and choice questions in Flow; todos and timing in Checklists. The standalone gallery and interaction-tour sources remain available as authoring examples.
