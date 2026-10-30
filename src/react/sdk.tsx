import {
  Component,
  createElement,
  type ReactNode,
} from 'react';
import type { Diagnostic, LocalNode, LocalRuntime, SourceRange } from '../local/types';
import type {
  LocalHostComponentContext,
  LocalHostRenderer,
  LocalRenderMode,
  LocalSourceTarget,
} from '../local/render-types';
import type { LocalUrlPolicy } from '../local/LocalDocumentView';
import type { LocalLocale } from '../local/i18n';
import type { LocalThemePackage } from '../sdk/theme';
import { readLocalConfig } from '../sdk/config';
import { localComponentDigest } from '../sdk/manifest';
import type {
  LocalComponentDefinition,
  LocalConfig,
  LocalExtensionRequirements,
} from '../sdk/types';
import { validateLocalExtensionRequirements } from '../export/requirements';
import {
  createLocalComponentContext,
  type LocalComponentAdapterEnvironment,
  type LocalComponentContext,
  type LocalReactComponent,
  type LocalReactPreset,
} from './component-api';
export type { LocalComponentRender } from './component-api';
import { createDefaultReactPreset } from '../components/default-preset';

export {
  defineReactComponent,
  type LocalComponentBindingHandle,
  type LocalComponentContext,
  type LocalComponentInstance,
  type LocalComponentPropValue,
  type LocalComponentSetResult,
  type LocalComponentValue,
  type LocalReactComponent,
  type LocalReactComponentImplementation,
  type LocalReactPreset,
} from './component-api';

/* ------------------------------------------------------------------ types */

/** Everything a renderer needs from the document view. */
export interface LocalReactRenderEnvironment {
  runtime: LocalRuntime;
  mode: LocalRenderMode;
  visible: boolean;
  disabled: boolean;
  disabledInvalid: boolean;
  resetToken: number;
  /** UI locale for built-in labels and diagnostics inside components. */
  locale: LocalLocale;
  /** Render this component's children at the inherited visibility. */
  renderChildren(nodes: LocalNode[] | undefined, visible: boolean): ReactNode;
  /** Render projected children as inline content. */
  renderInline(nodes: LocalNode[] | undefined, visible: boolean): ReactNode;
  /** Plain text projection of nodes. */
  renderToText(nodes: LocalNode[] | undefined): string;
  report(diagnostics: Diagnostic[]): void;
  positionOf?(offset: number): { line: number; column: number };
  definitionFor(name: string): LocalComponentDefinition | undefined;
  validationField(node: LocalNode): { describedBy?: string; invalid: boolean };
  validationHint(node: LocalNode): {
    id: string;
    failed: boolean;
    error: boolean;
    message: string;
  } | null;
  sourceAttributes(node: LocalNode, componentName?: string): Record<string, string>;
  targetId(to: string): string | undefined;
  anchorId(node: LocalNode): string | undefined;
  jumpAllowed(to: string): boolean;
  jumpTo(target: string): 'ok' | 'missing' | 'hidden';
  urlPolicy?: LocalUrlPolicy;
  imageResolver?: (url: string) => string | null;
}

export type LocalReactExtensionRenderer = (
  node: LocalNode,
  environment: LocalReactRenderEnvironment,
) => ReactNode;

export interface CreateLocalReactConfigOptions {
  /** One implementation per external component declared by the config. */
  components: readonly LocalReactComponent[];
  /**
   * Additional installed component implementations grouped into presets.
   * The default preset is always installed; duplicate names are rejected.
   */
  presets?: readonly LocalReactPreset[];
}

/**
 * Host implementation map for one immutable `LocalConfig`. The serializable
 * config is available as `.config`; React functions stay on this object and
 * never enter it.
 */
export interface LocalReactConfig {
  readonly config: LocalConfig;
  readonly components: readonly LocalReactComponent[];
  /** Derived from `config.themes`; pass straight to the document view. */
  readonly themes: readonly LocalThemePackage[];
  /** Compatibility bridge for the legacy `hostRenderer` prop. */
  readonly hostRenderer: LocalHostRenderer;
}

/* ------------------------------------------------------------ definitions */

function requireDefinition(definition: unknown): LocalComponentDefinition {
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
    throw new TypeError('defineReactComponent requires a component definition object.');
  }
  return definition as LocalComponentDefinition;
}

/* --------------------------------------------------------------- registry */

interface LocalReactIndex {
  readonly byName: ReadonlyMap<string, LocalReactComponent>;
  readonly byId: ReadonlyMap<string, LocalReactComponent>;
}

const reactIndexes = new WeakMap<LocalReactConfig, LocalReactIndex>();

