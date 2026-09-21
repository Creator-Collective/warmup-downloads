(() => {
  if (window !== window.top || location.origin !== 'https://creator-collective-warmup.vercel.app') return;
  const allowed = new Set(['hello', 'tabs', 'state', 'start', 'stop', 'set-focus', 'open-instagram', 'open-platform', 'setup-info', 'open-extensions']);
  window.addEventListener('message', async event => {
    const request = event.data;
    if (event.source !== window || event.origin !== location.origin || request?.channel !== 'cc-warmup-request' || typeof request.id !== 'string' || request.id.length > 80 || !allowed.has(request.type)) return;
    if (request.platform !== undefined && request.platform !== 'instagram') {
      window.postMessage({ channel: 'cc-warmup-response', id: request.id, ok: false, error: 'warm-up is instagram only for now.' }, location.origin);
      return;
    }
    try {
      const payload = request.type === 'set-focus'
        ? { type: request.type, focus: request.focus, sessionId: request.sessionId }
        : { type: request.type, tabId: request.tabId, settings: request.settings, platform: request.platform };
      const response = await chrome.runtime.sendMessage(payload);
      window.postMessage({ channel: 'cc-warmup-response', id: request.id, ...response }, location.origin);
    } catch { window.postMessage({ channel: 'cc-warmup-response', id: request.id, ok: false, error: 'extension disconnected. refresh this page.' }, location.origin); }
  });
})();
