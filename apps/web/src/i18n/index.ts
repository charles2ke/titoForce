import { createElement, Fragment, type ReactNode, useSyncExternalStore } from 'react';
import en from './messages/en/index.ts';
import type { PluralCategory, PluralForms, PluralMessage } from './plural.ts';

/**
 * Minimal, dependency-free i18n.
 *
 * - The English catalog (messages/en) is the source of truth; its shape defines every message key.
 * - Other locales are typed as `Translation`, so `npm run typecheck` fails when a key is missing or misspelled.
 * - `t()` is a plain function: components re-render on a locale switch because the app tree is keyed by locale.
 */

export const LOCALES = [
  { code: 'en', name: 'English', intl: 'en-US' },
  { code: 'es', name: 'Español', intl: 'es-ES' },
  { code: 'fr', name: 'Français', intl: 'fr-FR' },
  { code: 'de', name: 'Deutsch', intl: 'de-DE' },
  { code: 'pt', name: 'Português', intl: 'pt-BR' },
  { code: 'ja', name: '日本語', intl: 'ja-JP' },
] as const;

export type Locale = (typeof LOCALES)[number]['code'];
export const LOCALE_CODES = LOCALES.map((l) => l.code) as readonly Locale[];

export { plural, type PluralForms } from './plural.ts';

type Translated<T> = { [K in keyof T]: T[K] extends string ? string : T[K] extends PluralMessage ? PluralForms : Translated<T[K]> };

export type Catalog = typeof en;
/** Shape every non-English catalog must have: the same keys as English, any wording. */
export type Translation = Translated<Catalog>;
type DeepPartial<T> = { [K in keyof T]?: T[K] extends string ? string : T[K] extends PluralForms ? PluralForms : DeepPartial<T[K]> };
/** A catalog that may be incomplete (missing keys fall back to English). */
export type PartialTranslation = DeepPartial<Translation>;

type Leaves<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : T[K] extends PluralMessage ? `${P}${K}` : Leaves<T[K], `${P}${K}.`>;
}[keyof T & string];

/** Every valid message key, e.g. `'common.save'`. */
export type MessageKey = Leaves<Catalog>;
export type Vars = Record<string, string | number>;

type Tree = { [k: string]: string | PluralForms | Tree };

const loaders: Record<Exclude<Locale, 'en'>, () => Promise<{ default: unknown }>> = {
  es: () => import('./messages/es/index.ts'),
  fr: () => import('./messages/fr/index.ts'),
  de: () => import('./messages/de/index.ts'),
  pt: () => import('./messages/pt/index.ts'),
  ja: () => import('./messages/ja/index.ts'),
};

const STORAGE_KEY = 'tf.locale';

type State = { locale: Locale; intl: string; messages: Tree; ready: boolean };
let state: State = { locale: 'en', intl: 'en-US', messages: en as unknown as Tree, ready: false };
const listeners = new Set<() => void>();
const changeHandlers = new Set<(locale: Locale) => void>();

export const isLocale = (v: unknown): v is Locale => typeof v === 'string' && (LOCALE_CODES as readonly string[]).includes(v);

/** The browser's preferred supported locale, if any. */
export function browserLocale(): Locale | null {
  const langs = typeof navigator === 'undefined' ? [] : navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const tag of langs) {
    const base = tag?.toLowerCase().split('-')[0];
    if (isLocale(base)) return base;
  }
  return null;
}

/** Locale picked on this device (login page or last signed-in user). */
export function storedLocale(): Locale | null {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return isLocale(v) ? v : null;
  } catch {
    return null;
  }
}

/** Uses the browser's regional variant (e.g. en-GB, fr-CA) for dates and numbers when it matches the UI language. */
function intlTag(locale: Locale): string {
  const fallback = LOCALES.find((l) => l.code === locale)!.intl;
  const langs = typeof navigator === 'undefined' ? [] : (navigator.languages ?? []);
  const regional = langs.find((tag) => tag.toLowerCase().split('-')[0] === locale && tag.includes('-'));
  try {
    return regional ? (Intl.getCanonicalLocales(regional)[0] ?? fallback) : fallback;
  } catch {
    return fallback;
  }
}

export const getLocale = (): Locale => state.locale;
/** BCP 47 tag for `Intl` formatters, matching the UI language. */
export const intlLocale = (): string => state.intl;

/** Switches the UI language (loading its catalog on demand). `persist` remembers the choice on this device. */
export async function setLocale(locale: Locale, { persist = true }: { persist?: boolean } = {}): Promise<void> {
  if (persist) {
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      // Storage unavailable (private mode): the choice lasts for this page only.
    }
  }
  if (state.ready && locale === state.locale) return;
  const messages = locale === 'en' ? (en as unknown as Tree) : ((await loaders[locale]()).default as Tree);
  state = { locale, intl: intlTag(locale), messages, ready: true };
  pluralRules.clear();
  numberFormats.clear();
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
  for (const l of listeners) l();
  for (const h of changeHandlers) h(locale);
}

