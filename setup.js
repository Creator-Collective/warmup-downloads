(() => {
  'use strict';

  const button = document.getElementById('extensions-shortcut');
  const status = document.getElementById('extensions-shortcut-status');
  const address = document.getElementById('extensions-address');
  if (!button || !status || !address) return;

  const extensionsUrl = 'chrome://extensions/';
  const pending = new Map();
  let canOpenExtensions = false;
  let actionPending = false;

  function updateButton() {
    button.textContent = canOpenExtensions ? 'open chrome extensions' : 'copy extensions address';
    button.disabled = actionPending;
  }

  function showStatus(message) {
    status.textContent = message;
    status.hidden = !message;
  }

  function showAddress(message) {
    address.value = extensionsUrl;
    address.hidden = false;
    address.focus();
    address.select();
    showStatus(message);
  }

  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.channel !== 'cc-warmup-response') return;
    const callback = pending.get(event.data.id);
    if (!callback) return;
    pending.delete(event.data.id);
    callback(event.data);
  });

  function request(type, timeout) {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error('extension unavailable'));
      }, timeout);
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

  button.addEventListener('click', async () => {
    if (actionPending) return;
    const openingExtensions = canOpenExtensions;
    actionPending = true;
    updateButton();
    showStatus('');
    address.hidden = true;

    try {
      if (openingExtensions) {
        const result = await request('open-extensions', 5000);
        if (!Number.isInteger(result?.tabId) || result.tabId < 0) throw new Error('extension unavailable');
        showStatus('chrome extensions opened.');
      } else {
        if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable');
        await navigator.clipboard.writeText(extensionsUrl);
        showStatus('copied. paste it into chrome’s address bar.');
      }
    } catch {
      if (openingExtensions) canOpenExtensions = false;
      showAddress('copy this address into chrome’s address bar.');
    } finally {
      actionPending = false;
      updateButton();
    }
  });

  updateButton();
  request('setup-info', 1800).then(info => {
    canOpenExtensions = info?.canOpenExtensions === true;
    updateButton();
  }).catch(() => {
    // Older extensions and first-time visitors keep the copy-address shortcut.
  });
})();
