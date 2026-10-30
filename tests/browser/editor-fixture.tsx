import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ReactiveMarkdownEditor,
  type ReactiveMarkdownEditorHandle,
  type EditorViewMode,
} from 'reactive-md/editor';
import { createLocalConfig, defineLocalComponent } from 'reactive-md/sdk';
import 'reactive-md/editor/styles.css';

// One registered external manifest. It exercises the real catalog path: the
// menu must show its localized title/description/property help, insert its
// template, and drop it again when the host removes the configuration.
const EXTENSION_METER = defineLocalComponent({
  id: 'fixture/ext-meter',
  name: 'ext-meter',
  version: '1.0.0',
  protocol: 'reactive-md-component/v1',
  form: 'leaf',
  props: {
    label: {
      kind: 'string',
      required: true,
      description: { en: 'Meter label', zh: '仪表标签' },
    },
    max: {
      kind: 'number',
      default: 5,
      min: 1,
      max: 10,
      integer: true,
      description: { en: 'Upper bound', zh: '上限' },
    },
  },
  bindings: {
    value: {
      kind: 'number',
      family: 'number',
      bind: 'bind',
      initial: 'initial',
      initialRule: 'nearest-zero',
    },
  },
  capabilities: { interactive: true, static: true, ssr: true, offline: true },
  authoring: {
    title: { en: 'Meter', zh: '仪表' },
    description: { en: 'Fixture external meter.', zh: '测试外部仪表。' },
    category: 'input',
    insertText: '<ext-meter bind="{{bind:meter}}" label="Meter" initial="2">',
  },
});

const WITH_EXTENSION = { config: createLocalConfig({ components: [EXTENSION_METER] }) };
const WITHOUT_EXTENSION = undefined;

// Consumer fixture for the packaged editor entry. Both editors are controlled
// by this host exactly as a product page would use them.
const SOURCE_A = [
  '# Editor A',
  '',
  '<slider bind="amount" label="Amount" min="0" max="10" />',
  '',
  'Value: {{ amount }}',
  '',
  'Plain paragraph for selection.',
].join('\n');

const SOURCE_B = [
  '# Editor B',
  '',
  'Second instance stays independent.',
  '',
  '- list item',
].join('\n');

type EditorId = 'a' | 'b';
type Locale = 'en' | 'zh';
type Theme = 'light' | 'dark' | 'auto';

function perEditor<T>(value: T): Record<EditorId, T> {
  return { a: value, b: value };
}

interface Harness {
  setValue(id: EditorId, value: string): void;
  setLocale(locale: Locale, target?: EditorId | 'both'): void;
  setTheme(theme: Theme, target?: EditorId | 'both'): void;
  setViewMode(mode: EditorViewMode | undefined, target?: EditorId | 'both'): void;
  viewChanges(id: EditorId): readonly EditorViewMode[];
  setReadOnly(readOnly: boolean, target?: EditorId | 'both'): void;
  setDisabled(disabled: boolean, target?: EditorId | 'both'): void;
  setExtension(enabled: boolean, target?: EditorId | 'both'): void;
  setDocumentKey(key: string): void;
  focusRange(id: EditorId, start: number, end: number): void;
  selectRange(id: EditorId, start: number, end: number): void;
  undo(id: EditorId): void;
  redo(id: EditorId): void;
  getSelection(id: EditorId): { start: number; end: number } | null;
  getValue(id: EditorId): string;
  exports(): number;
  changes(id: EditorId): number;
}

declare global {
  interface Window {
    editorHarness: Harness;
  }
}

function Fixture() {
  const [values, setValues] = useState<Record<EditorId, string>>({
    a: SOURCE_A,
    b: SOURCE_B,
  });
  const [locales, setLocales] = useState<Record<EditorId, Locale>>(perEditor('en'));
  const [themes, setThemes] = useState<Record<EditorId, Theme>>(perEditor('light'));
  const [viewModes, setViewModes] = useState<Record<EditorId, EditorViewMode | undefined>>(perEditor(undefined));
  const [viewChanges, setViewChanges] = useState<Record<EditorId, EditorViewMode[]>>({ a: [], b: [] });
  const [readOnly, setReadOnly] = useState<Record<EditorId, boolean>>(perEditor(false));
  const [disabled, setDisabled] = useState<Record<EditorId, boolean>>(perEditor(false));
  const [extension, setExtension] = useState<Record<EditorId, boolean>>({ a: true, b: false });
  const [documentKey, setDocumentKey] = useState('document-a');
  const [changes, setChanges] = useState<Record<EditorId, number>>(perEditor(0));
  const [exports, setExports] = useState(0);

  const handleA = useRef<ReactiveMarkdownEditorHandle>(null);
  const handleB = useRef<ReactiveMarkdownEditorHandle>(null);

  const handles: Record<EditorId, typeof handleA> = { a: handleA, b: handleB };
  const apply = <T,>(setter: (update: (current: Record<EditorId, T>) => Record<EditorId, T>) => void) =>
    (value: T, target: EditorId | 'both' = 'both') => {
      setter((current) => {
        if (target === 'both') return { a: value, b: value };
        return { ...current, [target]: value };
      });
    };

  window.editorHarness = {
    setValue: (id, value) => setValues((current) => ({ ...current, [id]: value })),
    setLocale: apply<Locale>(setLocales),
    setTheme: apply<Theme>(setThemes),
    setViewMode: apply<EditorViewMode | undefined>(setViewModes),
    viewChanges: (id) => viewChanges[id],
    setReadOnly: apply<boolean>(setReadOnly),
    setDisabled: apply<boolean>(setDisabled),
    setExtension: apply<boolean>(setExtension),
    setDocumentKey,
    focusRange: (id, start, end) => handles[id].current?.focus({ start, end }),
    selectRange: (id, start, end) => handles[id].current?.selectRange({ start, end }),
    undo: (id) => handles[id].current?.undo(),
    redo: (id) => handles[id].current?.redo(),
    getSelection: (id) => handles[id].current?.getSelection() ?? null,
    getValue: (id) => values[id],
    exports: () => exports,
    changes: (id) => changes[id],
  };

  const editor = (id: EditorId) => (
    <ReactiveMarkdownEditor
      id={`editor-${id}`}
      ref={handles[id]}
      value={values[id]}
      onChange={(value) => {
        setValues((current) => ({ ...current, [id]: value }));
        setChanges((current) => ({ ...current, [id]: current[id] + 1 }));
      }}
      locale={locales[id]}
      theme={themes[id]}
      viewMode={viewModes[id]}
      onViewModeChange={(mode) => setViewChanges((current) => ({ ...current, [id]: [...current[id], mode] }))}
      preview={<div><p>Preview {id}: {values[id]}</p><input type="range" aria-label={`Preview amount ${id}`} min="0" max="10" defaultValue="2" /></div>}
      height={380}
      readOnly={readOnly[id]}
      disabled={disabled[id]}
      compileOptions={extension[id] ? WITH_EXTENSION : WITHOUT_EXTENSION}
      documentKey={id === 'a' ? documentKey : 'document-b'}
      onExport={() => setExports((count) => count + 1)}
      toolbar
      authoring
    />
  );

  return (
    <main className="fixture-grid">
      <section id="host-a" className="fixture-pane" aria-label="Editor A host">
        {editor('a')}
      </section>
      <section id="host-b" className="fixture-pane" aria-label="Editor B host">
        {editor('b')}
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<Fixture />);
