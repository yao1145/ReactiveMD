/**
 * Editor toolbar for the Reactive MD editor.
 *
 * The toolbar only reads the textarea and hands pure `EditorEdit` results back
 * to the editor. The editor owns history, focus restoration and the controlled
 * value. Format state is derived from the current selection so the toolbar
 * reflects the block and inline formatting under the caret.
 */

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  formatBold,
  formatItalic,
  formatStrike,
  formatInlineCode,
  formatHeading,
  formatBulletList,
  formatOrderedList,
  formatTaskList,
  formatQuote,
  indentSelection,
  outdentSelection,
  insertLink,
  insertImage,
  insertCodeBlock,
  insertTable,
  insertDivider,
  insertText,
  insertTemplate,
  readFormatState,
  type EditorEdit,
  type EditorFormatState,
} from './editor-commands';
import {
  getNativeComponentCatalog,
  renderNativeSnippet,
  type NativeComponentDefinition,
} from './native-components';
import { useEditorLocale } from './locale';
import { EDITOR_TOOLBAR_COPY } from './editor-i18n';
import type { EditorLocale } from './types';
import {createTextareaSurface,type EditorSurface} from './surface';

export interface EditorToolbarProps {
  editorRef: RefObject<HTMLTextAreaElement | null>;
  editorSurface?: EditorSurface;
  onEdit(edit: EditorEdit): void;
  onUndo(): void;
  onRedo(): void;
  canUndo: boolean;
  canRedo: boolean;
  onExport?(): void;
  /** Render the download action only when the host supplies a handler. */
  showExport?: boolean;
  /** Read-only and disabled editors leave every action without effect. */
  disabled?: boolean;
}

type TextSelection = { start: number; end: number };
type MenuId = 'emoji' | 'heading' | 'insert' | 'list' | 'more' | 'native';
type MenuEdge = 'first' | 'last';
type HeadingLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6;
type SimpleCommand = (
  value: string,
  selection: TextSelection,
  locale?: EditorLocale,
) => EditorEdit;
type IconName =
  | 'smile'
  | 'link'
  | 'bulletList'
  | 'orderedList'
  | 'taskList'
  | 'outdent'
  | 'indent'
  | 'quote'
  | 'divider'
  | 'codeBlock'
  | 'inlineCode'
  | 'strike'
  | 'image'
  | 'table'
  | 'undo'
  | 'redo'
  | 'download'
  | 'chevron'
  | 'sparkle'
  | 'search'
  | 'plus'
  | 'more'
  | 'close';

const EMOJIS = [
  '😀', '😄', '😁', '😊', '🙂', '😉', '😍', '🤔',
  '😎', '😅', '😂', '🥳', '👍', '👎', '👏', '🙏',
  '💡', '✅', '❌', '⚠️', '🔥', '⭐', '🎉', '❤️',
  '💬', '📌', '🚀', '📈', '📉', '🧩', '⚙️', '🔍',
  '📎', '🗂️', '🕒', '✨',
] as const;

const HEADING_ITEMS: readonly { level: HeadingLevel; sample: string }[] = [
  { level: 0, sample: '¶' },
  { level: 1, sample: 'H1' },
  { level: 2, sample: 'H2' },
  { level: 3, sample: 'H3' },
  { level: 4, sample: 'H4' },
  { level: 5, sample: 'H5' },
  { level: 6, sample: 'H6' },
];

interface ListOption {
  type: 'bullet' | 'ordered' | 'task';
  icon: IconName;
  command: SimpleCommand;
}

const LIST_OPTIONS: readonly ListOption[] = [
  { type: 'bullet', icon: 'bulletList', command: formatBulletList },
  { type: 'ordered', icon: 'orderedList', command: formatOrderedList },
  { type: 'task', icon: 'taskList', command: formatTaskList },
];

const LIST_ACTIONS: readonly {
  labelKey: 'decreaseIndent' | 'increaseIndent';
  icon: IconName;
  command: SimpleCommand;
}[] = [
  { labelKey: 'decreaseIndent', icon: 'outdent', command: outdentSelection },
  { labelKey: 'increaseIndent', icon: 'indent', command: indentSelection },
];

interface InsertItem {
  labelKey: keyof typeof EDITOR_TOOLBAR_COPY.en.insertItems;
  icon: IconName;
  command: SimpleCommand;
}

const INSERT_ITEMS: readonly InsertItem[] = [
  { labelKey: 'image', icon: 'image', command: insertImage },
  { labelKey: 'table', icon: 'table', command: insertTable },
  { labelKey: 'divider', icon: 'divider', command: insertDivider },
  { labelKey: 'codeBlock', icon: 'codeBlock', command: insertCodeBlock },
  { labelKey: 'inlineCode', icon: 'inlineCode', command: formatInlineCode },
  { labelKey: 'strikethrough', icon: 'strike', command: formatStrike },
  { labelKey: 'quote', icon: 'quote', command: formatQuote },
];

const MOBILE_MENU_WIDTHS: Partial<Record<MenuId, number>> = {
  heading: 200,
  list: 208,
  insert: 216,
  more: 188,
};

