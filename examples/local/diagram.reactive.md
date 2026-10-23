# Make explanations explorable

Click a node or use the keyboard to select a step and read its description.

<diagram bind="selected" initial="input" label="Reactive state flow">
<node id="input" label="Input">
Readers change parameters with sliders, switches and text fields.
</node>

<node id="compute" label="Compute">
Formulas that depend on those parameters are recalculated.
</node>

<node id="view" label="View">
Prose, charts and hints update with the result.
</node>

<edge from="input" to="compute" label="Parameter change">
<edge from="compute" to="view" label="Updated result">
</diagram>

Current step: {{ selected == 'input' ? 'Input' : selected == 'compute' ? 'Compute' : 'View' }}.

## Change parameters and watch the curve

<panel title="Sine wave parameters">
<slider bind="a" label="Amplitude" initial="1" min="0" max="3" step="0.5">
<slider bind="f" label="Frequency parameter" initial="1" min="0.5" max="3" step="0.5">
</panel>

<plot min="0" max="12.56" label="Sine wave" x-label="x" y-label="Displacement">
$$ y = a\sin(fx) $$
</plot>

<if when="{{ a == 0 }}">
The amplitude is zero, so the curve lies flat on the horizontal axis.
</if>

## Overlay two curves

<plot min="-5" max="5" label="Parabola and line">
$$ y = x^2 $$
$$ y = 2x + 1 $$
</plot>
