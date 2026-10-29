import {describe,expect,it} from 'vitest';
import {encodeFlatCompiledData,decodeFlatCompiledData} from '../src/local/flat-compiled-data';

describe('flat compiler transport',()=>{
  it('round trips 6000 levels and aliases through a shallow structured clone',()=>{
    const shared={missing:undefined,value:'leaf'};
    let root:any=shared;
    for(let i=0;i<6000;i++)root={children:[root]};
    const wire=encodeFlatCompiledData({root,shared,alias:shared});
    const result=decodeFlatCompiledData(structuredClone(wire)) as any;
    expect(result.shared).toBe(result.alias);
    for(let i=0;i<6000;i++)result.root=result.root.children[0];
    expect(result.root).toBe(result.shared);
    expect(Object.hasOwn(result.shared,'missing')).toBe(true);
  });
  it('keeps prototype-named keys as own data and sparse array lengths',()=>{
    const array=new Array(5);array[2]='two';
    const source=Object.fromEntries([['__proto__',{safe:true}],['array',array]]);
    const result=decodeFlatCompiledData(encodeFlatCompiledData(source)) as any;
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
    expect(Object.hasOwn(result,'__proto__')).toBe(true);
    expect(result.__proto__.safe).toBe(true);
    expect(result.array.length).toBe(5);expect(0 in result.array).toBe(false);
  });
  it('rejects malformed references, cycles, duplicate keys and invalid lengths',()=>{
    for(const records of [
      [[2,[['x',1]]]],
      [[2,[['x',0]]]],
      [[2,[['x',1],['x',1]]],[0,1]],
      [[1,-1,[]]],
      [[1,2,[['length',1]]],[0,1]],
      [[0,{}]],
    ])expect(decodeFlatCompiledData({version:'flat-v1',records})).toBe(null);
  });
});
