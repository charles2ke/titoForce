import { buildApp } from './app.ts';
import { loadConfig, loadDotEnv } from './config.ts';
import { seedIfNeeded } from './seed/index.ts';
import { createServices } from './services.ts';

loadDotEnv();
const config = loadConfig();
const services = await createServices(config);
const app = await buildApp(services, { logger: { level: config.logLevel } });

const seed = await seedIfNeeded(services, (msg) => app.log.info(msg));
if (seed.generatedAdmin) {
  // Shown once on first start only; set TITO_ADMIN_PASSWORD to choose it instead.
  console.log(
    `\n  Administrator account created\n    email:    ${seed.generatedAdmin.email}\n    password: ${seed.generatedAdmin.password}\n  Store it now; it will not be shown again.\n`,
  );
}

await app.listen({ port: config.port, host: config.host });
services.integrations.start();
const ai = services.agents.status();
app.log.info(`titoForce is running at http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`);
app.log.info(`AI: ${ai.configured ? `${ai.provider} (${ai.model})` : 'offline rules engine (set OPENAI_API_KEY or ANTHROPIC_API_KEY to use an LLM)'}`);
if (seed.demo) app.log.info('Demo data is loaded: sign in as maria@titoforce.example (or any demo user) with password "titoforce"');

let closing = false;
async function shutdown(signal: string): Promise<void> {
  if (closing) return;
  closing = true;
  app.log.info(`${signal} received, shutting down`);
  try {
    await app.close();
    await services.close();
    process.exit(0);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
