import spectrum from './spectrum.svg?url&no-inline';
import structure from './structure.svg?url&no-inline';
import field from './field.svg?url&no-inline';
import wave from './wave.svg?url&no-inline';
export const imageAssets = [spectrum, structure, field, wave];

export const source = `
<panel title="研究工作台" reset="true">

<slider bind="samples" label="样本数量" min="16" max="80" initial="32" step="1">

<checkbox bind="verified" label="已核对实验条件" initial="false">

## 样本分析流程

悬浮节点查看说明；点击节点选择阶段。当前阶段：**{{ step }}**。

<diagram label="从采集到归档" direction="right" bind="step" initial="collect">
<node id="collect" label="收集样本">
### 从清晰的记录开始
本次准备处理 **{{ samples }} 份样本**，每份样本都应附带采集时间与来源。

- 核对样本编号与批次。
- 保留原始记录，便于回溯。
</node>
<node id="validate" label="校验数据">
### 检查完整性
核对编号、单位和采集条件，缺失项进入人工复核。

当前核对状态：**{{ verified ? '已核对' : '待核对' }}**。说明会随参数同步更新。
</node>
<node id="review" label="人工复核" tone="warning">
### 先排除异常来源
逐项检查异常样本，不让缺失信息直接进入分析。

1. 比较原始记录与导入结果。
2. 核对单位、量程与样本状态。
3. 标记重复编号和缺失项。
4. 重新检查仪器校准记录。
5. 补充说明后返回校验节点。
6. 无法修正的样本记录排除原因。

浮层支持长内容滚动、选择文字与键盘操作。
</node>
<node id="analyze" label="运行分析">
### 让结果可以复现
以同一套分析条件处理 **{{ samples }} 份样本**，记录参数与版本。

结果异常时返回人工复核；确认后生成报告。
</node>
<node id="report" label="生成报告" tone="success">
### 把结论讲清楚
整理结果、图表和方法说明。

**交付内容**：研究摘要、数据图表、原始记录索引。
</node>
<node id="archive" label="归档记录">
保留原始数据、分析配置和最终报告，方便后续查询。
</node>
<edge from="collect" to="validate" label="导入">
<edge from="validate" to="analyze" label="通过">
<edge from="validate" to="review" label="缺项">
<edge from="review" to="validate" label="补充后重试">
<edge from="analyze" to="review" label="异常复查">
<edge from="analyze" to="report" label="结果确认">
<edge from="report" to="archive" label="完成">
</diagram>

## 图片 Gallery

横向滚动查看研究切片；可拖动下方滚动条，也可使用左右按钮与方向键。

<gallery label="研究切片" item-width="280">
<gallery-item label="01 · 光谱">
![蓝色光谱曲线](${spectrum})

从背景噪声中辨认信号，找到值得追踪的变化。
</gallery-item>
<gallery-item label="02 · 结构">
![绿色分子结构示意](${structure})

节点之间的连接，帮助我们理解整体结构。
</gallery-item>
<gallery-item label="03 · 场">
![暖色等值线示意](${field})

在不同尺度下，观察规律如何出现。
</gallery-item>
<gallery-item label="04 · 波形">
![深蓝背景上的紫色波形](${wave})

保持变化的连续性，也保留阅读的节奏。
</gallery-item>
</gallery>

## 卡片与混合内容

<gallery label="阶段卡片" item-width="300">
<gallery-item label="采集计划">
<card title="01 / 收集">
准备 **{{ samples }} 份样本**。

- 统一编号与单位。
- 保存时间与来源。
</card>
</gallery-item>
<gallery-item label="质量检查">
<card title="02 / 校验">
核对状态：**{{ verified ? '已核对' : '待核对' }}**。

在上方完成条件核对，此卡片和节点说明会同步更新。
</card>
</gallery-item>
<gallery-item label="记录与说明">
<card title="03 / 分析">
保留参数、方法和版本。

> 每一步分析，都可以回到原始记录。
</card>
</gallery-item>
<gallery-item label="图片也能放在卡片之间">
![暖色等值线示意](${field})

同一条 Gallery 可以混排图片、卡片和普通 Markdown。
</gallery-item>
<gallery-item label="交付清单">
<card title="04 / 归档">
最终结果应当包含：

1. 可阅读的研究报告。
2. 可复现的分析参数。
3. 可追溯的原始数据。
</card>
</gallery-item>
</gallery>

<accordion label="长文本验收">
<disclosure label="长标题、连续英文与完整说明">

<diagram label="这是一个用于检查图解长标题的完整示例：标题保留开头文字并显示省略号，节点说明保留完整内容" direction="down" bind="longStep" initial="long-a">
<node id="long-a" label="这是一个很长的节点标题，需要自动换行并在超出两行后显示省略号" tone="warning">
完整标题可在说明浮层中阅读，说明正文也支持连续英文与长链接文字。

ContinuousEnglishTextForDiagramOverflowReviewWithoutAnySpacesToForceWrappingAcrossTheTooltipWidth

内联代码也应留在浮层内：

\`sample_observation_identifier_that_is_intentionally_long_without_spaces_for_readability_review\`
</node>
<node id="long-b" label="LongUnbrokenNodeTitleForResponsiveTextReview" tone="success">
节点标签根据实际可用宽度换行，完整名称保留在浮层与可访问名称中。
</node>
<edge from="long-a" to="long-b" label="确认后继续">
</diagram>

<gallery label="这是一个用于检查画廊标题与左右按钮间距的很长标题，完整名称可在悬浮提示中阅读" item-width="260">
<gallery-item label="这是一个用于检查图片说明不会被两端渐隐遮住的很长标题">
![暖色等值线示意](${field})

正文应自然换行，保留清晰的左右间距。
</gallery-item>
<gallery-item label="LongUnbrokenGalleryCaptionForTextOverflowReview">
<card title="这是一个需要保留开头文字与省略号的超长卡片标题，用来检查画廊里的长文本适配">
ContinuousEnglishTextForGalleryOverflowReviewWithoutAnySpacesToForceWrappingInsideTheCard

\`long_inline_code_identifier_for_gallery_text_wrapping_and_padding_review\`
</card>
</gallery-item>
<gallery-item label="另一张图片与完整说明">
![绿色分子结构示意](${structure})

标题与正文在横向滚动停止后，应落在渐隐区域以内的清晰位置。
</gallery-item>
</gallery>

</disclosure>
</accordion>

</panel>
`;
