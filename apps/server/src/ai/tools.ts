import { Buffer } from 'node:buffer';
import { type CrmRecord, type FilterRule, isBlank, type ObjectDef, type RefMap, stringify, type ToolInfo } from '@titoforce/shared';
import type { AnalyticsService } from '../analytics/reports.ts';
import type { ApprovalService } from '../automation/approvals.ts';
import type { SalesService } from '../modules/sales.ts';
import type { MetadataService } from '../platform/metadata.ts';
import type { NotificationService } from '../platform/notifications.ts';
import { canViewSensitive, objectPermission, type Principal } from '../platform/principal.ts';
import type { RecordService } from '../platform/records.ts';
import type { UserService } from '../platform/users.ts';
import { addDays, badRequest, isoDate } from '../util.ts';

export interface ToolDeps {
  records: RecordService;
  metadata: MetadataService;
  users: UserService;
  approvals: ApprovalService;
  notifications: NotificationService;
  sales: SalesService;
  analytics: AnalyticsService;
}

export interface ToolContext {
  principal: Principal;
  deps: ToolDeps;
}

export interface ToolDef extends ToolInfo {
  /** One-line, human readable description of a call (used for approval requests). */
  summarize: (args: Record<string, unknown>, deps: ToolDeps) => string;
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
}

const str = (v: unknown, name: string, required = true): string | undefined => {
  if (v === undefined || v === null || v === '') {
    if (required) throw badRequest(`Missing "${name}"`);
    return undefined;
  }
  if (typeof v !== 'string') throw badRequest(`"${name}" must be a string`);
  return v;
};

const obj = (v: unknown, name: string): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw badRequest(`"${name}" must be an object`);
  return v as Record<string, unknown>;
};

