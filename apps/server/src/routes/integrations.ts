import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { assertSetup } from '../platform/principal.ts';
import { downloadContentType } from '../integrations/attachments.ts';
import { errorMessage } from '../integrations/oauth.ts';
import type { TwilioParams } from '../integrations/telephony.ts';
import type { Services } from '../services.ts';
import { AppError, badRequest, conflict, forbidden, notFound } from '../util.ts';
import { auth, params, parse, principalOf, query } from './http.ts';
import * as schemas from './schemas.ts';

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response/>';

/** RFC 6266 Content-Disposition with an ASCII fallback and the UTF-8 file name. */
export function attachmentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

const userIdOf = (req: FastifyRequest): string => {
  const a = auth(req);
  if (a.principal.type !== 'user') throw forbidden('Only users can manage integrations');
  return a.user.id;
};

const formBody = (body: unknown): TwilioParams => (body && typeof body === 'object' && !Array.isArray(body) ? { ...(body as TwilioParams) } : {});

/** Email, calendars, calls and files. */
export function integrationRoutes(app: FastifyInstance, s: Services): void {
  const i = s.integrations;
  const uploadLimit = Math.ceil((i.cfg.attachmentMaxBytes * 4) / 3) + 64 * 1024;
  const sendLimit = Math.ceil((Math.max(i.cfg.attachmentMaxBytes, 20 * 1024 * 1024) * 4) / 3) + 1024 * 1024;

  // ---------- status ----------

  app.get('/api/integrations/status', async (req) => i.status(principalOf(req)));

  app.get('/api/integrations/admin', async (req) => {
    assertSetup(principalOf(req));
    return i.adminStatus();
  });

  app.put('/api/integrations/phone', async (req) => {
    const userId = userIdOf(req);
    const raw = parse(schemas.phone, req.body).phone?.trim() || null;
    const phone = raw ? i.telephony.e164(raw) : null;
    if (raw && !phone) throw badRequest('Enter your number in international format, e.g. +1 415 555 0100');
    return s.users.setPhone(userId, phone);
  });

  // ---------- connected accounts ----------

  app.get('/api/integrations/accounts', async (req) => (await i.accounts.list(userIdOf(req))).map((a) => i.accounts.toDTO(a)));

  app.patch('/api/integrations/accounts/:id', async (req) => {
    const userId = userIdOf(req);
    const patch = parse(schemas.updateAccount, req.body);
    const account = await i.accounts.update(userId, params(req).id!, patch);
    if (patch.syncEmail || patch.syncCalendar) i.enqueueSync(account.id);
    return i.accounts.toDTO(account);
  });

  app.delete('/api/integrations/accounts/:id', async (req) => {
    await i.accounts.remove(userIdOf(req), params(req).id!);
    return { ok: true };
  });

  app.post('/api/integrations/accounts/:id/sync', async (req) => {
    const account = await i.accounts.own(userIdOf(req), params(req).id!);
    const result = await i.syncAccount(account.id);
    if (!result) throw conflict('This account is already syncing');
    return { account: i.accounts.toDTO((await i.accounts.get(account.id))!), result };
  });

  app.post('/api/integrations/imap', async (req, reply) => {
    const body = parse(schemas.imapAccount, req.body);
    if (!body.password) throw badRequest('Enter the mailbox password');
    const account = await i.mail.connectImap(userIdOf(req), body);
    i.enqueueSync(account.id);
    reply.code(201);
    return i.accounts.toDTO(account);
  });

  app.put('/api/integrations/imap/:id', async (req) => {
    const account = await i.mail.updateImap(userIdOf(req), params(req).id!, parse(schemas.imapAccount, req.body));
    i.enqueueSync(account.id);
    return i.accounts.toDTO(account);
  });

  app.post('/api/integrations/ics', async (req, reply) => {
    const account = await i.calendar.connectIcs(userIdOf(req), parse(schemas.icsAccount, req.body));
    i.enqueueSync(account.id);
    reply.code(201);
    return i.accounts.toDTO(account);
  });

  // ---------- Google and Microsoft sign-in ----------

  app.post('/api/integrations/oauth/:provider/start', async (req) => {
    const provider = params(req).provider;
    if (provider !== 'google' && provider !== 'microsoft') throw notFound('Unknown provider');
    return { url: await i.accounts.startOAuth(userIdOf(req), provider) };
  });

  // The provider sends the browser back here; the outcome is shown on the Settings page.
  app.get('/api/integrations/oauth/:provider/callback', { config: { public: true } }, async (req, reply) => {
    const provider = params(req).provider;
    if (provider !== 'google' && provider !== 'microsoft') throw notFound('Unknown provider');
    const q = query(req);
    const back = (key: 'connected' | 'integrationError', value: string) =>
      reply.redirect(`/settings?${new URLSearchParams({ [key]: value.split(/\r?\n/)[0]!.trim().slice(0, 300) })}`);
    if (!req.auth || req.auth.principal.type !== 'user') return back('integrationError', 'Your session has expired. Sign in and connect the account again.');
    if (q.error) return back('integrationError', q.error === 'access_denied' ? 'Access was not granted.' : q.error_description || q.error);
    if (!q.code || !q.state) return back('integrationError', 'The sign-in response was incomplete. Please try again.');
    try {
      const account = await i.accounts.finishOAuth(req.auth.user.id, provider, q.code, q.state);
      i.enqueueSync(account.id);
      return back('connected', account.label);
    } catch (err) {
      req.log.warn({ err }, 'OAuth sign-in failed');
      return back('integrationError', errorMessage(err));
    }
  });

  // ---------- calendar ----------

  app.post('/api/meetings', async (req, reply) => {
    const result = await i.calendar.createMeeting(principalOf(req), parse(schemas.meeting, req.body));
    reply.code(201);
    return result;
  });

  app.post('/api/integrations/calendar-feed', async (req) => i.calendar.createFeed(userIdOf(req)));

  app.delete('/api/integrations/calendar-feed', async (req) => {
    await i.calendar.deleteFeed(userIdOf(req));
    return { ok: true };
  });

  // Calendar apps subscribe to this link; the token in it is the only credential.
  app.get('/api/calendar/feed/:file', { config: { public: true } }, async (req, reply) => {
    const file = params(req).file ?? '';
    const ics = await i.calendar.feed(file.replace(/\.ics$/i, ''));
    if (ics === undefined) throw notFound('Calendar not found');
    return reply.header('content-type', 'text/calendar; charset=utf-8').header('content-disposition', 'inline; filename="titoforce.ics"').send(ics);
  });

  // ---------- email ----------

  app.post('/api/email/send', { bodyLimit: sendLimit }, async (req, reply) => {
    const result = await i.mail.send(principalOf(req), parse(schemas.sendEmail, req.body));
    reply.code(201);
    return result;
  });

  // ---------- files ----------

  app.get('/api/records/:object/:id/attachments', async (req) => {
    const { object, id } = params(req);
    return i.attachments.list(principalOf(req), object!, id!);
  });

  app.post('/api/records/:object/:id/attachments', { bodyLimit: uploadLimit }, async (req, reply) => {
    const { object, id } = params(req);
    const file = await i.attachments.upload(principalOf(req), object!, id!, parse(schemas.uploadFile, req.body));
    reply.code(201);
    return file;
  });

  app.get('/api/attachments/:id', async (req, reply) => {
    const file = await i.attachments.read(principalOf(req), params(req).id!);
    return reply
      .header('content-type', downloadContentType(file.contentType))
      .header('content-disposition', attachmentDisposition(file.fileName))
      .header('content-length', file.data.length)
      .send(file.data);
  });

  app.delete('/api/attachments/:id', async (req) => {
    await i.attachments.delete(principalOf(req), params(req).id!);
    return { ok: true };
  });

  // ---------- calls ----------

  app.post('/api/calls', async (req, reply) => {
    const state = await i.telephony.start(principalOf(req), parse(schemas.startCall, req.body));
    reply.code(201);
    return state;
  });

  app.post('/api/calls/log', async (req, reply) => {
    const state = await i.telephony.log(principalOf(req), parse(schemas.logCall, req.body));
    reply.code(201);
    return state;
  });

  app.get('/api/calls/:id', async (req) => i.telephony.get(principalOf(req), params(req).id!));

  // ---------- Twilio webhooks (form posts signed with the auth token) ----------

  const twilio = (path: string, handle: (q: Record<string, string | undefined>, body: TwilioParams) => Promise<string | void>) =>
    app.post(`/api/telephony/twilio/${path}`, { config: { webhook: true }, bodyLimit: 64 * 1024 }, async (req, reply: FastifyReply) => {
      if (!i.telephony.configured) throw notFound('Not found');
      const body = formBody(req.body);
      const signature = req.headers['x-twilio-signature'];
      if (!i.telephony.verify(req.url, body, Array.isArray(signature) ? signature[0] : signature)) {
        throw new AppError(403, 'invalid_signature', 'The request signature is not valid');
      }
      const twiml = (await handle(query(req), body)) ?? EMPTY_TWIML;
      return reply.header('content-type', 'text/xml; charset=utf-8').send(twiml);
    });

  twilio('voice', (_q, body) => i.telephony.voice(body));
  twilio('bridge', (q, body) => i.telephony.bridge(q.call, body.Digits));
  twilio('dial-status', (q, body) => i.telephony.dialStatus(q.call, body));
  twilio('status', (q, body) => i.telephony.status(q.call, q.leg, body));
}
