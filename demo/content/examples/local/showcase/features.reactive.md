# Feature demo

Functions, forms, charts, layouts, diagrams and timers in one document. Follow the outline, try the controls, or open the source and copy a section into your own document.

<const name="functionsMonthsPerYear" value="{{ 12 }}">
<computed name="functionsMonthlyRate" value="{{ functionsR / (100 * functionsMonthsPerYear) }}">
<computed name="functionsGrowthFactor" value="{{ pow(1 + functionsMonthlyRate, functionsMonthsPerYear * functionsT) }}">
<computed name="functionsEndingBalance" value="{{ functionsMonthlyRate == 0 ? functionsP + functionsMonthsPerYear * functionsM * functionsT : functionsP * functionsGrowthFactor + functionsM * (functionsGrowthFactor - 1) / functionsMonthlyRate }}">
<computed name="functionsDeposits" value="{{ functionsP + functionsMonthsPerYear * functionsM * functionsT }}">
<computed name="functionsDistance" value="{{ sqrt(functionsPx * functionsPx + functionsPy * functionsPy) }}">
<computed name="functionsWaveHeight" value="{{ functionsA * sin(functionsF * functionsPx) }}">
<computed name="functionsInsideInterval" value="{{ functionsPx >= functionsLow && functionsPx <= functionsHigh }}">

## Functions you can shape

Drag Amplitude to 0: the wave becomes a flat line. Restore it, then increase Frequency to fit more waves into the same interval.

<grid>
<card>
<panel title="Shape the wave">
<slider bind="functionsA" label="Amplitude" initial="1" min="0" max="3" step="0.5">
<slider bind="functionsF" label="Frequency" initial="1" min="0.5" max="3" step="0.5">
</panel>

Amplitude **{{ functionsA }}**, frequency **{{ functionsF }}**.

<if when="{{ functionsA == 0 }}">
<alert title="The wave is flat">Multiplying by zero makes every output zero, whatever the frequency.</alert>
</if>
</card>
<card>
<plot min="0" max="12.56" label="Adjustable sine wave" x-label="x" y-label="y">
$$ y = \mathrm{functionsA}\sin(\mathrm{functionsF}x) $$
</plot>
</card>
</grid>

### Explore the same parameters

<tabs label="Function explorations">
<tab label="Compare curves">
Both curves share the amplitude and frequency above. Compare their peaks and zero crossings.

<plot min="0" max="12.56" label="Sine and cosine">
$$ y = \mathrm{functionsA}\sin(\mathrm{functionsF}x) $$
$$ y = \mathrm{functionsA}\cos(\mathrm{functionsF}x) $$
</plot>
</tab>
<tab label="Piecewise function">
The negative side is linear; the positive side is quadratic. Amplitude scales both branches.

<plot min="-3" max="3" label="Linear meets quadratic">
$$
y = \begin{cases}
\mathrm{functionsA}x, & x < 0 \\
\mathrm{functionsA}x^2, & x \ge 0
\end{cases}
$$
</plot>
</tab>
<tab label="Savings application">
Monthly deposits and monthly compounding turn a formula into a small planning tool. Set the annual rate to zero to compare deposits alone.

<panel title="Savings parameters">
<number bind="functionsP" label="Starting amount" initial="10000" min="0" step="100">
<number bind="functionsM" label="Monthly deposit" initial="500" min="0" step="100">
<slider bind="functionsR" label="Annual rate (%)" initial="5" min="0" max="10" step="0.5">
<slider bind="functionsT" label="Years" initial="20" min="1" max="40">
</panel>

<plot min="0" max="{{ functionsT }}" label="Savings growth" x-label="Years" y-label="Amount">
$$
y = \begin{cases}
\mathrm{functionsP} + 12\mathrm{functionsM}x, & \mathrm{functionsR} = 0 \\
\mathrm{functionsP}\left(1+\mathrm{functionsMonthlyRate}\right)^{12x} + \mathrm{functionsM}\frac{\left(1+\mathrm{functionsMonthlyRate}\right)^{12x}-1}{\mathrm{functionsMonthlyRate}}, & \mathrm{functionsR} \ne 0
\end{cases}
$$
</plot>

