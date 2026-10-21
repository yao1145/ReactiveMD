import { writeFile, mkdir } from 'node:fs/promises';
import { getComponentManifest } from '../dist-library/reactive-md.js';

const manifest = getComponentManifest();
const rows = manifest.map(schema => {
  const form = { inline: '行内', leaf: '单行块', container: '容器' }[schema.form];
  const bind = schema.binding ? `${schema.binding.type}${schema.binding.required ? '，必填' : '，可选'}` : '无';
  const props = Object.entries(schema.props).map(([name, prop]) =>
    `\`${name}\` ${prop.type}${prop.required ? '*' : ''}${prop.dynamic ? '（动态）' : ''}${prop.default !== undefined ? `，默认 ${JSON.stringify(prop.default)}` : ''}${prop.values ? `：${prop.values.join('/')}` : ''}`,
  ).join('<br>') || '无';
  const events = Object.keys(schema.events ?? {}).map(event => `\`on-${event}\``).join('、') || '无';
  return `| \`${schema.name}\` | ${form} | ${bind} | ${props} | ${events} |`;
});
const text = '# 组件参考\n\n用法与完整示例见 [作者指南](guide.md)，宿主扩展见 [集成说明](integration.md)。\n\n此文件从运行时 schema 自动生成，共 ' + manifest.length + ' 个内置组件。属性后的 * 表示必填；“动态”属性接受 `=表达式`。`bind`、事件名和 `id` 使用单独的结构规则。\n\n' +
  '| 组件 | 形态 | bind | 属性 | 事件 |\n| --- | --- | --- | --- | --- |\n' + rows.join('\n') +
  '\n\n完整源文档见 [examples](../examples)。地图与小游戏不在当前范围。\n';
await mkdir('docs', { recursive: true });
await writeFile('docs/components.md', text);
await writeFile('dist-library/components.json', JSON.stringify(manifest, null, 2) + '\n');
console.log(`Generated reference and manifest for ${manifest.length} components.`);
