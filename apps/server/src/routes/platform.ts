import type { FieldDef, ListViewDef, ObjectDef } from '@titoforce/shared';
import type { FastifyInstance } from 'fastify';
import { assertSetup, canViewSensitive, objectPermission, type Principal } from '../platform/principal.ts';
import type { ListViewInput } from '../platform/views.ts';
import type { Services } from '../services.ts';
import { badRequest, conflict, notFound } from '../util.ts';
import { auth, intParam, params, parse, parsePatch, principalOf, query } from './http.ts';
import * as schemas from './schemas.ts';

/** Object metadata as a user sees it: sensitive field definitions are hidden from roles that cannot see their values. */
function visibleObject(p: Principal, def: ObjectDef): ObjectDef {
  return canViewSensitive(p) ? def : { ...def, fields: def.fields.filter((f) => !f.sensitive) };
}

const nullsToUndefined = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v ?? undefined])) as T;

const RECALC_OBJECT_KEYS = ['nameField', 'nameTemplate'];
const RECALC_FIELD_KEYS = ['formula', 'formulaType', 'rollup', 'precision'];
const ROLE_ID = /^[a-z][a-z0-9_]{1,39}$/;

export function platformRoutes(app: FastifyInstance, s: Services): void {
  // ---------- metadata (objects & fields) ----------

  app.get('/api/objects', async (req) => {
    const p = principalOf(req);
    return s.metadata
      .list()
      .filter((o) => objectPermission(p, o.apiName).read !== 'none')
      .map((o) => visibleObject(p, o));
  });

  app.get('/api/objects/:api', async (req) => {
    const p = principalOf(req);
    const def = s.metadata.get(params(req).api!);
    if (!def || objectPermission(p, def.apiName).read === 'none') throw notFound('Object not found');
    return visibleObject(p, def);
  });

  app.post('/api/objects', async (req, reply) => {
    assertSetup(principalOf(req));
    const def = await s.metadata.createCustomObject(parse(schemas.createObject, req.body));
    reply.code(201);
    return def;
  });

  app.patch('/api/objects/:api', async (req) => {
    assertSetup(principalOf(req));
    const api = params(req).api!;
    const patch = parsePatch(schemas.updateObject, req.body);
    const def = await s.metadata.updateObject(api, nullsToUndefined(patch) as Partial<ObjectDef>);
    if (RECALC_OBJECT_KEYS.some((k) => k in patch)) await s.records.recalculateObject(api);
    return def;
  });

  app.delete('/api/objects/:api', async (req) => {
    assertSetup(principalOf(req));
    await s.metadata.deleteObject(params(req).api!);
    return { ok: true };
  });

  app.post('/api/objects/:api/fields', async (req, reply) => {
    assertSetup(principalOf(req));
    const api = params(req).api!;
    const body = parse(schemas.createField, req.body);
    const def = await s.metadata.addField(api, { ...body, apiName: body.apiName ?? '' } as FieldDef);
    if (body.type === 'formula' || body.type === 'rollup') await s.records.recalculateObject(api);
    reply.code(201);
    return def;
  });

  app.patch('/api/objects/:api/fields/:field', async (req) => {
    assertSetup(principalOf(req));
    const { api, field } = params(req);
    const patch = parsePatch(schemas.updateField, req.body);
    const def = await s.metadata.updateField(api!, field!, patch as Partial<FieldDef>);
    if (RECALC_FIELD_KEYS.some((k) => k in patch)) await s.records.recalculateObject(api!);
    return def;
  });

  app.delete('/api/objects/:api/fields/:field', async (req) => {
    assertSetup(principalOf(req));
    const { api, field } = params(req);
    const def = await s.metadata.deleteField(api!, field!);
    await s.records.purgeField(api!, field!);
    return def;
  });

  // ---------- list views ----------

  app.get('/api/objects/:api/views', async (req) => s.views.list(principalOf(req), params(req).api!));

  app.post('/api/views', async (req, reply) => {
    const view = await s.views.create(principalOf(req), parse(schemas.listView, req.body) as ListViewInput);
    reply.code(201);
    return view;
  });

  app.patch('/api/views/:id', async (req) => {
    const patch = parsePatch(schemas.listView.omit({ object: true }), req.body);
    return s.views.update(principalOf(req), params(req).id!, patch as Partial<ListViewDef>);
  });

  app.delete('/api/views/:id', async (req) => {
    await s.views.delete(principalOf(req), params(req).id!);
    return { ok: true };
  });

  // ---------- apps (navigation) ----------

  app.get('/api/apps', async (req) => s.apps.list(principalOf(req)));

  app.post('/api/apps', async (req, reply) => {
    const p = principalOf(req);
    assertSetup(p);
    const body = parse(schemas.app, req.body);
    if (body.id && (await s.apps.list()).some((a) => a.id === body.id)) throw conflict(`An app with id ${body.id} already exists`);
    const saved = await s.apps.save(p, body);
    reply.code(201);
    return saved;
  });

  app.put('/api/apps/:id', async (req) => {
    const p = principalOf(req);
    assertSetup(p);
    const id = params(req).id!;
    await s.apps.get(id);
    return s.apps.save(p, { ...parse(schemas.app, req.body), id });
  });

  app.delete('/api/apps/:id', async (req) => {
    await s.apps.delete(principalOf(req), params(req).id!);
    return { ok: true };
  });

  // ---------- users & roles ----------

  // Everyone can see the user directory (owner pickers, @-assignments).
  app.get('/api/users', async (req) => {
    principalOf(req);
    return s.users.listUsers(true);
  });

  app.post('/api/users', async (req, reply) => {
    assertSetup(principalOf(req));
    const user = await s.users.createUser(parse(schemas.createUser, req.body));
    reply.code(201);
    return user;
  });

  app.patch('/api/users/:id', async (req) => {
    const a = auth(req);
    assertSetup(a.principal);
    const id = params(req).id!;
    const patch = parse(schemas.updateUser, req.body);
    if (id === a.user.id && (patch.active === false || (patch.roleId && patch.roleId !== a.user.roleId))) {
      throw badRequest('You cannot deactivate yourself or change your own role');
    }
    const target = await s.users.getUser(id);
    if (!target) throw notFound('User not found');
    if (target.isAgent && patch.password) throw badRequest('Agent users cannot sign in');
    return s.users.updateUser(id, patch);
  });

  app.get('/api/roles', async (req) => {
    assertSetup(principalOf(req));
    return s.users.listRoles();
  });

  app.put('/api/roles/:id', async (req) => {
    assertSetup(principalOf(req));
    const id = params(req).id!;
    if (!ROLE_ID.test(id)) throw badRequest('Role ids use lowercase letters, numbers and underscores');
    const body = parse(schemas.role, req.body);
    for (const object of Object.keys(body.permissions.objects)) {
      if (object !== '*' && !s.metadata.get(object)) throw badRequest(`Unknown object ${object}`);
    }
    // The administrator role always keeps setup access so the org cannot be locked out.
    if (id === 'admin') body.permissions.setup = true;
    return s.users.upsertRole({ id, ...body });
  });

  app.delete('/api/roles/:id', async (req) => {
    assertSetup(principalOf(req));
    await s.users.deleteRole(params(req).id!);
    return { ok: true };
  });

  // ---------- notifications & search ----------

  app.get('/api/notifications', async (req) => s.notifications.list(auth(req).user.id, intParam(query(req).limit, 30, 1, 100)));

  app.post('/api/notifications/read', async (req) => {
    await s.notifications.markRead(auth(req).user.id, parse(schemas.markRead, req.body).ids);
    return { ok: true };
  });

  app.get('/api/search', async (req) => {
    const q = query(req);
    const objects = q.objects?.split(',').filter(Boolean);
    return s.records.search(principalOf(req), (q.q ?? '').slice(0, 200), { objects, limit: intParam(q.limit, 5, 1, 20) });
  });
}
