# 边填写，边看结果

填写你的偏好，下方说明会立即变化。

<panel title="交流准备">
<input bind="name" label="称呼" placeholder="怎么称呼你？">

<choices bind="role" label="使用方式">
<option value="personal">个人使用</option>
<option value="team">团队使用</option>
</choices>

<date bind="appointment" label="计划交流的日期" initial="2026-10-22">

<textarea bind="message" label="想做什么交互文档？" placeholder="例如：一份可以调整参数的课程讲义">

<checkbox bind="showNotes" label="显示准备清单">
</panel>

<card title="当前计划">
称呼：**{{ name == '' ? '尚未填写' : name }}**。

使用方式：{{ role == 'personal' ? '个人使用' : '团队使用' }}。

计划日期：{{ appointment }}。

想法：{{ message == '' ? '可以先从一个小计算器开始。' : message }}
</card>

<if when="{{ showNotes }}">
<checklist label="交流前准备">
- [ ] 想清楚读者需要调整哪些参数
- [ ] 准备一个具体的计算或图表示例
- [ ] 写出希望读者观察到的变化
</checklist>
</if>
