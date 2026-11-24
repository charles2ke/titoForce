import { SUPPORTED_LOCALES, type AppDef, type ObjectDef, type PageLayoutDef, type TranslationEntry } from '@titoforce/shared';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.ts';
import { GLOSSARIES } from '../src/i18n/glossary/index.ts';
import { standardSource } from '../src/i18n/source.ts';
import type { Services } from '../src/services.ts';
import { createTestServices } from './helpers.ts';

let s: Services;
let app: FastifyInstance;
const cookies: Record<string, string> = {};

const send = (who: string, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown, headers: Record<string, string> = {}) =>
  app.inject({
    method,
    url,
    headers: { cookie: cookies[who]!, ...headers, ...(method === 'GET' ? {} : { 'content-type': 'application/json' }) },
    payload: method === 'GET' ? undefined : JSON.stringify(payload ?? {}),
  });
const objectIn = async (locale: string | null, api: string, who = 'maria', query = ''): Promise<ObjectDef> =>
  (await send(who, 'GET', `/api/objects/${api}${query}`, undefined, locale ? { 'x-tito-locale': locale } : {})).json();
/** The built-in Spanish text of a standard label. */
const es = (key: string) => GLOSSARIES.es[key] ?? standardSource().get(key)!;

beforeAll(async () => {
  s = await createTestServices();
  app = await buildApp(s);
  for (const key of ['admin', 'maria', 'james']) {
    const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: `${key}@titoforce.example`, password: 'titoforce' } });
    cookies[key] = `tf_session=${res.cookies.find((c) => c.name === 'tf_session')!.value}`;
  }
});
afterAll(async () => {
  await app?.close();
  await s?.close();
});

describe('built-in translations', () => {
  it('cover exactly the standard labels in every language', () => {
    const keys = [...standardSource().keys()].sort();
    for (const locale of SUPPORTED_LOCALES) {
      if (locale === 'en') continue;
      const glossary = GLOSSARIES[locale];
      expect(Object.keys(glossary).sort(), locale).toEqual(keys);
      expect(Object.entries(glossary).filter(([, v]) => !v.trim()), locale).toEqual([]);
    }
  });
});

describe('translated metadata', () => {
  it('labels objects, fields and picklist values in the requested language', async () => {
    const opp = await objectIn('es', 'opportunity');
    expect(opp.label).toBe(es('object.opportunity.label'));
    expect(opp.pluralLabel).toBe(es('object.opportunity.pluralLabel'));
    const stage = opp.fields.find((f) => f.apiName === 'stage')!;
    expect(stage.label).toBe(es('field.opportunity.stage.label'));
    expect(stage.options!.find((o) => o.value === 'Closed Won')!.label ?? 'Closed Won').toBe(es('picklist.opportunity.stage.Closed Won'));

    // Setup edits the English originals; English needs no translation.
    expect((await objectIn('es', 'opportunity', 'admin', '?raw=1')).label).toBe('Opportunity');
    const english = await objectIn(null, 'opportunity');
    expect(english.label).toBe('Opportunity');
    expect(english.fields.find((f) => f.apiName === 'stage')!.options!.every((o) => o.label === undefined)).toBe(true);
    const list: ObjectDef[] = (await send('maria', 'GET', '/api/objects', undefined, { 'x-tito-locale': 'es' })).json();
    expect(list.find((o) => o.apiName === 'account')!.label).toBe(es('object.account.label'));
  });

  it("falls back to the user's saved language and lets the UI's language win", async () => {
    expect((await send('james', 'PUT', '/api/auth/locale', { locale: 'es' })).statusCode).toBe(200);
    expect((await objectIn(null, 'lead', 'james')).label).toBe(es('object.lead.label'));
    expect((await objectIn('en', 'lead', 'james')).label).toBe('Lead');
    expect((await objectIn('xx', 'lead', 'james')).label).toBe(es('object.lead.label'));
    await send('james', 'PUT', '/api/auth/locale', { locale: null });
    expect((await objectIn(null, 'lead', 'james')).label).toBe('Lead');
  });

  it('translates apps, layout sections and related lists', async () => {
    const apps: AppDef[] = (await send('maria', 'GET', '/api/apps', undefined, { 'x-tito-locale': 'es' })).json();
    const sales = apps.find((a) => a.id === 'sales')!;
    expect(sales.name).toBe(es('app.sales.name'));
    expect(sales.nav.find((n) => n.type === 'page' && n.page === 'forecast')!.label).toBe(es('app.sales.nav.forecast'));

    const layout: PageLayoutDef = (await send('maria', 'GET', '/api/objects/account/layout', undefined, { 'x-tito-locale': 'es' })).json();
    expect(layout.sections.find((sec) => sec.id === 'address')!.title).toBe(es('section.account.address'));
    expect(layout.sections[0]!.title).toBe('');

    const acme = (await send('maria', 'POST', '/api/records/account/query', { filters: { match: 'all', rules: [{ field: 'name', op: 'eq', value: 'Acme Robotics' }] } })).json().records[0];
    const related = (await send('maria', 'GET', `/api/records/account/${acme.id}/related`, undefined, { 'x-tito-locale': 'es' })).json();
    expect(related.lists.find((l: { object: string }) => l.object === 'contact').label).toBe(es('object.contact.pluralLabel'));
  });

  it('keeps renamed labels instead of applying the built-in translation of the original', async () => {
    await send('admin', 'PATCH', '/api/objects/account/fields/industry', { label: 'Sector' });
    const account = await objectIn('es', 'account');
    expect(account.fields.find((f) => f.apiName === 'industry')!.label).toBe('Sector');
    expect(account.fields.find((f) => f.apiName === 'phone')!.label).toBe(es('field.account.phone.label'));
    await send('admin', 'PATCH', '/api/objects/account/fields/industry', { label: 'Industry' });
    expect((await objectIn('es', 'account')).fields.find((f) => f.apiName === 'industry')!.label).toBe(es('field.account.industry.label'));
  });
});