At year **{{ functionsT }}**, the ending balance is **{{ formatCurrency(functionsEndingBalance, 'USD', 2, 'en-US') }}**: deposits of **{{ formatCurrency(functionsDeposits, 'USD', 2, 'en-US') }}** and interest of **{{ formatCurrency(functionsEndingBalance - functionsDeposits, 'USD', 2, 'en-US') }}**. The annual rate is **{{ formatPercent(functionsR / 100, 1, 'en-US') }}**. The curve and ending balance share the monthly rate; at zero rate they count deposits directly.
</tab>
</tabs>

### Explore a point and an interval

Choose an interval, then drag the point. Compare its horizontal position with the interval and read the wave height at that position.

<panel title="Point and interval">
<range-slider label="Observation interval" bind-start="functionsLow" bind-end="functionsHigh" initial-start="-3" initial-end="3" min="-5" max="5" color="#7c3aed">

Interval: **{{ functionsLow }}–{{ functionsHigh }}**. Width: **{{ functionsHigh - functionsLow }}**.

<coordinate label="Point position" bind-x="functionsPx" bind-y="functionsPy" initial-x="1" initial-y="2" x-min="-5" x-max="5" y-min="-5" y-max="5" color="#2563eb">

Point: **({{ functionsPx }}, {{ functionsPy }})**. Distance from the origin: **{{ formatNumber(functionsDistance, 2, 'en-US') }}**.

{{ functionsInsideInterval ? 'The point lies inside the horizontal interval.' : 'The point lies outside the horizontal interval.' }} Wave height at this x: **{{ formatNumber(functionsWaveHeight, 2, 'en-US') }}**.

The same height in scientific notation is **{{ formatScientific(functionsWaveHeight, 2, 'en-US') }}**, useful when comparing values near zero.

<quiz type="number" label="How far is (3, 4) from the origin?" answer="5" tolerance="0.01" explanation="The square root of 3² + 4² is 5. Try placing the point at (3, 4).">
</quiz>
</panel>

### How it is written

<accordion>
<disclosure label="Show the key source">

```markdown
<slider bind="a" label="Amplitude" initial="1" min="0" max="3" step="0.5">
<slider bind="f" label="Frequency" initial="1" min="0.5" max="3" step="0.5">
<coordinate label="Point position" bind-x="px" bind-y="py" initial-x="1" initial-y="2" x-min="-5" x-max="5" y-min="-5" y-max="5">
<computed name="waveHeight" value="{{ a * sin(f * px) }}">
Height: {{ formatNumber(waveHeight, 2) }} · {{ formatScientific(waveHeight, 2) }}

<plot min="0" max="12.56" label="Sine wave">
$$ y = a\sin(fx) $$
</plot>
```

</disclosure>
</accordion>

<computed name="formsOrganizer" value="{{ trim(formsName) == '' ? 'Your group' : trim(formsName) }}">
<computed name="formsUnitCost" value="{{ (formsFormat == 'onsite' ? 80 : 60) + (formsEquipment ? 20 : 0) }}">
<computed name="formsTotal" value="{{ formsSeats * formsUnitCost }}">
<computed name="formsDatesReady" value="{{ formsDate != '' && formsDeadline != '' && dateCompare(formsDeadline, formsDate) <= 0 }}">
<computed name="formsRegistrationGap" value="{{ formsDatesReady ? dateDiff(formsDate, formsDeadline) : null }}">

## Build a workshop plan

Change the name, headcount and format. Lower the budget or move the registration deadline past the workshop to see a hint; choose subjects to generate a preparation plan.

<grid>
<card>
<panel title="Workshop details">
<input bind="formsName" label="Organizer" initial="Alex" placeholder="Your name">
<choices bind="formsFormat" label="Format" initial="onsite">
<option value="onsite">In person</option>
<option value="online">Online</option>
</choices>
<slider bind="formsSeats" label="Participants" initial="4" min="1" max="20">
<date bind="formsDate" label="Workshop date" initial="2026-11-01">
<date bind="formsDeadline" label="Registration deadline" initial="2026-10-25">
<number bind="formsBudget" label="Spending limit" initial="500" min="0" max="5000" step="10">
<validation when="{{ formsDatesReady }}" message="Fill both dates and close registration on or before the workshop date." fields="formsDeadline formsDate">
<validation when="{{ formsTotal <= formsBudget }}" message="Estimate exceeds the limit by {{ formatCurrency(formsTotal - formsBudget, 'USD', 2, 'en-US') }}; adjust participants, materials or the limit." fields="formsSeats formsEquipment formsBudget">
<textarea bind="formsNotes" label="Special requests" placeholder="What would help your group?">
<toggle bind="formsEquipment" label="Include a materials kit (20 per person)">
</panel>
</card>

