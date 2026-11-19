# 命名通道问卷

<external name="showTally" type="boolean">
<external name="showFeed" type="boolean">
<external name="votesReady" type="boolean">
<external name="votesYes" type="number">
<external name="votesNo" type="number">
<computed name="votesTotal" value="{{ votesYes + votesNo }}">

这份文档只引用通道名，不包含地址、请求头或令牌。宿主在 `src/host.ts` 里决定
`answers` 如何提交、`results` 来自哪里；文档换一个宿主就换一套接线。

## 你的回答

<panel title="问卷">

<select bind="choice" label="你会参加吗？" initial="yes">
<option value="yes">会来</option>
<option value="no">不来</option>
</select>

<textarea bind="comment" label="补充说明" rows="2" placeholder="可以留空">

<submit-button channel="answers" fields="choice comment" label="提交回答">

</panel>

按钮一次读取 `choice` 和 `comment`。页面里再加输入框不会改变提交内容；提交
失败时输入保留，可以修改后重试。

## 实时统计

<if when="{{ votesReady }}">

已有 **{{ votesTotal }}** 人投票，其中 {{ votesYes }} 人会参加。

</if>

正文的只读值与两个计票组件共享 `results` 连接。隐藏计票面板后，正文仍会收到统计更新。

<if when="{{ showTally }}">

<vote-tally channel="results" label="实时计票">

</if>

<if when="{{ showFeed }}">

<vote-feed channel="results" label="计票明细">

</if>
