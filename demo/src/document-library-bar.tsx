import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useLanguage, type Language } from './i18n';
import {
  MAX_DOCUMENT_NAME_LENGTH,
  uniqueDocumentName,
  type LibraryDocument,
  type LibraryMode,
  type LibraryProblem,
  type LibrarySaveStatus,
} from './document-library';
import './document-library.css';

export interface DocumentLibraryCopy {
  region: string;
  modeLabel: string;
  examples: string;
  documents: string;
  documentLabel: string;
  empty: string;
  newDocument: string;
  createHeading: string;
  renameHeading: string;
  duplicateHeading: string;
  nameLabel: string;
  nameRequired: string;
  create: string;
  rename: string;
  duplicate: string;
  duplicateConfirm: string;
  cancel: string;
  saving: string;
  saved: string;
  saveFailed: string;
  retry: string;
  corrupt: string;
  unavailable: string;
  defaultName: string;
  importedName: string;
  copySuffix: string;
  copyExample: string;
  moreOptions: string;
}

/** Library chrome stays local to this module so i18n.tsx keeps its shape. */
export const LIBRARY_COPY: Record<Language, DocumentLibraryCopy> = {
  en: {
    region: 'My documents',
    modeLabel: 'Document source',
    examples: 'Try examples',
    documents: 'My documents',
    documentLabel: 'Document',
    empty: 'No documents yet',
    newDocument: 'New document',
    createHeading: 'Name this document',
    renameHeading: 'Rename document',
    duplicateHeading: 'Name the copy',
    nameLabel: 'Document name',
    nameRequired: 'Enter a name before saving.',
    create: 'Create',
    rename: 'Rename',
    duplicate: 'Duplicate',
    duplicateConfirm: 'Create copy',
    cancel: 'Cancel',
    saving: 'Saving…',
    saved: 'Saved',
    saveFailed: 'Not saved',
    retry: 'Retry save',
    corrupt: 'Saved documents could not be read. You can still create documents in this tab.',
    unavailable: 'Browser storage is unavailable. Documents stay in this tab and are lost when you close it.',
    defaultName: 'Untitled document',
    importedName: 'Imported document',
    copySuffix: ' copy',
    copyExample: 'Copy example to My documents',
    moreOptions: 'More options',
  },
  zh: {
    region: '我的文档',
    modeLabel: '文档来源',
    examples: '体验示例',
    documents: '我的文档',
    documentLabel: '文档',
    empty: '还没有文档',
    newDocument: '新建文档',
    createHeading: '为文档命名',
    renameHeading: '重命名文档',
    duplicateHeading: '为副本命名',
    nameLabel: '文档名称',
    nameRequired: '请先输入名称。',
    create: '创建',
    rename: '重命名',
    duplicate: '复制',
    duplicateConfirm: '创建副本',
    cancel: '取消',
    saving: '保存中…',
    saved: '已保存',
    saveFailed: '未保存',
    retry: '重试保存',
    corrupt: '无法读取已保存的文档。这个标签页里仍可新建文档。',
    unavailable: '浏览器存储不可用。文档只保存在这个标签页，关闭后会丢失。',
    defaultName: '未命名文档',
    importedName: '导入的文档',
    copySuffix: ' 副本',
    copyExample: '复制示例到我的文档',
    moreOptions: '更多选项',
  },
};

export interface LibraryModeSwitchProps {
  mode: LibraryMode;
  onChange(next: LibraryMode): void;
}

/** Two explicit destinations: the curated examples and the personal library. */
export function LibraryModeSwitch({ mode, onChange }: LibraryModeSwitchProps) {
  const copy = LIBRARY_COPY[useLanguage()];
  return (
    <div className="library-mode" role="group" aria-label={copy.modeLabel}>
      <button
        type="button"
        aria-pressed={mode === 'example'}
        onClick={() => onChange('example')}
      >
        {copy.examples}
      </button>
      <button
        type="button"
        aria-pressed={mode === 'documents'}
        onClick={() => onChange('documents')}
      >
        {copy.documents}
      </button>
    </div>
  );
}

type NameFormKind = 'create' | 'rename' | 'duplicate';

interface NameFormState {
  kind: NameFormKind;
  value: string;
}

export interface DocumentLibraryBarProps {
  documents: readonly LibraryDocument[];
  selectedId: string | null;
  saveStatus: LibrarySaveStatus;
  problem: LibraryProblem;
  onSelect(id: string): void;
  onCreate(name: string): void;
  onRename(id: string, name: string): void;
  onDuplicate(id: string, name: string): void;
  onRetry(): void;
}

