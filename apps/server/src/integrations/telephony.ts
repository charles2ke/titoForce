import { createHmac, timingSafeEqual } from 'node:crypto';
import { CALL_OUTCOMES, type CallDetails, type CallLogRequest, type CallState, type CallStatus, type CrmRecord, type StartCallRequest } from '@titoforce/shared';
import type { IntegrationsConfig } from '../config.ts';
import type { Db } from '../db/database.ts';
import { matchContacts, normalizePhone } from '../platform/contact-points.ts';
import type { NotificationService } from '../platform/notifications.ts';
import { assertCanCreate, type Principal } from '../platform/principal.ts';
import type { RecordService } from '../platform/records.ts';
import type { UserService } from '../platform/users.ts';
import { AppError, badRequest, forbidden, newId, notFound, nowIso, RateLimiter, truncate } from '../util.ts';
import { errorMessage, providerJson } from './oauth.ts';

const TWILIO_API = 'https://api.twilio.com/2010-04-01';
const FINAL: CallStatus[] = ['completed', 'busy', 'no-answer', 'failed', 'canceled', 'logged'];
const FINAL_SQL = FINAL.map((s) => `'${s}'`).join(', ');
const TWILIO_STATUSES: Record<string, CallStatus> = {
  queued: 'queued',
  initiated: 'queued',
  ringing: 'ringing',
  'in-progress': 'in-progress',
  answered: 'in-progress',
  completed: 'completed',
  busy: 'busy',
  'no-answer': 'no-answer',
  failed: 'failed',
  canceled: 'canceled',
};

export type TwilioParams = Record<string, string | undefined>;

/**
 * A dialable E.164 number ("+14155550100"). Numbers without a country code get the default calling code (a national
 * trunk "0" is dropped); without one they are refused. Extensions are ignored.
 */
export function toE164(raw: string, defaultCode: string | null): string | null {
  const main = raw.trim().replace(/\s*(?:ext\.?|extension|x|#)\s*\d{1,6}$/i, '');
  if (!/^\+?[\d\s().\-/]+$/.test(main)) return null;
  let digits = main.replace(/\D/g, '');
  const valid = (d: string) => (/^[1-9]\d{6,14}$/.test(d) ? `+${d}` : null);
  if (main.startsWith('+')) return valid(digits);
  if (digits.startsWith('00')) return valid(digits.slice(2));
  if (!defaultCode) return null;
  if (defaultCode === '1') {
    if (digits.startsWith('011')) return valid(digits.slice(3));
    if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  } else if (digits.startsWith('0')) {
    digits = digits.slice(1);
  }
  return digits.length >= 4 ? valid(`${defaultCode}${digits}`) : null;
}

/** Twilio's request signature: HMAC-SHA1 of the URL followed by the sorted form fields (names and values), base64. */
export function twilioSignature(authToken: string, url: string, params: TwilioParams): string {
  const data =
    url +
    Object.keys(params)
      .sort()
      .map((k) => `${k}${params[k] ?? ''}`)
      .join('');
  return createHmac('sha1', authToken).update(data, 'utf8').digest('base64');
}

/** `publicUrl + path`, plus the same URL with the port added (the scheme's default) or removed. */
function signedUrls(publicUrl: string, path: string): string[] {
  const urls = [`${publicUrl}${path}`];
  const m = /^(https?:\/\/\[[^\]]+\]|https?:\/\/[^/:[]+)(?::(\d+))?(.*)$/i.exec(publicUrl);
  if (m) urls.push(`${m[1]}${m[2] ? '' : publicUrl.toLowerCase().startsWith('https:') ? ':443' : ':80'}${m[3]}${path}`);
  return urls;
}

const xml = (s: string): string => s.replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]!);
const twiml = (body: string): string => `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`;
const HANG_UP = twiml('<Hangup/>');
const UNAVAILABLE = twiml('<Say>Sorry, no one can take your call right now. We will call you back as soon as possible.</Say><Hangup/>');

