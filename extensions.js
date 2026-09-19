(() => {
  'use strict';

  // The installed extension already trusts this origin. This page only opens
  // Chrome's extension manager; it never accepts a destination or command.
  if (window !== window.top || location.origin !== 'https://creator-collective-warmup.vercel.app') return;
  const page = document.querySelector('[data-extension-manager]');
  const status = document.getElementById('manager-status');
  const fallback = document.getElementById('manager-fallback');
  const retry = document.getElementById('manager-retry');
  if (!page || !status || !fallback || !retry || page.dataset.shortcutInitialized === 'true') return;
  page.dataset.shortcutInitialized = 'true';

  const pending = new Map();
  let phase = '';
  let retired = false;

  function supportedVersion(version) {
    if (typeof version !== 'string' || !/^(?:0|[1-9]\d{0,4})(?:\.(?:0|[1-9]\d{0,4})){2,3}$/.test(version)) return false;
    const parts = version.split('.').map(Number);
    if (parts.some(part => part > 65535)) return false;
    return parts[0] > 0 || parts[1] > 6 || (parts[1] === 6 && parts[2] >= 46);
  }

  window.addEventListener('message', event => {
    if (retired || event.source !== window || event.origin !== location.origin || event.data?.channel !== 'cc-warmup-response') return;
    const callback = pending.get(event.data.id);
    if (!callback) return;
    pending.delete(event.data.id);
    callback(event.data);
  });

  function request(type) {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('extension unavailable'));
      }, 5000);
      pending.set(id, response => {
        clearTimeout(timer);
        if (response.ok === true) resolve(response.data);
        else reject(new Error('extension unavailable'));
      });
      try {
        window.postMessage({ channel: 'cc-warmup-request', id, type }, location.origin);
      } catch (error) {
        clearTimeout(timer);
        pending.delete(id);
        reject(error);
      }
    });
  }

  async function openManager() {
    if (phase || retired) return;
    phase = 'checking';
    retry.hidden = false;
    retry.disabled = true;
    retry.textContent = 'checking…';
    fallback.hidden = true;
    page.setAttribute('aria-busy', 'true');
    status.textContent = 'checking your installed extension…';
    try {
      const info = await request('hello');
      if (retired) return;
      if (!supportedVersion(info?.version)) {
        status.textContent = 'this installed extension cannot open Chrome’s extensions page.';
        fallback.hidden = false;
        return;
      }
      phase = 'opening';
      retry.textContent = 'opening…';
      status.textContent = 'opening chrome extensions…';
      const result = await request('open-extensions');
      if (retired) return;
      if (!Number.isSafeInteger(result?.tabId) || result.tabId <= 0) throw new Error('opening not confirmed');
      status.textContent = 'chrome extensions opened in another tab.';
      retry.hidden = true;
    } catch {
      if (retired) return;
      status.textContent = phase === 'opening'
        ? 'Chrome did not confirm opening its extensions page.'
        : 'the warm-up extension is not connected in this browser profile.';
      fallback.hidden = false;
    } finally {
      phase = '';
      page.setAttribute('aria-busy', 'false');
      retry.disabled = retired;
      retry.textContent = 'try again';
    }
  }

  retry.addEventListener('click', openManager);
  window.addEventListener('pagehide', () => {
    retired = true;
    for (const callback of pending.values()) callback({ ok: false });
    pending.clear();
    retry.hidden = true;
    retry.disabled = true;
    status.textContent = 'return to warm-up to open chrome extensions again.';
    fallback.hidden = false;
  });
  openManager();
})();
