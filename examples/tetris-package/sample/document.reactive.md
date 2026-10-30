# Tetris component sample

<checkbox bind="show" label="Show tetris" initial="true">
<checkbox bind="lock" label="Lock tetris">
<checkbox bind="debug" label="Debug tetris">

<if when="{{ show }}">
<card title="Tetris">

A seeded, dependency-free game. Click the board, then use the arrow keys,
`Space` to drop, `P` to pause and `R` to restart.

<tetris label="Tetris" width="10" height="20" speed="600" seed="7" disabled="{{ lock }}" debug="{{ debug }}">

</card>
</if>
