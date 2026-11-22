import type { LocaleCode } from '@titoforce/shared';
import de from './de.ts';
import es from './es.ts';
import fr from './fr.ts';
import ja from './ja.ts';
import pt from './pt.ts';

/** Built-in translations of the labels every organization starts with, by locale. */
export const GLOSSARIES: Record<Exclude<LocaleCode, 'en'>, Record<string, string>> = { es, fr, de, pt, ja };
