'use strict';
const DASHBOARD_ORIGIN = 'https://creator-collective-warmup.vercel.app';
function instagramURL(value) {
  try { const u = new URL(value); return u.protocol === 'https:' && ['www.instagram.com', 'instagram.com'].includes(u.hostname) && !u.username && !u.password; } catch { return false; }
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
  if (!job) return { running: false, phase: 'ready', message: 'ready when you are.', stats: {}, activity: [] };
  return { running: ['starting', 'running', 'stopping'].includes(job.phase), phase: job.phase, message: job.message, deadline: job.deadline, nextActionAt: job.nextActionAt, stats: job.stats, activity: job.activity, tabId: job.tabId,
    settings: job.settings ? { minutes: job.settings.minutes, terms: job.settings.terms, pace: job.settings.pace, limits: job.settings.limits, weights: job.settings.weights } : undefined };
}
if (typeof module !== 'undefined') module.exports = { instagramURL, dashboardSender, panelSender, runnerSender, publicState };
