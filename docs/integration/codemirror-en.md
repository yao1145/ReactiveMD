# CodeMirror 6 editor integration

The current workspace uses CM6 throughout; this change is unreleased. Prefer `ReactiveMarkdownEditor` from [`reactive-md/editor`](editor-en.md). The `/editor/codemirror` path remains a compatibility alias for the same component.

```tsx
import { useState } from 'react';
import { ReactiveMarkdownCodeEditor } from 'reactive-md/editor/codemirror';
import 'reactive-md/editor/codemirror/styles.css';

export function LongSourceEditor() {
  const [source, setSource] = useState('# Document');
  return <ReactiveMarkdownCodeEditor value={source} onChange={setSource}
    documentKey="document-1" ariaLabel="Source" />;
}
```

CM6 renders source lines around the viewport and provides native history, search, a toolbar, authoring panel and view controls. Both editor paths share the same runtime and stylesheet. Consumers do not need CM6 packages for public types. Server rendering produces the frame; the editing view mounts on the client. Core document rendering remains independent of the editor bundle.

The ref supports `focus`, `selectRange`, `insertText`, `undo`, `redo`, `getSelection`, `getSource`, `getEditorElement` and `getVisibleRanges`. The old `textareaRef` and `getTextarea` APIs have been removed. Ranges use UTF-16 offsets in the original source. Untouched CRLF/LF/CR breaks, BOM and emoji are preserved. Native input uses the first line-break style for new breaks. Positions inside CRLF map to its beginning. Controlled acknowledgements retain history. External replacements and `documentKey` changes reset history and scroll. Up to 120 unacknowledged edits are tracked using inverse edits; older echoes become external replacements.

`onTransaction` provides `previousSource`, `source`, revisions, `changes`, selection and composition state. All change ranges address `previousSource`. A host may merge them into one replacement and pass `{baseSource, edit}` as the third argument to `LocalCompileScheduler.schedule`. Invalid hints or different baselines use the existing diff and full-request recovery.

For a shared preview Worker, enable scheduler `includeAuthorAnalysis: true`. Pass `analysis={{source: outcome.source, optionsKey: localCompileOptionsKey(outcome.options), analysis: outcome.analysis}}` when analysis exists. Both scheduler and key function come from `reactive-md`. Pass `analysis={null}` while waiting to disable the private analysis Worker; omitting `analysis` enables it. Source and options signatures must match. Analysis reuses the successful compiled document and declaration metadata. Temporary semantic errors recover syntax on the Worker with the same limits. Budget or options failures return empty analysis; diagnostics still appear through `diagnostics`. Older Workers keep compiling, but authoring waits for analysis-capable results.

`createAnalysisWorker` can supply a CSP-compatible factory. If the default Worker cannot start, the scheduler uses its main-thread fallback. Analysis time is reported as `metrics.worker.analysisMs`. Only visible syntax ranges receive decorations; binding and reference lists show 50 items per page. Host-supplied preview DOM stays mounted across view changes.

Physical IME, mobile keyboards and assistive technology need target-device acceptance; automation covers composition events and native text insertion. Run `npm run test:codemirror-browser` for production Edge checks. See the [implementation report](../development/performance-overview-ch.md) for performance and limits.
