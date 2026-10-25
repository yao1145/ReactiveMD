import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { compileLocal, type LocalCompileOptions, type LocalDocument } from 'reactive-md';
import { ExportDialog } from '../src/export-dialog';
import { HtmlCompatibilityControls } from '../src/html-compatibility';
import {
  DEFAULT_HTML_OPTIONS,
  compileOptionsKey,
  freshHtmlOptions,
  isHtmlOptionsActive,
  toCompileOptions,
  type DemoHtmlOptions,
} from '../src/html-options';
import { COPY, LanguageProvider } from '../src/i18n';

type HtmlPolicy = {
  enableCss: boolean;
  enableJavaScript: boolean;
  enableExtendedHtml: boolean;
};

function options(overrides: Partial<DemoHtmlOptions> = {}): DemoHtmlOptions {
  return { ...DEFAULT_HTML_OPTIONS, ...overrides };
}

const EMPTY_DOCUMENT: LocalDocument = {
  syntax: 'local',
  source: '<p>Native HTML</p>',
  nodes: [],
  initialState: {},
  bindings: {},
};

describe('HTML compatibility options', () => {
  it('starts every capability disabled and keeps the ReactiveMD route explicit', () => {
    expect(DEFAULT_HTML_OPTIONS).toEqual({
      enableCss: false,
      enableJavaScript: false,
      enableExtendedHtml: false,
    });
    expect(isHtmlOptionsActive(DEFAULT_HTML_OPTIONS)).toBe(false);
    expect(toCompileOptions(DEFAULT_HTML_OPTIONS)).toBeUndefined();
    expect(toCompileOptions(undefined)).toBeUndefined();
    expect(toCompileOptions({ enableCss: false })).toBeUndefined();
    expect(compileOptionsKey(undefined)).toBe(compileOptionsKey(options()));
  });

  it('routes the whole document to native HTML when any capability is enabled', () => {
    for (const key of ['enableCss', 'enableJavaScript', 'enableExtendedHtml'] as const) {
      const chosen = options({ [key]: true });
      expect(isHtmlOptionsActive(chosen), key).toBe(true);
      expect(toCompileOptions(chosen), key).toEqual({
        enableCss: key === 'enableCss',
        enableJavaScript: key === 'enableJavaScript',
        enableExtendedHtml: key === 'enableExtendedHtml',
      });
      expect(compileOptionsKey(toCompileOptions(chosen)), key).not.toBe(compileOptionsKey(undefined));
    }
  });

  it('preserves compile limits when converting the switches', () => {
    const converted = toCompileOptions({
      ...options({ enableExtendedHtml: true }),
      limits: { maxSyntaxNodes: 42 },
    });
    expect(converted).toEqual({
      enableCss: false,
      enableJavaScript: false,
      enableExtendedHtml: true,
      limits: { maxSyntaxNodes: 42 },
    });
  });

  it('compiles the safe route as ReactiveMD and any granted route as native HTML', () => {
    const safe = compileLocal('# Heading');
    expect(safe.ok).toBe(true);
    if (safe.ok) {
      expect((safe.document as LocalDocument & { html?: HtmlPolicy }).html).toBeUndefined();
      expect(safe.document.source).toBe('# Heading');
    }

    const nativeOptions: LocalCompileOptions | undefined = toCompileOptions(options({ enableCss: true }));
    const native = compileLocal('<p>Hello</p>', nativeOptions);
    expect(native.ok).toBe(true);
    if (native.ok) {
      expect((native.document as LocalDocument & { html?: HtmlPolicy }).html).toEqual({
        enableCss: true,
        enableJavaScript: false,
        enableExtendedHtml: false,
      });
      expect(native.document.source).toBe('<p>Hello</p>');
      expect(native.document.bindings).toEqual({});
      expect(native.document.initialState).toEqual({});
    }
  });
});

