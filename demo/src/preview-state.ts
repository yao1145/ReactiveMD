import {
  applyLocalStateRetention,
  createLocalRuntime,
  planLocalStateRetention,
  type LocalDocument,
  type LocalValue,
} from 'reactive-md';

interface SavedPreview {
  document: LocalDocument;
  state: Readonly<Record<string, LocalValue>>;
  /** Source of the document this snapshot was captured from. */
  source: string;
}

interface ActivePreview {
  token: object;
  source: string;
}

/** A single Playground trial session. It never writes to browser storage. */
export class PreviewStateSession {
  private saved: SavedPreview | null = null;
  private active: ActivePreview | null = null;

  constructor(private retention = true) {}

  setRetention(enabled: boolean) {
    this.retention = enabled;
  }

  canPreview(document: LocalDocument, source: string): boolean {
    // A worker may still expose the previous example/import while compiling a
    // new one. A fresh session starts only from the current editor source.
    return this.saved !== null || document.source === source;
  }

  /**
   * Snapshot for export. It is only exposed while a runtime is active for the
   * exact same source, so an older retained session can never leak values from
   * a different document into a new export.
   */
  currentState(document: LocalDocument): Readonly<Record<string, LocalValue>> | null {
    if (!this.active || !this.saved) return null;
    if (this.active.source !== document.source || this.saved.source !== document.source) return null;
    return this.saved.state;
  }

  open(document: LocalDocument) {
    const runtime = createLocalRuntime(document);
    if (this.retention && this.saved) {
      // plan/apply validate every value against the new document and write
      // atomically, leaving the new initial values in place when a candidate
      // is stale or no longer valid.
      applyLocalStateRetention(runtime, planLocalStateRetention({
        previous: this.saved.document,
        state: this.saved.state,
        next: document,
      }));
    }
    const token = {};
    this.active = { token, source: document.source };
    const capture = () => {
      if (this.active?.token === token) {
        this.saved = { document, state: runtime.snapshot().state, source: document.source };
      }
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
        if (this.active?.token === token) this.active = null;
        runtime.dispose();
      },
    };
  }
}
