import { createContext } from 'react';
import type { LocalFontAliases } from '../contracts/font-aliases';

/** The selected font families of one document instance. */
export const LocalFontAliasesContext = createContext<LocalFontAliases | undefined>(undefined);
