import { useMemo } from 'react';
import { EDITOR_CHROME_COPY } from './editor-i18n';
import { useEditorLocale } from './locale';
import type { EditorViewMode } from './types';

export function EditorViewBar({ source, mode, onModeChange, sourceId, previewId, hasPreview, allowSplit, toolbar }: {
  source: string;
  mode: EditorViewMode;
  onModeChange(mode: EditorViewMode): void;
  sourceId: string;
  previewId: string;
  hasPreview: boolean;
  allowSplit: boolean;
  toolbar: boolean;
}) {
  const locale = useEditorLocale();
  const copy = EDITOR_CHROME_COPY[locale];
  const count = useMemo(() => { let count = 0; for (const _character of source) count++; return count; }, [source]);
  return <div className="editor-status-bar" role="group" aria-label={copy.viewLabel}>
    <span className="editor-status-count">{copy.count(count.toLocaleString(locale))}</span>
    <span className="editor-status-hint">
      {mode !== 'preview' && toolbar ? copy.keyboardHint : ''}
    </span>
    {hasPreview ? <div className="editor-view-modes">
      {(['edit', 'split', 'preview'] as const).filter((view) => view !== 'split' || allowSplit).map((view) => <button
        key={view}
        type="button"
        data-editor-view-option={view}
        aria-pressed={mode === view}
        aria-controls={view === 'edit' ? sourceId : view === 'preview' ? previewId : `${sourceId} ${previewId}`}
        onClick={() => onModeChange(view)}
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {view === 'edit' ? <><path d="m16 3 5 5-12 12-6 1 1-6Z" /><path d="m13 6 5 5" /></>
            : view === 'split' ? <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M12 4v16" /></>
              : <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>}
        </svg>
        <span>{copy[view]}</span>
      </button>)}
    </div> : null}
  </div>;
}
