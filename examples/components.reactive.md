```reactive-md
version: "0.2"
data:
  articles:
    - {id: state, title: 理解状态, description: 找出用户可以改变的内容。}
    - {id: compute, title: 写下关系, description: 用计算值连接状态与结果。}
    - {id: view, title: 放置组件, description: 选择适合当前任务的表达方式。}
state:
  preference: concise
  selected: state
actions:
  choose:
    - set: selected
      value: "=event.value"
```

# 内容与组件一起表达

:icon{name="info" label="说明"} 将鼠标移到 :tooltip[响应式绑定]{text="输入更新状态，计算值和相关内容随之更新。"}，也可以用键盘聚焦查看说明。

::image{src="/reactive-flow.svg" alt="输入、计算与视图通过箭头连接" caption="文档中的视觉素材与正文共享布局。" fit="contain"}

:::radio-group{bind="preference" label="说明风格"}
::option[简洁]{value="concise"}
::option[详细]{value="detailed"}
:::

::spacer{size="sm"}

::list{items="=data.articles" label="阅读顺序" on-select="choose"}

已选主题：:value{value="=selected"}。

:::alert{tone="info" label="可以继续编辑"}
切换说明风格或选择列表项目，状态观察区会同步变化。
:::

::link-button[查看项目主页]{href="https://openai.com/index/gpt-6-for-everyone/" variant="secondary"}
