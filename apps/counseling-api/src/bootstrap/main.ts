import { loadCrisisProtocol } from '../kernel/crisis-protocol/loader.js';

import { buildApp } from './app.js';
import { loadConfig } from './config.js';

async function main(): Promise<void> {
  const config = loadConfig();

  // BR-68 / EC-48: this call throws — and the process exits below, never
  // binding a port — when [R3] content is absent, invalid, or incomplete.
  // It runs before buildApp() deliberately: the gate is "the service does
  // not start," not "the service starts and then refuses every request."
  const crisisProtocol = loadCrisisProtocol(config.crisisProtocolPath);

  const app = buildApp(config);
  app.log.info({ protocolVersion: crisisProtocol.protocolVersion }, 'crisis protocol loaded');

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, 'shutting down');
    await app.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ port: config.port, host: '0.0.0.0' });
}

main().catch((error: unknown) => {
  // The one place a bare console call is correct: a missing [R3] manifest
  // or a config error can both fail before any Fastify logger exists.
  // eslint-disable-next-line no-console
  console.error('counseling-api failed to start:', error);
  process.exit(1);
});
