import { describe, expect, it } from 'vitest';
import { defineLocalTheme } from '../src/sdk/theme';
import { softThemeDefinition } from '../examples/soft-theme/src/definition';

describe('soft theme package', () => {
  it('declares the soft theme identity', () => {
    expect(softThemeDefinition.name).toBe('soft');
    expect(softThemeDefinition.protocol).toBe('reactive-md-theme-1');
    expect(softThemeDefinition.colorSchemes).toEqual(['light', 'dark']);
  });

  it('validates through the public theme contract with no CSS resources', () => {
    const theme = defineLocalTheme({
      id: 'reactive-md/theme-soft',
      version: '1.0.0',
      ...softThemeDefinition,
      css: [],
    });

    expect(theme.name).toBe('soft');
    expect(theme.protocol).toBe('reactive-md-theme-1');
    expect(theme.colorSchemes).toEqual(['light', 'dark']);
    expect(theme.css).toEqual([]);
  });
});
