import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it} from 'vitest';
import {ReactiveMarkdownEditor,type ReactiveMarkdownEditorProps} from '../src/editor';
import {ReactiveMarkdownCodeEditor} from '../src/editor/codemirror';
const render=(props:Partial<ReactiveMarkdownEditorProps>={})=>renderToStaticMarkup(
  <ReactiveMarkdownEditor value="hello" onChange={()=>{}} authoring={false} {...props}/>);
describe('CM6 public editor contract',()=>{
  it('uses one implementation through both entry names',()=>{
    expect(ReactiveMarkdownEditor).toBe(ReactiveMarkdownCodeEditor);
    expect((ReactiveMarkdownEditor as unknown as {$$typeof:symbol}).$$typeof).toBe(Symbol.for('react.forward_ref'));
  });
  it('renders a server-safe frame without textarea or a full-text mirror',()=>{
    const html=render();
    expect(html).toContain('reactive-md-editor rmd-cm6');expect(html).toContain('rmd-cm6-host');
    expect(html).toContain('height:560px');expect(html).toContain('min-height:280px');
    expect(html).not.toMatch(/<textarea|editor-mirror|author-highlight|editor-gutter/);expect(html).not.toContain('source-authoring');
  });
  it('turns authoring and toolbar off independently',()=>{
    expect(render({toolbar:false,authoring:true})).toContain('source-authoring');
    expect(render({toolbar:false})).not.toContain('class="editor-toolbar"');expect(render({toolbar:false})).not.toContain('source-authoring');
  });
  it('keeps source identifiers, locale and theme scoped per instance',()=>{
    const html=render({id:'my-source',locale:'zh',theme:'dark'});
    expect(html).toContain('id="my-source-source"');expect(html).toContain('lang="zh-CN"');expect(html).toContain('data-editor-theme="dark"');
    expect(html).toContain('文档编辑工具栏');
    const pair=renderToStaticMarkup(<><ReactiveMarkdownEditor value="a" onChange={()=>{}} theme="light"/><ReactiveMarkdownEditor value="b" onChange={()=>{}} theme="dark"/></>);
    const ids=[...pair.matchAll(/id="([^"]+-source)"/g)].map(match=>match[1]);expect(new Set(ids).size).toBe(2);
  });
  it('server-renders host preview and view controls',()=>{
    const html=render({preview:<p>Preview content</p>,defaultViewMode:'split',locale:'zh'});
    expect(html).toContain('data-editor-view="split"');expect(html).toContain('Preview content');expect(html).toContain('并排');
    expect(render({viewMode:'preview'})).toContain('data-editor-view="edit"');
  });
  it('never interprets source as HTML during SSR',()=>{
    expect(render({value:'<img src=x onerror="alert(1)"><script>alert(2)</script>'})).not.toMatch(/<img|<script/);
  });
  it('preserves disabled frame semantics and sizing',()=>{
    const html=render({readOnly:true,disabled:true,height:480,minHeight:'300px'});
    expect(html).toContain('inert=""');expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('height:480px');expect(html).toContain('min-height:300px');
  });
  it('only exports on a host action',()=>{
    expect(render()).not.toContain('aria-label="Download document"');expect(render({onExport(){}})).toContain('aria-label="Download document"');
  });
});
