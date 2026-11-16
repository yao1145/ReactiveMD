<theme name="sci-fi">

# SF-01 Acceptance Surface

Full component sweep for the upgraded `sci-fi` theme. Every block below is a real Reactive MD
component, so this page exercises both the theme layer and the shared baseline at once.
Sections are arranged by the work package that changed them, so a review can be walked
top to bottom against `docs/theme-upgrade-design-ch.md`.

<const name="payload" value="{{ 18 }}">
<computed name="deltaV" value="{{ payload * 9.81 * 1.25 }}">
<computed name="burnMinutes" value="{{ deltaV / 12 }}">
<const name="exhaustVelocity" value="{{ 4400 }}">

## SYS / 01 · Decisive pair: toggle and checkbox

This is the defect the upgrade exists for. These two controls share the same inner markup
(`label.md-toggle-label > input[type=checkbox] + span`) and were previously flattened into
identical 16px boxes by a single theme rule. They must now look completely different.

<panel title="Toggle versus checkbox">
<toggle bind="burn" label="Prograde burn authorized" initial="true">
<checkbox bind="confirmed" label="Range clearance confirmed" initial="false">
<checkbox bind="mixed" label="Mixed state (needs HTML indeterminate)" initial="false">
</panel>

Checked state: burn = {{ burn ? 'true' : 'false' }}, confirmed = {{ confirmed ? 'true' : 'false' }}.

<alert tone="info" title="What to look for">
The toggle is a 40x20 square switch with a 14px sliding block and no pill geometry.
The checkboxes are 16px squares. If both look like small squares, the theme regressed.
</alert>

## SYS / 02 · Full form inventory

<panel title="Text and number entry">
<input bind="callsign" label="Callsign" placeholder="ENTER CALLSIGN">
<textarea bind="notes" label="Mission notes" rows="2" initial="Keep the thermal loop inside the green band.">
<number bind="crew" label="Crew" initial="4" min="0" max="12" step="1">
<number bind="budget" label="Spending limit" initial="500" min="0" max="5000">
<date bind="launchDate" label="Earliest launch" initial="2026-12-01">
</panel>

<panel title="Selection controls">
<select bind="vector" label="Transfer vector">
<option value="hohmann">Hohmann</option>
<option value="bielliptic">Bi-elliptic</option>
<option value="spiral">Low-thrust spiral</option>
</select>

<radio-group bind="regime" label="Flight regime" initial="auto">
<option value="auto">Autonomous</option>
<option value="manual">Manual</option>
</radio-group>

Two options render as the segmented shape: one sliding square thumb on the track, with
every segment transparent. Selection must read from the thumb, not from a filled segment.

<choices bind="abortMode" label="Abort mode" initial="safe">
<option value="safe">Safe mode</option>
<option value="burn">Burn to depletion</option>
</choices>

Six options cross the threshold into the chip shape, where every chip carries its own
surface. Both shapes must keep square corners and the mono label.

<choices bind="recoveryPlan" label="Recovery plan" initial="reentry">
<option value="reentry">Re-entry</option>
<option value="orbit">Stay in orbit</option>
<option value="lunar">Lunar free return</option>
<option value="depot">Depot rendezvous</option>
<option value="abort">Abort to surface</option>
<option value="contingency">Contingency abort to surface with residual propellant reserve</option>
</choices>


<multi-select bind="subsystems" label="Assigned subsystems" max-selected="2" initial="gnc">
<option value="gnc">Guidance / navigation</option>
<option value="eps">Electrical power</option>
<option value="tcs">Thermal control</option>
</multi-select>

<checklist bind="checks" label="Pre-flight checks">
- [x] Guidance platform aligned
- [ ] Life support certification
- [ ] Range clearance
</checklist>
</panel>

<panel title="Propellant loading and throttle window configuration">
<slider bind="payloadSlider" label="Payload mass / t" initial="18" min="1" max="40">
<range-slider label="Throttle window" bind-start="low" bind-end="high" initial-start="20" initial-end="80" min="0" max="100" step="1">
</panel>

<panel title="Counters and timers">
<counter bind="corrections" label="Correction burns" initial="2" min="0" max="9">
<timer label="Burn timer" duration="90">
</panel>

