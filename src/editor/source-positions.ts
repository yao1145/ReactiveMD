/** One LF index per source revision. Positions use original-source UTF-16 units. */
export class SourcePositionIndex {
  private readonly starts=[0];
  constructor(private readonly source:string){
    for(let at=0;at<source.length;at++)if(source.charCodeAt(at)===10)this.starts.push(at+1);
  }
  position(offset:number):{line:number;column:number}{
    const at=Math.max(0,Math.min(this.source.length,Number.isFinite(offset)?Math.floor(offset):0));
    let low=0,high=this.starts.length;
    while(low+1<high){const middle=(low+high)>>>1;if(this.starts[middle]<=at)low=middle;else high=middle;}
    return{line:low+1,column:at-this.starts[low]+1};
  }
}
