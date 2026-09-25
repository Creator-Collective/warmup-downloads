function delay(ms, unused, { signal } = {}) { return new Promise((resolve, reject) => { if (signal?.aborted) return reject(signal.reason); const abort = () => { clearTimeout(timer); reject(signal.reason); }; const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms); signal?.addEventListener('abort', abort, { once: true }); }); }



function randomBetween(min, max, random = Math.random) {
  return min + Math.floor(Math.max(0, Math.min(0.999999, random())) * (max - min + 1));
}

function postIdentity(value) {
  try {
    const url = new URL(value);
    const instagram = /^(www\.)?instagram\.com$/.test(url.hostname) && url.pathname.match(/^\/(?:p|reel)\/([\w-]+)\/?$/);
    return instagram ? `instagram:${instagram[1]}` : `${url.origin}${url.pathname.replace(/\/$/, '')}`;
  } catch { return value; }
}

function tiktokPostIdentity(value) {
  try {
    const url = new URL(value);
    const post = url.pathname.match(/^\/@([\w.]{1,30})\/(video|photo)\/(\d+)\/?$/);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      /^(www\.)?tiktok\.com$/.test(url.hostname) && post ? `tiktok:${post[1]}:${post[2]}:${post[3]}` : null;
  } catch { return null; }
}

