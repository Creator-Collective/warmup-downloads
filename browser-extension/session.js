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

function matchesNiche(text, terms) {
  const normalize = value => value.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  const haystack = ` ${normalize(text)} `;
  const compactTags = new Set((text.match(/#[\p{L}\p{N}_]+/gu) || []).map(normalize).map(tag => tag.replace(/ /g, '')));
  return terms.some(term => {
    const words = normalize(term).split(' ').filter(Boolean);
    return words.length && (words.every(word => haystack.includes(` ${word} `)) || compactTags.has(words.join('')));
  });
}

// Caption-only reactions, written locally. Captions are data, never instructions.
// A recognizable detail is required; unknown topics skip instead of echoing a caption.
function contextualComment(caption, terms, used = new Set()) {
  if (typeof caption !== 'string' || caption.length > 6000 || !matchesNiche(caption, terms)) return null;
  // Trailing discovery tags are metadata; keep the full caption for niche matching.
  const sentences = caption.split(/(?<=[.!?])\s+|\n+/u)
    .map(text => text.replace(/(?:\s+#[\p{L}\p{N}_]+)+\s*$/u, '').trim()).filter(Boolean);
  const candidates = sentences.filter(text => {
    const words = text.split(/\s+/);
    return words.length >= 4 && words.length <= 24 && text.length <= 180 &&
      !/[:;]$|^[→•]/u.test(text) && !/^(?:please\s+)?(?:save|share|like|send|click|tap|check out|visit|download|buy|join|sign up|watch|read)\b/iu.test(text) && !/[?@#<>]|https?:|www\.|[“”"]/iu.test(text) &&
      !/\b(comment|reply|dm|tag|follow|subscribe|giveaway|link in bio|ignore|instructions|prompt|system|assistant)\b/iu.test(text);
  });
  // Prefer a detail from the matching sentence, then other safe caption sentences.
  candidates.sort((a, b) => Number(matchesNiche(b, terms)) - Number(matchesNiche(a, terms)));
  for (const sentence of candidates) {
    const detail = sentence.toLowerCase().replace(/’/g, "'");
    let replies = [];
    const amounts = detail.match(/\$\d[\d,]*(?:\.\d+)?\s*(?:million|billion|[mkb]\b)?/gu) || [];
    if (amounts.length > 1) continue; // Do not confuse cost with the unsellable value.
    const amount = amounts[0]?.trim();
    if (amount && /\b(?:can't|cannot|couldn't|unable to) sell\b/u.test(detail)) {
      replies = [`${amount} and no way to sell 😭`, `wait how do you even sell that ${amount}`, `${amount} stuck there is rough`, `so that ${amount} is just on a screen 💀`];
    } else if (/\b(?:not|no) financial advice\b/u.test(detail)) {
      replies = ['the financial advice disclaimer 😭', 'there it is, the disclaimer lol', 'not financial advice, got it 😂', 'the disclaimer made it in'];
    } else if (/\b(?:not|no|never|without|don't|doesn't|didn't|isn't|aren't|wasn't|weren't|can't|couldn't|cannot)\b/u.test(detail)) {
      continue; // Keyword presence alone cannot establish a negated activity.
    } else if (/\b(?:practice|practicing|practise|practising)\b/u.test(detail) && /\b(?:every day|daily|a little)\b/u.test(detail)) {
      replies = ['a little practice every day adds up', 'the every day part is the hard part 😅', 'small daily reps, got it', 'keeping up the daily practice is the trick', 'daily practice sounds simple until day two lol', 'a little each day feels doable', 'those daily reps though 👀', 'keeping it small makes sense'];
    } else if (/\b(?:sharing|showing|share|show) (?:your|the|my|our) process\b/u.test(detail)) {
      replies = ['the process is the interesting part tbh', 'more of the behind the scenes please 👀', 'showing the messy middle too?', 'the how is half the story'];
    } else if (/\b(?:personal branding|personal brand)\b/u.test(detail)) {
      replies = ['personal branding without overthinking it please 😅', 'how long did finding your own style take', 'the personal part gets forgotten so fast', 'more on finding your own voice?'];
    } else if (/\b(?:study tips|studying|study habits)\b/u.test(detail)) {
      replies = ['which study tip would you start with', 'studying without overcomplicating it 🙌', 'what does a normal study day look like', 'the study routine is half the battle'];
    } else if (/\b(?:storytelling|telling stories|tell a story)\b/u.test(detail)) {
      replies = ['how do you decide where the story starts', 'the storytelling part 👀', 'what makes you keep a detail in the story', 'more on how you build the story please'];
    } else if (/\b(?:editing|video edits|video editing)\b/u.test(detail)) {
      replies = ['how long does the editing usually take', 'the editing process needs its own post 👀', 'what part of the edit takes the longest', 'curious how many versions you go through'];
    } else if (/\b(?:ugc rates|pricing|setting (?:your |my )?rates)\b/u.test(detail)) {
      replies = ['how did you land on that price', 'the pricing part always gets me 😅', 'what would you charge starting out', 'curious how much room there is to negotiate'];
    } else if (/\b(?:cooking|baking)\b/u.test(detail) || (/\b(?:recipe|ingredients)\b/u.test(detail) && /\b(?:pasta|cake|bread|chicken|rice|soup|cookies|flour|butter|oven|sauce)\b/u.test(detail))) {
      replies = ['what would you swap if an ingredient is missing', 'how much prep time are we talking', 'the recipe details please 👀', 'does this keep well for the next day'];
    } else if (/\b(?:workout|training routine|gym routine)\b/u.test(detail)) {
      replies = ['how long does the whole workout take', 'what does the rest day look like', 'how would you scale this for a beginner', 'the routine details please 💪'];
    } else if (/\b(?:posting consistently|consistent posting|post every day|posting every day)\b/u.test(detail)) {
      replies = ['how do you keep ideas coming every day', 'the consistency part is no joke 😅', 'do you batch posts or make them on the day', 'what do you do on the no ideas days'];
    }
    if (!replies.length) continue;
    let hash = 0;
    for (const character of detail) hash = (Math.imul(hash, 31) + character.codePointAt(0)) >>> 0;
    for (let offset = 0; offset < replies.length; offset++) {
      const reply = replies[(hash + offset) % replies.length];
      if (!used.has(reply)) return reply;
    }
  }
  return null;
}

function engagementMessage(action, post, comment, result) {
  let account = typeof post.author === 'string' ? post.author.match(/^\/?@?([\w.]{1,30})\/?$/)?.[1] : null;
  let reference = 'this post';
  try {
    const url = new URL(post.id);
    if (url.protocol === 'https:' && !url.username && !url.password && !url.port) {
      const instagram = ['www.instagram.com', 'instagram.com'].includes(url.hostname) && url.pathname.match(/^\/(?:p|reel)\/([\w-]+)\/?$/);
      const tiktok = ['www.tiktok.com', 'tiktok.com'].includes(url.hostname) && url.pathname.match(/^\/@([\w.]{1,30})\/video\/(\d+)\/?$/);
      if (instagram) reference = `post ${instagram[1]}`;
      if (tiktok) { account ||= tiktok[1]; reference = `video ${tiktok[2]}`; }
    }
  } catch { /* The account may still be available while the post URL is missing. */ }
  const subject = action === 'follow' ? (account ? `@${account}` : `the author of ${reference}`) : (account ? `@${account}'s post` : reference);
  const pending = `${{ like: 'liking', follow: 'following', comment: 'commenting on' }[action]} ${subject}`;
  const details = action === 'comment' ? `: ${comment || ''}` : '';
  if (result === 'pending') return `${pending}${details || '...'}`;
  if (result === 'confirmed') return `${{ like: 'liked', follow: 'followed', comment: 'commented on' }[action]} ${subject}${details || '.'}`;
  if (action === 'comment' && result === 'uncertain-draft') return `couldn't confirm commenting on ${subject}${details}. a draft may remain; comments are off for this session. continuing warm-up.`;
  if (result === 'uncertain') return `couldn't confirm ${pending}${details || '. continuing.'}`;
  if (action === 'comment' && result === 'draft-retained') return `comment skipped for ${subject}. a draft may remain; comments are off for this session. continuing warm-up.`;
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

function targetAction(eligible, settings, stats, elapsedMs) {
  const debts = eligible.map(action => {
    const expected = expectedActions(settings, action, elapsedMs);
    const debt = Math.max(0, expected - stats[action]);
    return { action, debt, score: expected > 0 ? debt / expected : 0 };
  }).filter(item => item.debt > 0);
  if (!debts.length) return null;
  debts.sort((a, b) => b.score - a.score || b.debt - a.debt || actionCadenceMs(settings, a.action) - actionCadenceMs(settings, b.action));
  return debts[0].action;
}

// One awaited action at a time. No action begins after cancellation or the deadline.
async function runSession(settings, adapter, signal, options = {}) {
  const platform = settings.platform || 'instagram';
  const now = options.now || Date.now;
  const sleep = options.sleep || ((ms, abortSignal) => delay(ms, undefined, { signal: abortSignal }));
  const random = options.random || Math.random;
  const startedAt = now();
  const deadline = startedAt + settings.minutes * 60000;
  const nextAllowed = Object.fromEntries(['like', 'follow', 'comment'].map(action => [action, startedAt + actionWarmups(settings, action)[0]]));
  let nextEngagement = nextAllowed.like;
  let nextBreak = startedAt + randomBetween(300000, 540000, random);
  const termWindowMs = Math.max(10000, Math.min(120000, settings.minutes * 60000 / settings.terms.length));
  let nextTermAt = Infinity;
  let termIndex = 0;
  const stats = { scroll: 0, read: 0, search: 0, open: 0, like: 0, follow: 0, comment: 0, skipped: 0 };
  // Background tabs can round sub-second timers up during confirmation.
  const confirmationBudgetMs = { like: 8000, follow: 22000, comment: 20000 };
  const unconfirmed = { like: 0, follow: 0, comment: 0 };
  const seen = new Set();
  const hasSeen = id => seen.has(postIdentity(id));
  const done = { like: new Set(), follow: new Set(), comment: new Set() };
  const pausedActions = new Set();
  const usedComments = new Set();
  let stalled = 0;
  let retrySearch = false;
  let needsSearchScroll = false;
  let previousAction;
  let lastWatchWasFull = false;
  let skimBurstRemaining = 0;
  let videosSinceFullWatch = 0;
  let nextFullWatchAfter = randomBetween(16, 24, random);
  const running = () => !signal.aborted && now() < deadline;
  const comments = [];
  const update = message => adapter.update({ stats: { ...stats }, comments: comments.map(item => ({ ...item })), remainingMs: Math.max(0, deadline - now()), deadline, phase: 'action', nextActionAt: null, message });
  const likeSchedule = actionSchedule(settings, 'like');
  const nextLikeAt = () => stats.like + unconfirmed.like < settings.limits.like && settings.weights.like
    ? startedAt + likeSchedule.warmup + (stats.like + unconfirmed.like) * likeSchedule.cadence : Infinity;
  const totalEngagementDebt = () => ['like', 'follow', 'comment'].reduce((sum, action) => sum + (pausedActions.has(action) ? 0 : actionDebt(settings, { ...stats, [action]: stats[action] + unconfirmed[action] }, action, now() - startedAt)), 0);
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
    const ranges = { transition: [500, 1800], browse: [1800, 5200], exhausted: [10000, 15000], skim: [350, 1400], watch: [4000, 12000], fullwatch: [14000, 26000], read: [7000, 16000], like: [9000, 24000], follow: [16000, 36000], comment: [24000, 52000] };
    let [min, max] = ranges[action] || ranges.browse;
    let fullWatchMs = null;
    if (now() >= nextBreak && totalEngagementDebt() < 3 && nextLikeAt() - now() >= 45000 * settings.pauseScale) {
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
            remaining <= Math.min(deadline, nextTermAt, nextLikeAt()) - now()) {
          fullWatchMs = remaining;
          lastWatchWasFull = true;
          videosSinceFullWatch = 0;
          nextFullWatchAfter = randomBetween(16, 24, random);
          update('staying for the rest of this video…');
        }
      }
    }
    const likePauseBudget = action === 'watch' || action === 'fullwatch' ? Math.max(1000 * settings.pauseScale, nextLikeAt() - now()) : Infinity;
    const ms = Math.min(fullWatchMs ?? randomBetween(Math.round(min * settings.pauseScale), Math.round(max * settings.pauseScale), random), likePauseBudget, deadline - now(), Math.max(0, nextTermAt - now()));
    adapter.update({ phase: 'pause', nextActionAt: now() + ms });
    await sleep(ms, signal);
    if (running()) adapter.update({ phase: 'action', nextActionAt: null });
  };
  const search = async () => {
    const term = settings.terms[termIndex % settings.terms.length];
    termIndex += 1;
    nextTermAt = settings.terms.length > 1 ? now() + termWindowMs : Infinity;
    update(`searching for ${term}…`);
    const loaded = await adapter.search(term, signal);
    if (!running()) return;
    retrySearch = loaded === false;
    if (loaded === false) {
      stats.skipped += 1;
      stalled = 2;
      update('search is slow or empty. trying another search...');
      return;
    }
    stalled = 0;
    stats.search += 1;
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
    if (page.unavailable) {
      stats.skipped += 1;
      update('waiting for the page to finish loading...');
      await sleep(Math.min(1500, deadline - now()), signal);
      stalled += 1;
      if (running() && stalled >= 3) await search();
      continue;
    }
    if (page.post?.id) seen.add(postIdentity(page.post.id));
    const candidates = [...new Set([...(page.sequence || []), ...(page.posts || [])])].filter(id => !hasSeen(id));
    if (now() >= nextTermAt || retrySearch) {
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
        update('that post is unavailable. looking for another...');
        await pause('transition');
        continue;
      }
      stats.open += 1;
      stalled = 0;
      update('watching a post from your search.');
      pauseAfter = viewerPause();
    } else {
      const post = page.post;
      const commentText = post && settings.limits.comment ? contextualComment(post.caption, settings.terms, usedComments) : null;
      const eligible = [];
      let canLike = false;
      if (post && matchesNiche(post.text, settings.terms)) {
        for (const action of ['like', 'follow', 'comment']) {
          const key = action === 'follow' ? post.author : postIdentity(post.id);
          if (!pausedActions.has(action) && deadline - now() >= confirmationBudgetMs[action] && key && post[action] && stats[action] + unconfirmed[action] < settings.limits[action] && !done[action].has(key) &&
              (action !== 'comment' || (commentText && !usedComments.has(commentText.toLocaleLowerCase())))) {
            if (action === 'like') canLike = true;
            if (now() >= nextEngagement && now() >= nextAllowed[action]) eligible.push(action);
          }
        }
      }
      const likeReadyAt = Math.max(nextEngagement, nextAllowed.like);
      if (!needsSearchScroll && post?.viewer && canLike && nextLikeAt() <= now() && likeReadyAt > now() &&
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
      const target = needsSearchScroll ? null : targetAction(eligible, settings, stats, now() - startedAt);
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
        update(inViewer ? (moved ? 'watching the next post.' : 'continuing from your search results...') : (moved ? 'scrolled to more content.' : 'no new posts yet. waiting for more results...'));
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
        let comment;
        if (action === 'comment') {
          comment = commentText;
          usedComments.add(comment.toLocaleLowerCase());
        }
        update(engagementMessage(action, post, comment, 'pending'));
        const result = await adapter.engage(action, post, comment, signal);
        if (action === 'comment' && ['confirmed', 'uncertain', 'uncertain-draft'].includes(result)) {
          comments.push({ text: comment, url: post.id, author: post.author, time: now(), status: result === 'confirmed' ? 'confirmed' : 'uncertain' });
        }
        // Count a verified result even if Stop arrived during the final confirmation.
        if (result === 'confirmed') stats[action] += 1;
        else if (['uncertain', 'uncertain-draft'].includes(result)) {
          unconfirmed[action] += 1;
          stats.skipped += 1;
        }
        else stats.skipped += 1;
        if (action === 'comment' && ['draft-retained', 'uncertain-draft'].includes(result)) {
          pausedActions.add('comment');
        }
        update(engagementMessage(action, post, comment, result));
      }
    }
    await pause(pauseAfter);
  }
  update(signal.aborted ? 'session stopped. you have control.' : 'time’s up. your session is complete.');
  return stats;
}

globalThis.sessionEngine = { runSession };
