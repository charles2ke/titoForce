import {
  API_NAME_RE,
  ExpressionError,
  expressionIdentifiers,
  FIELD_TYPES,
  type FieldDef,
  type FormulaResultType,
  type ObjectDef,
  PALETTE,
  SYSTEM_FIELDS,
  toApiName,
} from '@titoforce/shared';
import { type Db, parseJson } from '../db/database.ts';
import { badRequest, conflict, notFound, nowIso } from '../util.ts';
import { deleteTranslations } from './translations.ts';

const FORMULA_TYPES: FormulaResultType[] = ['number', 'currency', 'percent', 'text', 'date', 'checkbox'];
// "name" is allowed only as the record-name field itself (it mirrors the records.name column).
const RESERVED = new Set<string>([...SYSTEM_FIELDS.filter((f) => f !== 'name'), 'fields', 'object', 'data', 'refs']);
const NUMERIC_TYPES = new Set(['number', 'currency', 'percent', 'rollup']);

export function isNumericField(f: FieldDef): boolean {
  return NUMERIC_TYPES.has(f.type) || (f.type === 'formula' && ['number', 'currency', 'percent'].includes(f.formulaType ?? ''));
}

export function isComputedField(f: FieldDef): boolean {
  return f.type === 'formula' || f.type === 'rollup';
}

/** Settings that change the stored names, formula and roll-up values of existing records (see recalculateObject). */
export const RECALC_OBJECT_KEYS: readonly (keyof ObjectDef)[] = ['nameField', 'nameTemplate'];
export const RECALC_FIELD_KEYS: readonly (keyof FieldDef)[] = ['formula', 'formulaType', 'rollup', 'precision'];

type ObjectInput = Omit<ObjectDef, 'fields' | 'createdAt' | 'updatedAt'>;

export class MetadataService {
  private db: Db;
  private cache = new Map<string, ObjectDef>();
  /** Called whenever the object definitions were (re)loaded after a change. */
  onChange: (() => void) | null = null;

  constructor(db: Db) {
    this.db = db;
  }

  async load(): Promise<void> {
    const objects = await this.db.all<{ api_name: string; definition: string; is_custom: number; created_at: string; updated_at: string }>(
      'SELECT * FROM objects',
    );
    const fields = await this.db.all<{ object_api_name: string; definition: string; sort_order: number }>(
      'SELECT * FROM fields ORDER BY object_api_name, sort_order',
    );
    this.cache.clear();
    for (const o of objects) {
      const def = parseJson<ObjectInput>(o.definition, {} as ObjectInput);
      this.cache.set(o.api_name, {
        ...def,
        apiName: o.api_name,
        isCustom: !!Number(o.is_custom),
        createdAt: o.created_at,
        updatedAt: o.updated_at,
        fields: fields.filter((f) => f.object_api_name === o.api_name).map((f) => parseJson<FieldDef>(f.definition, {} as FieldDef)),
      });
    }
    this.onChange?.();
  }

  list(): ObjectDef[] {
    return [...this.cache.values()].sort((a, b) => a.label.localeCompare(b.label));
  }

  get(apiName: string): ObjectDef | undefined {
    return this.cache.get(apiName);
  }

  require(apiName: string): ObjectDef {
    const def = this.cache.get(apiName);
    if (!def) throw notFound(`Unknown object "${apiName}"`);
    return def;
  }

  field(object: string, field: string): FieldDef | undefined {
    return this.cache.get(object)?.fields.find((f) => f.apiName === field);
  }

  /** All lookup fields (on any object) that can point at the given object. */
  referencingFields(object: string, includePolymorphic = true): { object: ObjectDef; field: FieldDef }[] {
    const out: { object: ObjectDef; field: FieldDef }[] = [];
    for (const o of this.cache.values()) {
      for (const f of o.fields) {
        if (f.type === 'lookup' && (f.referenceTo === object || (includePolymorphic && f.referenceTo === '*'))) out.push({ object: o, field: f });
      }
    }
    return out;
  }

  /** Rollup fields whose child object is the given object. */
  rollupsFromChild(childObject: string): { parent: ObjectDef; field: FieldDef }[] {
    const out: { parent: ObjectDef; field: FieldDef }[] = [];
    for (const o of this.cache.values()) for (const f of o.fields) if (f.type === 'rollup' && f.rollup?.childObject === childObject) out.push({ parent: o, field: f });
    return out;
  }