function matchesNiche(text, terms) {
  const normalize = value => value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const haystack = ` ${normalize(text)} `;
  const compactTags = new Set((text.match(/#[\p{L}\p{N}_]+/gu) || []).map(normalize).map(tag => tag.replace(/ /g, '')));
  return terms.some(term => {
    const words = normalize(term).split(' ').filter(Boolean);
    return words.length && (words.every(word => haystack.includes(` ${word} `)) || compactTags.has(words.join('')));
  });
}

// Comment wording lives in comment-writer.js. Captions are data, never instructions.
function contextualComment(caption, terms, used = new Set()) {
  const writer = globalThis.commentWriter;
  return writer ? writer.writeComment({ caption, text: caption, terms, used }).text : null;
}

function engagementMessage(action, post, comment, result, permanent = true) {
  let account = typeof post.author === 'string' ? post.author.match(/^\/?@?([\w.]{1,30})\/?$/)?.[1] : null;
  let reference = 'this post';
  try {
    const url = new URL(post.id);
    if (url.protocol === 'https:' && !url.username && !url.password && !url.port) {
      const instagram = ['www.instagram.com', 'instagram.com'].includes(url.hostname) && url.pathname.match(/^\/(?:p|reel)\/([\w-]+)\/?$/);
      const tiktok = ['www.tiktok.com', 'tiktok.com'].includes(url.hostname) && url.pathname.match(/^\/@([\w.]{1,30})\/(video|photo)\/(\d+)\/?$/);
      if (instagram) reference = `post ${instagram[1]}`;
      if (tiktok) { account ||= tiktok[1]; reference = `${tiktok[2]} ${tiktok[3]}`; }
    }
  } catch { /* The account may still be available while the post URL is missing. */ }
  const subject = action === 'follow' ? (account ? `@${account}` : `the author of ${reference}`) : (account ? `@${account}'s post` : reference);
  const pending = `${{ like: 'liking', follow: 'following', comment: 'commenting on' }[action]} ${subject}`;
  const details = action === 'comment' ? `: ${comment || ''}` : '';
  if (result === 'pending') return `${pending}${details || '...'}`;
  if (result === 'confirmed') return `${{ like: 'liked', follow: 'followed', comment: 'commented on' }[action]} ${subject}${details || '.'}`;
  if (action === 'comment' && result === 'uncertain-draft') return `couldn't confirm commenting on ${subject}${details}. a draft may remain; comments are off for this session. continuing warm-up.`;
  if (result === 'uncertain') return `couldn't confirm ${pending}${details || '. continuing.'}`;
  if (action === 'comment' && result === 'draft-retained') return permanent ? `comment skipped for ${subject}. a draft may remain; comments are off for this session. continuing warm-up.`
    : `comment skipped for ${subject}. a draft may remain, so comments are paused until the comment box is clear. continuing warm-up.`;
  if (action === 'comment' && result === 'not-typed') return permanent ? `comment skipped for ${subject}. the comment box stayed empty after typing again, so comments are off for this session. continuing warm-up.`
    : `comment skipped for ${subject}. the comment box stayed empty after typing. continuing warm-up.`;
  return `${action} skipped for ${subject}. the post changed or its control wasn't available.`;
}

function pickAction(eligible, weights, random = Math.random) {
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
  const choices = [['scroll', 1], ['read', 1], ['scroll', 1]];
  for (const action of eligible) if (weights[action] > 0 && total > 0) choices.push([action, 4 * weights[action] / total]);
  let point = Math.max(0, Math.min(0.999999, random())) * choices.reduce((sum, entry) => sum + entry[1], 0);
  for (const [action, weight] of choices) { point -= weight; if (point < 0) return action; }
  return 'scroll';
}

function actionCadenceMs(settings, action) {
  return settings.limits[action] > 0 ? settings.minutes * 60000 / settings.limits[action] : Infinity;
}

function actionDebt(settings, stats, action, elapsedMs) {
  return Math.max(0, expectedActions(settings, action, elapsedMs) - stats[action]);
}

function shortSessionScale(settings) {
  return Math.min(1, settings.minutes / 3);
}

function actionWarmups(settings, action) {
  const warmups = { like: [12000, 30000], follow: [35000, 60000], comment: [60000, 120000] };
  const scale = shortSessionScale(settings);
  const limit = scale < 1 ? settings.minutes * 60000 / 3 : Infinity;
  return (warmups[action] || warmups.like).map(ms => Math.min(limit, Math.round(ms * scale)));
}

function actionSchedule(settings, action) {
  let cadence = actionCadenceMs(settings, action);
  const [minWarmup, maxWarmup] = actionWarmups(settings, action);
  const warmup = Math.min(maxWarmup, Math.max(minWarmup, cadence * .75));
  // Leave the final 15% for missed opportunities, loading and confirmation.
  if (action === 'like' && settings.limits.like > 1) cadence = (settings.minutes * 60000 * .85 - warmup) / (settings.limits.like - 1);
  return { warmup, cadence };
}

function expectedActions(settings, action, elapsedMs) {
  const { warmup, cadence } = actionSchedule(settings, action);
  if (!settings.weights[action] || !Number.isFinite(cadence)) return 0;
  if (elapsedMs < warmup) return 0;
  return Math.min(settings.limits[action], Math.floor((elapsedMs - warmup) / cadence) + 1);
}

function actionSpacing(settings, action) {
  const cadence = actionCadenceMs(settings, action);
  if (action === 'like') {
    const min = Math.max(5000, Math.round(cadence * .25));
    return [min, Math.max(min + 1500, Math.round(cadence * .6))];
  }
  if (action === 'follow') {
    const min = Math.max(18000, Math.round(cadence * .35));
    return [min, Math.max(min + 4000, Math.round(cadence * .8))];
  }
  if (action === 'comment') {
    const min = Math.max(60000, Math.round(cadence * .35));
    return [min, Math.max(min + 7000, Math.round(cadence * .8))];
  }
  const min = Math.max(9000, Math.round(cadence * .55));
  const max = Math.max(min + 3000, Math.round(cadence * 1.1));
  return [min, max];
}

function targetAction(eligible, settings, stats, elapsedMs, focus = 'balanced') {
  const debts = eligible.map(action => {
    const expected = expectedActions(settings, action, elapsedMs);
    const debt = Math.max(0, expected - stats[action]);
    return { action, debt, score: expected > 0 ? debt / expected : 0 };
  }).filter(item => item.debt > 0);
  if (!debts.length) return null;
  if (debts.some(item => item.action === focus)) return focus;
  debts.sort((a, b) => b.score - a.score || b.debt - a.debt || actionCadenceMs(settings, a.action) - actionCadenceMs(settings, b.action));
  return debts[0].action;
}

const SAME_POST_GAP_MS = [2500, 6000];
const MAX_ACTIONS_PER_POST = 2;
const SAME_POST_HOLD_MS = 8000;
const BURST_WINDOW_MS = 60000;
const MAX_ACTIONS_PER_WINDOW = 6;
const DRAFT_LIFT_MIN_MS = 90000;
const DRAFT_CHECK_GAP_MS = 15000;
const DRAFT_LIFT_COOLDOWN_MS = 120000;
const MAX_DRAFT_LIFTS = 1;
const SKIP_REPEAT_MS = 180000;
const REVISIT_GRACE_MS = 120000;
const DISCOVERY_GRACE_MS = 30000;
const COMMENT_SKIP_COPY = Object.freeze({
  'off-niche': "this post doesn't mention your keywords.",
  bait: 'this post asks for a keyword reply or giveaway entry.',
  suspicious: 'this caption looks like spam.',
  sensitive: 'this post looks sensitive or heated.',
  exhausted: 'the relevant comment wording has already been used.',
  invalid: "this caption can't be read safely."
});
const COMMENT_BLOCKER_COPY = Object.freeze({
  account: "couldn't find your instagram account link, so comments are skipped.",
  language: "instagram isn't in english, so the comment box can't be found. switch instagram to english for comments.",
  composer: "couldn't find one clear comment box on this post."
});
// TikTok reports only these two blockers; a non-English TikTok stops the session instead.
const TIKTOK_COMMENT_BLOCKER_COPY = Object.freeze({
  account: "couldn't find your tiktok account link, so comments are skipped.",
  composer: "couldn't find one clear comment box on this post."
});
const WRITER_MISSING = 'comments are unavailable in this version. reinstall the extension from the setup page.';
const ONCE_PER_SESSION_REASONS = new Set([COMMENT_BLOCKER_COPY.account, COMMENT_BLOCKER_COPY.language, WRITER_MISSING]);
const TIKTOK_ONCE_PER_SESSION_REASONS = new Set([TIKTOK_COMMENT_BLOCKER_COPY.account, WRITER_MISSING]);
// Keyword rotation window. TikTok keeps two minutes until the TikTok goals
// simulation shows six-minute windows keep the same reach; then raise it here.
const KEYWORD_WINDOW_MS = Object.freeze({ instagram: 360000, tiktok: 120000 });
// Two typed comments in a row that never reached TikTok's editor turn comments off.
const MAX_UNTYPED_COMMENTS = 2;
// TikTok search terms can come back with different case, spacing or Unicode form.
const searchTermKey = value => typeof value === 'string' ? value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase() : null;

// One awaited action at a time. No action begins after cancellation or the deadline.
async function runSession(settings, adapter, signal, options = {}) {
  const platform = settings.platform || 'instagram';
  const writer = typeof globalThis.commentWriter?.writeComment === 'function' ? globalThis.commentWriter : null;
  const nicheMatch = text => writer ? writer.looseNicheMatch(text, settings.terms) : matchesNiche(text, settings.terms);
  const keyOf = text => writer ? writer.commentKey(text) : text.toLocaleLowerCase();
  const now = options.now || Date.now;
  const sleep = options.sleep || ((ms, abortSignal) => delay(ms, undefined, { signal: abortSignal }));
  const random = options.random || Math.random;
  const commentSalt = typeof options.commentSalt === 'string' ? options.commentSalt.slice(0, 64) : '';
  const checkpoint = options.checkpoint?.version === 1 ? options.checkpoint : null;
  const nonnegative = (value, fallback = 0) => Number.isFinite(value) && value >= 0 ? value : fallback;
  const resumedAt = now();
  const totalMs = settings.minutes * 60000;
  const elapsedMs = Math.min(totalMs, nonnegative(checkpoint?.elapsedMs));
  const startedAt = resumedAt - elapsedMs;
  const remainingMs = Math.min(totalMs - elapsedMs, nonnegative(checkpoint?.remainingMs, totalMs), nonnegative(options.remainingMs, totalMs));
  const deadline = resumedAt + remainingMs;
  const nextAllowed = Object.fromEntries(['like', 'follow', 'comment'].map(action => [action,
    resumedAt + nonnegative(checkpoint?.cooldowns?.[action], actionWarmups(settings, action)[0])
  ]));
  let nextEngagement = resumedAt + nonnegative(checkpoint?.cooldowns?.engagement, nextAllowed.like - resumedAt);
  let nextBreak = resumedAt + nonnegative(checkpoint?.cooldowns?.break, randomBetween(300000, 540000, random));
  const termWindowMs = Math.max(10000, Math.min(KEYWORD_WINDOW_MS[platform] ?? KEYWORD_WINDOW_MS.tiktok, settings.minutes * 60000 / settings.terms.length));
  let nextTermAt = Infinity;
  let termIndex = Math.floor(nonnegative(checkpoint?.termIndex));
  const stats = { scroll: 0, read: 0, search: 0, open: 0, like: 0, follow: 0, comment: 0, skipped: 0 };
  for (const key of Object.keys(stats)) stats[key] = nonnegative(checkpoint?.stats?.[key]);
  // Background tabs can round sub-second timers up during confirmation.
  const confirmationBudgetMs = { like: platform === 'tiktok' ? 22000 : 8000, follow: 22000, comment: 20000 };
  const unconfirmed = { like: 0, follow: 0, comment: 0 };
  for (const key of Object.keys(unconfirmed)) unconfirmed[key] = nonnegative(checkpoint?.unconfirmed?.[key]);
  const strings = values => Array.isArray(values) ? values.filter(value => typeof value === 'string') : [];
  const seen = new Set(strings(checkpoint?.seen));
  const hasSeen = id => seen.has(postIdentity(id));
  const done = Object.fromEntries(['like', 'follow', 'comment'].map(action => [action, new Set(strings(checkpoint?.done?.[action]))]));
  const pausedActions = new Set(strings(checkpoint?.pausedActions).filter(action => action in done));
  const usedComments = new Set(strings(checkpoint?.usedComments));
  // Search membership belongs to one requested query in this run. A viewer's
  // recommendations cannot grant themselves eligibility through hidden tiles.
  const searchResults = new Set();
  let searchGridOwned = false;
  const searchedTerms = new Set();
  let revisitedTerm = false;
  let sequenceHigh = 0;
  let gridProgressAt = resumedAt;
  const reportedSkips = new Set();
  const reasonReportedAt = new Map();
  // Each platform names itself in its blocker copy, and its own account note is once per session.
  const blockerCopy = platform === 'tiktok' ? TIKTOK_COMMENT_BLOCKER_COPY : COMMENT_BLOCKER_COPY;
  const oncePerSession = platform === 'tiktok' ? TIKTOK_ONCE_PER_SESSION_REASONS : ONCE_PER_SESSION_REASONS;
  const reasonAllowed = reason => oncePerSession.has(reason) ? !reasonReportedAt.has(reason) : !(now() - (reasonReportedAt.get(reason) ?? -Infinity) < SKIP_REPEAT_MS);
  let untypedComments = 0;
  let samePost = null, samePostReadyAt = 0, samePostCount = 0;
  const engagementStarts = [];
  let currentSearchTerm = settings.terms.includes(checkpoint?.currentSearchTerm) ? checkpoint.currentSearchTerm : null;
  let stalled = 0;
  let retrySearch = false;
  let needsSearchScroll = false;
  // Scrolling or reloading the same results is not discovery. Only reaching a
  // new post replenishes recovery attempts; retain seen/action history throughout.
  let discoveryWindowStartedAt = resumedAt;
  let recoverySearches = 0;
  const maxRecoverySearches = Math.max(2, settings.terms.length);
  const discoveredPost = () => { discoveryWindowStartedAt = now(); recoverySearches = 0; };
  let previousAction;
  let lastWatchWasFull = false;
  let consecutiveSkims = 0;
  let videosSinceFullWatch = 0;
  const fullWatchInterval = () => platform === 'instagram' ? randomBetween(5, 9, random) : randomBetween(16, 24, random);
  let nextFullWatchAfter = fullWatchInterval();
  const running = () => !signal.aborted && now() < deadline;
  const comments = Array.isArray(checkpoint?.comments) ? checkpoint.comments.map(item => ({ ...item })) : [];
  let inFlight = checkpoint?.inFlight && checkpoint.inFlight.action in done ? { ...checkpoint.inFlight } : null;
  const savedHold = checkpoint?.draftHold;
  let draftHold = savedHold && typeof savedHold === 'object' ? {
    comment: typeof savedHold.comment === 'string' ? savedHold.comment : '', postId: typeof savedHold.postId === 'string' ? savedHold.postId : '',
    since: startedAt + nonnegative(savedHold.sinceMs), lastCheckAt: startedAt + nonnegative(savedHold.lastCheckMs),
    checks: Number.isInteger(savedHold.checks) ? savedHold.checks : 0, lifts: Number.isInteger(savedHold.lifts) ? savedHold.lifts : MAX_DRAFT_LIFTS,
    reason: ['draft-retained', 'permanent', 'lifted'].includes(savedHold.reason) ? savedHold.reason : 'permanent'
  } : null;
  // Only a draft-retained result (no Post click) can later be lifted, once,
  // after two read-only checks on another post show no copy of the text.
  const pauseComments = (result, comment, postKey) => {
    pausedActions.add('comment');
    const lifts = draftHold?.lifts || 0;
    const liftable = result === 'draft-retained' && ['instagram', 'tiktok'].includes(platform) && typeof adapter.draftState === 'function' &&
      lifts < MAX_DRAFT_LIFTS && typeof comment === 'string' && comment.trim().length > 0;
    draftHold = { comment: typeof comment === 'string' ? comment.slice(0, 500) : '', postId: typeof postKey === 'string' ? postKey.slice(0, 2048) : '',
      since: now(), lastCheckAt: now(), checks: 0, lifts, reason: liftable ? 'draft-retained' : 'permanent' };
    return liftable;
  };
  const settleInterrupted = () => {
    if (!inFlight) return;
    const { action, key, comment, post, time } = inFlight;
    done[action].add(key);
    unconfirmed[action] += 1;
    stats.skipped += 1;
    if (action === 'comment') {
      pauseComments('permanent', comment, key);
      if (typeof comment === 'string') {
        usedComments.add(keyOf(comment));
        comments.push({ text: comment, url: post?.id, author: post?.author, time, status: 'uncertain' });
      }
    }
    inFlight = null;
  };
  settleInterrupted();
  // Version 1 is stored together with the original validated settings. Durations
  // are remaining active-run milliseconds, so time away cannot reset cooldowns.
  // Preserve full history; never trim it into repeat eligibility. Fail closed at
  // 10,000 history keys (2,048 chars each) or 1,000 comment records per session.
  const saveCheckpoint = async () => {
    if (!adapter.checkpoint) return;
    const collections = [seen, usedComments, ...Object.values(done)];
    if (collections.some(values => values.size > 10000 || [...values].some(value => typeof value !== 'string' || value.length > 2048)) || comments.length > 1000) {
      throw new Error('session history is full. start a new session.');
    }
    const at = now();
    await adapter.checkpoint({
      version: 1, stats: { ...stats }, unconfirmed: { ...unconfirmed }, pausedActions: [...pausedActions],
      comments: comments.map(item => ({ ...item })), seen: [...seen],
      done: Object.fromEntries(Object.entries(done).map(([action, keys]) => [action, [...keys]])),
      usedComments: [...usedComments], termIndex, currentSearchTerm,
      elapsedMs: Math.min(totalMs, Math.max(0, at - startedAt)), remainingMs: Math.max(0, deadline - at),
      cooldowns: Object.fromEntries([...Object.entries(nextAllowed), ['engagement', nextEngagement], ['break', nextBreak]].map(([action, until]) => [action, Math.max(0, until - at)])),
      inFlight: inFlight ? { ...inFlight, post: { ...inFlight.post } } : null,
      draftHold: draftHold ? { comment: draftHold.comment, postId: draftHold.postId, sinceMs: Math.min(totalMs, Math.max(0, draftHold.since - startedAt)),
        lastCheckMs: Math.min(totalMs, Math.max(0, draftHold.lastCheckAt - startedAt)), checks: Math.min(10, draftHold.checks), lifts: draftHold.lifts, reason: draftHold.reason } : null
    });
  };
  const update = message => adapter.update({
    stats: { ...stats }, unconfirmed: { ...unconfirmed }, pausedActions: [...pausedActions],
    comments: comments.map(item => ({ ...item })), remainingMs: Math.max(0, deadline - now()),
    deadline, phase: 'action', nextActionAt: null, message
  });
  const likeSchedule = actionSchedule(settings, 'like');
  const nextLikeAt = () => stats.like + unconfirmed.like < settings.limits.like && settings.weights.like
    ? startedAt + likeSchedule.warmup + (stats.like + unconfirmed.like) * likeSchedule.cadence : Infinity;
  const totalEngagementDebt = () => ['like', 'follow', 'comment'].reduce((sum, action) => sum + (pausedActions.has(action) ? 0 : actionDebt(settings, { ...stats, [action]: stats[action] + unconfirmed[action] }, action, now() - startedAt)), 0);
  const viewerPause = () => {
    videosSinceFullWatch += 1;
    // Missing controls or a target falling behind must not make TikTok race
    // through posts. Give each viewer time to render before inspecting again.
    if (platform === 'tiktok') return !lastWatchWasFull && videosSinceFullWatch >= nextFullWatchAfter ? 'fullwatch' : 'watch';
    // Viewing is independent of engagement targets. Missing controls and a
    // longer watch must never create a catch-up burst through the next posts.
    const previousWasFull = lastWatchWasFull;
    lastWatchWasFull = false;
    if (!previousWasFull && (videosSinceFullWatch >= nextFullWatchAfter || (videosSinceFullWatch >= 3 && random() < .12))) {
      consecutiveSkims = 0;
      lastWatchWasFull = true;
      videosSinceFullWatch = 0;
      nextFullWatchAfter = fullWatchInterval();
      return 'fullwatch';
    }
    if (consecutiveSkims < 2 && random() < .28 / settings.pauseScale) {
      consecutiveSkims += 1;
      return 'skim';
    }
    consecutiveSkims = 0;
    return 'watch';
  };
  const watchVideoRemainder = async initialPost => {
    const initial = initialPost.videoPlayback;
    const until = Math.min(deadline, nextTermAt, now() + initialPost.videoRemainingMs + 8000);
    let previous = initial;
    let lastProgressAt = now();
    let progressed = false;
    while (running() && now() < until) {
      const remaining = (previous.durationMs - previous.positionMs) / previous.rate;
      const ms = Math.min(1000, Math.max(100, remaining / 2), until - now());
      adapter.update({ phase: 'pause', nextActionAt: now() + ms });
      await sleep(ms, signal);
      if (!running()) return;
      adapter.update({ phase: 'action', nextActionAt: null });
      if (now() >= nextTermAt) return;
      const page = await adapter.inspect(signal);
      if (!running()) return;
      if (page.blocked) throw new Error(page.blocked);
      const playback = page.post?.videoPlayback;
      if (postIdentity(page.post?.id) !== postIdentity(initialPost.id) || !playback ||
          playback.source !== initial.source || playback.durationMs !== initial.durationMs) return;
      // A real end, or a loop after observed progress near the end, completes
      // the watch. Elapsed wall time alone cannot establish playback progress.
      const wrapWindow = Math.max(1500, previous.rate * 1500);
      const wrapped = progressed && previous.durationMs - previous.positionMs <= wrapWindow &&
        playback.positionMs < previous.positionMs && playback.positionMs <= wrapWindow;
      if (playback.ended || wrapped) return;
      if (playback.positionMs > previous.positionMs + 20) {
        progressed = true;
        lastProgressAt = now();
      } else if (playback.positionMs < previous.positionMs - 20 || now() - lastProgressAt >= 8000) return;
      previous = playback;
    }
  };
  const pause = async (action = 'browse') => {
    if (!running()) return;
    await saveCheckpoint();
    if (!running()) return;
    const ranges = { transition: [500, 1800], browse: [1800, 5200], retry: [6000, 10000], exhausted: [10000, 15000], skim: [350, 1400], watch: [4000, 12000], fullwatch: [14000, 26000], read: [7000, 16000], like: [9000, 24000], follow: [16000, 36000], comment: [24000, 52000] };
    let [min, max] = ranges[platform === 'tiktok' && action === 'fullwatch' ? 'watch' : action] || ranges.browse;
    if (platform === 'instagram') {
      if (action === 'skim') { min = 1500; max = 4000; }
      if (action === 'watch') { min = 6000; max = 18000; }
      if (action === 'fullwatch') { min = 10000; max = 22000; }
    }
    let fullWatchMs = null;
    if (now() >= nextBreak && totalEngagementDebt() < 3 && nextLikeAt() - now() >= 45000 * settings.pauseScale) {
      min = 20000; max = 45000;
      nextBreak = now() + randomBetween(300000, 540000, random);
      update('taking a longer break…');
    } else if (now() >= nextBreak) {
      nextBreak = now() + randomBetween(45000, 90000, random);
    } else if (action === 'watch' || action === 'fullwatch') {
      const tryFullWatch = action === 'fullwatch' || (platform === 'tiktok' && !lastWatchWasFull && random() < 0.25);
      if (platform === 'tiktok') lastWatchWasFull = false;
      if (tryFullWatch) {
        const page = await adapter.inspect(signal);
        if (!running()) return;
        if (page.blocked) throw new Error(page.blocked);
        const remaining = page.post?.viewer ? page.post.videoRemainingMs : null;
        const viewingDeadline = Math.min(deadline, nextTermAt, platform === 'tiktok' ? nextLikeAt() : Infinity);
        if (Number.isFinite(remaining) && remaining > (platform === 'instagram' ? 500 : 10000 * settings.pauseScale) && remaining <= 120000 &&
            remaining <= viewingDeadline - now() && (platform !== 'instagram' || page.post.videoPlayback?.playing)) {
          fullWatchMs = remaining;
          if (platform === 'tiktok') {
            lastWatchWasFull = true;
            videosSinceFullWatch = 0;
            nextFullWatchAfter = fullWatchInterval();
          }
          update('staying for the rest of this video…');
          if (platform === 'instagram') { await watchVideoRemainder(page.post); return; }
        }
      }
    }
    const minimum = platform === 'tiktok' && ['watch', 'fullwatch', 'retry'].includes(action) ? 6000 : 0;
    const ms = Math.min(Math.max(minimum, fullWatchMs ?? randomBetween(Math.round(min * settings.pauseScale), Math.round(max * settings.pauseScale), random)), deadline - now(), Math.max(0, nextTermAt - now()));
    adapter.update({ phase: 'pause', nextActionAt: now() + ms });
    await sleep(ms, signal);
    if (running()) adapter.update({ phase: 'action', nextActionAt: null });
  };
  const search = async (resumeCurrent = false) => {
    const term = resumeCurrent && currentSearchTerm ? currentSearchTerm : settings.terms[termIndex % settings.terms.length];
    currentSearchTerm = term;
    searchResults.clear();
    searchGridOwned = false;
    revisitedTerm = searchedTerms.has(term) || Boolean(resumeCurrent && checkpoint);
    searchedTerms.add(term);
    sequenceHigh = 0;
    gridProgressAt = now();
    if (!resumeCurrent || !checkpoint?.currentSearchTerm) termIndex += 1;
    nextTermAt = settings.terms.length > 1 ? now() + termWindowMs : Infinity;
    update(`searching for ${term}…`);
    await saveCheckpoint();
    if (!running()) return;
    const loaded = await adapter.search(term, signal);
    if (!running()) return;
    discoveryWindowStartedAt = now();
    retrySearch = loaded === false;
    if (loaded === false) {
      currentSearchTerm = null;
      stats.skipped += 1;
      stalled = 2;
      update('search is slow or empty. trying another search...');
      return;
    }
    stalled = 0;
    stats.search += 1;
    needsSearchScroll = platform !== 'tiktok';
    previousAction = undefined;
    update(`opened search: ${term}`);
  };
  const recoverSearch = async () => {
    if (!running()) return;
    if (recoverySearches >= maxRecoverySearches) {
      throw new Error(`${platform} still isn't showing new posts. session stopped. check the results in ${platform} or try different keywords before restarting.`);
    }
    recoverySearches += 1;
    update(settings.terms.length > 1 ? 'results stopped advancing. trying the next keyword...' : 'results stopped advancing. refreshing this search...');
    await search();
  };
  let failure;
  try {
  update(checkpoint ? 'resuming your niche session…' : 'starting your niche session…');
  await saveCheckpoint();
  if (!running()) return stats;
  await search(Boolean(checkpoint && currentSearchTerm));
  while (running()) {
    await saveCheckpoint();
    if (!running()) break;
    let pauseAfter = 'browse';
    const page = await adapter.inspect(signal);
    if (!running()) break;
    if (page.blocked) throw new Error(page.blocked);
    if (page.unavailable) {
      stats.skipped += 1;
      update('waiting for the page to finish loading...');
      await sleep(Math.min(1500, deadline - now()), signal);
      stalled += 1;
      if (running() && stalled >= 3) await recoverSearch();
      continue;
    }
    if (page.unavailableViewer) {
      stats.skipped += 1;
      update('that post is unavailable. returning to search...');
      const recovered = await adapter.leavePost({ id: page.unavailableViewer, viewer: true, close: true }, signal);
      if (!running()) break;
      if (recovered) {
        stalled = 0;
        update('continuing from your search results...');
      } else {
        stalled += 1;
        await recoverSearch();
      }
      if (running()) await pause('transition');
      continue;
    }
    if (page.post?.id) {
      if (!hasSeen(page.post.id)) discoveredPost();
      seen.add(postIdentity(page.post.id));
    }
    // TikTok membership comes from this run's grid for the requested query, or
    // that same grid still loaded behind its search viewer.
    if (platform === 'tiktok' && currentSearchTerm !== null && page.search && Array.isArray(page.search.posts)) {
      const sameTerm = !page.post && searchTermKey(page.search.term) === searchTermKey(currentSearchTerm);
      if (sameTerm) searchGridOwned = true;
      else if (page.search.behindViewer !== true) searchGridOwned = false;
      if (sameTerm || (page.search.behindViewer === true && page.post?.viewer && searchGridOwned)) {
        for (const id of page.search.posts) {
          const identity = tiktokPostIdentity(id);
          if (identity && searchResults.size < 1000) searchResults.add(identity);
        }
      }
    } else if (platform === 'tiktok' && !page.post && !page.search) searchGridOwned = false;
    // Instagram membership comes only from the grid of the query this run loaded.
    if (platform === 'instagram' && currentSearchTerm !== null && page.search && Array.isArray(page.search.posts)) {
      const sameTerm = typeof page.search.term === 'string' && page.search.term.normalize('NFKC').trim().toLocaleLowerCase() === currentSearchTerm.normalize('NFKC').trim().toLocaleLowerCase();
      if (sameTerm) searchGridOwned = true;
      else if (page.search.behindViewer !== true) searchGridOwned = false;
      if (sameTerm || (page.search.behindViewer === true && page.post?.viewer && searchGridOwned)) {
        for (const id of page.search.posts) {
          const identity = postIdentity(id);
          if (typeof identity === 'string' && identity.startsWith('instagram:') && searchResults.size < 1000) searchResults.add(identity);
        }
      }
    } else if (platform === 'instagram' && !page.post && !page.search) searchGridOwned = false;
    if (['instagram', 'tiktok'].includes(platform) && pausedActions.has('comment') && draftHold?.reason === 'draft-retained' && draftHold.lifts < MAX_DRAFT_LIFTS &&
        typeof adapter.draftState === 'function' && page.post?.id && postIdentity(page.post.id) !== draftHold.postId &&
        now() - draftHold.since >= DRAFT_LIFT_MIN_MS * settings.pauseScale && now() - draftHold.lastCheckAt >= DRAFT_CHECK_GAP_MS) {
      const state = await adapter.draftState(draftHold.comment, signal);
      if (!running()) break;
      draftHold.lastCheckAt = now();
      draftHold.checks = state === 'absent' ? draftHold.checks + 1 : 0;
      if (draftHold.checks >= 2) {
        pausedActions.delete('comment');
        draftHold = { ...draftHold, checks: 0, lifts: draftHold.lifts + 1, reason: 'lifted' };
        nextAllowed.comment = Math.max(nextAllowed.comment, now() + DRAFT_LIFT_COOLDOWN_MS * settings.pauseScale);
        update('the comment box is clear again. comments are back on.');
      }
    }
    const candidates = [...new Set([...(page.sequence || []), ...(page.posts || [])])].filter(id => !hasSeen(id));
    if (!page.post && Array.isArray(page.sequence) && page.sequence.length > sequenceHigh) { sequenceHigh = page.sequence.length; gridProgressAt = now(); }
    const discoveryGraceMs = revisitedTerm && now() - gridProgressAt < DISCOVERY_GRACE_MS ? REVISIT_GRACE_MS : DISCOVERY_GRACE_MS;
    const discoveryStalled = now() - discoveryWindowStartedAt >= discoveryGraceMs &&
      ((!page.post && !candidates.length) || stalled >= 2);
    if (retrySearch || discoveryStalled) {
      // Allow delayed results to arrive before replacing the current search.
      // Even successful scrolls must eventually produce a usable, unseen post.
      await recoverSearch();
      pauseAfter = 'retry';
    } else if (now() >= nextTermAt) {
      await search();
      pauseAfter = 'transition';
    } else if (!needsSearchScroll && !page.post && candidates.length) {
      const target = candidates[0];
      seen.add(postIdentity(target));
      update('opening a matching post…');
      const opened = await adapter.open(target, signal);
      if (!running()) break;
      if (opened === false) {
        stats.skipped += 1;
        stalled += 1;
        update("couldn't open that post. trying another...");
        await pause('transition');
        continue;
      }
      stats.open += 1;
      stalled = 0;
      discoveredPost();
      update('watching a post from your search.');
      pauseAfter = viewerPause();
    } else {
      const post = page.post;
      const eligible = [];
      const waiting = [];
      let canLike = false;
      let commentText = null;
      let commentTemplateKey = null;
      let burstOpen = false;
      if (post) {
        const postKey = postIdentity(post.id);
        const textMatches = nicheMatch(typeof post.text === 'string' ? post.text : '');
        const fromSearch = platform === 'tiktok' ? searchResults.has(tiktokPostIdentity(post.id)) : searchResults.has(postKey);
        const wantsComment = Boolean(settings.weights.comment && stats.comment + unconfirmed.comment < settings.limits.comment && !pausedActions.has('comment') && !done.comment.has(postKey));
        // TikTok confirms a comment by its exact text, so it gets plain ASCII wording only.
        const written = wantsComment && writer ? writer.writeComment({ caption: post.caption, text: post.text, terms: settings.terms, used: usedComments, postId: postKey, salt: commentSalt, plainText: platform === 'tiktok' }) : null;
        const burstFree = engagementStarts.filter(time => now() - time < BURST_WINDOW_MS * settings.pauseScale).length < MAX_ACTIONS_PER_WINDOW;
        const onSame = samePost === postKey;
        const skipReasons = new Map();
        for (const action of ['like', 'follow', 'comment']) {
          const key = action === 'follow' ? post.author : postKey;
          if (!settings.weights[action] || pausedActions.has(action) || deadline - now() < confirmationBudgetMs[action] ||
              stats[action] + unconfirmed[action] >= settings.limits[action] || (key && done[action].has(key))) continue;
          let reason;
          if (!textMatches && !(action !== 'comment' && fromSearch)) reason = action === 'comment'
            ? COMMENT_SKIP_COPY['off-niche'] : platform === 'tiktok'
              ? 'this post does not match your keywords or current search results.' : "this post isn't from your search and doesn't mention your keywords.";
          else if (action === 'comment' && !writer) reason = WRITER_MISSING;
          else if (!key || !post[action]) reason = action === 'comment' && typeof post.commentBlocker === 'string' && Object.hasOwn(blockerCopy, post.commentBlocker)
            ? blockerCopy[post.commentBlocker] : 'its control is not available on this post.';
          else if (action === 'comment' && !written?.text) reason = Object.hasOwn(COMMENT_SKIP_COPY, written?.reason) ? COMMENT_SKIP_COPY[written.reason] : COMMENT_SKIP_COPY.exhausted;
          if (reason) {
            if (!reportedSkips.has(postKey) && reasonAllowed(reason) && now() >= nextEngagement && now() >= nextAllowed[action] &&
                expectedActions(settings, action, now() - startedAt) > stats[action] + unconfirmed[action]) {
              const actions = skipReasons.get(reason) || [];
              actions.push(action);
              skipReasons.set(reason, actions);
            }
            continue;
          }
          if (onSame && samePostCount >= MAX_ACTIONS_PER_POST) continue;
          if (action === 'like') canLike = true;
          const gateAt = onSame ? samePostReadyAt : nextEngagement;
          if (burstFree && now() >= gateAt && now() >= nextAllowed[action]) eligible.push(action);
          else if (burstFree && onSame && post.viewer && expectedActions(settings, action, now() - startedAt) > stats[action] + unconfirmed[action]) {
            waiting.push({ action, at: Math.max(gateAt, nextAllowed[action]) });
          }
        }
        if (skipReasons.size) {
          reportedSkips.add(postKey);
          for (const reason of skipReasons.keys()) reasonReportedAt.set(reason, now());
          update([...skipReasons].map(([reason, actions]) => `${actions.join(' / ')} skipped: ${reason}`).join(' '));
        }
        commentText = written?.text || null;
        commentTemplateKey = written?.templateKey || null;
        burstOpen = burstFree;
      }
      // A second, different action on the same post waits in place only for a due
      // action whose own spacing is nearly over. The post is inspected again first.
      const hold = waiting.filter(item => item.at > now() && item.at - now() <= SAME_POST_HOLD_MS * settings.pauseScale && item.at + confirmationBudgetMs[item.action] <= deadline)
        .sort((a, b) => a.at - b.at)[0];
      if (!needsSearchScroll && post?.viewer && !eligible.length && hold) {
        const until = Math.min(hold.at, nextTermAt, deadline);
        update('watching this post...');
        adapter.update({ phase: 'pause', nextActionAt: until });
        await sleep(Math.max(0, until - now()), signal);
        if (running()) adapter.update({ phase: 'action', nextActionAt: null });
        continue;
      }
      const likeReadyAt = Math.max(nextEngagement, nextAllowed.like);
      if (!needsSearchScroll && post?.viewer && canLike && burstOpen && nextLikeAt() <= now() && likeReadyAt > now() &&
          likeReadyAt - now() <= 12000 * settings.pauseScale && likeReadyAt + confirmationBudgetMs.like <= deadline) {
        // Keep a suitable unliked post during a short cooldown; inspect it again
        // before acting so changed posts, restrictions and Stop remain binding.
        const until = Math.min(likeReadyAt, nextTermAt, deadline);
        update('watching this post...');
        adapter.update({ phase: 'pause', nextActionAt: until });
        await sleep(Math.max(0, until - now()), signal);
        if (running()) adapter.update({ phase: 'action', nextActionAt: null });
        continue;
      }
      let action = needsSearchScroll || !post ? 'scroll' : pickAction(eligible, settings.weights, random);
      const focus = options.getFocus ? options.getFocus() : settings.focus;
      const target = needsSearchScroll ? null : targetAction(eligible, settings, stats, now() - startedAt, focus);
      if (target) action = target;
      if (action === 'read' && (post?.viewer || previousAction === 'read')) action = 'scroll';
      previousAction = action;
      pauseAfter = action;
      if (action === 'read') {
        stats.read += 1;
        update('taking a reading pause…');
      } else if (action === 'scroll') {
        needsSearchScroll = false;
        const inViewer = Boolean(post?.viewer && adapter.advance);
        update(inViewer ? 'moving to the next post…' : 'scrolling for more posts…');
        const moved = inViewer ? await adapter.advance(post, signal, hasSeen) : await adapter.scroll(signal);
        if (!running()) break;
        if (moved === 'login') throw new Error(`sign in to ${platform}, then start a new session.`);
        if (moved) { stats.scroll += 1; stalled = 0; } else { stats.skipped += 1; stalled += 1; }
        if (post && (!inViewer || !moved)) await adapter.leavePost(post, signal);
        if (inViewer && moved) pauseAfter = viewerPause();
        if (!post && !moved && stalled >= 2) pauseAfter = 'exhausted';
        else if (!post && moved && !candidates.length && revisitedTerm) pauseAfter = 'transition';
        update(inViewer ? (moved ? 'watching the next post.' : 'continuing from your search results...') : (moved ? 'scrolled to more content.' : 'scrolling made no progress. waiting for results...'));
      } else {
        const key = action === 'follow' ? post.author : postIdentity(post.id);
        if (post.viewer) pauseAfter = 'transition';
        done[action].add(key);
        const cadence = actionCadenceMs(settings, action);
        const engagementSpacing = action === 'like' ? [Math.max(3000, Math.round(cadence * .15)), Math.max(7000, Math.round(cadence * .45))] :
          action === 'follow' ? [8000, 18000] :
          action === 'comment' ? [10000, 22000] : [20000, 45000];
        nextEngagement = now() + randomBetween(...engagementSpacing, random) * settings.pauseScale * shortSessionScale(settings);
        nextAllowed[action] = now() + randomBetween(...actionSpacing(settings, action), random) * settings.pauseScale;
        if (samePost !== postIdentity(post.id)) { samePost = postIdentity(post.id); samePostCount = 0; }
        samePostCount += 1;
        samePostReadyAt = now() + randomBetween(...SAME_POST_GAP_MS, random) * settings.pauseScale;
        engagementStarts.push(now());
        if (engagementStarts.length > MAX_ACTIONS_PER_WINDOW) engagementStarts.shift();
        let comment;
        let templateKey = null;
        if (action === 'comment') {
          comment = commentText;
          templateKey = commentTemplateKey;
          usedComments.add(keyOf(comment));
          if (templateKey) usedComments.add(templateKey);
        }
        inFlight = { action, key, comment: comment || null, post: { id: post.id, ...(typeof post.author === 'string' ? { author: post.author } : {}) }, time: now() };
        // Persist the reservation before the adapter can click or type. A lost
        // runner is then an uncertain attempt, never permission to try it twice.
        try { await saveCheckpoint(); }
        catch (error) { inFlight = null; throw error; }
        if (!running()) { inFlight = null; break; }
        update(engagementMessage(action, post, comment, 'pending'));
        const result = await adapter.engage(action, post, comment, signal);
        // A definitive skip guarantees no submission or remaining draft. Keep
        // its wording available for another post, but retain this post's guard.
        if (action === 'comment' && ['skipped', 'not-typed'].includes(result)) { usedComments.delete(keyOf(comment)); if (templateKey) usedComments.delete(templateKey); }
        if (action === 'comment' && ['confirmed', 'uncertain', 'uncertain-draft'].includes(result)) {
          comments.push({ text: comment, url: post.id, author: typeof post.author === 'string' ? post.author : undefined, time: now(), status: result === 'confirmed' ? 'confirmed' : 'uncertain' });
        }
        // Count a verified result even if Stop arrived during the final confirmation.
        if (result === 'confirmed') stats[action] += 1;
        else if (['uncertain', 'uncertain-draft'].includes(result)) {
          unconfirmed[action] += 1;
          stats.skipped += 1;
        }
        else stats.skipped += 1;
        let liftable = false;
        if (action === 'comment' && ['draft-retained', 'uncertain-draft'].includes(result)) liftable = pauseComments(result, comment, postIdentity(post.id));
        // Text that never reached the editor is a clean skip, but not a silent
        // one: a second in a row turns comments off. Any typed comment resets it.
        if (action === 'comment') untypedComments = result === 'not-typed' ? untypedComments + 1 : result === 'skipped' ? untypedComments : 0;
        const untypedStop = action === 'comment' && result === 'not-typed' && untypedComments >= MAX_UNTYPED_COMMENTS;
        if (untypedStop) pausedActions.add('comment');
        inFlight = null;
        await saveCheckpoint();
        update(engagementMessage(action, post, comment, result, result === 'not-typed' ? untypedStop : !liftable));
      }
    }
    await pause(pauseAfter);
  }
  update(signal.aborted ? 'session stopped. you have control.' : 'time’s up. your session is complete.');
  return stats;
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    const interrupted = Boolean(inFlight);
    settleInterrupted();
    try {
      await saveCheckpoint();
      if (interrupted) update('session stopped before the last action could be confirmed.');
    } catch (error) {
      // Keep the actual stop/error reason when final persistence also fails.
      if (!failure) throw error;
    }
  }
}

globalThis.sessionEngine = { runSession };
