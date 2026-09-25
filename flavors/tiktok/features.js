'use strict';
// TikTok test build only. scripts/package-tiktok-test.mjs puts this file in place
// of browser-extension/features.js; the instagram build never contains it.
const productFeatures = Object.freeze({ accountSignup: false, platforms: Object.freeze(['tiktok']), testTools: true });
// A "TT" badge on the toolbar icon tells this build apart from the instagram one.
// Chrome drops badges when it restarts, so the badge is set again at startup.
(() => {
  const action = globalThis.chrome?.action;
  if (typeof action?.setBadgeText !== 'function') return;
  const quietly = call => { try { Promise.resolve(call()).catch(() => {}); } catch { /* the name still says tiktok test */ } };
  const mark = () => {
    quietly(() => action.setBadgeText({ text: 'TT' }));
    if (typeof action.setBadgeBackgroundColor === 'function') quietly(() => action.setBadgeBackgroundColor({ color: '#111111' }));
  };
  mark();
  quietly(() => globalThis.chrome.runtime?.onStartup?.addListener(mark));
})();
