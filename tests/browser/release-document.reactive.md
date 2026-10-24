<const name="unitPrice" value="{{ 12.5 }}">
<computed name="total" value="{{ quantity * unitPrice }}">
<computed name="mode" value="{{ [quantity > 4 ? 'priority' : 'standard', owner] }}">
<computed name="subjectCount" value="{{ len(subjects) }}">

# Release integration

<panel title="Release settings" reset="true">
<number bind="quantity" label="Quantity" initial="2" min="0" max="10">
<input bind="owner" label="Owner" initial="Ada" max-length="20">
<multi-select bind="subjects" label="Subjects" max-selected="3">
<option value="mathematics">Mathematics</option>
<option value="physics">Physics</option>
<option value="chemistry">Chemistry</option>
</multi-select>
</panel>

Total: **{{ formatCurrency(total) }}** for {{ owner }}. Mode: {{ mode[0] }}/{{ mode[1] }}. Selected subjects: {{ subjectCount }}.

<validation when="{{ total <= 100 }}" message="Total {{ formatCurrency(total) }} exceeds the limit." fields="quantity">

<data-table label="Release subjects" rows="{{ subjects }}" key="{{ item }}">
<column label="Subject" value="{{ item }}">
<column label="Position" value="{{ index + 1 }}">
</data-table>

<table label="Release table">
| Item | Value |
| --- | ---: |
| Unit price | {{ unitPrice }} |
| Total | {{ total }} |
</table>

```text
quantity stays literal here
```
