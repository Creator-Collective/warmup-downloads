(() => {
  // the dashboard moved to tryvelocitycreators.com on 2026-10-16; the old domain still serves some pages.
  const origins = new Set(['https://trycreatorcollective.com', 'https://www.trycreatorcollective.com', 'https://tryvelocitycreators.com', 'https://www.tryvelocitycreators.com']);
  if (window !== window.top || !origins.has(location.origin)) return;

  window.addEventListener('message', event => {
    const request = event.data;
    if (event.source !== window || event.origin !== location.origin || request?.type !== 'cc-warmup-version-request' || typeof request.nonce !== 'string' || !/^[a-f0-9]{32}$/.test(request.nonce)) return;
    try {
      window.postMessage({ type: 'cc-warmup-version-response', nonce: request.nonce, version: chrome.runtime.getManifest().version }, location.origin);
    } catch { /* An extension reload invalidates this page's content script until refresh. */ }
  });
})();
