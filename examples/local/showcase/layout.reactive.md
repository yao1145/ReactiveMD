<const name="workshopDay" value="{{ '2026-11-01' }}">
<computed name="readingPhase" value="{{ readingDate == '' ? 'undated' : dateCompare(readingDate, workshopDay) < 0 ? 'before' : dateCompare(readingDate, workshopDay) == 0 ? 'during' : 'after' }}">
<computed name="daysUntil" value="{{ readingDate == '' ? null : dateDiff(workshopDay, readingDate) }}">

# A workshop guide at every reading depth

Compare the cards, then move the reading date to workshop day or later and watch the guidance change. Switch reading roles and expand a question to find the detail you need.

<anchor id="reading-start">

<section color="#45536f">
Find the level of detail you need. <text color="#a2273a">**Keep important reminders in view.**</text> Paragraphs can share a color while a few words carry their own emphasis.
</section>

<jump to="reading-details" appearance="button" color="#2563eb">Jump to the questions</jump>

<panel title="Reading date">
<date bind="readingDate" label="When are you reading?" initial="2026-10-24">
</panel>

<badge tone="{{ readingPhase == 'before' ? 'neutral' : readingPhase == 'undated' ? 'warning' : 'success' }}">{{ readingPhase == 'before' ? 'Before: prepare' : readingPhase == 'during' ? 'Workshop day: explore' : readingPhase == 'after' ? 'After: reflect' : 'Choose a reading date' }}</badge>

<if when="{{ readingPhase == 'before' }}">
The workshop is on **{{ workshopDay }}**, with **{{ daysUntil }}** days to prepare. Start with the preparation card.
</if>
<if when="{{ readingPhase == 'after' }}">
The workshop was **{{ daysUntil == null ? 0 : -daysUntil }}** days ago. Revisit a useful exploration and share it with a partner.
</if>

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
<const name="workshopDay" value="{{ '2026-11-01' }}">
<date bind="readingDate" label="Reading date" initial="2026-10-24">
<computed name="daysUntil" value="{{ readingDate == '' ? null : dateDiff(workshopDay, readingDate) }}">
<grid>
<card title="Workshop date">{{ workshopDay }}</card>
<card title="Days until workshop">{{ daysUntil }}</card>
</grid>
<accordion>
<disclosure label="Read more">Supporting detail goes here.</disclosure>
</accordion>
```

</disclosure>
</accordion>
