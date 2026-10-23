# Fill it in, watch the result

Enter your preferences and the description below updates immediately.

<panel title="Meeting preparation">
<input bind="name" label="Name" placeholder="What should we call you?">

<choices bind="role" label="Usage">
<option value="personal">Personal use</option>
<option value="team">Team use</option>
</choices>

<date bind="appointment" label="Preferred meeting date" initial="2026-10-22">

<textarea bind="message" label="What interactive document do you want to build?" placeholder="For example: a course handout with adjustable parameters">

<checkbox bind="showNotes" label="Show the preparation checklist">
</panel>

<card title="Current plan">
Name: **{{ name == '' ? 'Not provided yet' : name }}**.

Usage: {{ role == 'personal' ? 'Personal use' : 'Team use' }}.

Planned date: {{ appointment }}.

Idea: {{ message == '' ? 'Start with a small calculator.' : message }}
</card>

<if when="{{ showNotes }}">
<checklist label="Before the meeting">
- [ ] Decide which parameters readers need to adjust
- [ ] Prepare a concrete calculation or chart example
- [ ] Write down the changes you want readers to notice
</checklist>
</if>