## SYS / 03 · Feedback and status

<badge tone="success">System nominal</badge> <badge tone="warning">Thermal watch</badge> <badge tone="neutral">Telemetry</badge> <badge tone="warning">Fault</badge> <badge>Draft 3</badge>

<alert tone="success" title="Link margin holds">
All three ground stations are inside the 6 dB budget for the next pass.
</alert>

<alert tone="warning" title="Thermal loop B">
Radiator outlet is 4.2 C above the modelled curve. Reduce duty cycle until the next ground pass.
</alert>

<alert tone="warning" title="Bus undervoltage">
Solar array B is 3% below prediction. Load shedding will start at 27.5 V.
</alert>

<alert tone="info" title="Signal path nominal">
The filter stage is rejecting outliers; the shared data bus is clean.
</alert>

<progress label="Checklist completion" value="{{ len(checks) / 3 * 100 }}">

Checked: {{ len(checks) }} / 3 · subsystems: {{ len(subsystems) }}

## SYS / 04 · Navigation

<tabs label="Flight plan">
<tab label="Ascent">
Insertion follows a gravity-turn profile. The guidance loop polls the inertial platform at
20 Hz and trims the attitude error before the next throttle update.
</tab>

<tab label="Transfer">
A Hohmann transfer is preferred when the delta-v budget stays under 4,200 m/s. The selected
vector is **{{ vector }}**.
</tab>

<tab label="Arrival">
Capture burn is split into two passes. The first pass targets a 400 km periapsis; the second
circularises.
</tab>
</tabs>

<steps label="Launch sequence" bind="phase">
<step label="Poll" value="poll">
Platform aligned. Sensor bus is clean.
</step>
<step label="Arm" value="arm">
Range clearance confirmed. Flight computers are in primary/backup agreement.
</step>
<step label="Burn" value="burn">
Ignition at T-0. Throttle ramps to 100% over four seconds.
</step>
</steps>

<accordion label="System log">
<disclosure label="RCS quad B — nominal" open>
All four thrusters report stable chamber pressure. No leaks detected.
</disclosure>
<disclosure label="Guidance — nominal">
Star tracker lock is solid. Inertial drift is inside the 0.02 deg budget.
</disclosure>
<disclosure label="Power — watch">
Solar array B is producing 3% below prediction. Bus voltage remains within limits.
</disclosure>
</accordion>

## SYS / 05 · Structure: panels, cards, grid, sections

<grid columns="3">
<card title="Delta-v budget">
**{{ formatNumber(deltaV, 0) }} m/s**

Exhaust velocity is fixed at {{ exhaustVelocity }} m/s.
</card>
<card title="Burn window">
**{{ formatNumber(burnMinutes, 1) }} min**

Prograde: {{ burn ? 'AUTHORIZED' : 'HOLD' }}
</card>
<card title="Manifest">
**{{ crew }} crew**

**{{ payloadSlider }} t** payload
</card>
</grid>

<section color="#45536f">

A section wrapper applying one shared text colour to several paragraphs. This is also a
notch target, so the cut corner and the left signal rule should coexist.

</section>

## SYS / 06 · Charts: all six kinds

<chart kind="bar" title="Delta-v by stage" x-label="Stage" y-label="m/s">
| Stage | Planned | Actual |
| --- | ---: | ---: |
| Insertion | 3200 | 3180 |
| Transfer | 1180 | 1240 |
| Capture | 890 | 905 |
</chart>

<chart kind="line" title="Thrust profile" x-label="T+ min" y-label="kN">
| T+ | Thrust | Chamber |
| --- | ---: | ---: |
| 0 | 0 | 0 |
| 1 | {{ payloadSlider * 1.8 }} | {{ payloadSlider * 0.9 }} |
| 2 | {{ payloadSlider * 2.6 }} | {{ payloadSlider * 1.4 }} |
| 3 | {{ payloadSlider * 2.4 }} | {{ payloadSlider * 1.3 }} |
| 4 | {{ payloadSlider * 1.2 }} | {{ payloadSlider * 0.8 }} |
| 5 | 0 | 0 |
</chart>

