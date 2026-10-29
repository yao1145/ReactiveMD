import type {LocalCompileResult} from './types';

export interface SharedDataResult<T>{value:T;reused:number;created:number}
const ordinaryObjects=new WeakSet<object>();
/** Persistent plain-data publication. Neither input nor any prior revision is mutated. */
export function shareCompiledData<T>(previous:T|undefined,next:T):SharedDataResult<T> {
  let reused=0,created=0;
  const seen=new WeakMap<object,unknown>();
  interface Frame {
    before: unknown; after: object; old?: Record<string,unknown>;
    keys: string[]; index: number; output: Record<string,unknown>; equal: boolean;
    byId?: Map<string,unknown>; parent?: Frame; key?: string;
  }
  const pending:Frame[]=[];
  const assign=(parent:Frame|undefined,key:string|undefined,value:unknown)=>{
    if(!parent)return;
    Object.defineProperty(parent.output,key!,{value,enumerable:true,writable:true,configurable:true});
    if(!parent.old||!Object.hasOwn(parent.old,key!)||parent.old[key!]!==value)parent.equal=false;
  };
  const begin=(before:unknown,after:unknown,parent?:Frame,key?:string):unknown=>{
    if(after===null||typeof after!=='object')return after;
    if(before===after){reused++;return before;}
    if(before===undefined&&ordinaryObjects.has(after)){reused++;return after;}
    if(seen.has(after))return seen.get(after);
    const array=Array.isArray(after);
    const comparable=before!==null&&typeof before==='object'&&Array.isArray(before)===array;
    const old=comparable?before as Record<string,unknown>:undefined;
    const keys=Object.keys(after),oldKeys=old?Object.keys(old):[];
    const output:Record<string,unknown>=array?new Array((after as unknown[]).length) as unknown as Record<string,unknown>:{};
    seen.set(after,output);
    // A source insertion can change node numbering. Prefer stable node ids
    // while still comparing all published fields before sharing an object.
    const byId=array&&Array.isArray(before)?new Map(before.filter(n=>n&&typeof n==='object'&&typeof n.id==='string').map(n=>[n.id,n])):undefined;
    const equal=!!old&&keys.length===oldKeys.length&&(!array||(before as unknown[]).length===(after as unknown[]).length);
    pending.push({before,after,old,keys,index:0,output,equal,byId,parent,key});
    return output;
  };
  let value=begin(previous,next);
  while(pending.length){
    const frame=pending[pending.length-1];
    if(frame.index<frame.keys.length){
      const key=frame.keys[frame.index++],child=(frame.after as Record<string,unknown>)[key];
      const prior=frame.byId&&child&&typeof child==='object'&&typeof (child as {id?:unknown}).id==='string'
        ?frame.byId.get((child as {id:string}).id):frame.old?.[key];
      const depth=pending.length,result=begin(prior,child,frame,key);
      if(pending.length===depth)assign(frame,key,result);
      continue;
    }
    pending.pop();
    let result:unknown;
    if(frame.equal){result=frame.before;reused++;}
    else{
      created++;
      result=Object.isFrozen(frame.after)?Object.freeze(frame.output):frame.output;
      ordinaryObjects.add(result as object);
    }
    seen.set(frame.after,result);
    if(frame.parent)assign(frame.parent,frame.key,result);
    else value=result;
  }
  return {value:value as T,reused,created};
}

/** Lightweight identity index for diagnostics/benchmarking, without publishing it. */
export function countSharedNodes(previous:LocalCompileResult|null,next:LocalCompileResult):number {
  if(!previous?.ok||!next.ok)return 0;
  const old=new Set<object>(),stack=[...previous.document.nodes];
  while(stack.length){const node=stack.pop()!;old.add(node);if(node.children)stack.push(...node.children);}
  let count=0;const current=[...next.document.nodes];
  while(current.length){const node=current.pop()!;if(old.has(node))count++;if(node.children)current.push(...node.children);}
  return count;
}