<card title="Your workshop at a glance">
**{{ formsOrganizer }}** · {{ formsDate }}

{{ formsFormat == 'onsite' ? 'In-person workshop' : 'Online workshop' }} · **{{ formsSeats }}** participants

Per person: **{{ formatCurrency(formsUnitCost, 'USD', 2, 'en-US') }}**

Estimated total: **{{ formatCurrency(formsTotal, 'USD', 2, 'en-US') }}**

<badge tone="{{ formsTotal <= formsBudget ? 'success' : 'warning' }}">Spending limit: {{ formatCurrency(formsBudget, 'USD', 2, 'en-US') }}</badge>

<if when="{{ formsDatesReady }}">
Registration closes **{{ formsDeadline }}**, **{{ formsRegistrationGap }}** days before the workshop.
</if>

Requests: {{ trim(formsNotes) == '' ? 'No special requests yet.' : trim(formsNotes) }}

<if when="{{ formsFormat == 'onsite' }}">
<alert title="Prepare the room">Reserve a room with at least {{ formsSeats }} seats and arrange a shared display.</alert>
</if>
<if when="{{ formsFormat == 'online' }}">
<alert title="Prepare the call">Share the meeting link and check that everyone can open the workshop document.</alert>
</if>
</card>
</grid>

### Try a complete change

Choose Online, set 6 participants and add materials: the estimate becomes **{{ formatCurrency(480, 'USD', 2, 'en-US') }}**. Reset Workshop details to return to the original **{{ formatCurrency(320, 'USD', 2, 'en-US') }}**.

### Tailor the workshop to your group

Choose the level, pace and subjects. These details shape the learning plan alongside the cost estimate above.

<panel title="Learning preferences">
<select bind="formsLevel" label="Experience level" initial="intro">
<option value="intro">First workshop</option>
<option value="advanced">Already familiar</option>
</select>

<radio-group bind="formsPace" label="Session pace" initial="guided">
<option value="guided">Guided practice</option>
<option value="independent">Independent exploration</option>
</radio-group>

<multi-select bind="formsSubjects" label="Workshop subjects" max-selected="2" color="#167875">
<option value="math">Mathematics</option>
<option value="physics">Physics</option>
<option value="chemistry">Chemistry</option>
</multi-select>

<checkbox bind="formsAccessible" label="Include a written step-by-step guide">

| Detail | Your choice |
| --- | --- |
| Level | {{ formsLevel == 'intro' ? 'Start with a worked example' : 'Compare several approaches' }} |
| Pace | {{ formsPace == 'guided' ? 'Work through the steps together' : 'Leave time to explore independently' }} |
| Subjects | {{ len(formsSubjects) }} / 2 selected |

<data-table label="Subject preparation" rows="{{ formsSubjects }}" key="{{ item }}" max-rows="2">
<column label="Subject" value="{{ item == 'math' ? 'Mathematics' : item == 'physics' ? 'Physics' : 'Chemistry' }}">
<column label="Preparation" value="{{ item == 'chemistry' ? 'Prepare materials and instructions' : 'Prepare a worked example' }}">
<column label="Guide" value="{{ formsAccessible ? 'Written steps included' : 'Live explanation' }}">
</data-table>

<if when="{{ contains(formsSubjects, 'chemistry') }}">
<badge color="#167875">Include a chemistry example</badge>
</if>
<if when="{{ formsAccessible }}">
<alert title="Prepare the written guide">Include the parameter names and the expected result for each step.</alert>
</if>
</panel>

### How it is written

<accordion>
<disclosure label="Show the key source">

```markdown
<const name="rate" value="{{ 80 }}">
<computed name="total" value="{{ seats * rate }}">
<slider bind="seats" label="Participants" initial="4" min="1" max="20">
<number bind="budget" label="Spending limit" initial="500" min="0" max="5000">
<validation when="{{ total <= budget }}" message="Adjust participants or the spending limit." fields="seats budget">
<badge tone="{{ total <= budget ? 'success' : 'warning' }}">{{ formatCurrency(total, 'USD', 2, 'en-US') }}</badge>

<multi-select bind="subjects" label="Subjects" max-selected="2">
<option value="math">Mathematics</option>
<option value="physics">Physics</option>
</multi-select>
<data-table label="Preparation" rows="{{ subjects }}" key="{{ item }}" max-rows="2">
<column label="Subject" value="{{ item == 'math' ? 'Mathematics' : 'Physics' }}">
</data-table>
```

