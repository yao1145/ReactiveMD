<const name="workshopDay" value="{{ '2026-11-01' }}">
<computed name="readingPhase" value="{{ readingDate == '' ? 'undated' : dateCompare(readingDate, workshopDay) < 0 ? 'before' : dateCompare(readingDate, workshopDay) == 0 ? 'during' : 'after' }}">
<computed name="daysUntil" value="{{ readingDate == '' ? null : dateDiff(workshopDay, readingDate) }}">

# 让一份活动指南更好读

先并排比较两张卡片，再将阅读日期改到活动当天或之后，观察提示变化。切换阅读角色、展开常见问题，找到需要的内容。

<anchor id="reading-start">

<section color="#45536f">
先找到需要的阅读深度。<text color="#a2273a">**把重要提醒放在读者看得见的位置。**</text> 段落可以统一着色，局部文字可以单独强调。
</section>

<jump to="reading-details" appearance="button" color="#2563eb">跳到常见问题</jump>

<panel title="阅读时间">
<date bind="readingDate" label="你在哪天阅读？" initial="2026-10-24">
</panel>

<badge tone="{{ readingPhase == 'before' ? 'neutral' : readingPhase == 'undated' ? 'warning' : 'success' }}">{{ readingPhase == 'before' ? '活动前：准备' : readingPhase == 'during' ? '活动当天：动手探索' : readingPhase == 'after' ? '活动后：回顾' : '选择阅读日期' }}</badge>

<if when="{{ readingPhase == 'before' }}">
距离 **{{ workshopDay }}** 的活动还有 **{{ daysUntil }}** 天，先从准备卡片开始。
</if>
<if when="{{ readingPhase == 'after' }}">
活动已过去 **{{ daysUntil == null ? 0 : -daysUntil }}** 天。回顾一次有效的探索，并向同伴分享。
</if>

<grid>
<card title="活动之前">
准备一份简短的 Markdown 文档，想好一个希望读者能动手探索的问题。

<badge>准备</badge>
</card>
<card title="活动之中">
给文档加入输入控件，展示参数改变时，解释和结果如何随之变化。

<badge tone="success">动手体验</badge>
</card>
</grid>

## 选择你的阅读角色

<tabs label="活动角色">
<tab label="参与者">
### 让一个想法可以交互

1. 找到一个读者可以调整的数字。
2. 把它连接到一句话或一张图。
3. 请同伴操作，观察结果。

把参数命名后， <tooltip text="命名后的输入控件，可以让正文和图表读取它当前的值。">响应式绑定</tooltip> 会将输入和解释连接起来。
</tab>
<tab label="组织者">
### 引导一次探索

先展示结果，再邀请大家做一次明确的调整。讨论发生了什么，最后展开源码，解释其中的关系。

> 可以这样提问：如果把这个值翻倍，会发生什么？
</tab>
</tabs>

<anchor id="reading-details">

## 按需展开细节

<accordion label="活动常见问题">
<disclosure label="需要提前准备什么？" open>
准备浏览器、一篇短文和一个具体问题，就可以开始。
</disclosure>
<disclosure label="这些布局如何搭配？">
卡片用于比较相关信息，标签页区分阅读情境，折叠内容保留随时可查的补充细节。
</disclosure>
</accordion>

<alert title="保持阅读主线">先呈现主要解释，再让读者决定何时展开补充内容。</alert>

<jump to="reading-start" appearance="button" color="#2563eb">返回阅读概览</jump>

## 看看写法

<accordion>
<disclosure label="展开关键源码">

```markdown
<const name="workshopDay" value="{{ '2026-11-01' }}">
<date bind="readingDate" label="阅读日期" initial="2026-10-24">
<computed name="daysUntil" value="{{ readingDate == '' ? null : dateDiff(workshopDay, readingDate) }}">
<grid>
<card title="活动日期">{{ workshopDay }}</card>
<card title="相隔天数">{{ daysUntil }}</card>
</grid>
<accordion>
<disclosure label="阅读更多">在这里补充细节。</disclosure>
</accordion>
```

</disclosure>
</accordion>