/** Stops remembering a language on this device, so the browser's applies again. */
export function forgetStoredLocale(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable: nothing was remembered.
  }
}

/** Loads the initial locale before the first render: this device's choice, then the browser language, then English. */
export async function initI18n(): Promise<void> {
  try {
    await setLocale(storedLocale() ?? browserLocale() ?? 'en', { persist: false });
  } catch {
    await setLocale('en', { persist: false });
  }
}

/** Runs after every locale switch (e.g. to refetch server data that is translated per request). */
export function onLocaleChange(handler: (locale: Locale) => void): () => void {
  changeHandlers.add(handler);
  return () => changeHandlers.delete(handler);
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Current locale as React state (re-renders on change). */
export const useLocale = (): Locale => useSyncExternalStore(subscribe, getLocale, getLocale);

const pluralRules = new Map<string, Intl.PluralRules>();
const numberFormats = new Map<string, Intl.NumberFormat>();

function lookup(tree: Tree, key: string): string | PluralForms | undefined {
  let node: string | PluralForms | Tree | undefined = tree;
  for (const part of key.split('.')) {
    if (!node || typeof node !== 'object') return undefined;
    node = (node as Tree)[part];
  }
  if (typeof node === 'string') return node;
  return node && typeof node === 'object' && typeof node.other === 'string' ? (node as PluralForms) : undefined;
}

function pick(msg: string | PluralForms, count: unknown): string {
  if (typeof msg === 'string') return msg;
  if (typeof count !== 'number') return msg.other;
  if (count === 0 && msg.zero !== undefined) return msg.zero;
  let rules = pluralRules.get(state.intl);
  if (!rules) {
    rules = new Intl.PluralRules(state.intl);
    pluralRules.set(state.intl, rules);
  }
  return msg[rules.select(count) as PluralCategory] ?? msg.other;
}

/** Formats a number for a `{placeholder}` with the active locale's digit grouping. */
export function formatCount(n: number): string {
  let f = numberFormats.get('count');
  if (!f) {
    f = new Intl.NumberFormat(state.intl, { maximumFractionDigits: 2 });
    numberFormats.set('count', f);
  }
  return f.format(n);
}

function template(key: string, vars?: Record<string, unknown>): string | undefined {
  const msg = lookup(state.messages, key) ?? lookup(en as unknown as Tree, key);
  return msg === undefined ? undefined : pick(msg, vars?.count);
}

function interpolate(text: string, vars?: Vars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, name: string) => {
    const v = vars[name];
    return v === undefined ? m : typeof v === 'number' ? formatCount(v) : v;
  });
}

/**
 * Translates `key`, replacing `{name}` placeholders with `vars`. Numbers are locale-formatted (pass `String(year)` for years).
 * For plural messages, `vars.count` selects the form.
 */
export function t(key: MessageKey, vars?: Vars): string {
  const text = template(key, vars);
  return text === undefined ? key : interpolate(text, vars);
}

/** Like `t()` for keys built at runtime from data; `undefined` when the key does not exist. */
export function tryT(key: string, vars?: Vars): string | undefined {
  const text = template(key, vars);
  return text === undefined ? undefined : interpolate(text, vars);
}

/** The English text of a message, for text that must stay English (e.g. prompts for the built-in English-only rules engine). */
export function tEn(key: MessageKey, vars?: Vars): string {
  const msg = lookup(en as unknown as Tree, key);
  if (msg === undefined) return key;
  const text = typeof msg === 'string' ? msg : typeof vars?.count === 'number' && vars.count === 1 && msg.one !== undefined ? msg.one : msg.other;
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (vars?.[name] === undefined ? m : String(vars[name])));
}

/**
 * A metadata label (e.g. "Opportunity") used inside a sentence. English, Spanish, French and Portuguese lower-case
 * common nouns mid-sentence; German capitalizes all nouns, and Japanese has no letter case.
 */
export const inSentence = (label: string): string => (state.locale === 'de' ? label : label.toLowerCase());

/** Like `t()`, but placeholder values may be React nodes (links, bold text, …). */
export function tx(key: MessageKey, vars: Record<string, ReactNode>): ReactNode {
  const text = template(key, vars) ?? key;
  const parts = text.split(/(\{\w+\})/);
  return createElement(
    Fragment,
    null,
    ...parts.map((part, i) => {
      const m = /^\{(\w+)\}$/.exec(part);
      if (!m || !(m[1]! in vars)) return part;
      const v = vars[m[1]!];
      return createElement(Fragment, { key: i }, typeof v === 'number' ? formatCount(v) : v);
    }),
  );
}

/** "a, b and c" (or "a, b or c") in the active locale. */
export function formatList(items: string[], type: 'conjunction' | 'disjunction' = 'conjunction'): string {
  return new Intl.ListFormat(state.intl, { style: 'long', type }).format(items);
}