</disclosure>
</accordion>

<const name="statisticsBudgets" value="{{ [150, 200, 220, 120] }}">
<computed name="statisticsExpenses" value="{{ [statisticsContent, statisticsVisual, statisticsInteraction, statisticsTesting] }}">
<computed name="statisticsBudget" value="{{ sum(statisticsBudgets) }}">
<computed name="statisticsTotal" value="{{ sum(statisticsExpenses) }}">
<computed name="statisticsRemaining" value="{{ statisticsBudget - statisticsTotal }}">

## One budget, several views

Raise Visual from 230 to 300. The total reaches the {{ formatCurrency(statisticsBudget, 'USD', 2, 'en-US') }} budget; increase it again to see the overspend warning. Every view reads the same four expense parameters.

<grid>
<card>
<panel title="Workshop expenses">
<number bind="statisticsContent" label="Content expense" initial="120" min="0" max="1000" step="10">
<number bind="statisticsVisual" label="Visual expense" initial="230" min="0" max="1000" step="10">
<number bind="statisticsInteraction" label="Interaction expense" initial="180" min="0" max="1000" step="10">
<number bind="statisticsTesting" label="Testing expense" initial="90" min="0" max="1000" step="10">
</panel>
</card>
<card>
<grid>
<card title="Total spent">**{{ formatCurrency(statisticsTotal, 'USD', 2, 'en-US') }}**</card>
<card title="Budget remaining">**{{ formatCurrency(statisticsRemaining, 'USD', 2, 'en-US') }}**</card>
</grid>

<badge tone="{{ statisticsRemaining >= 0 ? 'success' : 'warning' }}">Budget used: {{ formatPercent(statisticsTotal / statisticsBudget, 1, 'en-US') }}</badge>

Average item **{{ formatCurrency(average(statisticsExpenses), 'USD', 2, 'en-US') }}**; smallest **{{ formatCurrency(minOf(statisticsExpenses), 'USD', 2, 'en-US') }}**, largest **{{ formatCurrency(maxOf(statisticsExpenses), 'USD', 2, 'en-US') }}**.

<if when="{{ statisticsTotal > statisticsBudget }}">
<alert tone="warning" title="Over budget">Reduce expenses by **{{ formatCurrency(statisticsTotal - statisticsBudget, 'USD', 2, 'en-US') }}** to return to the {{ formatCurrency(statisticsBudget, 'USD', 2, 'en-US') }} budget.</alert>
</if>

<chart bind="statisticsSelectedExpense" key="Category" title="Actual against budget" y-label="USD">
| Category | Actual | Budget |
| --- | ---: | ---: |
| Content | {{ statisticsExpenses[0] }} | {{ statisticsBudgets[0] }} |
| Visual | {{ statisticsExpenses[1] }} | {{ statisticsBudgets[1] }} |
| Interaction | {{ statisticsExpenses[2] }} | {{ statisticsBudgets[2] }} |
| Testing | {{ statisticsExpenses[3] }} | {{ statisticsBudgets[3] }} |
</chart>
</card>
</grid>

### Inspect the data

Search for a category, sort by Actual, or turn the page. Search filters this table; the charts continue to show all four categories.

<table bind="statisticsSelectedExpense" key="Category" initial="Content" label="Expense details" page-size="2">
| Category | Actual | Budget |
| --- | ---: | ---: |
| Content | {{ statisticsExpenses[0] }} | {{ statisticsBudgets[0] }} |
| Visual | {{ statisticsExpenses[1] }} | {{ statisticsBudgets[1] }} |
| Interaction | {{ statisticsExpenses[2] }} | {{ statisticsBudgets[2] }} |
| Testing | {{ statisticsExpenses[3] }} | {{ statisticsBudgets[3] }} |
</table>

Selected expense: **{{ statisticsSelectedExpense }}**. Choose a row or chart mark to select the same category in the other views. Searching, sorting and paging preserve the selection.

### Change the perspective

