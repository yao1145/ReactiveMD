/**
 * Private locale context for the editor package.
 *
 * The editor keeps its own language state so it can be mounted anywhere
 * without touching the host document or borrowing the demo's provider.
 */

import { createContext, useContext, type ReactNode } from 'react';
import type { EditorLocale } from './types';

const EditorLocaleContext = createContext<EditorLocale>('en');

export function EditorLocaleProvider({
  locale,
  children,
}: {
  locale: EditorLocale;
  children: ReactNode;
}) {
  return <EditorLocaleContext.Provider value={locale}>{children}</EditorLocaleContext.Provider>;
}

export function useEditorLocale(): EditorLocale {
  return useContext(EditorLocaleContext);
}