/**
 * Selector and actions for the personal documents. Names are always explicit:
 * create, rename and duplicate each open a small form instead of guessing from
 * the source.
 */
export function DocumentLibraryBar(props: DocumentLibraryBarProps) {
  const copy = LIBRARY_COPY[useLanguage()];
  const [form, setForm] = useState<NameFormState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const formTrigger = useRef<HTMLElement | null>(null);
  const selectId = useId();
  const nameId = useId();
  const errorId = useId();
  const selected = props.documents.find((document) => document.id === props.selectedId) ?? null;

  useEffect(() => {
    if (!form) return;
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [form?.kind]);

  const openForm = (next: NameFormState) => {
    formTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setError(null);
    setForm(next);
  };

  const closeForm = () => {
    setError(null);
    setForm(null);
    formTrigger.current?.focus();
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form) return;
    const name = form.value.trim();
    if (!name) {
      setError(copy.nameRequired);
      return;
    }
    if (form.kind === 'create') props.onCreate(name);
    else if (selected && form.kind === 'rename') props.onRename(selected.id, name);
    else if (selected && form.kind === 'duplicate') props.onDuplicate(selected.id, name);
    closeForm();
  };

  const heading = form?.kind === 'create'
    ? copy.createHeading
    : form?.kind === 'rename'
      ? copy.renameHeading
      : copy.duplicateHeading;
  const confirm = form?.kind === 'create'
    ? copy.create
    : form?.kind === 'rename'
      ? copy.rename
      : copy.duplicateConfirm;

  return (
    <div className="doc-library" aria-label={copy.region}>
      <div className="doc-library-row">
        <label className="bar-label" htmlFor={selectId}>{copy.documentLabel}</label>
        <select
          id={selectId}
          className="bar-select doc-select"
          value={props.selectedId ?? ''}
          disabled={props.documents.length === 0}
          onChange={(event) => props.onSelect(event.target.value)}
        >
          {props.documents.length === 0
            ? <option value="">{copy.empty}</option>
            : props.documents.map((document) => (
              <option key={document.id} value={document.id}>{document.name}</option>
            ))}
        </select>
        <button
          type="button"
          className="button button-secondary"
          onClick={() => openForm({ kind: 'create', value: copy.defaultName })}
        >
          {copy.newDocument}
        </button>
        <button
          type="button"
          className="button button-secondary"
          disabled={!selected}
          onClick={() => selected && openForm({ kind: 'rename', value: selected.name })}
        >
          {copy.rename}
        </button>
        <button
          type="button"
          className="button button-secondary"
          disabled={!selected}
          onClick={() => selected && openForm({
            kind: 'duplicate',
            value: uniqueDocumentName(
              props.documents.map((document) => document.name),
              `${selected.name}${copy.copySuffix}`,
            ),
          })}
        >
          {copy.duplicate}
        </button>
        {selected ? (
          <span
            className={`doc-save-state is-${props.saveStatus}`}
            role="status"
            aria-live="polite"
          >
            {props.saveStatus === 'saving'
              ? copy.saving
              : props.saveStatus === 'failed'
                ? copy.saveFailed
                : copy.saved}
          </span>
        ) : null}
        {selected && props.saveStatus === 'failed' ? (
          <button type="button" className="button button-quiet" onClick={props.onRetry}>
            {copy.retry}
          </button>
        ) : null}
      </div>

      {props.problem ? (
        <p className="doc-library-problem" role="alert">
          {props.problem === 'corrupt' ? copy.corrupt : copy.unavailable}
        </p>
      ) : null}

      {form ? (
        <form className="doc-name-form" onSubmit={submit} aria-label={heading}>
          <label className="bar-label" htmlFor={nameId}>{copy.nameLabel}</label>
          <input
            id={nameId}
            ref={inputRef}
            className="doc-name-input"
            value={form.value}
            maxLength={MAX_DOCUMENT_NAME_LENGTH}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            onChange={(event) => {
              const value = event.target.value;
              setError(null);
              setForm((current) => (current ? { ...current, value } : current));
            }}
          />
          <button type="submit" className="button button-primary" disabled={!form.value.trim()}>
            {confirm}
          </button>
          <button type="button" className="button button-quiet" onClick={closeForm}>
            {copy.cancel}
          </button>
          {error ? <span id={errorId} className="doc-name-error" role="alert">{error}</span> : null}
        </form>
      ) : null}
    </div>
  );
}
