# Beacon release workspace

One calm surface for planning, reviewing and shipping a product release. Every control drives the prose, the readiness meter and the release data below. The built-in default theme supplies the warm paper, white panels, blue accent and soft elevation.

<badge tone="success">Workspace live</badge> <badge tone="warning">2 checks pending</badge> <badge tone="neutral">PU-01</badge>

<const name="baseSeatPrice" value="{{ 24 }}">
<computed name="seatSubtotal" value="{{ seats * baseSeatPrice }}">
<computed name="discountRate" value="{{ planTier == 'scale' ? 0.2 : planTier == 'growth' ? 0.1 : 0 }}">
<computed name="monthlyEstimate" value="{{ seatSubtotal * (1 - discountRate) }}">
<computed name="readiness" value="{{ (len(done) + (notify ? 1 : 0)) / 4 * 100 }}">

## 01 / Workspace parameters

Adjust the name, seats, tier and rollout coverage. The metric tiles and the estimate below update as you type or drag.

<panel title="Beacon workspace">
<input bind="workspaceName" label="Workspace name" initial="Beacon launch" placeholder="Name this workspace">
<number bind="seats" label="Seats" initial="12" min="1" max="200" step="1">
<select bind="planTier" label="Plan tier" initial="growth">
<option value="starter">Starter</option>
<option value="growth">Growth</option>
<option value="scale">Scale</option>
</select>
<slider bind="rolloutPct" label="Rollout coverage" initial="40" min="0" max="100" step="5">
<toggle bind="notify" label="Notify the release channel" initial="true">
<choices bind="visibility" label="Workspace visibility" initial="team">
<option value="private">Private</option>
<option value="team">Team</option>
<option value="company">Company</option>
</choices>
</panel>

**{{ workspaceName }}** is on the **{{ planTier }}** tier with **{{ seats }} seats**, priced at **{{ formatCurrency(monthlyEstimate, 'USD', 2, 'en-US') }}** per month before tax. The current rollout reaches **{{ rolloutPct }}%** of the audience and is visible to **{{ visibility }}** members.

<grid columns="3">
<card title="Monthly estimate">
**{{ formatCurrency(monthlyEstimate, 'USD', 2, 'en-US') }}**

Seat subtotal {{ formatCurrency(seatSubtotal, 'USD', 2, 'en-US') }} at a {{ formatPercent(discountRate, 0, 'en-US') }} tier discount.
</card>
<card title="Readiness">
**{{ formatNumber(readiness, 0) }}%**

<progress label="Launch readiness" value="{{ readiness }}">
</card>
<card title="Rollout window">
**{{ windowStart }}-{{ windowEnd }}%**

Coverage {{ rolloutPct }}% of the target audience.
</card>
</grid>

## 02 / Release actions

Try the counter and the timer. Drag both range handles to set a launch window, switch the notification toggle, then watch the readiness meter change as you complete the checklist in section 04.

<section color="#111111">
### Run the release

<counter bind="reviews" label="Review passes" initial="1" min="0" max="8">
<timer label="Focus timer" duration="120">
<progress label="Review progress" value="{{ reviews / 8 * 100 }}">
</section>

<section color="#111111">
### Schedule the window

<range-slider label="Rollout window" bind-start="windowStart" bind-end="windowEnd" initial-start="20" initial-end="80" min="0" max="100" step="5">

The window is **{{ windowStart }}% to {{ windowEnd }}%** of the audience, a span of **{{ windowEnd - windowStart }}** points. Drag either handle; the start cannot pass the end.
</section>

## 03 / Move through the launch

Switch tabs for context, then step through the rollout checkpoints. The current tab and step are live bindings.

### Switch views

<tabs label="Launch views" bind="launchView">
<tab label="Plan" value="plan">
Scope the release, confirm the owner and freeze the date. The workspace uses **{{ visibility }}** visibility for **{{ seats }}** seats.
</tab>
<tab label="Build" value="build">
Track review passes and keep the rollout window at **{{ windowStart }}-{{ windowEnd }}%** until the readiness meter clears **{{ formatNumber(readiness, 0) }}%**.
</tab>
<tab label="Ship" value="ship">
Send the release note to the **{{ planTier }}** workspace, then open the launch checklist and mark the final item.
</tab>
</tabs>

