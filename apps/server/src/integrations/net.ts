import { lookup as dnsLookup } from 'node:dns';
import { lookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import { AppError, badRequest } from '../util.ts';

// Loopback, private, link-local (cloud metadata), carrier-grade NAT, documentation, multicast and reserved ranges.
const blocked = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24],
  ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blocked.addSubnet(net, prefix, 'ipv4');
// IPv4-compatible/unspecified/loopback, NAT64, discard, Teredo, documentation, 6to4, unique-local, link-local, site-local, multicast.
for (const [net, prefix] of [
  ['::', 96], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64], ['2001::', 32], ['2001:db8::', 32], ['2002::', 16],
  ['fc00::', 7], ['fe80::', 10], ['fec0::', 10], ['ff00::', 8],
] as const) blocked.addSubnet(net, prefix, 'ipv6');

const stripBrackets = (host: string) => host.replace(/^\[(.*)\]$/, '$1');

/** True for addresses that must not be reachable through user-supplied hosts (anything that is not public unicast). */
export function isPrivateAddress(address: string): boolean {
  const ip = stripBrackets(address);
  const family = isIP(ip);
  if (family === 4) return blocked.check(ip, 'ipv4');
  if (family === 6) {
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
    return mapped ? blocked.check(mapped[1]!, 'ipv4') : blocked.check(ip, 'ipv6');
  }
  return true;
}

/** Resolves a user-supplied host to one address to connect to, rejecting private networks unless allowed. */
export async function resolveHost(host: string, allowPrivate: boolean): Promise<string> {
  const bare = stripBrackets(host.trim());
  let addresses: { address: string }[];
  if (isIP(bare)) addresses = [{ address: bare }];
  else {
    try {
      addresses = await lookup(bare, { all: true, verbatim: true });
    } catch {
      throw badRequest(`Cannot resolve ${bare}`);
    }
  }
  if (!addresses.length) throw badRequest(`Cannot resolve ${bare}`);
  if (!allowPrivate && addresses.some((a) => isPrivateAddress(a.address))) {
    throw badRequest(`${bare} is on a private network, which is not allowed (set TITO_ALLOW_PRIVATE_NETWORK=true for local testing)`);
  }
  return addresses[0]!.address;
}

const MAIL_PORTS = { imap: [143, 993], smtp: [25, 465, 587, 2525] } as const;

/**
 * Where to connect for a user-supplied mail server: a validated IP address (so DNS cannot change between the check
 * and the connection) plus the host name for TLS certificate verification. Only standard mail ports are allowed.
 */
export async function mailEndpoint(kind: 'imap' | 'smtp', host: string, port: number, allowPrivate: boolean): Promise<{ address: string; servername?: string }> {
  if (!allowPrivate && !(MAIL_PORTS[kind] as readonly number[]).includes(port)) {
    throw badRequest(`${kind.toUpperCase()} port must be one of ${MAIL_PORTS[kind].join(', ')}`);
  }
  const address = await resolveHost(host, allowPrivate);
  const bare = stripBrackets(host.trim());
  return { address, servername: isIP(bare) ? undefined : bare };
}

/** Parses a calendar subscription URL (webcal:// is treated as https://). */
export function parseFeedUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw.trim().replace(/^webcals?:\/\//i, 'https://'));
  } catch {
    throw badRequest('Enter a valid calendar URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw badRequest('Calendar URLs must start with https://, http:// or webcal://');
  return url;
}

function guardedLookup(allowPrivate: boolean): LookupFunction {
  return (hostname, options, callback) => {
    dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err, '', 0);
      if (!addresses.length) return callback(Object.assign(new Error(`Cannot resolve ${hostname}`), { code: 'ENOTFOUND' }), '', 0);
      if (!allowPrivate && addresses.some((a) => isPrivateAddress(a.address))) {
        return callback(Object.assign(new Error(`${hostname} is on a private network`), { code: 'EPRIVATE' }), '', 0);
      }
      if (options.all) return callback(null, addresses);
      return callback(null, addresses[0]!.address, addresses[0]!.family);
    });
  };
}

export interface FetchTextOptions {
  allowPrivate: boolean;
  maxBytes?: number;
  timeoutMs?: number;
}

/**
 * GETs a user-supplied URL as text, checking every address it connects to (including redirect targets) against
 * private networks. Bounded in size, time and redirects.
 */
export async function fetchPublicText(url: URL, opts: FetchTextOptions): Promise<string> {
  let current = url;
  for (let redirects = 0; ; redirects++) {
    const res = await getOnce(current, opts);
    if (res.redirect === undefined) return res.body;
    if (redirects >= 3) throw badRequest('Too many redirects');
    current = parseFeedUrl(new URL(res.redirect, current).toString());
  }
}

function getOnce(url: URL, opts: FetchTextOptions): Promise<{ body: string; redirect?: string }> {
  const maxBytes = opts.maxBytes ?? 5 * 1024 * 1024;
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const fail = (message: string) => badRequest(`Could not load ${url.host}: ${message}`);
  return new Promise((resolve, reject) => {
    const host = stripBrackets(url.hostname);
    if (isIP(host) && !opts.allowPrivate && isPrivateAddress(host)) return reject(fail('the address is on a private network'));
    const mod = url.protocol === 'https:' ? https : http;
    const req = mod.request(
      url,
      { method: 'GET', agent: false, lookup: guardedLookup(opts.allowPrivate), headers: { accept: 'text/calendar, text/plain;q=0.8, */*;q=0.1', 'user-agent': 'titoForce' } },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          return resolve({ body: '', redirect: res.headers.location });
        }
        if (status < 200 || status >= 300) {
          res.resume();
          return reject(fail(`HTTP ${status}`));
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) req.destroy(new Error(`the response is larger than ${Math.round(maxBytes / 1024 / 1024)} MB`));
          else chunks.push(chunk);
        });
        res.on('end', () => resolve({ body: Buffer.concat(chunks).toString('utf8') }));
        res.on('error', (err) => reject(fail(err.message)));
      },
    );
    const timer = setTimeout(() => req.destroy(new Error('the server did not respond in time')), timeoutMs);
    req.on('close', () => clearTimeout(timer));
    req.on('error', (err) => reject(err instanceof AppError ? err : fail(err.message)));
    req.end();
  });
}
