import type { LocalImageResolver, LocalUrlPolicy } from '../local/LocalDocumentView';
import type { LocalLocale } from '../local/locale';
import type { LocalStateFile } from '../local/state';
import type { LocalColorScheme, LocalThemeDefinition } from '../local/theme';
import type { Diagnostic } from '../local/types';
import { diagnosticsFromError, errorText, standaloneDiagnostic } from './diagnostics';
import { REACTIVE_MD_DIAGNOSTICS_EVENT, REACTIVE_MD_STATE_CHANGE_EVENT } from './events';
import {
  createStandaloneMount,
  type ReactiveMDHandle,
} from './session';

export const REACTIVE_MD_DOC_TAG = 'reactive-md-doc' as const;

// Keep module import safe in DOM-less environments (SSR/docs tooling); the
// element is only registered when customElements exists.
const HTMLElementBase = (
  typeof HTMLElement !== 'undefined' ? HTMLElement : class {}
) as unknown as typeof HTMLElement;

function isAbortError(error: unknown): boolean {
  return error !== null
    && typeof error === 'object'
    && (error as { name?: unknown }).name === 'AbortError';
}

/**
 * Light-DOM custom element. Complex options are DOM properties, simple options
 * are attributes. The element owns one isolated runtime per instance.
 */
export class ReactiveMDDocElement extends HTMLElementBase {
  static observedAttributes = ['src', 'source', 'locale', 'color-scheme', 'theme'];

  private _source: string | undefined;
  private _state: LocalStateFile | string | undefined;
  private _urlPolicy: LocalUrlPolicy | undefined;
  private _imageResolver: LocalImageResolver | undefined;
  private _themes: readonly LocalThemeDefinition[] | undefined;

  private _connected = false;
  private _generation = 0;
  private _restartScheduled = false;
  private _session: ReactiveMDHandle | null = null;
  private _abort: AbortController | null = null;
  private _stateTimer: ReturnType<typeof setTimeout> | null = null;
  private _pendingState: LocalStateFile | null = null;
  private _cache: { src: string; text: string } | null = null;

  connectedCallback(): void {
    if (this._connected) return;
    this._connected = true;
    this._start();
  }

  disconnectedCallback(): void {
    if (!this._connected) return;
    this._connected = false;
    this._generation += 1;
    this._restartScheduled = false;
    this._abortFetch();
    this._clearStateTimer();
    this._teardown();
    this._cache = null;
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    if (oldValue === newValue) return;
    if (name === 'src') this._cache = null;
    this._requestRestart();
  }

  /* ------------------------------------------------------------ attributes */

  get src(): string | undefined {
    return this.getAttribute('src') ?? undefined;
  }

  set src(value: string | null | undefined) {
    if (value === undefined || value === null) this.removeAttribute('src');
    else this.setAttribute('src', value);
  }

  get theme(): string | undefined {
    return this.getAttribute('theme') ?? undefined;
  }

  set theme(value: string | null | undefined) {
    if (value === undefined || value === null) this.removeAttribute('theme');
    else this.setAttribute('theme', value);
  }

  /* ------------------------------------------------------------ properties */

  get source(): string | undefined {
    return this._source !== undefined ? this._source : this.getAttribute('source') ?? undefined;
  }

  set source(value: string | undefined) {
    const next = typeof value === 'string' ? value : undefined;
    if (next === this._source) return;
    this._source = next;
    this._requestRestart();
  }

  get state(): LocalStateFile | string | undefined {
    return this._state;
  }

  set state(value: LocalStateFile | string | undefined) {
    if (value === this._state) return;
    this._state = value;
    this._requestRestart();
  }

  get urlPolicy(): LocalUrlPolicy | undefined {
    return this._urlPolicy;
  }

  set urlPolicy(value: LocalUrlPolicy | undefined) {
    if (value === this._urlPolicy) return;
    this._urlPolicy = value;
    this._requestRestart();
  }

  get imageResolver(): LocalImageResolver | undefined {
    return this._imageResolver;
  }

  set imageResolver(value: LocalImageResolver | undefined) {
    if (value === this._imageResolver) return;
    this._imageResolver = value;
    this._requestRestart();
  }

  get themes(): readonly LocalThemeDefinition[] | undefined {
    return this._themes;
  }

  set themes(value: readonly LocalThemeDefinition[] | undefined) {
    if (value === this._themes) return;
    this._themes = value;
    this._requestRestart();
  }

  /* ------------------------------------------------------------- lifecycle */

  private get _locale(): LocalLocale {
    return this.getAttribute('locale') === 'zh' ? 'zh' : 'en';
  }

  private get _colorScheme(): LocalColorScheme {
    const value = this.getAttribute('color-scheme');
    return value === 'light' || value === 'dark' ? value : 'auto';
  }

  private get _themeOverride(): string | undefined {
    const value = this.getAttribute('theme')?.trim();
    return value ? value : undefined;
  }

  private _requestRestart(): void {
    if (!this._connected || this._restartScheduled) return;
    this._restartScheduled = true;
    queueMicrotask(() => {
      this._restartScheduled = false;
      if (!this._connected) return;
      this._start();
    });
  }

  /** Tear down the current mount and rebuild from the current attributes/properties. */
  private _start(): void {
    this._generation += 1;
    const generation = this._generation;
    this._abortFetch();
    this._clearStateTimer();
    this._teardown();
    void this._load(generation);
  }