  /** Inserts or replaces an object definition and all of its fields (used by seeding and custom objects). */
  async saveObject(def: ObjectDef): Promise<ObjectDef> {
    const { fields, createdAt, updatedAt, ...rest } = def;
    const now = nowIso();
    await this.db.transaction(async (tx) => {
      await tx.run(
        `INSERT INTO objects (api_name, definition, is_custom, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (api_name) DO UPDATE SET definition = excluded.definition, is_custom = excluded.is_custom, updated_at = excluded.updated_at`,
        [def.apiName, JSON.stringify(rest), def.isCustom ? 1 : 0, createdAt ?? now, now],
      );
      await tx.run('DELETE FROM fields WHERE object_api_name = ?', [def.apiName]);
      let i = 0;
      for (const f of fields) {
        await tx.run('INSERT INTO fields (object_api_name, api_name, definition, sort_order) VALUES (?, ?, ?, ?)', [
          def.apiName,
          f.apiName,
          JSON.stringify({ ...f, sortOrder: f.sortOrder ?? i }),
          f.sortOrder ?? i,
        ]);
        i++;
      }
    });
    await this.load();
    return this.require(def.apiName);
  }

  /** Validates every field of a set of object definitions against each other (cross references allowed). */
  validateAll(defs: ObjectDef[]): void {
    const known = new Map([...this.cache.entries(), ...defs.map((d) => [d.apiName, d] as const)]);
    for (const def of defs) {
      const seen = new Set<string>();
      for (const f of def.fields) {
        if (seen.has(f.apiName)) throw badRequest(`Duplicate field ${def.apiName}.${f.apiName}`);
        seen.add(f.apiName);
        this.validateField(def, f, known);
      }
      this.validateObjectSettings(def);
    }
  }

  private validateObjectSettings(def: ObjectDef): void {
    const byName = new Map(def.fields.map((f) => [f.apiName, f]));
    if (!def.nameTemplate && !byName.has(def.nameField)) throw badRequest(`Name field ${def.nameField} does not exist on ${def.apiName}`);
    if (def.statusField && !['picklist'].includes(byName.get(def.statusField)?.type ?? '')) throw badRequest('Status field must be a picklist');
    const isDate = (n?: string) => !!n && ['date', 'datetime'].includes(byName.get(n)?.type ?? (n === 'created_at' ? 'datetime' : ''));
    if (def.dateField && !isDate(def.dateField)) throw badRequest('Date field must be a date or datetime field');
    if (def.timeline && (!isDate(def.timeline.start) || !isDate(def.timeline.end))) throw badRequest('Timeline fields must be date fields');
    for (const f of [...(def.highlightFields ?? []), ...(def.listFields ?? [])]) {
      if (!byName.has(f) && !SYSTEM_FIELDS.includes(f as never)) throw badRequest(`Unknown field ${f} in layout of ${def.apiName}`);
    }
    for (const f of def.duplicateFields ?? []) {
      if (!['text', 'email', 'phone', 'url'].includes(byName.get(f)?.type ?? '')) throw badRequest(`Duplicate check field ${f} must be a text, email, phone or URL field`);
    }
    const names = new Set([...byName.keys(), 'id', 'name', 'owner_id', 'created_at', 'updated_at']);
    for (const rule of def.validationRules ?? []) {
      if (!rule.name?.trim() || !rule.message?.trim() || !rule.condition?.trim()) throw badRequest('Validation rules need a name, condition and message');
      let ids: string[];
      try {
        ids = expressionIdentifiers(rule.condition);
      } catch (e) {
        throw badRequest(`Invalid condition in validation rule "${rule.name}": ${(e as ExpressionError).message}`);
      }
      const unknown = ids.find((id) => !names.has(id));
      if (unknown) throw badRequest(`Validation rule "${rule.name}" references unknown field "${unknown}"`);
    }
  }

