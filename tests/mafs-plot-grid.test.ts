import { describe, expect, it } from 'vitest';
import {
  normalizeGridRange,
  plotGridLayout,
  type PlotGridLayout,
} from '../src/components/mafs-plot-grid';

function cellSizes(layout: PlotGridLayout, width: number, height: number): { x: number; y: number } {
  return {
    x: (layout.xLines * width) / (layout.xRange.max - layout.xRange.min),
    y: (layout.yLines * height) / (layout.yRange.max - layout.yRange.min),
  };
}

function expectContains(layout: PlotGridLayout, xDomain: { min: number; max: number }, yDomain: { min: number; max: number }): void {
  expect(layout.xRange.min).toBeLessThanOrEqual(xDomain.min);
  expect(layout.xRange.max).toBeGreaterThanOrEqual(xDomain.max);
  expect(layout.yRange.min).toBeLessThanOrEqual(yDomain.min);
  expect(layout.yRange.max).toBeGreaterThanOrEqual(yDomain.max);
}

describe('plotGridLayout', () => {
  it('fits a curve whose y magnitude dwarfs x without collapsing it', () => {
    const width = 760;
    const height = 360;
    const xDomain = { min: 0, max: 20 };
    const yDomain = { min: 35000, max: 315000 };
    const layout = plotGridLayout({ xDomain, yDomain, width, height });

    expectContains(layout, xDomain, yDomain);
    // The x axis must stay near the data span; it must never inherit the
    // y magnitude the way a shared span/padding does.
    expect(layout.xRange.max - layout.xRange.min).toBeLessThan((xDomain.max - xDomain.min) * 1.6);
    // Several readable grid lines on both axes, not thousands.
    const xGridLines = (layout.xRange.max - layout.xRange.min) / layout.xLines;
    const yGridLines = (layout.yRange.max - layout.yRange.min) / layout.yLines;
    expect(xGridLines).toBeGreaterThanOrEqual(4);
    expect(xGridLines).toBeLessThanOrEqual(20);
    expect(yGridLines).toBeGreaterThanOrEqual(3);
    expect(yGridLines).toBeLessThanOrEqual(12);

    const cells = cellSizes(layout, width, height);
    expect(cells.x).toBeCloseTo(cells.y, 6);
    expect(cells.x).toBeGreaterThan(20);
    expect(cells.x).toBeLessThan(140);
  });

  it('keeps grid cells square across viewport sizes', () => {
    const widths = [240, 360, 520, 760, 960];
    const heights = [260, 320, 360, 480];
    const xDomain = { min: -2.5, max: 7.5 };
    const yDomain = { min: -1200, max: 3400 };
    for (const width of widths) {
      for (const height of heights) {
        const layout = plotGridLayout({ xDomain, yDomain, width, height });
        expectContains(layout, xDomain, yDomain);
        const cells = cellSizes(layout, width, height);
        expect(cells.x).toBeCloseTo(cells.y, 6);
        expect(layout.xLines).toBeGreaterThan(0);
        expect(layout.yLines).toBeGreaterThan(0);
        // Padding stays proportionate: no axis is inflated by the other span.
        expect(layout.xRange.max - layout.xRange.min).toBeLessThan((xDomain.max - xDomain.min) * 1.7);
        expect(layout.yRange.max - layout.yRange.min).toBeLessThan((yDomain.max - yDomain.min) * 1.7);
      }
    }
  });

  it('handles negative, constant and tiny ranges', () => {
    const cases = [
      { xDomain: { min: -10, max: -2 }, yDomain: { min: -4000, max: -1000 } },
      { xDomain: { min: 5, max: 5 }, yDomain: { min: 1000, max: 1000 } },
      { xDomain: { min: 1e-9, max: 3e-9 }, yDomain: { min: 0, max: 2e-9 } },
      { xDomain: { min: Number.NaN, max: 1 }, yDomain: { min: 0, max: Number.POSITIVE_INFINITY } },
    ];
    for (const { xDomain, yDomain } of cases) {
      const layout = plotGridLayout({ xDomain, yDomain, width: 520, height: 360 });
      for (const value of [
        layout.xLines, layout.yLines,
        layout.xRange.min, layout.xRange.max, layout.yRange.min, layout.yRange.max,
      ]) {
        expect(Number.isFinite(value)).toBe(true);
      }
      expect(layout.xLines).toBeGreaterThan(0);
      expect(layout.yLines).toBeGreaterThan(0);
      expect(layout.xRange.max).toBeGreaterThan(layout.xRange.min);
      expect(layout.yRange.max).toBeGreaterThan(layout.yRange.min);
      const cells = cellSizes(layout, 520, 360);
      expect(cells.x).toBeCloseTo(cells.y, 6);
    }

    const constant = plotGridLayout({
      xDomain: { min: 5, max: 5 },
      yDomain: { min: 1000, max: 1000 },
      width: 520,
      height: 360,
    });
    expect(constant.xRange.min).toBeLessThan(5);
    expect(constant.xRange.max).toBeGreaterThan(5);
    expect(constant.yRange.min).toBeLessThan(1000);
    expect(constant.yRange.max).toBeGreaterThan(1000);

    const tiny = plotGridLayout({
      xDomain: { min: 1e-9, max: 3e-9 },
      yDomain: { min: 0, max: 2e-9 },
      width: 520,
      height: 360,
    });
    expect(tiny.xLines).toBeLessThan(1);
    expect(tiny.yLines).toBeLessThan(1);
  });

  it('normalizes reversed and broken ranges', () => {
    expect(normalizeGridRange({ min: 4, max: -4 })).toEqual({ min: -4, max: 4 });
    const broken = normalizeGridRange({ min: Number.NaN, max: Number.NaN });
    expect(Number.isFinite(broken.min)).toBe(true);
    expect(broken.max).toBeGreaterThan(broken.min);
    const degenerate = normalizeGridRange({ min: 12, max: 12 });
    expect(degenerate.min).toBeLessThan(12);
    expect(degenerate.max).toBeGreaterThan(12);
  });
});
