<computed name="organizer" value="{{ trim(name) == '' ? '你的小组' : trim(name) }}">
<computed name="unitCost" value="{{ (format == 'onsite' ? 80 : 60) + (equipment ? 20 : 0) }}">
<computed name="total" value="{{ seats * unitCost }}">
<computed name="datesReady" value="{{ date != '' && deadline != '' && dateCompare(deadline, date) <= 0 }}">
<computed name="registrationGap" value="{{ datesReady ? dateDiff(date, deadline) : null }}">

# 边填写，边生成活动方案

修改称呼和人数，再切换线下或线上形式。调低预算或将报名截止日期设到活动之后，查看相应提示；选择主题，生成准备清单。

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
<date bind="deadline" label="报名截止日期" initial="2026-10-25">
<number bind="budget" label="费用上限" initial="500" min="0" max="5000" step="10">
<validation when="{{ datesReady }}" message="请填写两个日期，并将报名截止日期设为不晚于活动日期。" fields="deadline date">
<validation when="{{ total <= budget }}" message="预计费用超出上限 {{ formatCurrency(total - budget, 'CNY', 2, 'zh-CN') }}，请调整人数、材料或费用上限。" fields="seats equipment budget">
<textarea bind="notes" label="补充要求" placeholder="写下小组的具体需要">
<toggle bind="equipment" label="增加材料包（每人 20 元）">
</panel>
</card>

<card title="你的活动方案">
**{{ organizer }}** · {{ date }}

{{ format == 'onsite' ? '线下活动' : '线上活动' }} · **{{ seats }}** 人

每人费用： **{{ formatCurrency(unitCost, 'CNY', 2, 'zh-CN') }}**

预计总费用： **{{ formatCurrency(total, 'CNY', 2, 'zh-CN') }}**

<badge tone="{{ total <= budget ? 'success' : 'warning' }}">费用上限：{{ formatCurrency(budget, 'CNY', 2, 'zh-CN') }}</badge>

<if when="{{ datesReady }}">
报名于 **{{ deadline }}** 截止，比活动提前 **{{ registrationGap }}** 天。
</if>

补充要求： {{ trim(notes) == '' ? '暂未填写。' : trim(notes) }}

<if when="{{ format == 'onsite' }}">
<alert title="线下准备">预订至少能容纳 {{ seats }} 人的场地，并准备公共屏幕。</alert>
</if>
<if when="{{ format == 'online' }}">
<alert title="线上准备">提前分享会议链接，确认每位参与者都能打开活动文档。</alert>
</if>
</card>
</grid>

## 试一次完整的修改

选择线上、调到 6 人并增加材料包，总费用变为 **¥480.00**。点击活动配置的恢复默认，回到初始的 **¥320.00**。

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

<data-table label="主题准备清单" rows="{{ subjects }}" key="{{ item }}" max-rows="2">
<column label="主题" value="{{ item == 'math' ? '数学' : item == 'physics' ? '物理' : '化学' }}">
<column label="准备事项" value="{{ item == 'chemistry' ? '准备材料与操作说明' : '准备一个完整例题' }}">
<column label="配套说明" value="{{ accessible ? '附书面步骤' : '现场讲解' }}">
</data-table>

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
<const name="rate" value="{{ 80 }}">
<computed name="total" value="{{ seats * rate }}">
<slider bind="seats" label="参与人数" initial="4" min="1" max="20">
<number bind="budget" label="费用上限" initial="500" min="0" max="5000">
<validation when="{{ total <= budget }}" message="请调整人数或费用上限。" fields="seats budget">
<badge tone="{{ total <= budget ? 'success' : 'warning' }}">{{ formatCurrency(total, 'CNY', 2, 'zh-CN') }}</badge>

<multi-select bind="subjects" label="主题" max-selected="2">
<option value="math">数学</option>
<option value="physics">物理</option>
</multi-select>
<data-table label="准备清单" rows="{{ subjects }}" key="{{ item }}" max-rows="2">
<column label="主题" value="{{ item == 'math' ? '数学' : '物理' }}">
</data-table>
```

</disclosure>
</accordion>
