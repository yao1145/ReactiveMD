# Follow a value through a document

Change the headcount, then select Input, Compute and Display in the diagram. Follow the same value from the control to the final explanation.

<panel title="Try a value">
<slider bind="people" label="Headcount" initial="4" min="1" max="12">
</panel>

<diagram bind="selected" initial="input" label="From input to explanation">
<node id="input" label="Input: {{ people }}">
The slider names its value people. Its current value is **{{ people }}**.
</node>
<node id="compute" label="Compute: {{ people }} × 80">
Each participant costs 80, so the total is **{{ people }} × 80 = {{ people * 80 }}**.
</node>
<node id="view" label="Display: {{ people * 80 }}">
The prose reads the result directly: the workshop costs **{{ people * 80 }}**.
</node>
<edge from="input" to="compute" label="Value changes">
<edge from="compute" to="view" label="Result updates">
</diagram>

You are exploring: **{{ selected == 'input' ? 'Input' : selected == 'compute' ? 'Compute' : 'Display' }}**.

<if when="{{ selected == 'input' }}">
<alert title="Start with what readers can change">Try 6 people, then select Compute to follow the calculation.</alert>
</if>
<if when="{{ selected == 'compute' }}">
<alert title="Make the relationship visible">The expression people * 80 gives **{{ people * 80 }}**.</alert>
</if>
<if when="{{ selected == 'view' }}">
<alert tone="success" title="The document now explains the result">For {{ people }} people, the total is **{{ people * 80 }}**.</alert>
</if>

## Explore with the keyboard

Tab to a diagram node, move focus with the arrow keys, then press Enter or Space to select it. The selected explanation and the text below the diagram stay in sync.

## Explain the flow one step at a time

<steps label="Explanation path" bind="lesson">
<step label="Read the input" value="observe">
Start at the Input node: the current headcount is **{{ people }}**.
</step>
<step label="Check the calculation" value="calculate">
Select Compute. Each participant costs 80, giving **{{ people }} × 80 = {{ people * 80 }}**.
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

Current step: **{{ lesson }}**. After explaining the result to a partner, count one practice round.

## How it is written

<accordion>
<disclosure label="Show the key source">

```markdown
<diagram bind="selected" initial="input" label="A short flow">
<node id="input" label="Input">Read a parameter.</node>
<node id="view" label="Display">Explain the result.</node>
<edge from="input" to="view">
</diagram>
Selected node: {{ selected }}
```

</disclosure>
</accordion>
