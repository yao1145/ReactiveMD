# 计划、计时和简单工具

<timeline title="45 分钟工作计划">
| 事项 | 开始 | 时长 | 说明 |
| --- | ---: | ---: | --- |
| 准备材料 | 0 | 10 | 先列出所需内容 |
| 完成主体 | 10 | 25 | 集中完成主要部分 |
| 整理参考 | 15 | 15 | 可以与主体阶段并行 |
| 检查与交付 | 35 | 10 | 留出复核时间 |
</timeline>

<timer label="一分钟专注计时" duration="60">

## 聚餐分账

<panel title="分账参数">
<number bind="total" label="账单金额" initial="240" min="0">
<slider bind="people" label="分账人数" initial="3" min="1" max="12">
<slider bind="tip" label="额外费用（%）" initial="10" min="0" max="20">
</panel>

每人支付 **{{ round(total * (1 + tip / 100) / people * 100) / 100 }} 元**。

金额按两位小数四舍五入显示，不补齐末尾的零。
