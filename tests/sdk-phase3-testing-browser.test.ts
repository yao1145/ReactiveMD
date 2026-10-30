import { describe, expect, it } from 'vitest';
import { createLocalConfig, defineLocalComponent } from '../src/sdk';
import {
  createPlaywrightBrowserDriver,
  readLocalBrowserSpec,
  runLocalBrowserCompliance,
} from '../src/testing/browser';
import type {
  LocalBrowserDriver,
  LocalBrowserPageDriver,
  LocalBrowserSessionDriver,
  LocalBrowserSpec,
  LocalPlaywrightPageLike,
} from '../src/testing/browser';
import { createLocalComplianceReport } from '../src/testing';

const panel = defineLocalComponent({
  id: 'example/panel',
  name: 'test-panel',
  version: '1.0.0',
  protocol: 'reactive-md-component/v1',
  form: 'leaf',
  props: { label: { kind: 'string', default: 'Panel' } },
  structure: { rule: 'none' },
  capabilities: { interactive: true, static: false, ssr: false, offline: true },
});
const config = createLocalConfig({ components: [panel] });

class FakePage implements LocalBrowserPageDriver {
  ratingVisible = true;
  noteVisible = true;
  placeholderVisible = false;
  upEnabled = true;
  ratingText = '3';

  async goto(): Promise<void> {}
  async reload(): Promise<void> {}
  async waitFor(selector: string): Promise<void> {
    if (selector === '[data-placeholder]' && !this.placeholderVisible) throw new Error('placeholder missing');
  }
  async count(selector: string): Promise<number> {
    if (selector === '[data-rating]') return this.ratingVisible ? 1 : 0;
    if (selector === '[data-note]') return this.noteVisible ? 1 : 0;
    return 0;
  }
  async text(selector: string): Promise<string | null> {
    if (selector === '[data-rating]') return this.ratingText;
    if (selector === '[data-note]') return 'Notes';
    return null;
  }
  async attribute(): Promise<string | null> { return null; }
  async visible(selector: string): Promise<boolean> {
    if (selector === '[data-rating]') return this.ratingVisible;
    if (selector === '[data-note]') return this.noteVisible;
    if (selector === '[data-placeholder]') return this.placeholderVisible;
    return false;
  }
  async enabled(selector: string): Promise<boolean> {
    return selector === '[data-rating-up]' ? this.upEnabled : false;
  }
  async click(selector: string): Promise<void> {
    if (selector === '[data-rating-up]' && this.upEnabled) {
      this.ratingText = String(Number(this.ratingText) + 1);
      return;
    }
    if (selector === '[data-rating-reset]') {
      this.ratingText = '3';
      return;
    }
    if (selector === '[data-rating-break]') {
      this.ratingVisible = false;
      this.placeholderVisible = true;
      return;
    }
    throw new Error(`Unknown click target ${selector}`);
  }
  async fill(): Promise<void> {}
  async press(): Promise<void> {}
  async evaluate<T = unknown>(expression: string): Promise<T> {
    if (expression === 'toggle-hidden') {
      this.ratingVisible = !this.ratingVisible;
      return true as unknown as T;
    }
    if (expression === 'toggle-disabled') {
      this.upEnabled = !this.upEnabled;
      return true as unknown as T;
    }
    if (expression === 'unmount()') {
      this.ratingVisible = false;
      this.noteVisible = false;
      this.placeholderVisible = false;
      return true as unknown as T;
    }
    if (expression === 'cleanup') return true as unknown as T;
    return false as unknown as T;
  }
}

function fakeDriver(options: { requests?: string[]; errors?: string[] } = {}): LocalBrowserDriver {
  return {
    name: 'fake',
    async open(): Promise<LocalBrowserSessionDriver> {
      return {
        page: new FakePage(),
        errors: options.errors ?? [],
        requests: options.requests ?? [],
        offline: true,
        async close() {},
      };
    },
  };
}

