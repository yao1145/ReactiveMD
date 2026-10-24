import { describe, expect, it } from 'vitest';
import { parseLocal } from '../src/local/parser';
import {
  LOCAL_COMPONENTS,
  LOCAL_COMPONENT_NAMES,
  localComponentNames,
} from '../src/local/schema';
import { COMPONENTS, VISUAL_COMPONENTS } from '../src/local/LocalDocumentView';
import type { LocalNode } from '../src/local/types';

/*
 * These literal lists are the tag sets parser.ts hardcoded before deriving
 * them from component forms. They deliberately pin the accepted local-draft-2
 * syntax: a schema form change alters which tags self-close, require a closing
 * tag or inline their content. If such a change is intended, update these
 * lists in the same change and treat it as a syntax change, not a refactor.
 */
const LEGACY_VOID = 'input textarea number slider range-slider coordinate toggle checkbox date counter timer progress edge anchor computed const validation column'.split(' ');
const LEGACY_PAIRED = 'panel card grid tabs tab steps step accordion disclosure if alert badge tooltip select choices radio-group multi-select quiz checklist table chart plot timeline diagram node option jump text section data-table'.split(' ');
const LEGACY_INLINE = ['badge', 'tooltip', 'jump', 'text'];

const sorted = (values: readonly string[]): string[] => [...values].sort();

const findComponent = (nodes: LocalNode[], name: string): LocalNode | undefined =>
  nodes
    .flatMap((node) => [node, ...(node.children ?? [])])
    .find((node) => node.type === 'component' && node.name === name);

describe('schema component forms', () => {
  it('derive tag sets that match the previously hardcoded parser lists', () => {
    expect(sorted(localComponentNames('leaf'))).toEqual(sorted(LEGACY_VOID));
    expect(sorted([...localComponentNames('container'), ...localComponentNames('inline')]))
      .toEqual(sorted(LEGACY_PAIRED));
    expect(sorted(localComponentNames('inline'))).toEqual(sorted(LEGACY_INLINE));
  });

  it('group every schema component under exactly one known form', () => {
    const grouped = [
      ...localComponentNames('leaf'),
      ...localComponentNames('container'),
      ...localComponentNames('inline'),
    ];
    expect(grouped).toHaveLength(LOCAL_COMPONENT_NAMES.length);
    expect(sorted(grouped)).toEqual(sorted(LOCAL_COMPONENT_NAMES));
    for (const name of LOCAL_COMPONENT_NAMES) {
      expect(localComponentNames(LOCAL_COMPONENTS[name].form)).toContain(name);
    }
  });

  it('keeps parser tag acceptance in step with schema forms', () => {
    for (const name of localComponentNames('leaf')) {
      const selfClosed = parseLocal(`<${name} />`);
      expect(selfClosed.diagnostics.filter((entry) => entry.code.startsWith('local.tag')), name).toEqual([]);
      expect(selfClosed.nodes[0]?.name, name).toBe(name);

      const explicitlyClosed = parseLocal(`<${name}></${name}>`);
      expect(explicitlyClosed.diagnostics.map((entry) => entry.code), name).toContain('local.tag.mismatch');
    }
    for (const name of [...localComponentNames('container'), ...localComponentNames('inline')]) {
      const selfClosed = parseLocal(`<${name} />`);
      expect(selfClosed.diagnostics.map((entry) => entry.code), name).toContain('local.tag.shape');
    }
  });

  it('keeps inline content unwrapping limited to inline forms', () => {
    for (const name of localComponentNames('inline')) {
      const parsed = parseLocal(`<${name}>hello</${name}>`);
      expect(parsed.diagnostics, name).toEqual([]);
      expect(findComponent(parsed.nodes, name)?.children?.[0]?.type, name).toBe('text');
    }
    for (const name of localComponentNames('container')) {
      const parsed = parseLocal(`<${name}>hello</${name}>`);
      expect(parsed.diagnostics, name).toEqual([]);
      expect(findComponent(parsed.nodes, name)?.children?.[0]?.type, name).toBe('paragraph');
    }
  });
});

describe('schema and renderer registry coverage', () => {
  it('registers every schema component in exactly one view registry', () => {
    // renderComponent handles declarations and the generated table directly.
    const specialViews = ['computed', 'const', 'data-table'];
    const registered = new Set([...Object.keys(COMPONENTS), ...VISUAL_COMPONENTS, ...specialViews]);
    for (const name of LOCAL_COMPONENT_NAMES) {
      expect(registered.has(name), `<${name}> is declared in the schema but has no view`).toBe(true);
    }
    for (const name of registered) {
      expect(LOCAL_COMPONENTS[name], `<${name}> has a view but is not declared in the schema`).toBeDefined();
    }
    expect(registered.size).toBe(LOCAL_COMPONENT_NAMES.length);
    for (const name of VISUAL_COMPONENTS) {
      expect(COMPONENTS[name], `<${name}> is registered twice`).toBeUndefined();
    }
  });
});
