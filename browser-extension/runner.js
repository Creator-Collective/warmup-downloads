'use strict';
const token = location.hash.slice(1);
const controller = new AbortController();
let job;
let expectedDestination;
let viewerNavigation;
let currentSearchURL;
let viewerSequence = [];
let pendingEngagement = false;
let pendingDraft = false;
let messageQueue = Promise.resolve();
let terminalResult;
let terminalAcknowledgement;
// Test builds keep numbers-only diagnostics on the job (warmupDiagnostics in
// guards.js). A job without them, as in the instagram build, records nothing.
let diagnostics = null;
// The last page block seen. A session that ends with that same message ended on
// that block, and only its fixed code is kept.
let lastBlock = null;
const el = id => document.getElementById(id);
function countDiagnostic(event) {
  if (diagnostics) diagnostics = warmupDiagnostics.record(diagnostics, event);
}
function noteBlock(result) {
  if (typeof result?.blocked === 'string') lastBlock = { message: result.blocked, reason: typeof result.blockReason === 'string' ? result.blockReason : null };
  return result;
}
// Page scripts return a block as data rather than throwing, so its code is kept.
function blockError(result) {
  noteBlock(result);
  return new Error(result.blocked);
}
function sessionEnd(error, finished) {
  const block = lastBlock && error?.message === lastBlock.message ? lastBlock.reason || 'unknown' : null;
  const end = finished ? 'deadline' : block ? 'blocked' : error?.message === `session stopped because the ${currentPlatform()} page changed.` ? 'page-changed'
    : controller.signal.aborted ? 'stopped' : 'error';
  return { end, block: end === 'blocked' ? block : null };
}
// The terminal patch carries the diagnostics, because later updates are ignored.
function withDiagnostics(patch, end, block = null) {
  if (!diagnostics) return patch;
  countDiagnostic({ type: 'end', code: end, block });
  return { ...patch, diagnostics };
}
function currentPlatform() {
  return validPlatform(job?.settings?.platform);
}
function platformConfig() {
  const platform = currentPlatform();
  return {
    platform,
    label: platforms[platform].label,
    script: platform === 'tiktok' ? 'tiktok.js' : 'instagram.js',
    inspector: platform === 'tiktok' ? 'inspectTikTok' : 'inspectInstagram',
    searchURL: term => platform === 'tiktok' ? `https://www.tiktok.com/search?q=${encodeURIComponent(term)}` : `https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(term)}`,
    validPost: url => {
      const u = new URL(url);
      return platformURL(url, platform) && (platform === 'tiktok' ? /^\/@[\w.-]+\/(?:video|photo)\/\d+\/?$/.test(u.pathname) : /^\/(p|reel)\/[\w-]+\/$/.test(u.pathname)) && !u.search && !u.hash;
    }
  };
}
async function send(type, extra = {}) {
  let timer;
  const response = await Promise.race([
    chrome.runtime.sendMessage({ type, token, ...extra }),
    new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('extension stopped responding.')), 3000); })
  ]).finally(() => clearTimeout(timer));
  if (!response?.ok) throw new Error(response?.error || 'extension disconnected.');
  return response.data;
}
async function finish(patch) {
  // finish is reached only after startup or the engine has settled. Retain that
  // outcome so Stop can recover without needing an open dashboard or new action.
  terminalResult = patch;
  if (terminalAcknowledgement) return terminalAcknowledgement;
  terminalAcknowledgement = (async () => {
    // Retry only the terminal acknowledgement, never a platform operation.
    // This delay deliberately works after the session's abort signal is set.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await send('runner-update', { patch });
        render({ ...job, ...patch, nextActionAt: null });
        return true;
      } catch { if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1))); }
    }
    el('message').textContent = `${patch.message} couldn’t confirm the stop. use stop session or close this session tab before restarting.`;
    el('status').textContent = 'connection lost';
    el('stop').disabled = false;
    return false;
  })();
  try { return await terminalAcknowledgement; }
  finally { terminalAcknowledgement = null; }
}
function assertRunning() {
  controller.signal.throwIfAborted();
  if (!job || Date.now() >= job.deadline) throw new Error('time’s up. your session is complete.');
}
function sameDestination(actual, expected) {
  if (actual === expected) return true;
  try {
    const a = new URL(actual); const b = new URL(expected);
    const post = url => url.pathname.match(/^\/(?:p|reel)\/([\w-]+)\/?$/)?.[1];
    if (a.origin === b.origin && a.search === b.search && a.hash === b.hash && a.pathname.replace(/\/$/, '') === b.pathname.replace(/\/$/, '')) return true;
    if (instagramURL(actual) && a.origin === b.origin && a.hash === b.hash &&
        /^\/explore\/search\/keyword\/?$/.test(a.pathname) && /^\/explore\/search\/keyword\/?$/.test(b.pathname)) {
      const parameters = url => JSON.stringify([...url.searchParams].sort(([ak, av], [bk, bv]) => ak.localeCompare(bk) || av.localeCompare(bv)));
      return parameters(a) === parameters(b);
    }
    const tiktok = url => url.protocol === 'https:' && !url.port && !url.username && !url.password && ['www.tiktok.com', 'tiktok.com'].includes(url.hostname);
    if (tiktok(a) && tiktok(b)) {
      const video = url => url.pathname.match(/^\/@[\w.-]+\/(?:video|photo)\/(\d+)\/?$/)?.[1];
      const aVideo = video(a); const bVideo = video(b);
      if (aVideo && bVideo) return a.pathname.replace(/\/$/, '') === b.pathname.replace(/\/$/, '');
      const search = url => /^\/search(?:\/video)?\/?$/.test(url.pathname) ? url.searchParams.get('q') : null;
      const aSearch = search(a); const bSearch = search(b);
      if (aSearch && bSearch) return aSearch === bSearch;
    }
    return a.origin === b.origin && !a.search && !b.search && !a.hash && !b.hash && Boolean(post(a)) && post(a) === post(b);
  } catch { return false; }
}
// Any TikTok post permalink, with or without TikTok's tracking query.
function tiktokPostPage(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && !u.port && !u.username && !u.password && ['www.tiktok.com', 'tiktok.com'].includes(u.hostname) &&
      /^\/@[\w.-]+\/(?:video|photo)\/\d+\/?$/.test(u.pathname);
  } catch { return false; }
}
function allowedViewerDestination(url) {
  return viewerNavigation && Date.now() < viewerNavigation.deadline &&
    (viewerNavigation.destinations.some(destination => sameDestination(url, destination)) || (viewerNavigation.anyPost === true && tiktokPostPage(url)));
}
// anyPost: TikTok's Next can land on a different post than the predicted one.
// During its bounded allowance any TikTok post is accepted as the new current post.
async function navigateViewer(target, operation, { anyPost = false } = {}) {
  const tab = await chrome.tabs.get(job.tabId);
  assertRunning();
  if (expectedDestination && !sameDestination(tab.url, expectedDestination)) {
    throw new Error(`session stopped because the ${currentPlatform()} page changed.`);
  }
  const navigation = {
    destinations: [tab.url, target, currentSearchURL].filter(Boolean),
    deadline: Math.min(Date.now() + 16000, job.deadline),
    anyPost: anyPost && currentPlatform() === 'tiktok'
  };
  viewerNavigation = navigation;
  expectedDestination = target;
  try { return await operation(); }
  finally {
    // A failed Next may have left the same post open or returned to its search.
    // Adopt only one of those known destinations before ending the allowance.
    try {
      const settled = await chrome.tabs.get(job.tabId);
      if (!controller.signal.aborted && !settled.pendingUrl && (navigation.destinations.some(destination => sameDestination(settled.url, destination)) ||
          (navigation.anyPost && tiktokPostPage(settled.url)))) expectedDestination = settled.url;
    } finally { if (viewerNavigation === navigation) viewerNavigation = null; }
  }
}
function sessionSalt() {
  const values = globalThis.crypto?.getRandomValues ? globalThis.crypto.getRandomValues(new Uint32Array(2)) : [Math.random() * 2 ** 32 >>> 0, Math.random() * 2 ** 32 >>> 0];
  return Array.from(values, value => value.toString(36)).join('');
}

