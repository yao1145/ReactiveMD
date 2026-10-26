# Reactive MD 新用户指南

[English](local-guide-en.md)

在 Markdown 中加入控件，就能让正文、计算结果和图表随读者的操作更新。打开[在线 Playground](https://yaozi.raricy.com/)，把下面的第一个示例粘贴到编辑器，在预览中试着调整参数。

本文使用 `reactive-md@0.5.3` 和 `local-draft-2` 语法。应用接入见[独立接入示例](../examples/integration/README.md)，完整属性与规则见[语法规范](local-interaction-syntax-ch.md)。

## 第一份交互文档

```markdown
# 费用估算

<panel title="调整方案">
<slider bind="people" label="人数" initial="2" min="1" max="20">
<toggle bind="annual" label="按年付费">
</panel>

人数：**{{ people }}**。

每月费用：**{{ people * (annual ? 80 : 100) }} 元**。
```

拖动滑块或开启按年付费，正文中的数值会立即更新。面板的重置按钮会把控件恢复到默认值。

其中的连接方式是：

- `bind="people"` 为参数命名，`initial="2"` 设置初值。
- `{{ people }}` 读取参数，`people * 100` 这样的表达式用它计算。
- `annual ? 80 : 100` 表示开启时取 80，否则取 100。开关省略 `initial` 时默认关闭。

## 标签与参数

标签名、属性名用小写，属性值加引号。`<slider>`、`<input>` 等控件没有结束标签；`<panel>`、`<card>` 等容器包裹 Markdown 内容，必须用 `</panel>`、`</card>` 闭合。

每个输入控件都需要 `label`。其他内容需要读取它的值时再加 `bind`；独立小工具可以省略，例如 `<timer label="专注计时" duration="60">`。

参数名使用英文字母、数字和下划线，以字母或下划线开头，区分大小写。中文显示在 `label` 中；`x`、`y`、`pi`、`e` 和内置函数名是保留名称。

两个数字控件可以共享参数：

```markdown
<slider bind="people" label="人数" initial="2" min="1" max="20">
<number bind="people" label="精确人数" min="1" max="20" step="1">

当前人数：{{ people }}。
```

两者的范围和步长要一致，同一参数只写一次显式 `initial`。其他控件的共享规则见[语法规范](local-interaction-syntax-ch.md)。

## 选择输入控件

| 需要 | 控件 | 参数值 |
| --- | --- | --- |
| 短文本或多行文本 | `input`、`textarea` | 字符串 |
| 精确数字或滑动调节 | `number`、`slider`、`counter` | 数字 |
| 开关或勾选 | `toggle`、`checkbox` | 布尔值 |
| 日期 | `date` | `YYYY-MM-DD` 字符串，或空字符串 |
| 单选 | `select`、`choices`、`radio-group` | 已选选项的字符串值 |
| 多选 | `multi-select` | 已选值组成的数组 |

```markdown
<input bind="name" label="姓名" placeholder="怎么称呼你？">
<textarea bind="notes" label="备注" initial="带上相机" rows="3">
<date bind="day" label="活动日期" initial="2026-10-26">

<choices bind="plan" label="方案">
<option value="basic">基础版</option>
<option value="pro">专业版</option>
</choices>

你好，{{ name == '' ? '访客' : name }}。方案：{{ plan }}。
```

`textarea` 的文字写在 `initial` 中，没有标签正文。单选默认选中第一项，也可以用 `initial` 指定某个选项的 `value`。

## 计算结果与条件内容

表达式支持四则运算（`+`、`-`、`*`、`/`）、比较（`==`、`!=`、`<`、`>=`）、布尔运算（`&&`、`||`、`!`）和条件表达式（`条件 ? 成立时的值 : 否则的值`）。乘法写 `*`，条件必须是布尔值，算术运算使用数字。

需要复用计算结果时，用 `computed`：

```markdown
<number bind="quantity" label="数量" initial="3" min="1" max="20">
<computed name="total" value="{{ quantity * 100 }}">

总价：{{ formatCurrency(total, 'CNY', 2, 'zh-CN') }}。

<if when="{{ quantity >= 5 }}">
<alert tone="success" title="团体预订">
人数已达到团体预订条件。
</alert>
</if>
```

`computed` 是不可见声明，应单独写在文档顶层。固定值用 `const`。常用函数包括 `round`、`min`、`max`、`len`、`contains` 和 `formatNumber`；签名与示例见[复用计算与格式化数值](computations-formatting-ch.md)。

数组用 `len(selected)` 计数，例如清单已勾选的项目数。表达式使用内置语言，不执行 JavaScript，也不发起网络请求。

## 加入图表与函数曲线

图表读取 Markdown 表格。第一列写标签，数值单元格写纯数字或完整的 `{{ 表达式 }}`，单位放在 `y-label` 或表头中。

```markdown
<slider bind="people" label="人数" initial="2" min="1" max="20">

<chart kind="bar" title="每月费用" y-label="元">
| 方案 | 费用 |
| --- | ---: |
| 基础版 | {{ people * 20 }} |
| 专业版 | {{ people * 35 }} |
</chart>
```

图表类型包括 `bar`、`line`、`area`、`scatter` 和 `donut`。需要搜索、排序和分页时，把 Markdown 表格放进 `<table label="目录">...</table>`。

函数曲线使用 LaTeX：

```markdown
<slider bind="a" label="振幅" initial="1" min="0" max="3" step="0.5">

<plot min="-6" max="6" label="正弦曲线">
$$ y = a \sin x $$
</plot>
```

每个公式块定义一条 `y = 表达式` 显函数曲线。参数直接使用数学名称，不写 `{{ }}`；多字母参数如 `amplitude` 写成 `\mathrm{amplitude}`。公式显示与曲线计算各有支持范围，详见[绘图规则](local-interaction-syntax-ch.md)。

## 完整练习：摄影工作坊报名页

把这份文档完整粘贴到 Playground。调整人数、开启优惠，再勾选准备事项。

```markdown
# 周末摄影工作坊

<panel title="报名方案">
<slider bind="people" label="人数" initial="4" min="1" max="12">
<toggle bind="member" label="会员优惠">
<choices bind="track" label="课程方向">
<option value="portrait">人像</option>
<option value="landscape">风光</option>
</choices>
</panel>

<computed name="total" value="{{ people * (member ? 240 : 300) }}">

方向：{{ track == 'portrait' ? '人像' : '风光' }}。

总价：**{{ formatCurrency(total, 'CNY', 2, 'zh-CN') }}**。

<if when="{{ people >= 6 }}">
<alert tone="success" title="团体安排">
我们会与你联系，确认适合团队的场地。
</alert>
</if>

<chart title="预算对比" y-label="元">
| 项目 | 基础方案 | 完整方案 |
| --- | ---: | ---: |
| 课程 | {{ people * 300 }} | {{ people * 380 }} |
</chart>

<checklist bind="prepared" label="课前准备">
- [ ] 确认日期
- [ ] 准备设备
- [ ] 查看天气
</checklist>

<progress label="准备进度" value="{{ len(prepared) / 3 * 100 }}">
```

清单用 `[ ]` / `[x]` 标记初始状态，公开值是数组；`len(prepared)` 得到勾选数量。面板重置只作用于面板内的控件，这里的清单在面板外。

试着加入一个共享 `people` 的 `<number>`，或把图表改成优惠价与原价的对比。用键盘操作一次，再检查窄屏下的布局。

## 常见错误

| 问题 | 修改方式 |
| --- | --- |
| 引用了未声明参数 | 检查表达式与 `bind` 或 `computed` 名称的拼写、大小写。 |
| 重复 `initial` | 同一共享参数只保留一个显式初值。 |
| 数字初值无效 | 确认它在 `min` / `max` 内，并符合 `step`。 |
| `if` 条件类型错误 | 写成 `when="{{ people >= 5 }}"` 这样的比较。 |
| 图表不接受 `20 元` | 单元格写 `20`，单位移到标签中。 |
| 容器未闭合 | 检查结束标签和嵌套顺序；`<card />` 不会闭合容器。 |
| 标签或表达式显示为原文 | 检查是否在代码中或被转义；未知标签也会产生降级警告。 |
| 表格中的逻辑或破坏了分列 | 在 Markdown 表格单元格内将竖线转义为 `\|\|`。 |
| 绘图拒绝公式 | 检查可计算 LaTeX 范围，多字母参数使用 `\mathrm{name}`。 |

先修复第一条诊断，再看后续问题。编译错误会阻止预览；降级警告保留相关源码。运行时计算出错只影响对应内容，其他独立内容继续更新。

展示标签与表达式原文时，使用行内代码或代码围栏。正文中需要字面插值时写 `\{{ people }}`。

## 继续阅读

| 目标 | 参考 |
| --- | --- |
| 查看可运行的完整文档 | [示例目录](../examples/local/README.md) |
| 学习标签页、卡片、图解等组件 | [语法规范](local-interaction-syntax-ch.md)与[组块扩展](local-components-v2-ch.md) |
| 加入校验或生成表格 | [条件、校验与本地集合](constraints-collections-ch.md) |
| 导出交互 HTML 文件 | [分享与静态导出](shareable-export-ch.md) |
| 嵌入渲染器或编辑器 | [宿主集成](local-integration-ch.md)与[编辑器指南](editor-ch.md) |
| 核对版本与迁移 | [版本与兼容性](compatibility-ch.md) |

从本仓库运行 Playground 时，先用 `npm ci` 安装依赖，再运行 `npm run dev`，打开 `http://127.0.0.1:5173`。开发需要 Node.js 22.12 或更新版本。
