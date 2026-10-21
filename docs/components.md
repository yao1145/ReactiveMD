# 组件参考

用法与完整示例见 [作者指南](guide.md)，宿主扩展见 [集成说明](integration.md)。

此文件从运行时 schema 自动生成，共 44 个内置组件。属性后的 * 表示必填；“动态”属性接受 `=表达式`。`bind`、事件名和 `id` 使用单独的结构规则。

| 组件 | 形态 | bind | 属性 | 事件 |
| --- | --- | --- | --- | --- |
| `value` | 行内 | 无 | `value` value*（动态）<br>`format` enum，默认 "text"：text/number/currency<br>`currency` currency | 无 |
| `badge` | 行内 | 无 | `tone` enum，默认 "neutral"：neutral/success/warning | 无 |
| `card` | 容器 | 无 | 无 | 无 |
| `stack` | 容器 | 无 | `gap` enum，默认 "md"：sm/md/lg | 无 |
| `row` | 容器 | 无 | `gap` enum，默认 "md"：sm/md/lg | 无 |
| `input` | 单行块 | string，必填 | `label` string*（动态）<br>`placeholder` string<br>`commit` enum，默认 "input"：input/blur<br>`disabled` boolean（动态），默认 false<br>`required` boolean，默认 false<br>`min-length` number<br>`max-length` number<br>`pattern` string<br>`name` string | `on-change` |
| `number` | 单行块 | number，必填 | `label` string*（动态）<br>`min` number<br>`max` number<br>`step` number<br>`disabled` boolean（动态），默认 false<br>`required` boolean，默认 false<br>`name` string | `on-change` |
| `slider` | 单行块 | number，必填 | `label` string*（动态）<br>`min` number*<br>`max` number*<br>`step` number，默认 1<br>`disabled` boolean（动态），默认 false<br>`name` string | `on-change` |
| `toggle` | 单行块 | boolean，必填 | `label` string*（动态）<br>`disabled` boolean（动态），默认 false<br>`name` string | `on-change` |
| `select` | 容器 | string，必填 | `label` string*（动态）<br>`disabled` boolean（动态），默认 false<br>`name` string | `on-change` |
| `option` | 单行块 | 无 | `value` string* | 无 |
| `button` | 单行块 | 无 | `variant` enum，默认 "primary"：primary/secondary/quiet<br>`disabled` boolean（动态），默认 false | `on-click` |
| `if` | 容器 | 无 | `when` boolean*（动态） | 无 |
| `grid` | 容器 | 无 | `columns` number，默认 2<br>`gap` enum，默认 "md"：sm/md/lg<br>`min-width` number，默认 220 | 无 |
| `tabs` | 容器 | string，必填 | `label` string（动态）<br>`name` string | `on-change` |
| `tab` | 容器 | 无 | `value` string*<br>`label` string* | 无 |
| `accordion` | 容器 | 无 | 无 | 无 |
| `disclosure` | 容器 | boolean，可选 | `label` string*（动态）<br>`open` boolean，默认 false<br>`name` string | `on-change` |
| `form` | 容器 | 无 | `label` string（动态） | `on-submit`、`on-change` |
| `submit` | 单行块 | 无 | `variant` enum，默认 "primary"：primary/secondary/quiet<br>`disabled` boolean（动态），默认 false | 无 |
| `textarea` | 单行块 | string，必填 | `label` string*（动态）<br>`placeholder` string<br>`rows` number，默认 4<br>`required` boolean，默认 false<br>`min-length` number<br>`max-length` number<br>`pattern` string<br>`commit` enum，默认 "input"：input/blur<br>`disabled` boolean（动态），默认 false<br>`name` string | `on-change` |
| `checkbox` | 单行块 | boolean，必填 | `label` string*（动态）<br>`disabled` boolean（动态），默认 false<br>`name` string | `on-change` |
| `radio-group` | 容器 | string，必填 | `label` string*（动态）<br>`disabled` boolean（动态），默认 false<br>`name` string | `on-change` |
| `choices` | 容器 | string，必填 | `label` string*（动态）<br>`disabled` boolean（动态），默认 false<br>`name` string | `on-change` |
| `date` | 单行块 | string，必填 | `label` string*（动态）<br>`min` string<br>`max` string<br>`required` boolean，默认 false<br>`disabled` boolean（动态），默认 false<br>`name` string | `on-change` |
| `checklist` | 单行块 | array，必填 | `label` string*（动态）<br>`items` json*（动态）<br>`disabled` boolean（动态），默认 false<br>`name` string | `on-change` |
| `progress` | 单行块 | 无 | `value` number*（动态）<br>`max` number，默认 100<br>`label` string（动态） | 无 |
| `alert` | 容器 | 无 | `tone` enum，默认 "info"：info/success/warning/danger<br>`label` string（动态） | 无 |
| `tooltip` | 行内 | 无 | `text` string* | 无 |
| `image` | 单行块 | 无 | `src` string*（动态）<br>`alt` string*<br>`caption` string（动态）<br>`fit` enum，默认 "contain"：contain/cover | 无 |
| `icon` | 行内 | 无 | `name` enum*：check/info/warning/star/heart/search/clock/location/arrow<br>`label` string | 无 |
| `divider` | 单行块 | 无 | 无 | 无 |
| `spacer` | 单行块 | 无 | `size` enum，默认 "md"：sm/md/lg | 无 |
| `spinner` | 行内 | 无 | `label` string（动态），默认 "加载中" | 无 |
| `stat` | 单行块 | 无 | `label` string*（动态）<br>`value` value*（动态）<br>`format` enum，默认 "text"：text/number/currency<br>`currency` currency<br>`hint` string（动态） | 无 |
| `link-button` | 单行块 | 无 | `href` string*（动态）<br>`variant` enum，默认 "primary"：primary/secondary/quiet | 无 |
| `table` | 单行块 | 无 | `data` json*（动态）<br>`columns` json（动态）<br>`label` string（动态）<br>`searchable` boolean，默认 true<br>`sortable` boolean，默认 true<br>`page-size` number，默认 5 | 无 |
| `list` | 单行块 | 无 | `items` json*（动态）<br>`label` string（动态） | `on-select` |
| `each` | 容器 | 无 | `items` json*（动态）<br>`as` string，默认 "item"<br>`index` string，默认 "index"<br>`key` string* | 无 |
| `chart` | 单行块 | 无 | `data` json*（动态）<br>`kind` enum，默认 "bar"：bar/line/area/scatter/donut<br>`x` string，默认 "label"<br>`y` string，默认 "value"<br>`label` string*（动态）<br>`x-label` string<br>`y-label` string | `on-select` |
| `plot` | 单行块 | 无 | `formula` formula*<br>`min` number（动态），默认 0<br>`max` number（动态），默认 10<br>`samples` number，默认 60<br>`label` string*（动态）<br>`x-label` string<br>`y-label` string | 无 |
| `diagram` | 单行块 | string，可选 | `nodes` json*（动态）<br>`edges` json（动态），默认 []<br>`label` string*（动态）<br>`name` string | `on-select`、`on-change` |
| `timeline` | 单行块 | 无 | `items` json*（动态）<br>`label` string*（动态） | 无 |
| `timer` | 单行块 | number，必填 | `label` string*（动态）<br>`duration` number*<br>`name` string | 无 |

完整源文档见 [examples](../examples)。地图与小游戏不在当前范围。
