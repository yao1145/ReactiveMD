import {describe,it,expect} from 'vitest';
import {shareCompiledData} from '../src/local/shared-data';
describe('persistent compiled-data publication',()=>{
  it('retains unchanged subtrees without mutating older snapshots',()=>{
    const first={nodes:[{id:'a',range:{start:0,end:3},value:'one'},{id:'b',range:{start:5,end:8},value:'two'}],source:'one\n\ntwo'};
    const second=shareCompiledData(first,{nodes:[{id:'a',range:{start:0,end:3},value:'one'},{id:'b',range:{start:5,end:8},value:'new'}],source:'one\n\nnew'});
    expect(second.value.nodes[0]).toBe(first.nodes[0]);expect(second.value.nodes[1]).not.toBe(first.nodes[1]);
    expect(first.nodes[1].value).toBe('two');
  });
  it('preserves prototype-named data keys and frozen metadata',()=>{
    const value=Object.fromEntries([['__proto__',Object.freeze({safe:true})]]);
    const result=shareCompiledData(undefined,value).value;
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(Object.hasOwn(result,'__proto__')).toBe(true);expect(Object.isFrozen(result.__proto__)).toBe(true);
  });
});
