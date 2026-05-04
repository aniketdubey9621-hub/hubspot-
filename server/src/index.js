import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const { createApp } = await import('./createApp.js');
const { logStructured } = await import('./logger.js');

const PORT = Number(process.env.PORT) || 3001;

const app = await createApp({
  routePrefix: '',
  enableStatic: process.env.SERVE_STATIC === 'true',
  clientDistPath: path.resolve(
    process.env.CLIENT_DIST_PATH || path.join(__dirname, '../../client/dist'),
  ),
});

try {
  await app.listen({ port: PORT, host: '0.0.0.0' });
  logStructured('info', {
    event: 'server_listen',
    route: '_',
    latencyMs: 0,
    partnerStatus: null,
    port: PORT,
  });
} catch (err) {
  logStructured('error', {
    event: 'server_listen_failed',
    route: '_',
    partnerStatus: null,
    message: err.message,
  });
  process.exit(1);
}