  private async _load(generation: number): Promise<void> {
    const src = this.getAttribute('src')?.trim() ?? '';
    let source: string | undefined = this.source;

    if (src) {
      if (this._cache && this._cache.src === src) {
        source = this._cache.text;
      } else {
        let controller: AbortController | null = null;
        try {
          controller = typeof AbortController === 'function' ? new AbortController() : null;
          this._abort = controller;
          const response = await fetch(src, controller ? { signal: controller.signal } : {});
          if (!response.ok) {
            throw new Error(`HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`);
          }
          const text = await response.text();
          if (!this._connected || generation !== this._generation) return;
          this._cache = { src, text };
          source = text;
        } catch (error) {
          if (!this._connected || generation !== this._generation || isAbortError(error)) return;
          this._showError([standaloneDiagnostic(
            'standalone.fetch',
            `Cannot load "${src}": ${errorText(error)}`,
          )]);
          return;
        } finally {
          if (this._abort === controller) this._abort = null;
        }
      }
    }

    if (!this._connected || generation !== this._generation) return;

    if (typeof source !== 'string') {
      this._showError([standaloneDiagnostic(
        'standalone.source',
        'The <reactive-md-doc> element requires a "src" attribute or a "source" attribute/property.',
      )]);
      return;
    }

    try {
      const session = createStandaloneMount(this, {
        source,
        state: this._state,
        locale: this._locale,
        colorScheme: this._colorScheme,
        themes: this._themes,
        urlPolicy: this._urlPolicy,
        imageResolver: this._imageResolver,
      }, {
        theme: this._themeOverride,
        onDiagnostics: (diagnostics) => this._emitDiagnostics(diagnostics),
        onStateChange: (file) => this._queueState(file),
      });
      // A synchronous diagnostics listener may have disconnected or restarted us.
      if (!this._connected || generation !== this._generation) {
        try {
          session.unmount();
        } catch {
          /* best effort */
        }
        return;
      }
      this._session = session;
    } catch (error) {
      this._session = null;
      this._showError(diagnosticsFromError(error));
    }
  }

  private _teardown(): void {
    const session = this._session;
    this._session = null;
    if (!session) return;
    try {
      session.unmount();
    } catch {
      /* unmount is idempotent; never surface teardown errors */
    }
  }

  private _abortFetch(): void {
    const controller = this._abort;
    this._abort = null;
    if (!controller) return;
    try {
      controller.abort();
    } catch {
      /* AbortController.abort never throws in practice. */
    }
  }

  private _clearStateTimer(): void {
    if (this._stateTimer !== null) {
      clearTimeout(this._stateTimer);
      this._stateTimer = null;
    }
    this._pendingState = null;
  }

  private _queueState(file: LocalStateFile): void {
    if (!this._connected) return;
    this._pendingState = file;
    if (this._stateTimer !== null) return;
    this._stateTimer = setTimeout(() => {
      this._stateTimer = null;
      const pending = this._pendingState;
      this._pendingState = null;
      if (!this._connected || !pending) return;
      this._dispatch(REACTIVE_MD_STATE_CHANGE_EVENT, pending);
    }, 0);
  }

  private _emitDiagnostics(diagnostics: readonly Diagnostic[]): void {
    if (!this._connected || diagnostics.length === 0) return;
    this._dispatch(REACTIVE_MD_DIAGNOSTICS_EVENT, diagnostics);
  }

  private _showError(diagnostics: Diagnostic[]): void {
    if (!this._connected) return;
    this._teardown();
    this._clearStateTimer();

    const doc = this.ownerDocument;
    while (this.firstChild) this.removeChild(this.firstChild);

    const box = doc.createElement('div');
    box.className = 'local-inactive reactive-md-standalone-error';
    box.setAttribute('role', 'alert');
    box.setAttribute('data-reactive-md-error', '');

    const title = doc.createElement('p');
    title.className = 'local-inactive-title';
    title.textContent = this._locale === 'zh'
      ? '无法加载交互文档。'
      : 'This interactive document could not be loaded.';
    box.appendChild(title);

    if (diagnostics.length > 0) {
      const list = doc.createElement('ul');
      list.className = 'local-inactive-list';
      for (const item of diagnostics.slice(0, 12)) {
        const entry = doc.createElement('li');
        entry.textContent = `${item.message} (line ${item.line}, column ${item.column})`;
        list.appendChild(entry);
      }
      box.appendChild(list);
    }

    this.appendChild(box);
    this._emitDiagnostics(diagnostics);
  }

  private _dispatch(detailName: string, detail: unknown): void {
    if (!this._connected) return;
    const CustomEventCtor = this.ownerDocument.defaultView?.CustomEvent;
    if (typeof CustomEventCtor !== 'function') return;
    try {
      this.dispatchEvent(new CustomEventCtor(detailName, {
        detail,
        bubbles: true,
        composed: true,
      }));
    } catch {
      /* Custom events are best effort. */
    }
  }
}

/** Register `<reactive-md-doc>` once, and only in a DOM that supports custom elements. */
export function defineReactiveMDDoc(): void {
  if (typeof customElements === 'undefined') return;
  if (customElements.get(REACTIVE_MD_DOC_TAG)) return;
  customElements.define(REACTIVE_MD_DOC_TAG, ReactiveMDDocElement);
}

defineReactiveMDDoc();
