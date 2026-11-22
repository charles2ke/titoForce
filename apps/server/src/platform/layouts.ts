import type { LayoutSection, ObjectDef, PageLayoutDef, RelatedListOption } from '@titoforce/shared';
import { type Db, parseJson } from '../db/database.ts';
import { badRequest, conflict, newId, notFound, nowIso } from '../util.ts';
import type { MetadataService } from './metadata.ts';
import type { UserService } from './users.ts';

export const MAX_HIGHLIGHTS = 6;
const MAX_SECTIONS = 30;
const SECTION_ID = /^[a-z0-9_]{1,40}$/;
/** The layout every object has until an administrator saves one (it is stored on first save, under a new id). */
export const IMPLICIT_LAYOUT_ID = 'default';
/** Section holding fields without a `section`; its empty title means "‹Object› Information" in the reader's language. */
const MAIN_SECTION_ID = 'information';

export type LayoutInput = Pick<PageLayoutDef, 'name' | 'isDefault' | 'highlights' | 'sections' | 'relatedLists' | 'roleIds'>;

export interface LayoutRow {
  id: string;
  object_api_name: string;
  name: string;
  is_default: number;
  definition: unknown;
  created_at: string;
  updated_at: string;
}

interface StoredDefinition {
  highlights: string[];
  sections: LayoutSection[];
  relatedLists: string[];
  roleIds: string[];
  /** The object's fields and related lists when the layout was saved: ones created later are placed automatically. */
  knownFields: string[];
  knownRelatedLists: string[];
}

