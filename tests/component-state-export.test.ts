import { describe, expect, it } from 'vitest';
import { compileLocal } from '../src/local/compilation/compiler';
import { resolveLocalComponentStateExport } from '../src/export/component-state';
import { createLocalConfig, defineLocalComponent } from '../src/sdk';
import {
  LOCAL_COMPONENT_STATE_DOCUMENT_FORMAT,
  LOCAL_COMPONENT_STATE_FORMAT,
} from '../src/runtime-services/component-state';
import { componentStateKey, localSourceDigest } from '../src/runtime-services/identity';
import type { LocalNode } from '../src/local/contracts/types';

const PROTOCOL = 'reactive-md-component/v1';

function probeDefinition() {
  return defineLocalComponent({
    id: 'example/probe',
    name: 'probe',
    version: '1.0.0',
    protocol: PROTOCOL,
    form: 'leaf',
    props: { 'state-key': { kind: 'string' } },
    capabilities: { interactive: true, static: true, ssr: true, offline: true },
  });
}

function configFixture() {
  return createLocalConfig({ components: [probeDefinition()] });
}

function compile(source = '<probe state-key="demo">') {
  const config = configFixture();
  const result = compileLocal(source, { config });
  if (!result.ok) throw new Error(result.diagnostics.map((item) => item.message).join('; '));
  return result.document;
}

function probeNode(nodes: readonly LocalNode[]): LocalNode {
  for (const node of nodes) {
    if (node.name === 'probe') return node;
    const found = probeNode(node.children ?? []);
    if (found) return found;
  }
  throw new Error('missing probe');
}

function record(key: string, documentId?: string, data: unknown = { score: 1 }): Record<string, unknown> {
  return {
    format: LOCAL_COMPONENT_STATE_FORMAT,
    component: 'example/probe',
    componentVersion: '1.0.0',
    stateVersion: 0,
    key,
    ...(documentId === undefined ? {} : { documentId }),
    data,
  };
}

function sidecar(records: Record<string, unknown>, configKey?: string): unknown {
  return {
    format: LOCAL_COMPONENT_STATE_DOCUMENT_FORMAT,
    ...(configKey === undefined ? {} : { configKey }),
    records,
  };
}

