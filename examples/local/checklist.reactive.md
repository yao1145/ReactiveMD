# Organize a walkthrough with a checklist

<panel title="Walkthrough checklist">
<checklist bind="done" label="Complete these steps">
- [x] Read the source document
- [ ] Adjust parameters and watch the results
- [ ] Try it at phone width
</checklist>

Done: **{{ len(done) }} / 3**.

<progress label="Completion" value="{{ len(done) / 3 * 100 }}">

<if when="{{ len(done) == 3 }}">
<alert tone="success" title="Walkthrough complete">
You have read the source, tried the interactions and checked the narrow layout.
</alert>
</if>
</panel>

## Search, sorting and paging

<table label="Component price examples" page-size="3">
| Name | Category | Price |
| --- | --- | ---: |
| Document | Basic | 20 |
| Parameter panel | Input | 45 |
| Chart | Visual | 80 |
| Diagram | Visual | 65 |
| Checklist | Basic | 30 |
| Plan | Utility | 35 |
</table>