const seconds = (value: string | undefined): number | null => {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

interface CallRow {
  id: string;
  activity_id: string | null;
  user_id: string | null;
  record_id: string | null;
  direction: 'inbound' | 'outbound';
  status: CallStatus;
  provider: 'twilio' | 'manual';
  provider_call_id: string | null;
  from_number: string | null;
  to_number: string | null;
  duration_seconds: number | null;
  outcome: string | null;
  started_at: string;
  ended_at: string | null;
}

const CALL_COLUMNS =
  'id, activity_id, user_id, record_id, direction, status, provider, provider_call_id, from_number, to_number, duration_seconds, outcome, started_at, ended_at';

export const toCallDetails = (r: CallRow): CallDetails => ({
  id: r.id,
  direction: r.direction,
  status: r.status,
  provider: r.provider,
  from: r.from_number,
  to: r.to_number,
  durationSeconds: r.duration_seconds === null ? null : Number(r.duration_seconds),
  outcome: r.outcome,
  startedAt: r.started_at,
  endedAt: r.ended_at,
});

export interface TelephonyDeps {
  db: Db;
  cfg: IntegrationsConfig;
  records: RecordService;
  users: UserService;
  notifications: NotificationService;
  fetchImpl: typeof fetch;
}

/** Click-to-call and inbound calls through Twilio, and calls logged by hand. */
export class TelephonyService {
  private d: TelephonyDeps;
  private limiter = new RateLimiter(30, 3_600_000);

  constructor(deps: TelephonyDeps) {
    this.d = deps;
  }

  get configured(): boolean {
    return !!this.d.cfg.twilio;
  }

  e164(raw: string): string | null {
    return toE164(raw, this.d.cfg.defaultCallingCode);
  }

  webhookUrl(kind: 'voice' | 'bridge' | 'dial-status' | 'status', callId?: string, leg?: 'dialed'): string {
    const url = new URL(`${this.d.cfg.publicUrl}/api/telephony/twilio/${kind}`);
    if (callId) url.searchParams.set('call', callId);
    if (leg) url.searchParams.set('leg', leg);
    return url.toString();
  }

  /**
   * Checks a webhook request's X-Twilio-Signature (`path` includes the query string). Like Twilio's own validators,
   * the URL is also tried with and without its port, since Twilio may sign either form.
   */
  verify(path: string, params: TwilioParams, signature: string | undefined): boolean {
    const tw = this.d.cfg.twilio;
    if (!tw || !signature) return false;
    const given = Buffer.from(signature);
    return signedUrls(this.d.cfg.publicUrl, path).some((url) => {
      const expected = Buffer.from(twilioSignature(tw.authToken, url, params));
      return expected.length === given.length && timingSafeEqual(expected, given);
    });
  }

  private row(id: string): Promise<CallRow | undefined> {
    return this.d.db.get<CallRow>(`SELECT ${CALL_COLUMNS} FROM calls WHERE id = ?`, [id]);
  }

  private async rowBySid(sid: string | undefined): Promise<CallRow | undefined> {
    if (!sid) return undefined;
    return this.d.db.get<CallRow>(`SELECT ${CALL_COLUMNS} FROM calls WHERE provider = 'twilio' AND provider_call_id = ?`, [sid]);
  }

  /** A call the user made, or one logged on an activity they can read. */
  async get(principal: Principal, id: string): Promise<CallState> {
    const row = await this.row(id);
    if (!row) throw notFound('Call not found');
    if (row.user_id !== principal.userId) {
      if (!row.activity_id) throw notFound('Call not found');
      await this.d.records.get(principal, 'activity', row.activity_id);
    }
    return { call: toCallDetails(row), activityId: row.activity_id };
  }

  // ---------- click-to-call ----------

  /** Rings the user's own phone; when they answer, Twilio connects them to the number (see `bridge`). */
  async start(principal: Principal, input: StartCallRequest): Promise<CallState> {
    const tw = this.d.cfg.twilio;
    if (!tw) throw badRequest('Calling is not set up: an administrator has to configure Twilio.');
    if (principal.type !== 'user' || !principal.userId) throw forbidden('Only users can make calls');
    const userId = principal.userId;
    const user = await this.d.users.getUser(userId);
    const own = user?.phone ? this.e164(user.phone) : null;
    if (!own) throw badRequest('Add your phone number in Settings first: titoForce rings your phone, then connects the call.');
    const target = await this.d.records.get(principal, null, input.recordId);
    assertCanCreate(principal, 'activity');
    const to = this.e164(input.phone ?? '');
    if (!to) throw badRequest(`"${truncate(input.phone ?? '', 40)}" cannot be dialed. Write it in international format, e.g. +44 20 7946 0958.`);
    if (to === own) throw badRequest('This is your own phone number');
    if (!this.limiter.hit(userId)) throw new AppError(429, 'rate_limited', 'You can start at most 30 calls per hour');

    const id = newId('cal');
    const now = nowIso();
    await this.d.db.run(
      `INSERT INTO calls (id, activity_id, user_id, record_id, direction, status, provider, provider_call_id, from_number, to_number, duration_seconds, outcome, started_at, ended_at, updated_at)
       VALUES (?, NULL, ?, ?, 'outbound', 'queued', 'twilio', NULL, ?, ?, NULL, NULL, ?, NULL, ?)`,
      [id, userId, target.id, tw.number, to, now, now],
    );
    try {
      const created = await providerJson<{ sid?: string }>(this.d.fetchImpl, 'twilio', `${TWILIO_API}/Accounts/${encodeURIComponent(tw.accountSid)}/Calls.json`, {
        method: 'POST',
        headers: {
          authorization: `Basic ${Buffer.from(`${tw.accountSid}:${tw.authToken}`).toString('base64')}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ To: own, From: tw.number, Url: this.webhookUrl('bridge', id), StatusCallback: this.webhookUrl('status', id) }).toString(),
      });
      await this.d.db.run('UPDATE calls SET provider_call_id = ?, updated_at = ? WHERE id = ?', [created.sid ?? null, nowIso(), id]);
    } catch (err) {
      await this.d.db.run('DELETE FROM calls WHERE id = ?', [id]);
      throw err;
    }
    return this.get(principal, id);
  }

  /**
   * The user's phone was answered. Twilio cannot tell a person from voicemail, so the user first presses 1 (the
   * <Gather> posts back here with `Digits`); only then is the call logged and the other party dialed.
   */
  async bridge(callId: string | undefined, digits: string | undefined): Promise<string> {
    const tw = this.d.cfg.twilio;
    const call = callId ? await this.row(callId) : undefined;
    if (!tw || !call || call.direction !== 'outbound' || !call.to_number || call.status !== 'queued') return HANG_UP;
    if (digits !== '1') {
      return twiml(
        `<Gather input="dtmf" numDigits="1" timeout="10" action="${xml(this.webhookUrl('bridge', call.id))}"><Say>Press 1 to connect your call.</Say></Gather>` +
          '<Say>The call was not connected. Goodbye.</Say><Hangup/>',
      );
    }
    const { changes } = await this.d.db.run("UPDATE calls SET status = 'ringing', updated_at = ? WHERE id = ? AND status = 'queued'", [nowIso(), call.id]);
    if (!changes) return HANG_UP;
    await this.logActivity(call);
    return this.dial(call.id, call.to_number, `callerId="${xml(tw.number)}" timeout="30"`);
  }

  /**
   * Connects the call to `number`. The dialed leg reports when it is answered and when it ends; `dialStatus` reports
   * the end as well, and whichever arrives first settles the call.
   */
  private dial(callId: string, number: string, attributes: string): string {
    return twiml(
      `<Dial ${attributes} action="${xml(this.webhookUrl('dial-status', callId))}">` +
        `<Number statusCallbackEvent="answered completed" statusCallback="${xml(this.webhookUrl('status', callId, 'dialed'))}">${xml(number)}</Number></Dial>`,
    );
  }

  // ---------- inbound calls ----------

  /** A call to the Twilio number: forwarded to the phone of the caller's record owner (or the default owner). */
  async voice(params: TwilioParams): Promise<string> {
    if (!this.d.cfg.twilio) return HANG_UP;
    const existing = await this.rowBySid(params.CallSid);
    if (existing) {
      // A repeated webhook for the same call.
      const user = existing.user_id ? await this.d.users.getUser(existing.user_id) : undefined;
      const phone = existing.status === 'ringing' && user?.phone ? this.e164(user.phone) : null;
      return phone ? this.dial(existing.id, phone, 'answerOnBridge="true" timeout="25"') : UNAVAILABLE;
    }
    const caller = params.From && params.From !== 'anonymous' ? (this.e164(params.From) ?? params.From) : null;
    const key = caller ? normalizePhone(caller) : null;
    const match = key ? (await matchContacts(this.d.db, 'phone', [caller!])).get(key) : undefined;
    let userId: string | null = null;
    let phone: string | null = null;
    for (const id of [match?.ownerId, await this.d.users.defaultOwnerId()]) {
      if (!id) continue;
      const user = await this.d.users.getUser(id);
      if (!user?.active || user.isAgent) continue;
      userId ??= user.id;
      const p = user.phone ? this.e164(user.phone) : null;
      if (p) {
        userId = user.id;
        phone = p;
        break;
      }
    }
    const id = newId('cal');
    const now = nowIso();
    await this.d.db.run(
      `INSERT INTO calls (id, activity_id, user_id, record_id, direction, status, provider, provider_call_id, from_number, to_number, duration_seconds, outcome, started_at, ended_at, updated_at)
       VALUES (?, NULL, ?, ?, 'inbound', 'ringing', 'twilio', ?, ?, ?, NULL, NULL, ?, NULL, ?)`,
      [id, userId, match?.recordId ?? null, params.CallSid ?? null, caller, params.To ?? null, now, now],
    );
    const call = (await this.row(id))!;
    await this.logActivity(call);
    if (!phone) {
      await this.finish(call, 'no-answer', null, 'No answer');
      return UNAVAILABLE;
    }
    // No callerId: the user sees the caller's number.
    return this.dial(id, phone, 'answerOnBridge="true" timeout="25"');
  }

  // ---------- call progress ----------

  /** The forwarded or bridged leg ended (<Dial action>). */
  async dialStatus(callId: string | undefined, params: TwilioParams): Promise<string> {
    const call = callId ? await this.row(callId) : undefined;
    if (!call) return HANG_UP;
    const dialStatus = params.DialCallStatus ?? '';
    const answered = dialStatus === 'completed' || dialStatus === 'answered';
    await this.endDialed(call, answered ? 'completed' : (TWILIO_STATUSES[dialStatus] ?? 'failed'), params.DialCallDuration);
    return call.direction === 'inbound' && !answered ? UNAVAILABLE : HANG_UP;
  }

  /** How the dialed party's leg ended: it was answered ("completed") or not (busy, no answer, ...). */
  private endDialed(call: CallRow, status: CallStatus, duration: string | undefined): Promise<void> {
    if (status === 'completed') return this.finish(call, 'completed', seconds(duration), 'Connected');
    return this.finish(call, status, null, status === 'busy' ? 'Busy' : status === 'no-answer' ? 'No answer' : null);
  }

  /** Status callbacks: the dialed party answered or hung up, or the whole call ended (also before reaching <Dial>). */
  async status(callId: string | undefined, leg: string | undefined, params: TwilioParams): Promise<void> {
    const call = callId ? await this.row(callId) : await this.rowBySid(params.CallSid);
    if (!call) return;
    const status = TWILIO_STATUSES[params.CallStatus ?? ''];
    if (leg === 'dialed') {
      if (status === 'in-progress') await this.d.db.run("UPDATE calls SET status = 'in-progress', updated_at = ? WHERE id = ? AND status = 'ringing'", [nowIso(), call.id]);
      else if (status && FINAL.includes(status) && !FINAL.includes(call.status)) await this.endDialed(call, status, params.CallDuration);
      return;
    }
    if (!status || !FINAL.includes(status) || FINAL.includes(call.status)) return;
    if (status !== 'completed') await this.finish(call, status, null, null);
    else if (call.status === 'in-progress') await this.finish(call, 'completed', seconds(params.CallDuration), 'Connected');
    // Hung up before the dialed party answered, or without pressing 1 (voicemail, or the user changed their mind).
    else await this.finish(call, 'canceled', null, null);
  }

  private async counterpart(call: CallRow, principal: Principal): Promise<{ name: string; record: CrmRecord | null }> {
    let record: CrmRecord | null = null;
    if (call.record_id) {
      try {
        record = await this.d.records.get(principal, null, call.record_id);
      } catch {
        record = null;
      }
    }
    const number = call.direction === 'outbound' ? call.to_number : call.from_number;
    return { name: record?.name ?? number ?? 'an unknown number', record };
  }

  /** Logs the call as an open Call activity of its user. */
  private async logActivity(call: CallRow): Promise<void> {
    if (call.activity_id || !call.user_id) return;
    try {
      const principal = await this.d.users.principalForUser(call.user_id);
      const { name, record } = await this.counterpart(call, principal);
      await this.d.records.create(
        principal,
        'activity',
        {
          subject: truncate(call.direction === 'outbound' ? `Call to ${name}` : `Call from ${name}`, 255),
          type: 'Call',
          status: 'Open',
          due_date: nowIso().slice(0, 10),
          related_to: record?.id ?? null,
        },
        { afterInsert: (tx, rec) => tx.run('UPDATE calls SET activity_id = ?, updated_at = ? WHERE id = ?', [rec.id, nowIso(), call.id]).then(() => undefined) },
      );
    } catch (err) {
      // The conversation goes ahead either way.
      await this.d.notifications.notify([call.user_id], 'Call not logged', `A call could not be logged: ${errorMessage(err)}`);
    }
  }

  /** Records how a call ended (once) and completes its activity; missed inbound calls stay open as a call-back reminder. */
  private async finish(call: CallRow, status: CallStatus, duration: number | null, outcome: string | null): Promise<void> {
    const now = nowIso();
    const { changes } = await this.d.db.run(
      `UPDATE calls SET status = ?, duration_seconds = ?, outcome = ?, ended_at = ?, updated_at = ? WHERE id = ? AND status NOT IN (${FINAL_SQL})`,
      [status, duration, outcome, now, now, call.id],
    );
    if (!changes) return;
    const fresh = (await this.row(call.id))!;
    if (!fresh.user_id) return;
    const principal = await this.d.users.principalForUser(fresh.user_id);
    const missed = fresh.direction === 'inbound' && status !== 'completed';
    if (fresh.activity_id) {
      try {
        if (missed) {
          const { name } = await this.counterpart(fresh, principal);
          await this.d.records.update(principal, 'activity', fresh.activity_id, { subject: truncate(`Missed call from ${name}`, 255) });
        } else {
          await this.d.records.update(principal, 'activity', fresh.activity_id, { status: 'Completed' });
        }
      } catch {
        // Left as it is when the user may no longer edit it.
      }
    }
    if (missed) {
      const { name } = await this.counterpart(fresh, principal);
      await this.d.notifications.notify([fresh.user_id], `Missed call from ${name}`, fresh.from_number, fresh.activity_id ? `/r/${fresh.activity_id}` : null);
    }
  }

  // ---------- calls logged by hand ----------

  async log(principal: Principal, input: CallLogRequest): Promise<CallState> {
    if (principal.type !== 'user' || !principal.userId) throw forbidden('Only users can log calls');
    const userId = principal.userId;
    const target = await this.d.records.get(principal, null, input.recordId);
    assertCanCreate(principal, 'activity');
    if (input.outcome && !(CALL_OUTCOMES as readonly string[]).includes(input.outcome)) throw badRequest(`Outcome must be one of: ${CALL_OUTCOMES.join(', ')}`);
    const duration = input.durationSeconds ?? null;
    if (duration !== null && (!Number.isInteger(duration) || duration < 0 || duration > 86_400)) throw badRequest('Duration must be between 0 and 86400 seconds');
    const atMs = input.at ? Date.parse(input.at) : Date.now();
    if (Number.isNaN(atMs)) throw badRequest('"at" is not a valid date and time');
    if (atMs > Date.now() + 60_000) throw badRequest('A logged call cannot be in the future');
    const at = new Date(atMs).toISOString();
    const subject = (input.subject ?? '').replace(/\s+/g, ' ').trim() || `${input.direction === 'outbound' ? 'Call to' : 'Call from'} ${target.name}`;
    const notes = input.notes?.replace(/\r\n?/g, '\n').trim() || null;
    const phone = input.phone?.trim() ? truncate(input.phone.trim(), 40) : null;
    const id = newId('cal');
    const activity = await this.d.records.create(
      principal,
      'activity',
      { subject: truncate(subject, 255), type: 'Call', status: 'Completed', due_date: at.slice(0, 10), related_to: target.id, description: notes },
      {
        timestamp: at,
        afterInsert: async (tx, rec) => {
          await tx.run(
            `INSERT INTO calls (id, activity_id, user_id, record_id, direction, status, provider, provider_call_id, from_number, to_number, duration_seconds, outcome, started_at, ended_at, updated_at)
             VALUES (?, ?, ?, ?, ?, 'logged', 'manual', NULL, ?, ?, ?, ?, ?, ?, ?)`,
            [
              id,
              rec.id,
              userId,
              target.id,
              input.direction,
              input.direction === 'inbound' ? phone : null,
              input.direction === 'outbound' ? phone : null,
              duration,
              input.outcome ?? null,
              at,
              duration === null ? null : new Date(atMs + duration * 1000).toISOString(),
              nowIso(),
            ],
          );
        },
      },
    );
    return { call: toCallDetails((await this.row(id))!), activityId: activity.id };
  }
}
