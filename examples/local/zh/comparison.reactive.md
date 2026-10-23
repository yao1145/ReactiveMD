# 放在一起，比较更清楚

<panel title="付款方式">
<toggle bind="annual" label="按年付款，享受八折">
</panel>

<grid>
<card title="基础方案">
适合个人与小型项目。

每月 **{{ annual ? 80 : 100 }} 元**。

<badge>本地文档</badge>
</card>

<card title="专业方案">
适合需要协作与扩展的团队。

每月 **{{ annual ? 160 : 200 }} 元**。

<badge tone="success">更多组件</badge>
</card>
</grid>

<tabs label="方案说明">
<tab label="功能比较">
| 能力 | 基础方案 | 专业方案 |
| --- | --- | --- |
| 参数调整 | 支持 | 支持 |
| 文本联动 | 支持 | 支持 |
| 内容组织 | 基础排版 | 图表与图解 |
</tab>

<tab label="选购建议">
先根据实际用途选择方案，再比较付款周期带来的费用变化。
</tab>
</tabs>

<accordion>
<disclosure label="费用如何计算？">
年度付款按每月标价的八折计算，上方显示折算后的每月费用。
</disclosure>

<disclosure label="可以随时切换吗？">
切换上方开关即可比较两种付款周期。这是一份本地计算示例。
</disclosure>
</accordion>
