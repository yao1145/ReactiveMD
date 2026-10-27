import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LocalReactiveDocument } from 'reactive-md/react';
import 'reactive-md/styles.css';

const JS = 'const greeting = "Hello <world>";\n// Keep spaces and newlines\nconsole.log(greeting);';
const languageCases = [
  ['latex', String.raw`\begin{aligned}x&=\frac{a}{b}\end{aligned}`],
  ['tex', String.raw`\ce{2 H2 + O2 -> 2 H2O}`],
  ['cattca', '# Story\n</let hp = 100; if hp > 0 -> goto start;/>'],
  ['mermaid', 'flowchart TD\n  A[Start] --> B[End]'],
  ['jinja', '{% for user in users %}{{ user.name }}{% endfor %}'],
  ['dockerfile', 'FROM node:22\nWORKDIR /app\nRUN npm ci'],
  ['vue', '<template><p>{{ count + 1 }}</p></template>\n<script setup lang="ts">const count: number = 1;</script>\n<style scoped>p { color: red; }</style>'],
  ['', JS],
];
const source = [
  '# Code and pictures',
  'Inline `const plain = true` stays inline.',
  '```js\n' + JS + '\n```',
  '```python\ndef greet(name):\n    return "Hello " + name\n```',
  '```json\n{"count": 2, "ready": true}\n```',
  '```unknown-language\n<script>window.codeExecuted = true</script>\n```',
  '```\nplain <text> & symbols\n```',
  ...languageCases.map(([language, code]) => '```' + language + '\n' + code + '\n```'),
  '![Landscape illustration](/fixture-image.svg "Example landscape")',
  '[![Linked landscape](/fixture-image.svg)](#destination)',
  '## Destination',
].join('\n\n');
const allowImages = (_url: string, kind: 'image' | 'link') => kind === 'link' || _url === '/fixture-image.svg';

declare global { interface Window { mediaHarness: { replace(): void; setStatic(value: boolean): void; code: string }; codeExecuted?: boolean } }
function App() {
  const [value, setValue] = useState(source);
  const [mode, setMode] = useState<'interactive' | 'static'>('interactive');
  const params = new URLSearchParams(location.search);
  const locale = params.get('locale') === 'zh' ? 'zh' : 'en';
  const colorScheme = params.get('theme') === 'dark' ? 'dark' : 'light';
  window.mediaHarness = { replace() { setValue('# Replaced document'); }, setStatic(value) { setMode(value ? 'static' : 'interactive'); }, code: JS };
  return <>
    <div id="primary"><LocalReactiveDocument source={value} mode={mode} locale={locale} colorScheme={colorScheme} urlPolicy={allowImages} /></div>
    <div id="static"><LocalReactiveDocument source={source} mode="static" locale={locale} colorScheme={colorScheme} urlPolicy={allowImages} /></div>
    <div id="denied"><LocalReactiveDocument source={'![Blocked picture](/fixture-image.svg)\n\n![Unsafe](javascript:alert%281%29)'} /></div>
  </>;
}
createRoot(document.getElementById('root')!).render(<App />);
