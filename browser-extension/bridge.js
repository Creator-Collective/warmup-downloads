(() => {
  if (window !== window.top || location.origin !== 'https://creator-collective-warmup.vercel.app') return;
  const allowed = new Set(['hello', 'tabs', 'state', 'start', 'stop', 'open-instagram', 'open-platform']);
  window.addEventListener('message', async event => {
    const request = event.data;
    if (event.source !== window || event.origin !== location.origin || request?.channel !== 'cc-warmup-request' || typeof request.id !== 'string' || request.id.length > 80 || !allowed.has(request.type)) return;
    if (request.platform !== undefined && request.platform !== 'instagram' && request.platform !== 'tiktok') {
      window.postMessage({ channel: 'cc-warmup-response', id: request.id, ok: false, error: 'choose instagram or tiktok.' }, location.origin);
      return;
    }
    try {
      const response = await chrome.runtime.sendMessage({ type: request.type, tabId: request.tabId, settings: request.settings, platform: request.platform });
      window.postMessage({ channel: 'cc-warmup-response', id: request.id, ...response }, location.origin);
    } catch { window.postMessage({ channel: 'cc-warmup-response', id: request.id, ok: false, error: 'extension disconnected. refresh this page.' }, location.origin); }
  });
})();
