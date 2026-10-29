import {expect,it} from 'vitest';
import {SourceCoordinates} from '../src/editor/codemirror/source-coordinates';

it.each(['','text','a\nb','a\r\nb','a\rb','\ufeff😀\r\nx\ny\rz'])('maps original UTF16 positions for %j',source=>{
  const map=new SourceCoordinates(source);
  expect(map.text).toBe(source.replace(/\r\n?/g,'\n'));
  for(let view=0;view<=map.text.length;view++)expect(map.toView(map.toSource(view))).toBe(view);
  expect(map.toSource(-20)).toBe(0);expect(map.toSource(1e9)).toBe(source.length);
  expect(map.toView(1e9)).toBe(map.text.length);
});
it('uses a left bias inside CRLF and retains BOM/emoji',()=>{
  const map=new SourceCoordinates('\ufeff😀\r\nx');
  expect(map.toView(3)).toBe(3);expect(map.toView(4)).toBe(3);expect(map.toView(5)).toBe(4);
  expect(map.toSource(4)).toBe(5);
});
it('preserves untouched mixed line endings and returns original-source edits',()=>{
  const map=new SourceCoordinates('a\r\nb\nc\rd');
  expect(map.preferredLineBreak).toBe('\r\n');
  expect(map.apply([{from:2,to:3,insert:'B\nX'},{from:6,to:7,insert:'D'}])).toEqual({
    source:'a\r\nB\r\nX\nc\rD',changes:[{from:3,to:4,insert:'B\r\nX'},{from:7,to:8,insert:'D'}],
  });
});
it('deletes complete CRLF breaks, and orders same-position insertions',()=>{
  expect(new SourceCoordinates('a\r\nb').apply([{from:1,to:2,insert:''}]).source).toBe('ab');
  expect(new SourceCoordinates('').apply([{from:0,to:0,insert:'a'},{from:0,to:0,insert:'b'}]).source).toBe('ab');
});
it.each([{changes:[{from:-1,to:1,insert:''}]},{changes:[{from:0,to:20,insert:''}]},{changes:[{from:0.5,to:1,insert:''}]},
  {changes:[{from:1,to:3,insert:''},{from:2,to:3,insert:''}]}])('rejects invalid edits %j',({changes})=>{
  expect(()=>new SourceCoordinates('abcd').apply(changes)).toThrow();
});
it('retains the preferred break after deleting the final newline',()=>{
  const original=new SourceCoordinates('a\r\nb');
  const next=new SourceCoordinates(original.apply([{from:1,to:2,insert:''}]).source,original.preferredLineBreak);
  expect(next.apply([{from:1,to:1,insert:'\n'}]).source).toBe('a\r\nb');
});