const lifecycleSpec: LocalBrowserSpec = {
  protocol: 'reactive-md-browser-spec/v1',
  url: 'file:///compliance/harness.html',
  offline: true,
  timeoutMs: 1000,
  unmountExpression: 'unmount()',
  cases: [
    { id: 'hydrated-visible', phase: 'hydration', kind: 'visible', selector: '[data-rating]', expected: true },
    { id: 'hydrated-text', phase: 'hydration', kind: 'text', selector: '[data-rating]', expected: '3' },
    { id: 'mounted-text', phase: 'mount', kind: 'text', selector: '[data-rating]', expected: '3' },
    { id: 'increment', phase: 'edit', kind: 'click', selector: '[data-rating-up]' },
    { id: 'edited-text', phase: 'edit', kind: 'text', selector: '[data-rating]', expected: '4' },
    { id: 'hide', phase: 'hide-show', kind: 'evaluate', expression: 'toggle-hidden', expected: true },
    { id: 'hidden', phase: 'hide-show', kind: 'visible', selector: '[data-rating]', expected: false },
    { id: 'show', phase: 'hide-show', kind: 'evaluate', expression: 'toggle-hidden', expected: true },
    { id: 'shown', phase: 'hide-show', kind: 'visible', selector: '[data-rating]', expected: true },
    { id: 'disable', phase: 'disabled', kind: 'evaluate', expression: 'toggle-disabled', expected: true },
    { id: 'disabled', phase: 'disabled', kind: 'enabled', selector: '[data-rating-up]', expected: false },
    { id: 'enable', phase: 'disabled', kind: 'evaluate', expression: 'toggle-disabled', expected: true },
    { id: 'enabled', phase: 'disabled', kind: 'enabled', selector: '[data-rating-up]', expected: true },
    { id: 'reset', phase: 'reset', kind: 'click', selector: '[data-rating-reset]' },
    { id: 'reset-text', phase: 'reset', kind: 'text', selector: '[data-rating]', expected: '3' },
    { id: 'isolation', phase: 'descendant-error', kind: 'isolation', trigger: '[data-rating-break]', placeholder: '[data-placeholder]', survivor: '[data-note]' },
    { id: 'unmount', phase: 'unmount', kind: 'unmount' },
    { id: 'unmounted', phase: 'unmount', kind: 'count', selector: '[data-rating]', expected: 0 },
  ],
};

describe('browser compliance proves lifecycle phases and offline evidence', () => {
  it('passes a complete lifecycle without network requests', async () => {
    const suite = await runLocalBrowserCompliance({
      driver: fakeDriver(),
      spec: lifecycleSpec,
      config,
      component: 'test-panel',
    });
    const failures = suite.cases.filter((item) => item.status === 'failed');
    expect(failures, JSON.stringify(failures, null, 2)).toEqual([]);
    expect(suite.cases.find((item) => item.id === 'browser.interactive')?.capabilities).toEqual(['interactive']);
    expect(suite.cases.find((item) => item.id === 'browser.offline')?.capabilities).toEqual(['offline']);
    const report = createLocalComplianceReport({
      config,
      component: 'test-panel',
      suites: [suite],
      capabilities: ['interactive', 'offline'],
    });
    expect(report.ok).toBe(true);
  });

  it('fails offline evidence when the page makes a network request', async () => {
    const suite = await runLocalBrowserCompliance({
      driver: fakeDriver({ requests: ['https://example.com/app.js'] }),
      spec: lifecycleSpec,
      config,
      component: 'test-panel',
    });
    const network = suite.cases.find((item) => item.id === 'browser.network');
    expect(network?.status).toBe('failed');
    expect(suite.cases.find((item) => item.id === 'browser.offline')?.status).toBe('skipped');
    const report = createLocalComplianceReport({
      config,
      component: 'test-panel',
      suites: [suite],
      capabilities: ['interactive', 'offline'],
    });
    expect(report.ok).toBe(false);
  });

  it('does not pass when a lifecycle phase was never executed', async () => {
    const incomplete: LocalBrowserSpec = {
      ...lifecycleSpec,
      cases: lifecycleSpec.cases.filter((item) => item.phase !== 'unmount'),
    };
    const suite = await runLocalBrowserCompliance({
      driver: fakeDriver(),
      spec: incomplete,
      config,
      component: 'test-panel',
    });
    expect(suite.cases.find((item) => item.id === 'browser.phase.unmount')?.status).toBe('skipped');
    expect(suite.cases.find((item) => item.id === 'browser.interactive')?.status).toBe('skipped');
    expect(suite.cases.find((item) => item.id === 'browser.offline')?.status).toBe('skipped');
    const report = createLocalComplianceReport({
      config,
      component: 'test-panel',
      suites: [suite],
      capabilities: ['interactive', 'offline'],
    });
    expect(report.ok).toBe(false);
    expect(report.diagnostics.some((item) => item.code === 'testing.capability-evidence')).toBe(true);
  });

  it('turns an unexpected page error into a failure', async () => {
    const suite = await runLocalBrowserCompliance({
      driver: fakeDriver({ errors: ['boom'] }),
      spec: { ...lifecycleSpec, expectedErrors: ['expected'] },
      config,
      component: 'test-panel',
    });
    expect(suite.cases.find((item) => item.id === 'browser.errors')?.status).toBe('failed');
    expect(suite.cases.find((item) => item.id === 'browser.offline')?.status).toBe('skipped');
  });

  it('reports an open failure instead of throwing', async () => {
    const suite = await runLocalBrowserCompliance({
      driver: {
        name: 'broken',
        async open(): Promise<LocalBrowserSessionDriver> {
          throw new Error('browser unavailable');
        },
      },
      spec: lifecycleSpec,
      config,
      component: 'test-panel',
    });
    expect(suite.cases[0].id).toBe('browser.open');
    expect(suite.cases[0].status).toBe('failed');
  });
});

