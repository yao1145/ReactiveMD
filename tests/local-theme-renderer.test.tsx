import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { compileLocal } from '../src/local/compiler';
import { createLocalRuntime } from '../src/local/runtime';
import { LocalDocumentView, LocalReactiveDocument } from '../src/local/LocalDocumentView';
import { LOCAL_THEME_PROTOCOL, type LocalThemeDefinition } from '../src/local/theme';
import type { Diagnostic, LocalDocument } from '../src/local/types';

function manifest(
  name: string,
  colorSchemes: ('light' | 'dark')[] = ['light', 'dark'],
): LocalThemeDefinition {
  return { name, protocol: LOCAL_THEME_PROTOCOL, colorSchemes };
}

function compileDocument(source: string): LocalDocument {
  const result = compileLocal(source);
  if (!result.ok) throw new Error(result.diagnostics.map((item) => item.message).join('; '));
  return result.document;
}

interface ViewOptions {
  themes?: readonly LocalThemeDefinition[];
  colorScheme?: 'light' | 'dark' | 'auto';
  onDiagnostics?: (diagnostics: Diagnostic[]) => void;
}

function renderView(source: string, options: ViewOptions = {}): string {
  const document = compileDocument(source);
  const runtime = createLocalRuntime(document);
  try {
    return renderToStaticMarkup(
      <LocalDocumentView document={document} runtime={runtime} {...options} />,
    );
  } finally {
    runtime.dispose();
  }
}

function articleTags(html: string): string[] {
  return [...html.matchAll(/<article\b[^>]*>/g)].map((match) => match[0]);
}

function articleTag(html: string, index = 0): string {
  const tag = articleTags(html)[index];
  if (!tag) throw new Error('Missing article element');
  return tag;
}

describe('theme root attributes', () => {
  it('renders the built-in theme with a light server fallback', () => {
    const tag = articleTag(renderView('# Hello'));
    expect(tag).toContain('data-rmd-theme="default"');
    expect(tag).toContain('data-color-scheme="light"');
    expect(tag).toContain('color-scheme:light');
  });

  it('resolves a declared theme through the host manifest', () => {
    const html = renderView('<theme name="paper" />\n\n# Paper', {
      themes: [manifest('paper')],
    });
    expect(articleTag(html)).toContain('data-rmd-theme="paper"');
    expect(html).toContain('Paper');
  });

  it('falls back to the built-in theme when no manifest is supplied', () => {
    const html = renderView('<theme name="paper" />\n\n# Paper');
    expect(articleTag(html)).toContain('data-rmd-theme="default"');
  });

  it('does not throw on malformed host manifests', () => {
    const html = renderView('<theme name="paper" />\n\n# Paper', {
      themes: [{ name: 'paper', protocol: 'wrong', colorSchemes: [] } as unknown as LocalThemeDefinition],
    });
    expect(articleTag(html)).toContain('data-rmd-theme="default"');
  });

  it('applies an explicit dark mode during server rendering', () => {
    const tag = articleTag(renderView('# Dark', { colorScheme: 'dark' }));
    expect(tag).toContain('data-color-scheme="dark"');
    expect(tag).toContain('color-scheme:dark');
  });

  it('treats an unknown runtime mode as auto', () => {
    const html = renderView('# Auto', { colorScheme: 'sepia' as unknown as 'auto' });
    expect(articleTag(html)).toContain('data-color-scheme="light"');
  });

  it('resolves root attributes independently for each document', () => {
    const paper = compileDocument('<theme name="paper" />\n\n# Paper');
    const plain = compileDocument('# Plain');
    const paperRuntime = createLocalRuntime(paper);
    const plainRuntime = createLocalRuntime(plain);
    try {
      const html = renderToStaticMarkup(
        <>
          <LocalDocumentView
            document={paper}
            runtime={paperRuntime}
            themes={[manifest('paper')]}
            colorScheme="dark"
          />
          <LocalDocumentView document={plain} runtime={plainRuntime} colorScheme="light" />
        </>,
      );
      const tags = articleTags(html);
      expect(tags).toHaveLength(2);
      expect(tags[0]).toContain('data-rmd-theme="paper"');
      expect(tags[0]).toContain('data-color-scheme="dark"');
      expect(tags[1]).toContain('data-rmd-theme="default"');
      expect(tags[1]).toContain('data-color-scheme="light"');
    } finally {
      paperRuntime.dispose();
      plainRuntime.dispose();
    }
  });

  it('keeps author colors on controls alongside theme tokens', () => {
    const html = renderView('<slider bind="n" label="N" color="#123456">');
    expect(html).toContain('--local-accent:#123456');
    expect(articleTag(html)).toContain('data-rmd-theme="default"');
  });
});

describe('reactive theme wiring', () => {
  it('renders a themed reactive document from source', () => {
    const html = renderToStaticMarkup(
      <LocalReactiveDocument
        source={'<theme name="paper" />\n\n<counter label="Count">'}
        themes={[manifest('paper')]}
        colorScheme="dark"
      />,
    );
    const tag = articleTag(html);
    expect(tag).toContain('data-rmd-theme="paper"');
    expect(tag).toContain('data-color-scheme="dark"');
    expect(html).toContain('Count');
  });

  it('renders an inactive preview without a theme declaration', () => {
    const html = renderToStaticMarkup(
      <LocalReactiveDocument
        source={'<number bind="n" label="Value">\n\nTotal: {{ missing + 1 }}\n'}
      />,
    );
    expect(html).toContain('local-inactive');
  });
});
