// Login view: username/password form, show-hide toggle, error states,
// and the forced password-change screen for first logins.

import { t } from '../i18n.js';
import { login, changeOwnPassword, getSession } from '../auth.js';

function routeAfterLogin(session) {
  window.location.hash = session.role === 'owner' ? '#/dashboard' : '#/worker';
}

export function render(container) {
  renderLoginForm(container, {});
}

function renderLoginForm(container, { error = '', busy = false, username = '' }) {
  container.innerHTML = `
    <div class="max-w-md mx-auto mt-8">
      <div class="bg-white rounded-2xl shadow-lg border-2 border-farm-green/20 p-6">
        <h2 class="text-2xl font-bold text-farm-green mb-1">${t('auth.welcome')}</h2>
        <p class="text-sm text-stone-600 mb-6">${t('auth.welcomeSub')}</p>

        ${error ? `
          <div role="alert" class="mb-4 bg-red-50 border-2 border-farm-urgent text-farm-urgent rounded-lg px-4 py-3 font-semibold">
            ${error}
          </div>` : ''}

        <form id="login-form" class="space-y-4">
          <div>
            <label for="login-username" class="block font-semibold mb-1">${t('auth.username')}</label>
            <input id="login-username" name="username" type="text" autocomplete="username"
                   required value="${username}"
                   class="w-full rounded-lg border-2 border-stone-300 px-3 py-2 focus:border-farm-greenLight" />
          </div>
          <div>
            <label for="login-password" class="block font-semibold mb-1">${t('auth.password')}</label>
            <div class="relative">
              <input id="login-password" name="password" type="password" autocomplete="current-password"
                     required
                     class="w-full rounded-lg border-2 border-stone-300 px-3 py-2 pr-20 focus:border-farm-greenLight" />
              <button type="button" id="toggle-password"
                      class="absolute right-1 top-1/2 -translate-y-1/2 min-h-[36px] px-3 text-sm font-bold text-farm-green">
                ${t('auth.show')}
              </button>
            </div>
          </div>
          <button type="submit" ${busy ? 'disabled' : ''}
                  class="w-full bg-farm-green text-white font-bold rounded-lg py-3 ${busy ? 'opacity-60' : 'hover:bg-farm-greenLight'} transition-colors">
            ${busy ? t('auth.loggingIn') : t('auth.login')}
          </button>
        </form>
      </div>
    </div>
  `;

  const pwInput = container.querySelector('#login-password');
  const toggleBtn = container.querySelector('#toggle-password');
  toggleBtn.addEventListener('click', () => {
    const showing = pwInput.type === 'text';
    pwInput.type = showing ? 'password' : 'text';
    toggleBtn.textContent = showing ? t('auth.show') : t('auth.hide');
  });

  container.querySelector('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const usernameVal = container.querySelector('#login-username').value;
    const passwordVal = pwInput.value;
    renderLoginForm(container, { busy: true, username: usernameVal });
    try {
      const session = await login(usernameVal, passwordVal);
      if (session.mustChangePassword) {
        renderForceChangePassword(container, passwordVal);
      } else {
        routeAfterLogin(session);
      }
    } catch (err) {
      const msg =
        err.code === 'network' ? t('errors.network')
        : err.code === 'account_inactive' ? t('errors.unauthorized')
        : t('auth.loginError');
      renderLoginForm(container, { error: msg, username: usernameVal });
    }
  });
}

function renderForceChangePassword(container, currentPassword, { error = '' } = {}) {
  container.innerHTML = `
    <div class="max-w-md mx-auto mt-8">
      <div class="bg-white rounded-2xl shadow-lg border-2 border-farm-amber/40 p-6">
        <h2 class="text-2xl font-bold text-farm-amber mb-1">${t('auth.changePassword')}</h2>
        <p class="text-sm text-stone-600 mb-6">${t('auth.mustChangePassword')}</p>

        ${error ? `
          <div role="alert" class="mb-4 bg-red-50 border-2 border-farm-urgent text-farm-urgent rounded-lg px-4 py-3 font-semibold">
            ${error}
          </div>` : ''}

        <form id="change-form" class="space-y-4">
          <div>
            <label for="new-password" class="block font-semibold mb-1">${t('auth.newPassword')}</label>
            <input id="new-password" type="password" autocomplete="new-password" required minlength="6"
                   class="w-full rounded-lg border-2 border-stone-300 px-3 py-2 focus:border-farm-greenLight" />
          </div>
          <div>
            <label for="confirm-password" class="block font-semibold mb-1">${t('auth.confirmPassword')}</label>
            <input id="confirm-password" type="password" autocomplete="new-password" required minlength="6"
                   class="w-full rounded-lg border-2 border-stone-300 px-3 py-2 focus:border-farm-greenLight" />
          </div>
          <button type="submit"
                  class="w-full bg-farm-green text-white font-bold rounded-lg py-3 hover:bg-farm-greenLight transition-colors">
            ${t('common.confirm')}
          </button>
        </form>
      </div>
    </div>
  `;

  container.querySelector('#change-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const next = container.querySelector('#new-password').value;
    const confirm = container.querySelector('#confirm-password').value;
    if (next.length < 6) {
      return renderForceChangePassword(container, currentPassword, { error: t('auth.passwordTooShort') });
    }
    if (next !== confirm) {
      return renderForceChangePassword(container, currentPassword, { error: t('auth.passwordMismatch') });
    }
    try {
      await changeOwnPassword(next);
      routeAfterLogin(getSession());
    } catch {
      renderForceChangePassword(container, currentPassword, { error: t('errors.generic') });
    }
  });
}