function indexOf(config: LocalReactConfig): LocalReactIndex {
  const cached = reactIndexes.get(config);
  if (cached) return cached;
  const byName = new Map<string, LocalReactComponent>();
  const byId = new Map<string, LocalReactComponent>();
  for (const component of config.components) {
    byName.set(component.definition.name, component);
    byId.set(component.definition.id, component);
  }
  const index = Object.freeze({ byName, byId });
  reactIndexes.set(config, index);
  return index;
}

function readReactComponent(value: unknown): LocalReactComponent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('createReactConfig components must be LocalReactComponent values.');
  }
  const candidate = value as Partial<LocalReactComponent>;
  if (!candidate.definition || typeof candidate.definition !== 'object') {
    throw new TypeError('A React component is missing its manifest definition.');
  }
  if (typeof candidate.render !== 'function') {
    throw new TypeError('A React component is missing its render implementation.');
  }
  if (candidate.renderStatic !== undefined && typeof candidate.renderStatic !== 'function') {
    throw new TypeError('A React component renderStatic must be a function.');
  }
  return candidate as LocalReactComponent;
}

/**
 * Validate implementations against an immutable config and expose the bridge
 * used by the document views. Duplicate ids/tags, stale digests, missing
 * implementations and mismatched versions all fail before rendering starts.
 */
export function createReactConfig(
  input: LocalConfig,
  options: CreateLocalReactConfigOptions,
): LocalReactConfig {
  const config = readLocalConfig(input);
  const declaredById = new Map(
    config.registry.map((definition) => [definition.id, definition]),
  );
  const supplied = options?.components;
  if (!Array.isArray(supplied)) {
    throw new TypeError('createReactConfig requires a components array.');
  }
  const presets = options?.presets ?? [];
  if (!Array.isArray(presets)) {
    throw new TypeError('createReactConfig presets must be an array.');
  }

  const implementations: LocalReactComponent[] = [];
  const externalImplementations: LocalReactComponent[] = [];
  const implementationsById = new Map<string, LocalReactComponent>();
  const names = new Map<string, LocalReactComponent>();

  const addImplementation = (implementation: LocalReactComponent, preset: boolean): void => {
    const manifest = requireDefinition(implementation.definition);
    const digest = localComponentDigest(manifest);
    const declared = declaredById.get(manifest.id);
    if (!declared || declared.name !== manifest.name || declared.version !== manifest.version
      || localComponentDigest(declared) !== digest) {
      throw new TypeError(`React component "${manifest.id}" does not match the installed manifest contract.`);
    }
    if (implementation.digest !== digest) {
      throw new TypeError(
        `React component "${manifest.id}" has a stale digest; create it with defineReactComponent.`,
      );
    }
    const previousId = implementationsById.get(manifest.id);
    if (previousId) {
      throw new TypeError(`Component id "${manifest.id}" has more than one React implementation.`);
    }
    const previousName = names.get(manifest.name);
    if (previousName) {
      throw new TypeError(`Component tag <${manifest.name}> has more than one React implementation.`);
    }
    implementationsById.set(manifest.id, implementation);
    names.set(manifest.name, implementation);
    implementations.push(implementation);
    if (!preset) externalImplementations.push(implementation);
  };

  const builtinPreset = createDefaultReactPreset();
  for (const value of builtinPreset.components) addImplementation(readReactComponent(value), true);
  for (const preset of presets) {
    if (!preset || typeof preset !== 'object' || !Array.isArray(preset.components)) {
      throw new TypeError('createReactConfig preset must expose a components array.');
    }
    for (const value of preset.components) {
      addImplementation(readReactComponent(value), false);
    }
  }

  for (const value of supplied) {
    const implementation = readReactComponent(value);
    const manifest = requireDefinition(implementation.definition);
    const digest = localComponentDigest(manifest);
    const declared = declaredById.get(manifest.id);
    if (!declared) {
      throw new TypeError(
        `React component "${manifest.name}" (${manifest.id}) is not declared by this local config.`,
      );
    }
    if (declared.name !== manifest.name || declared.version !== manifest.version) {
      throw new TypeError(
        `React component "${manifest.id}" does not match the declared name/version.`,
      );
    }
    if (localComponentDigest(declared) !== digest) {
      throw new TypeError(
        `React component "${manifest.id}@${manifest.version}" does not match the installed manifest contract.`,
      );
    }
    addImplementation(implementation, false);
  }

  const missing = config.registry
    .filter((definition) => !implementationsById.has(definition.id))
    .map((definition) => `${definition.id}@${definition.version}`);
  if (missing.length > 0) {
    throw new TypeError(
      `createReactConfig is missing implementations for: ${missing.join(', ')}.`,
    );
  }

  const themes = Object.freeze(config.themes.slice()) as readonly LocalThemePackage[];
  const index: LocalReactIndex = Object.freeze({
    byName: new Map(names),
    byId: new Map(implementationsById),
  });
  const result: LocalReactConfig = Object.freeze({
    config,
    components: Object.freeze(externalImplementations.slice()),
    themes,
    hostRenderer: createHostRenderer(index),
  });
  reactIndexes.set(result, index);
  return result;
}