describe('HTML compatibility controls', () => {
  it('renders three unchecked toggles and the safe mode by default', () => {
    const markup = renderToStaticMarkup(
      <LanguageProvider language="en">
        <HtmlCompatibilityControls options={options()} onChange={() => {}} />
      </LanguageProvider>,
    );
    expect(markup.match(/type="checkbox"/g)).toHaveLength(3);
    expect(markup.match(/checked=""/g) ?? []).toHaveLength(0);
    expect(markup).toContain(COPY.en.htmlCompatibility.policy);
    expect(markup).toContain(COPY.en.htmlCompatibility.modeReactive);
    expect(markup).toContain(COPY.en.htmlCompatibility.css);
    expect(markup).toContain(COPY.en.htmlCompatibility.javascript);
    expect(markup).toContain(COPY.en.htmlCompatibility.extendedHtml);
    expect(markup).not.toContain(COPY.en.htmlCompatibility.modeHtml);
  });

  it('shows the native HTML mode once any toggle is enabled', () => {
    const markup = renderToStaticMarkup(
      <LanguageProvider language="zh">
        <HtmlCompatibilityControls
          options={options({ enableJavaScript: true })}
          onChange={() => {}}
        />
      </LanguageProvider>,
    );
    expect(markup.match(/checked=""/g) ?? []).toHaveLength(1);
    expect(markup).toContain(COPY.zh.htmlCompatibility.modeHtml);
    expect(markup).not.toContain(COPY.zh.htmlCompatibility.modeReactive);
    expect(markup).toContain('暂时性分流政策');
    expect(markup).toContain('JavaScript');
  });

  it('keeps both locales complete and distinct', () => {
    expect(COPY.en.htmlCompatibility.css).toBe('CSS');
    expect(COPY.zh.htmlCompatibility.css).toBe('CSS');
    expect(COPY.en.htmlCompatibility.javascript).toBe('JavaScript');
    expect(COPY.zh.htmlCompatibility.javascript).toBe('JavaScript');
    expect(COPY.zh.htmlCompatibility.extendedHtml).toContain('HTML');
    expect(COPY.en.htmlCompatibility.extendedHtml).not.toBe(COPY.zh.htmlCompatibility.extendedHtml);
    expect(COPY.en.htmlCompatibility.policy).toContain('Temporary');
    expect(COPY.zh.htmlCompatibility.policy).toContain('暂时性分流政策');
  });
});

describe('export dialog in native HTML mode', () => {
  it('describes the HTML route and disables state-only operations', () => {
    const markup = renderToStaticMarkup(
      <LanguageProvider language="en">
        <ExportDialog
          open
          source="<p>Hello</p>"
          baseName="native"
          document={EMPTY_DOCUMENT}
          currentState={{}}
          pending={false}
          compileError={null}
          compileOptions={{ enableCss: true }}
          dark={false}
          onClose={() => {}}
          onDownloadMarkdown={() => {}}
        />
      </LanguageProvider>,
    );
    expect(markup).toContain(COPY.en.exportDialog.htmlModeNotice);
    expect(markup).toContain(COPY.en.exportDialog.htmlModeParameters);
    expect(markup).toContain(COPY.en.exportDialog.htmlModeImages);
    expect(markup).toContain(COPY.en.exportDialog.htmlModeStateNote);
    expect(markup).toContain(COPY.en.exportDialog.exportStateHtmlMode);
    expect(markup).toContain(COPY.en.exportDialog.exportMarkdown);
  });

  it('keeps the ReactiveMD summary when all capabilities are off', () => {
    const markup = renderToStaticMarkup(
      <LanguageProvider language="en">
        <ExportDialog
          open
          source="# Hello"
          baseName="safe"
          document={{ ...EMPTY_DOCUMENT, source: '# Hello' }}
          currentState={{}}
          pending={false}
          compileError={null}
          compileOptions={toCompileOptions(options())}
          dark={false}
          onClose={() => {}}
          onDownloadMarkdown={() => {}}
        />
      </LanguageProvider>,
    );
    expect(markup).not.toContain(COPY.en.exportDialog.htmlModeNotice);
    expect(markup).toContain(COPY.en.exportDialog.noParameters);
    expect(markup).toContain(COPY.en.exportDialog.exportMarkdown);
  });
});
