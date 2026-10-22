import {
  createLocalRuntime,
  type LocalBinding,
  type LocalDocument,
  type LocalNode,
  type LocalValue,
} from 'reactive-md';

interface RetainedBinding {
  node: LocalNode;
  type: LocalBinding['type'];
  initialDefinition: string;
}

interface SavedPreview {
  bindings: Map<string, RetainedBinding>;
  state: Readonly<Record<string, LocalValue>>;
}

function retainableBindings(document: LocalDocument): Map<string, RetainedBinding> {
  const nodeIndex = new Map<string, LocalNode>();
  const collect = (nodes: LocalNode[]) => {
    for (const node of nodes) {
      nodeIndex.set(node.id, node);
      if (node.children) collect(node.children);
    }
  };
  collect(document.nodes);

  const result = new Map<string, RetainedBinding>();
  for (const [name, binding] of Object.entries(document.bindings)) {
    const controls = binding.nodeIds.flatMap((id) => nodeIndex.get(id) ?? []);
    // Checklist ids are positional, and a timer also owns running/paused UI
    // state. Start both afresh rather than reinterpret an old trial value.
    if (!controls.length || name.startsWith('@') || controls.some((node) => (
      node.attrs?.bind !== name || node.name === 'timer' || node.name === 'checklist'
    ))) continue;
    const explicitInitials = controls.flatMap((node) => (
      Object.hasOwn(node.attrs ?? {}, 'initial') ? [node.attrs!.initial] : []
    )).sort();
    result.set(name, {
      node: controls[0],
      type: binding.type,
      // Include the explicit definition as well as the effective default, so
      // adding/removing initial="0" still expresses an author-requested reset.
      initialDefinition: JSON.stringify([binding.initial, explicitInitials]),
    });
  }
  return result;
}

/** A single Playground trial session. It never writes to browser storage. */
export class PreviewStateSession {
  private saved: SavedPreview | null = null;
  private active: object | null = null;

  constructor(private retention = true) {}

  setRetention(enabled: boolean) {
    this.retention = enabled;
  }

  canPreview(document: LocalDocument, source: string): boolean {
    // A worker may still expose the previous example/import while compiling a
    // new one. A fresh session starts only from the current editor source.
    return this.saved !== null || document.source === source;
  }

  open(document: LocalDocument) {
    const runtime = createLocalRuntime(document);
    const bindings = retainableBindings(document);
    if (this.retention && this.saved) {
      for (const [name, target] of bindings) {
        const previous = this.saved.bindings.get(name);
        if (!previous || previous.type !== target.type || previous.initialDefinition !== target.initialDefinition) continue;
        if (!Object.hasOwn(this.saved.state, name)) continue;
        // set() applies every new/shared control constraint atomically. An
        // invalid candidate leaves the new document's initial value in place.
        runtime.set(target.node, this.saved.state[name]);
      }
    }
    const token = {};
    this.active = token;
    const capture = () => {
      if (this.active === token) this.saved = { bindings, state: runtime.snapshot().state };
    };
    capture();
    const unsubscribe = runtime.subscribe(capture);
    let released = false;
    return {
      runtime,
      release: () => {
        if (released) return;
        released = true;
        capture();
        unsubscribe();
        if (this.active === token) this.active = null;
        runtime.dispose();
      },
    };
  }
}
