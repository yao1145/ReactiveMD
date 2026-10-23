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

## 为小组安排合适的学习内容

选择经验水平、活动节奏和主题，让学习安排与上方的费用方案一起明确下来。

<panel title="学习偏好">
<select bind="level" label="经验水平" initial="intro">
<option value="intro">第一次参与</option>
<option value="advanced">已有使用经验</option>
</select>

<radio-group bind="pace" label="活动节奏" initial="guided">
<option value="guided">跟随步骤练习</option>
<option value="independent">自主探索</option>
</radio-group>

<multi-select bind="subjects" label="活动主题" max-selected="2" color="#167875">
<option value="math">数学</option>
<option value="physics">物理</option>
<option value="chemistry">化学</option>
</multi-select>

<checkbox bind="accessible" label="提供书面步骤说明">

| 配置 | 当前安排 |
| --- | --- |
| 水平 | {{ level == 'intro' ? '从一个完整示例开始' : '比较几种不同方法' }} |
| 节奏 | {{ pace == 'guided' ? '一起按步骤练习' : '留出自主探索时间' }} |
| 主题 | 已选择 {{ len(subjects) }} / 2 项 |

<if when="{{ contains(subjects, 'chemistry') }}">
<badge color="#167875">加入一个化学示例</badge>
</if>
<if when="{{ accessible }}">
<alert title="准备书面说明">为每一步写明参数名称和预期结果，方便参与者自行查阅。</alert>
</if>
</panel>

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
