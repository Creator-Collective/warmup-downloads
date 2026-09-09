'use strict';
const token = location.hash.slice(1);
const controller = new AbortController();
let job;
let expectedDestination;
let viewerSequence = [];
let pendingEngagement = false;
let pendingDraft = false;
let messageQueue = Promise.resolve();
let terminalResult;
let terminalAcknowledgement;
const el = id => document.getElementById(id);
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
      return platformURL(url, platform) && (platform === 'tiktok' ? /^\/@[\w.-]+\/video\/\d+\/?$/.test(u.pathname) : /^\/(p|reel)\/[\w-]+\/$/.test(u.pathname)) && !u.search && !u.hash;
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
const sleep = ms => new Promise((resolve, reject) => {
  if (controller.signal.aborted) return reject(controller.signal.reason);
  const abort = () => { clearTimeout(timer); reject(controller.signal.reason); };
  const timer = setTimeout(() => { controller.signal.removeEventListener('abort', abort); resolve(); }, ms);
  controller.signal.addEventListener('abort', abort, { once: true });
});
async function execute(func, args = []) {
  assertRunning();
  const config = platformConfig();
  const tab = await chrome.tabs.get(job.tabId);
  if (!platformURL(tab.url, config.platform)) throw new Error(`the selected tab left ${config.label}.`);
  assertRunning();
  const result = await chrome.scripting.executeScript({ target: { tabId: job.tabId }, func, args });
  assertRunning();
  if (!result[0]) throw new Error(`${config.label} stopped responding.`);
  return result[0].result;
}
async function inspect(request = {}) {
  assertRunning();
  const config = platformConfig();
  await chrome.scripting.executeScript({ target: { tabId: job.tabId }, files: [config.script] });
  return execute((inspector, request) => globalThis[inspector](request), [config.inspector, request]);
}
async function navigate(url) {
  assertRunning();
  const config = platformConfig();
  if (!platformURL(url, config.platform)) throw new Error(`only ${config.label} pages are supported.`);
  expectedDestination = url;
  await chrome.tabs.update(job.tabId, { url });
  const until = Math.min(Date.now() + 25000, job.deadline);
  while (Date.now() < until) {
    assertRunning();
    const tab = await chrome.tabs.get(job.tabId);
    if (!platformURL(tab.url, config.platform)) throw new Error(`${config.label} needs your attention.`);
    if (tab.status === 'complete' && tab.url === url && !tab.pendingUrl) {
      const page = await inspect();
      if (page.blocked) throw new Error(page.blocked);
      const committed = await chrome.tabs.get(job.tabId);
      assertRunning();
      if (committed.url === url && committed.status === 'complete' && !committed.pendingUrl && (page.post || page.posts?.length)) return;
    }
    await sleep(500);
  }
  throw new Error(`posts didn’t load. check ${config.label} and try another keyword.`);
}
async function waitForPost(target) {
  const config = platformConfig();
  const until = Math.min(Date.now() + 15000, job.deadline);
  while (Date.now() < until) {
    assertRunning();
    const page = await inspect();
    if (page.blocked) throw new Error(page.blocked);
    if (page.post?.id === target && page.post.viewer) return true;
    await sleep(400);
  }
  throw new Error(`the next post didn’t load. check ${config.label} before restarting.`);
}
async function openViewer(target) {
  const config = platformConfig();
  if (!config.validPost(target)) throw new Error('invalid post address.');
  const page = await inspect();
  viewerSequence = page.sequence || page.posts || [];
  if (!viewerSequence.includes(target)) throw new Error('that search result changed. start a new session.');
  expectedDestination = target;
  const clicked = await execute((target, deadline) => {
    const inspector = location.hostname.includes('tiktok') ? globalThis.inspectTikTok : globalThis.inspectInstagram;
    if (Date.now() >= deadline || inspector().blocked) return false;
    const normalize = value => {
      const url = new URL(value, location.href);
      if (location.hostname.includes('tiktok')) return /^\/@[\w.-]+\/video\/\d+\/?$/.test(url.pathname) ? `https://www.tiktok.com${url.pathname.replace(/\/?$/, '/')}` : null;
      return url.origin === location.origin && /^\/(p|reel)\/[\w-]+\/?$/.test(url.pathname) ? `${url.origin}${url.pathname.replace(/\/?$/, '/')}` : null;
    };
    const link = [...document.querySelectorAll('main a[href],[role="main"] a[href],a[href]')].find(a => normalize(a.href) === target && a.getBoundingClientRect().width > 0);
    if (!link) return false;
    link.click(); return true;
  }, [target, job.deadline]);
  if (!clicked) throw new Error('the search result isn’t available. start a new session.');
  await waitForPost(target);
}
async function advanceViewer(post) {
  if (!post.viewer || !post.next) return false;
  const index = viewerSequence.indexOf(post.id);
  const target = index >= 0 ? viewerSequence[index + 1] : null;
  if (!target) return false;
  assertRunning();
  expectedDestination = target;
  const clicked = await execute((id, deadline) => {
    if (Date.now() >= deadline) return false;
    const inspector = location.hostname.includes('tiktok') ? globalThis.inspectTikTok : globalThis.inspectInstagram;
    const next = inspector({id, action:'next'});
    if (!next.point) return false;
    const button = document.elementFromPoint(next.point.x, next.point.y)?.closest('button,[role="button"]');
    if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return false;
    button.click(); return true;
  }, [post.id, job.deadline]);
  if (!clicked) return false;
  await waitForPost(target);
  return true;
}
async function scroll() {
  return execute(async deadline => {
    if (Date.now() >= deadline) return false;
    const inspector = location.hostname.includes('tiktok') ? globalThis.inspectTikTok : globalThis.inspectInstagram;
    const page = inspector();
    if (page.blocked) throw new Error(page.blocked);
    const markers = [...document.querySelectorAll('video,img,a[href],h1,h2,p')].filter(e => {
      const r = e.getBoundingClientRect(); return r.width > 40 && r.height > 12 && r.bottom > 0 && r.top < innerHeight;
    }).slice(0, 100).map(e => ({ e, rect: e.getBoundingClientRect() }));
    let root = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    while (root && root !== document.documentElement && !(root.scrollHeight > root.clientHeight + 100 && /(auto|scroll)/.test(getComputedStyle(root).overflowY))) root = root.parentElement;
    (root || document.scrollingElement).scrollBy({ top: Math.round(innerHeight * .7), behavior: 'instant' });
    await new Promise(resolve => setTimeout(resolve, 500));
    return markers.some(({ e, rect }) => { const next = e.getBoundingClientRect(); return e.isConnected && rect.top - next.top >= Math.min(100, innerHeight * .15) && Math.abs(rect.height - next.height) < 2; });
  }, [job.deadline]);
}
async function engage(action, post, comment) {
  assertRunning();
  const request = { id: post.id, author: post.author, comment, ...(action === 'comment' ? { caption: post.caption } : {}) };
  const page = await inspect();
  if (page.blocked) throw new Error(page.blocked);
  assertRunning();
  pendingDraft = action === 'comment';
  pendingEngagement = action !== 'comment';
  const clicked = await execute((action, request, deadline) => {
    if (Date.now() >= deadline) return false;
    const inspector = location.hostname.includes('tiktok') ? globalThis.inspectTikTok : globalThis.inspectInstagram;
    const target = inspector({ ...request, action: action === 'comment' ? 'comment-field' : action });
    if (!target.point) return false;
    const hit = document.elementFromPoint(target.point.x, target.point.y);
    if (action === 'comment') {
      if (!(hit instanceof HTMLTextAreaElement) || hit.value.trim()) return false;
      hit.focus();
      const ready = inspector({ ...request, action: 'comment-ready' });
      if (!ready.ready) return false;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(hit, request.comment);
      hit.dispatchEvent(new Event('input', { bubbles: true }));
      return 'draft';
    }
    const button = hit?.closest('button,[role="button"]');
    if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return false;
    button.click();
    return true;
  }, [action, request, job.deadline]);
  if (!clicked) { pendingDraft = false; pendingEngagement = false; return 'skipped'; }
  if (clicked === 'draft') {
    await sleep(400);
    assertRunning();
    pendingEngagement = true;
    const submitted = await execute((request, deadline) => {
      if (Date.now() >= deadline) return false;
      const inspector = location.hostname.includes('tiktok') ? globalThis.inspectTikTok : globalThis.inspectInstagram;
      const target = inspector({ ...request, action: 'comment-submit' });
      if (!target.point) return false;
      const button = document.elementFromPoint(target.point.x, target.point.y)?.closest('button,[role="button"]');
      if (!button || button.disabled) return false;
      button.click(); return true;
    }, [request, job.deadline]);
    if (!submitted) { pendingEngagement = false; throw new Error(`a comment draft remains in ${currentPlatform()}. review it before restarting.`); }
    pendingDraft = false;
  }
  const confirmationAttempts = { like: 6, follow: 10, comment: 8 }[action] || 6;
  for (let i = 0; i < confirmationAttempts; i++) {
    await sleep(750);
    const result = await inspect({ ...request, action: `verify-${action}` });
    if (result.confirmed) { pendingEngagement = false; pendingDraft = false; return 'confirmed'; }
  }
  pendingEngagement = false;
  pendingDraft = false;
  return 'uncertain';
}
function render(state) {
  el('message').textContent = state.message;
  el('status').textContent = state.phase;
  el('stop').disabled = !['starting','running'].includes(state.phase);
  document.body.classList.toggle('running', state.phase === 'running');
  for (const action of ['scroll','like','follow','comment']) el(action).textContent = state.stats?.[action] || 0;
  el('activity').replaceChildren(...(state.activity || []).map(item => {
    const row = document.createElement('li');
    const time = document.createElement('time');
    time.textContent = new Date(item.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const text = document.createElement('span'); text.textContent = item.message; row.append(time, text); return row;
  }));
}
function update(patch) {
  const next = { ...patch, phase: 'running' };
  messageQueue = messageQueue.then(() => send('runner-update', { patch: next })).catch(error => { controller.abort(error); });
}
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (job?.tabId === tabId && change.url && change.url !== expectedDestination) controller.abort(new Error(`session stopped because the ${currentPlatform()} page changed.`));
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
  if (['running','stopping'].includes(job.phase)) {
    controller.abort(new Error('session stopped after its tab refreshed.'));
    await send('runner-stop');
    if (await finish({ phase: 'stopped', message: `session stopped after its tab refreshed. check ${currentPlatform()} before restarting.` })) {
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
  try {
    const config = platformConfig();
    await sessionEngine.runSession(job.settings, {
      update, inspect: () => inspect(), scroll, engage, advance: advanceViewer,
      search: async term => { searchURL = config.searchURL(term); await navigate(searchURL); },
      open: openViewer,
      leavePost: async () => { if (searchURL) await navigate(searchURL); }
    }, controller.signal);
    await messageQueue;
    controller.signal.throwIfAborted();
    await finish({ phase: 'complete', message: 'time’s up. your session is complete.' });
  } catch (error) {
    await messageQueue;
    const finished = Date.now() >= job.deadline;
    await finish({ phase: pendingEngagement || pendingDraft ? 'error' : finished ? 'complete' : controller.signal.aborted ? 'stopped' : 'error', message: pendingEngagement ? `an action may have gone through. check ${currentPlatform()} before restarting.` : pendingDraft ? `a comment draft may remain in ${currentPlatform()}. review it before restarting.` : error.message || 'session stopped. try again.' });
  } finally { clearInterval(timer); remaining(); }
}
start().catch(async error => {
  controller.abort(error);
  const message = `${error.message || 'session couldn’t start.'} check ${job ? currentPlatform() : 'the platform'} before restarting.`;
  if (await finish({ phase: 'error', message })) {
    el('message').textContent = message; el('status').textContent = 'couldn’t start'; el('stop').disabled = true;
  }
});
