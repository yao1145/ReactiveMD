# 方案计算器

调整人数和付款方式，比较每月平均费用。每人每月 100 元，年度付款享受八折。

<panel title="你的方案">
<slider bind="seats" label="人数" initial="2" min="1" max="20">
<toggle bind="annual" label="年度付款">
</panel>

当前人数：**{{ seats }}**。

每人每月：**{{ annual ? 80 : 100 }} 元**。

每月合计：**{{ seats * (annual ? 80 : 100) }} 元**。

<if when="{{ seats >= 5 }}">
<alert title="团队方案">
你选择了至少 5 人，可以继续切换付款方式比较费用。
</alert>
</if>
