import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import { admin, username } from 'better-auth/plugins';
import { randomBytes, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, mkdir, readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { dirname, extname, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { initialProgress, mergeProgress, progressSchema, ProgressConflictError, type Progress } from '../src/progress';

export type AccountServerOptions = {
  databasePath: string;
  baseURL?: string;
  secret?: string;
  staticDirectory?: string;
  secureCookies?: boolean;
};

type Account = { id: string; username: string; role: 'admin' | 'learner' };
type ProgressRow = { progress: string; revision: number; resetRevision: number };
type AuthUser = { id: string; name: string; username?: string | null; displayUsername?: string | null; role?: string | null };

class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

const passwordSchema = z.string().min(8).max(128);
const credentialsSchema = z.object({
  username: z.string().trim().min(3).max(32).regex(/^[A-Za-z0-9_-]+$/),
  password: passwordSchema,
  progress: progressSchema,
}).strict();
const revisionSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const updateSchema = z.object({ progress: progressSchema, revision: revisionSchema }).strict();
const resetSchema = z.object({ revision: revisionSchema }).strict();
const maxRequestBytes = 8 * 1024 * 1024;

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

async function readBody(request: IncomingMessage): Promise<unknown> {
  if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
    throw new HttpError(415, 'Send JSON with Content-Type application/json.');
  }
  if (Number(request.headers['content-length']) > maxRequestBytes) throw new HttpError(413, 'Request is too large.');
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    bytes += chunk.length;
    if (bytes > maxRequestBytes) {
      request.resume();
      throw new HttpError(413, 'Request is too large.');
    }
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new HttpError(400, 'Invalid JSON.'); }
}

