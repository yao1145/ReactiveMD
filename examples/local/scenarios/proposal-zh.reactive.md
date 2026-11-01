<computed name="shelfCost" value="{{ shelves * (reuse ? 360 : 480) }}">
<computed name="bookCost" value="{{ books * 18 }}">
<computed name="seatCost" value="{{ seats * 80 }}">
<computed name="subtotal" value="{{ shelfCost + bookCost + seatCost + 600 }}">
<computed name="reserve" value="{{ subtotal * 0.1 }}">
<computed name="total" value="{{ subtotal + reserve }}">

# 把社区活动室的一角留给阅读

居民议事会提案 · 四周试用计划 · 以下金额为可调整的估算

活动室靠窗的一排桌子平时闲着。我们想先布置一个小阅读角，让放学后的孩子有地方翻书，也让周末的共读活动有个固定集合点。

这次先采购书架和一批基础读物，保留现有桌子。试用四周后，再根据座位使用情况和借阅记录决定是否扩大。

## 这次准备做多大？

<grid>
<card title="调整采购范围">
<number bind="shelves" label="书架数量" initial="2" min="1" max="6">
<number bind="books" label="首批图书（本）" initial="80" min="20" max="200" step="10">
<slider bind="seats" label="阅读座位" initial="12" min="4" max="24" step="2">
<toggle bind="reuse" label="采用翻新书架">
<number bind="budget" label="可用预算（元）" initial="5000" min="1000" max="15000" step="100">
</card>
<card title="提交议事会的金额">
采购及布置 {{ formatCurrency(subtotal, 'CNY', 2, 'zh-CN') }}，另留 10% 机动金。

申请总额：**{{ formatCurrency(total, 'CNY', 2, 'zh-CN') }}**。

预算余额：**{{ formatCurrency(budget - total, 'CNY', 2, 'zh-CN') }}**。

<if when="{{ total <= budget }}">
<badge tone="success">当前范围在预算内</badge>
</if>
<if when="{{ total > budget }}">
<alert tone="warning" title="需要缩小采购范围">还差 {{ formatCurrency(total - budget, 'CNY', 2, 'zh-CN') }}。可以先减少首批图书，或比较翻新书架的报价。</alert>
</if>
</card>
</grid>

## 钱花在哪里

<chart title="阅读角采购明细" y-label="元">
| 项目 | 金额 |
| --- | ---: |
| 书架 | {{ shelfCost }} |
| 图书 | {{ bookCost }} |
| 座位 | {{ seatCost }} |
| 灯具与标识 | 600 |
| 机动金 | {{ reserve }} |
</chart>

图书按每本 18 元、座位按每个 80 元估算。灯具和分区标识合计 600 元。翻新书架按每个 360 元计算，新书架按每个 480 元计算，实际采购前再核对报价。

## 什么时候可以用

<timeline title="从方案获批起计算（周）">
| 事项 | 开始 | 时长 | 说明 |
| --- | ---: | ---: | --- |
| 确认场地 | 0 | 1 | 量尺寸、确认通道和插座位置，征集首批书单 |
| 采购与布置 | 1 | 1 | 两位志愿者清点到货，贴好分类和借阅说明 |
| 开放试用 | 2 | 4 | 每周六共读，记录到访、座位使用和借还情况 |
| 回到议事会 | 6 | 1 | 根据四周记录讨论添书、开放时段和座位 |
</timeline>

## 请议事会决定什么

<checklist label="会前确认">
- [ ] 同意使用靠窗区域，保留日常活动通道
- [ ] 确认采购上限及报销负责人
- [ ] 为四周试用排好志愿者值班
</checklist>

<accordion>
<disclosure label="如果试用后使用率不高呢？">
先查看是开放时间不合适，还是书目与居民需要不匹配。下一轮只调整其中一项，再记录两周。可移动书架和座椅能够重新布置，未使用的机动金留在预算内。
</disclosure>
</accordion>
