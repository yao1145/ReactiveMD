import { describe, expect, it } from 'vitest';
import { compileLocal, type LocalDocument } from 'reactive-md';
import {
  countDocumentImages,
  countParameterDifferences,
  deriveDocumentTitle,
  readPackageVersion,
} from '../src/export-html';

function compile(source: string): LocalDocument {
  const result = compileLocal(source);
  if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));
  return result.document;
}

describe('shareable HTML helpers', () => {
  it('derives the title from the first heading plain text', () => {
    const document = compile('# **Bold** and `code` heading\n\nBody copy');
    expect(deriveDocumentTitle(document)).toBe('Bold and code heading');
  });

  it('falls back to the stable title when no heading exists', () => {
    expect(deriveDocumentTitle(compile('Just prose.'))).toBe('Reactive MD document');
  });

  it('counts image nodes throughout the compiled tree', () => {
    const document = compile([
      '![One](images/one.png)',
      '',
      '> ![Nested](images/nested.png)',
    ].join('\n'));
    expect(countDocumentImages(document)).toBe(2);
    expect(countDocumentImages(compile('No images here.'))).toBe(0);
  });

  it('counts differing exported parameters, including arrays', () => {
    const initial = { count: 1, name: 'Ann', tags: ['a', 'b'], internal: 'x' };
    const publicNames = ['count', 'name', 'tags'];
    expect(countParameterDifferences(initial, { ...initial }, publicNames)).toBe(0);
    expect(countParameterDifferences(
      initial,
      { ...initial, count: 2, tags: ['a', 'b'] },
      publicNames,
    )).toBe(1);
    expect(countParameterDifferences(
      initial,
      { ...initial, tags: ['b', 'a'] },
      publicNames,
    )).toBe(1);
    expect(countParameterDifferences(
      initial,
      { ...initial, tags: ['a'] },
      publicNames,
    )).toBe(1);
    expect(countParameterDifferences(
      initial,
      { count: 1, tags: ['a', 'b'], internal: 'changed' },
      publicNames,
    )).toBe(1);
  });

  it('reads the generator version from package JSON without throwing', () => {
    expect(readPackageVersion('{"name":"demo","version":"1.2.3"}')).toBe('1.2.3');
    expect(readPackageVersion('{}')).toBe('0.0.0');
    expect(readPackageVersion('not json')).toBe('0.0.0');
  });
});