const INITIAL_FORMAT_STATE: EditorFormatState = {
  headingLevel: 0,
  bold: false,
  italic: false,
  strike: false,
  inlineCode: false,
  list: null,
  quote: false,
};

const ICONS: Record<IconName, ReactNode> = {
  smile: (
    <>
      <circle cx="12" cy="12" r="8.4" />
      <path d="M8.6 14.1c.9 1.4 2 2.1 3.4 2.1s2.5-.7 3.4-2.1" />
      <path d="M9.2 9.7h.01M14.8 9.7h.01" />
    </>
  ),
  link: (
    <>
      <path d="M10.1 13.9a3.8 3.8 0 0 0 5.4 0l2.4-2.4a3.8 3.8 0 0 0-5.4-5.4l-1.2 1.2" />
      <path d="M13.9 10.1a3.8 3.8 0 0 0-5.4 0l-2.4 2.4a3.8 3.8 0 0 0 5.4 5.4l1.2-1.2" />
    </>
  ),
  bulletList: (
    <>
      <path d="M9.5 6.5H20M9.5 12H20M9.5 17.5H20" />
      <path d="M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01" />
    </>
  ),
  orderedList: (
    <>
      <path d="M10.5 6.5H20M10.5 12H20M10.5 17.5H20" />
      <text
        x="2.9"
        y="8.6"
        fill="currentColor"
        stroke="none"
        fontSize="6.8"
        fontWeight="650"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        1
      </text>
      <text
        x="2.9"
        y="14.1"
        fill="currentColor"
        stroke="none"
        fontSize="6.8"
        fontWeight="650"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        2
      </text>
      <text
        x="2.9"
        y="19.6"
        fill="currentColor"
        stroke="none"
        fontSize="6.8"
        fontWeight="650"
        fontFamily="ui-sans-serif, system-ui, sans-serif"
      >
        3
      </text>
    </>
  ),
  taskList: (
    <>
      <rect x="3" y="4" width="5.6" height="5.6" rx="1.2" />
      <path d="M4.5 6.8l1 1 1.6-1.9" />
      <path d="M12 6.8h8.4" />
      <path d="M3.4 13.9h5M3.4 17.4h5" opacity=".55" />
      <path d="M12 13.9h8.4M12 17.4h8.4" opacity=".55" />
    </>
  ),
  outdent: (
    <>
      <path d="M10 6.5H20M10 12H20M10 17.5H20" />
      <path d="M7.2 9l-3.4 3 3.4 3M4.2 12h7" />
    </>
  ),
  indent: (
    <>
      <path d="M10 6.5H20M10 12H20M10 17.5H20" />
      <path d="M3.8 9l3.4 3-3.4 3M3.2 12h7" />
    </>
  ),
  quote: (
    <>
      <path d="M10 8.2c-2.4.7-3.8 2.4-3.8 5.2V17H10v-4.2H7.5c0-1.5.7-2.6 2.5-3.2z" />
      <path d="M18.5 8.2c-2.4.7-3.8 2.4-3.8 5.2V17h3.8v-4.2h-2.5c0-1.5.7-2.6 2.5-3.2z" />
    </>
  ),
  divider: (
    <>
      <path d="M4 12h16" />
      <path d="M7 7.5h10M7 16.5h10" opacity=".55" />
    </>
  ),
  codeBlock: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2.4" />
      <path d="M9.8 9.3l-2.7 2.7 2.7 2.7M14.2 9.3l2.7 2.7-2.7 2.7" />
    </>
  ),
  inlineCode: (
    <>
      <path d="M8.8 8.5L5 12l3.8 3.5M15.2 8.5L19 12l-3.8 3.5" />
      <path d="M13.6 6.5l-3.2 11" opacity=".45" />
    </>
  ),
  strike: (
    <>
      <path d="M4 12h16" />
      <path d="M16.7 7.4c-.7-1.2-2-1.9-3.7-1.9-2.3 0-3.9 1.1-3.9 2.8 0 1.5 1.1 2.3 3.7 3 2.8.8 4.2 1.7 4.2 3.5 0 2-1.7 3.2-4.3 3.2-2.1 0-3.6-.8-4.3-2.2" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2.4" />
      <circle cx="8.4" cy="9.4" r="1.35" />
      <path d="M4.6 17.4l4.9-4.9 3.5 3.5 2.7-2.7 3.7 3.7" />
    </>
  ),
  table: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2.4" />
      <path d="M3.4 9.7h17.2M9.7 9.2v10.2M14.9 9.2v10.2M9.2 14.5h11.4" />
    </>
  ),
  undo: (
    <>
      <path d="M5 12h9.2a4.3 4.3 0 0 1 0 8.6h-1.8" />
      <path d="M8.8 8.2L5 12l3.8 3.8" />
    </>
  ),
  redo: (
    <>
      <path d="M19 12h-9.2a4.3 4.3 0 0 0 0 8.6h1.8" />
      <path d="M15.2 8.2L19 12l-3.8 3.8" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v10.5M8 10.8l4 3.7 4-3.7" />
      <path d="M4.5 17.5v2h15v-2" />
    </>
  ),
  chevron: <path d="M7.5 9.7l4.5 4.5 4.5-4.5" />,
  sparkle: (
    <>
      <path d="M11.2 4.2l1.5 4.3 4.3 1.5-4.3 1.5-1.5 4.3-1.5-4.3-4.3-1.5 4.3-1.5z" />
      <path d="M18.3 15.4v3.4M16.6 17.1h3.4" />
    </>
  ),
  search: (
    <>
      <circle cx="10.6" cy="10.6" r="5.6" />
      <path d="M14.8 14.8L20 20" />
    </>
  ),
  plus: <path d="M12 5.2v13.6M5.2 12h13.6" />,
  more: (
    <>
      <circle cx="5.5" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="18.5" cy="12" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  close: <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />,
};