/** 'Billing Address' → 'billing_address' (unique within `taken`, which it extends). */
export function sectionIdFor(title: string, taken: Set<string>): string {
  const base =
    title
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 32) || 'section';
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}_${i}`;
  taken.add(id);
  return id;
}

/** Sections of an object without a saved layout: fields grouped by their `section`, in field order. */
export function defaultSections(def: ObjectDef): LayoutSection[] {
  const sections: LayoutSection[] = [];
  const byTitle = new Map<string, LayoutSection>();
  const taken = new Set([MAIN_SECTION_ID]);
  for (const f of def.fields) {
    const title = f.section?.trim() ?? '';
    let s = byTitle.get(title);
    if (!s) {
      s = { id: title ? sectionIdFor(title, taken) : MAIN_SECTION_ID, title, columns: 2, fields: [] };
      byTitle.set(title, s);
      sections.push(s);
    }
    s.fields.push(f.apiName);
  }
  return sections;
}

/**
 * Lists of child records that can appear on an object's record page, one per lookup pointing at it. `objectOf` maps
 * child objects to the definitions whose labels are shown (e.g. translated ones).
 */
export function relatedListOptions(metadata: MetadataService, object: string, objectOf: (def: ObjectDef) => ObjectDef = (d) => d): RelatedListOption[] {
  const refs = metadata.referencingFields(object).filter(({ object: child, field }) => !(child.apiName === 'activity' && field.apiName === 'related_to'));
  return refs.map(({ object: child, field }) => {
    const shown = objectOf(child);
    const fieldLabel = shown.fields.find((f) => f.apiName === field.apiName)?.label ?? field.label;
    const ambiguous = refs.filter((r) => r.object.apiName === child.apiName).length > 1 || child.apiName === object;
    return { id: `${child.apiName}.${field.apiName}`, object: child.apiName, field: field.apiName, label: ambiguous ? `${shown.pluralLabel} (${fieldLabel})` : shown.pluralLabel };
  });
}

/**
 * Page layouts: which fields a record page shows in which sections, the header highlights and the related lists.
 * Objects can have several layouts assigned to roles; users of other roles get the default layout.
 */
export class LayoutService {
  private db: Db;
  private metadata: MetadataService;
  private users: UserService;
  /** Called after layouts change (clients reload their metadata). */
  onChange: (() => void) | null = null;

  constructor(db: Db, metadata: MetadataService, users: UserService) {
    this.db = db;
    this.metadata = metadata;
    this.users = users;
  }

  relatedListOptions(object: string): RelatedListOption[] {
    return relatedListOptions(this.metadata, object);
  }

  private implicit(def: ObjectDef): PageLayoutDef {
    return {
      id: IMPLICIT_LAYOUT_ID,
      object: def.apiName,
      name: `${def.label} Layout`,
      isDefault: true,
      highlights: (def.highlightFields ?? []).filter((f) => def.fields.some((x) => x.apiName === f)).slice(0, MAX_HIGHLIGHTS),
      sections: defaultSections(def),
      relatedLists: this.relatedListOptions(def.apiName).map((o) => o.id),
      roleIds: [],
    };
  }

  /** A stored layout, brought up to date with fields and related lists created or deleted since it was saved. */
  private toLayout(def: ObjectDef, row: LayoutRow): PageLayoutDef {
    const d = parseJson<Partial<StoredDefinition>>(row.definition, {});
    const fieldNames = new Set(def.fields.map((f) => f.apiName));
    const placed = new Set<string>();
    const sections: LayoutSection[] = (d.sections ?? []).map((s) => {
      const fields = s.fields.filter((f) => fieldNames.has(f) && !placed.has(f));
      for (const f of fields) placed.add(f);
      return { ...s, fields };
    });
    const known = new Set(d.knownFields ?? []);
    for (const f of def.fields) {
      if (known.has(f.apiName) || placed.has(f.apiName)) continue;
      const target = sections.find((s) => !!f.section && s.title === f.section) ?? sections[0];
      if (target) target.fields.push(f.apiName);
      else sections.push({ id: MAIN_SECTION_ID, title: '', columns: 2, fields: [f.apiName] });
      placed.add(f.apiName);
    }
    const options = this.relatedListOptions(def.apiName).map((o) => o.id);
    const knownLists = new Set(d.knownRelatedLists ?? []);
    const relatedLists = (d.relatedLists ?? []).filter((id) => options.includes(id));
    for (const id of options) if (!knownLists.has(id) && !relatedLists.includes(id)) relatedLists.push(id);
    return {
      id: row.id,
      object: row.object_api_name,
      name: row.name,
      isDefault: !!Number(row.is_default),
      highlights: (d.highlights ?? []).filter((f) => fieldNames.has(f)),
      sections,
      relatedLists,
      roleIds: d.roleIds ?? [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private rows(object: string): Promise<LayoutRow[]> {
    return this.db.all<LayoutRow>('SELECT * FROM page_layouts WHERE object_api_name = ? ORDER BY is_default DESC, name, id', [object]);
  }

  /** Every layout of an object (the implicit one while none is saved), default first. */
  async list(object: string): Promise<PageLayoutDef[]> {
    const def = this.metadata.require(object);
    const rows = await this.rows(object);
    return rows.length ? rows.map((r) => this.toLayout(def, r)) : [this.implicit(def)];
  }

  async get(object: string, id: string): Promise<PageLayoutDef> {
    const layout = (await this.list(object)).find((l) => l.id === id);
    if (!layout) throw notFound('Layout not found');
    return layout;
  }

  /** The layout users with this role see. */
  async forRole(object: string, roleId: string | null): Promise<PageLayoutDef> {
    const layouts = await this.list(object);
    return (roleId ? layouts.find((l) => l.roleIds.includes(roleId)) : undefined) ?? layouts.find((l) => l.isDefault) ?? layouts[0]!;
  }

  private async validate(def: ObjectDef, input: LayoutInput, id: string | null): Promise<LayoutInput> {
    const name = input.name?.trim() ?? '';
    if (!name || name.length > 80) throw badRequest('Layout name is required (max 80 characters)');
    const fieldNames = new Set(def.fields.map((f) => f.apiName));
    if (!input.sections?.length) throw badRequest('A layout needs at least one section');
    if (input.sections.length > MAX_SECTIONS) throw badRequest(`A layout can have at most ${MAX_SECTIONS} sections`);
    const sectionIds = new Set<string>();
    const placed = new Set<string>();
    const sections = input.sections.map((s) => {
      if (!SECTION_ID.test(s.id) || sectionIds.has(s.id)) throw badRequest(`Invalid or duplicate section id "${s.id}"`);
      sectionIds.add(s.id);
      const title = s.title?.trim() ?? '';
      if (title.length > 80) throw badRequest('Section titles have at most 80 characters');
      if (s.columns !== 1 && s.columns !== 2) throw badRequest('Sections have 1 or 2 columns');
      for (const f of s.fields) {
        if (!fieldNames.has(f)) throw badRequest(`Unknown field ${f}`);
        if (placed.has(f)) throw badRequest(`${def.fields.find((x) => x.apiName === f)!.label} is on the layout twice`);
        placed.add(f);
      }
      return { id: s.id, title, columns: s.columns, fields: [...s.fields] };
    });
    const highlights = [...new Set(input.highlights ?? [])];
    if (highlights.length > MAX_HIGHLIGHTS) throw badRequest(`At most ${MAX_HIGHLIGHTS} highlight fields`);
    for (const f of highlights) if (!fieldNames.has(f)) throw badRequest(`Unknown field ${f}`);
    const options = new Set(this.relatedListOptions(def.apiName).map((o) => o.id));
    const relatedLists = [...new Set(input.relatedLists ?? [])];
    for (const r of relatedLists) if (!options.has(r)) throw badRequest(`Unknown related list ${r}`);
    const roles = new Set((await this.users.listRoles()).map((r) => r.id));
    const roleIds = [...new Set(input.roleIds ?? [])];
    for (const r of roleIds) if (!roles.has(r)) throw badRequest(`Unknown role ${r}`);
    for (const other of await this.list(def.apiName)) {
      if (other.id === id) continue;
      const shared = other.roleIds.filter((r) => roleIds.includes(r));
      if (shared.length) throw conflict(`${shared.join(', ')} already use the layout "${other.name}"`);
    }
    return { name, isDefault: !!input.isDefault, highlights, sections, relatedLists, roleIds };
  }

  private definition(def: ObjectDef, l: LayoutInput): string {
    const stored: StoredDefinition = {
      highlights: l.highlights,
      sections: l.sections,
      relatedLists: l.relatedLists,
      roleIds: l.roleIds,
      knownFields: def.fields.map((f) => f.apiName),
      knownRelatedLists: this.relatedListOptions(def.apiName).map((o) => o.id),
    };
    return JSON.stringify(stored);
  }

  /**
   * Creates (`id` null) or updates a layout. Saving the implicit layout stores it; creating a layout while only the
   * implicit one exists stores that one too, so users of other roles keep seeing it.
   */
  async save(object: string, id: string | null, input: LayoutInput): Promise<PageLayoutDef> {
    const def = this.metadata.require(object);
    const rows = await this.rows(object);
    const implicit = !rows.length;
    const existing = id ? rows.find((r) => r.id === id) : undefined;
    if (id && !existing && !(implicit && id === IMPLICIT_LAYOUT_ID)) throw notFound('Layout not found');
    const layout = await this.validate(def, input, id);
    const wasDefault = existing ? !!Number(existing.is_default) : !!id;
    if (wasDefault && !layout.isDefault) throw badRequest('Make another layout the default first');
    const savedId = existing?.id ?? newId('lay');
    const now = nowIso();
    await this.db.transaction(async (tx) => {
      const insert = (layoutId: string, l: LayoutInput, isDefault: boolean) =>
        tx.run('INSERT INTO page_layouts (id, object_api_name, name, is_default, definition, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
          layoutId,
          object,
          l.name,
          isDefault ? 1 : 0,
          this.definition(def, l),
          now,
          now,
        ]);
      if (implicit && !id) await insert(newId('lay'), this.implicit(def), true);
      if (layout.isDefault) await tx.run('UPDATE page_layouts SET is_default = 0 WHERE object_api_name = ?', [object]);
      if (existing) {
        await tx.run('UPDATE page_layouts SET name = ?, is_default = ?, definition = ?, updated_at = ? WHERE id = ?', [
          layout.name,
          layout.isDefault ? 1 : 0,
          this.definition(def, layout),
          now,
          savedId,
        ]);
      } else {
        await insert(savedId, layout, layout.isDefault);
      }
    });
    this.onChange?.();
    return this.get(object, savedId);
  }

  /**
   * Stores layouts deployed from a sandbox under their own ids; check them with `validateStored` afterwards. A deployed
   * default replaces the current one. When the object only had its implicit layout and none of the deployed layouts is
   * the default, the implicit layout is stored first so users of other roles keep seeing it.
   */
  async deploy(object: string, deployed: LayoutRow[]): Promise<void> {
    const def = this.metadata.require(object);
    const rows = await this.rows(object);
    const now = nowIso();
    const hasDefault = deployed.some((r) => Number(r.is_default));
    if (!rows.length && !hasDefault) {
      await this.db.run('INSERT INTO page_layouts (id, object_api_name, name, is_default, definition, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?, ?)', [
        newId('lay'),
        object,
        this.implicit(def).name,
        this.definition(def, this.implicit(def)),
        now,
        now,
      ]);
    }
    if (hasDefault) await this.db.run('UPDATE page_layouts SET is_default = 0 WHERE object_api_name = ?', [object]);
    for (const r of deployed) {
      const definition = typeof r.definition === 'string' ? r.definition : JSON.stringify(r.definition);
      await this.db.run(
        `INSERT INTO page_layouts (id, object_api_name, name, is_default, definition, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET object_api_name = excluded.object_api_name, name = excluded.name, is_default = excluded.is_default,
           definition = excluded.definition, updated_at = excluded.updated_at`,
        [r.id, object, r.name, Number(r.is_default) ? 1 : 0, definition, now, now],
      );
    }
  }

  /** Checks a stored layout as saved (not as reconciled on reading) against the object's current fields, related lists and roles. */
  async validateStored(object: string, id: string): Promise<void> {
    const def = this.metadata.require(object);
    const rows = await this.rows(object);
    const row = rows.find((r) => r.id === id);
    if (!row) throw notFound('Layout not found');
    const d = parseJson<Partial<StoredDefinition>>(row.definition, {});
    const input: LayoutInput = {
      name: row.name,
      isDefault: !!Number(row.is_default),
      highlights: d.highlights ?? [],
      sections: d.sections ?? [],
      relatedLists: d.relatedLists ?? [],
      roleIds: d.roleIds ?? [],
    };
    await this.validate(def, input, id);
    if (!rows.some((r) => Number(r.is_default))) throw badRequest(`${def.label} would have no default layout; deploy its new default layout too`);
  }

  async delete(object: string, id: string): Promise<void> {
    this.metadata.require(object);
    const row = (await this.rows(object)).find((r) => r.id === id);
    if (!row) throw notFound('Layout not found');
    if (Number(row.is_default)) throw badRequest('The default layout cannot be deleted; make another layout the default first');
    await this.db.run('DELETE FROM page_layouts WHERE id = ?', [id]);
    this.onChange?.();
  }
}
