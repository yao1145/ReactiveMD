import { scanHtmlAttributes } from '../parsing/html-attributes';
import type { LocalAuthorBlock, LocalDocumentCapabilities, LocalHtmlPolicy, LocalNode } from '../types';
import { openingTag } from './compiler-attributes';
import { reportWarning, type CompileState } from './compiler-services';
import { unsupportedAuthorCssRules } from '../css/author-css';
import { MAX_LOCAL_DIAGNOSTICS } from '../configuration/limits';

const HIDDEN_COMPONENTS = new Set(['computed', 'const', 'external', 'validation', 'option', 'column', 'edge', 'step']);
const DOCUMENT_HTML_TAGS = new Set(['html', 'head', 'body', 'base', 'title', 'link', 'meta', 'style', 'script']);

export function compileDocumentCapabilities(
  state: CompileState,
  policy: LocalHtmlPolicy,
  maxSyntaxNodes: number,
): LocalDocumentCapabilities | undefined {
  const styles: LocalAuthorBlock[] = [];
  const scripts: LocalAuthorBlock[] = [];
  const componentStyles: Record<string, string> = Object.create(null);
  const actionTargets: Record<string, string> = Object.create(null);
  const duplicateIds = new Set<string>();
  let hasCapabilities = false;
  let cssIssueBudget = MAX_LOCAL_DIAGNOSTICS;
  const warn = (code: string, start: number, end: number, params?: Record<string, string>) => {
    reportWarning(state, code, { key: code, params }, start, end);
  };
  const transform = (nodes: LocalNode[]): LocalNode[] => nodes.flatMap(node => {
    const { type, name, attrs, range } = node;
    if (type === 'authorCss' || type === 'authorJavaScript') {
      const css = type === 'authorCss';
      const text = node.value ?? '';
      const start = range.start + openingTag(state.source, range.start, range.end).length;
      if (css ? policy.enableCss : policy.enableJavaScript) {
        (css ? styles : scripts).push({ text, range: { start, end: start + text.length } });
        if (css && cssIssueBudget > 0) {
          const issues = unsupportedAuthorCssRules(text, cssIssueBudget);
          cssIssueBudget -= issues.length;
          for (const issue of issues) {
            warn('local.author.css-global-rule', start + issue.start, start + issue.end, { name: issue.name });
          }
        }
        hasCapabilities = true;
      } else {
        warn('local.author.disabled', range.start, start, { feature: css ? 'CSS' : 'JavaScript' });
      }
      return [];
    }
    if (type === 'extendedHtmlRaw') {
      const value = node.value ?? state.source.slice(range.start, range.end);
      const name = /^<([\w-]+)/.exec(value)?.[1].toLowerCase() ?? 'html';
      if (DOCUMENT_HTML_TAGS.has(name)) {
        warn('local.author.fragment-tag', range.start, range.end, { name });
        return [{ ...node, type: 'fallback', value }];
      }
      if (!policy.enableExtendedHtml || !state.htmlFragment) {
        reportWarning(state, 'local.html.fallback', { key: 'local.html.extended', params: { name } }, range.start, range.end);
        return [{ ...node, type: 'fallback', value }];
      }
      const checked = state.htmlFragment(value, policy, maxSyntaxNodes);
      for (const issue of checked.diagnostics) {
        reportWarning(state, issue.code, issue.message, range.start + issue.range.start,
          range.start + issue.range.end, { key: issue.messageKey ?? issue.code, params: issue.params });
      }
      if (!checked.markup) return [{ ...node, type: 'fallback', value }];
      hasCapabilities = true;
      return [{ ...node, type: 'extendedHtml', value }];
    }
    const children = node.children ? transform(node.children) : undefined;
    if ((type !== 'component' && type !== 'hostComponent') || !name || !attrs
      || (!Object.hasOwn(attrs, 'css') && !Object.hasOwn(attrs, 'action-id'))) {
      return [children ? { ...node, children } : node];
    }
    const attributes = { ...attrs };
    const schema = state.schemaByName.get(name);
    const head = openingTag(state.source, range.start, range.end);
    const tagLength = /^<[^\s/>]+/.exec(head)?.[0].length ?? 0;
    const scanned = scanHtmlAttributes(head.slice(tagLength), range.start + tagLength, value => value);
    const attributeRange = (attribute: string) => scanned.entries.find(item => item.name === attribute) ?? range;
    if (Object.hasOwn(attrs, 'css')) {
      const at = attributeRange('css');
      if (schema && Object.hasOwn(schema.props, 'css')) {
        warn('local.author.css-owned', at.start, at.end, { name });
      } else if (schema) {
        delete attributes.css;
        if (HIDDEN_COMPONENTS.has(name)) {
          warn('local.author.css-hidden', at.start, at.end, { name });
        } else if (!policy.enableCss) {
          warn('local.author.disabled', at.start, at.end, { feature: 'CSS' });
        } else {
          componentStyles[node.id] = attrs.css;
          hasCapabilities = true;
        }
      }
    }
    if (Object.hasOwn(attrs, 'action-id') && schema && !Object.hasOwn(schema.props, 'action-id')) {
      delete attributes['action-id'];
      const id = attrs['action-id'];
      const at = attributeRange('action-id');
      if (name !== 'counter' || !/^[A-Za-z][\w-]{0,63}$/.test(id)) {
        warn('local.author.action-invalid', at.start, at.end, { id });
      } else if (Object.hasOwn(actionTargets, id) || duplicateIds.has(id)) {
        duplicateIds.add(id);
        delete actionTargets[id];
        warn('local.author.action-duplicate', at.start, at.end, { id });
      } else {
        actionTargets[id] = node.id;
        hasCapabilities = true;
      }
    }
    return [{ ...node, attrs: attributes, ...(children ? { children } : {}) }];
  });
  state.nodes = transform(state.nodes);
  return hasCapabilities ? { policy, styles, scripts, componentStyles, actionTargets } : undefined;
}
