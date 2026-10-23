# Run a focused workshop

Check off the preparation steps, count the participants and start a short focus timer. This page keeps the plan, progress and timing together.

<panel title="Workshop readiness">
<checklist bind="done" label="Prepare together">
- [x] Choose one question to explore
- [ ] Open the document and adjust a parameter
- [ ] Explain the result to a partner
</checklist>

Ready: **{{ len(done) }} / 3**.

<progress label="Preparation progress" value="{{ len(done) / 3 * 100 }}">

<if when="{{ len(done) == 3 }}">
<alert tone="success" title="Ready to share">Everyone has a question, a working example and a result to discuss.</alert>
</if>
</panel>

<grid>
<card title="People in the room">
<counter bind="count" label="Participants present" initial="0" min="0" max="20">
Present: **{{ count }}**.
</card>
<card title="One minute to explore">
<timer label="Focus timer" duration="60">
Start when you are ready. Pause to discuss a result, or reset for another round.
</card>
</grid>

## See the whole session

<timeline title="A 45-minute workshop">
| Task | Start | Duration | Notes |
| --- | ---: | ---: | --- |
| Choose a question | 0 | 10 | Agree on one thing to explore |
| Build and explore | 10 | 25 | Try the controls and compare results |
| Collect observations | 15 | 15 | Take notes while exploring |
| Share back | 35 | 10 | Explain one useful finding |
</timeline>

Reset Workshop readiness to restore its checklist. The participant counter and timer are outside that panel and keep their own state.

## How it is written

<accordion>
<disclosure label="Show the key source">

```markdown
<checklist bind="done" label="Preparation">
- [x] Choose a question
- [ ] Explore a result
</checklist>
<progress label="Progress" value="{{ len(done) / 2 * 100 }}">
```

</disclosure>
</accordion>