Current tab: **{{ launchView }}**.

### Step through the checkpoints

<steps label="Rollout checkpoint" bind="checkpoint">
<step label="Scope" value="scope">
Confirm the audience, the **{{ seats }}** seats and the **{{ planTier }}** tier before work starts.
</step>
<step label="Review" value="review">
Collect **{{ reviews }}** review passes. Readiness is **{{ formatNumber(readiness, 0) }}%**.
</step>
<step label="Stage" value="stage">
Stage the rollout at **{{ rolloutPct }}%** and watch the release table for channel status.
</step>
<step label="Launch" value="launch">
Open the window from **{{ windowStart }}%** to **{{ windowEnd }}%** and announce the release.
</step>
</steps>

Current checkpoint: **{{ checkpoint }}**.

### Read the launch notes

<accordion label="Launch notes">
<disclosure label="What changed in this pass" open>
The workspace now shows a live readiness meter and a rollout window. The estimate follows seats and tier, so the prose never drifts from the controls.
</disclosure>
<disclosure label="Known trade-offs">
A wider rollout window gives support more time, but it also delays the announcement. Keep the window inside the coverage you can staff.
</disclosure>
</accordion>

<accordion label="Standalone detail">
<disclosure label="Open the release checklist">
This single disclosure stands on its own. The prose reads **{{ notify ? 'release notifications on' : 'release notifications off' }}**, and the current visibility is **{{ visibility }}**.
</disclosure>
</accordion>

Use the <tooltip text="Readiness combines checked pre-launch items with the release notification toggle.">readiness score</tooltip> to decide when the launch can move from Stage to Launch.

## 04 / Confirm the details

Check the pre-launch items, choose the audiences and answer the quiz. The readiness meter and the badge in section 05 follow the checklist and the notification toggle.

<section color="#111111">
### Pre-launch checks

<checklist bind="done" label="Pre-launch checks">
- [x] Freeze the release branch
- [ ] Review the customer notes
- [ ] Schedule the announcement
</checklist>

Checked **{{ len(done) }} / 3**. Readiness is **{{ formatNumber(readiness, 0) }}%**.

<progress label="Checklist completion" value="{{ len(done) / 3 * 100 }}">
</section>

<section color="#111111">
### Audience and quiz

<multi-select bind="audiences" label="Audience segments" max-selected="2" initial="design">
<option value="design">Design partners</option>
<option value="support">Support team</option>
<option value="sales">Sales enablement</option>
</multi-select>

Selected: **{{ len(audiences) }} / 2**. {{ len(audiences) == 0 ? 'Choose at least one segment for the release note.' : 'The release note will be tailored to the selected segments.' }}

<quiz type="choice" label="Which visibility setting opens the workspace to everyone?" answer="company" explanation="Company visibility makes the workspace available across the organization.">
<option value="private">Private</option>
<option value="team">Team</option>
<option value="company">Company</option>
</quiz>
</section>

## 05 / Watch the signal

<alert tone="warning" title="Two checks still open">
The release can stage at **{{ rolloutPct }}%**, but it cannot launch until every pre-launch item is checked and notifications are **{{ notify ? 'on' : 'off' }}**.
</alert>

<badge tone="{{ readiness >= 100 ? 'success' : readiness >= 50 ? 'warning' : 'neutral' }}">{{ formatNumber(readiness, 0) }}% ready</badge>

<if when="{{ readiness >= 100 }}">
<alert tone="success" title="Ready to launch">
**{{ workspaceName }}** is fully checked. Open the launch step and send the release note to **{{ len(audiences) }}** audience segment(s).
</alert>
</if>

<if when="{{ readiness < 100 }}">
<alert title="Keep the workspace moving">
Complete the remaining checklist items or switch the release notification on. Current readiness: **{{ formatNumber(readiness, 0) }}%**.
</alert>
</if>

## 06 / Release data

Search the channel table, sort by seats, or turn the page. The chart compares planned and live seats for the same channels.

<table label="Release channels" page-size="4">
| Channel | Audience | Status | Seats |
| --- | --- | --- | ---: |
| Internal preview | Employees | Live | 40 |
| Design partners | External | Live | 12 |
| Support desk | Support | Staged | 18 |
| Sales demo | Sales | Scheduled | 24 |
| Public beta | Everyone | Scheduled | 250 |
</table>

