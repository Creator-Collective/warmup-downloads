function delay(ms, unused, { signal } = {}) { return new Promise((resolve, reject) => { if (signal?.aborted) return reject(signal.reason); const abort = () => { clearTimeout(timer); reject(signal.reason); }; const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms); signal?.addEventListener('abort', abort, { once: true }); }); }



function randomBetween(min, max, random = Math.random) {
  return min + Math.floor(Math.max(0, Math.min(0.999999, random())) * (max - min + 1));
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

// Deterministic, extractive replies. Never interpret a caption as instructions,
// use image alt text as a caption, or fabricate an experience/opinion about a video.
function contextualComment(caption, terms) {
  if (typeof caption !== 'string' || caption.length > 6000) return null;
  const sentences = caption.split(/(?<=[.!?])\s+|\n+/u).map(text => text.trim()).filter(Boolean);
  const sentence = sentences.find(text => {
    const words = text.split(/\s+/);
    return words.length >= 6 && words.length <= 18 && text.length <= 180 &&
      matchesNiche(text, terms) && !/^(?:please\s+)?(?:save|share|like|send|click|tap|check out|visit|download|buy|join|sign up|watch|read)\b/iu.test(text) && !/[?@#<>]|https?:|www\.|[“”"]/iu.test(text) &&
      !/\b(comment|reply|dm|tag|follow|subscribe|giveaway|link in bio|ignore|instructions|prompt|system|assistant)\b/iu.test(text);
  });
  if (!sentence) return null;
  return `this part stood out: “${sentence.replace(/[.!]+$/u, '')}”`;
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
  const cadence = actionCadenceMs(settings, action);
  if (!settings.weights[action] || !Number.isFinite(cadence)) return 0;
  const warmups = { like: [12000, 30000], follow: [35000, 60000], comment: [60000, 120000] };
  const [minWarmup, maxWarmup] = warmups[action] || warmups.like;
  const warmup = Math.min(maxWarmup, Math.max(minWarmup, cadence * .75));
  if (elapsedMs < warmup) return 0;
  const expected = Math.min(settings.limits[action], Math.floor((elapsedMs - warmup) / cadence) + 1);
  return Math.max(0, expected - stats[action]);
}

function expectedActions(settings, action, elapsedMs) {
  const cadence = actionCadenceMs(settings, action);
  if (!settings.weights[action] || !Number.isFinite(cadence)) return 0;
  const warmups = { like: [12000, 30000], follow: [35000, 60000], comment: [60000, 120000] };
  const [minWarmup, maxWarmup] = warmups[action] || warmups.like;
  const warmup = Math.min(maxWarmup, Math.max(minWarmup, cadence * .75));
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

function targetAction(eligible, settings, stats, elapsedMs, random = Math.random) {
  const debts = eligible.map(action => {
    const expected = expectedActions(settings, action, elapsedMs);
    const debt = Math.max(0, expected - stats[action]);
    return { action, debt, score: expected > 0 ? debt / expected : 0 };
  }).filter(item => item.debt > 0);
  if (!debts.length) return null;
  debts.sort((a, b) => b.score - a.score || b.debt - a.debt || actionCadenceMs(settings, a.action) - actionCadenceMs(settings, b.action));
  const strongest = debts[0];
  const probability = strongest.debt >= 2 ? .95 : .82;
  if (random() >= probability) return null;
  if (debts.length === 1 || strongest.debt >= 2) return strongest.action;
  return debts[randomBetween(0, debts.length - 1, random)].action;
}

// One awaited action at a time. No action begins after cancellation or the deadline.
async function runSession(settings, adapter, signal, options = {}) {
  const platform = settings.platform || 'instagram';
  const now = options.now || Date.now;
  const sleep = options.sleep || ((ms, abortSignal) => delay(ms, undefined, { signal: abortSignal }));
  const random = options.random || Math.random;
  const startedAt = now();
  const deadline = startedAt + settings.minutes * 60000;
  const nextAllowed = { like: startedAt + 12000, follow: startedAt + 35000, comment: startedAt + 60000 };
  let nextEngagement = startedAt + 12000;
  let nextBreak = startedAt + randomBetween(300000, 540000, random);
  const termWindowMs = Math.max(10000, Math.min(120000, settings.minutes * 60000 / settings.terms.length));
  let nextTermAt = Infinity;
  let termIndex = 0;
  const stats = { scroll: 0, read: 0, search: 0, open: 0, like: 0, follow: 0, comment: 0, skipped: 0 };
  const seen = new Set();
  const done = { like: new Set(), follow: new Set(), comment: new Set() };
  const pausedActions = new Set();
  const usedComments = new Set();
  let stalled = 0;
  let stepsSinceSearch = 0;
  let needsSearchScroll = false;
  let previousAction;
  let lastWatchWasFull = false;
  let skimBurstRemaining = 0;
  let videosSinceFullWatch = 0;
  let nextFullWatchAfter = randomBetween(16, 24, random);
  const running = () => !signal.aborted && now() < deadline;
  const update = message => adapter.update({ stats: { ...stats }, remainingMs: Math.max(0, deadline - now()), deadline, phase: 'action', nextActionAt: null, message });
  const totalEngagementDebt = () => ['like', 'follow', 'comment'].reduce((sum, action) => sum + (pausedActions.has(action) ? 0 : actionDebt(settings, stats, action, now() - startedAt)), 0);
  const viewerPause = () => {
    videosSinceFullWatch += 1;
    const totalDebt = totalEngagementDebt();
    if (totalDebt >= 4 && random() < .9) return 'skim';
    if (totalDebt >= 2 && random() < .65) return 'skim';
    if (!lastWatchWasFull && videosSinceFullWatch >= nextFullWatchAfter) return 'fullwatch';
    if (skimBurstRemaining <= 0 && random() < 0.42 / settings.pauseScale) skimBurstRemaining = randomBetween(1, 3, random);
    if (skimBurstRemaining > 0) {
      skimBurstRemaining -= 1;
      return 'skim';
    }
    return 'watch';
  };
  const pause = async (action = 'browse') => {
    if (!running()) return;
    const ranges = { transition: [500, 1800], browse: [1800, 5200], skim: [350, 1400], watch: [4000, 12000], fullwatch: [14000, 26000], read: [7000, 16000], like: [9000, 24000], follow: [16000, 36000], comment: [24000, 52000] };
    let [min, max] = ranges[action] || ranges.browse;
    let fullWatchMs = null;
    if (now() >= nextBreak && totalEngagementDebt() < 3) {
      min = 20000; max = 45000;
      nextBreak = now() + randomBetween(300000, 540000, random);
      update('taking a longer break…');
    } else if (now() >= nextBreak) {
      nextBreak = now() + randomBetween(45000, 90000, random);
    } else if (action === 'watch' || action === 'fullwatch') {
      const tryFullWatch = action === 'fullwatch' || (!lastWatchWasFull && random() < 0.25);
      lastWatchWasFull = false;
      if (tryFullWatch) {
        const page = await adapter.inspect(signal);
        if (!running()) return;
        if (page.blocked) throw new Error(page.blocked);
        const remaining = page.post?.viewer ? page.post.videoRemainingMs : null;
        if (Number.isFinite(remaining) && remaining > 10000 * settings.pauseScale && remaining <= 120000 &&
            remaining <= Math.min(deadline, nextTermAt) - now()) {
          fullWatchMs = remaining;
          lastWatchWasFull = true;
          videosSinceFullWatch = 0;
          nextFullWatchAfter = randomBetween(16, 24, random);
          update('staying for the rest of this video…');
        }
      }
    }
    const ms = Math.min(fullWatchMs ?? randomBetween(Math.round(min * settings.pauseScale), Math.round(max * settings.pauseScale), random), deadline - now(), Math.max(0, nextTermAt - now()));
    adapter.update({ phase: 'pause', nextActionAt: now() + ms });
    await sleep(ms, signal);
    if (running()) adapter.update({ phase: 'action', nextActionAt: null });
  };
  const search = async () => {
    const term = settings.terms[termIndex % settings.terms.length];
    termIndex += 1;
    nextTermAt = settings.terms.length > 1 ? now() + termWindowMs : Infinity;
    update(`searching for ${term}…`);
    await adapter.search(term, signal);
    if (!running()) return;
    stats.search += 1;
    stepsSinceSearch = 0;
    needsSearchScroll = true;
    previousAction = undefined;
    update(`opened search: ${term}`);
  };
  update('starting your niche session…');
  if (!running()) return stats;
  await search();
  while (running()) {
    let pauseAfter = 'browse';
    const page = await adapter.inspect(signal);
    if (!running()) break;
    if (page.blocked) throw new Error(page.blocked);
    if (page.post?.id) seen.add(page.post.id);
    if (now() >= nextTermAt || (stepsSinceSearch >= 8 && !page.post?.viewer) || stalled >= 2) {
      await search();
      stalled = 0;
      pauseAfter = 'transition';
    } else if (!needsSearchScroll && !page.post && page.posts?.some(post => !seen.has(post))) {
      const candidates = page.posts.filter(post => !seen.has(post));
      const target = candidates[randomBetween(0, candidates.length - 1, random)];
      seen.add(target);
      update('opening a matching post…');
      await adapter.open(target, signal);
      if (!running()) break;
      stats.open += 1;
      stepsSinceSearch += 1;
      update('watching a post from your search.');
      pauseAfter = viewerPause();
    } else {
      const post = page.post;
      const commentText = post && settings.limits.comment ? contextualComment(post.caption, settings.terms) : null;
      const eligible = [];
      if (post && matchesNiche(post.text, settings.terms)) {
        for (const action of ['like', 'follow', 'comment']) {
          const key = action === 'follow' ? post.author : post.id;
          if (!pausedActions.has(action) && now() >= nextEngagement && now() >= nextAllowed[action] && key && post[action] && stats[action] < settings.limits[action] && !done[action].has(key) &&
              (action !== 'comment' || (commentText && !usedComments.has(commentText.toLocaleLowerCase())))) {
            eligible.push(action);
          }
        }
      }
      let action = needsSearchScroll ? 'scroll' : pickAction(eligible, settings.weights, random);
      const target = needsSearchScroll ? null : targetAction(eligible, settings, stats, now() - startedAt, random);
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
        const moved = inViewer ? await adapter.advance(post, signal) : await adapter.scroll(signal);
        if (!running()) break;
        if (moved === 'login') throw new Error(`sign in to ${platform}, then start a new session.`);
        if (moved) { stats.scroll += 1; stalled = 0; } else { stats.skipped += 1; stalled += 1; }
        if (post && (!inViewer || !moved)) await adapter.leavePost(signal);
        if (inViewer && moved) pauseAfter = viewerPause();
        update(inViewer ? (moved ? 'watching the next post.' : 'reached the end of these results. finding more…') : (moved ? 'scrolled to more content.' : 'no visible movement. looking for another post…'));
      } else {
        const key = action === 'follow' ? post.author : post.id;
        if (post.viewer) pauseAfter = 'transition';
        done[action].add(key);
        const cadence = actionCadenceMs(settings, action);
        const engagementSpacing = action === 'like' ? [Math.max(3000, Math.round(cadence * .15)), Math.max(7000, Math.round(cadence * .45))] :
          action === 'follow' ? [8000, 18000] :
          action === 'comment' ? [10000, 22000] : [20000, 45000];
        nextEngagement = now() + randomBetween(...engagementSpacing, random) * settings.pauseScale;
        nextAllowed[action] = now() + randomBetween(...actionSpacing(settings, action), random) * settings.pauseScale;
        let comment;
        if (action === 'comment') {
          comment = commentText;
          usedComments.add(comment.toLocaleLowerCase());
        }
        update(`${{ like: 'liking the post', follow: 'following the author', comment: 'posting a caption-based comment' }[action]}…`);
        const result = await adapter.engage(action, post, comment, signal);
        // Count a verified result even if Stop arrived during the final confirmation.
        if (result === 'confirmed') stats[action] += 1;
        else if (result === 'uncertain') {
          stats.skipped += 1;
          update(`${action} may have gone through, but couldn’t confirm it. continuing.`);
        }
        else stats.skipped += 1;
        if (action === 'comment' && result === 'draft-retained') {
          pausedActions.add('comment');
          update('comment skipped. a draft may remain; comments are off for this session. continuing warm-up.');
        } else {
          update(result === 'confirmed' ? `${{ like: 'like confirmed', follow: 'follow confirmed', comment: 'comment confirmed' }[action]}.` : result === 'uncertain' ? `${action} unconfirmed. continuing.` : `${action} skipped. the post changed or its control wasn’t available.`);
        }
      }
      stepsSinceSearch += 1;
    }
    await pause(pauseAfter);
  }
  update(signal.aborted ? 'session stopped. you have control.' : 'time’s up. your session is complete.');
  return stats;
}

globalThis.sessionEngine = { runSession };
