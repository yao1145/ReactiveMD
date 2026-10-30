<theme name="paper">

# Component package sample

<checkbox bind="show" label="Show rating" initial="true">
<checkbox bind="lock" label="Lock rating">

<if when="{{ show }}">
<note title="Notes" tone="info" disabled="{{ lock }}">
Current score: **{{ score }}**.

<rating bind="score" label="Score" max="5" initial="3" locked="{{ lock }}">
</note>
</if>
