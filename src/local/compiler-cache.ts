import {compileExpression,type LocalExpression} from './expression';
import {compileLatex,type LatexExpression} from './math';
import {inspectLocalMathDisplay} from './math-display';
import type {LocalValueKind,LocalMathDisplayIssue} from './types';

export interface SemanticCacheStats {
  expressionsCompiled:number; expressionsReused:number;
  typesInferred:number; typesReused:number;
  attributesValidated:number; attributesReused:number;
  bindingsResolved:number;bindingsReused:number;
  formulasCompiled:number; formulasReused:number;
  displaysInspected:number; displaysReused:number;
  entries:number;
}
const counters=():Omit<SemanticCacheStats,'entries'>=>({expressionsCompiled:0,expressionsReused:0,typesInferred:0,typesReused:0,attributesValidated:0,attributesReused:0,bindingsResolved:0,bindingsReused:0,formulasCompiled:0,formulasReused:0,displaysInspected:0,displaysReused:0});

/** Session-owned successful semantic products; no source-position diagnostics. */
export class LocalSemanticCache {
  private key:string|undefined;
  private values=new Map<string,unknown>();
  private weight=0;
  private counts=counters();
  constructor(private readonly capacity=16384,private readonly maxWeight=8_000_000){}
  begin(key:string):void {if(this.key!==key){this.clear();this.key=key;}this.counts=counters();}
  get stats():SemanticCacheStats{return {...this.counts,entries:this.values.size};}
  clear():void {this.values.clear();this.weight=0;this.key=undefined;this.counts=counters();}
  private get<T>(key:string):T|undefined {
    const value=this.values.get(key);
    if(value!==undefined){this.values.delete(key);this.values.set(key,value);}
    return value as T|undefined;
  }
  private put(key:string,value:unknown):void {
    const cost=key.length+128;
    if(cost>this.maxWeight)return;
    if(this.values.has(key)){this.values.delete(key);this.weight-=cost;}
    this.values.set(key,value);this.weight+=cost;
    while(this.values.size>this.capacity||this.weight>this.maxWeight) {
      const oldest=this.values.keys().next().value!;
      this.values.delete(oldest);this.weight-=oldest.length+128;
    }
  }
  expression(source:string):LocalExpression {
    const key='expression:'+source,cached=this.get<LocalExpression>(key);
    if(cached){this.counts.expressionsReused++;return cached;}
    const value=compileExpression(source);this.counts.expressionsCompiled++;this.put(key,value);return value;
  }
  infer(expression:LocalExpression,environment:Record<string,LocalValueKind>):LocalValueKind {
    // Only the types of actual free variables affect inference. Unrelated
    // declarations and changed initial values do not invalidate this product.
    const signature=expression.dependencies.map(name=>[name,Object.hasOwn(environment,name)?environment[name]:null]);
    const key='type:'+JSON.stringify([expression.source,signature]),cached=this.get<LocalValueKind>(key);
    if(cached!==undefined){this.counts.typesReused++;return cached;}
    const value=expression.inferType(environment);this.counts.typesInferred++;this.put(key,value);return value;
  }
  attributes<T>(key:string):{value:T;origin:number}|undefined {
    const cached=this.get<{value:T;origin:number}>('attributes:'+key);
    if(cached)this.counts.attributesReused++;
    else this.counts.attributesValidated++;
    return cached;
  }
  rememberAttributes(key:string,origin:number,value:unknown):void {this.put('attributes:'+key,{origin,value});}
  binding<T>(key:string):T|undefined {
    const cached=this.get<T>('binding:'+key);
    if(cached!==undefined)this.counts.bindingsReused++;else this.counts.bindingsResolved++;
    return cached;
  }
  rememberBinding(key:string,value:unknown):void {this.put('binding:'+key,value);}
  latex(source:string):LatexExpression {
    const key='latex:'+source,cached=this.get<LatexExpression>(key);
    if(cached){this.counts.formulasReused++;return cached;}
    const value=compileLatex(source);this.counts.formulasCompiled++;this.put(key,value);return value;
  }
  display(source:string,block:boolean):LocalMathDisplayIssue[] {
    const key='display:'+JSON.stringify([source,block]),cached=this.get<LocalMathDisplayIssue[]>(key);
    if(cached){this.counts.displaysReused++;return cached;}
    const value=inspectLocalMathDisplay(source,block);this.counts.displaysInspected++;this.put(key,value);return value;
  }
}
