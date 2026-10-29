import {expect,it} from 'vitest';
import {SourcePositionIndex} from '../src/editor/source-positions';

it.each(['','abc','one\ntwo\n','\nfirst','a\r\nb\nc','a\rb','😀\nx😀y'])('indexes LF/UTF16 positions in %j',source=>{
  const index=new SourcePositionIndex(source);
  for(let at=0;at<=source.length;at++){
    const prefix=source.slice(0,at),line=prefix.split('\n').length;
    const column=at-(prefix.lastIndexOf('\n')+1)+1;
    expect(index.position(at)).toEqual({line,column});
  }
  expect(index.position(-10)).toEqual({line:1,column:1});
  expect(index.position(source.length+10)).toEqual(index.position(source.length));
});

it('reuses the index across many reference lookups',()=>{
  const index=new SourcePositionIndex('x\n'.repeat(10000));
  for(let line=1;line<=10000;line++)expect(index.position((line-1)*2)).toEqual({line,column:1});
});