function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      className={className ? `editor-toolbar-icon ${className}` : 'editor-toolbar-icon'}
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICONS[name]}
    </svg>
  );
}

function keepEditorFocus(event: ReactMouseEvent<HTMLButtonElement>): void {
  event.preventDefault();
}

interface ToolbarButtonProps {
  toolbarId: string;
  label: string;
  tabStop: boolean;
  onFocus(): void;
  onClick(): void;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  expanded?: boolean;
  popup?: 'menu' | 'dialog';
  controls?: string;
  pressed?: boolean;
  active?: boolean;
  onKeyDown?(event: ReactKeyboardEvent<HTMLButtonElement>): void;
}

function ToolbarButton({
  toolbarId,
  label,
  tabStop,
  onFocus,
  onClick,
  children,
  className,
  disabled,
  expanded,
  popup,
  controls,
  pressed,
  active,
  onKeyDown,
}: ToolbarButtonProps) {
  return (
    <button
      type="button"
      data-toolbar-item="true"
      data-toolbar-id={toolbarId}
      data-tooltip={label}
      className={
        `editor-toolbar-button${className ? ` ${className}` : ''}` +
        (active ? ' is-active' : '')
      }
      aria-label={label}
      aria-pressed={pressed}
      aria-expanded={expanded}
      aria-haspopup={popup}
      aria-controls={controls}
      disabled={disabled}
      tabIndex={tabStop ? 0 : -1}
      onFocus={onFocus}
      onMouseDown={popup ? undefined : keepEditorFocus}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      {children}
    </button>
  );
}

function readEditor(surface: EditorSurface) {
  const {value,selection}=surface.read();
  return {value,selection,selectedText:value.slice(selection.start,selection.end)};
}

function matchesQuery(component: NativeComponentDefinition, term: string): boolean {
  if (!term) return true;
  return (
    component.label.toLowerCase().includes(term) ||
    component.description.toLowerCase().includes(term) ||
    component.keywords.some((keyword) => keyword.toLowerCase().includes(term))
  );
}

function sameFormatState(a: EditorFormatState, b: EditorFormatState): boolean {
  return (
    a.headingLevel === b.headingLevel &&
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.strike === b.strike &&
    a.inlineCode === b.inlineCode &&
    a.list === b.list &&
    a.quote === b.quote
  );
}

function getToolbarButtons(container: HTMLElement | null): HTMLButtonElement[] {
  if (!container) return [];
  return Array.from(
    container.querySelectorAll<HTMLButtonElement>('[data-toolbar-item]'),
  ).filter((button) => !button.disabled && button.getClientRects().length > 0);
}

function getMenuItems(container: HTMLElement | null): HTMLButtonElement[] {
  if (!container) return [];
  return Array.from(
    container.querySelectorAll<HTMLButtonElement>(
      '[role="menuitem"], [role="menuitemradio"]',
    ),
  ).filter((item) => !item.disabled && item.getClientRects().length > 0);
}

function moveMenuFocus(
  event: ReactKeyboardEvent<HTMLElement>,
  container: HTMLElement | null,
): void {
  const items = getMenuItems(container);
  if (items.length === 0) return;
  const active = document.activeElement as HTMLButtonElement | null;
  const index = active ? items.indexOf(active) : -1;
  let next = index;

  switch (event.key) {
    case 'ArrowDown':
      next = index < 0 ? 0 : (index + 1) % items.length;
      break;
    case 'ArrowUp':
      next = index < 0 ? items.length - 1 : (index - 1 + items.length) % items.length;
      break;
    case 'Home':
      next = 0;
      break;
    case 'End':
      next = items.length - 1;
      break;
    default:
      return;
  }

  event.preventDefault();
  items[next]?.focus();
}

function moveEmojiFocus(
  event: ReactKeyboardEvent<HTMLElement>,
  grid: HTMLElement | null,
): void {
  if (!grid) return;
  const cells = Array.from(grid.querySelectorAll<HTMLButtonElement>('.editor-toolbar-emoji'));
  if (cells.length === 0) return;
  const active = document.activeElement as HTMLButtonElement | null;
  const index = active ? cells.indexOf(active) : -1;
  if (index < 0) return;
  const columns = 8;
  let next = index;

  switch (event.key) {
    case 'ArrowRight':
      next = Math.min(index + 1, cells.length - 1);
      break;
    case 'ArrowLeft':
      next = Math.max(index - 1, 0);
      break;
    case 'ArrowDown':
      next = Math.min(index + columns, cells.length - 1);
      break;
    case 'ArrowUp':
      next = Math.max(index - columns, 0);
      break;
    case 'Home':
      next = 0;
      break;
    case 'End':
      next = cells.length - 1;
      break;
    default:
      return;
  }

  event.preventDefault();
  cells[next]?.focus();
}

