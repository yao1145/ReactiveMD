import type {EditorSelection} from './command-types';

/** Text operations shared by the toolbar and authoring tools. */
export interface EditorSurface {
  read(): {value:string;selection:EditorSelection};
  element(): HTMLElement | null;
  subscribe(listener:()=>void):()=>void;
  listenKeyDown(listener:(event:KeyboardEvent)=>void):()=>void;
}