  validateField(def: ObjectDef, f: FieldDef, known: Map<string, ObjectDef> = this.cache): void {
    if (!API_NAME_RE.test(f.apiName)) throw badRequest(`Invalid API name "${f.apiName}": use lowercase letters, numbers and underscores`);
    if (RESERVED.has(f.apiName)) throw badRequest(`"${f.apiName}" is a reserved name`);
    if (f.apiName === 'name' && (def.nameTemplate || def.nameField !== 'name' || f.type !== 'text')) {
      throw badRequest('"name" is reserved for the text record-name field');
    }
    if (!f.label?.trim() || f.label.length > 80) throw badRequest('Field label is required (max 80 characters)');
    if (!FIELD_TYPES.includes(f.type)) throw badRequest(`Unknown field type ${f.type}`);
    if (f.type === 'picklist' || f.type === 'multipicklist') {
      if (!f.options?.length) throw badRequest(`Picklist ${f.label} needs at least one value`);
      const values = new Set<string>();
      for (const o of f.options) {
        if (!o.value?.trim() || o.value.length > 100) throw badRequest(`Invalid picklist value in ${f.label}`);
        if (values.has(o.value.toLowerCase())) throw badRequest(`Duplicate picklist value "${o.value}" in ${f.label}`);
        if (o.color && !PALETTE.includes(o.color)) throw badRequest(`Unknown color ${o.color}`);
        values.add(o.value.toLowerCase());
      }
    }
    if (f.type === 'lookup') {
      if (!f.referenceTo || (f.referenceTo !== '*' && f.referenceTo !== def.apiName && !known.has(f.referenceTo))) {
        throw badRequest(`Lookup ${f.label} must reference an existing object`);
      }
    }
    if (f.type === 'formula') {
      if (!f.formula?.trim()) throw badRequest(`Formula ${f.label} needs an expression`);
      if (!f.formulaType || !FORMULA_TYPES.includes(f.formulaType)) throw badRequest(`Formula ${f.label} needs a result type`);
      let ids: string[];
      try {
        ids = expressionIdentifiers(f.formula);
      } catch (e) {
        throw badRequest(`Invalid formula for ${f.label}: ${(e as ExpressionError).message}`);
      }
      const names = new Set([...def.fields.map((x) => x.apiName), 'name', 'owner_id', 'created_at', 'updated_at']);
      for (const id of ids) {
        if (id === f.apiName) throw badRequest(`Formula ${f.label} cannot reference itself`);
        if (!names.has(id)) throw badRequest(`Formula ${f.label} references unknown field "${id}"`);
      }
    }
    if (f.type === 'rollup') {
      const r = f.rollup;
      if (!r) throw badRequest(`Roll-up ${f.label} needs a definition`);
      const child = r.childObject === def.apiName ? def : known.get(r.childObject);
      if (!child) throw badRequest(`Roll-up ${f.label}: unknown child object ${r.childObject}`);
      const rel = child.fields.find((x) => x.apiName === r.relationshipField);
      if (!rel || rel.type !== 'lookup' || rel.referenceTo !== def.apiName) {
        throw badRequest(`Roll-up ${f.label}: ${r.relationshipField} must be a lookup from ${child.apiName} to ${def.apiName}`);
      }
      if (!['count', 'sum', 'min', 'max', 'avg'].includes(r.fn)) throw badRequest(`Roll-up ${f.label}: invalid function`);
      if (r.fn !== 'count') {
        const target = child.fields.find((x) => x.apiName === r.field);
        if (!target || !isNumericField(target)) throw badRequest(`Roll-up ${f.label}: ${r.field ?? '(none)'} must be a numeric field on ${child.apiName}`);
      }
    }
  }

  /** A record-id prefix no other object uses. */
  uniqueKeyPrefix(apiName: string): string {
    const used = new Set([...this.cache.values()].map((o) => o.keyPrefix));
    const base = apiName.replace(/[^a-z0-9]/g, '').padEnd(3, 'x');
    const candidates = [base.slice(0, 3), ...'0123456789abcdefghijklmnopqrstuvwxyz'.split('').map((c) => base.slice(0, 2) + c)];
    const found = candidates.find((c) => !used.has(c));
    if (!found) throw conflict('Could not allocate a key prefix');
    return found;
  }

  async createCustomObject(input: { label: string; pluralLabel?: string; apiName?: string; description?: string; icon?: string; color?: string }): Promise<ObjectDef> {
    const label = input.label?.trim();
    if (!label) throw badRequest('Label is required');
    const apiName = input.apiName?.trim() || toApiName(label);
    if (!API_NAME_RE.test(apiName)) throw badRequest(`Invalid API name "${apiName}"`);
    if (this.cache.has(apiName)) throw conflict(`An object named ${apiName} already exists`);
    const def: ObjectDef = {
      apiName,
      label,
      pluralLabel: input.pluralLabel?.trim() || `${label}s`,
      description: input.description ?? '',
      icon: input.icon || 'box',
      color: input.color || 'indigo',
      keyPrefix: this.uniqueKeyPrefix(apiName),
      nameField: 'name',
      isCustom: true,
      listFields: ['name', 'owner_id', 'updated_at'],
      highlightFields: ['owner_id'],
      fields: [{ apiName: 'name', label: `${label} Name`, type: 'text', required: true, sortOrder: 0 }],
    };
    this.validateAll([def]);
    return this.saveObject(def);
  }

  async updateObject(apiName: string, patch: Partial<Omit<ObjectDef, 'apiName' | 'fields' | 'isCustom' | 'keyPrefix'>>): Promise<ObjectDef> {
    const current = this.require(apiName);
    const next: ObjectDef = { ...current, ...patch, apiName, fields: current.fields, isCustom: current.isCustom, keyPrefix: current.keyPrefix };
    if (!next.label?.trim() || !next.pluralLabel?.trim()) throw badRequest('Labels are required');
    this.validateObjectSettings(next);
    return this.saveObject(next);
  }

