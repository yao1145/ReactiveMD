import type {LocalNode} from './types';

/** Ordered traversal with memory proportional to depth, independent of JS stack. */
export function* walkLocalNodes(nodes:readonly LocalNode[],postorder=false):Generator<LocalNode> {
  const stack:{nodes:readonly LocalNode[];index:number;owner?:LocalNode}[]=[{nodes,index:0}];
  while(stack.length){
    const frame=stack[stack.length-1];
    if(frame.index===frame.nodes.length){
      stack.pop();if(postorder&&frame.owner)yield frame.owner;
      continue;
    }
    const node=frame.nodes[frame.index++];
    if(!postorder)yield node;
    if(node.children?.length)stack.push({nodes:node.children,index:0,owner:node});
    else if(postorder)yield node;
  }
}
