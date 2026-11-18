# Workshop budget

<panel title="Parameters">
<input bind="item" label="Workshop name" initial="Design workshop">
<textarea bind="notes" label="Notes" initial="Confirm the venue.">
<date bind="eventDate" label="Date" initial="2026-12-01">
<select bind="plan" label="Plan" initial="team">
<option value="individual">Individual</option>
<option value="team">Team</option>
</select>
<number bind="quantity" label="Participants" min="1" initial="3">
<slider bind="budget" label="Budget" min="0" max="500" step="5" initial="100">
<toggle bind="showNotes" label="Include notes" initial="true">
</panel>

<computed name="unitPrice" value="{{ plan == 'team' ? 50 : 25 }}">
<computed name="total" value="{{ unitPrice * quantity }}">

<grid columns="2">
<card title="Estimate">

{{ item }} · <text color="#45536f">{{ eventDate }}</text>

**Total** · {{ total }}

</card>
<card title="Budget">

**Limit** · {{ budget }} · <badge tone="{{ total > budget ? 'warning' : 'success' }}">{{ total > budget ? 'Over budget' : 'Within budget' }}</badge>

</card>
</grid>

<if when="{{ total > budget }}">
<alert tone="warning" title="Review the budget">

The estimate exceeds the budget by {{ total - budget }}.

</alert>
</if>

<if when="{{ showNotes }}">
<section color="#45536f">

{{ notes }}

</section>
</if>
