import { useMemo, useRef, useState } from 'react';
import { compileLocal } from 'reactive-md';
import {
  ReactiveMarkdownEditor,
  type ReactiveMarkdownEditorHandle,
} from 'reactive-md/editor';
import 'reactive-md/editor/styles.css';
import { LocalReactiveDocument } from 'reactive-md/react';
import 'reactive-md/styles.css';

const documents = {
  estimate: `# Cost estimate

<panel title="Adjust the plan">
<slider bind="people" label="People" initial="2" min="1" max="20">
<toggle bind="annual" label="Annual billing">
</panel>

Monthly cost: **{{ people * (annual ? 80 : 100) }} USD**.`,
  notes: `# Notes

Write Markdown here. The source stays in React state.

- The editor owns formatting and undo history.
- The host owns compilation, preview and saving.`,
};

type DocumentId = keyof typeof documents;

export function SourceAndPreview() {
  const [documentId, setDocumentId] = useState<DocumentId>('estimate');
  const [source, setSource] = useState(documents.estimate);
  const editor = useRef<ReactiveMarkdownEditorHandle>(null);
  const result = useMemo(() => compileLocal(source), [source]);

  function openDocument(id: DocumentId) {
    setDocumentId(id);
    setSource(documents[id]);
  }

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={() => openDocument('estimate')}>Estimate</button>
        <button type="button" onClick={() => openDocument('notes')}>Notes</button>
        <button type="button" onClick={() => editor.current?.undo()}>Undo</button>
        <button type="button" onClick={() => editor.current?.redo()}>Redo</button>
      </div>

      <ReactiveMarkdownEditor
        ref={editor}
        value={source}
        onChange={setSource}
        documentKey={documentId}
        diagnostics={result.diagnostics}
        document={result.ok ? result.document : null}
        ariaLabel="Reactive MD source"
        onExport={() => {
          const blob = new Blob([source], { type: 'text/markdown;charset=utf-8' });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          link.download = `${documentId}.reactive.md`;
          link.click();
          URL.revokeObjectURL(url);
        }}
      />

      {result.ok
        ? <LocalReactiveDocument source={source} />
        : <pre>{result.diagnostics.map(item => `${item.line}:${item.column} ${item.message}`).join('\n')}</pre>}
    </div>
  );
}
