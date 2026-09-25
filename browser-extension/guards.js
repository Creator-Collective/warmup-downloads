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
// Test builds only: numbers-only diagnostics, the read-only page check and the
// copyable report. Every value is a count, a yes/no or one of these fixed codes.
// Page text, links, handles, keywords and comment text never enter them.
const warmupDiagnostics = (() => {
  const MAX = 1000000;
  const codes = Object.freeze({
    inPlace: Object.freeze(['ok', 'not-liked', 'not-following', 'no-control', 'no-post', 'unread']),
    fresh: Object.freeze(['persisted', 'reverted', 'timed-out', 'moved', 'unreadable', 'blocked']),
    read: Object.freeze(['ok', 'not-liked', 'not-following', 'no-control', 'no-post', 'unread']),
    confirm: Object.freeze(['confirmed', 'identity-changed', 'caption-changed', 'not-submitted', 'interrupted', 'composer-unavailable', 'reply-mode',
      'composer-not-empty', 'baseline-changed', 'own-row-missing', 'own-row-ambiguous', 'own-row-not-new', 'post-unavailable', 'post-changed', 'unknown']),
    submit: Object.freeze(['not-owned', 'composer-empty', 'text-mismatch', 'submit-unavailable', 'unknown']),
    end: Object.freeze(['deadline', 'stopped', 'blocked', 'page-changed', 'tab-refreshed', 'error']),
    block: Object.freeze(['sign-in', 'language', 'access-denied', 'challenge', 'rate-limit', 'comment-failed', 'unknown'])
  });
  const fallback = { inPlace: 'unread', fresh: 'unreadable', read: 'unread', confirm: 'unknown', submit: 'unknown', end: 'error', block: 'unknown' };
  const code = (kind, value) => codes[kind].includes(value) ? value : fallback[kind];
  const count = value => Number.isSafeInteger(value) && value > 0 ? Math.min(value, MAX) : 0;
  const tally = (value, names) => Object.fromEntries(names.map(name => [name, count(value?.[name])]).filter(([, n]) => n > 0));
  const bump = (counts, name) => ({ ...counts, [name]: Math.min(MAX, (counts[name] || 0) + 1) });
  const engagement = value => ({
    pairs: Object.fromEntries(codes.inPlace.map(name => [name, tally(value?.pairs?.[name], codes.fresh)]).filter(([, counts]) => Object.keys(counts).length)),
    reads: tally(value?.reads, codes.read)
  });
  // Like and follow outcomes are kept as in-place result to fresh-page result pairs,
  // so "shown, then undone" stays apart from "never shown".
  function normalize(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return {
      version: 1, like: engagement(source.like), follow: engagement(source.follow),
      comment: { confirm: tally(source.comment?.confirm, codes.confirm), submit: tally(source.comment?.submit, codes.submit) },
      advances: count(source.advances), runs: count(source.runs), ends: tally(source.ends, codes.end), blocks: tally(source.blocks, codes.block)
    };
  }
  // Returns a new diagnostics object with one event counted. Unknown codes count
  // under their fallback code, never under their own text.
  function record(value, event = {}) {
    const current = normalize(value);
    if (event.type === 'engagement' && ['like', 'follow'].includes(event.action)) {
      const before = current[event.action];
      const inPlace = code('inPlace', event.inPlace);
      const pairs = { ...before.pairs, [inPlace]: bump(before.pairs[inPlace] || {}, code('fresh', event.fresh)) };
      const reads = event.read == null ? before.reads : bump(before.reads, code('read', event.read));
      return { ...current, [event.action]: { pairs, reads } };
    }
    if (event.type === 'confirm' || event.type === 'submit') {
      return { ...current, comment: { ...current.comment, [event.type]: bump(current.comment[event.type], code(event.type, event.code)) } };
    }
    if (event.type === 'advance') return { ...current, advances: Math.min(MAX, current.advances + 1) };
    if (event.type === 'run') return { ...current, runs: Math.min(MAX, current.runs + 1) };
    if (event.type === 'end') {
      const ended = { ...current, ends: bump(current.ends, code('end', event.code)) };
      return event.block == null ? ended : { ...ended, blocks: bump(ended.blocks, code('block', event.block)) };
    }
    return current;
  }
  const probeFlags = Object.freeze(['host', 'searchPage', 'searchTerm', 'postPage', 'viewer', 'postFound', 'authorLink', 'caption', 'videoPlaying', 'videoShort',
    'like', 'likeClickable', 'liked', 'follow', 'followClickable', 'following', 'next', 'close', 'commentIcon', 'commentBox', 'commentBoxHasText',
    'postButton', 'replying', 'ownProfile', 'commentReady']);
  const probeCounts = Object.freeze(['resultCards', 'searchCards', 'behindViewerCards', 'dialogs', 'mediaDialogs', 'postLinks', 'likeControls', 'followControls', 'commentBoxes', 'ownAccounts']);
  const probeStages = Object.freeze(['blocked', 'several-viewers', 'viewer-error', 'not-a-post', 'no-media', 'no-post-id', 'photo-details', 'photo-changed', 'post']);
  // html lang is page-controlled: only a short language tag passes, anything else is 'other'.
  const language = value => typeof value !== 'string' || !value.trim() || value === 'none' ? 'none'
    : /^[a-z]{2,3}(?:[-_](?:[a-z]{4}|[a-z]{2}|\d{3}))?(?:[-_](?:[a-z]{2}|\d{3}))?$/i.test(value.trim()) ? value.trim().toLowerCase().replace(/_/g, '-') : 'other';
  function normalizeProbe(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return {
      ...Object.fromEntries(probeFlags.map(name => [name, value[name] === true])),
      ...Object.fromEntries(probeCounts.map(name => [name, Number.isSafeInteger(value[name]) && value[name] > 0 ? Math.min(value[name], 999) : 0])),
      stage: probeStages.includes(value.stage) ? value.stage : 'unknown',
      kind: ['video', 'photo'].includes(value.kind) ? value.kind : 'none',
      blockReason: value.blockReason == null || value.blockReason === 'none' ? 'none' : code('block', value.blockReason),
      commentBlocker: ['account', 'composer'].includes(value.commentBlocker) ? value.commentBlocker : 'none',
      lang: language(value.lang)
    };
  }
  const yes = value => value ? 'yes' : 'no';
  function probeLines(value) {
    const p = normalizeProbe(value);
    if (!p) return [];
    return [
      'page check',
      `tiktok page: ${yes(p.host)} · language ${p.lang} · block ${p.blockReason} · stage ${p.stage}`,
      `search page: ${yes(p.searchPage)} · keyword in address: ${yes(p.searchTerm)} · result cards ${p.resultCards} · counted cards ${p.searchCards} · cards behind viewer ${p.behindViewerCards}`,
      `dialogs ${p.dialogs} · video dialogs ${p.mediaDialogs} · post links ${p.postLinks} · post page: ${yes(p.postPage)}`,
      `viewer: ${yes(p.viewer)} · post found: ${yes(p.postFound)} · kind ${p.kind} · author link: ${yes(p.authorLink)} · caption: ${yes(p.caption)}`,
      `video playing: ${yes(p.videoPlaying)} · two minutes or shorter: ${yes(p.videoShort)}`,
      `like control: ${yes(p.like)} · found ${p.likeControls} · clickable: ${yes(p.likeClickable)} · liked: ${yes(p.liked)}`,
      `follow control: ${yes(p.follow)} · found ${p.followControls} · clickable: ${yes(p.followClickable)} · following: ${yes(p.following)}`,
      `next: ${yes(p.next)} · close: ${yes(p.close)} · comment icon: ${yes(p.commentIcon)}`,
      `comment box: ${yes(p.commentBox)} · found ${p.commentBoxes} · has text: ${yes(p.commentBoxHasText)} · post button: ${yes(p.postButton)} · reply mode: ${yes(p.replying)}`,
      `own profile link: ${yes(p.ownProfile)} · accounts ${p.ownAccounts} · comments possible: ${yes(p.commentReady)} · comment blocker ${p.commentBlocker}`
    ];
  }
  const listed = counts => { const entries = Object.entries(counts); return entries.length ? entries.map(([name, n]) => `${name} ${n}`).join(', ') : 'none'; };
  const pairsOf = pairs => listed(Object.fromEntries(Object.entries(pairs).flatMap(([inPlace, fresh]) => Object.entries(fresh).map(([outcome, n]) => [`${inPlace} to ${outcome}`, n]))));
  // The report a tester copies: fixed labels and numbers only, never messages or activity.
  function report({ version, job, probe } = {}) {
    const d = normalize(job?.diagnostics);
    const settings = job?.settings && typeof job.settings === 'object' ? job.settings : {};
    const stats = job?.stats && typeof job.stats === 'object' ? job.stats : {};
    const number = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;
    const unconfirmed = normalizeUnconfirmed(job?.unconfirmed, settings.limits);
    const left = Math.ceil(remainingTime(job) / 1000);
    const platform = !job ? 'none' : settings.platform == null || settings.platform === '' ? 'instagram' : Object.hasOwn(platforms, settings.platform) ? settings.platform : 'unknown';
    const phase = !job ? 'ready' : ['starting', 'running', 'stopping', 'stopped', 'complete', 'error'].includes(job.phase) ? job.phase : 'unknown';
    const comments = Array.isArray(job?.comments) ? job.comments : [];
    const statuses = status => comments.filter(item => item?.status === status).length;
    return [
      'creator collective test report',
      `version ${typeof version === 'string' && /^\d{1,5}(?:\.\d{1,5}){0,3}$/.test(version) ? version : 'unknown'}`,
      `platform ${platform} · phase ${phase} · minutes ${number(settings.minutes)} · left ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} · keywords ${Array.isArray(settings.terms) ? settings.terms.length : 0} · focus ${['like', 'follow', 'comment'].includes(settings.focus) ? settings.focus : 'balanced'}`,
      `targets: likes ${number(settings.limits?.like)} · follows ${number(settings.limits?.follow)} · comments ${number(settings.limits?.comment)}`,
      `confirmed: likes ${number(stats.like)} · follows ${number(stats.follow)} · comments ${number(stats.comment)}`,
      `not confirmed: likes ${unconfirmed.like} · follows ${unconfirmed.follow} · comments ${unconfirmed.comment}`,
      `searches ${number(stats.search)} · opens ${number(stats.open)} · next ${d.advances} · scrolls ${number(stats.scroll)} · reading pauses ${number(stats.read)} · skipped ${number(stats.skipped)}`,
      `comments paused: ${yes(normalizePausedActions(job?.pausedActions).includes('comment'))} · comments posted ${statuses('confirmed')} · comments unsure ${statuses('uncertain')}`,
      `runs ${d.runs} · ended: ${listed(d.ends)} · blocks: ${listed(d.blocks)}`,
      `like checks, in place to fresh page: ${pairsOf(d.like.pairs)}`,
      `like fresh page reads: ${listed(d.like.reads)}`,
      `follow checks, in place to fresh page: ${pairsOf(d.follow.pairs)}`,
      `follow fresh page reads: ${listed(d.follow.reads)}`,
      `comment checks: ${listed(d.comment.confirm)}`,
      `comment submit problems: ${listed(d.comment.submit)}`,
      ...probeLines(probe)
    ].join('\n');
  }
  return Object.freeze({ codes, normalize, record, normalizeProbe, probeLines, report });
})();
if (typeof module !== 'undefined') module.exports = { platforms, validPlatform, platformURL, instagramURL, dashboardSender, panelSender, runnerSender, normalizeUnconfirmed, normalizePausedActions, normalizeCheckpoint, remainingTime, resumableJob, publicState, warmupDiagnostics };
