const experiments = [
  [28, 35, 31, 48, 43, 58, 54, 68, 61, 78, 72, 86],
  [18, 26, 35, 30, 43, 39, 52, 46, 58, 55, 68, 65],
  [36, 32, 42, 38, 45, 48, 42, 54, 49, 57, 53, 60],
];
const value = (base: number, row: number, group: number) => `{{ (${base} + (alternate ? ${(row * 7 + group * 13) % 23 - 8} : 0)) * strength / 100 }}`;
const table = `| 轮次 | 实验组 A | 实验组 B | 对照组 |\n| ---: | ---: | ---: | ---: |\n${experiments[0].map((_, row) => `| ${row + 1} | ${experiments.map((values, group) => value(values[row], row, group)).join(' | ')} |`).join('\n')}`;
const shareTable = `| 组别 | 累计读数 |\n| --- | ---: |\n| 实验组 A | {{ 662 * strength / 100 + (alternate ? 155 : 0) }} |\n| 实验组 B | {{ 535 * strength / 100 + (alternate ? 40 : 0) }} |\n| 对照组 | {{ 556 * strength / 100 + (alternate ? 90 : 0) }} |`;
const chart = (kind: string, title: string) => `<chart kind="${kind}" title="${title}" key="轮次" bind="picked" x="轮次" y="实验组 A,实验组 B,对照组" x-label="实验轮次" y-label="响应值">\n${table}\n</chart>`;
const share = (kind: string, title: string) => `<chart kind="${kind}" title="${title}" key="组别" bind="pickedShare" x="组别" y="累计读数">\n${shareTable}\n</chart>`;

export const source = `
<panel title="实验参数与图表" reset="true">

<slider bind="strength" label="响应强度（%）" min="60" max="110" initial="100" step="1">

<toggle bind="alternate" label="切换到数据 B" initial="false">

<tabs label="图表类型">
<tab label="柱状图" value="bar">
${chart('bar', '各轮实验响应 · 单根柱读数')}
</tab>
<tab label="折线图" value="line">
${chart('line', '实验响应趋势 · 同轮并列读数')}
</tab>
<tab label="面积图" value="area">
${chart('area', '实验响应面积 · 同轮并列读数')}
</tab>
<tab label="饼图" value="pie">
${share('pie', '各组累计读数占比')}
</tab>
<tab label="散点图" value="scatter">
${chart('scatter', '轮次与响应值 · 最近点读数')}
</tab>
<tab label="环形图" value="donut">
${share('donut', '各组累计读数 · 环形图')}
</tab>
</tabs>

选中轮次：{{ picked == '' ? '尚未选择' : picked }}。选中组别：{{ pickedShare == '' ? '尚未选择' : pickedShare }}。

</panel>

<accordion label="边界样例">
<disclosure label="负值、缺失值与长标签">

<chart kind="line" title="缺失值保留断点，负值保留方向" x="位置" y="对照组,这是一个很长的实验系列名称用于检查提示框换行和图例省略">
| 位置 | 对照组 | 这是一个很长的实验系列名称用于检查提示框换行和图例省略 |
| ---: | ---: | ---: |
| 1 | -8 | 18 |
| 3 | {{ alternate ? 14 : null }} | 30 |
| 9 | 16 | 22 |
| 12 | 32 | 38 |
</chart>

</disclosure>
</accordion>
`;