export function EditorToolbar({
  editorRef,
  editorSurface,
  onEdit,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onExport,
  showExport = false,
  disabled = false,
}: EditorToolbarProps): ReactElement {
  const inputSurface=useMemo(()=>editorSurface??createTextareaSurface(editorRef),[editorSurface,editorRef]);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuPanelRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const emojiGridRef = useRef<HTMLDivElement>(null);
  const pendingMenuFocus = useRef<MenuEdge | null>(null);
  const formatFrame = useRef<number | null>(null);
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null);
  const [tabStopId, setTabStopId] = useState('heading');
  const [query, setQuery] = useState('');
  const [formatState, setFormatState] = useState<EditorFormatState>(INITIAL_FORMAT_STATE);
  const [menuPlacement, setMenuPlacement] = useState<CSSProperties | null>(null);
  const idPrefix = useId();
  const emojiMenuId = `${idPrefix}-emoji-menu`;
  const headingMenuId = `${idPrefix}-heading-menu`;
  const listMenuId = `${idPrefix}-list-menu`;
  const insertMenuId = `${idPrefix}-insert-menu`;
  const moreMenuId = `${idPrefix}-more-menu`;
  const nativeMenuId = `${idPrefix}-native-menu`;
  const locale = useEditorLocale();
  const copy = EDITOR_TOOLBAR_COPY[locale];
  const catalog = useMemo(() => getNativeComponentCatalog(locale), [locale]);
  const headingItems = HEADING_ITEMS.map((item) => ({
    ...item,
    label: copy.headingLabels[item.level],
  }));
  const listOptions = LIST_OPTIONS.map((item) => ({
    ...item,
    label: copy.listLabels[item.type],
  }));
  const listActions = LIST_ACTIONS.map((item) => ({
    ...item,
    label: copy[item.labelKey],
  }));
  const insertItems = INSERT_ITEMS.map((item) => ({
    ...item,
    label: copy.insertItems[item.labelKey],
  }));

  const filteredGroups = useMemo(() => {
    const term = query.trim().toLowerCase();
    return catalog.groups
      .map((group) => ({
        group,
        components: catalog.components.filter(
          (component) => component.group === group.id && matchesQuery(component, term),
        ),
      }))
      .filter((entry) => entry.components.length > 0);
  }, [catalog, query]);

  const syncFormatState = useCallback(() => {
    if (!inputSurface.element()) {
      setFormatState(INITIAL_FORMAT_STATE);
      return;
    }
    const {value,selection}=inputSurface.read();
    const next = readFormatState(value,selection);
    setFormatState((current) => (sameFormatState(current, next) ? current : next));
  }, [inputSurface]);

  const queueFormatSync = useCallback(() => {
    if (formatFrame.current !== null) window.cancelAnimationFrame(formatFrame.current);
    formatFrame.current = window.requestAnimationFrame(() => {
      formatFrame.current = null;
      syncFormatState();
    });
  }, [syncFormatState]);

  useEffect(() => {
    const release=inputSurface.subscribe(syncFormatState);
    syncFormatState();
    return release;
  }, [inputSurface, syncFormatState]);

  useEffect(() => {
    return () => {
      if (formatFrame.current !== null) window.cancelAnimationFrame(formatFrame.current);
    };
  }, []);

  const getMenuTrigger = useCallback((menu: MenuId): HTMLButtonElement | null => {
    const id = menu === 'emoji' ? 'insert' : menu === 'native' ? 'components' : menu;
    return rootRef.current?.querySelector<HTMLButtonElement>(`[data-toolbar-id="${id}"]`) ?? null;
  }, []);

  useLayoutEffect(() => {
    if (!openMenu || openMenu === 'native' || openMenu === 'emoji') {
      setMenuPlacement(null);
      return;
    }

    const media = window.matchMedia('(max-width: 640px)');
    const update = () => {
      if (!media.matches) {
        setMenuPlacement(null);
        return;
      }
      const trigger = getMenuTrigger(openMenu);
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const width = MOBILE_MENU_WIDTHS[openMenu] ?? 216;
      const gutter = 8;
      const gap = 6;
      const spaceAbove = rect.top - gap - gutter;
      const spaceBelow = window.innerHeight - rect.bottom - gap - gutter;
      const style: CSSProperties = {};
      if (spaceAbove >= spaceBelow) {
        style.bottom = window.innerHeight - rect.top + gap;
        style.top = 'auto';
        style.maxHeight = Math.max(80, spaceAbove);
      } else {
        style.top = rect.bottom + gap;
        style.bottom = 'auto';
        style.maxHeight = Math.max(80, spaceBelow);
      }
      if (openMenu === 'heading' || openMenu === 'list') {
        style.left = Math.min(Math.max(gutter, rect.left), window.innerWidth - gutter - width);
        style.right = 'auto';
      } else {
        style.right = Math.min(
          Math.max(gutter, window.innerWidth - rect.right),
          window.innerWidth - gutter - width,
        );
        style.left = 'auto';
      }
      setMenuPlacement(style);
    };

    update();
    media.addEventListener('change', update);
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      media.removeEventListener('change', update);
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [openMenu, getMenuTrigger]);

  useEffect(() => {
    if (!openMenu) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      const menu = openMenu;
      setOpenMenu(null);
      getMenuTrigger(menu)?.focus();
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [openMenu, getMenuTrigger]);

  useEffect(() => {
    if (!openMenu) return;
    const edge = pendingMenuFocus.current;
    pendingMenuFocus.current = null;
    const frame = window.requestAnimationFrame(() => {
      const panel = menuPanelRef.current;
      if (edge) {
        const items = getMenuItems(panel);
        (edge === 'first' ? items[0] : items[items.length - 1])?.focus();
      } else if (openMenu === 'native') {
        searchRef.current?.focus();
      } else if (openMenu === 'emoji') {
        getMenuItems(panel)[0]?.focus();
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [openMenu]);

  const syncTabStop = useCallback(() => {
    const items = getToolbarButtons(rootRef.current);
    if (items.length === 0) return;
    setTabStopId((current) => {
      if (items.some((item) => item.dataset.toolbarId === current)) return current;
      return items[0]?.dataset.toolbarId ?? 'heading';
    });
  }, []);

  useEffect(() => {
    syncTabStop();
    window.addEventListener('resize', syncTabStop);
    return () => window.removeEventListener('resize', syncTabStop);
  }, [syncTabStop]);

  useEffect(() => {
    syncTabStop();
  }, [openMenu, canUndo, canRedo, syncTabStop]);

  const commitEdit = useCallback(
    (edit: EditorEdit) => {
      if (disabled) return;
      setOpenMenu(null);
      onEdit(edit);
      queueFormatSync();
    },
    [disabled, onEdit, queueFormatSync],
  );

  const applySimple = (command: SimpleCommand) => {
    if (disabled) return;
    const { value, selection } = readEditor(inputSurface);
    commitEdit(command(value, selection, locale));
  };

  const applyHeading = (level: HeadingLevel) => {
    if (disabled) return;
    const { value, selection } = readEditor(inputSurface);
    commitEdit(formatHeading(value, selection, level));
  };

  const applyEmoji = (emoji: string) => {
    if (disabled) return;
    const { value, selection } = readEditor(inputSurface);
    commitEdit(insertText(value, selection, emoji));
  };

  const applyNativeComponent = (component: NativeComponentDefinition) => {
    if (disabled) return;
    const { value, selection, selectedText } = readEditor(inputSurface);
    const snippet = renderNativeSnippet(component, value, selectedText);
    commitEdit(insertTemplate(value, selection, snippet, { block: !component.inline }));
  };

  const handleUndo = () => {
    if (disabled) return;
    setOpenMenu(null);
    onUndo();
    queueFormatSync();
  };

  const handleRedo = () => {
    if (disabled) return;
    setOpenMenu(null);
    onRedo();
    queueFormatSync();
  };

  const handleExport = () => {
    setOpenMenu(null);
    if (!showExport) return;
    onExport?.();
  };

  const toggleMenu = (menu: MenuId) => {
    setOpenMenu((current) => (current === menu ? null : menu));
    if (menu === 'native') setQuery('');
  };

  const openMenuFromKeyboard = (
    menu: MenuId,
    event: ReactKeyboardEvent<HTMLButtonElement>,
    edge: MenuEdge,
  ) => {
    event.preventDefault();
    if (menu === 'native') setQuery('');
    if (openMenu === menu) {
      const items = getMenuItems(menuPanelRef.current);
      (edge === 'first' ? items[0] : items[items.length - 1])?.focus();
      return;
    }
    pendingMenuFocus.current = edge;
    setOpenMenu(menu);
  };

  const handleTriggerKeyDown = (
    menu: MenuId,
    event: ReactKeyboardEvent<HTMLButtonElement>,
  ) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    openMenuFromKeyboard(menu, event, event.key === 'ArrowDown' ? 'first' : 'last');
  };

  const handleToolbarKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const button = target.closest<HTMLButtonElement>('[data-toolbar-item]');
    if (!button || button !== target) return;

    const items = getToolbarButtons(rootRef.current);
    const index = items.indexOf(button);
    if (index < 0) return;

    let next = index;
    switch (event.key) {
      case 'ArrowLeft':
        next = (index - 1 + items.length) % items.length;
        break;
      case 'ArrowRight':
        next = (index + 1) % items.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = items.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    if (openMenu) setOpenMenu(null);
    items[next]?.focus();
  };

  const closeNativePicker = () => {
    setOpenMenu(null);
    getMenuTrigger('native')?.focus();
  };

  const headingLabel =
    headingItems.find((item) => item.level === formatState.headingLevel)?.label ??
    copy.headingLabels[0];
  const headingCompactLabel = formatState.headingLevel === 0 ? '¶' : `H${formatState.headingLevel}`;
  const headingLabelText = copy.headingLevelLabel(headingLabel);
  const currentListLabel = formatState.list ? copy.listLabels[formatState.list] : null;
  const listLabel = currentListLabel ? copy.listLabelWithType(currentListLabel) : copy.listLabel;
  const listIcon: IconName =
    formatState.list === 'ordered'
      ? 'orderedList'
      : formatState.list === 'task'
        ? 'taskList'
        : 'bulletList';

  return (
    <div
      className={`editor-toolbar${openMenu ? ' is-menu-open' : ''}`}
      role="toolbar"
      aria-label={copy.toolbarLabel}
      aria-orientation="horizontal"
      aria-disabled={disabled || undefined}
      ref={rootRef}
      onKeyDown={handleToolbarKeyDown}
    >
      <div className="editor-toolbar-slot">
        <ToolbarButton
          toolbarId="heading"
          label={headingLabelText}
          className="editor-toolbar-heading-trigger"
          active={formatState.headingLevel > 0}
          tabStop={tabStopId === 'heading'}
          onFocus={() => setTabStopId('heading')}
          disabled={disabled}
          popup="menu"
          expanded={openMenu === 'heading'}
          controls={headingMenuId}
          onClick={() => toggleMenu('heading')}
          onKeyDown={(event) => handleTriggerKeyDown('heading', event)}
        >
          <span className="editor-toolbar-heading-label editor-toolbar-heading-label-full">
            {headingLabel}
          </span>
          <span
            className="editor-toolbar-heading-label editor-toolbar-heading-label-compact"
            aria-hidden="true"
          >
            {headingCompactLabel}
          </span>
          <Icon name="chevron" className="editor-toolbar-chevron" />
        </ToolbarButton>
        {openMenu === 'heading' ? (
          <div
            id={headingMenuId}
            ref={menuPanelRef}
            className="editor-toolbar-popover editor-toolbar-heading-menu"
            role="menu"
            aria-label={copy.headingMenuLabel}
            style={menuPlacement ?? undefined}
            onKeyDown={(event) => moveMenuFocus(event, menuPanelRef.current)}
          >
            {headingItems.map((item) => (
              <button
                key={item.level}
                type="button"
                role="menuitemradio"
                aria-checked={formatState.headingLevel === item.level}
                tabIndex={-1}
                className="editor-toolbar-menu-item editor-toolbar-heading-item"
                onMouseDown={keepEditorFocus}
                onClick={() => applyHeading(item.level)}
              >
                <span
                  className={`editor-toolbar-heading-sample is-level-${item.level}`}
                  aria-hidden="true"
                >
                  {item.sample}
                </span>
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <ToolbarButton
        toolbarId="bold"
        label={copy.bold}
        tabStop={tabStopId === 'bold'}
        onFocus={() => setTabStopId('bold')}
        disabled={disabled}
        onClick={() => applySimple(formatBold)}
        pressed={formatState.bold}
        active={formatState.bold}
      >
        <span className="editor-toolbar-glyph is-bold" aria-hidden="true">B</span>
      </ToolbarButton>
      <ToolbarButton
        toolbarId="italic"
        label={copy.italic}
        tabStop={tabStopId === 'italic'}
        onFocus={() => setTabStopId('italic')}
        disabled={disabled}
        onClick={() => applySimple(formatItalic)}
        pressed={formatState.italic}
        active={formatState.italic}
      >
        <span className="editor-toolbar-glyph is-italic" aria-hidden="true">I</span>
      </ToolbarButton>

      <div className="editor-toolbar-slot">
        <ToolbarButton
          toolbarId="list"
          label={listLabel}
          className="editor-toolbar-list-trigger"
          tabStop={tabStopId === 'list'}
          onFocus={() => setTabStopId('list')}
          disabled={disabled}
          popup="menu"
          expanded={openMenu === 'list'}
          controls={listMenuId}
          active={formatState.list !== null}
          onClick={() => toggleMenu('list')}
          onKeyDown={(event) => handleTriggerKeyDown('list', event)}
        >
          <Icon name={listIcon} />
          <Icon name="chevron" className="editor-toolbar-chevron" />
        </ToolbarButton>
        {openMenu === 'list' ? (
          <div
            id={listMenuId}
            ref={menuPanelRef}
            className="editor-toolbar-popover editor-toolbar-list-menu"
            role="menu"
            aria-label={copy.listMenuLabel}
            style={menuPlacement ?? undefined}
            onKeyDown={(event) => moveMenuFocus(event, menuPanelRef.current)}
          >
            {listOptions.map((item) => (
              <button
                key={item.type}
                type="button"
                role="menuitemradio"
                aria-checked={formatState.list === item.type}
                tabIndex={-1}
                className="editor-toolbar-menu-item editor-toolbar-list-item"
                onMouseDown={keepEditorFocus}
                onClick={() => applySimple(item.command)}
              >
                <Icon name={item.icon} className="editor-toolbar-menu-icon" />
                <span>{item.label}</span>
              </button>
            ))}
            <div className="editor-toolbar-menu-divider" role="separator" />
            {listActions.map((item) => (
              <button
                key={item.labelKey}
                type="button"
                role="menuitem"
                tabIndex={-1}
                className="editor-toolbar-menu-item editor-toolbar-list-item"
                onMouseDown={keepEditorFocus}
                onClick={() => applySimple(item.command)}
              >
                <Icon name={item.icon} className="editor-toolbar-menu-icon" />
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <ToolbarButton
        toolbarId="link"
        label={copy.insertLink}
        className="editor-toolbar-desktop-only"
        tabStop={tabStopId === 'link'}
        onFocus={() => setTabStopId('link')}
        disabled={disabled}
        onClick={() => applySimple(insertLink)}
      >
        <Icon name="link" />
      </ToolbarButton>

      <div className="editor-toolbar-slot">
        <ToolbarButton
          toolbarId="insert"
          label={copy.insert}
          className="editor-toolbar-insert-trigger"
          tabStop={tabStopId === 'insert'}
          onFocus={() => setTabStopId('insert')}
          disabled={disabled}
          popup="menu"
          expanded={openMenu === 'insert' || openMenu === 'emoji'}
          controls={openMenu === 'emoji' ? emojiMenuId : insertMenuId}
          onClick={() => toggleMenu('insert')}
          onKeyDown={(event) => handleTriggerKeyDown('insert', event)}
        >
          <Icon name="plus" />
          <span className="editor-toolbar-insert-label">{copy.insert}</span>
          <Icon name="chevron" className="editor-toolbar-chevron" />
        </ToolbarButton>
        {openMenu === 'insert' ? (
          <div
            id={insertMenuId}
            ref={menuPanelRef}
            className="editor-toolbar-popover editor-toolbar-insert-menu"
            role="menu"
            aria-label={copy.insertMenuLabel}
            style={menuPlacement ?? undefined}
            onKeyDown={(event) => moveMenuFocus(event, menuPanelRef.current)}
          >
            {insertItems.map((item) => (
              <button
                key={item.labelKey}
                type="button"
                role="menuitem"
                tabIndex={-1}
                className="editor-toolbar-menu-item editor-toolbar-insert-item"
                onMouseDown={keepEditorFocus}
                onClick={() => applySimple(item.command)}
              >
                <Icon name={item.icon} className="editor-toolbar-menu-icon" />
                <span>{item.label}</span>
              </button>
            ))}
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="editor-toolbar-menu-item editor-toolbar-insert-item"
              onMouseDown={keepEditorFocus}
              onClick={() => setOpenMenu('emoji')}
            >
              <Icon name="smile" className="editor-toolbar-menu-icon" />
              <span>{copy.emoji}</span>
            </button>
          </div>
        ) : null}
        {openMenu === 'emoji' ? (
          <div
            id={emojiMenuId}
            ref={menuPanelRef}
            className="editor-toolbar-popover editor-toolbar-emoji-menu"
            role="menu"
            aria-label={copy.insertEmojiMenuLabel}
            onKeyDown={(event) => moveEmojiFocus(event, emojiGridRef.current)}
          >
            <div className="editor-toolbar-emoji-grid" ref={emojiGridRef}>
              {EMOJIS.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  className="editor-toolbar-emoji"
                  aria-label={copy.insertEmojiLabel(emoji)}
                  onMouseDown={keepEditorFocus}
                  onClick={() => applyEmoji(emoji)}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>

      <div className="editor-toolbar-slot editor-toolbar-slot-native">
        <ToolbarButton
          toolbarId="components"
          label={copy.componentsTriggerLabel}
          className="editor-toolbar-components-trigger"
          tabStop={tabStopId === 'components'}
          onFocus={() => setTabStopId('components')}
          disabled={disabled}
          popup="dialog"
          expanded={openMenu === 'native'}
          controls={nativeMenuId}
          onClick={() => toggleMenu('native')}
          onKeyDown={(event) => handleTriggerKeyDown('native', event)}
        >
          <Icon name="sparkle" />
          <span className="editor-toolbar-components-label editor-toolbar-components-label-full">{copy.componentsLabel}</span>
          <span className="editor-toolbar-components-label editor-toolbar-components-label-compact">{copy.componentsCompactLabel}</span>
        </ToolbarButton>
        {openMenu === 'native' ? (
          <div
            id={nativeMenuId}
            ref={menuPanelRef}
            className="editor-toolbar-popover editor-toolbar-native-menu"
            role="dialog"
            aria-label={copy.nativeMenuLabel}
            onKeyDown={(event) => moveMenuFocus(event, menuPanelRef.current)}
          >
            <div className="editor-toolbar-native-head">
              <span className="editor-toolbar-native-title">{copy.nativeTitle}</span>
              <button
                type="button"
                className="editor-toolbar-close"
                aria-label={copy.closeNativeLabel}
                onMouseDown={keepEditorFocus}
                onClick={closeNativePicker}
              >
                <Icon name="close" />
              </button>
            </div>
            <div className="editor-toolbar-search">
              <Icon name="search" className="editor-toolbar-search-icon" />
              <input
                ref={searchRef}
                type="search"
                className="editor-toolbar-search-input"
                value={query}
                placeholder={copy.searchPlaceholder}
                aria-label={copy.searchLabel}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <div className="editor-toolbar-native-scroll" role="menu" aria-label={copy.nativeListLabel}>
              {filteredGroups.length === 0 ? (
                <p className="editor-toolbar-menu-empty">{copy.noMatchingComponents}</p>
              ) : (
                filteredGroups.map(({ group, components }) => (
                  <div
                    key={group.id}
                    className="editor-toolbar-native-group"
                    role="group"
                    aria-label={group.label}
                  >
                    <div className="editor-toolbar-native-group-title" aria-hidden="true">
                      {group.label}
                    </div>
                    {components.map((component) => (
                      <button
                        key={component.id}
                        type="button"
                        role="menuitem"
                        tabIndex={-1}
                        className="editor-toolbar-native-item"
                        onMouseDown={keepEditorFocus}
                        onClick={() => applyNativeComponent(component)}
                      >
                        <span className="editor-toolbar-native-copy">
                          <span className="editor-toolbar-native-label">
                            {component.label}
                            {component.inline ? (
                              <span className="editor-toolbar-native-badge">{copy.inlineBadge}</span>
                            ) : null}
                          </span>
                          <span className="editor-toolbar-native-description">
                            {component.description}
                          </span>
                        </span>
                        <Icon name="plus" className="editor-toolbar-native-add" />
                      </button>
                    ))}
                  </div>
                ))
              )}
            </div>
          </div>
        ) : null}
      </div>

      <div className="editor-toolbar-history" role="group" aria-label={copy.historyLabel}>
        <ToolbarButton
          toolbarId="undo"
          label={copy.undo}
          className="editor-toolbar-desktop-only"
          tabStop={tabStopId === 'undo'}
          onFocus={() => setTabStopId('undo')}
          disabled={disabled || !canUndo}
          onClick={handleUndo}
        >
          <Icon name="undo" />
        </ToolbarButton>
        <ToolbarButton
          toolbarId="redo"
          label={copy.redo}
          className="editor-toolbar-desktop-only"
          tabStop={tabStopId === 'redo'}
          onFocus={() => setTabStopId('redo')}
          disabled={disabled || !canRedo}
          onClick={handleRedo}
        >
          <Icon name="redo" />
        </ToolbarButton>
        {showExport ? (
          <ToolbarButton
            toolbarId="download"
            label={copy.download}
            className="editor-toolbar-desktop-only"
            tabStop={tabStopId === 'download'}
            onFocus={() => setTabStopId('download')}
            disabled={disabled}
            onClick={handleExport}
          >
            <Icon name="download" />
          </ToolbarButton>
        ) : null}

        <div className="editor-toolbar-slot editor-toolbar-mobile-only">
          <ToolbarButton
            toolbarId="more"
            label={copy.more}
            className="editor-toolbar-more-trigger"
            tabStop={tabStopId === 'more'}
            onFocus={() => setTabStopId('more')}
            disabled={disabled}
            popup="menu"
            expanded={openMenu === 'more'}
            controls={moreMenuId}
            onClick={() => toggleMenu('more')}
            onKeyDown={(event) => handleTriggerKeyDown('more', event)}
          >
            <Icon name="more" />
          </ToolbarButton>
          {openMenu === 'more' ? (
            <div
              id={moreMenuId}
              ref={menuPanelRef}
              className="editor-toolbar-popover editor-toolbar-more-menu"
              role="menu"
              aria-label={copy.moreMenuLabel}
              style={menuPlacement ?? undefined}
              onKeyDown={(event) => moveMenuFocus(event, menuPanelRef.current)}
            >
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                className="editor-toolbar-menu-item editor-toolbar-more-item editor-toolbar-more-link"
                onMouseDown={keepEditorFocus}
                onClick={() => applySimple(insertLink)}
              >
                <Icon name="link" className="editor-toolbar-menu-icon" />
                <span>{copy.linkMenuItem}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                className="editor-toolbar-menu-item editor-toolbar-more-item"
                disabled={!canUndo}
                onMouseDown={keepEditorFocus}
                onClick={handleUndo}
              >
                <Icon name="undo" className="editor-toolbar-menu-icon" />
                <span>{copy.undo}</span>
              </button>
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                className="editor-toolbar-menu-item editor-toolbar-more-item"
                disabled={!canRedo}
                onMouseDown={keepEditorFocus}
                onClick={handleRedo}
              >
                <Icon name="redo" className="editor-toolbar-menu-icon" />
                <span>{copy.redo}</span>
              </button>
              {showExport ? (
                <button
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  className="editor-toolbar-menu-item editor-toolbar-more-item"
                  onMouseDown={keepEditorFocus}
                  onClick={handleExport}
                >
                  <Icon name="download" className="editor-toolbar-menu-icon" />
                  <span>{copy.download}</span>
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
