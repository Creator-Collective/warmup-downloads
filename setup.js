(() => {
  'use strict';

  const button = document.getElementById('extensions-shortcut');
  const status = document.getElementById('extensions-shortcut-status');
  if (!button || !status) return;

  // The manager command first shipped in 0.6.46; older bridges still answer hello.
  const minimumVersion = '0.6.46';
  const pending = new Map();
  let phase = '';
  let interactionRevision = 0;

  function updateButton() {
    button.textContent = phase || 'open chrome extensions';
    button.disabled = Boolean(phase);
  }

  function showStatus(message) {
    status.textContent = message;
    status.hidden = !message;
  }

  function versionParts(version) {
    if (typeof version !== 'string' || !/^(?:0|[1-9]\d{0,4})(?:\.(?:0|[1-9]\d{0,4})){2,3}$/.test(version)) return null;
    const parts = version.split('.').map(Number);
    if (parts.some(part => part > 65535)) return null;
    while (parts.length < 4) parts.push(0);
    return parts;
  }

  function installation(info) {
    const parts = versionParts(info?.version);
    if (!parts) throw new Error('unrecognized extension version');
    const required = versionParts(minimumVersion);
    const difference = parts.findIndex((part, index) => part !== required[index]);
    const supported = difference === -1 || parts[difference] > required[difference];
    return { version: info.version, supported };
  }

  function installedMessage(installed) {
    return installed.supported
      ? `installed extension: ${installed.version}.`
      : `installed extension: ${installed.version}. update to ${minimumVersion} or newer, reload it, then refresh this page.`;
  }

  function unavailableMessage() {
    return 'the cc extension is not connected. reload it and refresh this page. for your first install, use chrome’s ⋮ menu → extensions → manage extensions.';
  }

  window.addEventListener('message', event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.channel !== 'cc-warmup-response') return;
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

  button.addEventListener('click', async () => {
    if (phase) return;
    interactionRevision++;
    phase = 'checking extension…';
    updateButton();
    showStatus('');

    try {
      const installed = installation(await request('hello'));
      if (!installed.supported) {
        showStatus(installedMessage(installed));
        return;
      }
      phase = 'opening…';
      updateButton();
      const result = await request('open-extensions');
      if (!Number.isInteger(result?.tabId) || result.tabId < 0) throw new Error('extension unavailable');
      showStatus('chrome extensions opened.');
    } catch {
      showStatus(phase === 'opening…'
        ? 'the extension connected, but chrome did not confirm opening the page. use chrome’s ⋮ menu → extensions → manage extensions.'
        : unavailableMessage());
    } finally {
      phase = '';
      updateButton();
    }
  });

  updateButton();
  request('hello').then(info => {
    if (interactionRevision === 0) showStatus(installedMessage(installation(info)));
  }).catch(() => {
    if (interactionRevision === 0) showStatus(unavailableMessage());
  });
})();
