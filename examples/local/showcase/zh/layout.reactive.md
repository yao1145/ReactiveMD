# 让一份活动指南更好读

先并排比较两张卡片，再切换阅读角色、展开常见问题，体验同一份内容如何适应不同的阅读需要。

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

## 看看写法

<accordion>
<disclosure label="展开关键源码">

```markdown
<grid>
<card title="活动之前">准备一份文档。</card>
<card title="活动之中">探索一个问题。</card>
</grid>
<accordion>
<disclosure label="阅读更多">在这里补充细节。</disclosure>
</accordion>
```

</disclosure>
</accordion>
