import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { common, createLowlight } from 'lowlight';
import latex from 'highlight.js/lib/languages/latex';
import django from 'highlight.js/lib/languages/django';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import type { Element, RootContent } from 'hast';
import { useLocalize } from './i18n';
import { cattca, mermaid, vue } from './code-languages';

/**
 * Fenced code blocks with optional syntax highlighting and a copy button.
 *
 * Highlighting is renderer-only and never trusts source as HTML: lowlight
 * produces a hast tree whose text and span nodes are mapped back to React text
 * and span elements. Unknown languages, oversized sources, mismatched text and
 * highlighting failures all fall back to the exact source value.
 */

/** Sources longer than this render as plain text; highlighting cost grows with input. */
export const MAX_HIGHLIGHT_CHARS = 20_000;

const MAX_HIGHLIGHT_NODES = 20_000;
const MAX_TOKEN_DEPTH = 100;
const COPY_FEEDBACK_MS = 2_000;

const lowlight = createLowlight(common);
lowlight.register({latex, django, dockerfile, cattca, mermaid, vue});

// Keep detection bounded to common, distinguishable grammars. Explicit language
// names can still select every registered grammar, including mixed Vue SFCs.
const AUTO_LANGUAGES = [
  'javascript', 'typescript', 'python', 'bash', 'json', 'yaml', 'sql',
  'xml', 'css', 'java', 'cpp', 'rust', 'go', 'latex', 'dockerfile', 'mermaid', 'cattca', 'django',
];

/**
 * Aliases people use in fenced code blocks. Registered highlight.js aliases
 * win; this map covers spellings that grammars do not register themselves.
 */
const LANGUAGE_ALIASES: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  py: 'python',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  html: 'xml',
  htm: 'xml',
  svg: 'xml',
  xml: 'xml',
  json: 'json',
  jsonc: 'json',
  json5: 'json',
  css: 'css',
  md: 'markdown',
  markdown: 'markdown',
  yml: 'yaml',
  yaml: 'yaml',
  tex: 'latex',
  jinja: 'django',
  jinja2: 'django',
  j2: 'django',
  docker: 'dockerfile',
  text: 'plaintext',
  txt: 'plaintext',
  plain: 'plaintext',
  nohighlight: 'plaintext',
};

function normalizeLanguage(language: string | undefined): string | null {
  if (language === undefined) return null;
  let name = language.trim().toLowerCase();
  if (name.startsWith('language-')) name = name.slice('language-'.length);
  return name === '' ? null : name;
}

function resolveLanguage(name: string): string | null {
  const alias = Object.hasOwn(LANGUAGE_ALIASES, name) ? LANGUAGE_ALIASES[name] : undefined;
  if (alias !== undefined && lowlight.registered(alias)) return alias;
  if (lowlight.registered(name)) return name;
  return null;
}

function safeClassName(properties: Element['properties']): string | undefined {
  const raw: unknown = properties.className;
  const values: unknown[] = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
  const safe = values.filter(
    (value): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value),
  );
  return safe.length > 0 ? safe.join(' ') : undefined;
}

/**
 * Concatenate the hast text while rejecting anything that is not text or a
 * span. The result must equal the source exactly; otherwise the caller keeps
 * the original string, so whitespace and newlines cannot drift.
 */
function flattenText(children: readonly RootContent[]): string | null {
  let text = '';
  let nodes = 0;
  const stack: RootContent[] = [...children].reverse();
  while (stack.length > 0) {
    const node = stack.pop()!;
    nodes += 1;
    if (nodes > MAX_HIGHLIGHT_NODES) return null;
    if (node.type === 'text') {
      text += node.value;
      continue;
    }
    if (node.type !== 'element' || node.tagName !== 'span') return null;
    for (let index = node.children.length - 1; index >= 0; index -= 1) {
      stack.push(node.children[index]);
    }
  }
  return text;
}

function renderTokens(children: readonly RootContent[], depth = 0): ReactNode[] {
  if (depth > MAX_TOKEN_DEPTH) {
    throw new Error('Code token tree is nested too deeply.');
  }
  return children.map((node, index) => {
    if (node.type === 'text') return node.value;
    if (node.type === 'element' && node.tagName === 'span') {
      return (
        <span key={index} className={safeClassName(node.properties)}>
          {renderTokens(node.children, depth + 1)}
        </span>
      );
    }
    return null;
  });
}

export interface CodeHighlight {
  /** Highlighted children, or `null` when the source should render verbatim. */
  nodes: ReactNode[] | null;
  highlighted: boolean;
  /** Resolved grammar, including the detected language for unlabeled blocks. */
  language?: string;
}

/** Highlight explicit languages, or detect unlabeled code with bounded grammars. */
export function highlightCode(value: string, language?: string): CodeHighlight {
  const requested = normalizeLanguage(language);
  if (value === '' || value.length > MAX_HIGHLIGHT_CHARS) {
    return { nodes: null, highlighted: false };
  }
  const resolved = requested === null ? null : resolveLanguage(requested);
  if (requested !== null && (resolved === null || resolved === 'plaintext')) return { nodes: null, highlighted: false };

  try {
    const tree = resolved === null
      ? lowlight.highlightAuto(value, {subset: AUTO_LANGUAGES})
      : lowlight.highlight(resolved, value);
    if (resolved === null && (!tree.data?.language || (tree.data.relevance ?? 0) < 2)) return {nodes: null, highlighted: false};
    if (flattenText(tree.children) !== value) return { nodes: null, highlighted: false };
    const nodes = renderTokens(tree.children);
    if (nodes.length === 0 && value !== '') return { nodes: null, highlighted: false };
    return { nodes, highlighted: true, language: resolved ?? tree.data?.language };
  } catch {
    return { nodes: null, highlighted: false };
  }
}

