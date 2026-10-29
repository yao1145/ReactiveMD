import type {LocalCompileResult} from './types';

export interface SharedDataResult<T>{value:T;reused:number;created:number}
const ordinaryObjects=new WeakSet<object>();
/** Persistent plain-data publication. Neither input nor any prior revision is mutated. */
export function shareCompiledData<T>(previous:T|undefined,next:T):SharedDataResult<T> {
  let reused=0,created=0;
  const seen=new WeakMap<object,unknown>();
  const visit=(before:unknown,after:unknown):unknown=>{
    if(after===null||typeof after!=='object')return after;
    if(before===after){reused++;return before;}
    if(before===undefined&&ordinaryObjects.has(after)){reused++;return after;}
    if(seen.has(after))return seen.get(after);
    const array=Array.isArray(after);
    const comparable=before!==null&&typeof before==='object'&&Array.isArray(before)===array;
    const old=comparable?before as Record<string,unknown>:undefined;
    const keys=Object.keys(after),oldKeys=old?Object.keys(old):[];
    const output:Record<string,unknown>=array?[] as unknown as Record<string,unknown>:{};
    seen.set(after,output);
    // A source insertion can change node numbering. Prefer stable node ids
    // while still comparing all published fields before sharing an object.
    const byId=array&&Array.isArray(before)?new Map(before.filter(n=>n&&typeof n==='object'&&typeof n.id==='string').map(n=>[n.id,n])):undefined;
    let equal=!!old&&keys.length===oldKeys.length;
    for(const key of keys) {
      const child=(after as Record<string,unknown>)[key];
      const prior=byId&&child&&typeof child==='object'&&typeof (child as {id?:unknown}).id==='string'
        ?byId.get((child as {id:string}).id):old?.[key];
      const value=visit(prior,child);
      Object.defineProperty(output,key,{value,enumerable:true,writable:true,configurable:true});
      if(!old||!Object.hasOwn(old,key)||old[key]!==value)equal=false;
    }
    if(equal){seen.set(after,before);reused++;return before;}
    created++;
    const result=Object.isFrozen(after)?Object.freeze(output):output;
    ordinaryObjects.add(result);
    seen.set(after,result);return result;
  };
  return {value:visit(previous,next) as T,reused,created};
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
