import { buildApp } from './app.js';
import { readConfig } from './config.js';

const app = buildApp({
  logger: {
    redact: ['req.headers.authorization', 'req.headers.cookie'],
  },
});

async function shutdown() {
  try {
    await app.close();
  } catch (error) {
    app.log.error(error);
    process.exitCode = 1;
  }
}

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());

try {
  await app.listen(readConfig());
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
  await shutdown();
}
