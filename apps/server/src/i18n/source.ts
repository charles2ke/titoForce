import type { AppNavItem, LayoutSection, ObjectDef, TranslationCategory } from '@titoforce/shared';
import { defaultSections } from '../platform/layouts.ts';
import { standardObjects } from '../seed/objects.ts';
import { STANDARD_APPS } from '../seed/setup.ts';

/** A label administrators can translate (Setup → Translations). */
export interface TranslatableText {
  key: string;
  category: TranslationCategory;
  object: string | null;
  /** English names locating the label, e.g. "Opportunity · Stage" (the kind of label is derived from the key). */
  context: string;
  /** Current English text. */
  source: string;
}

export interface AppTexts {
  id: string;
  name: string;
  description: string;
  nav: AppNavItem[];
}

export const objectKey = (object: string, prop: 'label' | 'pluralLabel' | 'description') => `object.${object}.${prop}`;
export const fieldKey = (object: string, field: string, prop: 'label' | 'helpText') => `field.${object}.${field}.${prop}`;
export const picklistKey = (object: string, field: string, value: string) => `picklist.${object}.${field}.${value}`;
export const sectionKey = (object: string, section: string) => `section.${object}.${section}`;
export const appKey = (app: string, prop: 'name' | 'description') => `app.${app}.${prop}`;
export const navKey = (app: string, item: AppNavItem) => `app.${app}.nav.${item.type === 'page' ? item.page : item.object}`;

/** Labels of an object, its fields, picklist values and the titles of its layout sections. */
export function objectTexts(def: ObjectDef, sections: LayoutSection[]): TranslatableText[] {
  const out: TranslatableText[] = [];
  const add = (key: string, category: TranslationCategory, context: string, source: string | undefined) => {
    if (source?.trim()) out.push({ key, category, object: def.apiName, context, source });
  };
  add(objectKey(def.apiName, 'label'), 'object', def.label, def.label);
  add(objectKey(def.apiName, 'pluralLabel'), 'object', def.label, def.pluralLabel);
  add(objectKey(def.apiName, 'description'), 'object', def.label, def.description);
  for (const f of def.fields) {
    add(fieldKey(def.apiName, f.apiName, 'label'), 'field', def.label, f.label);
    add(fieldKey(def.apiName, f.apiName, 'helpText'), 'field', `${def.label} · ${f.label}`, f.helpText);
    for (const o of f.options ?? []) add(picklistKey(def.apiName, f.apiName, o.value), 'picklist', `${def.label} · ${f.label}`, o.value);
  }
  const seen = new Set<string>();
  for (const s of sections) {
    if (seen.has(s.id)) continue;
    seen.add(s.id);
    add(sectionKey(def.apiName, s.id), 'layout', def.label, s.title);
  }
  return out;
}

/** An app's name, description and navigation labels (object tabs without their own label show the object's plural label). */
export function appTexts(app: AppTexts): TranslatableText[] {
  const out: TranslatableText[] = [];
  const add = (key: string, source: string | undefined) => {
    if (source?.trim()) out.push({ key, category: 'app', object: null, context: app.name, source });
  };
  add(appKey(app.id, 'name'), app.name);
  add(appKey(app.id, 'description'), app.description);
  for (const item of app.nav) add(navKey(app.id, item), item.label);
  return out;
}

let standard: Map<string, string> | null = null;

/**
 * English text of the labels every organization starts with. Built-in translations (the glossaries) cover exactly these
 * keys and apply only while a label still has its standard text, so renamed labels are never mistranslated.
 */
export function standardSource(): Map<string, string> {
  standard ??= new Map(
    [...standardObjects().flatMap((def) => objectTexts(def, defaultSections(def))), ...STANDARD_APPS.flatMap((app) => appTexts(app))].map((t) => [t.key, t.source]),
  );
  return standard;
}
