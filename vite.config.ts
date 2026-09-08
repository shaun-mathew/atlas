import { defineConfig } from 'vite';
import { createAccountServer } from './server/accounts';

export default defineConfig({
  build: { target: 'es2022' },
  plugins: [{
    name: 'account-api',
    async configureServer(vite) {
      const api = await createAccountServer({
        databasePath: process.env.DATABASE_PATH ?? 'data/accounts.sqlite',
        baseURL: process.env.APP_ORIGIN ?? `http://127.0.0.1:${vite.config.server.port}`,
      });
      await new Promise<void>((resolve, reject) => {
        api.once('error', reject);
        api.listen(0, '127.0.0.1', resolve);
      });
      const address = api.address();
      if (!address || typeof address === 'string') throw new Error('Account API did not bind a TCP port.');
      vite.config.server.proxy = { '/api': `http://127.0.0.1:${address.port}` };
      vite.httpServer?.once('close', () => { api.close(); api.closeAllConnections(); });
    },
  }],
  server: {
    strictPort: true,
    port: 5173,
  },
});
