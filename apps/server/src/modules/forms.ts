import type { CrmRecord, FieldDef } from '@titoforce/shared';
import type { MetadataService } from '../platform/metadata.ts';
import { type Principal, systemPrincipal } from '../platform/principal.ts';
import type { RecordService } from '../platform/records.ts';
import { AppError, badRequest, notFound, RateLimiter } from '../util.ts';

const FORM_FIELD_TYPES = new Set(['text', 'longtext', 'email', 'phone', 'url', 'number', 'currency', 'date', 'checkbox', 'picklist', 'multipicklist']);
export const HONEYPOT_FIELD = 'website_hp';

export interface PublicForm {
  id: string;
  name: string;
  description: string | null;
  submitLabel: string;
  fields: { apiName: string; label: string; type: string; required: boolean; options?: string[] }[];
}

/** HubSpot / Salesforce-style web forms (web-to-lead, web-to-case) backed by `web_form` records. */
export class FormsService {
  private metadata: MetadataService;
  private records: RecordService;
  private limiter = new RateLimiter(10, 60_000);

  constructor(metadata: MetadataService, records: RecordService) {
    this.metadata = metadata;
    this.records = records;
  }

  private async load(id: string): Promise<{ form: CrmRecord; target: string; fields: FieldDef[] }> {
    const form = await this.records.getRaw(id);
    if (!form || form.object !== 'web_form' || form.fields.active !== true) throw notFound('Form not found');
    const target = String(form.fields.target_object ?? 'lead').toLowerCase();
    const def = this.metadata.get(target);
    if (!def) throw notFound('Form not found');
    const names = String(form.fields.form_fields ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const fields = names
      .map((n) => def.fields.find((f) => f.apiName === n))
      .filter((f): f is FieldDef => !!f && !f.sensitive && FORM_FIELD_TYPES.has(f.type));
    return { form, target, fields };
  }

  async describe(id: string): Promise<PublicForm> {
    const { form, fields } = await this.load(id);
    return {
      id: form.id,
      name: form.name,
      description: (form.fields.description as string | undefined) ?? null,
      submitLabel: (form.fields.submit_label as string | undefined) || 'Submit',
      fields: fields.map((f) => ({ apiName: f.apiName, label: f.label, type: f.type, required: !!f.required, options: f.options?.map((o) => o.value) })),
    };
  }

  private rateLimit(key: string): void {
    if (!this.limiter.hit(key)) throw new AppError(429, 'rate_limited', 'Too many submissions, please try again in a minute');
  }

  async submit(id: string, body: Record<string, unknown>, clientKey: string): Promise<{ message: string }> {
    const { form, target, fields } = await this.load(id);
    this.rateLimit(`${clientKey}:${id}`);
    const thanks = (form.fields.success_message as string | undefined) || 'Thanks! We will be in touch soon.';
    if (body[HONEYPOT_FIELD]) return { message: thanks }; // silently drop bots
    const values: Record<string, unknown> = {};
    for (const f of fields) {
      const v = body[f.apiName];
      if (v !== undefined && v !== null && v !== '') values[f.apiName] = v;
    }
    if (!Object.keys(values).length) throw badRequest('Please fill in the form');
    const def = this.metadata.require(target);
    if (def.fields.some((f) => f.apiName === 'lead_source') && !values.lead_source) values.lead_source = 'Web';
    if (def.fields.some((f) => f.apiName === 'origin') && !values.origin) values.origin = 'Web';
    if (typeof form.fields.campaign === 'string' && def.fields.some((f) => f.apiName === 'campaign' && f.referenceTo === 'campaign')) values.campaign = form.fields.campaign;
    if (form.ownerId) values.owner_id = form.ownerId;
    const actor: Principal = { ...systemPrincipal(`Web form: ${form.name}`, 'public'), depth: 0 };
    await this.records.create(actor, target, values, { allowDuplicates: true });
    await this.records.update(systemPrincipal(), 'web_form', form.id, { submissions: Number(form.fields.submissions ?? 0) + 1 }, { silent: true });
    return { message: thanks };
  }
}
