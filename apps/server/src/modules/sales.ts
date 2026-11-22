import type { CrmRecord, FilterGroup, RecordData, RefMap } from '@titoforce/shared';
import type { Db } from '../db/database.ts';
import type { MetadataService } from '../platform/metadata.ts';
import { fieldAccessOf, type Principal, systemPrincipal } from '../platform/principal.ts';
import type { RecordService } from '../platform/records.ts';
import { addDays, conflict, isoDate } from '../util.ts';

export interface ConvertLeadOptions {
  createOpportunity?: boolean;
  opportunityName?: string;
  /** Attach to an existing account instead of creating one. */
  accountId?: string;
}

export interface ConvertLeadResult {
  account: CrmRecord;
  contact: CrmRecord;
  opportunity: CrmRecord | null;
  reusedAccount: boolean;
}

export interface ForecastRow {
  key: string;
  label: string;
  pipeline: number;
  bestCase: number;
  commit: number;
  weighted: number;
  closedWon: number;
  count: number;
}

const CLOSED = /closed|won|lost/i;
/** Forecasts read at most 20 pages of 500 opportunities (10,000) per window. */
const FORECAST_MAX_PAGES = 20;

export class SalesService {
  private db: Db;
  private metadata: MetadataService;
  private records: RecordService;

  constructor(db: Db, metadata: MetadataService, records: RecordService) {
    this.db = db;
    this.metadata = metadata;
    this.records = records;
  }

  /** Copies target object fields and the system owner column. With a principal, fields they cannot edit are skipped. */
  private pick(object: string, values: RecordData, principal?: Principal): RecordData {
    const def = this.metadata.require(object);
    const out: RecordData = {};
    for (const [k, v] of Object.entries(values)) {
      if (v === undefined || v === null || v === '') continue;
      const f = def.fields.find((x) => x.apiName === k);
      if (k === 'owner_id' || (f && (!principal || fieldAccessOf(principal, object, f) === 'edit'))) out[k] = v;
    }
    return out;
  }

  /** Converts a lead into an account, contact and (optionally) opportunity, like Salesforce lead conversion. */
  async convertLead(principal: Principal, leadId: string, opts: ConvertLeadOptions = {}): Promise<ConvertLeadResult> {
    await this.records.get(principal, 'lead', leadId);
    const claim = await this.db.run('INSERT INTO lead_conversion_claims (lead_id) VALUES (?) ON CONFLICT (lead_id) DO NOTHING', [leadId]);
    if (!claim.changes) throw conflict('This lead is already being converted');
    const created: CrmRecord[] = [];
    try {
      const lead = await this.records.get(principal, 'lead', leadId);
      const f = lead.fields;
      if (String(f.status ?? '').toLowerCase() === 'converted') throw conflict('This lead has already been converted');
      let account: CrmRecord | undefined;
      let reusedAccount = false;
      if (opts.accountId) {
        account = await this.records.get(principal, 'account', opts.accountId);
        reusedAccount = true;
      } else if (f.company) {
        const existing = await this.records.query(principal, 'account', { filters: { match: 'all', rules: [{ field: 'name', op: 'eq', value: f.company }] }, pageSize: 1 });
        if (existing.records[0]) {
          account = existing.records[0];
          reusedAccount = true;
        }
      }
      if (!account) {
        account = await this.records.create(
          principal,
          'account',
          this.pick('account', {
            name: f.company || `${f.first_name ?? ''} ${f.last_name ?? ''}`.trim(),
            industry: f.industry,
            phone: f.phone,
            website: f.website,
            annual_revenue: f.annual_revenue,
            employees: f.employees,
            type: 'Prospect',
            owner_id: lead.ownerId,
          }, principal),
        );
        created.push(account);
      }
      const contact = await this.records.create(
        principal,
        'contact',
        this.pick('contact', {
          first_name: f.first_name,
          last_name: f.last_name,
          email: f.email,
          phone: f.phone,
          title: f.title,
          account: account.id,
          lead_source: f.lead_source,
          owner_id: lead.ownerId,
        }, principal),
        { allowDuplicates: true },
      );
      created.push(contact);
      let opportunity: CrmRecord | null = null;
      if (opts.createOpportunity !== false) {
        const stage = this.metadata.field('opportunity', 'stage')?.options?.[0]?.value;
        opportunity = await this.records.create(
          principal,
          'opportunity',
          this.pick('opportunity', {
            name: opts.opportunityName?.trim() || `${account.name} - New Business`,
            account: account.id,
            primary_contact: contact.id,
            stage,
            amount: f.estimated_value,
            close_date: isoDate(addDays(new Date(), 30)),
            lead_source: f.lead_source,
            owner_id: lead.ownerId,
          }, principal),
        );
        created.push(opportunity);
      }
      await this.records.update(
        principal,
        'lead',
        lead.id,
        this.pick('lead', { status: 'Converted', converted_account: account.id, converted_contact: contact.id, converted_opportunity: opportunity?.id }),
      );
      return { account, contact, opportunity, reusedAccount };
    } catch (err) {
      // Best-effort compensation: remove records created before the failure.
      for (const rec of created.reverse()) await this.records.delete(systemPrincipal(), rec.object, rec.id).catch(() => undefined);
      throw err;
    } finally {
      await this.db.run('DELETE FROM lead_conversion_claims WHERE lead_id = ?', [leadId]);
    }
  }

