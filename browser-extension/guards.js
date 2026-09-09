'use strict';
const sessionComments = typeof module !== 'undefined' ? require('./comment-history.js') : globalThis.commentHistory;
const DASHBOARD_ORIGIN = 'https://creator-collective-warmup.vercel.app';
const platforms = Object.freeze({
  instagram: Object.freeze({
    label: 'instagram',
    home: 'https://www.instagram.com/',
    hosts: Object.freeze(['www.instagram.com', 'instagram.com']),
    patterns: Object.freeze(['https://www.instagram.com/*', 'https://instagram.com/*'])
  }),
  tiktok: Object.freeze({
    label: 'tiktok',
    home: 'https://www.tiktok.com/',
    hosts: Object.freeze(['www.tiktok.com', 'tiktok.com']),
    patterns: Object.freeze(['https://www.tiktok.com/*', 'https://tiktok.com/*'])
  })
});
function validPlatform(value) {
  if (value == null || value === '') return 'instagram';
  if (Object.hasOwn(platforms, value)) return value;
  throw new Error('choose instagram or tiktok.');
}
function platformURL(value, platform) {
  try {
    const name = validPlatform(platform);
    const u = new URL(value);
    return u.protocol === 'https:' && platforms[name].hosts.includes(u.hostname) && !u.username && !u.password;
  } catch { return false; }
}
function instagramURL(value) {
  return platformURL(value, 'instagram');
}
function dashboardSender(sender) {
  try { return sender.frameId === 0 && new URL(sender.url).origin === DASHBOARD_ORIGIN && Boolean(sender.tab?.id); } catch { return false; }
}
function panelSender(sender, extensionOrigin) {
  try { const u = new URL(sender.url); return sender.id === new URL(extensionOrigin).hostname && u.protocol === 'chrome-extension:' && u.hostname === new URL(extensionOrigin).hostname && u.pathname === '/sidepanel.html' && !u.search && !u.hash && (sender.frameId === undefined || sender.frameId === 0); } catch { return false; }
}
function runnerSender(sender, job, extensionOrigin) {
  if (!job || sender.tab?.id !== job.runnerTabId) return false;
  try { const u = new URL(sender.url); return u.protocol === 'chrome-extension:' && u.hostname === new URL(extensionOrigin).hostname && u.pathname === '/runner.html' && u.hash === `#${job.token}`; } catch { return false; }
}
function publicState(job) {
  if (!job) return { running: false, phase: 'ready', message: 'ready when you are.', stats: {}, activity: [], comments: [] };
  return { running: ['starting', 'running', 'stopping'].includes(job.phase), phase: job.phase, message: job.message, deadline: job.deadline, nextActionAt: job.nextActionAt, stats: job.stats, activity: job.activity, comments: sessionComments.normalize(job.comments), tabId: job.tabId,
    settings: job.settings ? { platform: validPlatform(job.settings.platform), minutes: job.settings.minutes, terms: job.settings.terms, pace: job.settings.pace, limits: job.settings.limits, weights: job.settings.weights } : undefined };
}
if (typeof module !== 'undefined') module.exports = { platforms, validPlatform, platformURL, instagramURL, dashboardSender, panelSender, runnerSender, publicState };
