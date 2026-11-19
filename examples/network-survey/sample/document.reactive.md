# 命名通道问卷

<external name="showTally" type="boolean">
<external name="showFeed" type="boolean">

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

两个计票组件订阅同一个 `results` 通道，共用一条连接。页面开关控制组件可见性。
隐藏一个组件后，另一个继续接收消息。隐藏最后一个组件后，页面底部的宿主记录会显示连接已释放。

<if when="{{ showTally }}">

<vote-tally channel="results" label="实时计票">

</if>

<if when="{{ showFeed }}">

<vote-feed channel="results" label="计票明细">

</if>
