# Common component gallery

## Inputs and live results

<panel title="Describe your plan">
<input bind="name" label="Name" initial="Alex" placeholder="Enter a name">
<number bind="quantity" label="Quantity" initial="3" min="1" max="20">

<select bind="plan" label="Plan" initial="pro">
<option value="basic">Basic</option>
<option value="pro">Pro</option>
</select>

<toggle bind="annual" label="Annual billing (20% off)">
<toggle bind="express" label="Show express checklist" initial="true">
<slider bind="budgetLevel" label="Budget level" initial="50" step="10">
</panel>

Hello, **{{ name }}**.

Estimated cost: **{{ round(quantity * 80 * (plan == 'pro' ? 1 : 0.8) * (annual ? 0.8 : 1)) }} USD**.

<if when="{{ quantity >= 5 }}">
<badge tone="success">Team tier reached</badge>
</if>

| Condition | Current choice |
| --- | --- |
| Plan | {{ plan == 'pro' ? 'Pro' : 'Basic' }} |
| Annual billing | {{ annual ? 'On' : 'Off' }} |
| Budget level | {{ budgetLevel }} |

<if when="{{ express }}">
<checklist label="Express preparation">
- [x] Express checklist shown
- [ ] Confirm the delivery time
</checklist>
</if>

## Components that work on their own

These components do not expose parameters to the prose, so they omit bind.

<grid>
<card title="People counter">
<counter label="Participants" initial="2" min="1" max="20">
</card>

<card title="Short focus">
<timer label="One-minute countdown">
</card>
</grid>

## Show code as-is

```markdown
<slider bind="example" label="Example parameter">
Current value: {{ example }}.
```

The code above is displayed as an example only and does not create a control.
