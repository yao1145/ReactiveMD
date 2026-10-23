# Diagnostics example

This document intentionally keeps errors to exercise the diagnostic messages. Start with the other documents in this folder for correct examples.

## Reference to a misspelled parameter name

<slider bind="seats" label="People" initial="2" min="1" max="20">

Current headcount: {{ seat }}.

## Duplicate initial declaration

<number bind="seats" label="Another headcount input" initial="3" min="1" max="20">

## Initial value out of range

<slider bind="ratio" label="Ratio" initial="12" min="0" max="10">

## Condition type error

<if when="{{ seats }}">
This needs a boolean condition, such as seats greater than 5.
</if>

## Unknown tag

<slidr label="Misspelled slider" />

## Event outside the local interaction language

<counter label="Counter" on-click="increment">

## Missing node

<diagram label="Broken edge">
<node id="input" label="Input">
This is the only node.
</node>
<edge from="input" to="missing">
</diagram>

## Unsupported math structure

<plot label="Integrals are not part of the plot grammar">
$$ y = \int_0^x t^2\,dt $$
</plot>

## Invalid chart data

<chart title="Units mixed into a numeric column">
| Item | Cost |
| --- | ---: |
| Content | 20 USD |
</chart>
