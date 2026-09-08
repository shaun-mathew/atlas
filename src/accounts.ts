import { z } from 'zod';
import { LearnerSession } from './session';
import { initialProgress, mergeProgress, progressSchema } from './progress';

const accountSchema = z.object({ id: z.string(), username: z.string(), role: z.enum(['admin', 'learner']) });
const responseSchema = z.object({ account: accountSchema, revision: z.number().int().nonnegative(), progress: progressSchema });
type Account = z.infer<typeof accountSchema>;
type AccountState = z.infer<typeof responseSchema>;
const activeKey = 'atlas-practice.account';
const progressKey = (id: string) => `atlas-practice.account.${id}`;

class AccountError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

async function accountRequest(path: string, body?: unknown, expectedAccount?: string): Promise<unknown> {
  const response = await fetch(`/api/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'same-origin',
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(expectedAccount ? { 'X-Atlas-Account-Id': expectedAccount } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json();
  if (!response.ok) throw new AccountError(data.error ?? 'Account request failed.', response.status);
  return data;
}

export class Accounts {
  session = new LearnerSession();
  account: Account | null = null;
  status = '';
  conflict = false;
  needsSignIn = false;
  onchange?: (sessionChanged: boolean) => void;
  private revision = 0;
  private dirty = false;
  private saving?: Promise<void>;
  private locallySaved = true;

  async initialize() {
    let cached: AccountState | undefined;
    try {
      const activeId = localStorage.getItem(activeKey);
      const raw = activeId ? localStorage.getItem(progressKey(activeId)) : null;
      if (raw) {
        const saved = responseSchema.parse(JSON.parse(raw));
        if (saved.account.id === activeId) cached = saved;
      }
    } catch { /* Guest practice remains available when browser storage is unavailable. */ }
    if (cached) {
      this.account = cached.account;
      this.revision = cached.revision;
      this.session = new LearnerSession(null, cached.progress);
      this.dirty = true;
    }
    try {
      const data = await accountRequest('account', undefined, this.account?.id);
      if (z.object({ account: z.null() }).safeParse(data).success) {
        if (this.account) {
          this.needsSignIn = true;
          this.status = 'Session expired. Sign in again to sync. Account progress is kept in this browser.';
        }
      } else {
        const remote = responseSchema.parse(data);
        if (cached?.account.id === remote.account.id) {
          // The saved revision travels with offline changes; never rebase it past a remote reset.
          this.dirty = true;
          this.watchSession();
          await this.sync();
        } else {
          this.accept(remote);
        }
      }
    } catch (error) {
      this.needsSignIn = error instanceof AccountError && error.status === 401;
      this.status = this.needsSignIn ? 'The signed-in account changed. Sign in again; local account progress is kept.'
        : this.account ? 'Account service unavailable. Progress is saved in this browser until you can sync.'
          : 'Account service unavailable. You can still practice as a guest.';
    }
    this.watchSession();
  }

  private remember(activate = false) {
    if (!this.account) return;
    try {
      // The revision belongs to this exact snapshot. Another tab must not pair
      // stale answers with a newer revision and bypass the server's reset barrier.
      localStorage.setItem(progressKey(this.account.id), JSON.stringify({
        account: this.account, revision: this.revision, progress: this.session.snapshot(),
      }));
      if (activate) localStorage.setItem(activeKey, this.account.id);
      this.locallySaved = true;
    } catch {
      this.locallySaved = false;
      this.status = this.dirty ? 'Browser storage is unavailable. Keep this page open until progress syncs.'
        : 'Progress synced, but browser storage is unavailable. New offline progress cannot be retained.';
    }
  }

  private watchSession() {
    this.session.onchange = () => {
      if (!this.account) return;
      this.dirty = true;
      this.status = 'Saving progress…';
      this.remember();
      this.onchange?.(false);
      void this.sync();
    };
  }

  private accept(remote: AccountState) {
    if (this.account && remote.account.id !== this.account.id) throw new AccountError('The signed-in account changed.', 401);
    this.session.onchange = undefined;
    this.account = remote.account;
    this.revision = remote.revision;
    this.session = new LearnerSession(null, remote.progress);
    this.dirty = false;
    this.conflict = false;
    this.needsSignIn = false;
    this.status = 'Progress synced';
    this.remember(true);
    this.watchSession();
    this.onchange?.(true);
  }

  async authenticate(action: 'register' | 'login', username: string, password: string) {
    if (this.account && username.trim().toLowerCase() !== this.account.username.toLowerCase()) {
      throw new Error('Sign out before switching accounts. Your current account progress will not be transferred.');
    }
    const guest = !this.account;
    const snapshot = this.session.snapshot();
    const remote = responseSchema.parse(await accountRequest(action, {
      username, password, progress: guest ? snapshot : initialProgress(),
    }));
    if (guest) {
      const latest = this.session.snapshot();
      const changed = JSON.stringify(latest) !== JSON.stringify(snapshot);
      this.accept({ ...remote, progress: mergeProgress(remote.progress, latest) });
      if (changed) await this.sync();
      // Keep the guest copy if answers made during sign-in have not reached the server.
      if (!this.dirty) {
        try { localStorage.removeItem('atlas-practice.guest'); }
        catch { this.status = 'Progress synced. The guest copy could not be removed from browser storage.'; }
      }
    } else {
      this.needsSignIn = false;
      this.dirty = true;
      await this.sync();
    }
    this.onchange?.(false);
  }

  sync(): Promise<void> {
    if (this.saving) return this.saving;
    if (!this.account || this.needsSignIn || this.conflict) return Promise.resolve();
    this.dirty = true;
    this.saving = this.savePending().finally(() => { this.saving = undefined; });
    return this.saving;
  }

  private async savePending() {
    while (this.dirty && this.account) {
      this.dirty = false;
      const sent = this.session.snapshot();
      try {
        const remote = responseSchema.parse(await accountRequest('progress', { progress: sent, revision: this.revision }, this.account.id));
        if (remote.account.id !== this.account.id) throw new AccountError('The signed-in account changed.', 401);
        this.revision = remote.revision;
        const local = this.session.snapshot();
        const merged = mergeProgress(remote.progress, local);
        if (JSON.stringify(merged) !== JSON.stringify(local)) {
          this.session.onchange = undefined;
          this.session.replace(merged);
          this.watchSession();
          this.onchange?.(true);
        }
        this.status = this.dirty ? 'Saving progress…' : 'Progress synced';
        this.remember();
      } catch (error) {
        this.dirty = true;
        this.needsSignIn = error instanceof AccountError && error.status === 401;
        this.conflict = error instanceof AccountError && error.status === 409;
        this.status = this.needsSignIn ? 'Session expired. Sign in again to sync. Local account progress is kept.'
          : this.conflict ? 'Account progress changed or was reset on another device. Local progress is kept; discard local changes to load the account state.'
          : 'Sync failed. Progress is kept in this browser. Try syncing again when connected.';
        if (!this.locallySaved) this.status += ' Browser storage is unavailable; keep this page open because new answers are not saved.';
        this.onchange?.(false);
        return;
      }
      this.onchange?.(false);
    }
  }

  async discardLocalChanges() {
    const remote = responseSchema.parse(await accountRequest('account', undefined, this.account?.id));
    if (remote.account.id !== this.account?.id) throw new Error('Sign in to this account first.');
    this.accept(remote);
  }

  async logout() {
    await this.sync();
    if (this.dirty) throw new Error('Sign in and sync, or resolve local changes, before signing out. Your progress has been kept.');
    await accountRequest('logout', {}, this.account?.id);
    this.session.onchange = undefined;
    this.account = null;
    this.needsSignIn = false;
    this.conflict = false;
    this.dirty = false;
    this.status = '';
    try { localStorage.removeItem(activeKey); } catch { /* Server session is already revoked. */ }
    this.session = new LearnerSession();
    this.watchSession();
    this.onchange?.(true);
  }

  async resetProgress(): Promise<boolean> {
    if (!this.account) return this.session.reset();
    await this.sync();
    if (this.dirty) throw new Error(this.status);
    this.accept(responseSchema.parse(await accountRequest('progress/reset', { revision: this.revision }, this.account.id)));
    return true;
  }

  async users(): Promise<Account[]> {
    return z.array(accountSchema).parse(await accountRequest('users', undefined, this.account?.id));
  }

  async resetPassword(id: string, password: string) {
    await accountRequest(`users/${encodeURIComponent(id)}/password`, { password }, this.account?.id);
    if (id === this.account?.id) {
      this.needsSignIn = true;
      this.status = 'Password reset. Sign in with your new password.';
      this.onchange?.(false);
    }
  }
}
