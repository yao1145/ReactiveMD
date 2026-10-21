```reactive-md
version: "0.2"
state:
  name: ""
  email: ""
  role: personal
  appointment: "2026-10-22"
  message: ""
  consent: false
  submitted: false
actions:
  submit:
    - set: submitted
      value: true
  again:
    - reset: [name, email, role, appointment, message, consent, submitted]
```

# 一个完整的声明式表单

输入姓名、邮箱和需求，勾选确认后提交。必填与格式校验发生在提交时。

::::form{on-submit="submit" label="预约交流"}
::input{bind="name" label="姓名" name="name" required="true" min-length="2" placeholder="至少两个字"}

::input{bind="email" label="邮箱" name="email" required="true" pattern="[^@ ]+@[^@ ]+[.][^@ ]+" placeholder="name@example.com"}

:::choices{bind="role" label="使用方式"}
::option[个人使用]{value="personal"}
::option[团队使用]{value="team"}
:::

::date{bind="appointment" label="希望交流的日期" required="true"}

::textarea{bind="message" label="想实现什么交互？" required="true" min-length="3" rows="4" placeholder="描述你的文档或工具"}

::checkbox{bind="consent" label="确认以上内容可以用于本次交流"}

::submit[提交预约]{disabled="=!consent"}
::::

::::if{when="=submitted"}
:::alert{tone="success" label="已记录本地提交"}
谢谢 :value{value="=name"}。你选择的日期是 :value{value="=appointment"}。

本示例将结果保存在当前文档状态中。
:::
::button[重新填写]{on-click="again" variant="secondary"}
::::
