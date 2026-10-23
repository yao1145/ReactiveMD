# 跟随一个数值走过文档

先调整人数，再依次选择输入、计算和显示节点，跟随同一个数值，观察它如何变成最终结果。

<panel title="试一个数值">
<slider bind="people" label="人数" initial="4" min="1" max="12">
</panel>

<diagram bind="selected" initial="input" label="从输入到解释">
<node id="input" label="输入: {{ people }}">
滑块用 people 命名当前数值，目前是 **{{ people }}**.
</node>
<node id="compute" label="计算: {{ people }} × 80">
每人费用 80 元，总费用为 **{{ people }} × 80 = {{ people * 80 }}**.
</node>
<node id="view" label="显示: {{ people * 80 }}">
正文直接读取计算结果：活动费用为 **{{ people * 80 }}**.
</node>
<edge from="input" to="compute" label="参数变化">
<edge from="compute" to="view" label="结果更新">
</diagram>

正在查看： **{{ selected == 'input' ? '输入' : selected == 'compute' ? '计算' : '显示' }}**.

<if when="{{ selected == 'input' }}">
<alert title="从可调整的输入开始">试着调到 6 人，再选择计算节点，跟进计算过程。</alert>
</if>
<if when="{{ selected == 'compute' }}">
<alert title="让关系可见">表达式 people * 80 的结果是 **{{ people * 80 }}**.</alert>
</if>
<if when="{{ selected == 'view' }}">
<alert tone="success" title="文档呈现计算结果">当前 {{ people }} 人，总费用为 **{{ people * 80 }}**.</alert>
</if>

## 用键盘继续探索

按 Tab 聚焦图中的节点，用方向键移动焦点，再按 Enter 或空格键选择。节点说明和图下正文会跟随选择同步更新。

## 看看写法

<accordion>
<disclosure label="展开关键源码">

```markdown
<diagram bind="selected" initial="input" label="一个简单流程">
<node id="input" label="输入">读取参数。</node>
<node id="view" label="显示">解释结果。</node>
<edge from="input" to="view">
</diagram>
当前节点： {{ selected }}
```

</disclosure>
</accordion>
