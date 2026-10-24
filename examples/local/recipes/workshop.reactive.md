<computed name="costs" value="{{ [seats * 80, materials ? seats * 20 : 0] }}">
<computed name="total" value="{{ sum(costs) }}">

# Check a workshop plan

<panel title="Workshop plan">
<number bind="seats" label="Participants" initial="4" min="1" max="20">
<number bind="budget" label="Budget" initial="500" min="0" max="5000">
<toggle bind="materials" label="Include materials">
<date bind="startDate" label="Start date" initial="2026-10-24">
<date bind="endDate" label="End date" initial="2026-10-26">
<multi-select bind="subjects" label="Subjects" max-selected="3">
<option value="mathematics">Mathematics</option>
<option value="physics">Physics</option>
<option value="chemistry">Chemistry</option>
</multi-select>
</panel>

<validation when="{{ total <= budget }}" message="The estimated {{ formatCurrency(total) }} exceeds the budget." fields="seats budget materials">
<validation when="{{ startDate == '' || endDate == '' || dateCompare(endDate, startDate) >= 0 }}" message="End date must be on or after start date." fields="startDate endDate">

<badge tone="{{ total <= budget ? 'success' : 'warning' }}">Estimate: {{ formatCurrency(total) }}</badge>

Teaching: {{ formatCurrency(costs[0]) }}. Materials: {{ formatCurrency(costs[1]) }}.
Average cost category: {{ formatCurrency(average(costs)) }}.

<data-table label="Selected subjects" rows="{{ subjects }}" key="{{ item }}" max-rows="3">
<column label="Subject ID" value="{{ item }}">
<column label="Position" value="{{ index + 1 }}">
<column label="Preparation" value="{{ item == 'chemistry' ? 'Prepare materials' : 'Prepare examples' }}">
</data-table>

Choose subjects to populate the table. Lower the budget to see the warning, then edit either the budget or participant count to clear it. Reset the panel to restore the plan.
