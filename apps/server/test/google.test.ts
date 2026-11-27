import { describe, expect, it } from 'vitest';
import type { SyncState } from '../src/integrations/accounts.ts';
import { googleUpdateEvent, syncGmail } from '../src/integrations/google.ts';
import type { MailSink } from '../src/integrations/types.ts';

describe('Gmail history pagination', () => {
  it('retains the next page token when the history ID cap is reached', async () => {
    const requests: URL[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = new URL(input.toString());
      requests.push(url);
      if (url.pathname.endsWith('/profile')) return Response.json({ historyId: '2000' });
      if (url.pathname.endsWith('/history')) {
        if (url.searchParams.get('pageToken') === 'continue') {
          return Response.json({ history: [{ messagesAdded: [{ message: { id: 'later' } }] }] });
        }
        return Response.json({
          history: [{ messagesAdded: Array.from({ length: 5000 }, (_, i) => ({ message: { id: `m${i}` } })) }],
          nextPageToken: 'continue',
        });
      }
      return Response.json({ error: { code: 404, message: 'Not found' } }, { status: 404 });
    };
    const sink: MailSink = { wants: async () => false, ingest: async () => 'skipped' };
    const state: SyncState = { gmail: { historyId: '1000', offset: 4999 } };

    const capped = await syncGmail(fetchImpl, 'token', state, sink, 1);
    expect(capped.gmail).toEqual({ historyId: '1000', pageToken: 'continue' });

    const resumed = await syncGmail(fetchImpl, 'token', capped, sink, 1);
    expect(requests.filter((url) => url.pathname.endsWith('/history')).map((url) => url.searchParams.get('pageToken'))).toEqual([null, 'continue']);
    expect(resumed.gmail).toEqual({ historyId: '2000' });
  });

  it('continues a fixed initial search before syncing from its captured history ID', async () => {
    const requests: URL[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = new URL(input.toString());
      requests.push(url);
      if (url.pathname.endsWith('/profile')) return Response.json({ historyId: 'checkpoint' });
      if (url.pathname.endsWith('/messages')) {
        return Response.json({
          messages: [{ id: url.searchParams.get('pageToken') ? 'second' : 'first' }],
          ...(url.searchParams.get('pageToken') ? {} : { nextPageToken: 'page-2' }),
        });
      }
      if (url.pathname.endsWith('/history')) return Response.json({ history: [] });
      return Response.json({ error: { code: 404, message: 'Not found' } }, { status: 404 });
    };
    const sink: MailSink = { wants: async () => false, ingest: async () => 'skipped' };

    const first = await syncGmail(fetchImpl, 'token', {}, sink, 1);
    expect(first.gmail).toMatchObject({ historyId: 'checkpoint', search: { pageToken: 'page-2' } });
    const searchAfterFirstPage = requests.find((url) => url.pathname.endsWith('/messages'))!;
    const second = await syncGmail(fetchImpl, 'token', first, sink, 1);
    expect(second.gmail).toEqual({ historyId: 'checkpoint' });
    const searches = requests.filter((url) => url.pathname.endsWith('/messages'));
    expect(searches[1]!.searchParams.get('q')).toBe(searchAfterFirstPage.searchParams.get('q'));
    expect(searches[1]!.searchParams.get('pageToken')).toBe('page-2');

    const complete = await syncGmail(fetchImpl, 'token', second, sink, 1);
    expect(requests.find((url) => url.pathname.endsWith('/history'))!.searchParams.get('startHistoryId')).toBe('checkpoint');
    expect(complete.gmail).toEqual({ historyId: 'checkpoint' });
  });

  it('sends explicit empty values when a Google meeting location and description are cleared', async () => {
    let body = '';
    const fetchImpl: typeof fetch = async (_input, init) => {
      body = String(init?.body);
      return Response.json({});
    };
    await googleUpdateEvent(fetchImpl, 'token', 'event', {
      title: 'Review',
      start: '2026-11-22T10:00:00.000Z',
      end: '2026-11-22T11:00:00.000Z',
      location: null,
      description: null,
      attendees: [],
      sendInvites: false,
    });
    expect(JSON.parse(body)).toMatchObject({ location: '', description: '' });
  });
});
