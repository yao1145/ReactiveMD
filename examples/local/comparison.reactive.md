# Side by side, easier to compare

<panel title="Payment method">
<toggle bind="annual" label="Pay annually and save 20%">
</panel>

<grid>
<card title="Basic plan">
For individuals and small projects.

**{{ annual ? 80 : 100 }} USD per month**.

<badge>Local documents</badge>
</card>

<card title="Pro plan">
For teams that need collaboration and room to grow.

**{{ annual ? 160 : 200 }} USD per month**.

<badge tone="success">More components</badge>
</card>
</grid>

<tabs label="Plan details">
<tab label="Feature comparison">
| Capability | Basic plan | Pro plan |
| --- | --- | --- |
| Parameter adjustment | Included | Included |
| Text binding | Included | Included |
| Content organization | Basic layout | Charts and diagrams |
</tab>

<tab label="Buying advice">
Choose a plan for what you need, then compare how the billing cycle changes the cost.
</tab>
</tabs>

<accordion>
<disclosure label="How is the cost calculated?">
Annual billing applies a 20% discount to the monthly list price, and the equivalent monthly cost is shown above.
</disclosure>

<disclosure label="Can I switch at any time?">
Toggle the switch above to compare the two billing cycles. This is a local calculation example.
</disclosure>
</accordion>
