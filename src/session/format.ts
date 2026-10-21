import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkDirective from 'remark-directive';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import remarkStringify from 'remark-stringify';
import { compile } from '../core';

export function formatDocument(source: string): string {
  const before = compile(source);
  if (!before.ok) throw new Error('请先修正源码诊断，再格式化文档。');
  const processor = unified().use(remarkParse).use(remarkGfm).use(remarkDirective)
    .use(remarkFrontmatter, ['yaml', 'toml']).use(remarkStringify, { bullet: '-', fences: true, listItemIndent: 'one' });
  const output = processor.stringify(processor.parse(source));
  const after = compile(output);
  if (!after.ok) throw new Error('格式化结果未通过语言校验，保留原始文档。');
  return output;
}
