import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { expect, test } from '@playwright/test';

const source = readFileSync(new URL('../apps/web/public/sw.js', import.meta.url), 'utf8');

function worker({ fetch, caches }) {
  const context = { fetch, caches, self: { addEventListener() {} } };
  runInNewContext(source, context);
  return context;
}

function response(type = 'text/html') {
  return { ok: true, redirected: false, headers: { get: () => type }, clone() { return this; } };
}

test('navigation returns network HTML when caching fails and still falls back offline', async () => {
  const network = response();
  const cached = response();
  for (const fail of ['open', 'put']) {
    const sw = worker({
      fetch: async () => network,
      caches: {
        open: async () => {
          if (fail === 'open') throw new Error('storage unavailable');
          return { put: async () => { throw new Error('quota exceeded'); } };
        },
        match: async () => cached,
      },
    });
    expect(await sw.navigate('/')).toBe(network);
  }
  const offline = worker({ fetch: async () => { throw new Error('offline'); }, caches: { match: async () => cached } });
  expect(await offline.navigate('/')).toBe(cached);
});

test('assets return network responses when cache writes or eviction fail', async () => {
  const network = response('text/javascript');
  for (const fail of ['put', 'keys', 'delete']) {
    const cache = {
      match: async () => undefined,
      put: async () => { if (fail === 'put') throw new Error('quota exceeded'); },
      keys: async () => {
        if (fail === 'keys') throw new Error('storage unavailable');
        return Array.from({ length: 201 }, (_, i) => String(i));
      },
      delete: async () => { if (fail === 'delete') throw new Error('storage unavailable'); },
    };
    const sw = worker({ fetch: async () => network, caches: { open: async () => cache } });
    expect(await sw.asset('/assets/app.js')).toBe(network);
  }
});

test('assets still use cached responses without fetching', async () => {
  const cached = response('text/javascript');
  const sw = worker({
    fetch: async () => { throw new Error('unexpected fetch'); },
    caches: { open: async () => ({ match: async () => cached }) },
  });
  expect(await sw.asset('/assets/app.js')).toBe(cached);
});
