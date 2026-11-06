<const name="rate" value="{{ 80 }}">
<computed name="total" value="{{ people * rate }}">

# Follow a value through a document

Change the headcount, then select Input, Compute and Display in the diagram. Follow the same value from the control to the final explanation.

<panel title="Try a value">
<slider bind="people" label="Headcount" initial="4" min="1" max="12">
</panel>

<diagram bind="selected" initial="input" label="From input to explanation">
<node id="input" label="Input: {{ people }}">
The slider names its value people. Its current value is **{{ people }}**.
</node>
<node id="compute" label="Compute: {{ people }} × {{ rate }}">
Each participant costs 80, so the total is **{{ people }} × {{ rate }} = {{ total }}**.
</node>
<node id="view" label="Display: {{ total }}">
The prose reads the read-only total: the workshop costs **{{ formatCurrency(total, 'USD', 2, 'en-US') }}**. The calculation node and explanations share this result.
</node>
<edge from="input" to="compute" label="Value changes">
<edge from="compute" to="view" label="Result updates">
</diagram>

You are exploring: **{{ selected == 'input' ? 'Input' : selected == 'compute' ? 'Compute' : 'Display' }}**.

<if when="{{ selected == 'input' }}">
<alert title="Start with what readers can change">Try 6 people, then select Compute to follow the calculation.</alert>
</if>
<if when="{{ selected == 'compute' }}">
<alert title="Make the relationship visible">The named calculation total = people * rate gives **{{ total }}**.</alert>
</if>
<if when="{{ selected == 'view' }}">
<alert tone="success" title="The document now explains the result">For {{ people }} people, the total is **{{ total }}**.</alert>
</if>

## Explore with the keyboard

Tab to a diagram node, move focus with the arrow keys, then press Enter or Space to select it. The selected explanation and the text below the diagram stay in sync.

## Explain the flow one step at a time

<steps label="Explanation path" bind="lesson">
<step label="Read the input" value="observe">
Start at the Input node: the current headcount is **{{ people }}**.
</step>
<step label="Check the calculation" value="calculate">
Select Compute. Each participant costs 80, giving **{{ people }} × {{ rate }} = {{ total }}**.
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
