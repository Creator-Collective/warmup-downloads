(() => {
  'use strict';

  const button = document.getElementById('extensions-shortcut');
  const status = document.getElementById('extensions-shortcut-status');
  if (!button || !status) return;

  const pending = new Map();
  let actionPending = false;

  function updateButton() {
    button.textContent = actionPending ? 'opening…' : 'open chrome extensions';
    button.disabled = actionPending;
  }

  function showStatus(message) {
    status.textContent = message;
    status.hidden = !message;
  }

  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.channel !== 'cc-warmup-response') return;
    const callback = pending.get(event.data.id);
    if (!callback) return;
    pending.delete(event.data.id);
    callback(event.data);
  });

  function openExtensions() {
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
        window.postMessage({ channel: 'cc-warmup-request', id, type: 'open-extensions' }, location.origin);
      } catch (error) {
        clearTimeout(timer);
        pending.delete(id);
        reject(error);
      }
    });
  }

  button.addEventListener('click', async () => {
    if (actionPending) return;
    actionPending = true;
    updateButton();
    showStatus('');

    try {
      const result = await openExtensions();
      if (!Number.isInteger(result?.tabId) || result.tabId < 0) throw new Error('extension unavailable');
      showStatus('chrome extensions opened.');
    } catch {
      showStatus('reload the cc extension, then refresh this page. for your first install, use chrome’s ⋮ menu → extensions → manage extensions.');
    } finally {
      actionPending = false;
      updateButton();
    }
  });

  updateButton();
})();
