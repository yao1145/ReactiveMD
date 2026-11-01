<computed name="displayName" value="{{ trim(name) == '' ? '这位同学' : trim(name) }}">
<computed name="sessionMinutes" value="{{ pace == 'guided' ? 90 : 120 }}">

# 这个周末，一起学点什么？

共学小组活动意向表 · 约 2 分钟

我们准备在周末办一次小型共学，先问问大家的时间和兴趣，再决定场地与内容。这是一份本地填写样张，填完后请把下方摘要复制给组织者。

## 先说说你的安排

<panel title="你的意向">
<input bind="name" label="怎么称呼你" initial="小林" placeholder="昵称即可">
<choices bind="format" label="更方便的参与方式" initial="onsite">
<option value="onsite">线下，社区活动室</option>
<option value="online">线上，视频会议</option>
</choices>
<select bind="slot" label="比较方便的时段" initial="sat-afternoon">
<option value="sat-morning">周六上午</option>
<option value="sat-afternoon">周六下午</option>
<option value="sun-afternoon">周日下午</option>
</select>
<slider bind="fee" label="每人可接受费用上限（元）" initial="40" min="0" max="80" step="10">
</panel>

费用只用于场地和材料。如果选择线上，也请保留自己的费用上限，方便组织者比较是否邮寄材料。

## 想带走什么

<multi-select bind="topics" label="感兴趣的内容，最多两项" max-selected="2">
<option value="photos">用手机整理一组照片</option>
<option value="budget">做一份自己的月度开支表</option>
<option value="writing">写完一篇生活小记</option>
</multi-select>

<radio-group bind="pace" label="你更喜欢怎样学习" initial="guided">
<option value="guided">跟着一个完整示例做</option>
<option value="independent">带着自己的问题交流</option>
</radio-group>

<checkbox bind="written" label="希望提前拿到书面步骤">
<checkbox bind="volunteer" label="愿意帮忙签到或整理材料">
<textarea bind="notes" label="还有什么需要提前知道" placeholder="例如：想带自己的照片，或需要更大字号的材料">

<data-table label="你的内容准备单" rows="{{ topics }}" key="{{ item }}" max-rows="2">
<column label="内容" value="{{ item == 'photos' ? '手机照片整理' : item == 'budget' ? '月度开支表' : '生活小记' }}">
<column label="建议带来" value="{{ item == 'photos' ? '10 张想整理的照片' : item == 'budget' ? '一周的开支记录' : '一个想记录的小片段' }}">
</data-table>

## 发给组织者的摘要

<card title="我的共学意向">
{{ displayName }}希望参加{{ format == 'onsite' ? '线下' : '线上' }}共学，方便的时间是{{ slot == 'sat-morning' ? '周六上午' : slot == 'sat-afternoon' ? '周六下午' : '周日下午' }}，每人费用上限 {{ fee }} 元。

已选 {{ len(topics) }} 项内容，偏好{{ pace == 'guided' ? '跟着示例练习' : '带着问题交流' }}，建议预留 {{ sessionMinutes }} 分钟。

材料安排：{{ written ? '希望提前收到书面步骤。' : '现场讲解即可。' }}

补充：{{ trim(notes) == '' ? '暂无。' : trim(notes) }}

<if when="{{ volunteer }}">
我也愿意协助签到或整理材料，请组织者提前告诉我到场时间。
</if>
</card>

<if when="{{ len(topics) == 0 }}">
<alert title="还差一个小选择">选一项最想做的内容，组织者就能据此准备材料。</alert>
</if>

## 接下来怎么定活动

组织者收齐回复后，先找重叠最多的时段，再确认报名人数和场地。确定安排时，把实际费用、需要自带的材料和取消方式一起发回小组。

这里的摘要反映你的个人选择，活动名额和时间以组织者后续确认的信息为准。
