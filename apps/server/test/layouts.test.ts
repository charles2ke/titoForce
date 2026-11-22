import type { PageLayoutDef, RelatedListOption } from '@titoforce/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.ts';
import type { Services } from '../src/services.ts';
import { createTestServices } from './helpers.ts';

let s: Services;
let app: FastifyInstance;
const cookies: Record<string, string> = {};

const send = (who: string, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
  app.inject({
    method,
    url,
    headers: { cookie: cookies[who]!, ...(method === 'GET' ? {} : { 'content-type': 'application/json' }) },
    payload: method === 'GET' ? undefined : JSON.stringify(payload ?? {}),
  });

const layoutOf = async (who: string, object: string): Promise<PageLayoutDef> => (await send(who, 'GET', `/api/objects/${object}/layout`)).json();
const setupLayouts = async (object: string): Promise<{ layouts: PageLayoutDef[]; relatedLists: RelatedListOption[] }> =>
  (await send('admin', 'GET', `/api/objects/${object}/layouts`)).json();
const input = (l: PageLayoutDef) => ({ name: l.name, isDefault: l.isDefault, highlights: l.highlights, sections: l.sections, relatedLists: l.relatedLists, roleIds: l.roleIds });

async function accountId(name: string): Promise<string> {
  const res = await send('admin', 'POST', '/api/records/account/query', { filters: { match: 'all', rules: [{ field: 'name', op: 'eq', value: name }] } });
  return res.json().records[0].id;
}

beforeAll(async () => {
  s = await createTestServices();
  app = await buildApp(s);
  for (const key of ['admin', 'maria', 'james', 'noah', 'hannah']) {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: `${key}@titoforce.example`, password: 'titoforce' } });
    cookies[key] = `tf_session=${res.cookies.find((c) => c.name === 'tf_session')!.value}`;
  }
});
afterAll(async () => {
  await app?.close();
  await s?.close();
});