/* -------------------------------------------------------------- rendering */

export class LocalReactExtensionMissingError extends Error {
  readonly componentName: string;

  constructor(name: string) {
    super(`No React implementation is registered for <${name}>.`);
    this.name = 'LocalReactExtensionMissingError';
    this.componentName = name;
  }
}

function revisionOf(runtime: LocalRuntime): number {
  try {
    return runtime.snapshot().revision;
  } catch {
    return 0;
  }
}

function positionOf(source: string | undefined, start: number): { line: number; column: number } {
  if (typeof source !== 'string' || source.length === 0) return { line: 1, column: 1 };
  const limit = Math.max(0, Math.min(start, source.length));
  let line = 1;
  let lineStart = 0;
  for (let index = 0; index < limit; index += 1) {
    if (source[index] === '\n') {
      line += 1;
      lineStart = index + 1;
    }
  }
  return { line, column: limit - lineStart + 1 };
}

function componentDiagnostic(
  code: string,
  name: string,
  range: SourceRange,
  source: string | undefined,
  error: unknown,
): Diagnostic {
  const { line, column } = positionOf(source, range.start);
  return {
    code,
    message: `Component <${name}> failed: ${error instanceof Error ? error.message : String(error)}`,
    severity: 'error',
    range: { start: range.start, end: range.end },
    line,
    column,
  };
}

interface LocalReactBoundaryProps {
  name: string;
  nodeId: string;
  revision: number;
  range: SourceRange;
  source: string | undefined;
  report(diagnostics: Diagnostic[]): void;
  children?: ReactNode;
}

/**
 * Descendant React errors (including errors raised by host child content) are
 * isolated to this component instance. The placeholder is retried whenever
 * the runtime revision changes.
 */
class LocalReactBoundary extends Component<LocalReactBoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    try {
      this.props.report([
        componentDiagnostic(
          'local.extension.render',
          this.props.name,
          this.props.range,
          this.props.source,
          error,
        ),
      ]);
    } catch {
      /* Reporting must never break the surrounding document. */
    }
  }

  componentDidUpdate(previous: Readonly<LocalReactBoundaryProps>): void {
    if (this.state.failed && previous.revision !== this.props.revision) {
      this.setState({ failed: false });
    }
  }

  render(): ReactNode {
    if (this.state.failed) {
      return createElement(
        'span',
        {
          className: 'local-host-component local-host-unavailable local-sdk-unavailable',
          'data-local-host-component': this.props.name,
          'data-local-host-reason': 'error',
          'data-rmd-source-start': String(this.props.range.start),
          'data-rmd-source-end': String(this.props.range.end),
          'data-rmd-source-node': this.props.nodeId,
          'data-rmd-source-type': 'hostComponent',
          'data-rmd-source-component': this.props.name,
          role: 'note',
        },
        `Component <${this.props.name}> is unavailable here.`,
      );
    }
    return this.props.children;
  }
}

function LocalExtensionView({
  implementation,
  node,
  environment,
}: {
  implementation: LocalReactComponent;
  node: LocalNode;
  environment: LocalReactRenderEnvironment;
}) {
  const builtin = implementation.definition.id.startsWith('reactive-md/');
  const capability = environment.mode === 'static' ? 'static' : 'interactive';
  // A static-only component is still renderable inside an interactive
  // document (it simply emits no interactive markup). External components
  // keep the phase-one capability gate.
  if (!builtin && !implementation.definition.capabilities[capability]) {
    throw new Error(`Component ${implementation.definition.id} does not support ${capability} rendering.`);
  }
  const adapter: LocalComponentAdapterEnvironment = {
    runtime: environment.runtime,
    mode: environment.mode,
    locale: environment.locale,
    visible: environment.visible,
    disabled: environment.disabled,
    disabledInvalid: environment.disabledInvalid,
    resetToken: environment.resetToken,
    definitionFor: environment.definitionFor,
    validationFieldFor: environment.validationField,
    validationHintFor: environment.validationHint,
    sourceAttributes: environment.sourceAttributes,
    renderChildren: (nodes, visible) => environment.renderChildren(nodes, visible),
    renderInline: (nodes, visible) => environment.renderInline(nodes, visible),
    renderToText: (nodes) => environment.renderToText(nodes),
    report: environment.report,
    targetId: environment.targetId,
    anchorId: environment.anchorId,
    jumpAllowed: environment.jumpAllowed,
    jumpTo: environment.jumpTo,
    urlPolicy: environment.urlPolicy,
    imageResolver: environment.imageResolver,
  };
  const context: LocalComponentContext = createLocalComponentContext(node, adapter);
  const ComponentImpl = environment.mode === 'static' && implementation.renderStatic
    ? implementation.renderStatic
    : implementation.render;
  // The context is the component's props, matching ComponentType<LocalComponentContext>.
  return createElement(ComponentImpl, context);
}