/* ------------------------------------------------------------------ copy */

function legacyCopy(text: string): boolean {
  if (typeof document === 'undefined' || document.body === null) return false;

  const active = document.activeElement;
  const selection = typeof window === 'undefined' ? null : window.getSelection();
  const ranges: Range[] = [];
  if (selection !== null) {
    for (let index = 0; index < selection.rangeCount; index += 1) {
      ranges.push(selection.getRangeAt(index).cloneRange());
    }
  }

  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.setAttribute('aria-hidden', 'true');
  area.tabIndex = -1;
  area.style.position = 'fixed';
  area.style.top = '-1000px';
  area.style.left = '-1000px';
  area.style.opacity = '0';
  document.body.appendChild(area);

  let copied = false;
  try {
    area.focus({ preventScroll: true });
    area.select();
    area.setSelectionRange(0, area.value.length);
    copied = typeof document.execCommand === 'function' && document.execCommand('copy');
  } catch {
    copied = false;
  } finally {
    area.remove();
    if (active !== null && typeof (active as HTMLElement).focus === 'function') {
      try {
        (active as HTMLElement).focus({ preventScroll: true });
      } catch {
        // Focus restoration is best effort; the copy result already stands.
      }
    }
    if (selection !== null) {
      selection.removeAllRanges();
      for (const range of ranges) selection.addRange(range);
    }
  }
  return copied;
}

async function writeClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard
    && typeof navigator.clipboard.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return legacyCopy(text);
    }
  }
  return legacyCopy(text);
}

/* ------------------------------------------------------------- component */

type CopyFeedback = 'idle' | 'success' | 'error';

interface CopyFeedbackState {
  /** The source value the feedback belongs to. */
  value: string;
  state: CopyFeedback;
}

export interface CodeBlockViewProps {
  value: string;
  language?: string;
  mode: 'interactive' | 'static';
  /** Renderer-validated P0 HTML attributes, never raw source attributes. */
  htmlProps?: Record<string, string>;
}

const SAFE_LANGUAGE_CLASS = /^[a-z0-9][a-z0-9+#._-]*$/;

export function CodeBlockView({ value, language, mode, htmlProps }: CodeBlockViewProps): ReactElement {
  const t = useLocalize();
  const highlight = useMemo(() => highlightCode(value, language), [value, language]);
  const [feedback, setFeedback] = useState<CopyFeedbackState>({ value, state: 'idle' });
  const valueRef = useRef(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  valueRef.current = value;
  // A stale success label never survives into a different source value, even
  // for the frame before the reset effect runs.
  const feedbackState: CopyFeedback = feedback.value === value ? feedback.state : 'idle';

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  // A new source value belongs to a new block state: drop any old feedback and
  // invalidate in-flight copies before they can report against the new value.
  useEffect(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setFeedback({ value, state: 'idle' });
  }, [value]);

  const copy = useCallback(async (): Promise<void> => {
    const expected = value;
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    const ok = await writeClipboard(expected);
    if (!mountedRef.current || valueRef.current !== expected) return;
    setFeedback({ value: expected, state: ok ? 'success' : 'error' });
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      if (!mountedRef.current) return;
      setFeedback((current) => (
        current.value === expected ? { value: expected, state: 'idle' } : current
      ));
    }, COPY_FEEDBACK_MS);
  }, [value]);

  const requested = normalizeLanguage(language);
  const label = language !== undefined && language.trim() !== '' ? language.trim() : highlight.language ?? t('Text', '文本');
  const classLanguage = requested ?? highlight.language;
  const codeClass = [
    highlight.highlighted ? 'hljs' : '',
    classLanguage && SAFE_LANGUAGE_CLASS.test(classLanguage) ? `language-${classLanguage}` : '',
  ].filter((item) => item !== '').join(' ') || undefined;

  const feedbackText = feedbackState === 'success'
    ? t('Copied', '已复制')
    : feedbackState === 'error' ? t('Copy failed', '复制失败') : '';

  return (
    <div className="md-code-block" data-code-mode={mode}>
      <div className="md-code-block-toolbar">
        <span className="md-code-block-language">{label}</span>
        {mode === 'interactive' && (
          <>
            <span
              className="md-code-block-feedback"
              data-state={feedbackState}
              role="status"
              aria-live="polite"
            >
              {feedbackText}
            </span>
            <button
              type="button"
              className="md-code-block-copy"
              aria-label={t('Copy code', '复制代码')}
              onClick={() => {
                void copy();
              }}
            >
              {t('Copy', '复制')}
            </button>
          </>
        )}
      </div>
      <pre className="md-code" {...htmlProps}>
        <code className={codeClass}>{highlight.nodes ?? value}</code>
      </pre>
    </div>
  );
}