describe('browser specs are bounded and validated', () => {
  it('rejects remote URLs, duplicate ids and unknown kinds', () => {
    expect(() => readLocalBrowserSpec({ ...lifecycleSpec, url: 'https://example.com/x.html' }))
      .toThrow(/file: or data:/);
    expect(() => readLocalBrowserSpec({
      ...lifecycleSpec,
      cases: [
        { id: 'same', phase: 'mount', kind: 'visible', selector: '[data-rating]', expected: true },
        { id: 'same', phase: 'mount', kind: 'visible', selector: '[data-rating]', expected: true },
      ],
    })).toThrow(/duplicates/);
    expect(() => readLocalBrowserSpec({
      ...lifecycleSpec,
      cases: [{ id: 'bad', phase: 'mount', kind: 'magic', selector: '[data-rating]' }],
    })).toThrow(/not supported/);
    expect(() => readLocalBrowserSpec({ ...lifecycleSpec, timeoutMs: 2 })).toThrow(/between/);
  });
});

describe('optional Playwright adapter', () => {
  it('maps a Playwright-like context without importing Playwright', async () => {
    const handlers = new Map<string, (...args: any[]) => void>();
    let gotoUrl = '';
    const locator = {
      async count() { return 1; },
      first() { return locator; },
      async textContent() { return '3'; },
      async getAttribute() { return null; },
      async isVisible() { return true; },
      async isEnabled() { return true; },
      async click() {},
      async fill() {},
      async press() {},
    };
    const page = {
      async goto(url: string) { gotoUrl = url; },
      async reload() {},
      async waitForSelector() {},
      locator() { return locator; },
      async evaluate<T = unknown>(): Promise<T> { return true as unknown as T; },
      on(event: string, listener: (...args: any[]) => void) { handlers.set(event, listener); },
      async close() {},
    } as unknown as LocalPlaywrightPageLike;
    let offline = false;
    const driver = createPlaywrightBrowserDriver({
      async setOffline(value) { offline = value; },
      async newPage() { expect(offline).toBe(true); return page; },
    });
    const session = await driver.open({
      url: 'file:///compliance/harness.html',
      offline: true,
      timeoutMs: 1000,
    });
    expect(gotoUrl).toBe('file:///compliance/harness.html');
    expect(session.offline).toBe(true);
    expect(await session.page.text('[data-rating]')).toBe('3');
    expect(await session.page.count('[data-rating]')).toBe(1);
    handlers.get('pageerror')?.(new Error('page failed'));
    handlers.get('request')?.({ url: () => 'https://example.com/a.js' });
    handlers.get('request')?.({ url: () => 'file:///local.css' });
    expect(session.errors).toContain('page failed');
    expect(session.requests).toEqual(['https://example.com/a.js']);
    await session.close();
  });

  it('rejects offline evidence if the context cannot disable its network', async () => {
    let opened = false;
    const driver = createPlaywrightBrowserDriver({ async newPage() { opened = true; throw new Error('unreachable'); } });
    await expect(driver.open({ url: 'file:///probe.html', offline: true, timeoutMs: 1000 })).rejects.toThrow(/setOffline/);
    expect(opened).toBe(false);
  });
});
