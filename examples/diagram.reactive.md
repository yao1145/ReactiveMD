```reactive-md
version: "0.2"
data:
  nodes:
    - {id: input, label: 输入, x: 100, y: 120, description: 用户通过控件改变文档状态。}
    - {id: compute, label: 计算, x: 320, y: 120, description: 依赖图只重算受影响的计算值。}
    - {id: view, label: 视图, x: 540, y: 120, description: 组件订阅新状态并显示结果。}
  edges:
    - {from: input, to: compute, label: 状态变化}
    - {from: compute, to: view, label: 订阅更新}
state:
  selected: input
  amplitude: 1
  frequency: 1
```

# 让解释可以被探索

点击节点或使用键盘选择一个环节，查看它在响应式文档中的作用。

::diagram{nodes="=data.nodes" edges="=data.edges" bind="selected" label="响应式状态流"}

当前环节：:value{value="=selected"}。

## 改变输入，观察曲线

::slider{bind="amplitude" label="振幅" min="0.5" max="3" step="0.5"}

::slider{bind="frequency" label="频率" min="0.5" max="3" step="0.5"}

::plot{formula="amplitude * sin(frequency * x)" min="0" max="12.56" samples="180" label="正弦波交互图解" x-label="x" y-label="位移"}
