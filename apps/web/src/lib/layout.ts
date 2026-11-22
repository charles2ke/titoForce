import type { FieldDef, ObjectDef, PageLayoutDef } from '@titoforce/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api.ts';
import { fieldDef } from './format.ts';

export interface PageSection {
  id: string;
  title: string;
  columns: 1 | 2;
  fields: FieldDef[];
}

/** The current user's page layout of an object (their role's layout, else the default), with translated titles. */
export function useLayout(object: string | undefined) {
  return useQuery({ queryKey: ['layout', object], queryFn: () => api.get<PageLayoutDef>(`/api/objects/${object}/layout`), enabled: !!object, staleTime: 5 * 60_000 });
}

/**
 * Sections of a record page or form, in layout order. Without a layout (it failed to load) fields are grouped by
 * their section. `untitled` names a section without a title.
 */
export function pageSections(def: ObjectDef, layout: PageLayoutDef | undefined, untitled: string): PageSection[] {
  if (!layout) {
    const groups = new Map<string, FieldDef[]>();
    for (const f of def.fields) {
      const title = f.section || untitled;
      groups.set(title, [...(groups.get(title) ?? []), f]);
    }
    return [...groups].map(([title, fields]) => ({ id: title, title, columns: 2, fields }));
  }
  const byName = new Map(def.fields.map((f) => [f.apiName, f]));
  return layout.sections.map((s) => ({
    id: s.id,
    title: s.title || untitled,
    columns: s.columns,
    fields: s.fields.flatMap((name) => byName.get(name) ?? []),
  }));
}

/** Fields of the record header; the status field is left out because the path shows it. */
export function headerFields(def: ObjectDef, layout: PageLayoutDef | undefined): FieldDef[] {
  return (layout?.highlights ?? def.highlightFields ?? []).flatMap((name) => {
    const f = fieldDef(def, name);
    return f && f.apiName !== def.statusField ? [f] : [];
  });
}
