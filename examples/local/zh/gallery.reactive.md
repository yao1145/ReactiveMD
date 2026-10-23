# 常用组件画廊

## 输入与实时结果

<panel title="填写你的方案">
<input bind="name" label="称呼" initial="小林" placeholder="请输入名字">
<number bind="quantity" label="数量" initial="3" min="1" max="20">

<select bind="plan" label="方案" initial="pro">
<option value="basic">基础版</option>
<option value="pro">专业版</option>
</select>

<toggle bind="annual" label="年度付款（八折）">
<toggle bind="express" label="显示加急清单" initial="true">
<slider bind="budgetLevel" label="预算档位" initial="50" step="10">
</panel>

你好，**{{ name }}**。

预估费用：**{{ round(quantity * 80 * (plan == 'pro' ? 1 : 0.8) * (annual ? 0.8 : 1)) }} 元**。

<if when="{{ quantity >= 5 }}">
<badge tone="success">已达到团队档</badge>
</if>

| 条件 | 当前选择 |
| --- | --- |
| 方案 | {{ plan == 'pro' ? '专业版' : '基础版' }} |
| 年度付款 | {{ annual ? '已开启' : '未开启' }} |
| 预算档位 | {{ budgetLevel }} |

<if when="{{ express }}">
<checklist label="加急准备">
- [x] 已选加急展示
- [ ] 确认交付时间
</checklist>
</if>

## 独立操作的组件

下面的组件不需要向正文公开参数，所以省略 bind。

<grid>
<card title="人数计数">
<counter label="参与人数" initial="2" min="1" max="20">
</card>

<card title="短时专注">
<timer label="一分钟倒计时">
</card>
</grid>

## 原样展示代码

```markdown
<slider bind="example" label="示例参数">
当前值：{{ example }}。
```

以上代码只作为示例显示，不会生成控件。
