import { seedIamPolicies } from '../modules/iam/index.js';
import { seedSchedulingPolicies } from '../modules/scheduling/index.js';

import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { buildContainer, closeContainer } from './container.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const container = buildContainer(config);
  await seedIamPolicies(container.policyStore);
  await seedSchedulingPolicies(container.policyStore);
  const app = await buildApp(container);

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    container.logger.info({ signal }, 'shutting down');
    await app.close();
    await closeContainer(container);
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ port: config.port, host: '0.0.0.0' });
  container.logger.info({ port: config.port }, 'core-api listening');
}

main().catch((error: unknown) => {
  // The one place a bare console call is correct: startup can fail before
  // `loadConfig()` returns, at which point no logger has been constructed
  // to report the failure through.
  // eslint-disable-next-line no-console
  console.error('core-api failed to start:', error);
  process.exit(1);
});
