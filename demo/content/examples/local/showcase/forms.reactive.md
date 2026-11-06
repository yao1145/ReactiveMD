<computed name="organizer" value="{{ trim(name) == '' ? 'Your group' : trim(name) }}">
<computed name="unitCost" value="{{ (format == 'onsite' ? 80 : 60) + (equipment ? 20 : 0) }}">
<computed name="total" value="{{ seats * unitCost }}">
<computed name="datesReady" value="{{ date != '' && deadline != '' && dateCompare(deadline, date) <= 0 }}">
<computed name="registrationGap" value="{{ datesReady ? dateDiff(date, deadline) : null }}">

# Build a workshop plan

Change the name, headcount and format. Lower the budget or move the registration deadline past the workshop to see a hint; choose subjects to generate a preparation plan.

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
<date bind="deadline" label="Registration deadline" initial="2026-10-25">
<number bind="budget" label="Spending limit" initial="500" min="0" max="5000" step="10">
<validation when="{{ datesReady }}" message="Fill both dates and close registration on or before the workshop date." fields="deadline date">
<validation when="{{ total <= budget }}" message="Estimate exceeds the limit by {{ formatCurrency(total - budget, 'USD', 2, 'en-US') }}; adjust participants, materials or the limit." fields="seats equipment budget">
<textarea bind="notes" label="Special requests" placeholder="What would help your group?">
<toggle bind="equipment" label="Include a materials kit (20 per person)">
</panel>
</card>

<card title="Your workshop at a glance">
**{{ organizer }}** · {{ date }}

{{ format == 'onsite' ? 'In-person workshop' : 'Online workshop' }} · **{{ seats }}** participants

Per person: **{{ formatCurrency(unitCost, 'USD', 2, 'en-US') }}**

Estimated total: **{{ formatCurrency(total, 'USD', 2, 'en-US') }}**

<badge tone="{{ total <= budget ? 'success' : 'warning' }}">Spending limit: {{ formatCurrency(budget, 'USD', 2, 'en-US') }}</badge>

<if when="{{ datesReady }}">
Registration closes **{{ deadline }}**, **{{ registrationGap }}** days before the workshop.
</if>

Requests: {{ trim(notes) == '' ? 'No special requests yet.' : trim(notes) }}

<if when="{{ format == 'onsite' }}">
<alert title="Prepare the room">Reserve a room with at least {{ seats }} seats and arrange a shared display.</alert>
</if>
<if when="{{ format == 'online' }}">
<alert title="Prepare the call">Share the meeting link and check that everyone can open the workshop document.</alert>
</if>
</card>
</grid>

## Try a complete change

Choose Online, set 6 participants and add materials: the estimate becomes **{{ formatCurrency(480, 'USD', 2, 'en-US') }}**. Reset Workshop details to return to the original **{{ formatCurrency(320, 'USD', 2, 'en-US') }}**.

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

<data-table label="Subject preparation" rows="{{ subjects }}" key="{{ item }}" max-rows="2">
<column label="Subject" value="{{ item == 'math' ? 'Mathematics' : item == 'physics' ? 'Physics' : 'Chemistry' }}">
<column label="Preparation" value="{{ item == 'chemistry' ? 'Prepare materials and instructions' : 'Prepare a worked example' }}">
<column label="Guide" value="{{ accessible ? 'Written steps included' : 'Live explanation' }}">
</data-table>

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
<const name="rate" value="{{ 80 }}">
<computed name="total" value="{{ seats * rate }}">
<slider bind="seats" label="Participants" initial="4" min="1" max="20">
<number bind="budget" label="Spending limit" initial="500" min="0" max="5000">
<validation when="{{ total <= budget }}" message="Adjust participants or the spending limit." fields="seats budget">
<badge tone="{{ total <= budget ? 'success' : 'warning' }}">{{ formatCurrency(total, 'USD', 2, 'en-US') }}</badge>

<multi-select bind="subjects" label="Subjects" max-selected="2">
<option value="math">Mathematics</option>
<option value="physics">Physics</option>
</multi-select>
<data-table label="Preparation" rows="{{ subjects }}" key="{{ item }}" max-rows="2">
<column label="Subject" value="{{ item == 'math' ? 'Mathematics' : 'Physics' }}">
</data-table>
```

</disclosure>
</accordion>
