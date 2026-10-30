import { describe, expect, it } from 'vitest';
import { createLocalConfig, defineLocalComponent } from '../src/sdk';
import defaultPreset from '../src/presets/default';
import { createLocalComplianceReport, runLocalManifestCompliance } from '../src/testing';

describe('compliance evidence provenance', () => {
  const number = defaultPreset.components.find(component => component.name === 'number')!;
  const alias = defineLocalComponent({ ...number, name: 'package-number', id: 'example/package-number' });
  const config = createLocalConfig({ components: [alias] });

  it('rejects evidence from another component even for a partial report', () => {
    const report = createLocalComplianceReport({ config, component: alias.name,
      suites: [runLocalManifestCompliance(number)], capabilities: [] });
    expect(report.ok).toBe(false);
    expect(report.complete).toBe(false);
    expect(report.diagnostics.some(item => item.code === 'testing.suite-contract')).toBe(true);
  });

  it('marks a successful manifest-only check as partial', () => {
    const report = createLocalComplianceReport({ config, component: alias.name,
      suites: [runLocalManifestCompliance(alias)], capabilities: [] });
    expect(report.ok).toBe(true);
    expect(report.complete).toBe(false);
  });
});