<tabs label="Budget perspectives">
<tab label="Share of expenses">
<chart bind="statisticsSelectedExpense" key="Category" kind="donut" title="Where the money goes">
| Category | Actual |
| --- | ---: |
| Content | {{ statisticsExpenses[0] }} |
| Visual | {{ statisticsExpenses[1] }} |
| Interaction | {{ statisticsExpenses[2] }} |
| Testing | {{ statisticsExpenses[3] }} |
</chart>
</tab>
<tab label="Budget and actual">
<chart bind="statisticsSelectedExpense" key="Category" kind="scatter" title="Budget versus actual" x="Budget" y="Actual" x-label="Budget" y-label="Actual">
| Category | Actual | Budget |
| --- | ---: | ---: |
| Content | {{ statisticsExpenses[0] }} | {{ statisticsBudgets[0] }} |
| Visual | {{ statisticsExpenses[1] }} | {{ statisticsBudgets[1] }} |
| Interaction | {{ statisticsExpenses[2] }} | {{ statisticsBudgets[2] }} |
| Testing | {{ statisticsExpenses[3] }} | {{ statisticsBudgets[3] }} |
</chart>
</tab>
</tabs>

### How it is written

<accordion>
<disclosure label="Show the key source">

```markdown
<const name="budgets" value="{{ [150, 200, 220, 120] }}">
<number bind="content" label="Content expense" initial="120" min="0" max="1000">
<number bind="visual" label="Visual expense" initial="230" min="0" max="1000">
<number bind="interaction" label="Interaction expense" initial="180" min="0" max="1000">
<number bind="testing" label="Testing expense" initial="90" min="0" max="1000">
<computed name="expenses" value="{{ [content, visual, interaction, testing] }}">
<computed name="total" value="{{ sum(expenses) }}">
Total: {{ formatCurrency(total, 'USD', 2, 'en-US') }}

<chart title="Actual against budget">
| Category | Actual | Budget |
| --- | ---: | ---: |
| Visual | {{ expenses[1] }} | {{ budgets[1] }} |
</chart>
```

</disclosure>
</accordion>

<const name="layoutWorkshopDay" value="{{ '2026-11-01' }}">
<computed name="layoutReadingPhase" value="{{ layoutReadingDate == '' ? 'undated' : dateCompare(layoutReadingDate, layoutWorkshopDay) < 0 ? 'before' : dateCompare(layoutReadingDate, layoutWorkshopDay) == 0 ? 'during' : 'after' }}">
<computed name="layoutDaysUntil" value="{{ layoutReadingDate == '' ? null : dateDiff(layoutWorkshopDay, layoutReadingDate) }}">

## A workshop guide at every reading depth

Compare the cards, then move the reading date to workshop day or later and watch the guidance change. Switch reading roles and expand a question to find the detail you need.

<anchor id="reading-start">

<section color="#45536f">
Find the level of detail you need. <text color="#a2273a">**Keep important reminders in view.**</text> Paragraphs can share a color while a few words carry their own emphasis.
</section>

<jump to="reading-details" appearance="button" color="#2563eb">Jump to the questions</jump>

<panel title="Reading date">
<date bind="layoutReadingDate" label="When are you reading?" initial="2026-10-24">
</panel>

<badge tone="{{ layoutReadingPhase == 'before' ? 'neutral' : layoutReadingPhase == 'undated' ? 'warning' : 'success' }}">{{ layoutReadingPhase == 'before' ? 'Before: prepare' : layoutReadingPhase == 'during' ? 'Workshop day: explore' : layoutReadingPhase == 'after' ? 'After: reflect' : 'Choose a reading date' }}</badge>

<if when="{{ layoutReadingPhase == 'before' }}">
The workshop is on **{{ layoutWorkshopDay }}**, with **{{ layoutDaysUntil }}** days to prepare. Start with the preparation card.
</if>
<if when="{{ layoutReadingPhase == 'after' }}">
The workshop was **{{ layoutDaysUntil == null ? 0 : -layoutDaysUntil }}** days ago. Revisit a useful exploration and share it with a partner.
</if>

<grid>
<card title="Before the workshop">
Bring a short Markdown document and one idea you want readers to explore.

<badge>Preparation</badge>
</card>
<card title="During the workshop">
Turn an input into a live explanation, then share what changes when you adjust it.

<badge tone="success">Hands-on</badge>
</card>
</grid>

### Choose your reading role

<tabs label="Workshop roles">
<tab label="Participant">
#### Make one idea interactive

1. Start with a number readers can change.
2. Connect it to a sentence or a chart.
3. Ask a partner to explore the result.

