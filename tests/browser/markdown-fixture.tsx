import { createRoot } from 'react-dom/client';
import { LocalReactiveDocument } from '../../src/react/index';
import type { Diagnostic } from '../../src/index';
import '../../src/styles.css';

const source = `# Markdown 兼容性

Array<T>，Map<string, number>，比较 x<y 成立。售价 $5、$10，或 $5 and $10。

<b>粗体 <i>斜体</i></b>、<u>下划线</u>、<s>删除线</s>、<mark>高亮</mark><br>换行之后。

正文第一次[^detail]，重复引用[^detail]。

<card title="容器内引用">
卡片内另一个脚注[^other]，以及共享引用[^detail]。
</card>

<counter bind="count" label="数量" initial="2">

当前数量：{{ count }}。

行内公式：\\(\\frac{a}{b}\\)。

\\[
x^2 + 1
\\]

[^other]: 第二个定义，先出现也按引用排序。

[^detail]: **加粗内容**与<i>脚注斜体</i>，以及[普通链接](https://example.com)。

    第二段内容。

    - 脚注列表项
    - ${'long-footnote-word-'.repeat(12)}

[^unused]: 不应显示的未引用定义。
`;

declare global { interface Window { markdownDiagnostics: Diagnostic[] } }
window.markdownDiagnostics = [];
createRoot(document.getElementById('root')!).render(<>
  <div id="primary"><LocalReactiveDocument source={source} locale="zh" onDiagnostics={items => { window.markdownDiagnostics = items; }} /></div>
  <div id="secondary"><LocalReactiveDocument source={'第二份文档[^detail]。\n\n[^detail]: 独立脚注。'} locale="zh" mode="static" /></div>
</>);
