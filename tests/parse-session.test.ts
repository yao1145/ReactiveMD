import { describe, expect, it } from 'vitest';
import { LocalParseSession } from '../src/local/parse-session';
import { parseLocal } from '../src/local/parser';

const table = '|A|B|\n|-|-|\n|same|same|\n|same|same|';

describe('session-scoped parse reuse', () => {
  it('produces exactly the same nodes and diagnostics as an independent parse', () => {
    const source = `${table}\n\n- alpha\n- beta\n\nSimple paragraph with **bold** text.`;
    const session = new LocalParseSession();
    const first = session.parse(source);
    const independent = parseLocal(source);
    expect(first.nodes).toEqual(independent.nodes);
    expect(first.diagnostics).toEqual(independent.diagnostics);
    // A second identical parse reuses the intermediate plans but still
    // rebuilds the same final nodes, ids included.
    const second = session.parse(source);
    expect(second.nodes).toEqual(independent.nodes);
    expect(second.work?.reusedBlocks ?? 0).toBeGreaterThan(0);
  });

  it('reuses whole plans for identical block text', () => {
    const session = new LocalParseSession();
    session.parse(table);
    const before = session.stats.reusedBlocks;
    session.parse(table);
    expect(session.stats.reusedBlocks).toBeGreaterThan(before);
    expect(session.stats.hits).toBeGreaterThan(0);
    expect(session.stats.entries).toBeGreaterThan(0);
  });

  it('reuses unchanged table rows and list items when one row/item changes', () => {
    const session = new LocalParseSession();
    session.parse(table);
    const edited = '|A|B|\n|-|-|\n|same|same|\n|same|**same**|';
    const parsed = session.parse(edited);
    expect(parsed.nodes).toEqual(parseLocal(edited).nodes);
    expect(parsed.work?.reusedRows ?? 0).toBeGreaterThan(0);
    expect(session.stats.reusedRows).toBeGreaterThan(0);

    const listSession = new LocalParseSession();
    listSession.parse('- one\n- two');
    const listEdited = '- one\n- **two**';
    expect(listSession.parse(listEdited).nodes).toEqual(parseLocal(listEdited).nodes);
    expect(listSession.stats.reusedItems).toBeGreaterThan(0);
  });

  it('clears entries on an option change, clear() and dispose()', () => {
    const session = new LocalParseSession();
    session.parse(table);
    expect(session.stats.entries).toBeGreaterThan(0);

    // A different option key wipes the cache; the empty source writes nothing.
    session.parse('', { markdownBreaks: true });
    expect(session.stats.entries).toBe(0);

    session.parse(table);
    expect(session.stats.entries).toBeGreaterThan(0);
    session.clear();
    expect(session.stats.entries).toBe(0);
    expect(session.stats.hits).toBe(0);
    expect(session.stats.misses).toBe(0);

    session.dispose();
    expect(() => session.parse('x')).toThrowError(/disposed/);
  });

  it('reports additive parser work fields without exposing a document', () => {
    const session = new LocalParseSession();
    const parsed = session.parse(table);
    expect(parsed.work?.parseWork ?? 0).toBeGreaterThan(0);
    expect(parsed.work?.maxMarkdownDepth).toBe(0);
    expect(parsed.work?.timings).toBeDefined();
    expect(parsed.work?.cacheMisses ?? 0).toBeGreaterThan(0);
  });
});
