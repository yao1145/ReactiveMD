import { describe, expect, it } from 'vitest';
import { compileLocal } from '../src/local/compiler';
import { createLocalRuntime } from '../src/local/runtime';
import { exportLocalState } from '../src/local/state';
import { createLocalConfig } from '../src/sdk/config';
import { defineLocalComponent, localComponentDigest } from '../src/sdk/manifest';
import { defineLocalTheme } from '../src/sdk/theme';
import { createLocalExportPlan, createLocalShareableHtml, defineLocalStandaloneBundle, validateLocalExtensionRequirements } from '../src/export';
import { parseMountPayload } from '../src/standalone/payload';
import { portableCompileOptions } from '../src/local/portable-options';
import type { LocalDocument } from '../src/local/types';

const component = defineLocalComponent({
  id: 'test/note', name: 'sdk-note', version: '1.0.0', protocol: 'reactive-md-component/v1', form: 'container',
  props: { title: { kind: 'string', default: 'Note' } }, children: { kind: 'markdown' },
  capabilities: { interactive: true, static: true, ssr: true, offline: true },
});
const theme = defineLocalTheme({
  id: 'test/paper', name: 'paper', version: '1.0.0', protocol: 'reactive-md-theme-1', colorSchemes: ['light', 'dark'],
  css: [{ id: 'paper.css', css: '[data-rmd-theme="paper"] { --accent: green; }' }],
});
const config = createLocalConfig({ components: [component], themes: [theme] });
const source = '<theme name="paper">\n\n<sdk-note>**Hello**</sdk-note>';
function document(): LocalDocument {
  const result = compileLocal(source, { config });
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.document;
}

describe('SDK portable exports', () => {
  it('preserves both legacy schemas and the new frozen configuration across payload normalization', () => {
    const legacy = [{ name: 'legacy-note', form: 'leaf' as const, props: {} }];
    expect(portableCompileOptions({ hostComponents: legacy })?.hostComponents).toEqual(legacy);
    const doc = document();
    const runtime = createLocalRuntime(doc);
    const parsed = parseMountPayload({ version: 1, target: 'doc', source, state: exportLocalState(runtime), compileOptions: { config }, extensions: doc.extensions });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.payload.compileOptions?.config?.key).toBe(config.key);
      expect(parsed.payload.extensions).toEqual(doc.extensions);
    }
    runtime.dispose();
  });

  it('checks required component identity, version, digest and duplicate entries', () => {
    const requirements = document().extensions!;
    expect(validateLocalExtensionRequirements(requirements, config)).toEqual([]);
    expect(validateLocalExtensionRequirements(requirements, createLocalConfig())).not.toEqual([]);
    const altered = createLocalConfig({ components: [{ ...component, version: '2.0.0' }] });
    expect(validateLocalExtensionRequirements(requirements, altered)).not.toEqual([]);
    expect(validateLocalExtensionRequirements({ ...requirements, components: [...requirements.components, ...requirements.components] }, config)).not.toEqual([]);
    expect(validateLocalExtensionRequirements({ ...requirements, components: [{ ...requirements.components[0], digest: 'forged' }] }, config)).not.toEqual([]);
  });

  it('requires capabilities, the matching standalone bundle and all declared resources', () => {
    const doc = document();
    expect(createLocalExportPlan({ document: doc, config, target: 'offline' }).ok).toBe(false);
    const bundle = defineLocalStandaloneBundle('window.sdkReady = true;', config);
    expect(createLocalExportPlan({ document: doc, config, target: 'offline', bundle }).ok).toBe(true);
    const emptyBundle = defineLocalStandaloneBundle('window.sdkReady = true;', createLocalConfig());
    expect(createLocalExportPlan({ document: doc, config, target: 'offline', bundle: emptyBundle }).ok).toBe(false);
    expect(createLocalExportPlan({ document: doc, config, target: 'static', requiredResources: ['missing.css'] }).diagnostics.map(item => item.code)).toContain('local.extension.resource-missing');
    const noStatic = defineLocalComponent({ ...component, capabilities: { interactive: true, static: false, ssr: false, offline: false } });
    const restrictedConfig = createLocalConfig({ components: [noStatic], themes: [theme] });
    const result = compileLocal(source, { config: restrictedConfig });
    expect(result.ok).toBe(true);
    if (result.ok) expect(createLocalExportPlan({ document: result.document, config: restrictedConfig, target: 'static' }).diagnostics.map(item => item.code)).toContain('local.extension.export-capability');
  });

  it('collects theme CSS once, preserves order and rejects network or conflicting resources', () => {
    const doc = document();
    const plan = createLocalExportPlan({ document: doc, config, target: 'static', resources: [{id:'first.css',css:'.first { color: red; }'}, ...theme.css] });
    expect(plan.ok).toBe(true);
    expect(plan.resources.map(item => item.id)).toEqual(['first.css', 'paper.css']);
    expect(createLocalExportPlan({ document: doc, config, target: 'static', resources: [{ id: 'remote', css: '.a{background:url(https://example.com/x)}' }] }).ok).toBe(false);
    expect(createLocalExportPlan({ document: doc, config, target: 'static', resources: [{ id: 'paper.css', css: '.different{}' }] }).ok).toBe(false);
  });

  it('exports matching requirements and CSS in both interactive and static output', () => {
    const doc = document();
    const runtime = createLocalRuntime(doc);
    const options = { document: doc, config, source, state: exportLocalState(runtime), staticMarkup:'<article>Hello</article>', css:'article{display:block}', title:'SDK' };
    const html = createLocalShareableHtml({ ...options, mode: 'interactive', bundle: defineLocalStandaloneBundle('window.sdkReady=true;', config) });
    expect(html).toContain(localComponentDigest(component));
    expect(html).toContain('test/note');
    expect(html).toContain('--accent: green');
    const staticHtml = createLocalShareableHtml({ ...options, mode:'static' });
    expect(staticHtml).toContain('reactive-md-extensions');
    expect(staticHtml).not.toContain('window.sdkReady');
    expect(() => createLocalShareableHtml({ ...options, mode:'static', staticMarkup:'<span data-rmd-extension-error="true">broken</span>' })).toThrow();
    runtime.dispose();
  });
});
