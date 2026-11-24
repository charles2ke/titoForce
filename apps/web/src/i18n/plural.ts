declare const PLURAL: unique symbol;

export type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';
/** Plural forms keyed by `Intl.PluralRules` category; `zero` is used for an exact count of 0 when present. */
export type PluralForms = Partial<Record<PluralCategory, string>> & { other: string };
export type PluralMessage = PluralForms & { readonly [PLURAL]: true };

/** Marks a message as count-dependent: `t(key, { count })` picks the form for the active locale. */
export const plural = <T extends PluralForms>(forms: T) => forms as T & { readonly [PLURAL]: true };