describe('Setup → Translations', () => {
  it('lists every label with its built-in translation and saves overrides', async () => {
    const entries: TranslationEntry[] = (await send('admin', 'GET', '/api/translations?locale=es')).json();
    const accountLabel = entries.find((e) => e.key === 'object.account.label')!;
    expect(accountLabel).toEqual({
      key: 'object.account.label',
      category: 'object',
      object: 'account',
      context: 'Account',
      source: 'Account',
      value: null,
      builtIn: GLOSSARIES.es['object.account.label'] ?? null,
    });
    expect(entries.find((e) => e.key === 'picklist.opportunity.stage.Closed Won')).toMatchObject({ category: 'picklist', context: 'Opportunity · Stage' });
    expect(entries.find((e) => e.key === 'app.sales.nav.home')).toMatchObject({ category: 'app', object: null, source: 'Home' });
    expect(entries.find((e) => e.key === 'section.lead.qualification')).toMatchObject({ category: 'layout', source: 'Qualification' });

    const notify = vi.spyOn(s.realtime, 'metadataChanged');
    const saved = await send('admin', 'PUT', '/api/translations/es', {
      entries: [
        { key: 'object.account.label', value: '  Empresa ' },
        { key: 'picklist.opportunity.stage.Closed Won', value: 'Ganada' },
      ],
    });
    expect(saved.statusCode).toBe(200);
    expect((saved.json() as TranslationEntry[]).find((e) => e.key === 'object.account.label')!.value).toBe('Empresa');
    expect(notify).toHaveBeenCalled();
    notify.mockRestore();
    expect((await objectIn('es', 'account')).label).toBe('Empresa');
    expect((await objectIn('es', 'opportunity')).fields.find((f) => f.apiName === 'stage')!.options!.find((o) => o.value === 'Closed Won')!.label).toBe('Ganada');
    // Other languages are unaffected.
    expect((await objectIn('fr', 'account')).label).toBe(GLOSSARIES.fr['object.account.label'] ?? 'Account');

    await send('admin', 'PUT', '/api/translations/es', { entries: [{ key: 'object.account.label', value: null }] });
    expect((await objectIn('es', 'account')).label).toBe(es('object.account.label'));
  });

  it('rejects unknown labels, English and non-administrators', async () => {
    expect((await send('admin', 'PUT', '/api/translations/es', { entries: [{ key: 'object.nope.label', value: 'x' }] })).json().error.message).toBe('Unknown label object.nope.label');
    expect((await send('admin', 'PUT', '/api/translations/en', { entries: [{ key: 'object.account.label', value: 'x' }] })).statusCode).toBe(400);
    expect((await send('admin', 'GET', '/api/translations?locale=xx')).statusCode).toBe(400);
    expect((await send('maria', 'GET', '/api/translations?locale=es')).statusCode).toBe(403);
    expect((await send('maria', 'PUT', '/api/translations/es', { entries: [{ key: 'object.account.label', value: 'x' }] })).statusCode).toBe(403);
  });

  it('forgets the translations of deleted fields, objects and apps', async () => {
    const api: string = (await send('admin', 'POST', '/api/objects', { label: 'Survey', pluralLabel: 'Surveys' })).json().apiName;
    await send('admin', 'POST', `/api/objects/${api}/fields`, { label: 'Score', type: 'picklist', options: [{ value: 'High' }, { value: 'Low' }] });
    const appRes = await send('admin', 'POST', '/api/apps', { name: 'Research', nav: [{ type: 'object', object: api, label: 'Studies' }] });
    expect(appRes.statusCode).toBe(201);
    const appId: string = appRes.json().id;
    const keys = [`object.${api}.label`, `field.${api}.score.label`, `picklist.${api}.score.High`, `app.${appId}.name`, `app.${appId}.nav.${api}`];
    expect((await send('admin', 'PUT', '/api/translations/de', { entries: keys.map((key) => ({ key, value: `DE ${key}` })) })).statusCode).toBe(200);
    expect((await objectIn('de', api, 'admin')).fields.find((f) => f.apiName === 'score')!.options![0]!.label).toBe(`DE picklist.${api}.score.High`);

    const stored = async () => (await s.db.all<{ key: string }>('SELECT key FROM translations WHERE locale = ? ORDER BY key', ['de'])).map((r) => r.key);
    await send('admin', 'DELETE', `/api/objects/${api}/fields/score`);
    expect(await stored()).toEqual([`app.${appId}.name`, `app.${appId}.nav.${api}`, `object.${api}.label`]);
    await send('admin', 'DELETE', `/api/apps/${appId}`);
    expect(await stored()).toEqual([`object.${api}.label`]);
    await send('admin', 'DELETE', `/api/objects/${api}`);
    expect(await stored()).toEqual([]);
  });
});
