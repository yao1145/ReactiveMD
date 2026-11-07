import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { compileLocal } from '../src/local/compilation/compiler';
import { createLocalRuntime } from '../src/local/runtime/runtime';
import { LocalDocumentView } from '../src/local/rendering/LocalDocumentView';
import { createLocalConfig, defineLocalComponent } from '../src/sdk';
import {
  createReactConfig,
  defineReactComponent,
  type LocalComponentContext,
} from '../src/react/sdk';
import {
  classifySwipe,
  isEditableTarget,
  useComponentState,
  type UseComponentStateResult,
} from '../src/react/runtime';
import { LOCAL_COMPONENT_STATE_DOCUMENT_FORMAT, LOCAL_COMPONENT_STATE_FORMAT } from '../src/runtime-services';

interface GameState {
  score: number;
}

function isGameState(value: unknown): value is GameState {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && typeof (value as Record<string, unknown>).score === 'number';
}

describe('swipe classification', () => {
  it('requires the threshold and respects the axis lock', () => {
    expect(classifySwipe(5, 5, 'both', 24)).toBeNull();
    expect(classifySwipe(-30, 8, 'both', 24)).toBe('left');
    expect(classifySwipe(30, 8, 'horizontal', 24)).toBe('right');
    expect(classifySwipe(8, 30, 'horizontal', 24)).toBeNull();
    expect(classifySwipe(8, -30, 'vertical', 24)).toBe('up');
    expect(classifySwipe(8, 30, 'vertical', 24)).toBe('down');
  });

  it('handles non-element targets without a DOM', () => {
    expect(isEditableTarget(null)).toBe(false);
  });
});

describe('useComponentState', () => {
  function definition() {
    return defineLocalComponent({
      id: 'example/state-probe',
      name: 'state-probe',
      version: '1.0.0',
      protocol: 'reactive-md-component/v1',
      form: 'leaf',
      props: { 'state-key': { kind: 'string' } },
      capabilities: { interactive: true, static: true, ssr: true, offline: true },
    });
  }

  function mount(
    initial: unknown,
    options?: { version?: number },
  ): { result: UseComponentStateResult<GameState>; runtime: ReturnType<typeof createLocalRuntime> } {
    let captured: UseComponentStateResult<GameState> | null = null;
    const Probe = defineReactComponent(definition(), {
      render: (context: LocalComponentContext) => {
        captured = useComponentState<GameState>(context, {
          initial: () => ({ score: 0 }),
          validate: isGameState,
          version: options?.version ?? 1,
        });
        return <span>{captured.value.score}</span>;
      },
    });
    const config = createLocalConfig({ components: [definition()] });
    const reactConfig = createReactConfig(config, { components: [Probe] });
    const compiled = compileLocal('<state-probe state-key="demo">', { config });
    if (!compiled.ok) throw new Error('compile failed');
    const runtime = createLocalRuntime(compiled.document, {
      documentId: 'doc',
      componentState: initial,
    });
    try {
      renderToStaticMarkup(
        <LocalDocumentView document={compiled.document} runtime={runtime} reactConfig={reactConfig} mode="static" />,
      );
    } finally {
      runtime.dispose();
    }
    if (captured === null) throw new Error('probe did not render');
    return { result: captured, runtime };
  }

  function sidecar(key: string, data: unknown, stateVersion = 1): unknown {
    return {
      format: LOCAL_COMPONENT_STATE_DOCUMENT_FORMAT,
      records: {
        [key]: {
          format: LOCAL_COMPONENT_STATE_FORMAT,
          component: 'example/state-probe',
          componentVersion: '1.0.0',
          stateVersion,
          key,
          data,
        },
      },
    };
  }

  it('restores valid state and saves explicitly', () => {
    const stateKey = 'doc:doc:state:demo';

    const first = mount(sidecar(stateKey, { score: 3 }));
    expect(first.result.loaded).toBe(true);
    expect(first.result.value).toEqual({ score: 3 });
    expect(first.result.error).toBeNull();
    expect(first.result.save().ok).toBe(true);
    first.result.clear();
  });

  it('falls back when the saved version or shape is invalid', () => {
    const version = mount(sidecar('doc:doc:state:demo', { score: 9 }, 2));
    expect(version.result.loaded).toBe(false);
    expect(version.result.value).toEqual({ score: 0 });
    expect(version.result.error).toMatch(/version/);

    const shape = mount(sidecar('doc:doc:state:demo', { score: 'nine' }));
    expect(shape.result.loaded).toBe(false);
    expect(shape.result.value).toEqual({ score: 0 });
    expect(shape.result.error).toMatch(/shape/);
  });
});
