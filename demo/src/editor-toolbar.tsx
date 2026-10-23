/**
 * Floating editor toolbar for the Reactive MD playground.
 *
 * The toolbar only reads the textarea and hands pure `EditorEdit` results back
 * to the parent. The parent owns history, focus restoration and compilation.
 */

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
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
  type EditorEdit,
} from './editor-commands';
import {
  NATIVE_COMPONENT_GROUPS,
  NATIVE_COMPONENTS,
  renderNativeSnippet,
  type NativeComponentDefinition,
} from './native-components';

export interface EditorToolbarProps {
  editorRef: RefObject<HTMLTextAreaElement | null>;
  onEdit(edit: EditorEdit): void;
  onUndo(): void;
  onRedo(): void;
  canUndo: boolean;
  canRedo: boolean;
  onExport(): void;
}

type TextSelection = { start: number; end: number };
type MenuId = 'emoji' | 'heading' | 'native';
type HeadingLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6;
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
  | 'image'
  | 'table'
  | 'undo'
  | 'redo'
  | 'download'
  | 'chevron'
  | 'sparkle'
  | 'search'
  | 'plus';

const EMOJIS = [
  '😀', '😄', '😁', '😊', '🙂', '😉', '😍', '🤔',
  '😎', '😅', '😂', '🥳', '👍', '👎', '👏', '🙏',
  '💡', '✅', '❌', '⚠️', '🔥', '⭐', '🎉', '❤️',
  '💬', '📌', '🚀', '📈', '📉', '🧩', '⚙️', '🔍',
  '📎', '🗂️', '🕒', '✨',
] as const;

const HEADING_ITEMS: readonly { level: HeadingLevel; label: string; sample: string }[] = [
  { level: 0, label: '正文', sample: '¶' },
  { level: 1, label: '标题 1', sample: 'H1' },
  { level: 2, label: '标题 2', sample: 'H2' },
  { level: 3, label: '标题 3', sample: 'H3' },
  { level: 4, label: '标题 4', sample: 'H4' },
  { level: 5, label: '标题 5', sample: 'H5' },
  { level: 6, label: '标题 6', sample: 'H6' },
];

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
  label: string;
  onClick(): void;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  expanded?: boolean;
  popup?: 'menu' | 'dialog';
  controls?: string;
}

