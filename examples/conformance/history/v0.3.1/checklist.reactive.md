# 用清单组织体验过程

<panel title="体验清单">
<checklist bind="done" label="完成这些操作">
- [x] 读懂源文档
- [ ] 调整参数并观察结果
- [ ] 在手机宽度试用
</checklist>

已完成 **{{ len(done) }} / 3** 项。

<progress label="完成进度" value="{{ len(done) / 3 * 100 }}">

<if when="{{ len(done) == 3 }}">
<alert tone="success" title="体验完成">
你已经看过源码、试过交互，也检查了窄屏效果。
</alert>
</if>
</panel>

## 搜索、排序和分页

<table label="组件费用示例" page-size="3">
| 名称 | 分类 | 价格 |
| --- | --- | ---: |
| 文档 | 基础 | 20 |
| 参数面板 | 输入 | 45 |
| 图表 | 视觉 | 80 |
| 图解 | 视觉 | 65 |
| 清单 | 基础 | 30 |
| 计划 | 工具 | 35 |
</table>
