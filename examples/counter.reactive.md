```reactive-md
version: "0.1"
state:
  count: 0
actions:
  increment:
    - set: count
      value: "=count + 1"
  reset:
    - reset: [count]
```

# 计数器

当前数值：:value{value="=count"}。

::button[加一]{on-click="increment"}
::button[重置]{on-click="reset" variant="secondary"}
