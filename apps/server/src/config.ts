import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export interface AiConfig {
  provider: 'openai' | 'anthropic' | 'offline';
  apiKey: string | null;
  baseUrl: string;
  model: string | null;
}

export interface IntegrationsConfig {
  /** External base URL of this server (OAuth redirects, Twilio webhooks, calendar feed links). */
  publicUrl: string;
  /** Key for encrypting stored mailbox and calendar credentials. */
  secretKey: string | null;
  /** Without a secret key, credentials are refused (production) or encrypted with a generated key kept in the database (development). */
  requireSecretKey: boolean;
  /** Organization SMTP relay for users without a connected mailbox, e.g. smtps://user:pass@smtp.example.com:465. */
  smtpUrl: string | null;
  /** From address used with the organization SMTP relay. */
  emailFrom: string | null;
  google: { clientId: string; clientSecret: string } | null;
  microsoft: { clientId: string; clientSecret: string; tenant: string } | null;
  twilio: { accountSid: string; authToken: string; number: string } | null;
  /** Country calling code assumed for phone numbers written without one, e.g. "1" or "44" (calling). */
  defaultCallingCode: string | null;
  /** Minutes between background mailbox and calendar syncs (0 disables the scheduler). */
  syncIntervalMinutes: number;
  attachmentMaxBytes: number;
  /** Let users connect mail servers and calendar URLs on private networks (local testing only). */
  allowPrivateNetwork: boolean;
}

export interface Config {
  port: number;
  host: string;
  databaseUrl: string;
  seedDemo: boolean;
  adminEmail: string | null;
  adminPassword: string | null;
  webDist: string;
  secureCookies: boolean;
  /** Trust X-Forwarded-* headers (client IPs for rate limiting) when running behind a reverse proxy. */
  trustProxy: boolean;
  logLevel: string;
  ai: AiConfig;
  integrations: IntegrationsConfig;
}

/** Loads the repository-root .env file, if any. Variables already set in the environment win. */
export function loadDotEnv(file = resolve(import.meta.dirname, '../../../.env')): void {
  if (existsSync(file)) process.loadEnvFile(file);
}

const DEFAULT_MODELS = { openai: 'gpt-4.1-mini', anthropic: 'claude-sonnet-4-5' } as const;

export function resolveAiConfig(env: NodeJS.ProcessEnv): AiConfig {
  const requested = (env.TITO_AI_PROVIDER ?? '').toLowerCase();
  const pick = (provider: 'openai' | 'anthropic'): AiConfig => {
    const apiKey = provider === 'openai' ? env.OPENAI_API_KEY : env.ANTHROPIC_API_KEY;
    const baseUrl =
      provider === 'openai'
        ? (env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1')
        : (env.ANTHROPIC_BASE_URL ?? 'https://api.anthropic.com/v1');
    return { provider, apiKey: apiKey || null, baseUrl: baseUrl.replace(/\/+$/, ''), model: env.TITO_AI_MODEL || DEFAULT_MODELS[provider] };
  };
  if (requested === 'offline') return { provider: 'offline', apiKey: null, baseUrl: '', model: null };
  if (requested === 'openai' || requested === 'anthropic') {
    const cfg = pick(requested);
    // OpenAI-compatible local servers (e.g. Ollama) may not need a key when a custom base URL is set.
    if (cfg.apiKey || (requested === 'openai' && env.OPENAI_BASE_URL)) return cfg;
    return { provider: 'offline', apiKey: null, baseUrl: '', model: null };
  }
  if (env.OPENAI_API_KEY) return pick('openai');
  if (env.ANTHROPIC_API_KEY) return pick('anthropic');
  return { provider: 'offline', apiKey: null, baseUrl: '', model: null };
}

const positive = (value: string | undefined, fallback: number): number => {
  const n = Number(value);
  return value !== undefined && value !== '' && Number.isFinite(n) && n >= 0 ? n : fallback;
};

export function resolveIntegrationsConfig(env: NodeJS.ProcessEnv, port: number): IntegrationsConfig {
  const google = env.TITO_GOOGLE_CLIENT_ID && env.TITO_GOOGLE_CLIENT_SECRET ? { clientId: env.TITO_GOOGLE_CLIENT_ID, clientSecret: env.TITO_GOOGLE_CLIENT_SECRET } : null;
  const microsoft =
    env.TITO_MICROSOFT_CLIENT_ID && env.TITO_MICROSOFT_CLIENT_SECRET
      ? { clientId: env.TITO_MICROSOFT_CLIENT_ID, clientSecret: env.TITO_MICROSOFT_CLIENT_SECRET, tenant: env.TITO_MICROSOFT_TENANT || 'common' }
      : null;
  const twilio =
    env.TITO_TWILIO_ACCOUNT_SID && env.TITO_TWILIO_AUTH_TOKEN && env.TITO_TWILIO_NUMBER
      ? { accountSid: env.TITO_TWILIO_ACCOUNT_SID, authToken: env.TITO_TWILIO_AUTH_TOKEN, number: env.TITO_TWILIO_NUMBER }
      : null;
  const callingCode = (env.TITO_DEFAULT_CALLING_CODE ?? '').trim().replace(/^\+/, '');
  return {
    publicUrl: (env.TITO_PUBLIC_URL || `http://localhost:${port}`).replace(/\/+$/, ''),
    secretKey: env.TITO_SECRET_KEY || null,
    requireSecretKey: env.NODE_ENV === 'production',
    smtpUrl: env.TITO_SMTP_URL || null,
    emailFrom: env.TITO_EMAIL_FROM || null,
    google,
    microsoft,
    twilio,
    defaultCallingCode: /^\d{1,3}$/.test(callingCode) ? callingCode : null,
    syncIntervalMinutes: positive(env.TITO_SYNC_INTERVAL_MINUTES, 5),
    attachmentMaxBytes: Math.round(positive(env.TITO_ATTACHMENT_MAX_MB, 10) * 1024 * 1024),
    allowPrivateNetwork: env.TITO_ALLOW_PRIVATE_NETWORK === 'true',
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.TITO_PORT ?? env.PORT ?? 3000);
  return {
    port,
    host: env.TITO_HOST ?? '127.0.0.1',
    databaseUrl: env.TITO_DATABASE_URL ?? env.DATABASE_URL ?? `sqlite:${resolve(import.meta.dirname, '../../../data/titoforce.db')}`,
    // Demo data (with well-known passwords) is on by default for local evaluation, but never implicitly in production.
    seedDemo: env.TITO_SEED_DEMO ? env.TITO_SEED_DEMO !== 'false' : env.NODE_ENV !== 'production',
    adminEmail: env.TITO_ADMIN_EMAIL ?? null,
    adminPassword: env.TITO_ADMIN_PASSWORD ?? null,
    webDist: resolve(import.meta.dirname, '../../..', env.TITO_WEB_DIST ?? 'apps/web/dist'),
    secureCookies: env.NODE_ENV === 'production' && env.TITO_INSECURE_COOKIES !== 'true',
    trustProxy: env.TITO_TRUST_PROXY === 'true',
    logLevel: env.TITO_LOG_LEVEL ?? 'info',
    ai: resolveAiConfig(env),
    integrations: resolveIntegrationsConfig(env, port),
  };
}
