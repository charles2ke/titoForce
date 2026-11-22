import type { ObjectDef, PageLayoutDef } from '@titoforce/shared';
import type { FastifyInstance } from 'fastify';
import { assertSetup, canViewSensitive, objectPermission, type Principal } from '../platform/principal.ts';
import type { Services } from '../services.ts';
import { notFound } from '../util.ts';
import { auth, localeOf, params, parse, principalOf } from './http.ts';
import * as schemas from './schemas.ts';

/** A layout as a user sees it: without fields hidden from them by field-level security. */
function visibleLayout(p: Principal, def: ObjectDef, layout: PageLayoutDef): PageLayoutDef {
  if (canViewSensitive(p)) return layout;
  const hidden = new Set(def.fields.filter((f) => f.sensitive).map((f) => f.apiName));
  return {
    ...layout,
    highlights: layout.highlights.filter((f) => !hidden.has(f)),
    sections: layout.sections.map((sec) => ({ ...sec, fields: sec.fields.filter((f) => !hidden.has(f)) })),
  };
}

export function layoutRoutes(app: FastifyInstance, s: Services): void {
  /** The record page layout for the current user's role, with translated section titles. */
  app.get('/api/objects/:api/layout', async (req) => {
    const p = principalOf(req);
    const def = s.metadata.get(params(req).api!);
    if (!def || objectPermission(p, def.apiName).read === 'none') throw notFound('Object not found');
    const layout = await s.layouts.forRole(def.apiName, auth(req).user.roleId);
    return (await s.translations.translator(localeOf(req))).layout(visibleLayout(p, def, layout));
  });

  // ---------- Setup → Object Manager → Page Layouts (English originals) ----------

  app.get('/api/objects/:api/layouts', async (req) => {
    assertSetup(principalOf(req));
    const api = params(req).api!;
    return { layouts: await s.layouts.list(api), relatedLists: s.layouts.relatedListOptions(api) };
  });

  app.post('/api/objects/:api/layouts', async (req, reply) => {
    assertSetup(principalOf(req));
    const layout = await s.layouts.save(params(req).api!, null, parse(schemas.pageLayout, req.body));
    reply.code(201);
    return layout;
  });

  app.put('/api/objects/:api/layouts/:id', async (req) => {
    assertSetup(principalOf(req));
    const { api, id } = params(req);
    return s.layouts.save(api!, id!, parse(schemas.pageLayout, req.body));
  });

  app.delete('/api/objects/:api/layouts/:id', async (req) => {
    assertSetup(principalOf(req));
    const { api, id } = params(req);
    await s.layouts.delete(api!, id!);
    return { ok: true };
  });
}
