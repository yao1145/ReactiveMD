# Choose, explore and learn

Select two subjects, narrow the interval and drag the point. Check an answer, then choose a project in the table or chart.

<jump to="results" appearance="button" color="#2563eb">Jump to the results</jump>

<panel title="Try the new interactions">

<anchor id="settings">

<section color="#45536f">
These paragraphs use a shared color. <text color="#a2273a">**This reminder has its own color.**</text> Links and controls keep their own appearance.
</section>

<grid>
<card title="Choose up to two subjects">
<multi-select bind="subjects" label="Subjects" max-selected="2" color="#167875">
<option value="math">Mathematics</option>
<option value="physics">Physics</option>
<option value="chemistry">Chemistry</option>
</multi-select>

Selected: **{{ len(subjects) }} / 2**.
<if when="{{ contains(subjects, 'chemistry') }}">
<badge color="#167875">Chemistry selected</badge>
</if>
</card>
<card title="Explore an interval">
<range-slider label="Observation interval" bind-start="low" bind-end="high" initial-start="20" initial-end="80" min="0" max="100" color="#7c3aed">

Interval: **{{ low }}–{{ high }}**. Width: **{{ high - low }}**.
</card>
</grid>

## Move a point

<coordinate label="Point position" bind-x="px" bind-y="py" initial-x="1" initial-y="2" x-min="-5" x-max="5" y-min="-5" y-max="5" color="#2563eb">

Point: **({{ px }}, {{ py }})**. Distance from the origin: **{{ round(sqrt(px * px + py * py) * 100) / 100 }}**.

## Follow the learning path

<steps label="Learning path" bind="lesson">
<step label="Observe" value="observe">
Drag the point and watch its distance change.
</step>
<step label="Calculate" value="calculate">
The distance is the square root of the sum of the squared coordinates.
</step>
<step label="Practice" value="practice">
Try the questions below, then mark your checklist.
</step>
</steps>

Current step: **{{ lesson }}**.

<quiz type="choice" label="What is 2 + 3?" answer="b" explanation="Add the two numbers to get 5.">
<option value="a">4</option>
<option value="b">5</option>
<option value="c">6</option>
</quiz>

<quiz type="number" label="Approximate pi" answer="3.14" tolerance="0.01" explanation="Any value within 0.01 of 3.14 is accepted.">
</quiz>

## Mark completed tasks

<checklist bind="done" label="Exploration checklist" color="#167875">
- [x] Read the instructions
- [ ] Move the point
- [ ] Check an answer
</checklist>

<progress label="Exploration progress" value="{{ len(done) / 3 * 100 }}" color="#167875">

<anchor id="results">

## One selection, two views

Choose a project below. The table and chart share the selection; searching or sorting the table keeps the selected project.

<table label="Project selection" bind="project" key="Project" initial="Content" page-size="2">
| Project | Actual | Budget |
| --- | ---: | ---: |
| Content | 120 | 150 |
| Visual | 230 | 200 |
| Testing | 90 | 120 |
</table>

<chart kind="bar" title="Selected project" bind="project" key="Project" y="Actual,Budget">
| Project | Actual | Budget |
| --- | ---: | ---: |
| Content | 120 | 150 |
| Visual | 230 | 200 |
| Testing | 90 | 120 |
</chart>

Selected project: **{{ project }}**.

<jump to="settings" appearance="button" color="#2563eb">Return to the settings</jump>

</panel>
