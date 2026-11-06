<const name="preparationCount" value="{{ 3 }}">
<computed name="readyCount" value="{{ len(done) }}">
<computed name="completion" value="{{ readyCount / preparationCount }}">
<computed name="readyToShare" value="{{ readyCount == preparationCount }}">

# 完成一次专注活动

勾选准备步骤、清点到场人数，再启动一段专注计时。同一页集中呈现活动安排、完成进度和时间。

<panel title="活动准备进度">
<checklist color="#167875" bind="done" label="一起做好准备">
- [x] 选定一个要探索的问题
- [ ] 打开文档，调整一个参数
- [ ] 向同伴解释观察到的结果
</checklist>

已完成： **{{ readyCount }} / {{ preparationCount }}**。勾选后，下表会补上对应的回顾问题。

<progress color="#167875" label="准备进度" value="{{ completion * 100 }}">

<badge tone="{{ readyToShare ? 'success' : 'neutral' }}">{{ formatPercent(completion, 0, 'zh-CN') }} 已完成</badge>

<data-table label="已完成的准备" rows="{{ done }}" key="{{ item }}" max-rows="3">
<column label="事项" value="{{ item == 'item-1' ? '选定探索问题' : item == 'item-2' ? '调整文档参数' : '向同伴解释结果' }}">
<column label="回顾问题" value="{{ item == 'item-1' ? '希望了解什么？' : item == 'item-2' ? '调整后有什么变化？' : '如何解释这一结果？' }}">
</data-table>

<if when="{{ readyToShare }}">
<alert tone="success" title="可以开始分享了">问题、示例和观察结果都已准备就绪。</alert>
</if>
</panel>

<grid>
<card title="到场人数">
<counter bind="count" label="已到场人数" initial="0" min="0" max="20">
已到场： **{{ count }}**.
</card>
<card title="一分钟探索">
<timer label="专注计时器" duration="60">
准备好后开始；需要讨论时暂停，下一轮探索时重置。
</card>
</grid>

## 查看完整活动安排

<timeline title="45 分钟活动安排">
| 事项 | 开始 | 时长 | 说明 |
| --- | ---: | ---: | --- |
| 确定问题 | 0 | 10 | 确定一个要探索的主题 |
| 动手探索 | 10 | 25 | 调整控件，比较结果 |
| 整理观察 | 15 | 15 | 与探索阶段同步记录 |
| 交流分享 | 35 | 10 | 分享一个有用的发现 |
</timeline>

恢复活动准备进度的默认值，会重置该清单。人数计数器和计时器位于面板外，各自保留状态。

## 记录分享后的待办

已完成事项会加上删除线。隐藏再展开这份清单，已经勾选的事项仍会保留。

<toggle bind="followUp" label="显示后续待办" initial="true">
<if when="{{ followUp }}">
<checklist label="分享之后" color="#167875">
- [ ] 保存一个有用的观察结果
- [ ] 把文档分享给同伴
</checklist>
</if>

## 看看写法

<accordion>
<disclosure label="展开关键源码">

```markdown
<checklist bind="done" label="准备步骤">
- [x] 选定问题
- [ ] 探索结果
</checklist>
<computed name="completion" value="{{ len(done) / 2 }}">
<progress label="进度" value="{{ completion * 100 }}">
{{ formatPercent(completion, 0) }}

<data-table label="已完成事项" rows="{{ done }}" key="{{ item }}" max-rows="2">
<column label="事项" value="{{ item == 'item-1' ? '选定问题' : '探索结果' }}">
</data-table>
```

</disclosure>
</accordion>
