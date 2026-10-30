import {
  Component,
  createElement,
  type ComponentType,
  type ReactNode,
} from 'react';
import type { Diagnostic, LocalNode, LocalRuntime, SourceRange } from '../local/types';
import type {
  LocalHostComponentContext,
  LocalHostRenderer,
  LocalRenderMode,
} from '../local/render-types';
import type { LocalThemePackage } from '../sdk/theme';
import { readLocalConfig } from '../sdk/config';
import { defineLocalComponent, localComponentDigest } from '../sdk/manifest';
import { resolveLocalComponentProps } from '../sdk/props';
import type { LocalComponentDefinition, LocalConfig } from '../sdk/types';
import { validateLocalExtensionRequirements } from '../export/requirements';

/* ------------------------------------------------------------------ types */

/** A resolved, typed component attribute. */
export type LocalComponentPropValue = string | number | boolean | null;

/** Result of a `bindings.value.set` call. Rejected writes keep the state. */
export interface LocalComponentSetResult {
  readonly ok: boolean;
  readonly diagnostics: Diagnostic[];
}

export interface LocalComponentBindingHandle {
  /** Current binding value; `null` when the runtime has no readable value. */
  get(): LocalComponentPropValue;
  /**
   * Write this component's binding through the kernel. In static mode the
   * setter is read-only and always returns `ok: false`.
   */
  set(next: LocalComponentPropValue): LocalComponentSetResult;
}

/** Read-only identity of one rendered component instance. */
export interface LocalComponentInstance {
  /** Canonical node id for this document revision. */
  readonly id: string;
  /** Stable component id from the manifest, e.g. `example/rating`. */
  readonly componentId: string;
  readonly range: SourceRange;
}

/**
 * Context passed to every SDK component. It contains no AST: children are
 * rendered through `children.render()`, and visibility is inherited from the
 * document subtree.
 */
export interface LocalComponentContext {
  readonly props: Readonly<Record<string, LocalComponentPropValue>>;
  readonly bindings: {
    readonly value: LocalComponentBindingHandle;
  };
  readonly children: {
    render(): ReactNode;
  };
  readonly instance: LocalComponentInstance;
  readonly mode: LocalRenderMode;
  /** False when an enclosing conditional hides this subtree. */
  readonly visible: boolean;
  readonly disabled: boolean;
  /** Increments when the enclosing panel resets. */
  readonly resetToken: number;
  /** Report host-owned diagnostics to the document callback. */
  report(diagnostics: Diagnostic[]): void;
}

export type LocalComponentRender = ComponentType<LocalComponentContext>;

export interface LocalReactComponentImplementation {
  render: LocalComponentRender;
  /**
   * Static/export implementation. When omitted, static mode calls `render`
   * with a read-only binding setter.
   */
  renderStatic?: LocalComponentRender;
}

export interface LocalReactComponent extends LocalReactComponentImplementation {
  readonly definition: LocalComponentDefinition;
  /** Digest of the supplied manifest, rechecked by `createReactConfig`. */
  readonly digest: string;
}

/** Everything a renderer needs from the document view. */
export interface LocalReactRenderEnvironment {
  runtime: LocalRuntime;
  mode: LocalRenderMode;
  visible: boolean;
  disabled: boolean;
  resetToken: number;
  /** Render this component's children at the inherited visibility. */
  renderChildren(nodes: LocalNode[] | undefined, visible: boolean): ReactNode;
  report(diagnostics: Diagnostic[]): void;
}

export type LocalReactExtensionRenderer = (
  node: LocalNode,
  environment: LocalReactRenderEnvironment,
) => ReactNode;

export interface CreateLocalReactConfigOptions {
  /** One implementation per external component declared by the config. */
  components: readonly LocalReactComponent[];
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

const CAPABILITY_KEYS = ['interactive', 'static', 'ssr', 'offline'] as const;

type LocalComponentCapabilities = Partial<
  Record<(typeof CAPABILITY_KEYS)[number], boolean>
>;

/** Read the manifest capabilities without trusting unvalidated objects. */
function readCapabilities(
  definition: Partial<LocalComponentDefinition>,
): LocalComponentCapabilities | undefined {
  const raw = (definition as { capabilities?: unknown }).capabilities;
  if (raw === undefined) return undefined;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new TypeError('Component capabilities must be an object.');
  }
  const capabilities: LocalComponentCapabilities = {};
  for (const key of CAPABILITY_KEYS) {
    const value = (raw as Record<string, unknown>)[key];
    if (value === undefined) continue;
    if (typeof value !== 'boolean') {
      throw new TypeError(`Component capability "${key}" must be a boolean.`);
    }
    capabilities[key] = value;
  }
  return capabilities;
}

/**
 * Reject capability combinations the React adapter cannot honour. The adapter
 * renders interactive and static output; SSR reuses the static implementation
 * in Node, and offline delivery is a host bundling concern. A manifest may not
 * claim SSR or offline without the corresponding static/interactive ability.
 */