<chart kind="bar" title="Planned and live seats" y-label="Seats">
| Channel | Planned | Live |
| --- | ---: | ---: |
| Preview | {{ seats }} | {{ round(seats * rolloutPct / 100) }} |
| Partners | 12 | 8 |
| Support | 18 | 0 |
| Sales | 24 | 0 |
| Beta | 250 | 0 |
</chart>

### What the data shows

Five release channels, four per page. Search for **Sales** or sort the **Seats** column to compare the public beta with the internal preview.

Both series are numeric, so the chart updates when **seats** or **rollout coverage** changes. Try **{{ seats }}** seats at **{{ rolloutPct }}%** coverage.

> A product surface stays legible when one value drives the control, the prose and the chart. Change **seats** and watch all three move together.

## 07 / Component index

Every remaining built-in component appears below. The host-provided `external` tag is intentionally absent because it renders a component supplied by the host rather than a built-in view.

### Inline text and navigation

Ordinary prose can carry <text color="#1f5ae8">**a themed inline emphasis**</text> without becoming a badge.

<jump to="component-index" appearance="button">Jump to data and visuals</jump>

### Form and selection

<textarea bind="notes" label="Release notes" initial="Draft the release note here." rows="3">

<checkbox bind="confirm" label="Confirm the release owner">

<date bind="shipDate" label="Ship date" initial="2026-11-20">

<radio-group bind="channel" label="Announcement channel" initial="blog">
<option value="blog">Blog</option>
<option value="email">Email</option>
<option value="in-app">In-app</option>
</radio-group>

<coordinate label="Launch position" bind-x="coordX" bind-y="coordY" initial-x="1" initial-y="2" x-min="-5" x-max="5" y-min="-5" y-max="5" step="1">

<validation when="{{ seats <= 100 }}" message="Above 100 seats needs an enterprise review." fields="seats">

Set **seats** above 100 in section 01 to see the validation hint here.

### Data and visuals

<anchor id="component-index">

<const name="releaseChannels" value="{{ ['design', 'support', 'sales'] }}">

<data-table label="Release channel index" rows="{{ releaseChannels }}" key="{{ item }}" max-rows="3">
<column label="Channel" value="{{ item }}">
<column label="Position" value="{{ index + 1 }}">
<column label="Owner" value="{{ item == 'design' ? 'Design partners' : item == 'support' ? 'Support team' : 'Sales enablement' }}">
</data-table>

<plot min="-6" max="6" label="Sine curve" x-label="x" y-label="y">
$$
y = \sin(x)
$$
</plot>

<timeline title="Release day plan">
| Task | Start | Duration | Notes |
| --- | ---: | ---: | --- |
| Freeze the branch | 0 | 1 | Lock the release candidate |
| Stage the build | 1 | 2 | Run the smoke suite |
| Announce | 3 | 1 | Publish the release note |
</timeline>

<diagram bind="selected" initial="input" label="Release flow" direction="down">
<node id="input" label="Input">
Collect release parameters.
</node>
<node id="compute" label="Compute">
Resolve readiness and coverage.
</node>
<node id="view" label="Display">
Publish the release view.
</node>
<edge from="input" to="compute" label="State change">
<edge from="compute" to="view" label="Update result">
</diagram>

<chart kind="line" title="Line chart" x-label="Month" y-label="Seats">
| Month | Planned | Live |
| --- | ---: | ---: |
| Jan | 40 | 20 |
| Feb | 60 | 45 |
| Mar | 80 | 70 |
</chart>

<chart kind="area" title="Area chart" x-label="Month" y-label="Seats">
| Month | Planned | Live |
| --- | ---: | ---: |
| Jan | 40 | 20 |
| Feb | 60 | 45 |
| Mar | 80 | 70 |
</chart>

<chart kind="scatter" title="Scatter chart" x="Budget" y="Actual" x-label="Budget" y-label="Actual">
| Budget | Actual |
| ---: | ---: |
| 150 | 120 |
| 200 | 230 |
| 220 | 180 |
| 120 | 90 |
</chart>

<chart kind="donut" title="Donut chart">
| Segment | Share |
| --- | ---: |
| Design | 120 |
| Support | 230 |
| Sales | 180 |
</chart>
