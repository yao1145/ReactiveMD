<computed name="shelfCost" value="{{ shelves * (reuse ? 360 : 480) }}">
<computed name="bookCost" value="{{ books * 18 }}">
<computed name="seatCost" value="{{ seats * 80 }}">
<computed name="subtotal" value="{{ shelfCost + bookCost + seatCost + 600 }}">
<computed name="reserve" value="{{ subtotal * 0.1 }}">
<computed name="total" value="{{ subtotal + reserve }}">

# A reading corner for the community room

Residents' meeting proposal · Four-week trial · All costs are adjustable estimates in CNY

The tables by the window are often empty. We want to try a small reading corner where children can browse books after school and weekend reading groups can meet.

For the first round, buy shelves and a starter collection while keeping the existing tables. After four weeks, use seat counts and borrowing records to decide whether to expand.

## How much should we start with?

<grid>
<card title="Adjust the shopping list">
<number bind="shelves" label="Bookshelves" initial="2" min="1" max="6">
<number bind="books" label="Starter books" initial="80" min="20" max="200" step="10">
<slider bind="seats" label="Reading seats" initial="12" min="4" max="24" step="2">
<toggle bind="reuse" label="Use refurbished shelves">
<number bind="budget" label="Available budget (CNY)" initial="5000" min="1000" max="15000" step="100">
</card>
<card title="Amount for approval">
Purchases and setup cost {{ formatCurrency(subtotal, 'CNY', 2, 'en-US') }}, plus a 10% contingency.

Requested total: **{{ formatCurrency(total, 'CNY', 2, 'en-US') }}**.

Budget remaining: **{{ formatCurrency(budget - total, 'CNY', 2, 'en-US') }}**.

<if when="{{ total <= budget }}">
<badge tone="success">The current scope fits the budget</badge>
</if>
<if when="{{ total > budget }}">
<alert tone="warning" title="Reduce the initial scope">We need another {{ formatCurrency(total - budget, 'CNY', 2, 'en-US') }}. Start with fewer books or compare refurbished shelf prices.</alert>
</if>
</card>
</grid>

## Where the money goes

<chart title="Reading corner purchases" y-label="CNY">
| Item | Cost |
| --- | ---: |
| Shelves | {{ shelfCost }} |
| Books | {{ bookCost }} |
| Seats | {{ seatCost }} |
| Lighting and signs | 600 |
| Contingency | {{ reserve }} |
</chart>

The estimate allows CNY 18 per book and CNY 80 per seat. Lighting and section signs cost CNY 600 together. Refurbished shelves are estimated at CNY 360 each, new ones at CNY 480. Check supplier quotes before ordering.

## When can it open?

<timeline title="Weeks from approval">
| Task | Start | Duration | Notes |
| --- | ---: | ---: | --- |
| Confirm the space | 0 | 1 | Measure the corner, check routes and sockets, collect book suggestions |
| Buy and set up | 1 | 1 | Two volunteers check deliveries, add categories and borrowing instructions |
| Run the trial | 2 | 4 | Saturday reading sessions; record visits, seat use and loans |
| Report to residents | 6 | 1 | Use four weeks of records to discuss books, hours and seating |
</timeline>

## What does the meeting need to decide?

<checklist label="Before the meeting">
- [ ] Approve the window area while keeping routes clear
- [ ] Confirm a spending limit and a reimbursement contact
- [ ] Fill the volunteer rota for the four-week trial
</checklist>

<accordion>
<disclosure label="What if few people use it?">
Check whether the opening hours or the book selection caused the problem. Change one of them and record another two weeks. The movable shelves and chairs can be rearranged; unused contingency stays in the budget.
</disclosure>
</accordion>
