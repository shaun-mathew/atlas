import { expect, test as base } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAccountServer } from '../server/accounts';
import type { Attempt } from '../src/progress';

const emptyProgress = {
  version: 6, selection: null, readingCountryId: null, pausedQuestions: [],
  started: false, cursor: 0, attempts: [],
  current: { countryId: 'BRA', kind: 'new', assisted: false },
};

function progressWith(attempts: Attempt[]) {
  return { ...emptyProgress, started: true, current: null, cursor: attempts.length, attempts };
}

function answer(id: string, fields: Partial<Attempt> = {}): Attempt {
  return {
    id, countryId: 'BRA', skill: 'name-to-location', kind: 'new',
    boundaryVersion: 'natural-earth-5.1.2-50m', factVersion: '2026-09-07',
    longitude: -52, latitude: -10, correct: true, assisted: false,
    selectedCountry: 'Brazil', answeredAt: '2026-09-07T12:00:00.000Z', ...fields,
  };
}

class AccountClient {
  cookie = '';
  accountId = '';

  constructor(private readonly origin: () => string) {}

  async request(path: string, body?: unknown, headers: Record<string, string> = {}) {
    const response = await fetch(`${this.origin()}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        ...(this.cookie ? { Cookie: this.cookie } : {}),
        ...(this.accountId ? { 'X-Atlas-Account-Id': this.accountId } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: this.origin() }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const cookie = response.headers.get('set-cookie');
    if (cookie) this.cookie = cookie.split(';')[0];
    const data = await response.json();
    if (response.ok && data.account) this.accountId = data.account.id;
    return { status: response.status, body: data, headers: response.headers };
  }

  register(username: string, password = 'correct horse battery') {
    return this.request('/api/register', { username, password, progress: emptyProgress });
  }
}

type AccountFixture = {
  client: () => AccountClient;
  reopen: () => Promise<void>;
};

const test = base.extend<{ accounts: AccountFixture }>({
  accounts: async ({}, use) => {
    const directory = await mkdtemp(join(tmpdir(), 'atlas-accounts-'));
    const databasePath = join(directory, 'accounts.sqlite');
    let server: Server;
    let origin = '';
    const start = async () => {
      server = await createAccountServer({ databasePath });
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    };
    const close = () => new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeIdleConnections();
    });
    try {
      await start();
      await use({ client: () => new AccountClient(() => origin), reopen: async () => { await close(); await start(); } });
    } finally {
      if (server!) await close();
      await rm(directory, { recursive: true, force: true });
    }
  },
});

test('the first username account is admin and can sign back in without email', async ({ accounts }) => {
  const first = accounts.client();
  expect((await first.request('/api/account')).body.account).toBeNull();
  const registered = await first.register('FirstLearner');
  expect(registered.status).toBe(201);
  expect(registered.body.account).toMatchObject({ username: 'FirstLearner', role: 'admin' });
  expect(registered.headers.get('set-cookie')).toMatch(/HttpOnly/i);
  expect(registered.headers.get('set-cookie')).toMatch(/SameSite=Strict/i);
  expect((await first.request('/api/account')).body.account.id).toBe(registered.body.account.id);
  expect((await first.request('/api/logout', {})).status).toBe(200);
  expect((await first.request('/api/account')).body.account).toBeNull();
  expect((await first.request('/api/login', {
    username: 'FirstLearner', password: 'incorrect password', progress: emptyProgress,
  })).status).toBe(401);
  const signedIn = await first.request('/api/login', {
    username: 'firstlearner', password: 'correct horse battery', progress: emptyProgress,
  });
  expect(signedIn.status).toBe(200);
  expect(signedIn.body.account).toEqual(registered.body.account);
  const second = await accounts.client().register('SecondLearner');
  expect(second.status).toBe(201);
  expect(second.body.account.role).toBe('learner');
  const users = await first.request('/api/users');
  expect(users.status).toBe(200);
  expect(users.body).toEqual(expect.arrayContaining([registered.body.account, second.body.account]));
});

test('concurrent registrations grant exactly one account administrator permissions', async ({ accounts }) => {
  const clients = Array.from({ length: 6 }, () => accounts.client());
  const registered = await Promise.all(clients.map((client, index) => client.register(`Concurrent${index}`)));
  expect(registered.map(result => result.status)).toEqual([201, 201, 201, 201, 201, 201]);
  expect(registered.map(result => result.body.account.role).sort()).toEqual(['admin', 'learner', 'learner', 'learner', 'learner', 'learner']);
  for (const [index, client] of clients.entries()) {
    const users = await client.request('/api/users');
    expect(users.status).toBe(registered[index].body.account.role === 'admin' ? 200 : 403);
  }
});

test('guests and learners cannot list users or reset other account passwords', async ({ accounts }) => {
  const guest = accounts.client();
  const administrator = await accounts.client().register('Administrator');
  const learner = accounts.client();
  const registered = await learner.register('Learner');
  expect((await guest.request('/api/users')).status).toBe(401);
  expect((await guest.request('/api/progress/reset', { revision: 0 })).status).toBe(401);
  expect((await guest.request(`/api/users/${registered.body.account.id}/password`, { password: 'replacement password' })).status).toBe(401);
  expect((await learner.request('/api/users')).status).toBe(403);
  expect((await learner.request(`/api/users/${administrator.body.account.id}/password`, { password: 'replacement password' })).status).toBe(403);
  expect((await learner.request(`/api/users/${registered.body.account.id}/password`, { password: 'replacement password' })).status).toBe(403);
  const signedIn = await accounts.client().request('/api/login', {
    username: 'Administrator', password: 'correct horse battery', progress: emptyProgress,
  });
  expect(signedIn.status).toBe(200);
});

test('an administrator password reset revokes every target session without losing learning', async ({ accounts }) => {
  const administrator = accounts.client();
  await administrator.register('Administrator');
  const learner = accounts.client();
  const registered = await learner.request('/api/register', {
    username: 'Learner', password: 'correct horse battery', progress: progressWith([answer('kept-answer')]),
  });
  expect(registered.status).toBe(201);
  const otherDevice = accounts.client();
  expect((await otherDevice.request('/api/login', {
    username: 'Learner', password: 'correct horse battery', progress: emptyProgress,
  })).status).toBe(200);
  const oldCookie = learner.cookie;
  expect((await administrator.request(`/api/users/${registered.body.account.id}/password`, {
    password: 'new correct horse battery',
  })).status).toBe(200);
  expect((await learner.request('/api/account')).body.account).toBeNull();
  expect((await otherDevice.request('/api/account')).body.account).toBeNull();
  learner.cookie = oldCookie;
  expect((await learner.request('/api/progress', { progress: emptyProgress, revision: registered.body.revision })).status).toBe(401);
  expect((await accounts.client().request('/api/login', {
    username: 'Learner', password: 'correct horse battery', progress: emptyProgress,
  })).status).toBe(401);
  const signedIn = await accounts.client().request('/api/login', {
    username: 'Learner', password: 'new correct horse battery', progress: emptyProgress,
  });
  expect(signedIn.status).toBe(200);
  expect(signedIn.body.progress.attempts.map((attempt: Attempt) => attempt.id)).toEqual(['kept-answer']);
  expect((await administrator.request('/api/users')).status).toBe(200);
});

test('session cookies and merged learning survive closing and reopening the database', async ({ accounts }) => {
  const first = accounts.client();
  const registered = await first.request('/api/register', {
    username: 'ReturningLearner', password: 'correct horse battery',
    progress: progressWith([answer('before-restart')]),
  });
  expect(registered.status).toBe(201);
  const resumed = accounts.client();
  resumed.cookie = first.cookie;
  expect((await resumed.request('/api/account')).body.progress.attempts.map((attempt: Attempt) => attempt.id)).toEqual(['before-restart']);
  await accounts.reopen();
  const restored = await resumed.request('/api/account');
  expect(restored.status).toBe(200);
  expect(restored.body.account).toEqual(registered.body.account);
  expect(restored.body.progress.attempts.map((attempt: Attempt) => attempt.id)).toEqual(['before-restart']);
  const freshDevice = await accounts.client().request('/api/login', {
    username: 'ReturningLearner', password: 'correct horse battery',
    progress: progressWith([answer('after-restart', { countryId: 'CHN', answeredAt: '2026-09-08T12:00:00.000Z' })]),
  });
  expect(freshDevice.status).toBe(200);
  expect(freshDevice.body.progress.attempts.map((attempt: Attempt) => attempt.id)).toEqual(['before-restart', 'after-restart']);
  expect((await accounts.client().register('NextLearner')).body.account.role).toBe('learner');
});

test('concurrent stale saves union attempt histories and repeated uploads are idempotent', async ({ accounts }) => {
  const first = accounts.client();
  const registered = await first.register('ConcurrentLearner');
  const second = accounts.client();
  await second.request('/api/login', {
    username: 'ConcurrentLearner', password: 'correct horse battery', progress: emptyProgress,
  });
  const left = progressWith([answer('shared'), answer('left', { countryId: 'CHN', answeredAt: '2026-09-08T12:00:00.000Z' })]);
  const right = progressWith([answer('shared'), answer('right', { countryId: 'ALD', answeredAt: '2026-09-08T12:00:00.000Z' })]);
  const saves = await Promise.all([
    first.request('/api/progress', { progress: left, revision: registered.body.revision }),
    second.request('/api/progress', { progress: right, revision: registered.body.revision }),
  ]);
  expect(saves.map(result => result.status)).toEqual([200, 200]);
  const union = await first.request('/api/account');
  expect(union.body.progress.attempts.map((attempt: Attempt) => attempt.id)).toEqual(['shared', 'left', 'right']);
  const repeated = await second.request('/api/progress', { progress: right, revision: registered.body.revision });
  expect(repeated.status).toBe(200);
  expect(repeated.body.progress.attempts).toEqual(union.body.progress.attempts);
  expect(repeated.body.revision).toBe(union.body.revision);
});

test('guest attachment preserves distinct entities skills versions retries and identical repeated answers', async ({ accounts }) => {
  const original = accounts.client();
  await original.request('/api/register', {
    username: 'DistinctLearner', password: 'correct horse battery', progress: progressWith([answer('account-answer')]),
  });
  const history = [
    answer('guest-answer'), answer('other-entity', { countryId: 'CHN' }),
    answer('other-skill', { skill: 'location-to-name' }), answer('old-fact', { factVersion: '2025-01-01' }),
    answer('old-boundary', { boundaryVersion: 'older-boundaries' }), answer('future-entity', { countryId: 'future-city' }),
    answer('practice', { kind: 'practice', assisted: true }), answer('retry', { kind: 'retry', correct: false }),
  ];
  const attached = await accounts.client().request('/api/login', {
    username: 'DistinctLearner', password: 'correct horse battery', progress: progressWith(history),
  });
  expect(attached.status).toBe(200);
  expect(attached.body.progress.attempts).toEqual(expect.arrayContaining([answer('account-answer'), ...history]));
  expect(attached.body.progress.attempts).toHaveLength(9);
  const resumed = await original.request('/api/account');
  expect(resumed.body.progress.attempts).toEqual(attached.body.progress.attempts);
});

test('conflicting attempt IDs reject the whole upload rather than overwrite or partly append', async ({ accounts }) => {
  const learner = accounts.client();
  const registered = await learner.request('/api/register', {
    username: 'ConflictLearner', password: 'correct horse battery', progress: progressWith([answer('stable')]),
  });
  const rejected = await learner.request('/api/progress', {
    revision: registered.body.revision,
    progress: progressWith([answer('new-attempt'), answer('stable', { correct: false })]),
  });
  expect(rejected.status).toBe(409);
  const resumed = await learner.request('/api/account');
  expect(resumed.body.progress.attempts).toEqual([answer('stable')]);
  expect(resumed.body.revision).toBe(registered.body.revision);
});

test('an explicit reset rejects stale writes and stale confirmations across database restarts', async ({ accounts }) => {
  const learner = accounts.client();
  const registered = await learner.register('ResetLearner');
  const updated = await learner.request('/api/progress', {
    revision: registered.body.revision, progress: progressWith([answer('before-reset')]),
  });
  expect((await learner.request('/api/progress/reset', { revision: registered.body.revision })).status).toBe(409);
  expect((await learner.request('/api/account')).body.progress.attempts).toEqual([answer('before-reset')]);
  const reset = await learner.request('/api/progress/reset', { revision: updated.body.revision });
  expect(reset.status).toBe(200);
  expect(reset.body.progress.attempts).toEqual([]);
  await accounts.reopen();
  const stale = await learner.request('/api/progress', { revision: updated.body.revision, progress: updated.body.progress });
  expect(stale.status).toBe(409);
  expect((await learner.request('/api/account')).body.progress.attempts).toEqual([]);
  const fresh = await learner.request('/api/progress', { revision: reset.body.revision, progress: progressWith([answer('after-reset')]) });
  expect(fresh.status).toBe(200);
  expect(fresh.body.progress.attempts).toEqual([answer('after-reset')]);
});

test('cross-origin mutations and unexposed authentication routes cannot bypass account policy', async ({ accounts }) => {
  const learner = accounts.client();
  const invalid = await learner.request('/api/register', {
    username: 'CrossOrigin', password: 'correct horse battery', progress: emptyProgress,
  }, { Origin: 'https://attacker.example' });
  expect(invalid.status).toBe(403);
  expect((await learner.request('/api/register', {
    username: 'NoOrigin', password: 'correct horse battery', progress: emptyProgress,
  }, { Origin: '' })).status).toBe(403);
  expect((await learner.request('/api/auth/sign-up/email', {
    name: 'Bypass', email: 'someone@example.com', password: 'correct horse battery',
  })).status).toBe(404);
  const registered = await learner.register('ActualFirst');
  expect(registered.body.account.role).toBe('admin');
  expect(Object.keys(registered.body.account).sort()).toEqual(['id', 'role', 'username']);
  expect((await learner.request('/api/progress/reset', { revision: registered.body.revision }, { Origin: 'https://attacker.example' })).status).toBe(403);
  expect((await learner.request('/api/account')).body.account.id).toBe(registered.body.account.id);
});

test('invalid and oversized requests do not create accounts or accept forged roles', async ({ accounts }) => {
  const client = accounts.client();
  expect((await client.request('/api/register', {
    username: 'valid', password: 'short', progress: emptyProgress,
  })).status).toBe(400);
  expect((await client.request('/api/register', {
    username: 'not an email@example.com', password: 'correct horse battery', progress: emptyProgress,
  })).status).toBe(400);
  expect((await client.request('/api/register', {
    username: 'valid', password: 'correct horse battery', progress: emptyProgress, role: 'admin',
  })).status).toBe(400);
  expect((await client.request('/api/register', {
    username: 'oversized', password: 'x'.repeat(8 * 1024 * 1024), progress: emptyProgress,
  })).status).toBe(413);
  const registered = await client.register('Valid');
  expect(registered.status).toBe(201);
  expect(registered.body.account.role).toBe('admin');
  expect((await accounts.client().register('VALID')).status).toBe(409);
});

test('failed sign-ins are rate limited even across database reopening and spoofed proxy headers', async ({ accounts }) => {
  const client = accounts.client();
  await client.register('LimitedLearner');
  for (let index = 0; index < 10; index++) {
    expect((await client.request('/api/login', {
      username: 'LimitedLearner', password: 'incorrect password', progress: emptyProgress,
    }, { 'X-Forwarded-For': `203.0.113.${index + 1}` })).status).toBe(401);
  }
  await accounts.reopen();
  const limited = await client.request('/api/login', {
    username: 'LimitedLearner', password: 'correct horse battery', progress: emptyProgress,
  });
  expect(limited.status).toBe(429);
  expect(limited.headers.get('retry-after')).not.toBeNull();
});

test('a stale tab cannot save reset or sign out a different account', async ({ accounts }) => {
  const first = await accounts.client().register('FirstAccount');
  const secondClient = accounts.client();
  const second = await secondClient.register('SecondAccount');
  const staleIdentity = { 'X-Atlas-Account-Id': first.body.account.id };
  const upload = await secondClient.request('/api/progress', {
    revision: second.body.revision, progress: progressWith([answer('private-first-account')]),
  }, staleIdentity);
  expect(upload.status).toBe(401);
  expect((await secondClient.request('/api/progress/reset', { revision: second.body.revision }, staleIdentity)).status).toBe(401);
  expect((await secondClient.request('/api/logout', {}, staleIdentity)).status).toBe(401);
  const current = await secondClient.request('/api/account');
  expect(current.body.account.id).toBe(second.body.account.id);
  expect(current.body.progress.attempts).toEqual([]);
});
