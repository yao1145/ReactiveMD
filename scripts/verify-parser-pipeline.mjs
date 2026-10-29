import assert from 'node:assert/strict';
import {readdir,readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {compileLocal} from 'reactive-md';

const args=process.argv.slice(2),option=(name,fallback)=>args.includes(name)?args[args.indexOf(name)+1]:fallback;
const baseline=resolve(option('--before','artifacts/parser-pipeline/before/reactive-md.js'));
const {compileLocal:before}=await import(pathToFileURL(baseline).href);
const sources=[];
async function collect(directory) {
  for(const entry of await readdir(directory,{withFileTypes:true})) {
    const path=`${directory}/${entry.name}`;
    if(entry.isDirectory())await collect(path);
    else if(path.endsWith('.md'))sources.push([path,await readFile(path,'utf8')]);
  }
}
await collect('examples/local');
const blocks=[
  'Plain words.', '- One\n- **two**', '3) One\n4) two', '- One\n\n- Two',
  '|A|B|\n|:-|-:|\n|one|two|', '|A|\n|-|', '|A|B|\n|-|-|\n|one|',
  '[link](/path)', '[link][ref]', '[ref]: /path', 'note[^n]', '[^n]: Note\n\n    Continued',
  '```md\n- inert\n\n<slider>\n```', '~~~\n|A|\n|-|\n~~~', '    - code\n    code',
  '> Quoted\n>\n> - One\n> - Two', '> [^n]: Note\n>\n>     Continued',
  '<panel>\n\n- One\n- Two\n\n</panel>', '<panel>\n    Before\n\n    [^n]: note\n\n    |A|\n    |-|\n</panel>',
  '<slider bind="n" label="N" initial="2">', '{{ n }}', '<!-- comment -->', '$x^2$',
  '<table label="Data">\n| A | B |\n| - | - |\n| text | {{ n }} |\n</table>',
  '<div>\n\n- item\n\n</div>', '<!--\n\n- still comment\n\n-->',
  'A \\*literal\\* and &amp; entity.', '# Heading', 'title\n---', 'one\ntwo',
];
let seed=0x7752031;
const next=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
for(let i=0;i<600;i++) {
  const ending=['\n','\r\n','\r'][next(3)];
  let source=Array.from({length:1+next(8)},()=>blocks[next(blocks.length)]).join(next(4)?'\n\n':'\n');
  source=source.replace(/\n/g,ending);if(i%17===0)source='\ufeff'+source;
  sources.push([`mixed-${i}`,source]);
}
const editing='<slider bind="n" label="N">\n\n<panel>\n    - One\n    - Two\n\n    [text](/path)\n\n    |A|B|\n    |-|-|\n    |x|{{ n }}|\n</panel>\n\n[^n]: Note\n\n    Continued';
for(let i=0;i<=editing.length;i++)sources.push([`prefix-${i}`,editing.slice(0,i)]);
for(const first of blocks)for(const second of blocks)sources.push(['pair',first+'\n\n'+second]);
const output=resolve(option('--output','artifacts/parser-pipeline/equivalence.json'));await mkdir(resolve(output,'..'),{recursive:true});
let checks=0;
for(const [name,source] of sources)for(const options of [undefined,{markdownBreaks:true},{limits:{maxSyntaxNodes:3}},{limits:{maxSyntaxNodes:12}}]) {
  const actual=compileLocal(source,options),expected=before(source,options);
  try{assert.deepEqual(actual,expected);}catch(error) {
    await writeFile(resolve(output,'../equivalence-failure.json'),JSON.stringify({name,source,options,actual,expected},null,2));throw error;
  }
  checks++;
}
const report={generatedAt:new Date().toISOString(),baseline,documents:sources.length,checks,result:'equal'};
await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
