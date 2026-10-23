# Planning, timing and simple tools

<timeline title="45-minute work plan">
| Task | Start | Duration | Notes |
| --- | ---: | ---: | --- |
| Prepare materials | 0 | 10 | List what you need first |
| Draft the main section | 10 | 25 | Focus on the core content |
| Assemble references | 15 | 15 | Can run in parallel with the main section |
| Review and deliver | 35 | 10 | Leave time for a final check |
</timeline>

<timer label="One-minute focus timer" duration="60">

## Splitting a dinner bill

<panel title="Bill parameters">
<number bind="total" label="Bill amount" initial="240" min="0">
<slider bind="people" label="People" initial="3" min="1" max="12">
<slider bind="tip" label="Extra charge (%)" initial="10" min="0" max="20">
</panel>

Each person pays **{{ round(total * (1 + tip / 100) / people * 100) / 100 }} USD**.

Amounts are rounded to two decimals without padding trailing zeros.
