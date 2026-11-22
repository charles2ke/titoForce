import { buildApp } from './app.ts';
import { loadConfig, loadDotEnv } from './config.ts';
import { seedIfNeeded } from './seed/index.ts';
import { Platform } from './tenancy/platform.ts';

loadDotEnv();
const config = loadConfig();
const platform = await Platform.open(config);
// The default organization uses TITO_DATABASE_URL; further organizations are created by sign-up or `npm run orgs`.
const services = await platform.servicesFor(platform.defaultTenant());
const app = await buildApp(platform, { logger: { level: config.logLevel } });

const seed = await seedIfNeeded(services, (msg) => app.log.info(msg));
if (seed.generatedAdmin) {
  // Shown once on first start only; set TITO_ADMIN_PASSWORD to choose it instead.
  console.log(
    `\n  Administrator account created\n    email:    ${seed.generatedAdmin.email}\n    password: ${seed.generatedAdmin.password}\n  Store it now; it will not be shown again.\n`,
  );
}

await app.listen({ port: config.port, host: config.host });
const ai = services.agents.status();
app.log.info(`titoForce is running at http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`);
app.log.info(`AI: ${ai.configured ? `${ai.provider} (${ai.model})` : 'offline rules engine (set OPENAI_API_KEY or ANTHROPIC_API_KEY to use an LLM)'}`);
if (seed.demo) app.log.info('Demo data is loaded: sign in as maria@titoforce.example (or any demo user) with password "titoforce"');
const organizations = await platform.listTenants();
if (organizations.length > 1 || config.allowSignup) {
  app.log.info(`Organizations: ${organizations.length}${config.allowSignup ? ' (sign-up is open)' : ''}${config.baseDomain ? `, addressed as <id>.${config.baseDomain}` : ''}`);
}

let closing = false;
async function shutdown(signal: string): Promise<void> {
  if (closing) return;
  closing = true;
  app.log.info(`${signal} received, shutting down`);
  try {
    await app.close();
    await platform.close();
    process.exit(0);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
