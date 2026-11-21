import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export interface AiConfig {
  provider: 'openai' | 'anthropic' | 'offline';
  apiKey: string | null;
  baseUrl: string;
  model: string | null;
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

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env.TITO_PORT ?? env.PORT ?? 3000),
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
  };
}
