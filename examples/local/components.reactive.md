# Organize interactions with content

Hover over <tooltip text="When an input changes, the related text and charts update automatically.">reactive bindings</tooltip>, or focus it with the keyboard to read the explanation.

<panel title="Reading preferences">
<radio-group bind="preference" label="Explanation style">
<option value="concise">Concise</option>
<option value="detailed">Detailed</option>
</radio-group>
</panel>

<if when="{{ preference == 'concise' }}">
Name the input and reference it in the prose.
</if>

<if when="{{ preference == 'detailed' }}">
Name an input parameter with `bind` and read it with `{{ }}` to compute results. When readers adjust a control, the related content updates immediately.
</if>

## Read at your own pace

<accordion label="Reading order">
<disclosure label="Understand the parameters" open>
Find what readers can change, such as headcount, unit price or amplitude.
</disclosure>

<disclosure label="Write down the relationship">
Connect inputs and results with an expression, for example `{{ people * 100 }}`.
</disclosure>

<disclosure label="Choose how to present it">
Use prose for a single result, charts for comparisons, and function curves for mathematical relationships.
</disclosure>
</accordion>

<alert title="Keep exploring">
Switch the option above and watch the explanation change.
</alert>

<badge tone="success">Local interaction</badge>

---

> Headings, blockquotes, links and images still follow Markdown. Components only handle the parts that need interaction.
