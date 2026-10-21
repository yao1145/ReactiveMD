```reactive-md
version: "0.2"
data:
  nextTask: {id: review, title: 复核交互, description: 检查键盘和手机布局}
  checks:
    - {id: source, label: 读懂源文档}
    - {id: state, label: 调整状态并观察结果}
    - {id: mobile, label: 在手机宽度试用}
  products:
    - {name: 文档, category: 基础, price: 20}
    - {name: 表单, category: 输入, price: 45}
    - {name: 图表, category: 视觉, price: 80}
    - {name: 图解, category: 视觉, price: 65}
    - {name: 列表, category: 基础, price: 30}
    - {name: 计划, category: 工具, price: 35}
state:
  tasks:
    - {id: design, title: 设计文档, description: 写下状态和组件}
    - {id: build, title: 实现交互, description: 用输入和动作连接内容}
  checked: []
computed:
  total: "=len(tasks)"
  progress: "=len(checked) / 3 * 100"
actions:
  add:
    - append: tasks
      value: "=data.nextTask"
  remove:
    - remove: tasks
      at: "=i"
```

# 内容也可以是响应式集合

当前任务数：:value{value="=total"}。

::::each{items="=tasks" as="task" index="i" key="id"}
:::card
### :value{value="=task.title"}

:value{value="=task.description"}

::button[移除任务]{on-click="remove" variant="secondary"}
:::
::::

::button[添加复核任务]{on-click="add" disabled="=contains(pluck(tasks, 'id'), 'review')"}

::divider

::checklist{bind="checked" label="体验清单" items="=data.checks"}

::progress{label="完成进度" value="=progress" max="100"}

## 搜索、排序和分页

::table{data="=data.products" label="组件费用示例" searchable="true" sortable="true" page-size="3"}
