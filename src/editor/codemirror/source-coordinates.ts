export interface SourceChange {from:number;to:number;insert:string}

/** CM6 uses LF internally; public ranges always address untouched raw source. */
export class SourceCoordinates {
  readonly text:string;
  readonly preferredLineBreak:string;
  private readonly rawEnds:number[]=[];
  private readonly viewEnds:number[]=[];
  constructor(readonly source:string,preferredLineBreak?:string){
    const parts:string[]=[];let cursor=0,preferred='\n',seenBreak=false;
    for(let at=0;at<source.length;at++){
      if(source[at]==='\n'){if(!seenBreak){preferred='\n';seenBreak=true;}continue;}
      if(source[at]!=='\r')continue;
      const end=at+(source[at+1]==='\n'?2:1);
      if(!seenBreak){preferred=source.slice(at,end);seenBreak=true;}
      parts.push(source.slice(cursor,at),'\n');cursor=end;
      if(end-at===2){this.rawEnds.push(end);this.viewEnds.push(end-this.rawEnds.length);}
      at=end-1;
    }
    if(parts.length){parts.push(source.slice(cursor));this.text=parts.join('');}else this.text=source;
    this.preferredLineBreak=preferredLineBreak??preferred;
  }
  private before(ends:readonly number[],at:number):number{
    let low=0,high=ends.length;
    while(low<high){const middle=(low+high)>>>1;if(ends[middle]<=at)low=middle+1;else high=middle;}
    return low;
  }
  toView(offset:number):number{
    const at=Math.max(0,Math.min(this.source.length,Number.isFinite(offset)?Math.floor(offset):0));
    const count=this.before(this.rawEnds,at);
    if(this.rawEnds[count]===at+1)return this.viewEnds[count]-1;
    return at-count;
  }
  toSource(offset:number):number{
    const at=Math.max(0,Math.min(this.text.length,Number.isFinite(offset)?Math.floor(offset):0));
    return at+this.before(this.viewEnds,at);
  }
  apply(changes:readonly SourceChange[]):{source:string;changes:SourceChange[]}{
    const ordered=changes.map(change=>({...change})).sort((a,b)=>a.from-b.from||a.to-b.to);
    const raw:SourceChange[]=[];let previous=0;
    for(const change of ordered){
      if(!Number.isSafeInteger(change.from)||!Number.isSafeInteger(change.to)||change.from<previous||change.to<change.from||change.to>this.text.length||typeof change.insert!=='string')throw new RangeError('Invalid or overlapping source change');
      raw.push({from:this.toSource(change.from),to:this.toSource(change.to),insert:change.insert.replace(/\r\n|\r|\n/g,this.preferredLineBreak)});
      previous=change.to;
    }
    const pieces:string[]=[];let cursor=0;
    for(const change of raw){pieces.push(this.source.slice(cursor,change.from),change.insert);cursor=change.to;}
    pieces.push(this.source.slice(cursor));return{source:pieces.join(''),changes:raw};
  }
}
