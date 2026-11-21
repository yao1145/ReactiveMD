import { useEffect, useMemo, useRef } from 'react';
import type { Diagnostic, LocalHtmlPolicy } from '../../types';
import { localize, useLocalLocale } from '../../../react/localization';
import {
  extendedFragmentDocument,
  extendedFragmentSandbox,
  sanitizeExtendedFragment,
  type ExtendedFragmentResult,
} from '../../html/extended-fragment';

export interface ExtendedHtmlFragmentProps {
  /** Raw fragment source as it appeared in the document, without its fence. */
  source: string;
  /** Effective policy for this mount (compile ceiling ∩ grants). */
  policy: LocalHtmlPolicy;
  /** Exact HTTPS origins this mount may frame; omission denies every remote frame. */
  allowedFrameOrigins?: readonly string[];
  inline?: boolean;
  sourceAttributes?: Record<string, string>;
  onDiagnostics?: (items: Diagnostic[]) => void;
}

/** Render sanitized inert HTML in the document and isolate active fragments. */
export function ExtendedHtmlFragment({
  source, policy, allowedFrameOrigins, inline, sourceAttributes, onDiagnostics,
}: ExtendedHtmlFragmentProps) {
  const locale = useLocalLocale();
  const granted = policy.enableExtendedHtml === true;
  const result = useMemo<ExtendedFragmentResult>(
    () => (granted
      ? sanitizeExtendedFragment(source, policy, Math.max(1_000, source.length * 2 + 10), allowedFrameOrigins)
      : { diagnostics: [] }),
    [granted, source, policy, allowedFrameOrigins],
  );
  const report = useRef(onDiagnostics);
  report.current = onDiagnostics;
  useEffect(() => {
    if (granted && result.diagnostics.length) report.current?.(result.diagnostics);
  }, [granted, result]);
  const Frame = inline ? 'span' : 'div';

  if (!granted || result.markup === undefined) {
    return (
      <Frame className="local-extended-fragment local-extended-fragment-fallback" data-extended-html="fallback" {...sourceAttributes}>
        <span className="local-fallback local-fallback-block" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
          {source}
        </span>
      </Frame>
    );
  }

  if (result.inlineSafe) {
    return <Frame className="local-extended-fragment" data-extended-html="direct" {...sourceAttributes}
      dangerouslySetInnerHTML={{ __html: result.markup }} />;
  }

  return (
    <Frame className="local-extended-fragment" data-extended-html="sandbox"
      data-rmd-snapshot-css={policy.enableCss ? '' : undefined} {...sourceAttributes}>
      <iframe
        key={`${Number(policy.enableCss)}${Number(policy.enableJavaScript)}${Number(policy.enableExtendedHtml)}:${source}`}
        className="local-extended-fragment-frame"
        title={localize(locale, 'Extended HTML fragment', '扩展 HTML 片段')}
        sandbox={extendedFragmentSandbox(policy)}
        referrerPolicy="no-referrer"
        srcDoc={extendedFragmentDocument(result.markup, policy, allowedFrameOrigins)}
        style={{ display: inline ? 'inline-block' : 'block', width: '100%', minHeight: '4rem', border: 0, background: 'transparent', colorScheme: 'light' }}
      />
    </Frame>
  );
}