describe('component state export resolution', () => {
  it('keeps records that match the default identity and a live component', () => {
    const document = compile();
    const documentId = localSourceDigest(document.source);
    const key = componentStateKey({
      documentId,
      sourceDigest: documentId,
      nodeId: probeNode(document.nodes).id,
      stateKey: 'demo',
    });
    const result = resolveLocalComponentStateExport(document, sidecar({ [key]: record(key, documentId) }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostics).toEqual([]);
    expect(Object.keys(result.componentState.records)).toEqual([key]);
    expect(result.componentState.records[key].data).toEqual({ score: 1 });
  });

  it('uses a host document identity when one is supplied', () => {
    const document = compile();
    const sourceDigest = localSourceDigest(document.source);
    const key = componentStateKey({
      documentId: 'stable-doc',
      sourceDigest,
      nodeId: probeNode(document.nodes).id,
      stateKey: 'demo',
    });
    const payload = sidecar({ [key]: record(key, 'stable-doc') });

    expect(resolveLocalComponentStateExport(document, payload, { documentId: 'stable-doc' }))
      .toMatchObject({ ok: true, diagnostics: [] });
    const mismatch = resolveLocalComponentStateExport(document, payload);
    expect(mismatch.ok).toBe(true);
    if (mismatch.ok) {
      expect(mismatch.diagnostics[0].code).toBe('local.runtime.state.document-mismatch');
      expect(Object.keys(mismatch.componentState.records)).toEqual([]);
    }
  });

  it('drops records for changed components and other documents with warnings', () => {
    const document = compile();
    const sourceDigest = localSourceDigest(document.source);
    const key = componentStateKey({
      documentId: sourceDigest,
      sourceDigest,
      nodeId: probeNode(document.nodes).id,
      stateKey: 'demo',
    });
    const result = resolveLocalComponentStateExport(document, sidecar({
      'doc:other:state:gone': record('doc:other:state:gone', sourceDigest),
      [key]: record(key, 'another-document'),
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostics.map((item) => item.code).sort()).toEqual([
      'local.runtime.state.document-mismatch',
      'local.runtime.state.unknown-component',
    ]);
    expect(result.diagnostics.every((item) => item.severity === 'warning')).toBe(true);
    expect(result.componentState.records).toEqual({});
  });

  it('reports invalid records as errors but still returns valid ones', () => {
    const document = compile();
    const documentId = localSourceDigest(document.source);
    const key = componentStateKey({
      documentId,
      sourceDigest: documentId,
      nodeId: probeNode(document.nodes).id,
      stateKey: 'demo',
    });
    const result = resolveLocalComponentStateExport(document, sidecar({
      [key]: record(key, documentId),
      broken: { ...record('broken', documentId), data: { value: Number.POSITIVE_INFINITY } },
    }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.componentState.records)).toEqual([key]);
    expect(result.diagnostics.some((item) => item.severity === 'error')).toBe(true);
  });

  it('rejects payloads that are not a component state document', () => {
    const document = compile();
    expect(resolveLocalComponentStateExport(document, '{"format":"nope"}').ok).toBe(false);
    expect(resolveLocalComponentStateExport(document, 'not json').ok).toBe(false);
  });

  it('stamps the current config key onto an old sidecar', () => {
    const config = configFixture();
    const document = compile();
    const documentId = localSourceDigest(document.source);
    const key = componentStateKey({
      documentId,
      sourceDigest: documentId,
      nodeId: probeNode(document.nodes).id,
      stateKey: 'demo',
    });
    const result = resolveLocalComponentStateExport(
      document,
      sidecar({ [key]: record(key, documentId) }),
      { configKey: config.key },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostics).toEqual([]);
    expect(result.componentState.configKey).toBe(config.key);
    expect(Object.keys(result.componentState.records)).toEqual([key]);
  });

  it('accepts a legacy config key and re-stamps the current one', () => {
    const config = configFixture();
    const legacy = config.legacyKeys[0]?.key;
    expect(legacy).toBeDefined();
    const document = compile();
    const documentId = localSourceDigest(document.source);
    const key = componentStateKey({
      documentId,
      sourceDigest: documentId,
      nodeId: probeNode(document.nodes).id,
      stateKey: 'demo',
    });
    const result = resolveLocalComponentStateExport(
      document,
      sidecar({ [key]: record(key, documentId) }, legacy),
      { configKey: config.key, legacyConfigKeys: [legacy as string] },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.diagnostics).toEqual([]);
    expect(result.componentState.configKey).toBe(config.key);
    expect(Object.keys(result.componentState.records)).toEqual([key]);
  });

  it('drops every record written by another configuration with a warning', () => {
    const config = configFixture();
    const document = compile();
    const documentId = localSourceDigest(document.source);
    const key = componentStateKey({
      documentId,
      sourceDigest: documentId,
      nodeId: probeNode(document.nodes).id,
      stateKey: 'demo',
    });
    const result = resolveLocalComponentStateExport(
      document,
      sidecar({ [key]: record(key, documentId) }, 'rmd-other'),
      { configKey: config.key },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.componentState.records).toEqual({});
    expect(result.componentState.configKey).toBe(config.key);
    expect(result.diagnostics.map((item) => item.code)).toEqual(['local.runtime.state.config-mismatch']);
    expect(result.diagnostics[0]?.severity).toBe('warning');
  });

  it('preserves the sidecar config key when no current key is supplied', () => {
    const document = compile();
    const documentId = localSourceDigest(document.source);
    const key = componentStateKey({
      documentId,
      sourceDigest: documentId,
      nodeId: probeNode(document.nodes).id,
      stateKey: 'demo',
    });
    const result = resolveLocalComponentStateExport(
      document,
      sidecar({ [key]: record(key, documentId) }, 'rmd-saved'),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.componentState.configKey).toBe('rmd-saved');
    expect(Object.keys(result.componentState.records)).toEqual([key]);
  });
});
