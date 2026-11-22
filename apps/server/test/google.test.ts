import { describe, expect, it } from 'vitest';
import type { SyncState } from '../src/integrations/accounts.ts';
import { syncGmail } from '../src/integrations/google.ts';
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
});