A <tooltip text="A named input lets prose and visualizations read its current value.">reactive binding</tooltip> keeps the explanation connected to the input.
</tab>
<tab label="Facilitator">
#### Guide the exploration

Show the result first. Invite one clear change, ask what happened, then open the source to explain the relationship.

> Useful prompt: What changes if we double this value?
</tab>
</tabs>

<anchor id="reading-details">

### Open the detail you need

<accordion label="Workshop questions">
<disclosure label="What should I prepare?" open>
A browser, a short document and a concrete question are enough to begin.
</disclosure>
<disclosure label="How do these layouts work together?">
Cards compare related ideas, tabs separate reading contexts, and disclosures keep optional details within reach.
</disclosure>
</accordion>

<alert title="Keep the reading path clear">Place the main explanation first and let readers choose when to open supporting detail.</alert>

<jump to="reading-start" appearance="button" color="#2563eb">Return to the overview</jump>

### How it is written

<accordion>
<disclosure label="Show the key source">

```markdown
<const name="workshopDay" value="{{ '2026-11-01' }}">
<date bind="readingDate" label="Reading date" initial="2026-10-24">
<computed name="daysUntil" value="{{ readingDate == '' ? null : dateDiff(workshopDay, readingDate) }}">
<grid>
<card title="Workshop date">{{ workshopDay }}</card>
<card title="Days until workshop">{{ daysUntil }}</card>
</grid>
<accordion>
<disclosure label="Read more">Supporting detail goes here.</disclosure>
</accordion>
```

</disclosure>
</accordion>

<const name="flowRate" value="{{ 80 }}">
<computed name="flowTotal" value="{{ flowPeople * flowRate }}">

## Follow a value through a document

Change the headcount, then select Input, Compute and Display in the diagram. Follow the same value from the control to the final explanation.

<panel title="Try a value">
<slider bind="flowPeople" label="Headcount" initial="4" min="1" max="12">
</panel>

<diagram bind="flowSelected" initial="input" label="From input to explanation">
<node id="input" label="Input: {{ flowPeople }}">
The slider names its value people. Its current value is **{{ flowPeople }}**.
</node>
<node id="compute" label="Compute: {{ flowPeople }} × {{ flowRate }}">
Each participant costs 80, so the total is **{{ flowPeople }} × {{ flowRate }} = {{ flowTotal }}**.
</node>
<node id="view" label="Display: {{ flowTotal }}">
The prose reads the read-only total: the workshop costs **{{ formatCurrency(flowTotal, 'USD', 2, 'en-US') }}**. The calculation node and explanations share this result.
</node>
<edge from="input" to="compute" label="Value changes">
<edge from="compute" to="view" label="Result updates">
</diagram>

You are exploring: **{{ flowSelected == 'input' ? 'Input' : flowSelected == 'compute' ? 'Compute' : 'Display' }}**.

<if when="{{ flowSelected == 'input' }}">
<alert title="Start with what readers can change">Try 6 people, then select Compute to follow the calculation.</alert>
</if>
<if when="{{ flowSelected == 'compute' }}">
<alert title="Make the relationship visible">The named calculation total = people * rate gives **{{ flowTotal }}**.</alert>
</if>
<if when="{{ flowSelected == 'view' }}">
<alert tone="success" title="The document now explains the result">For {{ flowPeople }} people, the total is **{{ flowTotal }}**.</alert>
</if>

### Explore with the keyboard

Tab to a diagram node, move focus with the arrow keys, then press Enter or Space to select it. The selected explanation and the text below the diagram stay in sync.

### Explain the flow one step at a time

<steps label="Explanation path" bind="flowLesson">
<step label="Read the input" value="observe">
Start at the Input node: the current headcount is **{{ flowPeople }}**.
</step>
<step label="Check the calculation" value="calculate">
Select Compute. Each participant costs 80, giving **{{ flowPeople }} × {{ flowRate }} = {{ flowTotal }}**.
</step>
<step label="Explain the result" value="practice">
Select Display and explain why the total changes when headcount changes.

<quiz type="choice" label="Which expression calculates the total?" answer="total" explanation="Multiply headcount by the cost per participant.">
<option value="total">people × 80</option>
<option value="sum">people + 80</option>
<option value="fixed">80</option>
</quiz>

<counter label="Practice rounds" initial="0" min="0" max="10">
</step>
</steps>

Current step: **{{ flowLesson }}**. After explaining the result to a partner, count one practice round.

