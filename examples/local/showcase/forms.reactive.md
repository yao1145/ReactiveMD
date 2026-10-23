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
