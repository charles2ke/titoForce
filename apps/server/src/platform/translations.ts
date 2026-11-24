import { type LocaleCode, type ObjectDef, type PageLayoutDef, SUPPORTED_LOCALES, type TranslationEntry } from '@titoforce/shared';
import type { Db } from '../db/database.ts';
import { GLOSSARIES } from '../i18n/glossary/index.ts';
import { type AppTexts, appKey, appTexts, fieldKey, navKey, objectKey, objectTexts, picklistKey, sectionKey, standardSource, type TranslatableText } from '../i18n/source.ts';
import { badRequest, chunk, nowIso, placeholders } from '../util.ts';
import type { LayoutService } from './layouts.ts';
import type { MetadataService } from './metadata.ts';
import type { AppService } from './views.ts';

export const isSupportedLocale = (v: unknown): v is LocaleCode => typeof v === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(v);

/** Metadata labels in one language: an administrator's translation, else the built-in one while the label is standard, else English. */
export class Translator {
  readonly locale: LocaleCode;
  private overrides: ReadonlyMap<string, string>;
  private builtIn: Readonly<Record<string, string>>;

  constructor(locale: LocaleCode, overrides: ReadonlyMap<string, string> = new Map(), builtIn: Readonly<Record<string, string>> = {}) {
    this.locale = locale;
    this.overrides = overrides;
    this.builtIn = builtIn;
  }

  /** Built-in translation of a label that still has its standard English text. */
  builtInText(key: string, english: string): string | null {
    const text = this.builtIn[key];
    return text !== undefined && standardSource().get(key) === english ? text : null;
  }

  text(key: string, english: string): string {
    return this.overrides.get(key) ?? this.builtInText(key, english) ?? english;
  }

  object(def: ObjectDef): ObjectDef {
    if (this.locale === 'en') return def;
    const o = def.apiName;
    return {
      ...def,
      label: this.text(objectKey(o, 'label'), def.label),
      pluralLabel: this.text(objectKey(o, 'pluralLabel'), def.pluralLabel),
      description: def.description && this.text(objectKey(o, 'description'), def.description),
      fields: def.fields.map((f) => ({
        ...f,
        label: this.text(fieldKey(o, f.apiName, 'label'), f.label),
        helpText: f.helpText && this.text(fieldKey(o, f.apiName, 'helpText'), f.helpText),
        options: f.options?.map((opt) => {
          const label = this.text(picklistKey(o, f.apiName, opt.value), opt.value);
          return label === opt.value ? opt : { ...opt, label };
        }),
      })),
    };
  }

  app<T extends AppTexts>(app: T): T {
    if (this.locale === 'en') return app;
    return {
      ...app,
      name: this.text(appKey(app.id, 'name'), app.name),
      description: app.description && this.text(appKey(app.id, 'description'), app.description),
      nav: app.nav.map((item) => (item.label ? { ...item, label: this.text(navKey(app.id, item), item.label) } : item)),
    };
  }

  layout(layout: PageLayoutDef): PageLayoutDef {
    if (this.locale === 'en') return layout;
    return { ...layout, sections: layout.sections.map((s) => (s.title ? { ...s, title: this.text(sectionKey(layout.object, s.id), s.title) } : s)) };
  }
}

const ENGLISH = new Translator('en');

/** Removes administrators' translations of deleted metadata, so metadata re-created under the same name starts untranslated. */
export async function deleteTranslations(db: Db, prefixes: string[]): Promise<void> {
  const keys = (await db.all<{ key: string }>('SELECT DISTINCT key FROM translations')).map((r) => r.key).filter((k) => prefixes.some((p) => k.startsWith(p)));
  for (const part of chunk(keys, 200)) await db.run(`DELETE FROM translations WHERE key IN (${placeholders(part.length)})`, part);
}

/** Translations of metadata labels (Setup → Translations). English is the base language and is edited in Setup itself. */
export class TranslationService {
  private db: Db;
  private metadata: MetadataService;
  private apps: AppService;
  private layouts: LayoutService;
  private overrides = new Map<LocaleCode, Map<string, string>>();
  /** Called after translations change (clients reload their metadata). */
  onChange: (() => void) | null = null;

  constructor(db: Db, metadata: MetadataService, apps: AppService, layouts: LayoutService) {
    this.db = db;
    this.metadata = metadata;
    this.apps = apps;
    this.layouts = layouts;
  }

  private async overridesFor(locale: LocaleCode): Promise<Map<string, string>> {
    let map = this.overrides.get(locale);
    if (!map) {
      const rows = await this.db.all<{ key: string; value: string }>('SELECT key, value FROM translations WHERE locale = ?', [locale]);
      map = new Map(rows.map((r) => [r.key, r.value]));
      this.overrides.set(locale, map);
    }
    return map;
  }

  /** Forgets cached translations (after they were changed outside this service, e.g. by a deployment). */
  invalidate(): void {
    this.overrides.clear();
  }

  async translator(locale: LocaleCode): Promise<Translator> {
    if (locale === 'en') return ENGLISH;
    return new Translator(locale, await this.overridesFor(locale), GLOSSARIES[locale]);
  }

  /** Every translatable label of the organization, in English. */
  async texts(): Promise<TranslatableText[]> {
    const out: TranslatableText[] = [];
    for (const def of this.metadata.list()) out.push(...objectTexts(def, (await this.layouts.list(def.apiName)).flatMap((l) => l.sections)));
    for (const app of await this.apps.list()) out.push(...appTexts(app));
    return out;
  }

  private assertTranslatable(locale: LocaleCode): asserts locale is Exclude<LocaleCode, 'en'> {
    if (locale === 'en') throw badRequest('English is the base language: rename labels where they are defined in Setup');
  }

  async entries(locale: LocaleCode): Promise<TranslationEntry[]> {
    this.assertTranslatable(locale);
    const overrides = await this.overridesFor(locale);
    const tr = await this.translator(locale);
    return (await this.texts()).map((t) => ({ ...t, value: overrides.get(t.key) ?? null, builtIn: tr.builtInText(t.key, t.source) }));
  }

  /** Saves translations; an empty or null value removes the override (the built-in translation or English applies again). */
  async save(locale: LocaleCode, entries: { key: string; value: string | null }[]): Promise<TranslationEntry[]> {
    this.assertTranslatable(locale);
    const known = new Set((await this.texts()).map((t) => t.key));
    for (const e of entries) if (!known.has(e.key)) throw badRequest(`Unknown label ${e.key}`);
    const now = nowIso();
    await this.db.transaction(async (tx) => {
      for (const e of entries) {
        const value = e.value?.trim();
        if (value) {
          await tx.run(
            `INSERT INTO translations (locale, key, value, updated_at) VALUES (?, ?, ?, ?)
             ON CONFLICT (locale, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
            [locale, e.key, value, now],
          );
        } else {
          await tx.run('DELETE FROM translations WHERE locale = ? AND key = ?', [locale, e.key]);
        }
      }
    });
    this.overrides.delete(locale);
    this.onChange?.();
    return this.entries(locale);
  }
}
