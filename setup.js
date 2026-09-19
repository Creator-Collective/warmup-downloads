(() => {
  'use strict';

  const element = id => document.getElementById(id);
  const button = element('extensions-shortcut');
  const status = element('extensions-shortcut-status');
  const guide = document.querySelector('[data-latest-version]');
  const checkButton = element('check-extension');
  if (!button || !status || !guide || !checkButton) return;

  // Older bridges answer hello, but the manager command first shipped in 0.6.46.
  const minimumVersion = '0.6.46';
  const latestVersion = guide.dataset.latestVersion;
  const pending = new Map();
  let phase = '';
  let interactionRevision = 0;
  let chosenMode = false;
  let mode = 'install';
  let walkthroughStep = 0;
  const walkthroughFrames = ['walkthrough-download', 'walkthrough-manage', 'walkthrough-finish'].map(element);

  function updateButtons() {
    button.textContent = phase === 'refreshing' ? 'open chrome extensions' : phase || 'open chrome extensions';
    button.disabled = Boolean(phase);
    checkButton.textContent = phase === 'refreshing' ? 'checking…' : 'check again';
    checkButton.disabled = Boolean(phase);
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

  function compareVersions(left, right) {
    const a = versionParts(left);
    const b = versionParts(right);
    if (!a || !b) throw new Error('unrecognized extension version');
    const difference = a.findIndex((part, index) => part !== b[index]);
    return difference === -1 ? 0 : Math.sign(a[difference] - b[difference]);
  }

  function installation(info) {
    return { version: info?.version, supported: compareVersions(info?.version, minimumVersion) >= 0, comparison: compareVersions(info?.version, latestVersion) };
  }

  function displayInstallation(installed) {
    const badge = element('version-status');
    element('installed-version').textContent = installed ? installed.version : 'not detected';
    if (!installed) {
      badge.textContent = 'not connected';
      badge.dataset.state = 'disconnected';
      element('version-hint').textContent = 'already installed? enable it in this Chrome profile, then check again.';
      return;
    }
    badge.dataset.state = installed.comparison < 0 ? 'outdated' : installed.comparison > 0 ? 'newer' : 'current';
    badge.textContent = installed.comparison < 0 ? 'update needed' : installed.comparison > 0 ? 'newer version installed' : 'up to date';
    element('version-hint').textContent = installed.comparison < 0 ? `you have an older version. update to ${latestVersion} below.` : 'you’re ready to warm up.';
    if (!chosenMode) renderMode('update');
  }

  function unavailableMessage() {
    return 'not connected. in Chrome, use ⋮ → extensions → manage extensions.';
  }

  function renderWalkthrough() {
    walkthroughFrames.forEach((frame, index) => { frame.hidden = index !== walkthroughStep; });
    element('walkthrough-progress').textContent = `${walkthroughStep + 1} of 3`;
    element('walkthrough-back').disabled = walkthroughStep === 0;
    element('walkthrough-next').textContent = walkthroughStep === 2 ? 'start again' : 'next step';
  }

  function renderMode(nextMode) {
    mode = nextMode;
    const updating = mode === 'update';
    element('mode-install').setAttribute('aria-pressed', String(!updating));
    element('mode-update').setAttribute('aria-pressed', String(updating));
    element('step-one-copy').textContent = updating ? 'stop your session, then download and unzip the latest version.' : 'unzip the download. keep the folder somewhere permanent.';
    element('step-two-title').textContent = updating ? 'replace the old files' : 'open chrome extensions';
    element('step-two-copy').textContent = updating ? 'copy the new files into your existing extension folder. choose replace to keep your settings.' : 'turn on developer mode in the top-right corner.';
    element('step-three-title').textContent = updating ? 'reload your extension' : 'load your folder';
    element('step-three-copy').textContent = updating ? 'click ↻ on the creator collective card, then reopen the side panel and press check again above.' : 'click “load unpacked” and select the unzipped creator-collective-extension folder.';
    element(updating ? 'step-three' : 'step-two').append(element('manager-action'));
    element('walkthrough-manage-title').textContent = updating ? 'replace the files in your original folder' : 'turn on developer mode';
    element('walkthrough-manage-copy').textContent = updating ? 'keep the original folder. replace its contents with the files from your new download.' : 'it is in the top-right corner of chrome’s extensions page.';
    element('walkthrough-manage').classList.toggle('is-update', updating);
    element('walkthrough-finish-title').textContent = updating ? 'reload the existing extension' : 'select your extension folder';
    element('walkthrough-finish-copy').textContent = updating ? 'click ↻ on this card. reopen the side panel, then check your version above.' : 'choose the unzipped folder. your extension card will appear here.';
    walkthroughStep = 0;
    renderWalkthrough();
  }

  for (const nextMode of ['install', 'update']) element(`mode-${nextMode}`).addEventListener('click', () => {
    chosenMode = true;
    renderMode(nextMode);
  });
  element('walkthrough-back').addEventListener('click', () => { walkthroughStep = Math.max(0, walkthroughStep - 1); renderWalkthrough(); });
  element('walkthrough-next').addEventListener('click', () => { walkthroughStep = (walkthroughStep + 1) % 3; renderWalkthrough(); });

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
    updateButtons();
    showStatus('');

    try {
      const installed = installation(await request('hello'));
      displayInstallation(installed);
      if (!installed.supported) {
        showStatus(`version ${installed.version} cannot open this page. version ${minimumVersion} or newer is required. use Chrome’s ⋮ → extensions → manage extensions to update.`);
        return;
      }
      phase = 'opening…';
      updateButtons();
      const result = await request('open-extensions');
      if (!Number.isInteger(result?.tabId) || result.tabId < 0) throw new Error('extension unavailable');
      showStatus('chrome extensions opened.');
    } catch {
      if (phase !== 'opening…') displayInstallation(null);
      showStatus(phase === 'opening…'
        ? 'Chrome did not confirm opening. use ⋮ → extensions → manage extensions.'
        : unavailableMessage());
    } finally {
      phase = '';
      updateButtons();
    }
  });

  checkButton.addEventListener('click', async () => {
    if (phase) return;
    interactionRevision++;
    phase = 'refreshing';
    updateButtons();
    showStatus('');
    element('version-status').textContent = 'checking…';
    element('version-status').dataset.state = 'checking';
    try { displayInstallation(installation(await request('hello'))); }
    catch {
      displayInstallation(null);
      showStatus('reconnecting to the extension…');
      // Reloading an unpacked extension can invalidate this page’s bridge.
      // Only this explicit user action reloads, once; startup never retries.
      location.reload();
    }
    finally { phase = ''; updateButtons(); }
  });

  element('latest-version').textContent = latestVersion;
  element('walkthrough-version').textContent = latestVersion;
  updateButtons();
  renderMode(mode);
  request('hello').then(info => {
    if (interactionRevision === 0) displayInstallation(installation(info));
  }).catch(() => {
    if (interactionRevision === 0) displayInstallation(null);
  });
})();
