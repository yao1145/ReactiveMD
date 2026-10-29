import type {LocalCompileResult,LocalNode} from './types';

/** Plain compiler data only: no executable values, class instances or cycles. */
type Primitive = string | number | boolean | null | undefined;
type Entry = [key:string,reference:number];
type RecordData = [0,Primitive] | [1,length:number,entries:Entry[]] | [2,entries:Entry[]];
export interface FlatCompiledData {version:'flat-v1';records:RecordData[]}
export const FLAT_COMPILED_DATA_PROTOCOL = 'flat-v1';

/** Keep ordinary documents on the existing result/patch transport. */
export function needsFlatCompileResult(result:LocalCompileResult):boolean {
  if(!result.ok)return false;
  const pending:{node:LocalNode;depth:number}[]=result.document.nodes.map(node=>({node,depth:0}));
  while(pending.length){
    const {node,depth}=pending.pop()!;
    if(depth>=100)return true;
    if(node.children)for(const child of node.children)pending.push({node:child,depth:depth+1});
  }
  return false;
}

/** Flat record references keep structured clone depth constant, even on older V8. */
export function encodeFlatCompiledData(value:unknown):FlatCompiledData {
  const records:RecordData[]=[],seen=new Map<object,number>();
  const pending:{value:object;record:RecordData}[]=[];
  const reference=(item:unknown):number=>{
    if(item!==null&&typeof item==='object'){
      const existing=seen.get(item);if(existing!==undefined)return existing;
      const index=records.length;
      const record:RecordData=Array.isArray(item)?[1,item.length,[]]:[2,[]];
      seen.set(item,index);records.push(record);pending.push({value:item,record});return index;
    }
    if(item!==null&&!['string','number','boolean','undefined'].includes(typeof item))throw new TypeError('Unsupported compiler wire value');
    const index=records.length;records.push([0,item as Primitive]);return index;
  };
  reference(value);
  while(pending.length){
    const {value:input,record}=pending.pop()!;
    const entries=record[0]===1?record[2]:record[1] as Entry[];
    for(const key of Object.keys(input))entries.push([key,reference((input as Record<string,unknown>)[key])]);
  }
  return {version:FLAT_COMPILED_DATA_PROTOCOL,records};
}

/** Reject malformed graphs before publishing any decoded result. */
export function decodeFlatCompiledData(value:unknown):unknown|null {
  if(!value||typeof value!=='object')return null;
  const wire=value as Partial<FlatCompiledData>;
  if(wire.version!==FLAT_COMPILED_DATA_PROTOCOL||!Array.isArray(wire.records)
    ||wire.records.length===0||wire.records.length>2_000_000)return null;
  const records=wire.records,output:unknown[]=new Array(records.length),edges:number[][]=new Array(records.length);
  let properties=0;
  for(let i=0;i<records.length;i++){
    const record=records[i];
    if(!Array.isArray(record))return null;
    if(record[0]===0){
      if(record.length!==2||(record[1]!==null&&!['string','number','boolean','undefined'].includes(typeof record[1])))return null;
      output[i]=record[1];edges[i]=[];continue;
    }
    const array=record[0]===1;
    if(!array&&record[0]!==2)return null;
    if(record.length!==(array?3:2))return null;
    if(array&&(!Number.isSafeInteger(record[1])||(record[1] as number)<0||(record[1] as number)>1_000_000))return null;
    const entries=array?record[2]:record[1];
    if(!Array.isArray(entries))return null;
    const keys=new Set<string>(),references:number[]=[];
    for(const entry of entries){
      if(!Array.isArray(entry)||entry.length!==2||typeof entry[0]!=='string'
        ||!Number.isSafeInteger(entry[1])||entry[1]<0||entry[1]>=records.length||keys.has(entry[0]))return null;
      if(array&&(entry[0]==='length'||! /^(0|[1-9][0-9]*)$/.test(entry[0])||Number(entry[0])>=(record[1] as number)))return null;
      keys.add(entry[0]);references.push(entry[1]);
      if(++properties>4_000_000)return null;
    }
    output[i]=array?new Array(record[1] as number):{};edges[i]=references;
  }
  // A forged cyclic graph would make downstream syntax-tree walkers loop.
  const state=new Uint8Array(records.length),stack=[{index:0,child:0}];
  state[0]=1;let visited=1;
  while(stack.length){
    const frame=stack[stack.length-1],children=edges[frame.index];
    if(frame.child===children.length){state[frame.index]=2;stack.pop();continue;}
    const index=children[frame.child++];
    if(state[index]===1)return null;
    if(state[index]===0){state[index]=1;visited++;stack.push({index,child:0});}
  }
  if(visited!==records.length)return null;
  for(let i=0;i<records.length;i++){
    const record=records[i];if(record[0]===0)continue;
    const entries=record[0]===1?record[2]:record[1];
    for(const [key,index]of entries)Object.defineProperty(output[i],key,{value:output[index],enumerable:true,writable:true,configurable:true});
  }
  return output[0];
}
