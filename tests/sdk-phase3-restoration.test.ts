import { describe, expect, it } from 'vitest';
import { compileLocal, createLocalRuntime, exportLocalState, type LocalValue } from '../src/local';
import { createLocalConfig, defineLocalComponent, defineLocalTheme } from '../src/sdk';
import { createLocalExportPlan, createLocalShareableHtml, createLocalRestorationRequirements,
  defineLocalStandaloneBundle, validateLocalRestorationRequirements } from '../src/export';
import { readLocalExportResources } from '../src/export';
import { parseMountPayload } from '../src/standalone/payload';
import { prepareStandaloneDocument } from '../src/standalone/prepare';

const widget = defineLocalComponent({ id: 'test/review', name: 'review-value', version: '1.0.0',
  protocol: 'reactive-md-component/v1', form: 'leaf', props: {},
  bindings: { value: { kind: 'number', family: 'number', bind: 'bind', initial: 'initial', initialRule: 'nearest-zero' } },
  styles: ['review.css'], capabilities: { interactive: true, static: true, ssr: true, offline: true } });
const theme = defineLocalTheme({ id: 'test/paper', name: 'paper', version: '1.0.0',
  css: [{ id: 'paper.css', css: '[data-rmd-theme="paper"] { --accent: green; }' }] });
const config = createLocalConfig({ components: [widget], themes: [theme] });
const resources = [{ id: 'review.css', css: '.review-value { color: var(--ink); }' }, ...theme.css];
const source = '<theme name="paper">\n<review-value bind="rating" initial="2">';
function fixture() {
  const compiled = compileLocal(source, { config });
  if (!compiled.ok) throw new Error(JSON.stringify(compiled.diagnostics));
  const runtime = createLocalRuntime(compiled.document);
  const state = exportLocalState(runtime);
  runtime.dispose();
  const restoration = createLocalRestorationRequirements(compiled.document, config, 'offline', resources);
  return { document: compiled.document, state, restoration };
}

