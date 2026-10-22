# 用内容组织交互

将鼠标移到 <tooltip text="输入改变后，相关文字和图表自动更新。">响应式绑定</tooltip>，或使用键盘聚焦查看说明。

<panel title="阅读偏好">
<radio-group bind="preference" label="说明风格">
<option value="concise">简洁</option>
<option value="detailed">详细</option>
</radio-group>
</panel>

<if when="{{ preference == 'concise' }}">
给输入命名，在正文中引用它。
</if>

<if when="{{ preference == 'detailed' }}">
用 `bind` 为输入参数命名，用 `{{ }}` 读取参数并计算结果。读者调整控件后，相关内容立即更新。
</if>

## 按自己的节奏阅读

<accordion label="阅读顺序">
<disclosure label="理解参数" open>
找出读者可以改变的内容，例如人数、单价或振幅。
</disclosure>

<disclosure label="写下关系">
用算式连接输入和结果，例如 `{{ people * 100 }}`。
</disclosure>

<disclosure label="选择展示方式">
一句结果用正文，数据比较用图表，数学关系用函数曲线。
</disclosure>
</accordion>

<alert title="继续尝试">
切换上方选项，观察说明文字的变化。
</alert>

<badge tone="success">本地交互</badge>

---

> 标题、引用、链接和图片都沿用 Markdown。组件只负责需要交互的部分。