  async deleteObject(apiName: string): Promise<void> {
    const def = this.require(apiName);
    if (!def.isCustom) throw badRequest('Standard objects cannot be deleted');
    const refs = this.referencingFields(apiName, false).filter((r) => r.object.apiName !== apiName);
    if (refs.length) throw conflict(`Remove these lookups first: ${refs.map((r) => `${r.object.label}.${r.field.label}`).join(', ')}`);
    await this.db.transaction(async (tx) => {
      await tx.run('DELETE FROM records WHERE object_api_name = ?', [apiName]);
      await tx.run('DELETE FROM fields WHERE object_api_name = ?', [apiName]);
      await tx.run('DELETE FROM objects WHERE api_name = ?', [apiName]);
      await tx.run('DELETE FROM automations WHERE object_api_name = ?', [apiName]);
      await tx.run('DELETE FROM list_views WHERE object_api_name = ?', [apiName]);
      await tx.run('DELETE FROM page_layouts WHERE object_api_name = ?', [apiName]);
      await deleteTranslations(tx, ['object', 'field', 'picklist', 'section'].map((c) => `${c}.${apiName}.`));
    });
    await this.load();
  }

  async addField(apiName: string, input: FieldDef): Promise<ObjectDef> {
    const def = this.require(apiName);
    const field: FieldDef = { ...input, apiName: input.apiName?.trim() || toApiName(input.label ?? ''), isCustom: true, sortOrder: def.fields.length };
    if (def.fields.some((f) => f.apiName === field.apiName)) throw conflict(`Field ${field.apiName} already exists on ${def.label}`);
    const next = { ...def, fields: [...def.fields, field] };
    this.validateField(next, field);
    return this.saveObject(next);
  }

  async updateField(apiName: string, fieldApi: string, patch: Partial<FieldDef>): Promise<ObjectDef> {
    const def = this.require(apiName);
    const current = def.fields.find((f) => f.apiName === fieldApi);
    if (!current) throw notFound(`Unknown field ${fieldApi}`);
    if (patch.type && patch.type !== current.type) throw badRequest('Changing a field type is not supported; create a new field instead');
    const field: FieldDef = { ...current, ...patch, apiName: current.apiName, type: current.type, isCustom: current.isCustom };
    const next = { ...def, fields: def.fields.map((f) => (f.apiName === fieldApi ? field : f)) };
    this.validateField(next, field);
    return this.saveObject(next);
  }

  async deleteField(apiName: string, fieldApi: string): Promise<ObjectDef> {
    const def = this.require(apiName);
    const field = def.fields.find((f) => f.apiName === fieldApi);
    if (!field) throw notFound(`Unknown field ${fieldApi}`);
    if (!field.isCustom) throw badRequest('Standard fields cannot be deleted');
    if (def.nameField === fieldApi && !def.nameTemplate) throw badRequest('The name field cannot be deleted');
    for (const o of this.cache.values()) {
      for (const f of o.fields) {
        if (f.type === 'formula' && o.apiName === apiName && f.formula && expressionIdentifiers(f.formula).includes(fieldApi)) {
          throw conflict(`Formula ${f.label} uses this field`);
        }
        if (f.type === 'rollup' && f.rollup?.childObject === apiName && (f.rollup.field === fieldApi || f.rollup.relationshipField === fieldApi)) {
          throw conflict(`Roll-up ${o.label}.${f.label} uses this field`);
        }
      }
    }
    for (const rule of def.validationRules ?? []) {
      if (expressionIdentifiers(rule.condition).includes(fieldApi)) throw conflict(`Validation rule "${rule.name}" uses this field`);
    }
    const strip = (list?: string[]) => list?.filter((x) => x !== fieldApi);
    const next: ObjectDef = {
      ...def,
      fields: def.fields.filter((f) => f.apiName !== fieldApi),
      listFields: strip(def.listFields),
      highlightFields: strip(def.highlightFields),
      duplicateFields: strip(def.duplicateFields),
      statusField: def.statusField === fieldApi ? undefined : def.statusField,
      dateField: def.dateField === fieldApi ? undefined : def.dateField,
      timeline: def.timeline && (def.timeline.start === fieldApi || def.timeline.end === fieldApi) ? null : def.timeline,
    };
    const saved = await this.saveObject(next);
    await deleteTranslations(this.db, [`field.${apiName}.${fieldApi}.`, `picklist.${apiName}.${fieldApi}.`]);
    return saved;
  }
}

