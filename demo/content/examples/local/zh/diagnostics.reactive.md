# 诊断示例

这份文档故意保留错误，用于检查诊断提示。正确示例请从同目录的其他文档开始。

## 引用拼错的参数名

<slider bind="seats" label="人数" initial="2" min="1" max="20">

当前人数：{{ seat }}。

## 重复声明初值

<number bind="seats" label="另一处人数输入" initial="3" min="1" max="20">

## 超出范围的初值

<slider bind="ratio" label="比例" initial="12" min="0" max="10">

## 条件类型错误

<if when="{{ seats }}">
这里需要布尔条件，例如 seats 大于 5。
</if>

## 未知标签

<slidr label="拼错的滑块" />

## 不属于本地交互语言的事件

<counter label="计数" on-click="increment">

## 缺少节点

<diagram label="错误连线">
<node id="input" label="输入">
只有这一个节点。
</node>
<edge from="input" to="missing">
</diagram>

## 不支持计算的数学结构

<plot label="积分计算尚不属于绘图语法">
$$ y = \int_0^x t^2\,dt $$
</plot>

## 无效的图表数据

<chart title="数值列中混入了单位">
| 项目 | 费用 |
| --- | ---: |
| 内容 | 20 元 |
</chart>