async function signingSecret(options: AccountServerOptions) {
  const configured = options.secret ?? process.env.BETTER_AUTH_SECRET;
  if (configured) {
    if (configured.length < 32) throw new Error('BETTER_AUTH_SECRET must contain at least 32 characters.');
    return configured;
  }
  if (options.databasePath === ':memory:') throw new Error('In-memory accounts require a secret option or BETTER_AUTH_SECRET.');
  const path = `${options.databasePath}.secret`;
  try {
    await writeFile(path, randomBytes(32).toString('base64url'), { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
  }
  await chmod(path, 0o600);
  const secret = (await readFile(path, 'utf8')).trim();
  if (secret.length < 32) throw new Error('The account signing secret is invalid.');
  return secret;
}

function accountOutput(user: AuthUser): Account {
  return { id: user.id, username: user.displayUsername ?? user.username ?? user.name, role: user.role === 'admin' ? 'admin' : 'learner' };
}

const contentTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.webp': 'image/webp', '.jpg': 'image/jpeg',
};

async function serveStatic(directory: string, pathname: string, request: IncomingMessage, response: ServerResponse) {
  if (request.method !== 'GET' && request.method !== 'HEAD') throw new HttpError(405, 'Method not allowed.');
  let decoded: string;
  try { decoded = decodeURIComponent(pathname); }
  catch { throw new HttpError(400, 'Invalid path.'); }
  if (decoded.includes('\0') || decoded.split('/').some(part => part.startsWith('.') && part !== '')) {
    throw new HttpError(404, 'Not found.');
  }
  const root = await realpath(directory);
  const candidate = resolve(root, `.${decoded === '/' ? '/index.html' : decoded}`);
  if (!candidate.startsWith(root + sep)) throw new HttpError(404, 'Not found.');
  let file: string;
  try { file = await realpath(candidate); }
  catch { throw new HttpError(404, 'Not found.'); }
  if (!file.startsWith(root + sep)) throw new HttpError(404, 'Not found.');
  const info = await stat(file);
  if (!info.isFile()) throw new HttpError(404, 'Not found.');
  response.writeHead(200, {
    'Content-Type': contentTypes[extname(file)] ?? 'application/octet-stream',
    'Content-Length': info.size,
    'Cache-Control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  if (request.method === 'HEAD') response.end();
  else createReadStream(file).on('error', () => response.destroy()).pipe(response);
}

export async function createAccountServer(options: AccountServerOptions) {
  if (options.databasePath !== ':memory:') await mkdir(dirname(resolve(options.databasePath)), { recursive: true, mode: 0o700 });
  const secret = await signingSecret(options);
  const database = new DatabaseSync(options.databasePath);
  if (options.databasePath !== ':memory:') await chmod(options.databasePath, 0o600);
  database.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const configuredOrigin = options.baseURL ? new URL(options.baseURL).origin : undefined;
  const authOptions = {
    appName: 'Atlas Practice',
    database,
    secret,
    baseURL: configuredOrigin ?? { allowedHosts: ['127.0.0.1:*', 'localhost:*', '[::1]:*'], protocol: 'http' },
    basePath: '/internal-auth',
    emailAndPassword: { enabled: true, minPasswordLength: 8, maxPasswordLength: 128, requireEmailVerification: false },
    account: { accountLinking: { enabled: false } },
    session: { expiresIn: 60 * 60 * 24 * 30, cookieCache: { enabled: false } },
    advanced: {
      useSecureCookies: options.secureCookies ?? configuredOrigin?.startsWith('https:') ?? false,
      defaultCookieAttributes: { httpOnly: true, sameSite: 'strict', path: '/' },
      ipAddress: { ipAddressHeaders: ['x-atlas-client-ip'] },
    },
    rateLimit: {
      enabled: true, storage: 'database', window: 60, max: 120,
      customRules: {
        '/sign-in/username': { window: 60, max: 10 },
        '/sign-up/email': { window: 60, max: 10 },
        '/admin/set-user-password': { window: 60, max: 10 },
      },
    },
    plugins: [
      username({ minUsernameLength: 3, maxUsernameLength: 32, usernameValidator: value => /^[A-Za-z0-9_-]+$/.test(value), immutableUsername: true }),
      admin({ defaultRole: 'learner' }),
    ],
  } satisfies BetterAuthOptions;
  try {
    await (await getMigrations(authOptions)).runMigrations();
    database.exec(`
      CREATE TABLE IF NOT EXISTS atlas_first_admin (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1), userId TEXT NOT NULL UNIQUE
      );
      CREATE TABLE IF NOT EXISTS atlas_progress (
        userId TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
        progress TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, resetRevision INTEGER NOT NULL DEFAULT 0
      );
      CREATE TRIGGER IF NOT EXISTS atlas_assign_first_admin AFTER INSERT ON account
      WHEN NEW.providerId = 'credential'
      BEGIN
        INSERT OR IGNORE INTO atlas_first_admin(singleton, userId) VALUES (1, NEW.userId);
        UPDATE user SET role = 'admin' WHERE id = NEW.userId
          AND id = (SELECT userId FROM atlas_first_admin WHERE singleton = 1);
      END;
    `);
  } catch (error) {
    database.close();
    throw error;
  }
  const auth = betterAuth(authOptions);

  const getProgress = database.prepare('SELECT progress, revision, resetRevision FROM atlas_progress WHERE userId = ?');
  const createProgress = database.prepare('INSERT OR IGNORE INTO atlas_progress(userId, progress) VALUES (?, ?)');
  const saveProgress = database.prepare('UPDATE atlas_progress SET progress = ?, revision = ?, resetRevision = ? WHERE userId = ?');
  const selectUser = database.prepare('SELECT id, name, username, displayUsername, role FROM user WHERE id = ?');
  const emptyProgress = JSON.stringify(initialProgress());

  function transact<T>(operation: () => T): T {
    database.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      database.exec('COMMIT');
      return result;
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
  }

  function storedProgress(userId: string): ProgressRow {
    const existing = getProgress.get(userId) as ProgressRow | undefined;
    if (existing) return existing;
    createProgress.run(userId, emptyProgress);
    return getProgress.get(userId) as ProgressRow;
  }

  function resultFor(user: AuthUser) {
    const row = storedProgress(user.id);
    return { account: accountOutput(user), progress: progressSchema.parse(JSON.parse(row.progress)), revision: row.revision };
  }

  function saveMerged(userId: string, incoming: Progress, revision?: number) {
    return transact(() => {
      const row = storedProgress(userId);
      if (revision !== undefined && (revision < row.resetRevision || revision > row.revision)) {
        throw new HttpError(409, 'Progress was reset or replaced. Reload account progress before syncing.');
      }
      const merged = mergeProgress(progressSchema.parse(JSON.parse(row.progress)), incoming);
      const serialized = JSON.stringify(merged);
      if (serialized !== row.progress) saveProgress.run(serialized, row.revision + 1, row.resetRevision, userId);
    });
  }

  // Serialize credential operations, not database transactions: a login using the
  // old password must finish before an admin revokes all sessions after a reset.
  let credentialsReady = Promise.resolve();
  async function credentialOperation<T>(operation: () => Promise<T>) {
    const previous = credentialsReady;
    let release!: () => void;
    credentialsReady = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try { return await operation(); }
    finally { release(); }
  }

  const server = createServer({ requestTimeout: 30_000, headersTimeout: 10_000, maxHeaderSize: 16_384 }, (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'same-origin');
    response.setHeader('X-Frame-Options', 'DENY');
    void handle(request, response).catch(error => {
      if (response.headersSent || response.destroyed) { response.destroy(); return; }
      if (error instanceof HttpError) json(response, error.status, { error: error.message });
      else if (error instanceof z.ZodError) json(response, 400, { error: 'Invalid account or progress data.' });
      else if (error instanceof ProgressConflictError) json(response, 409, { error: 'An attempt ID conflicts with existing history.' });
      else {
        console.error('Account request failed:', error);
        json(response, 500, { error: 'Unable to complete the account request.' });
      }
    });
  });
  server.on('close', () => database.close());

  async function handle(request: IncomingMessage, response: ServerResponse) {
    const address = server.address();
    const localOrigin = address && typeof address !== 'string'
      ? `http://${address.address.includes(':') ? `[${address.address}]` : address.address}:${address.port}` : '';
    const origin = configuredOrigin ?? localOrigin;
    const pathname = new URL(request.url ?? '/', origin).pathname;
    if (!pathname.startsWith('/api/')) {
      if (options.staticDirectory) return serveStatic(options.staticDirectory, pathname, request, response);
      throw new HttpError(404, 'Not found.');
    }
    if (request.method !== 'GET' && request.method !== 'POST') throw new HttpError(405, 'Method not allowed.');
    if (request.method === 'POST') {
      if (request.headers.origin !== origin || request.headers['sec-fetch-site'] === 'cross-site') {
        throw new HttpError(403, 'Account changes require a same-origin request.');
      }
    }
    const headers = new Headers();
    if (request.headers.cookie) headers.set('cookie', request.headers.cookie);
    if (request.headers['user-agent']) headers.set('user-agent', request.headers['user-agent']);
    headers.set('x-atlas-client-ip', request.socket.remoteAddress ?? '127.0.0.1');
    headers.set('origin', origin);

    async function library(path: string, body?: unknown, query = '') {
      const authHeaders = new Headers(headers);
      if (body !== undefined) authHeaders.set('content-type', 'application/json');
      const authResponse = await auth.handler(new Request(`${origin}/internal-auth${path}${query}`, {
        method: body === undefined ? 'GET' : 'POST', headers: authHeaders,
        body: body === undefined ? undefined : JSON.stringify(body),
      }));
      const cookies = authResponse.headers.getSetCookie();
      if (cookies.length) {
        const existing = response.getHeader('Set-Cookie');
        response.setHeader('Set-Cookie', [...(Array.isArray(existing) ? existing : existing ? [String(existing)] : []), ...cookies]);
        // Subsequent library calls in this same request see newly issued cookies.
        headers.set('cookie', cookies.map(cookie => cookie.split(';')[0]).join('; '));
      }
      const retryAfter = authResponse.headers.get('retry-after') ?? authResponse.headers.get('x-retry-after');
      if (retryAfter) response.setHeader('Retry-After', retryAfter);
      const data = await authResponse.json();
      if (!authResponse.ok) {
        const status = data.code === 'USERNAME_IS_ALREADY_TAKEN' ? 409 : authResponse.status;
        throw new HttpError(status, status === 401 ? 'Invalid username or password, or the session has expired.' : data.message ?? 'Account request failed.');
      }
      return data;
    }

    async function sessionUser(required = true): Promise<AuthUser | null> {
      const session = await library('/get-session');
      if (!session) {
        if (required) throw new HttpError(401, 'Sign in to continue.');
        return null;
      }
      // A database trigger grants the first role after the library creates the
      // credential account, so read its authoritative value, not signup output.
      const user = selectUser.get(session.user.id) as AuthUser | undefined;
      if (!user) throw new HttpError(401, 'Sign in to continue.');
      const expectedAccount = request.headers['x-atlas-account-id'];
      const bindingRequired = !['/api/account', '/api/register', '/api/login'].includes(pathname);
      if ((bindingRequired || expectedAccount !== undefined) && expectedAccount !== user.id) {
        throw new HttpError(401, 'The signed-in account changed. Sign in to the account shown in this tab before continuing.');
      }
      return user;
    }

    if (pathname === '/api/account' && request.method === 'GET') {
      const user = await sessionUser(false);
      return json(response, 200, user ? resultFor(user) : { account: null });
    }
    if ((pathname === '/api/register' || pathname === '/api/login') && request.method === 'POST') {
      const body = credentialsSchema.parse(await readBody(request));
      return credentialOperation(async () => {
        if (pathname === '/api/register') {
          await library('/sign-up/email', {
            email: `${randomUUID()}@accounts.invalid`, name: body.username,
            username: body.username, displayUsername: body.username, password: body.password,
          });
        } else await library('/sign-in/username', { username: body.username, password: body.password });
        const user = (await sessionUser())!;
        saveMerged(user.id, body.progress);
        return json(response, pathname === '/api/register' ? 201 : 200, resultFor(user));
      });
    }
    if (pathname === '/api/logout' && request.method === 'POST') {
      z.object({}).strict().parse(await readBody(request));
      await sessionUser();
      await library('/sign-out', {});
      return json(response, 200, { account: null });
    }
    if (pathname === '/api/progress' && request.method === 'POST') {
      const body = updateSchema.parse(await readBody(request));
      const user = (await sessionUser())!;
      saveMerged(user.id, body.progress, body.revision);
      return json(response, 200, resultFor(user));
    }
    if (pathname === '/api/progress/reset' && request.method === 'POST') {
      const body = resetSchema.parse(await readBody(request));
      const user = (await sessionUser())!;
      transact(() => {
        const row = storedProgress(user.id);
        if (body.revision !== row.revision) throw new HttpError(409, 'Progress changed. Reload it before confirming a reset.');
        saveProgress.run(emptyProgress, row.revision + 1, row.revision + 1, user.id);
      });
      return json(response, 200, resultFor(user));
    }
    if (pathname === '/api/users' && request.method === 'GET') {
      await sessionUser();
      const users: Account[] = [];
      let total: number;
      do {
        const page = await library('/admin/list-users', undefined, `?limit=100&offset=${users.length}&sortBy=createdAt&sortDirection=asc`);
        total = page.total;
        users.push(...page.users.map(accountOutput));
      } while (users.length < total);
      return json(response, 200, users);
    }
    const passwordPath = /^\/api\/users\/([^/]+)\/password$/.exec(pathname);
    if (passwordPath && request.method === 'POST') {
      const body = z.object({ password: passwordSchema }).strict().parse(await readBody(request));
      return credentialOperation(async () => {
        await sessionUser();
        await library('/admin/set-user-password', { userId: passwordPath[1], newPassword: body.password });
        await library('/admin/revoke-user-sessions', { userId: passwordPath[1] });
        return json(response, 200, { success: true });
      });
    }
    throw new HttpError(404, 'Not found.');
  }
  return server;
}