<chart kind="area" title="Thermal margin" x-label="Orbit" y-label="deg C">
| Orbit | Radiator A | Radiator B |
| --- | ---: | ---: |
| 1 | 4 | 8 |
| 2 | 6 | 12 |
| 3 | 5 | 14 |
| 4 | 3 | 9 |
</chart>

<grid columns="3">
<card title="Readout / peak">
**14 deg C**

Radiator B, orbit 3
</card>
<card title="Readout / current">
**9 deg C**

Radiator B, orbit 4
</card>
<card title="Readout / delta">
**5 deg C**

peak − current
</card>
</grid>

<chart kind="scatter" title="Drift versus temperature" x-label="deg C" y-label="arcsec">
| Index | Drift | Temperature |
| --- | ---: | ---: |
| 1 | 0.004 | 12 |
| 2 | 0.009 | 18 |
| 3 | 0.017 | 26 |
| 4 | 0.031 | 35 |
| 5 | 0.052 | 44 |
</chart>

<chart kind="donut" title="Power budget share" y-label="kW">
| Source | Share |
| --- | ---: |
| Solar A | 6.2 |
| Solar B | 5.8 |
| Battery | 1.4 |
| Fuel cell | 0.9 |
</chart>

<chart kind="pie" title="Mass fraction">
| Module | Mass |
| --- | ---: |
| Structure | 42 |
| Propellant | 28 |
| Avionics | 12 |
| Payload | 18 |
</chart>

## SYS / 07 · Tables: Markdown, enhanced, and bound

Markdown table:

| Channel | Limit | State |
| --- | ---: | --- |
| Attitude error | 0.02 deg | Nominal |
| Bus voltage | 28.4 V | Nominal |
| Radiator outlet | 4.2 C over | Watch |
| Link margin | 6.8 dB | Nominal |

Enhanced table with paging and search:

<table label="Ground stations" page-size="4">
| Station | Band | Uplink | Status |
| --- | --- | ---: | --- |
| Kourou | X | 42 | Nominal |
| Madrid | Ka | 38 | Nominal |
| Canberra | X | 35 | Degraded |
| Goldstone | Ka | 47 | Nominal |
| Santiago | S | 21 | Standby |
| Kiruna | X | 31 | Nominal |
</table>

A table bound to live state, with sortable columns:

<table label="Live station readout" page-size="3">
| Station | Uplink | Crew |
| --- | ---: | ---: |
| Kourou | {{ 40 + crew }} | {{ crew }} |
| Madrid | {{ 36 + crew }} | {{ len(subsystems) }} |
| Canberra | {{ 33 + crew }} | {{ len(checks) }} |
</table>

A `data-table` renders rows from a bound array instead of literal Markdown. Its columns are
declared with `<column>` and each value is evaluated in row scope:

<data-table label="Assigned subsystem detail" rows="{{ subsystems }}" key="{{ item }}" max-rows="3">
<column label="Subsystem" value="{{ item == 'gnc' ? 'Guidance / navigation' : item == 'eps' ? 'Electrical power' : 'Thermal control' }}">
<column label="Lead" value="{{ item == 'gnc' ? 'Flight dynamics' : item == 'eps' ? 'Power systems' : 'Thermal team' }}">
<column label="Posture" value="{{ burn ? 'Burn ready' : 'Hold' }}">
</data-table>

## SYS / 08 · Timeline, diagram, gallery

<timeline title="A 90-minute burn sequence">
| Task | Start | Duration | Notes |
| --- | ---: | ---: | --- |
| Chilling | 0 | 10 | Chill the turbopumps |
| Chill | 10 | 25 | Verify pump inlet |
| Throttle up | 35 | 20 | Ramp to 100% |
| Burn | 55 | 30 | Hold chamber pressure |
| Coast | 85 | 5 | Confirm orbit |
</timeline>

<diagram label="Signal path" direction="right" initial="filter">
<node id="sensor" label="Sensor">
Raw inertial and thermal measurements.
</node>

<node id="filter" label="Filter">
Outlier rejection and rate limiting.
</node>