function ToolbarButton({
  label,
  onClick,
  children,
  className,
  disabled,
  expanded,
  popup,
  controls,
}: ToolbarButtonProps) {
  return (
    <button
      type="button"
      className={className ? `editor-toolbar-button ${className}` : 'editor-toolbar-button'}
      aria-label={label}
      title={label}
      aria-expanded={expanded}
      aria-haspopup={popup}
      aria-controls={controls}
      disabled={disabled}
      onMouseDown={keepEditorFocus}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function readEditor(editorRef: RefObject<HTMLTextAreaElement | null>) {
  const element = editorRef.current;
  const value = element?.value ?? '';
  const start = Math.max(0, Math.min(element?.selectionStart ?? 0, value.length));
  const end = Math.max(start, Math.min(element?.selectionEnd ?? 0, value.length));
  return { value, selection: { start, end }, selectedText: value.slice(start, end) };
}

function matchesQuery(component: NativeComponentDefinition, term: string): boolean {
  if (!term) return true;
  return (
    component.label.toLowerCase().includes(term) ||
    component.description.toLowerCase().includes(term) ||
    component.keywords.some((keyword) => keyword.toLowerCase().includes(term))
  );
}

export function EditorToolbar({
  editorRef,
  onEdit,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  onExport,
}: EditorToolbarProps): ReactElement {
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [openMenu, setOpenMenu] = useState<MenuId | null>(null);
  const [query, setQuery] = useState('');
  const idPrefix = useId();
  const emojiMenuId = `${idPrefix}-emoji-menu`;
  const headingMenuId = `${idPrefix}-heading-menu`;
  const nativeMenuId = `${idPrefix}-native-menu`;

  const filteredGroups = useMemo(() => {
    const term = query.trim().toLowerCase();
    return NATIVE_COMPONENT_GROUPS.map((group) => ({
      group,
      components: NATIVE_COMPONENTS.filter(
        (component) => component.group === group.id && matchesQuery(component, term),
      ),
    })).filter((entry) => entry.components.length > 0);
  }, [query]);

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
      setOpenMenu(null);
      editorRef.current?.focus();
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [openMenu, editorRef]);

  useEffect(() => {
    if (openMenu !== 'native') return;
    searchRef.current?.focus();
  }, [openMenu]);

  const toggleMenu = (menu: MenuId) => {
    setOpenMenu((current) => (current === menu ? null : menu));
    setQuery('');
  };

  const applySimple = (command: (value: string, selection: TextSelection) => EditorEdit) => {
    const { value, selection } = readEditor(editorRef);
    onEdit(command(value, selection));
    setOpenMenu(null);
  };

  const applyHeading = (level: HeadingLevel) => {
    const { value, selection } = readEditor(editorRef);
    onEdit(formatHeading(value, selection, level));
    setOpenMenu(null);
  };

  const applyEmoji = (emoji: string) => {
    const { value, selection } = readEditor(editorRef);
    onEdit(insertText(value, selection, emoji));
    setOpenMenu(null);
  };

  const applyNativeComponent = (component: NativeComponentDefinition) => {
    const { value, selection, selectedText } = readEditor(editorRef);
    const snippet = renderNativeSnippet(component, value, selectedText);
    onEdit(insertTemplate(value, selection, snippet, { block: !component.inline }));
    setOpenMenu(null);
  };

  const handleUndo = () => {
    setOpenMenu(null);
    onUndo();
  };

  const handleRedo = () => {
    setOpenMenu(null);
    onRedo();
  };

  const handleExport = () => {
    setOpenMenu(null);
    onExport();
  };

  return (
    <div className="editor-toolbar" role="toolbar" aria-label="文档编辑工具栏" ref={rootRef}>
      <ToolbarButton
        label="插入表情"
        popup="menu"
        expanded={openMenu === 'emoji'}
        controls={emojiMenuId}
        onClick={() => toggleMenu('emoji')}
      >
        <Icon name="smile" />
      </ToolbarButton>
      {openMenu === 'emoji' ? (
        <div
          id={emojiMenuId}
          className="editor-toolbar-popover editor-toolbar-emoji-menu"
          role="menu"
          aria-label="插入表情"
        >
          <div className="editor-toolbar-emoji-grid">
            {EMOJIS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                role="menuitem"
                className="editor-toolbar-emoji"
                title={`插入 ${emoji}`}
                aria-label={`插入表情 ${emoji}`}
                onMouseDown={keepEditorFocus}
                onClick={() => applyEmoji(emoji)}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <ToolbarButton
        label="标题"
        className="editor-toolbar-heading-trigger"
        popup="menu"
        expanded={openMenu === 'heading'}
        controls={headingMenuId}
        onClick={() => toggleMenu('heading')}
      >
        <span className="editor-toolbar-glyph is-heading" aria-hidden="true">H</span>
        <Icon name="chevron" className="editor-toolbar-chevron" />
      </ToolbarButton>
      {openMenu === 'heading' ? (
        <div
          id={headingMenuId}
          className="editor-toolbar-popover editor-toolbar-heading-menu"
          role="menu"
          aria-label="选择标题级别"
        >
          {HEADING_ITEMS.map((item) => (
            <button
              key={item.level}
              type="button"
              role="menuitem"
              className="editor-toolbar-heading-item"
              title={item.label}
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

      <ToolbarButton label="加粗" onClick={() => applySimple(formatBold)}>
        <span className="editor-toolbar-glyph is-bold" aria-hidden="true">B</span>
      </ToolbarButton>
      <ToolbarButton label="斜体" onClick={() => applySimple(formatItalic)}>
        <span className="editor-toolbar-glyph is-italic" aria-hidden="true">I</span>
      </ToolbarButton>
      <ToolbarButton label="删除线" onClick={() => applySimple(formatStrike)}>
        <span className="editor-toolbar-glyph is-strike" aria-hidden="true">S</span>
      </ToolbarButton>
      <ToolbarButton label="插入链接" onClick={() => applySimple(insertLink)}>
        <Icon name="link" />
      </ToolbarButton>

      <span className="editor-toolbar-separator" role="separator" aria-orientation="vertical" />

      <ToolbarButton label="无序列表" onClick={() => applySimple(formatBulletList)}>
        <Icon name="bulletList" />
      </ToolbarButton>
      <ToolbarButton label="有序列表" onClick={() => applySimple(formatOrderedList)}>
        <Icon name="orderedList" />
      </ToolbarButton>
      <ToolbarButton label="任务列表" onClick={() => applySimple(formatTaskList)}>
        <Icon name="taskList" />
      </ToolbarButton>
      <ToolbarButton label="减少缩进" onClick={() => applySimple(outdentSelection)}>
        <Icon name="outdent" />
      </ToolbarButton>
      <ToolbarButton label="增加缩进" onClick={() => applySimple(indentSelection)}>
        <Icon name="indent" />
      </ToolbarButton>
      <ToolbarButton label="引用" onClick={() => applySimple(formatQuote)}>
        <Icon name="quote" />
      </ToolbarButton>
      <ToolbarButton label="分隔线" onClick={() => applySimple(insertDivider)}>
        <Icon name="divider" />
      </ToolbarButton>
      <ToolbarButton label="代码块" onClick={() => applySimple(insertCodeBlock)}>
        <Icon name="codeBlock" />
      </ToolbarButton>
      <ToolbarButton label="行内代码" onClick={() => applySimple(formatInlineCode)}>
        <Icon name="inlineCode" />
      </ToolbarButton>
      <ToolbarButton label="插入图片" onClick={() => applySimple(insertImage)}>
        <Icon name="image" />
      </ToolbarButton>
      <ToolbarButton label="插入表格" onClick={() => applySimple(insertTable)}>
        <Icon name="table" />
      </ToolbarButton>

      <span className="editor-toolbar-separator" role="separator" aria-orientation="vertical" />

      <ToolbarButton
        label="插入原生组件"
        className="editor-toolbar-components-trigger"
        popup="dialog"
        expanded={openMenu === 'native'}
        controls={nativeMenuId}
        onClick={() => toggleMenu('native')}
      >
        <Icon name="sparkle" />
        <span className="editor-toolbar-components-label">组件</span>
      </ToolbarButton>
      {openMenu === 'native' ? (
        <div
          id={nativeMenuId}
          className="editor-toolbar-popover editor-toolbar-native-menu"
          role="dialog"
          aria-label="插入原生组件"
        >
          <div className="editor-toolbar-search">
            <Icon name="search" className="editor-toolbar-search-icon" />
            <input
              ref={searchRef}
              type="search"
              className="editor-toolbar-search-input"
              value={query}
              placeholder="搜索组件、说明或关键词"
              aria-label="搜索原生组件"
              autoComplete="off"
              spellCheck={false}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div className="editor-toolbar-native-scroll" role="menu" aria-label="原生组件列表">
            {filteredGroups.length === 0 ? (
              <p className="editor-toolbar-menu-empty">没有匹配的组件</p>
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
                      className="editor-toolbar-native-item"
                      title={`插入${component.label}`}
                      onMouseDown={keepEditorFocus}
                      onClick={() => applyNativeComponent(component)}
                    >
                      <span className="editor-toolbar-native-copy">
                        <span className="editor-toolbar-native-label">
                          {component.label}
                          {component.inline ? (
                            <span className="editor-toolbar-native-badge">行内</span>
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

      <div className="editor-toolbar-history" role="group" aria-label="历史与导出">
        <span className="editor-toolbar-separator" role="separator" aria-orientation="vertical" />
        <ToolbarButton label="撤销" disabled={!canUndo} onClick={handleUndo}>
          <Icon name="undo" />
        </ToolbarButton>
        <ToolbarButton label="重做" disabled={!canRedo} onClick={handleRedo}>
          <Icon name="redo" />
        </ToolbarButton>
        <ToolbarButton label="下载文档" onClick={handleExport}>
          <Icon name="download" />
        </ToolbarButton>
      </div>
    </div>
  );
}
