# Build a workshop plan

Change the name and headcount, then switch between in-person and online. The summary, estimate and preparation notes follow your choices.

<grid>
<card>
<panel title="Workshop details">
<input bind="name" label="Organizer" initial="Alex" placeholder="Your name">
<choices bind="format" label="Format" initial="onsite">
<option value="onsite">In person</option>
<option value="online">Online</option>
</choices>
<slider bind="seats" label="Participants" initial="4" min="1" max="20">
<date bind="date" label="Workshop date" initial="2026-11-01">
<textarea bind="notes" label="Special requests" placeholder="What would help your group?">
<toggle bind="equipment" label="Include a materials kit (20 per person)">
</panel>
</card>

<card title="Your workshop at a glance">
**{{ name == '' ? 'Your group' : name }}** · {{ date }}

{{ format == 'onsite' ? 'In-person workshop' : 'Online workshop' }} · **{{ seats }}** participants

Per person: **{{ (format == 'onsite' ? 80 : 60) + (equipment ? 20 : 0) }} credits**

Estimated total: **{{ seats * ((format == 'onsite' ? 80 : 60) + (equipment ? 20 : 0)) }} credits**

Requests: {{ notes == '' ? 'No special requests yet.' : notes }}

<if when="{{ format == 'onsite' }}">
<alert title="Prepare the room">Reserve a room with at least {{ seats }} seats and arrange a shared display.</alert>
</if>
<if when="{{ format == 'online' }}">
<alert title="Prepare the call">Share the meeting link and check that everyone can open the workshop document.</alert>
</if>
</card>
</grid>

## Try a complete change

Choose Online, set 6 participants and add materials: the estimate becomes **480 credits**. Reset Workshop details to return to the original **320 credits**.

## Tailor the workshop to your group

Choose the level, pace and subjects. These details shape the learning plan alongside the cost estimate above.

<panel title="Learning preferences">
<select bind="level" label="Experience level" initial="intro">
<option value="intro">First workshop</option>
<option value="advanced">Already familiar</option>
</select>

<radio-group bind="pace" label="Session pace" initial="guided">
<option value="guided">Guided practice</option>
<option value="independent">Independent exploration</option>
</radio-group>

<multi-select bind="subjects" label="Workshop subjects" max-selected="2" color="#167875">
<option value="math">Mathematics</option>
<option value="physics">Physics</option>
<option value="chemistry">Chemistry</option>
</multi-select>

<checkbox bind="accessible" label="Include a written step-by-step guide">

| Detail | Your choice |
| --- | --- |
| Level | {{ level == 'intro' ? 'Start with a worked example' : 'Compare several approaches' }} |
| Pace | {{ pace == 'guided' ? 'Work through the steps together' : 'Leave time to explore independently' }} |
| Subjects | {{ len(subjects) }} / 2 selected |

<if when="{{ contains(subjects, 'chemistry') }}">
<badge color="#167875">Include a chemistry example</badge>
</if>
<if when="{{ accessible }}">
<alert title="Prepare the written guide">Include the parameter names and the expected result for each step.</alert>
</if>
</panel>

## How it is written

<accordion>
<disclosure label="Show the key source">

```markdown
<input bind="name" label="Organizer" initial="Alex">
<slider bind="seats" label="Participants" initial="4" min="1" max="20">
Hello **{{ name }}**, your group has **{{ seats }}** participants.
```

</disclosure>
</accordion>
