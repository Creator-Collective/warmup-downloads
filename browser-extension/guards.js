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
function normalizeUnconfirmed(value, limits) {
  return Object.fromEntries(Object.entries({ like: 180, follow: 60, comment: 20 }).map(([action, maximum]) => {
    const limit = Number.isSafeInteger(limits?.[action]) && limits[action] >= 0 ? Math.min(limits[action], maximum) : maximum;
    const count = Number.isSafeInteger(value?.[action]) && value[action] >= 0 ? Math.min(value[action], limit) : 0;
    return [action, count];
  }));
}
function normalizePausedActions(value) {
  return Array.isArray(value) && value.includes('comment') ? ['comment'] : [];
}
// Checkpoints stay private to the extension. Reject incomplete or oversized
// histories instead of truncating them and risking a repeated action on resume.
function normalizeCheckpoint(value, settings) {
  if (!value || value.version !== 1 || !settings || !Number.isInteger(settings.minutes)) return null;
  const duration = settings.minutes * 60000;
  const integer = number => Number.isSafeInteger(number) && number >= 0;
  const key = text => typeof text === 'string' && text.length > 0 && text.length <= 2048;
  const history = list => Array.isArray(list) && list.length <= 10000 && list.every(key);
  const actionNames = ['like', 'follow', 'comment'];
  const statNames = ['scroll', 'read', 'search', 'open', 'like', 'follow', 'comment', 'skipped'];
  if (!statNames.every(name => integer(value.stats?.[name])) ||
      !actionNames.every(name => integer(value.unconfirmed?.[name]) && history(value.done?.[name])) ||
      !history(value.seen) || !history(value.usedComments) ||
      !Array.isArray(value.pausedActions) || value.pausedActions.some(action => action !== 'comment') ||
      !Array.isArray(value.comments) || value.comments.length > 1000 ||
      !integer(value.termIndex) || !Object.hasOwn(value, 'inFlight') ||
      (value.currentSearchTerm !== null && (typeof value.currentSearchTerm !== 'string' || !settings.terms?.includes(value.currentSearchTerm))) ||
      !Number.isFinite(value.elapsedMs) || value.elapsedMs < 0 || value.elapsedMs > duration ||
      !Number.isFinite(value.remainingMs) || value.remainingMs < 0 || value.remainingMs > duration ||
      value.elapsedMs + value.remainingMs > duration + 1000 ||
      !['like', 'follow', 'comment', 'engagement', 'break'].every(name => Number.isFinite(value.cooldowns?.[name]) && value.cooldowns[name] >= 0 && value.cooldowns[name] <= 7200000)) return null;
  if (actionNames.some(action => value.stats[action] + value.unconfirmed[action] > settings.limits[action])) return null;
  const comments = value.comments.map(item => sessionComments.normalize([item])[0]);
  if (comments.some(item => !item)) return null;
  let inFlight = null;
  if (value.inFlight != null) {
    const pending = value.inFlight;
    if (!actionNames.includes(pending.action) || !key(pending.key) || !key(pending.post?.id) ||
        (pending.post.author != null && (typeof pending.post.author !== 'string' || pending.post.author.length > 100)) ||
        (pending.comment != null && (typeof pending.comment !== 'string' || pending.comment.length > 500)) ||
        !Number.isFinite(pending.time) || pending.time < 0 || pending.time > 8640000000000000 ||
        (pending.action === 'comment' && !pending.comment?.trim())) return null;
    inFlight = { action: pending.action, key: pending.key, post: { id: pending.post.id, ...(pending.post.author ? { author: pending.post.author } : {}) }, comment: pending.comment || null, time: pending.time };
  }
  let draftHold = null;
  if (value.draftHold != null) {
    const hold = value.draftHold;
    const within = number => Number.isFinite(number) && number >= 0 && number <= duration;
    if (typeof hold !== 'object' || typeof hold.comment !== 'string' || hold.comment.length > 500 ||
        typeof hold.postId !== 'string' || hold.postId.length > 2048 || !within(hold.sinceMs) || !within(hold.lastCheckMs) ||
        !Number.isInteger(hold.checks) || hold.checks < 0 || hold.checks > 10 || !Number.isInteger(hold.lifts) || hold.lifts < 0 || hold.lifts > 1 ||
        !['draft-retained', 'permanent', 'lifted'].includes(hold.reason) ||
        (hold.reason === 'draft-retained' && (!hold.comment.trim() || !hold.postId))) return null;
    draftHold = { comment: hold.comment, postId: hold.postId, sinceMs: hold.sinceMs, lastCheckMs: hold.lastCheckMs, checks: hold.checks, lifts: hold.lifts, reason: hold.reason };
  }
  return {
    version: 1,
    stats: Object.fromEntries(statNames.map(name => [name, value.stats[name]])),
    unconfirmed: Object.fromEntries(actionNames.map(name => [name, value.unconfirmed[name]])),
    pausedActions: normalizePausedActions(value.pausedActions), comments,
    seen: [...value.seen], done: Object.fromEntries(actionNames.map(name => [name, [...value.done[name]]])), usedComments: [...value.usedComments],
    termIndex: value.termIndex, currentSearchTerm: value.currentSearchTerm,
    elapsedMs: value.elapsedMs, remainingMs: value.remainingMs,
    cooldowns: Object.fromEntries(['like', 'follow', 'comment', 'engagement', 'break'].map(name => [name, value.cooldowns[name]])), inFlight, ...(draftHold ? { draftHold } : {})
  };
}
function remainingTime(job) {
  if (!job || job.phase === 'complete') return 0;
  if (job.stopRequested || ['stopped', 'error'].includes(job.phase)) return Number.isFinite(job.remainingMs) ? Math.max(0, job.remainingMs) : 0;
  return Number.isFinite(job.deadline) ? Math.max(0, job.deadline - Date.now()) : 0;
}
// enabled is the build's platform list. The saved platform must match it exactly:
// a session saved without a platform predates resume and never resumes.
function resumableJob(job, enabled = ['instagram']) {
  return Boolean(job?.sessionId && Array.isArray(enabled) && typeof job.settings?.platform === 'string' && enabled.includes(job.settings.platform) && ['stopped', 'error'].includes(job.phase) && remainingTime(job) > 0 && normalizeCheckpoint(job.checkpoint, job.settings));
}
function publicState(job, enabled = ['instagram']) {
  if (!job) return { running: false, phase: 'ready', message: 'ready when you are.', stats: {}, unconfirmed: normalizeUnconfirmed(), pausedActions: [], activity: [], comments: [] };
  return { running: ['starting', 'running', 'stopping'].includes(job.phase), phase: job.phase, message: job.message, deadline: job.deadline, nextActionAt: job.nextActionAt, stats: job.stats, unconfirmed: normalizeUnconfirmed(job.unconfirmed, job.settings?.limits), pausedActions: normalizePausedActions(job.pausedActions), activity: job.activity, comments: sessionComments.normalize(job.comments), tabId: job.tabId,
    sessionId: typeof job.sessionId === 'string' ? job.sessionId : undefined,
    canResume: resumableJob(job, enabled), remainingMs: remainingTime(job),
    canChangeFocus: Boolean(job.sessionId && ['starting', 'running'].includes(job.phase) && !job.stopRequested && job.deadline > Date.now()),
    settings: job.settings ? { platform: validPlatform(job.settings.platform), minutes: job.settings.minutes, terms: job.settings.terms, pace: job.settings.pace, limits: job.settings.limits, weights: job.settings.weights, focus: ['like','follow','comment'].includes(job.settings.focus) ? job.settings.focus : 'balanced' } : undefined };
}
if (typeof module !== 'undefined') module.exports = { platforms, validPlatform, platformURL, instagramURL, dashboardSender, panelSender, runnerSender, normalizeUnconfirmed, normalizePausedActions, normalizeCheckpoint, remainingTime, resumableJob, publicState };
