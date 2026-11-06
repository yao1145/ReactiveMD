# Plan calculator

Adjust the headcount and billing cycle to compare the average monthly cost. Each person costs 100 USD per month, and annual billing takes 20% off.

<panel title="Your plan">
<slider bind="seats" label="People" initial="2" min="1" max="20">
<toggle bind="annual" label="Annual billing">
</panel>

Current headcount: **{{ seats }}**.

Per person per month: **{{ annual ? 80 : 100 }} USD**.

Monthly total: **{{ seats * (annual ? 80 : 100) }} USD**.

<if when="{{ seats >= 5 }}">
<alert title="Team plan">
You selected at least 5 people. Switch the billing cycle to compare costs.
</alert>
</if>
