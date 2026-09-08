import type { Accounts } from './accounts';

export function createAccountProfile(accounts: Accounts) {
  const profile = document.querySelector<HTMLDialogElement>('#profile-dialog')!;
  const controls = document.createElement('section');
  controls.className = 'account-controls';
  controls.innerHTML = `
    <form id="account-form">
      <p id="account-form-description"></p>
      <label for="account-username">Username</label>
      <input id="account-username" name="username" autocomplete="username" required minlength="3" maxlength="32" pattern="[A-Za-z0-9_-]+" aria-describedby="username-help">
      <small id="username-help">3–32 letters, numbers, underscores or hyphens.</small>
      <label for="account-password">Password</label>
      <input id="account-password" name="password" type="password" autocomplete="current-password" required minlength="8" maxlength="128">
      <div class="profile-actions">
        <button class="primary" type="submit" value="login">Sign in</button>
        <button class="secondary" type="submit" value="register" id="create-account">Create account</button>
      </div>
    </form>
    <div id="account-actions" class="profile-actions" hidden>
      <button id="sync-account" class="secondary" type="button">Sync now</button>
      <button id="sign-out" class="secondary" type="button">Sign out</button>
    </div>
    <p id="account-status" role="status"></p>
    <button id="discard-local" class="secondary danger" type="button" hidden>Discard local changes</button>
    <section id="discard-confirmation" hidden>
      <p>Discard unsynced changes in this browser and load the account's saved progress? This cannot be undone.</p>
      <button id="cancel-discard" class="secondary" type="button">Keep local changes</button>
      <button id="confirm-discard" class="secondary danger" type="button">Load account progress</button>
    </section>
    <section id="admin-accounts" aria-labelledby="admin-title" hidden>
      <h3 id="admin-title">Account administration</h3>
      <p>The first account is the administrator. Resetting a password signs that learner out on every device.</p>
      <button id="load-users" class="secondary" type="button">Manage user passwords</button>
      <form id="password-reset-form" hidden>
        <label for="reset-user">Account to reset</label>
        <select id="reset-user" required></select>
        <label for="new-password">New password</label>
        <input id="new-password" type="password" autocomplete="new-password" required minlength="8" maxlength="128">
        <button class="secondary danger" type="submit">Reset password</button>
      </form>
      <p id="password-reset-status" role="status" hidden></p>
    </section>
    <p id="account-error" role="alert" hidden></p>`;
  document.querySelector('#profile-progress')!.after(controls);
  const form = controls.querySelector<HTMLFormElement>('#account-form')!;
  const username = controls.querySelector<HTMLInputElement>('#account-username')!;
  const password = controls.querySelector<HTMLInputElement>('#account-password')!;
  const error = controls.querySelector<HTMLElement>('#account-error')!;
  const resetForm = controls.querySelector<HTMLFormElement>('#password-reset-form')!;
  const resetUser = controls.querySelector<HTMLSelectElement>('#reset-user')!;
  const newPassword = controls.querySelector<HTMLInputElement>('#new-password')!;
  const resetStatus = controls.querySelector<HTMLElement>('#password-reset-status')!;
  const discardConfirmation = controls.querySelector<HTMLElement>('#discard-confirmation')!;

  function render() {
    const account = accounts.account;
    document.querySelector('#profile-identity')!.textContent = account ? `${account.username}${account.role === 'admin' ? ' · Administrator' : ''}` : 'Guest profile';
    document.querySelector('#profile-description')!.textContent = account
      ? accounts.needsSignIn ? `Session expired for ${account.username}. Sign in to resume synchronization.`
        : `Signed in as ${account.username}. Progress syncs across your devices.`
      : 'Not signed in. Learning progress stays in this browser until you connect an account.';
    document.querySelector('#profile-progress')!.textContent = `${accounts.session.attempts.length} answers in this ${account ? 'account' : 'guest profile'}.`;
    form.hidden = !!account && !accounts.needsSignIn;
    controls.querySelector('#account-form-description')!.textContent = account
      ? 'Sign in again to sync the account progress saved in this browser.'
      : 'Create an account or sign in to merge this guest profile with your saved learning. No email needed.';
    controls.querySelector<HTMLElement>('#create-account')!.hidden = !!account;
    controls.querySelector<HTMLElement>('#account-actions')!.hidden = !account;
    controls.querySelector<HTMLElement>('#admin-accounts')!.hidden = account?.role !== 'admin' || accounts.needsSignIn;
    controls.querySelector('#account-status')!.textContent = accounts.status;
    controls.querySelector<HTMLElement>('#discard-local')!.hidden = !accounts.conflict;
    document.querySelector('#reset-description')!.textContent = account
      ? 'This permanently deletes your answers, proficiency, and scheduled reviews from this account on all devices. It cannot be undone.'
      : 'This permanently deletes your answers, proficiency, and scheduled reviews in this browser. It cannot be undone.';
    document.querySelector('#open-profile')!.setAttribute('title', account ? `${account.username} · Profile` : 'Guest profile');
    document.querySelector('.local-note')!.textContent = account ? 'Your progress syncs with your account.' : 'Your progress stays in this browser.';
    if (account) username.value = account.username;
  }

  async function perform(action: () => Promise<unknown>) {
    error.hidden = true;
    const buttons = Array.from(controls.querySelectorAll<HTMLButtonElement>('button'));
    buttons.forEach(button => { button.disabled = true; });
    try { await action(); }
    catch (failure) {
      error.textContent = failure instanceof Error ? failure.message : 'Account operation failed. Your progress has been kept.';
      error.hidden = false;
    } finally {
      buttons.forEach(button => { button.disabled = false; });
      render();
    }
  }

  form.addEventListener('submit', event => {
    event.preventDefault();
    const action = event.submitter instanceof HTMLButtonElement && event.submitter.value === 'register' ? 'register' : 'login';
    void perform(async () => {
      await accounts.authenticate(action, username.value, password.value);
      password.value = '';
    });
  });
  controls.querySelector('#sync-account')!.addEventListener('click', () => { void perform(() => accounts.sync()); });
  controls.querySelector('#sign-out')!.addEventListener('click', () => { void perform(() => accounts.logout()); });
  controls.querySelector('#discard-local')!.addEventListener('click', () => { discardConfirmation.hidden = false; });
  controls.querySelector('#cancel-discard')!.addEventListener('click', () => { discardConfirmation.hidden = true; });
  controls.querySelector('#confirm-discard')!.addEventListener('click', () => {
    void perform(async () => { await accounts.discardLocalChanges(); discardConfirmation.hidden = true; });
  });
  controls.querySelector('#load-users')!.addEventListener('click', () => {
    void perform(async () => {
      const users = await accounts.users();
      resetUser.replaceChildren(...users.map(user => new Option(user.username, user.id)));
      resetForm.hidden = false;
    });
  });
  resetForm.addEventListener('submit', event => {
    event.preventDefault();
    void perform(async () => {
      await accounts.resetPassword(resetUser.value, newPassword.value);
      newPassword.value = '';
      resetStatus.textContent = 'Password reset. Share the new password with the learner securely.';
      resetStatus.hidden = false;
    });
  });
  profile.addEventListener('close', () => {
    password.value = '';
    newPassword.value = '';
    error.hidden = true;
    resetStatus.hidden = true;
    resetForm.hidden = true;
    discardConfirmation.hidden = true;
  });
  render();
  return render;
}
