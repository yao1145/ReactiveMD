import { createContext, useContext, type ReactNode } from 'react';

// Renderer-owned appearance state, separate from the public component contract.
const DefaultThemeContext = createContext(false);

export function DefaultThemeProvider({ name, children }: { name: string; children: ReactNode }) {
  return <DefaultThemeContext.Provider value={name === 'default'}>{children}</DefaultThemeContext.Provider>;
}

export function useDefaultTheme(): boolean {
  return useContext(DefaultThemeContext);
}
