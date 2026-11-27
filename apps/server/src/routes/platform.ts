import type { FieldAccess, FieldDef, ListViewDef, ObjectDef, RolePermissions } from '@titoforce/shared';
import type { FastifyInstance } from 'fastify';
import { fieldSecurityProblems, firstNewProblem } from '../platform/field-security.ts';
import { isComputedField, type MetadataService } from '../platform/metadata.ts';
import { assertSetup, objectPermission, visibleDef } from '../platform/principal.ts';
import type { ListViewInput } from '../platform/views.ts';
import type { Services } from '../services.ts';
import { badRequest, conflict, notFound } from '../util.ts';
import { auth, intParam, params, parse, parsePatch, principalOf, query } from './http.ts';
import * as schemas from './schemas.ts';

const nullsToUndefined = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v ?? undefined])) as T;

/**
 * Field permissions to store for a role: settings for unknown objects and fields are dropped, and settings that would
 * stop the role from creating records are rejected.
 */
function cleanFieldPermissions(metadata: MetadataService, perms: RolePermissions): Record<string, Record<string, FieldAccess>> {
  if (perms.setup) return {};
  const out: Record<string, Record<string, FieldAccess>> = {};
  for (const [object, fields] of Object.entries(perms.fields ?? {})) {
    const def = metadata.get(object);
    if (!def) continue;
    const kept: Record<string, FieldAccess> = {};
    for (const [field, access] of Object.entries(fields)) if (def.fields.some((f) => f.apiName === field)) kept[field] = access;
    if (Object.keys(kept).length) out[object] = kept;
  }
  for (const [object, fields] of Object.entries(out)) {
    const def = metadata.require(object);
    if (!((perms.objects[object] ?? perms.objects['*'])?.create ?? false)) continue;
    for (const [field, access] of Object.entries(fields)) {
      const f = def.fields.find((x) => x.apiName === field)!;
      if (access !== 'edit' && f.required && !isComputedField(f) && (f.defaultValue === undefined || f.defaultValue === null)) {
        throw badRequest(`${def.label} ${f.label} is required, so a role that can create ${def.pluralLabel.toLowerCase()} must be able to edit it`);
      }
    }
  }
  return out;
}

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
      .map((o) => visibleDef(p, o));
  });

  app.get('/api/objects/:api', async (req) => {
    const p = principalOf(req);
    const def = s.metadata.get(params(req).api!);
    if (!def || objectPermission(p, def.apiName).read === 'none') throw notFound('Object not found');
    return visibleDef(p, def);
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
    const api = params(req).api!;
    await s.metadata.deleteObject(api);
    await s.users.removeFieldPermissions(api);
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
    await s.sharing.assertFieldUnused(api!, field!);
    const def = await s.metadata.deleteField(api!, field!);
    await s.records.purgeField(api!, field!);
    await s.users.removeFieldPermissions(api!, field!);
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

  app.get('/api/users', async (req) => {
    const a = auth(req);
    const users = await s.users.listUsers(true);
    if (!a.permissions.setup) return users.map((u) => (u.id === a.user.id ? u : { ...u, phone: undefined }));
    const mfa = await s.mfa.enabledUserIds();
    return users.map((u) => ({ ...u, mfaEnabled: mfa.has(u.id) }));
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

  // Administrator reset, e.g. after a user lost their authenticator; they set it up again at their next sign-in if required.
  app.delete('/api/users/:id/mfa', async (req) => {
    assertSetup(principalOf(req));
    const id = params(req).id!;
    if (!(await s.users.getUser(id))) throw notFound('User not found');
    if (!(await s.mfa.disable(id))) throw badRequest('This user has not set up two-factor authentication');
    return { ok: true };
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
    body.permissions.fields = cleanFieldPermissions(s.metadata, body.permissions);
    const current = await s.users.getRole(id);
    const objects = s.metadata.list();
    const problem = firstNewProblem(current ? fieldSecurityProblems(objects, current.permissions, 'this role') : [], fieldSecurityProblems(objects, body.permissions, 'this role'));
    if (problem) throw badRequest(problem.message);
    return s.users.upsertRole({ id, ...body });
  });

  app.delete('/api/roles/:id', async (req) => {
    assertSetup(principalOf(req));
    await s.users.deleteRole(params(req).id!);
    return { ok: true };
  });

  // ---------- sharing rules ----------

  app.get('/api/sharing-rules', async (req) => {
    assertSetup(principalOf(req));
    return s.sharing.list(query(req).object || undefined);
  });

  app.post('/api/sharing-rules', async (req, reply) => {
    assertSetup(principalOf(req));
    const rule = await s.sharing.create(parse(schemas.sharingRule, req.body));
    reply.code(201);
    return rule;
  });

  app.put('/api/sharing-rules/:id', async (req) => {
    assertSetup(principalOf(req));
    return s.sharing.update(params(req).id!, parse(schemas.sharingRule, req.body));
  });

  app.delete(
    '/api/sharing-rules/:id',
    {
      config: {
        rateLimit: {
          max: 30,
          timeWindow: '1 minute',
        },
      },
    },
    async (req) => {
      assertSetup(principalOf(req));
      await s.sharing.delete(params(req).id!);
      return { ok: true };
    },
  );

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