function assertSupportedCapabilities(
  definition: Partial<LocalComponentDefinition>,
  capabilities: LocalComponentCapabilities | undefined,
  implementation: LocalReactComponentImplementation,
): void {
  if (!capabilities) return;
  if (typeof implementation.render !== 'function') {
    throw new TypeError('defineReactComponent requires a render function.');
  }
  if (
    implementation.renderStatic !== undefined
    && typeof implementation.renderStatic !== 'function'
  ) {
    throw new TypeError('defineReactComponent renderStatic must be a function.');
  }
  if (capabilities.static === false && capabilities.ssr === true) {
    throw new TypeError(
      `Component "${definition.id ?? ''}" declares SSR without static rendering.`,
    );
  }
  if (capabilities.static === false && capabilities.offline === true) {
    throw new TypeError(
      `Component "${definition.id ?? ''}" declares offline output without a static implementation.`,
    );
  }
  if (capabilities.interactive === false && capabilities.offline === true) {
    throw new TypeError(
      `Component "${definition.id ?? ''}" declares offline interaction without an interactive implementation.`,
    );
  }
}

function requireDefinition(definition: unknown): LocalComponentDefinition {
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
    throw new TypeError('defineReactComponent requires a component definition object.');
  }
  // Revalidate into fresh frozen JSON so the stored digest always describes the
  // normalized contract, not a caller-owned mutable object.
  return defineLocalComponent(definition as LocalComponentDefinition);
}

/**
 * Bind a React implementation to a validated manifest. The manifest digest is
 * captured here and rechecked when the config is assembled, so a stale or
 * mismatched implementation cannot silently render another contract.
 */
export function defineReactComponent(
  definition: LocalComponentDefinition,
  implementation: LocalReactComponentImplementation,
): LocalReactComponent {
  const manifest = requireDefinition(definition);
  if (!implementation || typeof implementation !== 'object') {
    throw new TypeError('defineReactComponent requires an implementation object.');
  }
  const capabilities = readCapabilities(manifest);
  assertSupportedCapabilities(manifest, capabilities, implementation);
  let digest: string;
  try {
    digest = localComponentDigest(manifest);
  } catch (error) {
    throw new TypeError(
      `Cannot bind a React implementation to component "${manifest.id}": ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  return Object.freeze({
    definition: manifest,
    digest,
    render: implementation.render,
    ...(implementation.renderStatic === undefined
      ? {}
      : { renderStatic: implementation.renderStatic }),
  });
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
    config.components.map((definition) => [definition.id, definition]),
  );
  const supplied = options?.components;
  if (!Array.isArray(supplied)) {
    throw new TypeError('createReactConfig requires a components array.');
  }

  const implementations: LocalReactComponent[] = [];
  const implementationsById = new Map<string, LocalReactComponent>();
  const names = new Map<string, LocalReactComponent>();
  for (const value of supplied) {
    const implementation = readReactComponent(value);
    const manifest = requireDefinition(implementation.definition);
    const digest = localComponentDigest(manifest);
    if (implementation.digest !== digest) {
      throw new TypeError(
        `React component "${manifest.id}" has a stale digest; create it with defineReactComponent.`,
      );
    }
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
  }

  const missing = config.components
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
    components: Object.freeze(implementations.slice()),
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

function scalarValue(value: unknown): LocalComponentPropValue {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  return null;
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
  const capability = environment.mode === 'static' ? 'static' : 'interactive';
  if (!implementation.definition.capabilities[capability]) {
    throw new Error(`Component ${implementation.definition.id} does not support ${capability} rendering.`);
  }
  const props = resolveLocalComponentProps(
    implementation.definition,
    node.attrs ?? {},
    environment.runtime,
  );
  const readOnly = environment.mode === 'static';
  const value = Object.freeze({
    get(): LocalComponentPropValue {
      try {
        return scalarValue(environment.runtime.get(node));
      } catch {
        return null;
      }
    },
    set(next: LocalComponentPropValue): LocalComponentSetResult {
      if (readOnly) return { ok: false, diagnostics: [] };
      try {
        const diagnostics = environment.runtime.set(node, next);
        if (diagnostics.length > 0) environment.report(diagnostics);
        return { ok: diagnostics.length === 0, diagnostics };
      } catch {
        return { ok: false, diagnostics: [] };
      }
    },
  });
  const context: LocalComponentContext = Object.freeze({
    props: Object.freeze({ ...props }),
    bindings: Object.freeze({ value }),
    children: Object.freeze({
      render: (): ReactNode => environment.renderChildren(node.children, environment.visible),
    }),
    instance: Object.freeze({
      id: node.id,
      componentId: implementation.definition.id,
      range: Object.freeze({ start: node.range.start, end: node.range.end }),
    }),
    mode: environment.mode,
    visible: environment.visible,
    disabled: environment.disabled,
    resetToken: environment.resetToken,
    report: (diagnostics: Diagnostic[]) => environment.report(diagnostics),
  });
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
    createElement(LocalExtensionView, { implementation, node, environment }),
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

function createHostRenderer(index: LocalReactIndex): LocalHostRenderer {
  return (node: LocalNode, _data: unknown, ctx: LocalHostComponentContext): ReactNode =>
    renderExtensionNode(index, node, {
      runtime: ctx.runtime,
      mode: ctx.mode,
      visible: ctx.visible,
      disabled: ctx.disabled,
      resetToken: ctx.resetToken,
      renderChildren: (nodes, visible) => ctx.render(nodes, visible),
      report: (diagnostics) => ctx.report(diagnostics),
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
