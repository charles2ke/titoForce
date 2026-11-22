import type { CrmRecord, RecordQuery, RecordResponse } from '@titoforce/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prepareCsvImport } from '../platform/csv-import.ts';
import { relatedListOptions } from '../platform/layouts.ts';
import { assertCanCreate, type Principal } from '../platform/principal.ts';
import type { Services } from '../services.ts';
import { AppError, badRequest, isoDate } from '../util.ts';
import { auth, localeOf, params, parse, principalOf, query, sendDownload } from './http.ts';
import * as schemas from './schemas.ts';

const bulk = z.discriminatedUnion('action', [
  z.object({ action: z.literal('update'), ids: z.array(z.string().min(1).max(64)).min(1).max(200), fields: z.record(z.string(), z.unknown()) }),
  z.object({ action: z.literal('delete'), ids: z.array(z.string().min(1).max(64)).min(1).max(200) }),
]);

export function recordRoutes(app: FastifyInstance, s: Services): void {
  const withRefs = async (p: Principal, record: CrmRecord): Promise<RecordResponse> => ({ record, refs: await s.records.resolveRefs(p, [record]) });

  /** Applies a saved list view: its filters are ANDed with the request's own and its sort is the default. */
  const applyView = async (p: Principal, object: string, q: RecordQuery): Promise<RecordQuery> => {
    if (!q.viewId) return q;
    const view = await s.views.get(p, q.viewId);
    if (view.object !== object) throw badRequest('The list view belongs to another object');
    return { ...q, viewId: null, andFilters: [view.filters, ...(q.andFilters ?? [])], sort: q.sort ?? view.sort };
  };

  app.post('/api/records/:object/query', async (req) => {
    const p = principalOf(req);
    const object = params(req).object!;
    return s.records.query(p, object, await applyView(p, object, parse(schemas.recordQuery, req.body)));
  });

  // Optional `filters`/`sort` are JSON so an export matches the list as it is currently filtered.
  const jsonParam = <T>(schema: z.ZodType<T>, name: string, raw: string | undefined): T | null => {
    if (!raw) return null;
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw badRequest(`${name} must be JSON`);
    }
    return parse(schema, value);
  };

  app.get('/api/records/:object/export.csv', async (req, reply) => {
    const p = principalOf(req);
    const object = params(req).object!;
    const q = query(req);
    const exportQuery: RecordQuery = {
      viewId: q.viewId || null,
      q: q.q?.slice(0, 200),
      filters: jsonParam(schemas.filterGroup, 'filters', q.filters),
      sort: jsonParam(schemas.sortSpec, 'sort', q.sort),
    };
    const csv = await s.records.exportCsv(p, object, await applyView(p, object, exportQuery));
    return sendDownload(reply, `${object}-${isoDate(new Date())}.csv`, 'text/csv; charset=utf-8', csv);
  });

  app.post('/api/records/:object/import', { bodyLimit: 6 * 1024 * 1024 }, async (req) => {
    const p = principalOf(req);
    const object = params(req).object!;
    s.metadata.require(object);
    assertCanCreate(p, object);
    const { csv } = parse(schemas.importCsv, req.body);
    const prepared = await prepareCsvImport(s, p, object, csv);
    return { ...(await s.records.importRecords(p, object, prepared.rows)), columns: prepared.columns };
  });

  app.post('/api/records/:object/bulk', async (req) => {
    const p = principalOf(req);
    const object = params(req).object!;
    const body = parse(bulk, req.body);
    let done = 0;
    const errors: { id: string; message: string }[] = [];
    for (const id of new Set(body.ids)) {
      try {
        if (body.action === 'delete') await s.records.delete(p, object, id);
        else await s.records.update(p, object, id, body.fields);
        done++;
      } catch (err) {
        if (!(err instanceof AppError)) throw err;
        errors.push({ id, message: err.message });
      }
    }
    return { done, errors };
  });

  app.post('/api/records/:object', async (req, reply) => {
    const p = principalOf(req);
    const body = parse(schemas.recordWrite, req.body);
    const record = await s.records.create(p, params(req).object!, body.fields, { allowDuplicates: body.allowDuplicates });
    reply.code(201);
    return withRefs(p, record);
  });

  app.get('/api/records/:object/:id', async (req) => {
    const p = principalOf(req);
    const { object, id } = params(req);
    return withRefs(p, await s.records.get(p, object!, id!));
  });

  app.patch('/api/records/:object/:id', async (req) => {
    const p = principalOf(req);
    const { object, id } = params(req);
    const body = parse(schemas.recordWrite, req.body);
    return withRefs(p, await s.records.update(p, object!, id!, body.fields, { allowDuplicates: body.allowDuplicates, expectedUpdatedAt: body.expectedUpdatedAt }));
  });

  app.delete('/api/records/:object/:id', async (req) => {
    const { object, id } = params(req);
    return s.records.delete(principalOf(req), object!, id!);
  });

  /** Related lists of the user's page layout, in its order, labelled in the user's language. */
  app.get('/api/records/:object/:id/related', async (req) => {
    const { object, id } = params(req);
    const layout = await s.layouts.forRole(object!, auth(req).user.roleId);
    const tr = await s.translations.translator(localeOf(req));
    const options = new Map(relatedListOptions(s.metadata, object!, (d) => tr.object(d)).map((o) => [o.id, o]));
    const lists = layout.relatedLists.flatMap((listId) => options.get(listId) ?? []);
    return s.records.related(principalOf(req), object!, id!, lists);
  });

  app.get('/api/records/:object/:id/timeline', async (req) => {
    const { object, id } = params(req);
    return s.records.timeline(principalOf(req), object!, id!);
  });

  // Any record by id (links from notifications and agent answers).
  app.get('/api/lookup/:id', async (req) => {
    const p = principalOf(req);
    return withRefs(p, await s.records.get(p, null, params(req).id!));
  });

  app.post('/api/leads/:id/convert', async (req) => s.sales.convertLead(principalOf(req), params(req).id!, parse(schemas.convertLead, req.body)));
}
