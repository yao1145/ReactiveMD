# HTML 与 ReactiveMD

<details open>
<summary>展开查看<strong>交互示例</strong></summary>

## 调整参数

<counter bind="count" label="次数" initial="2">

当前值：**{{ count }}**。HTML 上下标：H<sub>2</sub>O、x<sup>2</sup>。

<details>
<summary>补充说明</summary>

折叠正文支持 Markdown、公式与 ReactiveMD 控件。

</details>
</details>

<div align="center">你好，**居中内容**。</div>

<p align="right">右对齐段落。</p>

<blockquote>默认模式使用现有渲染器和主题。</blockquote>

<ol start="3"><li>支持 HTML 列表。</li><li>代码按原样显示。</li></ol>

<pre><code>&lt;counter label="这里是代码"&gt; {{ count }}</code></pre>

<table label="Markdown 表格" searchable="false" sortable="false">
| 项目 | 数值 |
| --- | ---: |
| 当前次数 | {{ count }} |
| 固定值 | 10 |
</table>

<table>
<caption>原生 HTML 表格</caption>
<tr><th scope="col">项目</th><th scope="col">数值</th></tr>
<tr><td>当前次数</td><td>{{ count }}</td></tr>
<tr><td>固定值</td><td>10</td></tr>
<tr><td colspan="2">**合并单元格**也支持 Markdown 和公式：\(x^2\)。</td></tr>
</table>
