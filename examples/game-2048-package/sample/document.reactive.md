# 2048 component sample

<checkbox bind="show" label="Show 2048" initial="true">
<checkbox bind="lock" label="Lock 2048">
<checkbox bind="debug" label="Debug 2048">

<if when="{{ show }}">
<card title="2048">

A seeded, dependency-free 2048 board. Click the board, then use the arrow
keys or W A S D to move tiles, and `R` to restart. The buttons cover pointer
and touch input; each move spawns one new tile.

<game-2048 label="2048" size="4" seed="7" disabled="{{ lock }}" debug="{{ debug }}">

</card>
</if>
