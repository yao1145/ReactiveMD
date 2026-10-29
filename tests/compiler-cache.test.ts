import {describe,expect,it} from 'vitest';
import {LocalSemanticCache} from '../src/local/compiler-cache';
import {compileLocal,compileLocalTracked} from '../src/local/compiler';

describe('dependency-keyed semantic reuse',()=>{
  it('reuses expression and inference when only unrelated bindings or initial values change',()=>{
    const cache=new LocalSemanticCache();cache.begin('same');
    const expression=cache.expression('n * 2');
    expect(cache.infer(expression,{n:'number',other:'boolean'})).toBe('number');
    cache.begin('same');expect(cache.expression('n * 2')).toBe(expression);
    expect(cache.infer(expression,{n:'number',other:'string'})).toBe('number');
    expect(cache.stats).toMatchObject({expressionsCompiled:0,expressionsReused:1,typesInferred:0,typesReused:1});
    expect(()=>cache.infer(expression,{n:'string'})).toThrow();
    cache.begin('changed');cache.expression('n * 2');cache.infer(expression,{n:'number'});
    expect(cache.stats).toMatchObject({expressionsCompiled:1,typesInferred:1,typesReused:0});
  });
  it('bounds retained products',()=>{
    const cache=new LocalSemanticCache(5);cache.begin('one');
    for(let n=0;n<30;n++)cache.expression(`n + ${n}`);
    expect(cache.stats.entries).toBe(5);cache.clear();expect(cache.stats.entries).toBe(0);
  });
  it('keeps full semantics, current diagnostic offsets and option invalidation',()=>{
    const semantic=new LocalSemanticCache();
    const source=(value:string)=>`<slider bind="n" label="N" initial="${value}">\n\n<computed name="twice" value="{{ n * 2 }}">\n\nValue {{ twice }}\n\n$$x^2$$`;
    const services={semantic};
    for(const text of [source('2'),source('3'),'Introduction\n\n'+source('3'),source('4').replace('twice }}','missing }}')]) {
      expect(compileLocalTracked(text,undefined,services).result).toEqual(compileLocal(text));
    }
    const tracked=compileLocalTracked(source('5'),undefined,services);
    expect(tracked.semantic).toMatchObject({expressionsCompiled:0});
    expect(tracked.semantic!.expressionsReused).toBeGreaterThan(0);
    expect(compileLocalTracked(source('5'),{markdownBreaks:true},services).result).toEqual(compileLocal(source('5'),{markdownBreaks:true}));
  });
  it('invalidates only changed binding groups and still checks conflicting owners',()=>{
    const semantic=new LocalSemanticCache();
    const source=(a:number,b:number)=>`<slider bind="a" label="A" initial="${a}">\n<slider bind="b" label="B" initial="${b}">\n\n{{ a + b }}`;
    compileLocalTracked(source(1,2),undefined,{semantic});
    const next=compileLocalTracked(source(3,2),undefined,{semantic});
    expect(next.result).toEqual(compileLocal(source(3,2)));
    expect(next.semantic).toMatchObject({bindingsResolved:1,bindingsReused:1,typesReused:1});
    const conflict=source(3,2).replace('bind="b"','bind="a"');
    expect(compileLocalTracked(conflict,undefined,{semantic}).result).toEqual(compileLocal(conflict));
  });
});