describe('page layouts', () => {
  it('derives a default layout from field sections until one is saved', async () => {
    const layout = await layoutOf('maria', 'account');
    expect(layout).toMatchObject({ id: 'default', isDefault: true, roleIds: [] });
    expect(layout.sections.map((sec) => [sec.id, sec.title])).toEqual([
      ['information', ''],
      ['address', 'Address'],
      ['insights', 'Insights'],
    ]);
    const def = s.metadata.require('account');
    expect(layout.sections.flatMap((sec) => sec.fields).sort()).toEqual(def.fields.map((f) => f.apiName).sort());
    expect(layout.highlights).toEqual(def.highlightFields);
    expect(layout.relatedLists).toContain('contact.account');
    expect(layout.relatedLists).not.toContain('activity.related_to');
    expect((await setupLayouts('account')).layouts).toHaveLength(1);
  });

  it('stores the edited default layout and uses it for record pages and related lists', async () => {
    const { layouts, relatedLists } = await setupLayouts('account');
    expect(relatedLists.find((r) => r.id === 'opportunity.account')).toMatchObject({ object: 'opportunity', field: 'account', label: 'Opportunities' });
    const current = layouts[0]!;
    const [main, ...rest] = current.sections;
    const edited = {
      ...input(current),
      name: 'Account Layout',
      highlights: ['industry', 'phone'],
      sections: [{ id: 'key_facts', title: 'Key Facts', columns: 1, fields: ['name', 'industry', 'type'] }, { ...main!, fields: main!.fields.filter((f) => !['name', 'industry', 'type'].includes(f)) }, ...rest],
      relatedLists: ['opportunity.account', 'contact.account'],
    };
    const notify = vi.spyOn(s.realtime, 'metadataChanged');
    const res = await send('admin', 'PUT', '/api/objects/account/layouts/default', edited);
    expect(res.statusCode).toBe(200);
    const saved: PageLayoutDef = res.json();
    expect(saved.id).toMatch(/^lay/);
    expect(saved).toMatchObject({ isDefault: true, highlights: ['industry', 'phone'], relatedLists: ['opportunity.account', 'contact.account'] });
    expect(notify).toHaveBeenCalled();
    notify.mockRestore();

    expect((await layoutOf('james', 'account')).sections[0]).toEqual({ id: 'key_facts', title: 'Key Facts', columns: 1, fields: ['name', 'industry', 'type'] });
    const related = (await send('james', 'GET', `/api/records/account/${await accountId('Acme Robotics')}/related`)).json();
    expect(related.lists.map((l: { object: string }) => l.object)).toEqual(['opportunity', 'contact']);
  });

  it('gives roles their own layout while everyone else keeps the default', async () => {
    const base = (await setupLayouts('opportunity')).layouts[0]!;
    expect(base.id).toBe('default');
    const res = await send('admin', 'POST', '/api/objects/opportunity/layouts', {
      ...input(base),
      name: 'Rep Layout',
      isDefault: false,
      roleIds: ['sales_rep'],
      sections: [{ id: 'deal', title: 'Deal', columns: 2, fields: ['name', 'amount', 'stage', 'close_date'] }],
    });
    expect(res.statusCode).toBe(201);
    const { layouts } = await setupLayouts('opportunity');
    // The implicit layout was stored too, so users of other roles keep seeing it.
    expect(layouts.map((l) => [l.name, l.isDefault])).toEqual([
      [base.name, true],
      ['Rep Layout', false],
    ]);
    expect((await layoutOf('james', 'opportunity')).name).toBe('Rep Layout');
    expect((await layoutOf('maria', 'opportunity')).sections).toEqual(base.sections);

    // Making the rep layout the default moves the flag.
    await send('admin', 'PUT', `/api/objects/opportunity/layouts/${res.json().id}`, { ...input(res.json()), isDefault: true });
    expect((await setupLayouts('opportunity')).layouts.map((l) => [l.name, l.isDefault])).toEqual([
      ['Rep Layout', true],
      [base.name, false],
    ]);
    expect((await layoutOf('maria', 'opportunity')).name).toBe('Rep Layout');
  });

  it('validates layouts', async () => {
    const base = input((await setupLayouts('contact')).layouts[0]!);
    const sections = base.sections;
    const attempt = (body: object, method: 'POST' | 'PUT' = 'PUT', who = 'admin') =>
      send(who, method, method === 'PUT' ? '/api/objects/contact/layouts/default' : '/api/objects/contact/layouts', { ...base, ...body });
    expect((await attempt({ sections: [...sections, { id: 'again', title: 'Again', columns: 2, fields: [sections[0]!.fields[0]] }] })).json().error.message).toMatch(/on the layout twice/);
    expect((await attempt({ sections: [{ id: 'x', title: '', columns: 2, fields: ['nope'] }] })).json().error.message).toBe('Unknown field nope');
    expect((await attempt({ sections: [{ ...sections[0]!, id: 'Bad Id' }] })).statusCode).toBe(400);
    expect((await attempt({ sections: [{ ...sections[0]!, columns: 3 }] })).statusCode).toBe(400);
    expect((await attempt({ sections: [] })).statusCode).toBe(400);
    expect((await attempt({ highlights: ['name', 'email', 'phone', 'title', 'account', 'mobile', 'owner_id'] })).statusCode).toBe(400);
    expect((await attempt({ relatedLists: ['opportunity.account'] })).json().error.message).toBe('Unknown related list opportunity.account');
    expect((await attempt({ roleIds: ['nope'] })).json().error.message).toBe('Unknown role nope');
    expect((await attempt({ isDefault: false })).json().error.message).toMatch(/another layout the default/);
    expect((await attempt({}, 'PUT', 'maria')).statusCode).toBe(403);
    expect((await send('maria', 'GET', '/api/objects/contact/layouts')).statusCode).toBe(403);

    const first = await attempt({ name: 'Managers', isDefault: false, roleIds: ['sales_manager'] }, 'POST');
    expect(first.statusCode).toBe(201);
    const clash = await attempt({ name: 'Managers 2', isDefault: false, roleIds: ['sales_manager'] }, 'POST');
    expect(clash.statusCode).toBe(409);
    expect(clash.json().error.message).toBe('sales_manager already use the layout "Managers"');
    const defaultId = (await setupLayouts('contact')).layouts.find((l) => l.isDefault)!.id;
    expect((await send('admin', 'DELETE', `/api/objects/contact/layouts/${defaultId}`)).statusCode).toBe(400);
    expect((await send('admin', 'DELETE', `/api/objects/contact/layouts/${first.json().id}`)).statusCode).toBe(200);
    expect((await send('admin', 'DELETE', `/api/objects/contact/layouts/${first.json().id}`)).statusCode).toBe(404);
  });

  it('places fields and related lists created after a layout was saved, and drops deleted ones', async () => {
    const created = await send('admin', 'POST', '/api/objects', { label: 'Site Visit', pluralLabel: 'Site Visits' });
    expect(created.statusCode).toBe(201);
    const api: string = created.json().apiName;
    await send('admin', 'POST', `/api/objects/${api}/fields`, { label: 'Notes', type: 'longtext', section: 'Details' });
    const base = (await setupLayouts(api)).layouts[0]!;
    expect(base.sections.map((sec) => sec.title)).toEqual(['', 'Details']);
    // Save it without the Notes field: removed fields stay removed.
    const saved = (
      await send('admin', 'PUT', `/api/objects/${api}/layouts/default`, {
        ...input(base),
        sections: base.sections.map((sec) => ({ ...sec, fields: sec.fields.filter((f) => f !== 'notes') })),
      })
    ).json() as PageLayoutDef;
    expect(saved.sections.flatMap((sec) => sec.fields)).not.toContain('notes');

    await send('admin', 'POST', `/api/objects/${api}/fields`, { label: 'Rating', type: 'number', section: 'Details' });
    await send('admin', 'POST', `/api/objects/${api}/fields`, { label: 'Visited On', type: 'date' });
    await send('admin', 'POST', `/api/objects/${api}/fields`, { label: 'Account', apiName: 'visit_account', type: 'lookup', referenceTo: 'account' });
    let layout = await layoutOf('admin', api);
    expect(layout.sections.find((sec) => sec.title === 'Details')!.fields).toEqual(['rating']);
    expect(layout.sections[0]!.fields).toEqual(expect.arrayContaining(['visited_on', 'visit_account']));
    expect(layout.sections.flatMap((sec) => sec.fields)).not.toContain('notes');
    // The new lookup adds a related list to the account's stored layout, after the chosen ones.
    expect((await layoutOf('admin', 'account')).relatedLists).toEqual(['opportunity.account', 'contact.account', `${api}.visit_account`]);

    await send('admin', 'DELETE', `/api/objects/${api}/fields/rating`);
    layout = await layoutOf('admin', api);
    expect(layout.sections.flatMap((sec) => sec.fields)).not.toContain('rating');

    await send('admin', 'DELETE', `/api/objects/${api}/fields/visit_account`);
    expect((await layoutOf('admin', 'account')).relatedLists).toEqual(['opportunity.account', 'contact.account']);
    expect((await send('admin', 'DELETE', `/api/objects/${api}`)).statusCode).toBe(200);
    expect(await s.db.all('SELECT id FROM page_layouts WHERE object_api_name = ?', [api])).toEqual([]);
  });

  it('hides sensitive fields from roles that cannot see them', async () => {
    const fields = (l: PageLayoutDef) => l.sections.flatMap((sec) => sec.fields);
    expect(fields(await layoutOf('hannah', 'employee'))).toContain('salary');
    expect(fields(await layoutOf('noah', 'employee'))).not.toContain('salary');
    expect((await send('noah', 'GET', '/api/objects/account/layout')).statusCode).toBe(404);
  });
});