<node id="bus" label="Bus">
Validated telemetry on the shared data bus.
</node>

<edge from="sensor" to="filter" label="raw">
<edge from="filter" to="bus" label="clean">
</diagram>

<gallery label="Mission imagery" item-width="280">
<gallery-item label="Pad 39A">

Launch complex in pre-dawn fog. Umbilical arms retracted at T-9.

</gallery-item>
<gallery-item label="Staging">

Second-stage separation, 118 seconds after release.

</gallery-item>
<gallery-item label="Capture">

Perigee kick at 400 km, radiator panels deployed.

</gallery-item>
</gallery>

## SYS / 09 · Quiz

One of each kind, plus an explanation that must inherit the theme.

<quiz type="choice" label="Which transfer costs least delta-v?" answer="b" explanation="A Hohmann transfer is the cheapest two-impulse transfer between circular orbits.">
<option value="a">Bi-elliptic</option>
<option value="b">Hohmann</option>
<option value="c">Spiral</option>
</quiz>

<quiz type="number" label="Approximate pi" answer="3.14" tolerance="0.01" explanation="Any value within 0.01 of 3.14 is accepted."></quiz>

## SYS / 10 · Coordinates and plots

<coordinate label="Point position" bind-x="px" bind-y="py" initial-x="1" initial-y="2" x-min="-5" x-max="5" y-min="-5" y-max="5">

<plot min="0" max="12.56" label="Sine and cosine" x-label="x" y-label="y">
$$ y = \sin x $$
</plot>

<plot min="-5" max="5" label="Linear meets quadratic">
$$ y = x^2 $$
</plot>

## SYS / 11 · Conditional content and validation

The three sliders and the limit below drive a live validation rule. Raise payload until the
budget breaks and the inline error must appear in theme colours.

<validation when="{{ deltaV <= 7000 }}" message="Delta-v budget exceeded: {{ formatNumber(deltaV, 0) }} m/s is above the 7,000 m/s limit." fields="payloadSlider">

<if when="{{ burn == true }}">
<alert tone="success" title="Prograde authorised">Burn is armed; guidance is holding the vector.</alert>
</if>

<if when="{{ burn == false }}">
<alert tone="info" title="Prograde on hold">Authorise the burn in section 01 to arm guidance.</alert>
</if>

## SYS / 12 · Typography, code, math, quotes

Inline code such as `normalize(target.sub(position))`, a [link to the protocol notes](#sys-01-decisive-pair-toggle-and-checkbox), and **bold**, *italic*, and ~~struck~~ text.

Inline status runs use semantic `<badge>` tones rather than hardcoded foreground colours, so
contrast holds in both schemes: <badge tone="success">Telemetry nominal</badge> and
<badge tone="warning">Thermal watch</badge>.

```ts
const vector = normalize(target.sub(position));
const throttle = clamp(vector.length() / burnWindow, 0, 1);

if (throttle > 0 && authorized) {
  guidance.commit(vector, throttle);
}
```

> A control surface is legible when its state is visible before its decoration.
> Signal first, chrome second.

$$
\Delta v = v_e \ln \frac{m_0}{m_1}
$$

Lists, both kinds:

- Guidance platform aligned
- Life support certification
- Range clearance

1. Poll the inertial platform
2. Trim the attitude error
3. Commit the throttle

Task list:

- [x] Guidance platform aligned
- [ ] Life support certification
- [ ] Range clearance

## SYS / 13 · Jump links and anchors

<jump to="acceptance-anchor" appearance="button">Jump to the anchor</jump>

<anchor id="acceptance-anchor">

You arrived at the anchor. Scroll back up to section 01 for the decisive pair.

<tooltip text="Token contract: surface, ink, line, accent, focus, chart and code families.">SF-01 token contract</tooltip> · rendered in {{ len(checks) + len(subsystems) }} live states.

## SYS / 14 · Component coverage note

The design document also specifies skins for `md-status`, `md-spinner`, `md-skeleton` and
`md-loading`. Those classes ship in the shared baseline CSS but no current component emits
them, so they cannot be shown here; they are style-only hooks for host markup. Everything
else in the component inventory appears above.
