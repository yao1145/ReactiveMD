# Minimal extension sample

The card below is the only external component on this page. It shares the
`score` parameter with the built-in number field, so both stay in sync.

<rating-card bind="score" label="Rating" max="5" initial="3">

Score in prose: **{{ score }}**.

<number bind="score" label="Exact score" min="0" max="5" step="1">
