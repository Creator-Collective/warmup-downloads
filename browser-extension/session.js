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

// One awaited action at a time. No action begins after cancellation or the deadline.
async function runSession(settings, adapter, signal, options = {}) {
  const now = options.now || Date.now;
  const sleep = options.sleep || ((ms, abortSignal) => delay(ms, undefined, { signal: abortSignal }));
  const random = options.random || Math.random;
  const startedAt = now();
  const deadline = startedAt + settings.minutes * 60000;
  const nextAllowed = { like: startedAt + 30000, follow: startedAt + 120000, comment: startedAt + 180000 };
  let nextEngagement = startedAt + 30000;
  let nextBreak = startedAt + randomBetween(360000, 540000, random);
  const termWindowMs = Math.max(10000, Math.min(120000, settings.minutes * 60000 / settings.terms.length));
  let nextTermAt = Infinity;
  let termIndex = 0;
  const stats = { scroll: 0, read: 0, search: 0, open: 0, like: 0, follow: 0, comment: 0, skipped: 0 };
  const seen = new Set();
  const done = { like: new Set(), follow: new Set(), comment: new Set() };
  const usedComments = new Set();
  let stalled = 0;
  let stepsSinceSearch = 0;
  let needsSearchScroll = false;
  let previousAction;
  let lastWatchWasFull = false;
  const running = () => !signal.aborted && now() < deadline;
  const update = message => adapter.update({ stats: { ...stats }, remainingMs: Math.max(0, deadline - now()), deadline, phase: 'action', nextActionAt: null, message });
  const pause = async (action = 'browse') => {
    if (!running()) return;
    const ranges = { transition: [1000, 3000], browse: [2000, 4000], watch: [3000, 7000], read: [6000, 10000], like: [18000, 35000], follow: [25000, 50000], comment: [30000, 60000] };
    let [min, max] = ranges[action] || ranges.browse;
    let fullWatchMs = null;
    if (now() >= nextBreak) {
      min = 15000; max = 25000;
      nextBreak = now() + randomBetween(360000, 540000, random);
      update('taking a longer break…');
    } else if (action === 'watch') {
      const tryFullWatch = !lastWatchWasFull && random() < 0.15;
      lastWatchWasFull = false;
      if (tryFullWatch) {
        const page = await adapter.inspect(signal);
        if (!running()) return;
        if (page.blocked) throw new Error(page.blocked);
        const remaining = page.post?.viewer ? page.post.videoRemainingMs : null;
        if (Number.isFinite(remaining) && remaining > 7000 * settings.pauseScale && remaining <= 120000 &&
            remaining <= Math.min(deadline, nextTermAt) - now()) {
          fullWatchMs = remaining;
          lastWatchWasFull = true;
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
      pauseAfter = 'watch';
    } else {
      const post = page.post;
      const commentText = post && settings.limits.comment ? contextualComment(post.caption, settings.terms) : null;
      const eligible = [];
      if (post && matchesNiche(post.text, settings.terms)) {
        for (const action of ['like', 'follow', 'comment']) {
          const key = action === 'follow' ? post.author : post.id;
          if (now() >= nextEngagement && now() >= nextAllowed[action] && key && post[action] && stats[action] < settings.limits[action] && !done[action].has(key) &&
              (action !== 'comment' || (commentText && !usedComments.has(commentText.toLocaleLowerCase())))) {
            eligible.push(action);
          }
        }
      }
      let action = needsSearchScroll ? 'scroll' : pickAction(eligible, settings.weights, random);
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
        if (moved === 'login') throw new Error('sign in to instagram, then start a new session.');
        if (moved) { stats.scroll += 1; stalled = 0; } else { stats.skipped += 1; stalled += 1; }
        if (post && (!inViewer || !moved)) await adapter.leavePost(signal);
        if (inViewer && moved) pauseAfter = 'watch';
        update(inViewer ? (moved ? 'watching the next post.' : 'reached the end of these results. finding more…') : (moved ? 'scrolled to more content.' : 'no visible movement. looking for another post…'));
      } else {
        const key = action === 'follow' ? post.author : post.id;
        if (post.viewer) pauseAfter = 'transition';
        done[action].add(key);
        nextEngagement = now() + randomBetween(20000, 45000, random) * settings.pauseScale;
        const spacing = { like: [30000, 60000], follow: [180000, 300000], comment: [360000, 540000] };
        nextAllowed[action] = now() + randomBetween(...spacing[action], random) * settings.pauseScale;
        let comment;
        if (action === 'comment') {
          comment = commentText;
          usedComments.add(comment.toLocaleLowerCase());
        }
        update(`${{ like: 'liking the post', follow: 'following the author', comment: 'posting a caption-based comment' }[action]}…`);
        const result = await adapter.engage(action, post, comment, signal);
        // Count a verified result even if Stop arrived during the final confirmation.
        if (result === 'confirmed') stats[action] += 1;
        else if (result === 'uncertain') throw new Error(`${action} may have gone through, but couldn’t be confirmed. check instagram before restarting.`);
        else stats.skipped += 1;
        update(result === 'confirmed' ? `${{ like: 'like confirmed', follow: 'follow confirmed', comment: 'comment confirmed' }[action]}.` : `${action} skipped. the post changed or its control wasn’t available.`);
      }
      stepsSinceSearch += 1;
    }
    await pause(pauseAfter);
  }
  update(signal.aborted ? 'session stopped. you have control.' : 'time’s up. your session is complete.');
  return stats;
}

globalThis.sessionEngine = { runSession };