/** Presentation-only hardening; untrusted text is not an authorization boundary. */
function dataOnlyText(value: string): string {
  const text = value
    .replace(/[\t\r\n\u2028\u2029]+/g, ' ')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/[\\`*_{}[\]()<>#+.!|~=-]/g, '\\$&');
  return `[UNTRUSTED DATA ONLY] ${text}`;
}

/** Compact record representation for LLM context: non-empty fields with lookup names resolved. */
export function summarizeRecord(rec: CrmRecord, def: ObjectDef | undefined, refs: RefMap): Record<string, unknown> {
  const out: Record<string, unknown> = { id: rec.id, object: rec.object, name: rec.name };
  if (rec.ownerId) out.owner = refs[rec.ownerId]?.name ?? rec.ownerId;
  for (const f of def?.fields ?? []) {
    const v = rec.fields[f.apiName];
    if (isBlank(v)) continue;
    if ((f.type === 'lookup' || f.type === 'user') && typeof v === 'string') out[f.apiName] = { id: v, name: refs[v]?.name ?? null };
    else out[f.apiName] = f.type === 'longtext' && typeof v === 'string' && v.length > 600 ? `${v.slice(0, 600)}…` : v;
  }
  out.updated_at = rec.updatedAt;
  return out;
}

const FILTER_SCHEMA = {
  type: 'array',
  description: 'Filter rules. Dates accept YYYY-MM-DD or literals such as TODAY, THIS_MONTH, LAST_N_DAYS:30. Use CURRENT_USER for the current user.',
  items: {
    type: 'object',
    properties: {
      field: { type: 'string' },
      op: { type: 'string', enum: ['eq', 'neq', 'contains', 'not_contains', 'starts_with', 'gt', 'gte', 'lt', 'lte', 'in', 'not_in', 'is_empty', 'is_not_empty'] },
      value: {
        description: 'Comparison value; use an array for in / not_in. Use {reference} from describe_object for picklist choices.',
        anyOf: [
          { type: 'string' },
          { type: 'number' },
          { type: 'boolean' },
          { type: 'array', items: { anyOf: [{ type: 'string' }, { type: 'object', properties: { reference: { type: 'string' } }, required: ['reference'], additionalProperties: false }] } },
          { type: 'object', properties: { reference: { type: 'string' } }, required: ['reference'], additionalProperties: false },
        ],
      },
    },
    required: ['field', 'op'],
  },
};

function toRules(v: unknown): FilterRule[] {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) throw badRequest('"filters" must be an array');
  return v.map((r) => {
    const rule = obj(r, 'filter');
    return { field: String(rule.field), op: String(rule.op) as FilterRule['op'], value: rule.value };
  });
}

function optionReference(value: string): string {
  return `option:${Buffer.from(value, 'utf8').toString('base64url')}`;
}

function resolveOptionReference(value: unknown, options: { value: string }[] | undefined): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const reference = (value as Record<string, unknown>).reference;
  if (typeof reference !== 'string' || Object.keys(value).length !== 1) return value;
  return options?.find((option) => optionReference(option.value) === reference)?.value ?? value;
}

function resolveFieldOptionReferences(def: ObjectDef | undefined, values: Record<string, unknown>): Record<string, unknown> {
  if (!def) return values;
  return Object.fromEntries(
    Object.entries(values).map(([name, value]) => {
      const options = def.fields.find((field) => field.apiName === name)?.options;
      const resolve = (v: unknown) => resolveOptionReference(v, options);
      return [name, Array.isArray(value) ? value.map(resolve) : resolve(value)];
    }),
  );
}

function resolveFilterOptionReferences(def: ObjectDef | undefined, rules: FilterRule[]): FilterRule[] {
  if (!def) return rules;
  return rules.map((rule) => {
    const options = def.fields.find((field) => field.apiName === rule.field)?.options;
    const resolve = (value: unknown) => resolveOptionReference(value, options);
    return { ...rule, value: Array.isArray(rule.value) ? rule.value.map(resolve) : resolve(rule.value) };
  });
}

// ---------- deterministic scoring helpers (also used by the offline brain) ----------

const FREE_EMAIL = /@(gmail|yahoo|hotmail|outlook|aol|icloud|proton|protonmail|live|msn|gmx|mail)\./i;

export function scoreLead(fields: Record<string, unknown>): { score: number; rating: 'Hot' | 'Warm' | 'Cold'; factors: { factor: string; points: number }[] } {
  const factors: { factor: string; points: number }[] = [];
  const add = (factor: string, points: number) => factors.push({ factor, points });
  const email = String(fields.email ?? '');
  if (email) add(FREE_EMAIL.test(email) ? 'Personal email domain' : 'Business email domain', FREE_EMAIL.test(email) ? 0 : 10);
  else add('No email address', -5);
  if (fields.phone) add('Phone number provided', 5);
  const title = String(fields.title ?? '').toLowerCase();
  if (/\b(chief|ceo|cto|cfo|coo|cio|cmo|vp|vice president|head of|director|founder|owner|president|partner)\b/.test(title)) add('Senior decision maker', 20);
  else if (/\b(manager|lead|principal)\b/.test(title)) add('Manager-level contact', 10);
  else if (/\b(intern|student|assistant)\b/.test(title)) add('Junior role', -10);
  const revenue = Number(fields.annual_revenue ?? 0);
  if (revenue >= 50_000_000) add('Annual revenue ≥ $50M', 15);
  else if (revenue >= 5_000_000) add('Annual revenue ≥ $5M', 10);
  else if (revenue >= 1_000_000) add('Annual revenue ≥ $1M', 5);
  const employees = Number(fields.employees ?? 0);
  if (employees >= 1000) add('1,000+ employees', 15);
  else if (employees >= 200) add('200+ employees', 10);
  else if (employees >= 50) add('50+ employees', 5);
  const source = String(fields.lead_source ?? '');
  const sourcePoints: Record<string, number> = { Referral: 15, Partner: 10, Web: 5, Webinar: 8, Event: 5, 'Trade Show': 5 };
  if (sourcePoints[source]) add(`Lead source: ${source}`, sourcePoints[source]);
  if (['Technology', 'Financial Services', 'Healthcare', 'Manufacturing'].includes(String(fields.industry ?? ''))) add(`Target industry: ${fields.industry}`, 5);
  const text = `${fields.description ?? ''}`.toLowerCase();
  const intents = ['pricing', 'quote', 'demo', 'trial', 'budget', 'purchase', 'buy', 'rfp', 'proposal', 'asap', 'urgent', 'timeline'].filter((k) => text.includes(k));
  if (intents.length) add(`Buying signals: ${intents.slice(0, 3).join(', ')}`, Math.min(20, intents.length * 10));
  const score = Math.max(0, Math.min(100, 20 + factors.reduce((s, f) => s + f.points, 0)));
  return { score, rating: score >= 70 ? 'Hot' : score >= 40 ? 'Warm' : 'Cold', factors };
}

export function triageCase(fields: Record<string, unknown>): { priority: string; category: string; reasons: string[] } {
  const text = `${fields.subject ?? ''} ${fields.description ?? ''}`.toLowerCase();
  const reasons: string[] = [];
  let priority = 'Medium';
  if (/\b(outage|down|breach|security|data loss|production|critical|cannot access|can't access|all users)\b/.test(text)) {
    priority = 'Urgent';
    reasons.push('Mentions an outage, security or production-wide impact');
  } else if (/\b(urgent|asap|blocked|blocking|error|crash|fail(ed|ing|s)?|broken)\b/.test(text)) {
    priority = 'High';
    reasons.push('Customer is blocked or reports errors');
  } else if (/\b(question|how do|how to|wondering|feature|request|suggestion)\b/.test(text)) {
    priority = 'Low';
    reasons.push('General question or request');
  }
  let category = 'General';
  if (/\b(invoice|billing|charge|refund|payment|credit card|subscription)\b/.test(text)) category = 'Billing';
  else if (/\b(login|log in|password|sso|mfa|2fa|access|locked|permission)\b/.test(text)) category = 'Access';
  else if (/\b(feature|request|suggestion|would be nice|roadmap)\b/.test(text)) category = 'Feature Request';
  else if (/\b(error|bug|crash|outage|down|fail|broken|slow|api|integration|sync)\b/.test(text)) category = 'Technical';
  reasons.push(`Classified as ${category} from keywords`);
  return { priority, category, reasons };
}

// ---------- registry ----------

function recordResult(ctx: ToolContext, rec: CrmRecord, refs: RefMap) {
  return summarizeRecord(rec, ctx.deps.metadata.get(rec.object), refs);
}

export const TOOLS: ToolDef[] = [
  {
    name: 'list_objects',
    kind: 'read',
    description: 'List the CRM objects (tables) you can access, e.g. lead, account, opportunity, case, employee.',
    parameters: { type: 'object', properties: {} },
    summarize: () => 'List objects',
    run: async (_args, { principal, deps }) =>
      deps.metadata
        .list()
        .filter((o) => objectPermission(principal, o.apiName).read !== 'none')
        .map((o) => ({ object: o.apiName, label: dataOnlyText(o.label), plural: dataOnlyText(o.pluralLabel), description: dataOnlyText(o.description ?? '') })),
  },
  {
    name: 'describe_object',
    kind: 'read',
    description: 'Describe the fields of an object, including picklist values and lookup targets. Use a returned {reference} object as a picklist value in filters and writes.',
    parameters: { type: 'object', properties: { object: { type: 'string' } }, required: ['object'] },
    summarize: (a) => `Describe ${a.object}`,
    run: async (args, { principal, deps }) => {
      const def = deps.metadata.require(str(args.object, 'object')!);
      if (objectPermission(principal, def.apiName).read === 'none') throw badRequest(`No access to ${def.apiName}`);
      return {
        object: def.apiName,
        label: dataOnlyText(def.label),
        statusField: def.statusField ?? null,
        fields: def.fields
          .filter((f) => !f.sensitive || canViewSensitive(principal))
          .map((f) => ({
            name: f.apiName,
            label: dataOnlyText(f.label),
            type: f.type,
            required: !!f.required,
            readOnly: f.type === 'formula' || f.type === 'rollup',
            values: f.options?.map((o) => ({ reference: optionReference(o.value), label: dataOnlyText(o.value) })),
            references: f.referenceTo ?? undefined,
          })),
      };
    },
  },
  {
    name: 'search_records',
    kind: 'read',
    description: 'Full-text search across all objects (or one object) by name, email, phone and text fields.',
    parameters: { type: 'object', properties: { query: { type: 'string' }, object: { type: 'string' } }, required: ['query'] },
    summarize: (a) => `Search "${a.query}"`,
    run: async (args, { principal, deps }) => {
      const object = str(args.object, 'object', false);
      return deps.records.search(principal, str(args.query, 'query')!, { objects: object ? [object] : undefined, limit: 8 });
    },
  },
  {
    name: 'query_records',
    kind: 'read',
    description: 'Query records of one object with filters and sorting. Returns up to `limit` records (max 50) and the total count.',
    parameters: {
      type: 'object',
      properties: {
        object: { type: 'string' },
        filters: FILTER_SCHEMA,
        match: { type: 'string', enum: ['all', 'any'] },
        sort_field: { type: 'string' },
        sort_dir: { type: 'string', enum: ['asc', 'desc'] },
        limit: { type: 'number' },
      },
      required: ['object'],
    },
    summarize: (a) => `Query ${a.object}`,
    run: async (args, ctx) => {
      const object = str(args.object, 'object')!;
      const res = await ctx.deps.records.query(ctx.principal, object, {
        filters: {
          match: args.match === 'any' ? 'any' : 'all',
          rules: resolveFilterOptionReferences(ctx.deps.metadata.get(object), toRules(args.filters)),
        },
        sort: args.sort_field ? { field: String(args.sort_field), dir: args.sort_dir === 'asc' ? 'asc' : 'desc' } : null,
        pageSize: Math.min(Math.max(Number(args.limit ?? 10) || 10, 1), 50),
      });
      return { total: res.total, records: res.records.map((r) => recordResult(ctx, r, res.refs)) };
    },
  },
  {
    name: 'get_record',
    kind: 'read',
    description: 'Get one record by id with all of its fields.',
    parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    summarize: (a) => `Get ${a.id}`,
    run: async (args, ctx) => {
      const rec = await ctx.deps.records.get(ctx.principal, null, str(args.id, 'id')!);
      return recordResult(ctx, rec, await ctx.deps.records.resolveRefs(ctx.principal, [rec]));
    },
  },
  {
    name: 'get_related_records',
    kind: 'read',
    description: 'List child records related to a record (e.g. contacts and opportunities of an account).',
    parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    summarize: (a) => `Related records of ${a.id}`,
    run: async (args, ctx) => {
      const rec = await ctx.deps.records.get(ctx.principal, null, str(args.id, 'id')!);
      const { lists, refs } = await ctx.deps.records.related(ctx.principal, rec.object, rec.id);
      return lists.map((l) => ({ list: l.label, object: l.object, total: l.total, records: l.records.slice(0, 5).map((r) => recordResult(ctx, r, refs)) }));
    },
  },
  {
    name: 'get_timeline',
    kind: 'read',
    description: 'Get the activity timeline of a record: calls, emails, meetings, tasks, field changes and agent runs.',
    parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    summarize: (a) => `Timeline of ${a.id}`,
    run: async (args, ctx) => {
      const rec = await ctx.deps.records.get(ctx.principal, null, str(args.id, 'id')!);
      const { items } = await ctx.deps.records.timeline(ctx.principal, rec.object, rec.id);
      return items.slice(0, 25).map((i) => ({
        kind: i.kind,
        at: i.at,
        title: i.title,
        type: i.activityType,
        status: i.status,
        due: i.dueDate ?? undefined,
        by: i.actorName ?? undefined,
        body: i.body ? stringify(i.body).slice(0, 300) : undefined,
        changes: i.changes?.map((c) => `${c.label}: ${stringify(c.from) || '∅'} → ${stringify(c.to) || '∅'}`),
      }));
    },
  },
  {
    name: 'aggregate_records',
    kind: 'read',
    description: 'Count or sum/avg/min/max a numeric field over records of an object, optionally grouped by a field (e.g. pipeline by stage).',
    parameters: {
      type: 'object',
      properties: {
        object: { type: 'string' },
        metric: { type: 'string', enum: ['count', 'sum', 'avg', 'min', 'max'] },
        field: { type: 'string', description: 'Numeric field for sum/avg/min/max' },
        group_by: { type: 'string' },
        interval: { type: 'string', enum: ['day', 'month', 'quarter', 'year'] },
        filters: FILTER_SCHEMA,
      },
      required: ['object', 'metric'],
    },
    summarize: (a) => `Aggregate ${a.object}`,
    run: async (args, { principal, deps }) => {
      const object = str(args.object, 'object')!;
      const fn = String(args.metric ?? 'count') as 'count';
      return deps.analytics.aggregate(principal, object, {
        filters: { match: 'all', rules: resolveFilterOptionReferences(deps.metadata.get(object), toRules(args.filters)) },
        metric: { fn, field: str(args.field, 'field', false) },
        groupBy: args.group_by ? { field: String(args.group_by), interval: args.interval as 'month' | undefined } : null,
        sort: 'natural',
      });
    },
  },
  {
    name: 'search_knowledge',
    kind: 'read',
    description: 'Search published knowledge base articles for answers to customer questions.',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    summarize: (a) => `Search knowledge for "${a.query}"`,
    run: async (args, ctx) => {
      if (!ctx.deps.metadata.get('knowledge_article')) return [];
      const words = str(args.query, 'query')!
        .toLowerCase()
        .split(/\W+/)
        .filter((w) => w.length > 3 && !STOP_WORDS.has(w))
        .slice(0, 6);
      const seen = new Map<string, { rec: CrmRecord; hits: number }>();
      let refs: RefMap = {};
      for (const w of words.length ? words : [String(args.query)]) {
        const res = await ctx.deps.records.query(ctx.principal, 'knowledge_article', {
          q: w,
          filters: { match: 'all', rules: [{ field: 'status', op: 'eq', value: 'Published' }] },
          pageSize: 10,
        });
        refs = { ...refs, ...res.refs };
        for (const r of res.records) seen.set(r.id, { rec: r, hits: (seen.get(r.id)?.hits ?? 0) + 1 });
      }
      return [...seen.values()]
        .sort((a, b) => b.hits - a.hits)
        .slice(0, 3)
        .map(({ rec }) => ({ id: rec.id, title: rec.name, category: rec.fields.category, summary: stringify(rec.fields.body ?? '').slice(0, 400) }));
    },
  },
  {
    name: 'score_lead',
    kind: 'read',
    description: 'Compute a transparent 0-100 lead score and Hot/Warm/Cold rating from firmographics, title, source and buying signals.',
    parameters: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    summarize: (a) => `Score lead ${a.id}`,
    run: async (args, ctx) => {
      const lead = await ctx.deps.records.get(ctx.principal, 'lead', str(args.id, 'id')!);
      return { id: lead.id, name: lead.name, ...scoreLead(lead.fields) };
    },
  },
  {
    name: 'list_users',
    kind: 'read',
    description: 'List active users (people who can own records or receive notifications).',
    parameters: { type: 'object', properties: {} },
    summarize: () => 'List users',
    run: async (_a, { deps }) => (await deps.users.listUsers(false)).filter((u) => u.active).map((u) => ({ id: u.id, name: u.name, title: u.title, role: u.roleName })),
  },
  {
    name: 'create_record',
    kind: 'write',
    description: 'Create a record. `fields` maps field names to values; lookups take record ids; owner_id assigns an owner.',
    parameters: { type: 'object', properties: { object: { type: 'string' }, fields: { type: 'object' } }, required: ['object', 'fields'] },
    summarize: (a, deps) => {
      const def = deps.metadata.get(String(a.object));
      const f = (a.fields ?? {}) as Record<string, unknown>;
      const name = def?.nameTemplate ? def.nameTemplate.replace(/\{([a-z0-9_]+)\}/g, (_m, k: string) => stringify(f[k])) : stringify(f[def?.nameField ?? 'name']);
      return `Create ${def?.label ?? a.object} "${name.trim() || 'untitled'}"`;
    },
    run: async (args, ctx) => {
      const object = str(args.object, 'object')!;
      const fields = resolveFieldOptionReferences(ctx.deps.metadata.get(object), obj(args.fields, 'fields'));
      const rec = await ctx.deps.records.create(ctx.principal, object, fields);
      return { created: true, ...recordResult(ctx, rec, await ctx.deps.records.resolveRefs(ctx.principal, [rec])) };
    },
  },
  {
    name: 'update_record',
    kind: 'write',
    description: 'Update fields on an existing record by id.',
    parameters: { type: 'object', properties: { id: { type: 'string' }, fields: { type: 'object' } }, required: ['id', 'fields'] },
    summarize: (a) => `Update ${a.id}: ${Object.entries((a.fields ?? {}) as Record<string, unknown>).map(([k, v]) => `${k} → ${stringify(v)}`).join(', ')}`,
    run: async (args, ctx) => {
      const current = await ctx.deps.records.get(ctx.principal, null, str(args.id, 'id')!);
      const fields = resolveFieldOptionReferences(ctx.deps.metadata.get(current.object), obj(args.fields, 'fields'));
      const rec = await ctx.deps.records.update(ctx.principal, current.object, current.id, fields);
      return { updated: true, ...recordResult(ctx, rec, await ctx.deps.records.resolveRefs(ctx.principal, [rec])) };
    },
  },
  {
    name: 'log_activity',
    kind: 'write',
    description: 'Log a call, email, meeting, note or task on a record. Tasks may have a due_date (YYYY-MM-DD).',
    parameters: {
      type: 'object',
      properties: {
        related_to: { type: 'string', description: 'Record id' },
        type: { type: 'string', enum: ['Call', 'Email', 'Meeting', 'Task', 'Note'] },
        subject: { type: 'string' },
        description: { type: 'string' },
        due_date: { type: 'string' },
        status: { type: 'string', enum: ['Open', 'Completed'] },
      },
      required: ['related_to', 'type', 'subject'],
    },
    summarize: (a) => `Log ${String(a.type ?? 'activity').toLowerCase()} "${a.subject}"`,
    run: async (args, ctx) => {
      const related = await ctx.deps.records.get(ctx.principal, null, str(args.related_to, 'related_to')!);
      const type = str(args.type, 'type') ?? 'Task';
      const rec = await ctx.deps.records.create(ctx.principal, 'activity', {
        related_to: related.id,
        type,
        subject: str(args.subject, 'subject'),
        description: str(args.description, 'description', false),
        due_date: str(args.due_date, 'due_date', false) ?? (type === 'Task' ? isoDate(addDays(new Date(), 1)) : undefined),
        status: str(args.status, 'status', false) ?? (type === 'Task' ? 'Open' : 'Completed'),
        owner_id: ctx.principal.userId ?? related.ownerId,
      });
      return { logged: true, id: rec.id, subject: rec.name, related_to: related.name };
    },
  },
  {
    name: 'convert_lead',
    kind: 'write',
    description: 'Convert a qualified lead into an account, contact and optionally an opportunity.',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string' }, create_opportunity: { type: 'boolean' }, opportunity_name: { type: 'string' } },
      required: ['id'],
    },
    summarize: (a) => `Convert lead ${a.id}${a.create_opportunity === false ? '' : ' (with opportunity)'}`,
    run: async (args, ctx) => {
      const r = await ctx.deps.sales.convertLead(ctx.principal, str(args.id, 'id')!, {
        createOpportunity: args.create_opportunity !== false,
        opportunityName: str(args.opportunity_name, 'opportunity_name', false),
      });
      return {
        converted: true,
        account: { id: r.account.id, name: r.account.name, reused: r.reusedAccount },
        contact: { id: r.contact.id, name: r.contact.name },
        opportunity: r.opportunity ? { id: r.opportunity.id, name: r.opportunity.name } : null,
      };
    },
  },
  {
    name: 'submit_for_approval',
    kind: 'write',
    description: 'Submit a record to its approval process (e.g. a discount or time-off request).',
    parameters: { type: 'object', properties: { id: { type: 'string' }, comment: { type: 'string' } }, required: ['id'] },
    summarize: (a) => `Submit ${a.id} for approval`,
    run: async (args, ctx) => {
      const req = await ctx.deps.approvals.submit(ctx.principal, str(args.id, 'id')!, { comment: str(args.comment, 'comment', false) });
      return { submitted: true, request: req.id, approver: req.approverName, process: req.processName };
    },
  },
  {
    name: 'send_notification',
    kind: 'write',
    description: 'Send an in-app notification to a user, optionally linking a record.',
    parameters: {
      type: 'object',
      properties: { user_id: { type: 'string' }, title: { type: 'string' }, body: { type: 'string' }, record_id: { type: 'string' } },
      required: ['user_id', 'title'],
    },
    summarize: (a) => `Notify ${a.user_id}: "${a.title}"`,
    run: async (args, ctx) => {
      const user = await ctx.deps.users.getUser(str(args.user_id, 'user_id')!);
      if (!user || !user.active) throw badRequest('Unknown user');
      const recordId = str(args.record_id, 'record_id', false);
      if (recordId) await ctx.deps.records.get(ctx.principal, null, recordId);
      await ctx.deps.notifications.notify([user.id], `${str(args.title, 'title')}`, `${str(args.body, 'body', false) ?? ''}\n— ${ctx.principal.name}`.trim(), recordId ? `/r/${recordId}` : null);
      return { notified: user.name };
    },
  },
];

export const TOOL_MAP = new Map(TOOLS.map((t) => [t.name, t]));

export function toolInfo(t: ToolDef): ToolInfo {
  return { name: t.name, description: t.description, kind: t.kind, parameters: t.parameters };
}

const STOP_WORDS = new Set(['what', 'when', 'where', 'which', 'with', 'that', 'this', 'from', 'have', 'does', 'about', 'there', 'their', 'your', 'how', 'can', 'the', 'and', 'for']);