function renderExtensionNode(
  index: LocalReactIndex,
  node: LocalNode,
  environment: LocalReactRenderEnvironment,
): ReactNode {
  const name = node.name ?? '';
  const implementation = index.byName.get(name);
  if (!implementation) throw new LocalReactExtensionMissingError(name);
  let source: string | undefined;
  try {
    source = environment.runtime.document.source;
  } catch {
    source = undefined;
  }
  const view = createElement(LocalExtensionView, { implementation, node, environment });
  // Builtin views keep the document's historical error surface (the outer
  // LocalErrorBoundary renders the same `local-error` span as before). SDK
  // extension components keep their own isolated placeholder.
  if (implementation.definition.id.startsWith('reactive-md/')) return view;
  return createElement(
    LocalReactBoundary,
    {
      name,
      nodeId: node.id,
      revision: revisionOf(environment.runtime),
      range: node.range,
      source,
      report: environment.report,
    },
    view,
  );
}

/**
 * Renderer for `hostComponent` nodes produced from an SDK config. Unlike the
 * legacy host bridge it does not require host data, so a stateless leaf can
 * render on its own.
 */
export function localReactExtensionRenderer(
  config: LocalReactConfig,
): LocalReactExtensionRenderer {
  return (node, environment) => renderExtensionNode(indexOf(config), node, environment);
}

function plainNodeText(nodes: LocalNode[] | undefined): string {
  let text = '';
  for (const node of nodes ?? []) {
    if (node.type === 'text' || node.type === 'inlineCode' || node.type === 'code') {
      text += node.value ?? '';
    } else if (node.type === 'math' || node.type === 'inlineMath' || node.type === 'image') {
      text += node.value ?? node.alt ?? '';
    } else {
      text += plainNodeText(node.children);
    }
  }
  return text;
}

function createHostRenderer(index: LocalReactIndex): LocalHostRenderer {
  return (node: LocalNode, _data: unknown, ctx: LocalHostComponentContext): ReactNode =>
    renderExtensionNode(index, node, {
      runtime: ctx.runtime,
      mode: ctx.mode,
      visible: ctx.visible,
      disabled: ctx.disabled,
      disabledInvalid: false,
      resetToken: ctx.resetToken,
      locale: 'en',
      renderChildren: (nodes, visible) => ctx.render(nodes, visible),
      renderInline: (nodes, visible) => ctx.render(nodes, visible),
      renderToText: (nodes) => plainNodeText(nodes),
      report: (diagnostics) => ctx.report(diagnostics),
      definitionFor: (name) => index.byName.get(name)?.definition,
      validationField: () => ({ invalid: false }),
      validationHint: () => null,
      sourceAttributes: () => ({}),
      targetId: () => undefined,
      anchorId: () => undefined,
      jumpAllowed: () => false,
      jumpTo: () => 'missing',
    });
}

/**
 * Validate a compiled document against the React config before rendering.
 * Missing or mismatched components are reported instead of executed.
 */
export function validateLocalReactExtensions(
  config: LocalReactConfig,
  requirements: unknown,
): Diagnostic[] {
  return validateLocalExtensionRequirements(requirements, config.config);
}

/* ---------------------------------------------------------------- helpers */

/**
 * Safely report an error raised outside React's render phase (an event handler
 * or an effect). The component itself stays mounted and the diagnostic points
 * at its source range.
 */
export function reportLocalComponentError(
  context: Pick<LocalComponentContext, 'report' | 'instance'>,
  error: unknown,
  source?: string,
): void {
  try {
    context.report([
      componentDiagnostic(
        'local.extension.event',
        context.instance.componentId,
        context.instance.range,
        source,
        error,
      ),
    ]);
  } catch {
    /* Reporting must never throw from an event handler. */
  }
}

/** Wrap an event handler so an exception is reported instead of escaping. */
export function safeLocalComponentEvent<T extends unknown[]>(
  context: Pick<LocalComponentContext, 'report' | 'instance'>,
  handler: (...args: T) => void,
  source?: string,
): (...args: T) => void {
  return (...args: T): void => {
    try {
      handler(...args);
    } catch (error) {
      reportLocalComponentError(context, error, source);
    }
  };
}
