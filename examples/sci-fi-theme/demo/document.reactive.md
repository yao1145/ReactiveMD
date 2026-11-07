<theme name="sci-fi">

# Orbital Transfer Console

Hard-sci-fi design system · theme `sci-fi` · token set SF-01. Every control on this surface is a live Reactive MD binding; every border, label and signal colour is supplied by the theme.

<badge tone="success">System nominal</badge> <badge tone="warning">Thermal watch</badge> <badge>Draft 3</badge>

<const name="exhaustVelocity" value="{{ 4400 }}">
<computed name="deltaV" value="{{ payload * 9.81 * 1.25 }}">
<computed name="burnMinutes" value="{{ deltaV / 12 }}">

## 01 / Mission parameters

<panel title="Transfer parameters">
<slider bind="payload" label="Payload mass / t" initial="18" min="1" max="40">
<number bind="crew" label="Crew" initial="4" min="0" max="12" step="1">
<toggle bind="burn" label="Prograde burn authorized" initial="true">
<select bind="vector" label="Transfer vector">
<option value="hohmann">Hohmann</option>
<option value="bielliptic">Bi-elliptic</option>
</select>
</panel>

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

**{{ payload }} t** payload
</card>
</grid>

## 02 / Telemetry

<chart kind="line" title="Thrust profile" x-label="T+ min" y-label="kN">
| T+ | Thrust | Chamber |
| --- | ---: | ---: |
| 0 | 0 | 0 |
| 1 | {{ payload * 1.8 }} | {{ payload * 0.9 }} |
| 2 | {{ payload * 2.6 }} | {{ payload * 1.4 }} |
| 3 | {{ payload * 2.4 }} | {{ payload * 1.3 }} |
| 4 | {{ payload * 1.2 }} | {{ payload * 0.8 }} |
| 5 | 0 | 0 |
</chart>

<table label="Ground stations" page-size="4">
| Station | Band | Uplink | Status |
| --- | --- | ---: | --- |
| Kourou | X | 42 | Nominal |
| Madrid | Ka | 38 | Nominal |
| Canberra | X | 35 | Degraded |
| Goldstone | Ka | 47 | Nominal |
| Santiago | S | 21 | Standby |
</table>

## 03 / Flight plan

<tabs label="Flight plan">
<tab label="Ascent">
Insertion follows a gravity-turn profile. The guidance loop polls the inertial platform at 20 Hz and trims the attitude error before the next throttle update.
</tab>
<tab label="Transfer">
A Hohmann transfer is preferred when the delta-v budget stays under 4,200 m/s. The selected vector is **{{ vector }}**.
</tab>
<tab label="Arrival">
Capture burn is split into two passes. The first pass targets a 400 km periapsis; the second circularises.
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

## 04 / System state

<alert tone="warning" title="Thermal loop B">
Radiator outlet is 4.2 C above the modelled curve. Reduce duty cycle until the next ground pass.
</alert>

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

## 05 / Crew registry

<panel title="Crew manifest">
<input bind="callsign" label="Callsign" placeholder="ENTER CALLSIGN">
<textarea bind="notes" label="Mission notes" rows="2" initial="Keep the thermal loop inside the green band.">
<radio-group bind="regime" label="Flight regime">
<option value="auto">Autonomous</option>
<option value="manual">Manual</option>
</radio-group>
<checklist bind="checks" label="Pre-flight checks">
- [x] Guidance platform aligned
- [ ] Life support certification
- [ ] Range clearance
</checklist>
<progress label="Checklist completion" value="{{ len(checks) / 3 * 100 }}">
</panel>

<grid columns="2">
<card title="Selection state">
Checked: {{ len(checks) }} / 3

Phase: {{ phase }}
</card>
<card title="Subsystems">
<multi-select bind="subsystems" label="Assigned subsystems" max-selected="2" initial="gnc">
<option value="gnc">Guidance / navigation</option>
<option value="eps">Electrical power</option>
<option value="tcs">Thermal control</option>
</multi-select>

Selected: {{ len(subsystems) }}
</card>
</grid>

<counter bind="corrections" label="Correction burns" initial="2" min="0" max="9">
<timer label="Burn timer" duration="90">

## 06 / Diagnostics

| Channel | Limit | State |
| --- | ---: | --- |
| Attitude error | 0.02 deg | Nominal |
| Bus voltage | 28.4 V | Nominal |
| Radiator outlet | 4.2 C over | Watch |
| Link margin | 6.8 dB | Nominal |

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

```ts
const vector = normalize(target.sub(position));
const throttle = clamp(vector.length() / burnWindow, 0, 1);

if (throttle > 0 && authorized) {
  guidance.commit(vector, throttle);
}
```

> A control surface is legible when its state is visible before its decoration. Signal first, chrome second.

$$
\Delta v = v_e \ln \frac{m_0}{m_1}
$$

<tooltip text="Token contract: surface, ink, line, accent, focus, chart and code families.">SF-01 token contract</tooltip> · rendered in {{ len(checks) + len(subsystems) }} live states.