function transientPageError(error) {
  return error?.transientPage === true || /frame (?:with id .*|.*was )removed|no frame with id|document (?:was )?unloaded|execution context (?:was )?destroyed|cannot find context/i.test(error?.message || '');
}
async function recoverPageStep(operation) {
  try { return await operation(); }
  catch (error) {
    assertRunning();
    if (!transientPageError(error)) throw error;
    return false;
  }
}
const sleep = ms => new Promise((resolve, reject) => {
  if (controller.signal.aborted) return reject(controller.signal.reason);
  const abort = () => { clearTimeout(timer); reject(controller.signal.reason); };
  const timer = setTimeout(() => { controller.signal.removeEventListener('abort', abort); resolve(); }, ms);
  controller.signal.addEventListener('abort', abort, { once: true });
});
async function execute(func, args = []) {
  assertRunning();
  await messageQueue;
  assertRunning();
  const config = platformConfig();
  const tab = await chrome.tabs.get(job.tabId);
  if (!platformURL(tab.url, config.platform)) throw new Error(`the selected tab left ${config.label}.`);
  assertRunning();
  const result = await chrome.scripting.executeScript({ target: { tabId: job.tabId }, func, args });
  assertRunning();
  if (!result[0]) throw Object.assign(new Error(`${config.label} is still loading.`), { transientPage: true });
  return result[0].result;
}
async function inspect(request = {}) {
  const config = platformConfig();
  for (let attempt = 0; attempt < 3; attempt++) {
    assertRunning();
    try {
      await chrome.scripting.executeScript({ target: { tabId: job.tabId }, files: [config.script] });
      const page = await execute((inspector, request) => typeof globalThis[inspector] === 'function' ? globalThis[inspector](request) : null, [config.inspector, request]);
      if (page && typeof page === 'object') return noteBlock(page);
    } catch (error) {
      assertRunning();
      if (!transientPageError(error)) throw error;
    }
    if (attempt < 2) await sleep(400 * (attempt + 1));
  }
  return { posts: [], post: null, unavailable: true };
}
async function navigate(url) {
  assertRunning();
  await messageQueue;
  assertRunning();
  const config = platformConfig();
  if (!platformURL(url, config.platform)) throw new Error(`only ${config.label} pages are supported.`);
  if (config.platform === 'tiktok') {
    const page = await inspect();
    if (page.blocked) throw new Error(page.blocked);
  }
  expectedDestination = url;
  if (config.platform === 'instagram' && /^\/explore\/search\/keyword\/?$/.test(new URL(url).pathname)) currentSearchURL = url;
  if (config.platform === 'tiktok' && /^\/search(?:\/video)?\/?$/.test(new URL(url).pathname)) currentSearchURL = url;
  await chrome.tabs.update(job.tabId, { url });
  const until = Math.min(Date.now() + 25000, job.deadline);
  while (Date.now() < until) {
    assertRunning();
    const tab = await chrome.tabs.get(job.tabId);
    if (!platformURL(tab.url, config.platform)) throw new Error(`${config.label} needs your attention.`);
    if (tab.status === 'complete' && sameDestination(tab.url, url) && !tab.pendingUrl) {
      const page = await inspect();
      if (page.blocked) throw new Error(page.blocked);
      const committed = await chrome.tabs.get(job.tabId);
      assertRunning();
      if (sameDestination(committed.url, url) && committed.status === 'complete' && !committed.pendingUrl && (page.post || page.posts?.length)) return true;
    }
    await sleep(500);
  }
  return false;
}
async function waitForPost(target, accept = id => sameDestination(id, target)) {
  const until = Math.min(Date.now() + 15000, job.deadline);
  while (Date.now() < until) {
    assertRunning();
    const page = await inspect();
    if (page.blocked) throw new Error(page.blocked);
    if (accept(page.post?.id) && page.post?.viewer) return true;
    await sleep(400);
  }
  return false;
}
async function openViewer(target) {
  const config = platformConfig();
  if (!config.validPost(target)) throw new Error('invalid post address.');
  const page = await inspect();
  viewerSequence = page.sequence || page.posts || [];
  if (!viewerSequence.some(id => sameDestination(id, target))) return false;
  return navigateViewer(target, async () => {
  const clicked = await execute((target, deadline) => {
    const inspector = location.hostname.includes('tiktok') ? globalThis.inspectTikTok : globalThis.inspectInstagram;
    if (Date.now() >= deadline || inspector().blocked) return false;
    const normalize = value => {
      const url = new URL(value, location.href);
      if (location.hostname.includes('tiktok')) return url.protocol === 'https:' && !url.port && !url.username && !url.password && ['www.tiktok.com', 'tiktok.com'].includes(url.hostname) && /^\/@[\w.-]+\/(?:video|photo)\/\d+\/?$/.test(url.pathname) ? `https://www.tiktok.com${url.pathname.replace(/\/?$/, '/')}` : null;
      return url.origin === location.origin && /^\/(p|reel)\/[\w-]+\/?$/.test(url.pathname) ? `${url.origin}${url.pathname.replace(/\/?$/, '/')}` : null;
    };
    const tiktok = ['www.tiktok.com', 'tiktok.com'].includes(location.hostname);
    const rendered = element => {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      for (let node = element; node; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (node.getAttribute('aria-hidden') === 'true' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.display === 'none' || style.opacity === '0') return false;
      }
      return true;
    };
    const link = [...document.querySelectorAll('main a[href],[role="main"] a[href],a[href]')].find(a => normalize(a.href) === target && (tiktok ? rendered(a) : a.getBoundingClientRect().width > 0));
    if (!link) return false;
    link.scrollIntoView({ block: 'center', behavior: 'instant' });
    if (tiktok) {
      if (!rendered(link)) return false;
      const rect = link.getBoundingClientRect();
      const x = (Math.max(0, rect.left) + Math.min(innerWidth, rect.right)) / 2;
      const y = (Math.max(0, rect.top) + Math.min(innerHeight, rect.bottom)) / 2;
      const hit = document.elementFromPoint(x, y);
      if (!hit || (hit !== link && !link.contains(hit))) return false;
    }
    link.click(); return true;
  }, [target, job.deadline]);
  if (!clicked) return false;
  return waitForPost(target);
  });
}
async function advanceViewer(post, hasSeen = () => false) {
  if (!post.viewer || !post.next) return false;
  const page = await inspect();
  if (page.blocked) throw new Error(page.blocked);
  if (!sameDestination(page.post?.id, post.id)) return false;
  if (page.sequence?.some(id => sameDestination(id, post.id))) viewerSequence = page.sequence;
  if (viewerSequence.filter(id => sameDestination(id, post.id)).length !== 1) return false;
  const index = viewerSequence.findIndex(id => sameDestination(id, post.id));
  const target = index >= 0 ? viewerSequence[index + 1] : null;
  if (!target || hasSeen(target)) return false;
  assertRunning();
  // TikTok's Next follows its own feed order, which can differ from the links on
  // the page. Any other post it lands on becomes the current post.
  const tiktok = currentPlatform() === 'tiktok';
  const arrived = tiktok ? id => tiktokPostPage(id) && !sameDestination(id, post.id) : undefined;
  return navigateViewer(target, async () => {
  const clicked = await execute((id, deadline) => {
    if (Date.now() >= deadline) return false;
    const inspector = location.hostname.includes('tiktok') ? globalThis.inspectTikTok : globalThis.inspectInstagram;
    if (location.hostname.includes('tiktok')) {
      const result = inspector({ id, action: 'click-next' });
      if (result.blocked) return { blocked: result.blocked, blockReason: result.blockReason };
      return result.clicked === true;
    }
    const next = inspector({id, action:'next'});
    if (!next.point) return false;
    const button = document.elementFromPoint(next.point.x, next.point.y)?.closest('button,[role="button"]');
    if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return false;
    button.click(); return true;
  }, [post.id, job.deadline]);
  if (clicked?.blocked) throw blockError(clicked);
  if (!clicked) return false;
  return waitForPost(target, arrived);
  }, { anyPost: tiktok });
}
async function returnToResults(post, searchURL) {
  if (!searchURL) return false;
  const tab = await chrome.tabs.get(job.tabId);
  assertRunning();
  if (sameDestination(tab.url, searchURL) && !tab.pendingUrl) {
    const page = await inspect();
    if (page.blocked) throw new Error(page.blocked);
    if (!page.post && !page.unavailable) { expectedDestination = searchURL; return true; }
  }
  if (!post?.viewer) return navigate(searchURL);
  if (currentPlatform() === 'tiktok' && !post.close) return navigate(searchURL);
  // Closing the modal preserves the loaded results and scroll position. A full
  // navigation would throw that progress away and start the same batch again.
  return navigateViewer(searchURL, async () => {
  const clicked = await execute((id, deadline) => {
    if (Date.now() >= deadline) return false;
    if (location.hostname.includes('tiktok')) {
      const target = globalThis.inspectTikTok({ id, action: 'click-close' });
      if (target.blocked) return { blocked: target.blocked, blockReason: target.blockReason };
      return target.clicked === true;
    }
    const target = globalThis.inspectInstagram({ id, action: 'close' });
    if (target.blocked) throw new Error(target.blocked);
    if (!target.point) return false;
    const button = document.elementFromPoint(target.point.x, target.point.y)?.closest('button,[role="button"]');
    if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return false;
    button.click(); return true;
  }, [post.id, job.deadline]);
  if (clicked?.blocked) throw blockError(clicked);
  if (!clicked) return false;
  const until = Math.min(Date.now() + 10000, job.deadline);
  while (Date.now() < until) {
    assertRunning();
    const tab = await chrome.tabs.get(job.tabId);
    if (sameDestination(tab.url, searchURL) && !tab.pendingUrl) {
      const page = await inspect();
      if (page.blocked) throw new Error(page.blocked);
      if (!page.post && !page.unavailable) return true;
    }
    await sleep(400);
  }
  return false;
  });
}
async function scroll() {
  try {
    const moved = await execute(async deadline => {
    if (Date.now() >= deadline) return false;
    const inspector = location.hostname.includes('tiktok') ? globalThis.inspectTikTok : globalThis.inspectInstagram;
    const page = inspector();
    if (page.blocked && location.hostname.includes('tiktok')) return { blocked: page.blocked, blockReason: page.blockReason };
    if (page.blocked) throw new Error(page.blocked);
    const resultLink = [...document.querySelectorAll('main a[href],[role="main"] a[href]')].find(link => {
      try {
        const url = new URL(link.href, location.href);
        const postPath = location.hostname.includes('tiktok') ? /^\/@[\w.-]+\/(?:video|photo)\/\d+\/?$/ : /^\/(p|reel)\/[\w-]+\/?$/;
        if (url.origin !== location.origin || !postPath.test(url.pathname)) return false;
        const rect = link.getBoundingClientRect();
        if (!(rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight &&
          rect.right > 0 && rect.left < innerWidth)) return false;
        for (let node = link; node; node = node.parentElement) {
          const style = getComputedStyle(node);
          if (node.getAttribute('aria-hidden') === 'true' || style.visibility === 'hidden' ||
            style.visibility === 'collapse' || style.display === 'none' || style.opacity === '0') return false;
        }
        return true;
      } catch { return false; }
    });
    // Anchor scrolling to results, even when the viewport center is over a
    // sidebar. The document's scrolling element can differ from <html>.
    let root = resultLink || document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    while (root && root !== document.documentElement && !(root.scrollHeight > root.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(root).overflowY))) root = root.parentElement;
    if (!root || root === document.documentElement) root = document.scrollingElement || document.documentElement;
    const before = root.scrollTop;
    root.scrollBy({ top: Math.round(innerHeight * .7), behavior: 'instant' });
    await new Promise(resolve => setTimeout(resolve, 500));
    // Small final movements and virtualized tiles still count; moving unrelated
    // elements or replacing their DOM nodes does not prove the results scrolled.
    return root.scrollTop > before;
  }, [job.deadline]);
    if (moved?.blocked) throw blockError(moved);
    return moved;
  } catch (error) {
    assertRunning();
    if (!transientPageError(error)) throw error;
    return false;
  }
}
// Read-only check for any copy of this comment text in the platform tab.
// Both readers answer it without editing anything.
async function draftStateWithRetry(request) {
  if (typeof request?.comment !== 'string' || !request.comment.trim()) return 'unknown';
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await sleep(500);
    const state = await inspect({ action: 'draft-state', comment: request.comment });
    if (state.blocked) { controller.abort(new Error(state.blocked)); controller.signal.throwIfAborted(); }
    if (state.known === true) return state.holding ? 'present' : 'absent';
  }
  return 'unknown';
}
async function recoverCommentDraft(request) {
  // TikTok drafts are never cleared (its editor owns the DOM), so no clear poll
  // can succeed there. Go straight to the read-only check.
  if (currentPlatform() === 'tiktok') {
    const outcome = await draftStateWithRetry(request) === 'absent' ? 'skipped' : 'draft-retained';
    pendingDraft = false;
    return outcome;
  }
  try {
    await execute((request, deadline) => {
      if (Date.now() >= deadline) return;
      // Never delete native DOM from TikTok's controlled editor. If submission
      // was unavailable, preserve the draft and let the session pause comments.
      if (location.hostname.includes('tiktok')) return;
      const target = globalThis.inspectInstagram({ ...request, action: 'comment-clear' });
      if (target.blocked) throw new Error(target.blocked);
      if (!target.point) return;
      const field = document.elementFromPoint(target.point.x, target.point.y);
      if (!(field instanceof HTMLTextAreaElement) || field !== globalThis.collectiveCommentBefore?.composer || field.value !== request.comment) return;
      globalThis.collectiveCommentBefore.clearing = true;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, '');
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }, [request, job.deadline]);
  } catch (error) {
    assertRunning();
    if (!transientPageError(error)) throw error;
  }
  let cleared = false;
  for (let attempt = 0; attempt < 5 && !cleared; attempt++) {
    await sleep(attempt ? 400 : 250);
    const result = await inspect({ ...request, action: 'comment-cleared' });
    if (result.blocked) throw new Error(result.blocked);
    cleared = result.cleared === true;
  }
  const outcome = cleared || await draftStateWithRetry(request) === 'absent' ? 'skipped' : 'draft-retained';
  pendingDraft = false;
  return outcome;
}
// note(outcome, read, blocked) is called once per check that ran to an outcome:
// persisted, reverted (the page read not-liked / not-following), timed-out (no
// read before the cap), moved, unreadable (no usable read or a script error) or
// blocked. read is the last read's fixed code. The result is still true or false.
async function verifyEngagementOnFreshPost(action, request, note = () => {}) {
  assertRunning();
  const config = platformConfig();
  if (action !== 'follow' && !(action === 'like' && config.platform === 'tiktok')) return false;
  if (!request.author || !config.validPost(request.id)) { note('unreadable', null); return false; }
  const matches = url => config.platform === 'tiktok' ? platformURL(url, 'tiktok') && sameDestination(url, request.id) : url === request.id;
  let tabId;
  let lastRead = null;
  let readFailed = false;
  const until = Math.min(Date.now() + 8000, job.deadline);
  try {
    // TikTok can show an optimistic like/follow that is lost on a fresh load.
    // This separate post checks persisted state and never performs actions.
    const tab = await chrome.tabs.create({ url: request.id, active: false });
    tabId = tab.id;
    while (Date.now() < until) {
      assertRunning();
      const current = await chrome.tabs.get(tabId);
      assertRunning();
      if (current.pendingUrl && !matches(current.pendingUrl)) { note('moved', lastRead); return false; }
      if (!matches(current.url) && current.url !== 'about:blank' && current.url) { note('moved', lastRead); return false; }
      if (current.status === 'complete' && matches(current.url) && !current.pendingUrl) {
        try {
          await chrome.scripting.executeScript({ target: { tabId }, files: [config.script] });
          assertRunning();
          const results = await chrome.scripting.executeScript({
            target: { tabId },
            func: (inspector, request, action, deadline) => Date.now() < deadline ? globalThis[inspector]({ ...request, action: `verify-${action}` }) : {},
            args: [config.inspector, request, action, job.deadline]
          });
          assertRunning();
          const result = results[0]?.result;
          const committed = await chrome.tabs.get(tabId);
          assertRunning();
          if (!matches(committed.url) || committed.pendingUrl) { note('moved', lastRead); return false; }
          if (result?.blocked) { note('blocked', lastRead, result); controller.abort(new Error(result.blocked)); controller.signal.throwIfAborted(); }
          if (result?.confirmed) { note('persisted', 'ok'); return true; }
          lastRead = typeof result?.reason === 'string' ? result.reason : 'unread';
        } catch (error) {
          assertRunning();
          if (!transientPageError(error)) throw error;
          readFailed = true;
          // A fresh document may replace its loading frame. Retry only this
          // read, within the same deadline, after checking its URL again.
        }
      }
      await sleep(500);
    }
    note(['not-liked', 'not-following'].includes(lastRead) ? 'reverted' : lastRead || readFailed ? 'unreadable' : 'timed-out', lastRead);
    return false;
  } catch {
    assertRunning();
    note('unreadable', lastRead);
    // An unavailable read-only confirmation never authorizes another click.
    return false;
  } finally {
    if (tabId !== undefined) {
      try {
        const current = await chrome.tabs.get(tabId);
        if ((!current.pendingUrl || matches(current.pendingUrl)) && (matches(current.url) || ['about:blank', ''].includes(current.url || ''))) await chrome.tabs.remove(tabId);
      } catch { /* The user may already have closed the temporary tab. */ }
    }
  }
}
async function engage(action, post, comment) {
  try { return await performEngagement(action, post, comment); }
  catch (error) {
    assertRunning();
    if (!transientPageError(error)) throw error;
    // A lost action result is never replayed. Keep browsing and suspend comments
    // if an unsent draft could remain in the replaced document.
    const draft = pendingDraft, engaged = pendingEngagement;
    pendingEngagement = false;
    if (draft && !engaged) {
      // Post was never clicked. Only a read-only check showing no copy of the
      // text anywhere in the tab turns this into a definitive skip. The draft
      // flag stays set during the check, so a stop mid-check still warns.
      let state = 'unknown';
      try { state = await draftStateWithRetry({ comment }); }
      catch (probeError) { if (controller.signal.aborted) throw probeError; }
      pendingDraft = false;
      return state === 'absent' ? 'skipped' : 'draft-retained';
    }
    pendingDraft = false;
    return draft && engaged ? 'uncertain-draft' : engaged ? 'uncertain' : 'skipped';
  }
}
async function performEngagement(action, post, comment) {
  assertRunning();
  const request = { id: post.id, author: post.author, comment, ...(action === 'comment' ? { caption: post.caption } : {}) };
  const page = await inspect();
  if (page.blocked) throw new Error(page.blocked);
  if (page.unavailable) return 'skipped';
  assertRunning();
  if (action === 'comment' && currentPlatform() === 'tiktok') {
    const opened = await execute((request, deadline) => {
      if (Date.now() >= deadline) return false;
      const result = globalThis.inspectTikTok({ ...request, action: 'click-comment-open' });
      if (result.blocked) return { blocked: result.blocked, blockReason: result.blockReason };
      return result.opened === true;
    }, [request, job.deadline]);
    if (opened?.blocked) throw blockError(opened);
    if (!opened) return 'skipped';
    let ready = false;
    for (let attempt = 0; attempt < 8; attempt++) {
      const target = await inspect({ ...request, action: 'comment-field' });
      if (target.blocked) throw new Error(target.blocked);
      if (target.changed) return 'skipped';
      if (target.point) { ready = true; break; }
      await sleep(400);
    }
    if (!ready) return 'skipped';
  }
  if (action === 'comment' && currentPlatform() === 'instagram') {
    // Phase one only takes ownership and focuses the empty composer. Nothing is
    // typed, so a lost frame here is a definitive skip, never a possible draft.
    pendingDraft = false; pendingEngagement = false;
    const focused = await execute((request, deadline) => {
      if (Date.now() >= deadline) return false;
      const target = globalThis.inspectInstagram({ ...request, action: 'comment-field' });
      if (target.blocked) throw new Error(target.blocked);
      if (!target.point) return false;
      const hit = document.elementFromPoint(target.point.x, target.point.y);
      if (!(hit instanceof HTMLTextAreaElement) || hit.value.trim() || hit !== globalThis.collectiveCommentBefore?.composer) return false;
      hit.focus();
      const ready = globalThis.inspectInstagram({ ...request, action: 'comment-ready' });
      if (ready.blocked) throw new Error(ready.blocked);
      return ready.ready === true ? 'focused' : false;
    }, [request, job.deadline]);
    if (focused !== 'focused') return 'skipped';
    assertRunning();
  }
  pendingDraft = action === 'comment';
  pendingEngagement = action !== 'comment';
  const clicked = await execute((action, request, deadline) => {
    if (Date.now() >= deadline) return false;
    const inspector = location.hostname.includes('tiktok') ? globalThis.inspectTikTok : globalThis.inspectInstagram;
    if (location.hostname.includes('tiktok')) {
      if (action === 'comment') {
        const target = inspector({ ...request, action: 'comment-field' });
        if (target.blocked) return { blocked: target.blocked, blockReason: target.blockReason };
        const before = globalThis.collectiveCommentBefore;
        const field = before?.composer;
        if (!target.point || !field?.isConnected || !field.isContentEditable || field.textContent.trim()) return false;
        field.focus();
        const ready = inspector({ ...request, action: 'comment-ready' });
        if (ready.blocked) return { blocked: ready.blocked, blockReason: ready.blockReason };
        if (!ready.ready) return false;
        before.drafted = true;
        before.inputting = true;
        before.inputtingUntil = Date.now() + 1000;
        try {
          // Draft.js owns the editor DOM. Its paste handler updates editor state;
          // native insertText can remove nodes that React still expects to own.
          const clipboardData = new DataTransfer();
          clipboardData.setData('text/plain', request.comment);
          field.dispatchEvent(new ClipboardEvent('paste', { clipboardData, bubbles: true, cancelable: true }));
        } finally { before.inputting = false; }
        return 'draft';
      }
      if (!['like', 'follow'].includes(action)) return false;
      const target = inspector({ ...request, action: `click-${action}` });
      if (target.blocked) return { blocked: target.blocked, blockReason: target.blockReason };
      return target.clicked === true;
    }
    if (action === 'comment') {
      // Phase two: the composer focused in phase one must still be ours, empty and focused.
      const before = globalThis.collectiveCommentBefore;
      const field = before?.composer;
      if (!(field instanceof HTMLTextAreaElement) || !field.isConnected || field.value !== '' || document.activeElement !== field) return false;
      const ready = inspector({ ...request, action: 'comment-ready' });
      if (ready.blocked) throw new Error(ready.blocked);
      if (!ready.ready) return false;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, request.comment);
      before.drafted = true;
      field.dispatchEvent(new Event('input', { bubbles: true }));
      return 'draft';
    }
    const target = inspector({ ...request, action });
    if (target.blocked) throw new Error(target.blocked);
    if (!target.point) return false;
    const hit = document.elementFromPoint(target.point.x, target.point.y);
    const button = hit?.closest('button,[role="button"]');
    if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return false;
    button.click();
    return true;
  }, [action, request, job.deadline]);
  if (clicked?.blocked) throw blockError(clicked);
  if (!clicked) { pendingDraft = false; pendingEngagement = false; return 'skipped'; }
  if (clicked === 'draft') {
    let submitted = false;
    const notReady = new Set();
    let lastNotReady = 'unknown';
    // Wait for the platform's composer, but never retry a submitted comment.
    for (let attempt = 0; attempt < 8 && !submitted; attempt++) {
      await sleep(400);
      assertRunning();
      pendingEngagement = true;
      const answer = await execute((request, deadline) => {
        if (Date.now() >= deadline) return false;
        if (location.hostname.includes('tiktok')) {
          const target = globalThis.inspectTikTok({ ...request, action: 'click-comment-submit' });
          if (target.blocked) return { blocked: target.blocked, blockReason: target.blockReason };
          return target.clicked === true || (typeof target.reason === 'string' ? target.reason : false);
        }
        const target = globalThis.inspectInstagram({ ...request, action: 'comment-submit' });
        if (target.blocked) throw new Error(target.blocked);
        if (!target.point) { console.warn('Warm-up comment not ready:', target.reason || 'unknown'); return false; }
        const button = document.elementFromPoint(target.point.x, target.point.y)?.closest('button,[role="button"]');
        if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return false;
        globalThis.collectiveCommentBefore.submitted = true;
        button.click(); return true;
      }, [request, job.deadline]);
      if (answer?.blocked) throw blockError(answer);
      submitted = answer === true;
      if (!submitted) {
        pendingEngagement = false;
        lastNotReady = typeof answer === 'string' ? answer : 'unknown';
        notReady.add(lastNotReady);
      }
    }
    if (!submitted) {
      countDiagnostic({ type: 'submit', code: lastNotReady });
      const outcome = await recoverCommentDraft(request);
      // TikTok's editor stayed empty on every check and no copy of the text is
      // anywhere: the typed text never arrived. The session counts these so an
      // ignored paste turns comments off instead of skipping silently each time.
      return outcome === 'skipped' && currentPlatform() === 'tiktok' && notReady.size === 1 && notReady.has('composer-empty') ? 'not-typed' : outcome;
    }
    pendingDraft = false;
  }
  const confirmationAttempts = { like: 6, follow: 10, comment: 12 }[action] || 6;
  let confirmationReason;
  for (let i = 0; i < confirmationAttempts; i++) {
    await sleep(750);
    const result = await inspect({ ...request, action: `verify-${action}` });
    confirmationReason = result.reason;
    if (result.blocked) throw new Error(result.blocked);
    if (result.confirmed) {
      // TikTok can show a like or follow optimistically before rolling it back.
      // Require a separate loaded page before counting it as accepted.
      if (['like', 'follow'].includes(action) && currentPlatform() === 'tiktok') break;
      if (action === 'comment') countDiagnostic({ type: 'confirm', code: 'confirmed' });
      pendingEngagement = false; pendingDraft = false; return 'confirmed';
    }
  }
  if (action === 'comment') countDiagnostic({ type: 'confirm', code: confirmationReason || 'unknown' });
  if (action === 'comment' && currentPlatform() === 'tiktok') {
    console.warn('Warm-up comment confirmation:', confirmationReason || 'not-confirmed');
  }
  // The in-place result (ok, or the last read's code) is kept beside the fresh
  // page's outcome, so "shown, then undone" and "never shown" stay apart.
  const inPlace = typeof confirmationReason === 'string' ? confirmationReason : 'unread';
  const needsFreshConfirmation = action === 'follow' || (action === 'like' && currentPlatform() === 'tiktok');
  const confirmed = needsFreshConfirmation && await verifyEngagementOnFreshPost(action, request, (fresh, read, blocked) => {
    if (blocked) noteBlock(blocked);
    countDiagnostic({ type: 'engagement', action, inPlace, fresh, read });
  });
  pendingEngagement = false;
  pendingDraft = false;
  if (confirmed) return 'confirmed';
  return 'uncertain';
}
function render(state) {
  commentHistory.render(document, state.comments);
  el('message').textContent = state.message;
  el('status').textContent = state.phase;
  el('stop').disabled = !['starting','running'].includes(state.phase);
  document.body.classList.toggle('running', state.phase === 'running');
  sessionResults.render(document, state, '');
  el('activity').replaceChildren(...(state.activity || []).map(item => {
    const row = document.createElement('li');
    const time = document.createElement('time');
    time.dateTime = new Date(item.time).toISOString();
    time.textContent = new Date(item.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const text = document.createElement('span'); text.textContent = item.message; row.append(time, text); return row;
  }));
}
function update(patch) {
  // Diagnostics ride with every update, so an action that finishes during Stop keeps them.
  const next = { ...patch, phase: 'running', ...(diagnostics ? { diagnostics } : {}) };
  messageQueue = messageQueue.then(async () => {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { await send('runner-update', { patch: next }); return; }
      catch (error) {
        if (attempt === 2 || controller.signal.aborted) throw error;
        await sleep(250 * (attempt + 1));
      }
    }
  }).catch(error => { controller.abort(error); });
}
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (job?.tabId === tabId && change.url && expectedDestination && !sameDestination(change.url, expectedDestination) && !allowedViewerDestination(change.url)) controller.abort(new Error(`session stopped because the ${currentPlatform()} page changed.`));
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'session' || !changes.job) return;
  const next = changes.job.newValue;
  if (!next || next.token !== token || next.stopRequested) controller.abort(new Error(next?.message || 'session stopped.'));
  if (next?.token === token) {
    job = next;
    if (!terminalResult || !['starting','running','stopping'].includes(next.phase)) render(next);
  }
});
el('stop').addEventListener('click', () => {
  controller.abort(new Error('session stopped. you have control.'));
  if (terminalResult) { void finish(terminalResult); return; }
  void send('runner-stop').catch(() => {});
});
el('show-instagram').addEventListener('click', () => { void send('runner-show').catch(error => { el('message').textContent = error.message; }); });
document.addEventListener('keydown', event => { if (event.key === 'Escape') el('stop').click(); });
async function start() {
  for (let attempt = 0; attempt < 8; attempt++) {
    try { job = await send('runner-job'); break; } catch (error) { if (attempt === 7) throw error; await sleep(250); }
  }
  // Counts continue from the job, so a resumed or refreshed session keeps them.
  diagnostics = job.diagnostics ? warmupDiagnostics.normalize(job.diagnostics) : null;
  if (['running','stopping'].includes(job.phase)) {
    controller.abort(new Error('session stopped after its tab refreshed.'));
    await send('runner-stop');
    if (await finish(withDiagnostics({ phase: 'stopped', message: `session stopped after its tab refreshed. check ${currentPlatform()} before restarting.` }, 'tab-refreshed'))) {
      el('message').textContent = 'session stopped after this tab refreshed. start a new session from the dashboard.';
      el('status').textContent = 'stopped'; el('stop').disabled = true;
    }
    return;
  }
  if (job.stopRequested || job.phase !== 'starting') { render(job); return; }
  render(job);
  el('message').textContent = `connecting to ${currentPlatform()}…`;
  el('show-instagram').textContent = `show ${currentPlatform()}`;
  const remaining = () => { const seconds = Math.max(0, Math.ceil((job.deadline - Date.now()) / 1000)); el('remaining').textContent = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2,'0')}`; };
  const timer = setInterval(() => { remaining(); if (Date.now() >= job.deadline) controller.abort(new Error('time’s up. your session is complete.')); }, 250);
  remaining();
  let searchURL;
  countDiagnostic({ type: 'run' });
  try {
    const config = platformConfig();
    await sessionEngine.runSession(job.settings, {
      update, inspect: () => inspect(), scroll, engage,
      checkpoint: async checkpoint => {
        await messageQueue;
        await send('runner-checkpoint', { checkpoint });
      },
      advance: (post, signal, hasSeen) => recoverPageStep(() => advanceViewer(post, hasSeen)).then(moved => {
        if (moved === true) countDiagnostic({ type: 'advance' });
        return moved;
      }),
      search: async term => { searchURL = config.searchURL(term); return recoverPageStep(() => navigate(searchURL)); },
      open: target => recoverPageStep(() => openViewer(target)),
      leavePost: post => recoverPageStep(() => returnToResults(post, searchURL)),
      draftState: comment => recoverPageStep(() => draftStateWithRetry({ comment })).then(state => state || 'unknown')
    }, controller.signal, { getFocus: () => job.settings.focus, checkpoint: job.checkpoint, remainingMs: Math.max(0, job.deadline - Date.now()), commentSalt: sessionSalt() });
    await messageQueue;
    controller.signal.throwIfAborted();
    await finish(withDiagnostics({ phase: 'complete', message: 'time’s up. your session is complete.' }, 'deadline'));
  } catch (error) {
    await messageQueue;
    const finished = !job.stopRequested && Date.now() >= job.deadline;
    const { end, block } = sessionEnd(error, finished);
    await finish(withDiagnostics({ phase: pendingEngagement || pendingDraft ? 'error' : finished ? 'complete' : controller.signal.aborted ? 'stopped' : 'error', message: pendingEngagement ? `${error.message || 'session stopped.'} an action may have gone through. check ${currentPlatform()} before restarting.` : pendingDraft ? `a comment draft may remain in ${currentPlatform()}. review it before restarting.` : error.message || 'session stopped. try again.' }, end, block));
  } finally { clearInterval(timer); remaining(); }
}
start().catch(async error => {
  controller.abort(error);
  const message = `${error.message || 'session couldn’t start.'} check ${job ? currentPlatform() : 'the platform'} before restarting.`;
  if (await finish(withDiagnostics({ phase: 'error', message }, 'error'))) {
    el('message').textContent = message; el('status').textContent = 'couldn’t start'; el('stop').disabled = true;
  }
});
