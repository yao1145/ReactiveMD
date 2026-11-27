import { describe, expect, it } from 'vitest';
import { createReactHost } from '../src/react';
import { deriveLocalReactPreset } from '../src/react/packed';
import { layoutReactPack } from '../src/components/packs/layout';
import { dataReactPack } from '../src/components/packs/data';
import { dataPack, layoutPack } from '../src/presets/packs';
import { createLocalConfig } from '../src/assemblies/default-config';
import { deriveLocalPreset } from '../src/sdk/preset';

describe('layout and data pack ownership', () => {
  it('declares the column component only in the data pack', () => {
    expect(layoutPack.components.some((item) => item.name === 'column')).toBe(false);
    expect(dataPack.components.some((item) => item.name === 'column')).toBe(true);
    expect(() => createLocalConfig({ presets: [layoutPack, dataPack] })).not.toThrow();
    const host = createReactHost({ presets: [layoutReactPack, dataReactPack] });
    expect(host.config.registry.filter((item) => item.name === 'column')).toHaveLength(1);
  });

  it('keeps column and table styles in a derived data preset', () => {
    const derived = deriveLocalPreset(dataPack, { include: ['data-table', 'column'] });
    expect(derived.components.map((item) => item.name)).toEqual(['data-table', 'column']);
    const derivedReact = deriveLocalReactPreset(dataReactPack, { include: ['data-table', 'column'] });
    const host = createReactHost({ presets: [derivedReact] });
    expect(host.config.registry.map((item) => item.name)).toEqual(['data-table', 'column']);
    expect(host.config.registry.filter((item) => item.name === 'column')).toHaveLength(1);
    expect(host.css).toContain('.local-visual-table');
  });
});