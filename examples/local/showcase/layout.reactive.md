# A workshop guide at every reading depth

Compare the two cards, switch reading roles, then expand a question. Each layout helps a reader find the right level of detail.

<anchor id="reading-start">

<section color="#45536f">
Find the level of detail you need. <text color="#a2273a">**Keep important reminders in view.**</text> Paragraphs can share a color while a few words carry their own emphasis.
</section>

<jump to="reading-details" appearance="button" color="#2563eb">Jump to the questions</jump>

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

## Choose your reading role

<tabs label="Workshop roles">
<tab label="Participant">
### Make one idea interactive

1. Start with a number readers can change.
2. Connect it to a sentence or a chart.
3. Ask a partner to explore the result.

A <tooltip text="A named input lets prose and visualizations read its current value.">reactive binding</tooltip> keeps the explanation connected to the input.
</tab>
<tab label="Facilitator">
### Guide the exploration

Show the result first. Invite one clear change, ask what happened, then open the source to explain the relationship.

> Useful prompt: What changes if we double this value?
</tab>
</tabs>

<anchor id="reading-details">

## Open the detail you need

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

## How it is written

<accordion>
<disclosure label="Show the key source">

```markdown
<grid>
<card title="Before">Prepare a document.</card>
<card title="During">Explore one question.</card>
</grid>
<accordion>
<disclosure label="Read more">Supporting detail goes here.</disclosure>
</accordion>
```

</disclosure>
</accordion>
