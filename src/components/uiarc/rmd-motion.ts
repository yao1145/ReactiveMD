/** Match RMD default's existing fast/base timing for the adapted controls. */
const ease: [number, number, number, number] = [0.22, 0.61, 0.36, 1];
export const rmdMotion = {
  fast: { type: 'tween' as const, duration: 0.15, ease },
  base: { type: 'tween' as const, duration: 0.22, ease },
};
