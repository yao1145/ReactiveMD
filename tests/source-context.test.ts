import {describe, expect, it} from 'vitest';
import {SourceContext, MappedSource} from '../src/local/source-context';

describe('source indexing and segmented mappings', () => {
  it('keeps LF diagnostic coordinates and seeks non-monotonically', () => {
    const context = new SourceContext('one\r\ntwo\rthree\nlast');
    expect(context.lineStarts).toEqual([0, 5, 15]);
    expect(context.logicalLineCount).toBe(4);
    expect([18, 0, 6, 14, 15].map(n => context.lineStartAt(n))).toEqual([15, 0, 5, 5, 15]);
  });
  it('matches dense mappings at source/generation/deletion boundaries and EOF', () => {
    const source = '\ufeffone\n    two\n  three', context = new SourceContext(source);
    const mapped = new MappedSource(context);
    mapped.original(0, 5, 0, false, true);
    mapped.generated('MARK', 5);
    mapped.original(5, source.length, 4);
    mapped.finish(source.length);
    expect(mapped.text()).toBe('one\nMARKtwo\nthree');
    const dense = [1,2,3,4,5,5,5,5,9,10,11,12,15,16,17,18,19,20];
    expect(Array.from({length: mapped.length + 1}, (_,n)=>mapped.at(n, -1))).toEqual(dense);
    expect(mapped.at(-1, -99)).toBe(-99);
    expect(mapped.at(999, -99)).toBe(-99);
    expect(mapped.segmentCount).toBeLessThan(6);
  });
  it('matches the old per-character dedent mapping across generated ranges', () => {
    let seed = 51;
    const next = (n: number) => {seed = (Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
    for(let trial=0;trial<150;trial++) {
      const source = '\ufeff' + Array.from({length:20},()=> ' '.repeat(next(7)) + 'abc🙂'.repeat(next(5)) + ['\n','\r\n','\r'][next(3)]).join('');
      const mapped = new MappedSource(new SourceContext(source)), dense: number[] = [];
      let text = '', from = 0;
      while(from<source.length) {
        const to = Math.min(source.length, from+1+next(20)), indent=next(5);
        mapped.original(from,to,indent,false,true);
        for(let i=from;i<to;i++) {
          if(i===0 && source.charCodeAt(i)===0xfeff)continue;
          const line=source.lastIndexOf('\n',i-1)+1;
          let skip=0;while(skip<indent && (source[line+skip]===' '||source[line+skip]==='\t'))skip++;
          if(indent && i<line+skip)continue;
          text+=source[i];dense.push(i);
        }
        if(next(3)===0){mapped.generated('!!',from);text+='!!';dense.push(from,from);}
        from=to;
      }
      mapped.finish(source.length);dense.push(source.length);
      expect(mapped.text()).toBe(text);
      // Parent/child transforms query positions in both directions.
      for(let i=dense.length-1;i>=0;i--)expect(mapped.at(i,-1)).toBe(dense[i]);
    }
  });
  it('maps an indented 200k character line with a constant number of segments', () => {
    const source='    '+'x'.repeat(200_000),mapped=new MappedSource(new SourceContext(source));
    mapped.original(0,source.length,4);mapped.finish(source.length);
    expect(mapped.text()).toBe('x'.repeat(200_000));
    expect(mapped.segmentCount).toBe(1);
  });
  it('uses complete physical quote prefixes even when append ranges split them', () => {
    const source='> >     text\r\n> >     next',mapped=new MappedSource(new SourceContext(source));
    for(let i=0;i<source.length;i++)mapped.original(i,i+1,4,true);
    mapped.finish(source.length);
    expect(mapped.text()).toBe('text\r\nnext');
    expect(mapped.at(6,-1)).toBe(source.indexOf('next'));
  });
});

describe('shared source facts', () => {
  it('counts physical lines and blockquote/list depth for LF, CRLF and CR', () => {
    for (const ending of ['\n', '\r\n', '\r']) {
      const source = ['# Heading', '', '> one', '> > two', '- item', '| a | b |', '| - | - |', '| 1 | 2 |'].join(ending);
      const facts = new SourceContext(source).facts;
      expect(facts.lines.length).toBe(8);
      expect(facts.lines.every(line => line.text.indexOf('\r') < 0 && line.text.indexOf('\n') < 0)).toBe(true);
      expect(facts.maxMarkdownDepth).toBe(2);
    }
  });

  it('tracks nested list levels by marker column, not by raw indentation', () => {
    const facts = new SourceContext('- a\n  - b\n    - c\n      - d').facts;
    expect(facts.maxMarkdownDepth).toBe(4);
    // A single deeply indented marker is indented code, not a real container.
    const single = new SourceContext(' '.repeat(4000) + '- x').facts;
    expect(single.maxMarkdownDepth).toBe(0);
  });

  it('never counts > or - inside fenced, indented or inline code as containers', () => {
    const source = [
      '```',
      '> '.repeat(1200) + 'quoted looking code',
      '- '.repeat(1200) + 'list looking code',
      '```',
      '',
      '    > indented code',
      '    - indented code',
      '',
      '`> ' + '> '.repeat(1200) + '`',
    ].join('\n');
    const facts = new SourceContext(source).facts;
    expect(facts.maxMarkdownDepth).toBe(0);
    expect(facts.fenceSpans.length).toBe(1);
    expect(facts.fenceSpans[0].from).toBe(0);
  });

  it('ignores a leading BOM when reading the first line', () => {
    const facts = new SourceContext('﻿> > quoted').facts;
    expect(facts.maxMarkdownDepth).toBe(2);
    expect(facts.lines[0].quoteDepth).toBe(2);
  });
});
