(() => {
  if (window !== window.top || location.origin !== 'https://creator-collective-warmup.vercel.app') return;
  const allowed = new Set(['hello', 'tabs', 'state', 'start', 'stop', 'open-instagram']);
  window.addEventListener('message', async event => {
    const request = event.data;
    if (event.source !== window || event.origin !== location.origin || request?.channel !== 'cc-warmup-request' || typeof request.id !== 'string' || request.id.length > 80 || !allowed.has(request.type)) return;
    try {
      const response = await chrome.runtime.sendMessage({ type: request.type, tabId: request.tabId, settings: request.settings });
      window.postMessage({ channel: 'cc-warmup-response', id: request.id, ...response }, location.origin);
    } catch { window.postMessage({ channel: 'cc-warmup-response', id: request.id, ok: false, error: 'extension disconnected. refresh this page.' }, location.origin); }
  });
})();
