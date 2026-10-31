import { describe, expect, it, vi } from 'vitest';
import { resolveConfig } from 'vite';
import { reactiveMd } from '../src/vite';

describe('ReactiveMD Vite adapter', () => {
  it('merges dependency settings and supplies a host module with managed styles', async () => {
    const plugin = reactiveMd({ extensions: './extensions.ts' });
    const resolved = await resolveConfig({ configFile: false, root: process.cwd(), plugins: [plugin],
      resolve: { dedupe: ['user-package'] }, optimizeDeps: { exclude: ['user-excluded'] } }, 'serve');
    expect(resolved.resolve.dedupe).toEqual(expect.arrayContaining(['user-package', 'react', 'react-dom']));
    expect(resolved.optimizeDeps.exclude).toEqual(expect.arrayContaining(['user-excluded', 'reactive-md/sdk', 'reactive-md/presets/default', 'reactive-md/vite']));
    expect(resolved.optimizeDeps.include).toEqual(expect.arrayContaining(['react', 'react-dom', 'react-dom/client']));
    const watched = vi.fn();
    const load = plugin.load as (this: { addWatchFile(file: string): void }, id: string) => Promise<string | null>;
    const source = await load.call({ addWatchFile: watched }, '\0virtual:reactive-md/host');
    expect(source).toContain('export {host,extensions}');
    expect(source).toContain('style.textContent=host.css');
    expect(source).toContain('hot.dispose');
    expect(watched).toHaveBeenCalledWith(expect.stringContaining('extensions.ts'));
    expect(await load.call({ addWatchFile: watched }, 'unrelated')).toBeNull();
  });
  it('requires an explicit local registration module', () => {
    expect(() => reactiveMd({ extensions: '' })).toThrow('local extensions');
    expect(() => reactiveMd({ extensions: 'https://example.com/plugin.js' })).toThrow('local extensions');
  });
});
