```reactive-md
version: "0.2"
data:
  empty: []
state:
  query: ""
actions:
  search:
    - call: catalog.search
      input:
        query: "=query"
```

# 文档里的宿主动作

输入关键词，查询宿主提供的本地组件目录。查询是异步执行的，可以观察加载状态。

输入 `error` 可以检查示例服务的失败与重试流程，加载期间可取消请求。

:::form{on-submit="search" label="查询组件目录"}
::input{bind="query" label="组件关键词" placeholder="例如：图表、表单、输入"}

::submit[查询目录]
:::

查询状态：:value{value="=resources.search.status"}。

:::if{when="=resources.search.status == 'pending'"}
:spinner{label="正在查询本地目录"}
:::

:::if{when="=resources.search.status == 'error'"}
:value{value="=resources.search.error"}
:::

:::if{when="=resources.search.status == 'success'"}
::table{data="=resources.search.status == 'success' ? resources.search.data : data.empty" label="查询结果" page-size="5"}
:::
