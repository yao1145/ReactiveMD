import { useEffect, useId, useRef } from 'react';
import { getLocalComponentRegistry } from '../../../assemblies/default-registry';
import { validateLocalDocumentConfig } from '../../../assemblies/default-config';
import { extensionDiagnostic, validateLocalComponentContracts } from '../../../export/requirements';
import { localDocumentRequiresRuntime } from '../../../local/compilation/runtime-requirement';
import { intersectCapabilityPolicy } from '../../../local/configuration/capability-policy';
import { diagnosticEnglish } from '../../../local/configuration/diagnostics';
import { scopeAuthorStyles } from '../../../local/css/author-css';
import { collectLocalFootnotes } from '../../../local/parsing/footnotes';
import { createHeadingAnchors } from '../../../local/parsing/heading-anchors';
import { LOCAL_SYNTAX_VERSION, type Diagnostic } from '../../../local/types';
import { resolveLocalTheme } from '../../../themes/document-theme';
import { LocalLocaleProvider, localize } from '../../localization';
import type { LocalDocumentViewProps } from './LocalDocumentViewCore';
import { EndnotesView, renderNodes } from './render-nodes';
import { useResolvedColorScheme } from './use-color-scheme';
import type { StaticRenderEnv } from './view-render-context';

export type LocalStaticDocumentViewProps = Pick<LocalDocumentViewProps,
  'document' | 'reactConfig' | 'themes' | 'colorScheme' | 'locale' | 'urlPolicy' | 'imageResolver'
  | 'allowedFrameOrigins' | 'capabilityGrants' | 'onDiagnostics'>;

export function staticDocumentDiagnostics({ document, reactConfig }: LocalStaticDocumentViewProps): Diagnostic[] {
  const key = 'local.render.runtime-required';
  if (document.syntax !== 'local' || document.syntaxVersion !== LOCAL_SYNTAX_VERSION
    || document.requiresRuntime !== false || localDocumentRequiresRuntime(document)) {
    return [{ ...extensionDiagnostic(key, diagnosticEnglish({ key })), messageKey: key }];
  }
  const config = reactConfig?.config;
  return [
    ...validateLocalDocumentConfig(document, config),
    ...validateLocalComponentContracts({ document, installed: getLocalComponentRegistry(config) }),
  ];
}

export function LocalStaticDocumentView(props: LocalStaticDocumentViewProps) {
  const { onDiagnostics } = props;
  const diagnostics = staticDocumentDiagnostics(props);
  const diagnostic = diagnostics[0];
  useEffect(() => {
    if (diagnostic) onDiagnostics?.([diagnostic]);
  }, [diagnostic?.code, diagnostic?.message, onDiagnostics]);
  if (diagnostic) return <p role="alert" className="local-extension-error">{diagnostic.message}</p>;
  return <StaticProjection {...props} />;
}

function StaticProjection({ document, reactConfig, themes, colorScheme = 'auto', locale = 'en', urlPolicy,
  imageResolver, allowedFrameOrigins, capabilityGrants, onDiagnostics }: LocalStaticDocumentViewProps) {
  const instanceId = useId();
  const rootRef = useRef<HTMLElement>(null);
  const scheme = useResolvedColorScheme(rootRef, colorScheme);
  const t = (en: string, zh: string) => localize(locale, en, zh);
  const theme = resolveLocalTheme(document.theme, reactConfig?.config.themes ?? themes, document.themeRange, document.source);
  const policy = intersectCapabilityPolicy(document.capabilities?.policy, capabilityGrants);
  const authorCss = policy.enableCss ? document.capabilities?.styles.map(style => scopeAuthorStyles(style.text)).join('\n') : undefined;
  const env: StaticRenderEnv = {
    source: document.source, mode: 'static', locale, t, rootRef, urlPolicy, imageResolver, allowedFrameOrigins,
    capabilityPolicy: { ...policy, enableJavaScript: false }, report: onDiagnostics,
    anchors: createHeadingAnchors(document, `local-heading-${instanceId}`),
    footnotes: collectLocalFootnotes(document, instanceId),
  };
  return <LocalLocaleProvider locale={locale}>
    <article ref={rootRef} className="md-document local-document local-static"
      lang={locale === 'zh' ? 'zh-CN' : 'en'} data-rmd-document="" data-rmd-theme={theme.name}
      data-rmd-snapshot-css={authorCss ? '' : undefined} data-render-mode="static" data-color-scheme={scheme}
      style={{ colorScheme: scheme }} aria-label={t('Static document', '静态文档')}>
      {authorCss && <style data-rmd-author-css="" dangerouslySetInnerHTML={{ __html: authorCss }} />}
      {renderNodes(env, document.nodes, true)}
      {env.footnotes.entries.length > 0 && <EndnotesView entries={env.footnotes.entries} env={env} t={t}
        titleId={`${instanceId}-footnotes-title`} />}
    </article>
  </LocalLocaleProvider>;
}