describe('versioned export and recovery contracts', () => {
  it('carries v2 contracts and local resource contents through a real exported payload', () => {
    const { document, state } = fixture();
    const html = createLocalShareableHtml({ source, document, config, state, resources, title: 'Review',
      css: '', staticMarkup: '<article>2</article>', mode: 'interactive',
      bundle: defineLocalStandaloneBundle('window.ready=true;', config) });
    const raw = html.match(/<script type="application\/reactive-md\+json"[^>]*>([\s\S]*?)<\/script>/)?.[1];
    expect(raw).toBeDefined();
    const parsed = parseMountPayload(JSON.parse(raw!));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.payload.version).toBe(2);
    expect(parsed.payload.restoration?.components.map(item => item.id)).toContain(widget.id);
    expect(parsed.payload.resources?.map(item => item.id)).toEqual(['review.css', 'paper.css']);
  });

  it('rejects missing and modified assets, themes, source and component requirements', () => {
    const { restoration, document } = fixture();
    expect(validateLocalRestorationRequirements(restoration, { config, source, resources, document })).toEqual([]);
    expect(validateLocalRestorationRequirements(restoration, { config, source, resources: [], document }).some(item => item.code === 'local.extension.restore-resource-missing')).toBe(true);
    const changed = resources.map(item => ({ ...item, css: `${item.css}\n/* changed */` }));
    expect(validateLocalRestorationRequirements(restoration, { config, source, resources: changed }).some(item => item.code === 'local.extension.restore-resource-digest')).toBe(true);
    const restyled = createLocalConfig({ components: [widget], themes: [defineLocalTheme({ ...theme, css: [{ id: 'paper.css', css: '[data-rmd-theme="paper"] { --accent: red; }' }] })] });
    expect(restyled.key).toBe(config.key);
    expect(validateLocalRestorationRequirements(restoration, { config: restyled, source, resources }).some(item => item.code === 'local.extension.restore-theme')).toBe(true);
    expect(validateLocalRestorationRequirements(restoration, { config, source: source + '\n', resources }).some(item => item.code === 'local.extension.restore-source')).toBe(true);
    expect(validateLocalRestorationRequirements({ ...restoration, components: [] }, { config, source, resources, document }).some(item => item.code === 'local.extension.restore-component-missing')).toBe(true);
  });

  it('checks semver requirements while retaining exact contract checks for compatible upgrades', () => {
    const { restoration } = fixture();
    const newer = createLocalConfig({ components: [defineLocalComponent({ ...widget, version: '1.1.0' })], themes: [theme] });
    const ranged = { ...restoration, components: restoration.components.map(item => ({ ...item, range: '^1.0.0' })) };
    const errors = validateLocalRestorationRequirements(ranged, { config: newer, source, resources });
    expect(errors.some(item => item.code === 'local.extension.restore-version')).toBe(false);
    expect(errors.some(item => item.code === 'local.extension.restore-contract')).toBe(true);
    const incompatible = { ...restoration, components: restoration.components.map(item => ({ ...item, range: '^2.0.0' })) };
    expect(validateLocalRestorationRequirements(incompatible, { config, source, resources }).some(item => item.code === 'local.extension.restore-version')).toBe(true);
  });

  it('checks contracts before parsing or applying saved state', () => {
    const { restoration } = fixture();
    expect(() => prepareStandaloneDocument(source, 'invalid state', undefined, { config }, document => {
      const errors = validateLocalRestorationRequirements(restoration, { config, source, resources: [], document });
      if (errors.length) throw new Error(errors.map(item => item.code).join(','));
    })).toThrow(/restore-resource-missing/);
  });

  it('detects changed sealed bundle scripts before producing output', () => {
    const { document } = fixture();
    const bundle = defineLocalStandaloneBundle('window.ready=true;', config);
    expect(createLocalExportPlan({ document, config, target: 'offline', resources, bundle }).ok).toBe(true);
    const tampered = { ...bundle, script: 'window.changed=true;' };
    expect(createLocalExportPlan({ document, config, target: 'offline', resources, bundle: tampered }).diagnostics.some(item => item.code === 'local.extension.bundle-integrity')).toBe(true);
  });

  it('rejects a same-version theme changed after its bundle was built', () => {
    const { document } = fixture();
    const changed = createLocalConfig({ components: [widget], themes: [defineLocalTheme({
      ...theme, css: [{ id: 'paper.css', css: '.paper { color: red; }' }],
    })] });
    expect(changed.key).toBe(config.key);
    const plan = createLocalExportPlan({ document, config: changed, target: 'offline',
      resources: [resources[0]], bundle: defineLocalStandaloneBundle('window.ready=true;', config) });
    expect(plan.diagnostics.map(item => item.code)).toContain('local.extension.bundle-theme');
  });

  it('validates saved parameters before producing HTML', () => {
    const { document, state } = fixture();
    const options = { source, document, config, state, resources, title: 'Review',
      css: '', staticMarkup: '<article>2</article>', mode: 'interactive' as const,
      bundle: defineLocalStandaloneBundle('window.ready=true;', config) };
    for (const parameters of [{ rating: 'invalid' }, { missing: 2 }] as Record<string, LocalValue>[]) {
      expect(() => createLocalShareableHtml({ ...options, state: { ...state, parameters } })).toThrow();
    }
    expect(() => createLocalShareableHtml({ ...options, state: { ...state, syntax: 'unknown' } })).toThrow();
    expect(createLocalShareableHtml(options)).toContain('application/reactive-md+json');
  });

  it('accepts quoted CSS escapes and URL-like text through export and restoration', () => {
    const css = String.raw`.review-value::before { content: "\2014 url(example)"; } /* \ harmless */`;
    const escaped = [{ id: 'review.css', css }];
    expect(readLocalExportResources(escaped).diagnostics).toEqual([]);
    const { document } = fixture();
    expect(createLocalExportPlan({ document, config, target: 'static', resources: escaped }).ok).toBe(true);
  });

  it('keeps old v1 envelopes and rejects incomplete or malformed new metadata', () => {
    const { state, restoration, document } = fixture();
    const payload = { version: 1, source, target: 'reader', state, compileOptions: { config }, extensions: document.extensions };
    expect(parseMountPayload(payload).ok).toBe(true);
    expect(parseMountPayload({ ...payload, version: 2 }).ok).toBe(false);
    expect(parseMountPayload({ ...payload, version: 1, restoration, resources }).ok).toBe(false);
    expect(validateLocalRestorationRequirements({ ...restoration, components: [null] }, { config, source, resources }).length).toBeGreaterThan(0);
    expect(validateLocalRestorationRequirements({ ...restoration, resources: Array(129).fill({}) }, { config, source }).length).toBeGreaterThan(0);
  });

  it('rejects hidden CSS network requests before resource restoration', () => {
    for (const css of [
      '.x { background: image-set("https://example.com/image.png" 1x); }',
      '.x { background: url(https://example.com/image.png); }',
      '@import "https://example.com/style.css";',
      '.x { width: expression(alert(1)); }',
    ]) expect(readLocalExportResources([{ id: 'unsafe.css', css }]).diagnostics.length).toBeGreaterThan(0);
    expect(readLocalExportResources([{ id: 'inline.css', css: '.x { background: url(data:image/png;base64,AAAA); }' }]).diagnostics).toEqual([]);
  });
});
