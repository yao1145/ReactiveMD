# 边填写，边生成活动方案

修改称呼和人数，再切换线下或线上形式，观察方案摘要、费用和准备事项一起变化。

<grid>
<card>
<panel title="活动配置">
<input bind="name" label="组织者" initial="Alex" placeholder="你的称呼">
<choices bind="format" label="活动形式" initial="onsite">
<option value="onsite">线下</option>
<option value="online">线上</option>
</choices>
<slider bind="seats" label="参与人数" initial="4" min="1" max="20">
<date bind="date" label="活动日期" initial="2026-11-01">
<textarea bind="notes" label="补充要求" placeholder="写下小组的具体需要">
<toggle bind="equipment" label="增加材料包（每人 20 元）">
</panel>
</card>

<card title="你的活动方案">
**{{ name == '' ? '你的小组' : name }}** · {{ date }}

{{ format == 'onsite' ? '线下活动' : '线上活动' }} · **{{ seats }}** 人

每人费用： **{{ (format == 'onsite' ? 80 : 60) + (equipment ? 20 : 0) }} 元**

预计总费用： **{{ seats * ((format == 'onsite' ? 80 : 60) + (equipment ? 20 : 0)) }} 元**

补充要求： {{ notes == '' ? '暂未填写。' : notes }}

<if when="{{ format == 'onsite' }}">
<alert title="线下准备">预订至少能容纳 {{ seats }} 人的场地，并准备公共屏幕。</alert>
</if>
<if when="{{ format == 'online' }}">
<alert title="线上准备">提前分享会议链接，确认每位参与者都能打开活动文档。</alert>
</if>
</card>
</grid>

## 试一次完整的修改

选择线上、调到 6 人并增加材料包，总费用变为 **480 元**。点击活动配置的恢复默认，回到初始的 **320 元**。

## 看看写法

<accordion>
<disclosure label="展开关键源码">

```markdown
<input bind="name" label="组织者" initial="Alex">
<slider bind="seats" label="参与人数" initial="4" min="1" max="20">
你好 **{{ name }}**, 你的小组有 **{{ seats }}** 人。
```

</disclosure>
</accordion>
