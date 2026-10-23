# 让解释可以被探索

点击节点或使用键盘选择一个环节，查看它的说明。

<diagram bind="selected" initial="input" label="响应式状态流">
<node id="input" label="输入">
读者通过滑块、开关和输入框改变参数。
</node>

<node id="compute" label="计算">
重新计算依赖这些参数的公式。
</node>

<node id="view" label="显示">
正文、图表和提示随结果更新。
</node>

<edge from="input" to="compute" label="参数变化">
<edge from="compute" to="view" label="更新结果">
</diagram>

当前环节：{{ selected == 'input' ? '输入' : selected == 'compute' ? '计算' : '显示' }}。

## 改变参数，观察曲线

<panel title="正弦波参数">
<slider bind="a" label="振幅" initial="1" min="0" max="3" step="0.5">
<slider bind="f" label="频率参数" initial="1" min="0.5" max="3" step="0.5">
</panel>

<plot min="0" max="12.56" label="正弦波" x-label="x" y-label="位移">
$$ y = a\sin(fx) $$
</plot>

<if when="{{ a == 0 }}">
振幅为零，曲线与横轴重合。
</if>

## 叠加两条曲线

<plot min="-5" max="5" label="抛物线与直线">
$$ y = x^2 $$
$$ y = 2x + 1 $$
</plot>