  /** Pipeline forecast grouped by close month or owner, from the opportunities the principal can read. */
  async forecast(principal: Principal, opts: { groupBy?: 'month' | 'owner'; months?: number } = {}): Promise<{ rows: ForecastRow[]; totals: ForecastRow; truncated: boolean; matchingCount: number }> {
    const def = this.metadata.require('opportunity');
    const months = Math.min(Math.max(opts.months ?? 6, 1), 24);
    const start = new Date();
    const from = `${start.toISOString().slice(0, 7)}-01`;
    const endDate = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months, 0));
    const filters: FilterGroup = {
      match: 'all',
      rules: [
        { field: 'close_date', op: 'gte', value: from },
        { field: 'close_date', op: 'lte', value: isoDate(endDate) },
      ],
    };
    const opportunities: CrmRecord[] = [];
    let refs: RefMap = {};
    let matchingCount = 0;
    for (let page = 1; page <= FORECAST_MAX_PAGES; page++) {
      const res = await this.records.query(principal, 'opportunity', { filters, page, pageSize: 500 });
      matchingCount = res.total;
      opportunities.push(...res.records);
      refs = { ...refs, ...res.refs };
      if (!res.records.length || page * 500 >= res.total) break;
    }
    const rows = new Map<string, ForecastRow>();
    const groupBy = opts.groupBy ?? 'month';
    if (groupBy === 'month') {
      for (let i = 0; i < months; i++) {
        const d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + i, 1));
        const key = d.toISOString().slice(0, 7);
        rows.set(key, { key, label: d.toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }), pipeline: 0, bestCase: 0, commit: 0, weighted: 0, closedWon: 0, count: 0 });
      }
    }
    const totals: ForecastRow = { key: 'total', label: 'Total', pipeline: 0, bestCase: 0, commit: 0, weighted: 0, closedWon: 0, count: 0 };
    const hasCategory = def.fields.some((x) => x.apiName === 'forecast_category');
    for (const r of opportunities) {
      const amount = Number(r.fields.amount ?? 0);
      const stage = String(r.fields.stage ?? '');
      const probability = Number(r.fields.probability ?? 0);
      const category = hasCategory ? String(r.fields.forecast_category ?? '') : '';
      const key = groupBy === 'month' ? String(r.fields.close_date ?? '').slice(0, 7) : (r.ownerId ?? 'none');
      if (!rows.has(key)) {
        const label = groupBy === 'owner' ? (r.ownerId ? (refs[r.ownerId]?.name ?? 'Unknown') : 'Unassigned') : key;
        rows.set(key, { key, label, pipeline: 0, bestCase: 0, commit: 0, weighted: 0, closedWon: 0, count: 0 });
      }
      for (const row of [rows.get(key)!, totals]) {
        row.count++;
        if (/won/i.test(stage)) row.closedWon += amount;
        else if (!CLOSED.test(stage)) {
          row.pipeline += amount;
          row.weighted += (amount * probability) / 100;
          if (category === 'Commit' || probability >= 75) row.commit += amount;
          if (category === 'Best Case' || category === 'Commit' || probability >= 50) row.bestCase += amount;
        }
      }
    }
    const round = (row: ForecastRow) => ({ ...row, weighted: Math.round(row.weighted * 100) / 100 });
    return { rows: [...rows.values()].map(round), totals: round(totals), truncated: opportunities.length < matchingCount, matchingCount };
  }
}