### How it is written

<accordion>
<disclosure label="Show the key source">

```markdown
<const name="rate" value="{{ 80 }}">
<computed name="total" value="{{ people * rate }}">
<slider bind="people" label="Headcount" initial="4" min="1" max="12">
<diagram bind="selected" initial="input" label="A short flow">
<node id="input" label="Input: {{ people }}">Read headcount.</node>
<node id="compute" label="Compute: {{ total }}">{{ people }} × {{ rate }} = {{ total }}</node>
<node id="view" label="Display: {{ total }}">{{ formatCurrency(total, 'USD', 2, 'en-US') }}</node>
<edge from="input" to="compute">
<edge from="compute" to="view">
</diagram>
Selected node: {{ selected }}
```

</disclosure>
</accordion>

<const name="tasksPreparationCount" value="{{ 3 }}">
<computed name="tasksReadyCount" value="{{ len(tasksDone) }}">
<computed name="tasksCompletion" value="{{ tasksReadyCount / tasksPreparationCount }}">
<computed name="tasksReadyToShare" value="{{ tasksReadyCount == tasksPreparationCount }}">

## Run a focused workshop

Check off the preparation steps, count the participants and start a short focus timer. This page keeps the plan, progress and timing together.

<panel title="Workshop readiness">
<checklist color="#167875" bind="tasksDone" label="Prepare together">
- [x] Choose one question to explore
- [ ] Open the document and adjust a parameter
- [ ] Explain the result to a partner
</checklist>

Ready: **{{ tasksReadyCount }} / {{ tasksPreparationCount }}**. Checking an item adds its reflection prompt below.

<progress color="#167875" label="Preparation progress" value="{{ tasksCompletion * 100 }}">

<badge tone="{{ tasksReadyToShare ? 'success' : 'neutral' }}">{{ formatPercent(tasksCompletion, 0, 'en-US') }} complete</badge>

<data-table label="Completed preparation" rows="{{ tasksDone }}" key="{{ item }}" max-rows="3">
<column label="Task" value="{{ item == 'item-1' ? 'Choose a question' : item == 'item-2' ? 'Adjust a parameter' : 'Explain to a partner' }}">
<column label="Reflection" value="{{ item == 'item-1' ? 'What do we want to learn?' : item == 'item-2' ? 'What changed?' : 'How can we explain it?' }}">
</data-table>

<if when="{{ tasksReadyToShare }}">
<alert tone="success" title="Ready to share">Everyone has a question, a working example and a result to discuss.</alert>
</if>
</panel>

<grid>
<card title="People in the room">
<counter bind="tasksCount" label="Participants present" initial="0" min="0" max="20">
Present: **{{ tasksCount }}**.
</card>
<card title="One minute to explore">
<timer label="Focus timer" duration="60">
Start when you are ready. Pause to discuss a result, or reset for another round.
</card>
</grid>

### See the whole session

<timeline title="A 45-minute workshop">
| Task | Start | Duration | Notes |
| --- | ---: | ---: | --- |
| Choose a question | 0 | 10 | Agree on one thing to explore |
| Build and explore | 10 | 25 | Try the controls and compare results |
| Collect observations | 15 | 15 | Take notes while exploring |
| Share back | 35 | 10 | Explain one useful finding |
</timeline>

Reset Workshop readiness to restore its checklist. The participant counter and timer are outside that panel and keep their own state.

### Keep track of the follow-up

Checked tasks are crossed out. Hide and reopen this list to see that your completed items stay checked.

<toggle bind="tasksFollowUp" label="Show follow-up tasks" initial="true">
<if when="{{ tasksFollowUp }}">
<checklist label="After sharing" color="#167875">
- [ ] Save a useful observation
- [ ] Share the document with a partner
</checklist>
</if>

### How it is written

<accordion>
<disclosure label="Show the key source">

```markdown
<checklist bind="done" label="Preparation">
- [x] Choose a question
- [ ] Explore a result
</checklist>
<computed name="completion" value="{{ len(done) / 2 }}">
<progress label="Progress" value="{{ completion * 100 }}">
{{ formatPercent(completion, 0) }}

<data-table label="Completed tasks" rows="{{ done }}" key="{{ item }}" max-rows="2">
<column label="Task" value="{{ item == 'item-1' ? 'Choose a question' : 'Explore a result' }}">
</data-table>
```

</disclosure>
</accordion>
