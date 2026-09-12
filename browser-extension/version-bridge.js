(() => {
  const origins = new Set(['https://trycreatorcollective.com', 'https://www.trycreatorcollective.com']);
  if (window !== window.top || !origins.has(location.origin)) return;

  window.addEventListener('message', event => {
    const request = event.data;
    if (event.source !== window || event.origin !== location.origin || request?.type !== 'cc-warmup-version-request' || typeof request.nonce !== 'string' || !/^[a-f0-9]{32}$/.test(request.nonce)) return;
    try {
      window.postMessage({ type: 'cc-warmup-version-response', nonce: request.nonce, version: chrome.runtime.getManifest().version }, location.origin);
    } catch { /* An extension reload invalidates this page's content script until refresh. */ }
  });
})();
