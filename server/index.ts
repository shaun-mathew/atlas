import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAccountServer } from './accounts';

// npm run build && npm start. Deploy behind HTTPS with APP_ORIGIN set to its
// public origin; bind HOST/PORT as needed. Back up DATABASE_PATH and its .secret
// sidecar together, or provide a persistent BETTER_AUTH_SECRET (32+ characters).
// No mail service is needed: recovery is an administrator password reset.
const host = process.env.HOST ?? '127.0.0.1';
const port = Number(process.env.PORT ?? 3001);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer from 1 to 65535.');
const baseURL = process.env.APP_ORIGIN ?? `http://${host.includes(':') ? `[${host}]` : host}:${port}`;
if (process.env.NODE_ENV === 'production' && !process.env.APP_ORIGIN) {
  throw new Error('Set APP_ORIGIN to the public origin, for example https://atlas.example.com.');
}
const databasePath = process.env.DATABASE_PATH ?? 'data/accounts.sqlite';

const server = await createAccountServer({
  databasePath: databasePath === ':memory:' ? databasePath : resolve(databasePath),
  baseURL,
  staticDirectory: fileURLToPath(new URL('../dist', import.meta.url)),
});
server.listen(port, host, () => console.log(`Atlas Practice listening on ${baseURL}`));
server.on('error', error => {
  console.error('Unable to start Atlas Practice:', error);
  process.exitCode = 1;
  server.close();
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close(error => { process.exitCode = error ? 1 : 0; });
    server.closeIdleConnections();
  });
}
