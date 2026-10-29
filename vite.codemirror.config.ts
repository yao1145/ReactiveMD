import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';
export default defineConfig({
  worker:{format:'es'},
  build:{outDir:'dist-library',emptyOutDir:false,lib:{
    entry:fileURLToPath(new URL('./src/editor/codemirror/library.ts',import.meta.url)),
    formats:['es'],fileName:()=> 'reactive-md-codemirror.js',cssFileName:'reactive-md-codemirror',
  },rolldownOptions:{external:['react','react-dom','react/jsx-runtime','reactive-md','reactive-md/editor']}},
});
