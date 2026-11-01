import { readFile, writeFile } from 'node:fs/promises';
import { analyzeLocalSource, compileLocal, renameLocalBinding } from 'reactive-md';

const ids = ['functions', 'forms', 'statistics', 'layout', 'flow', 'tasks'];
for (const language of ['en', 'zh']) {
  const parts = [language === 'zh'
    ? '# 功能演示\n\n这篇文档收集了函数、表单、图表、布局、流程和计时组件。沿着大纲浏览，直接修改控件，也可以打开源码，把需要的部分复制到自己的文档。'
    : '# Feature demo\n\nFunctions, forms, charts, layouts, diagrams and timers in one document. Follow the outline, try the controls, or open the source and copy a section into your own document.'];
  for (const id of ids) {
    let source = await readFile(new URL(`../../examples/local/showcase/${language === 'zh' ? 'zh/' : ''}${id}.reactive.md`, import.meta.url), 'utf8');
    for (const binding of analyzeLocalSource(source).bindings.filter(item => item.declarations.length)) {
      const name = id + binding.name[0].toUpperCase() + binding.name.slice(1);
      source = renameLocalBinding(source, binding.name, name).source;
    }
    let fenced = false;
    source = source.split(/\r?\n/).map(line => {
      if (/^```/.test(line)) fenced = !fenced;
      return !fenced && /^#{1,5} /.test(line) ? '#' + line : line;
    }).join('\n');
    parts.push(source.trim());
  }
  const combined = parts.join('\n\n') + '\n';
  const result = compileLocal(combined);
  if (!result.ok || result.diagnostics.length) throw new Error(JSON.stringify(result.diagnostics));
  await writeFile(new URL(`../../examples/local/showcase/${language === 'zh' ? 'zh/' : ''}features.reactive.md`, import.meta.url), combined);
  console.log(`Generated ${language} feature demo: ${combined.length} characters`);
}
