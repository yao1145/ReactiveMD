import type {RefObject} from 'react';
import type {EditorSelection} from './command-types';

/** Text operations shared by native and virtualized editing surfaces. */
export interface EditorSurface {
  read(): {value:string;selection:EditorSelection};
  element(): HTMLElement | null;
  subscribe(listener:()=>void):()=>void;
  listenKeyDown(listener:(event:KeyboardEvent)=>void):()=>void;
}

export function createTextareaSurface(ref:RefObject<HTMLTextAreaElement|null>):EditorSurface {
  return {
    read(){
      const element=ref.current,value=element?.value??'';
      const start=Math.max(0,Math.min(element?.selectionStart??0,value.length));
      return{value,selection:{start,end:Math.max(start,Math.min(element?.selectionEnd??0,value.length))}};
    },
    element:()=>ref.current,
    subscribe(listener){
      const element=ref.current;if(!element)return()=>{};
      const events=['select','keyup','click','input','focus'] as const;
      for(const event of events)element.addEventListener(event,listener);
      const selection=()=>{if(document.activeElement===element)listener();};
      document.addEventListener('selectionchange',selection);
      return()=>{for(const event of events)element.removeEventListener(event,listener);document.removeEventListener('selectionchange',selection);};
    },
    listenKeyDown(listener){const element=ref.current;element?.addEventListener('keydown',listener,true);return()=>element?.removeEventListener('keydown',listener,true);},
  };
}
