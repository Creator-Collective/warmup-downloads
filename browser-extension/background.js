'use strict';
importScripts('features.js', 'plan.js', 'comment-history.js', 'guards.js', 'signup-fields.js', 'signup-phone.js', 'smspool.js', 'signup.js');
let queue = Promise.resolve();
const serial = operation => { const result = queue.then(operation); queue = result.catch(() => {}); return result; };
const getJob = async () => (await chrome.storage.session.get('job')).job;
const putJob = job => chrome.storage.session.set({ job });
const extensionOrigin = chrome.runtime.getURL('/');
// Each build lists the platforms it may drive in features.js. A build without
// the list (0.6.57 and older feature files) stays instagram only.
const enabledPlatforms = Object.freeze(Array.isArray(productFeatures.platforms)
  ? productFeatures.platforms.filter(name => typeof name === 'string' && Object.hasOwn(platforms, name))
  : ['instagram']);
const PLATFORM_UNAVAILABLE = enabledPlatforms.length === 1 && enabledPlatforms[0] === 'tiktok' ? 'this test build runs tiktok only.' : 'warm-up is instagram only for now.';
const testToolsEnabled = productFeatures.testTools === true;
function freezeJob(job, patch = {}) {
  const frozen = job.stopRequested || ['stopped', 'error', 'complete'].includes(job.phase);
  const remainingMs = patch.phase === 'complete' ? 0 : frozen ? remainingTime(job) : Math.min(
    remainingTime(job), Number.isFinite(job.checkpoint?.remainingMs) ? job.checkpoint.remainingMs : Infinity
  );
  const checkpoint = job.checkpoint ? { ...job.checkpoint, remainingMs, elapsedMs: job.settings.minutes * 60000 - remainingMs } : null;
  return { ...job, ...patch, remainingMs, checkpoint };
}
async function closeOwnedRunner(job) {
  if (!job?.runnerTabId) return;
  const tabs = await chrome.tabs.query({});
  const runner = tabs.find(tab => tab.id === job.runnerTabId);
  if (!runner) return;
  const expected = chrome.runtime.getURL(`runner.html#${job.token}`);
  if (runner.url === expected) await chrome.tabs.remove(runner.id);
  else if (!runner.url || runner.pendingUrl === expected) throw new Error('the previous session tab is still loading. close it before continuing.');
}
function enabledPlatform(value) {
  const platform = validPlatform(value);
  if (!enabledPlatforms.includes(platform)) throw new Error(PLATFORM_UNAVAILABLE);
  return platform;
}
async function suspendDisabledJob() {
  const job = await getJob();
  if (!job || !['starting', 'running', 'stopping'].includes(job.phase)) return job;
  // A saved session without a platform is an instagram session, as everywhere else.
  // An unrecognised platform is left as it is, which is what older builds did.
  let platform;
  try { platform = validPlatform(job.settings?.platform); } catch { return job; }
  if (enabledPlatforms.includes(platform)) return job;
  const stopped = freezeJob(job, { phase: 'stopped', stopRequested: true, nextActionAt: null, message: `${platforms[platform].label} session stopped. ${PLATFORM_UNAVAILABLE}` });
  await putJob(stopped);
  return stopped;
}
async function stopJob(message = 'session stopped. you have control.') {
  const job = await getJob();
  if (job && ['starting', 'running'].includes(job.phase)) await putJob(freezeJob(job, { stopRequested: true, stopRequestedAt: Date.now(), phase: 'stopping', nextActionAt: null, message }));
}
async function recoverStoppingJob(force = false) {
  const job = await getJob();
  if (!job || job.phase !== 'stopping' || (!force && Number.isFinite(job.stopRequestedAt) && Date.now() - job.stopRequestedAt < 3000)) return job;
  // A missing acknowledgement cannot release the action lock while the old
  // runner is still alive. Close only that runner before allowing another run.
  try {
    await closeOwnedRunner(job);
    const stopped = freezeJob(job, { phase: 'error', stopRequested: true, nextActionAt: null, message: `session stopped after its tab stopped responding. an action already sent may still complete. check ${platforms[validPlatform(job.settings?.platform)].label} before restarting.` });
    await putJob(stopped);
    return stopped;
  } catch {
    const stopping = { ...job, message: `couldn’t finish stopping. close the session tab, then check ${platforms[validPlatform(job.settings?.platform)].label} before restarting.` };
    await putJob(stopping);
    return stopping;
  }
}
async function dashboardCommand(message) {
  if (message.type === 'setup-info') return { version: chrome.runtime.getManifest().version, canOpenExtensions: true };
  if (message.type === 'open-extensions') {
    const tab = await chrome.tabs.create({ url: 'chrome://extensions/' });
    return { tabId: tab.id };
  }
  await suspendDisabledJob();
  if (message.type === 'hello') return { version: chrome.runtime.getManifest().version, supportsFocus: true, platforms: [...enabledPlatforms], ...(testToolsEnabled ? { testTools: true } : {}), state: publicState(await recoverStoppingJob(), enabledPlatforms) };
  if (message.type === 'state') return publicState(await recoverStoppingJob(), enabledPlatforms);
  if (message.type === 'set-focus') {
    const focus = sessionPlan.validateFocus(message.focus);
    const job = await getJob();
    if (typeof message.sessionId !== 'string' || !job?.sessionId || message.sessionId !== job.sessionId ||
        !['starting', 'running'].includes(job.phase) || job.stopRequested || job.deadline <= Date.now()) {
      throw new Error('this session has ended or changed.');
    }
    const next = { ...job, settings: { ...job.settings, focus } };
    await putJob(next);
    return publicState(next, enabledPlatforms);
  }
  if (message.type === 'tabs') {
    const platform = enabledPlatform(message.platform);
    const tabs = await chrome.tabs.query({ url: [...platforms[platform].patterns] });
    return tabs.filter(tab => !tab.incognito && platformURL(tab.url, platform)).map(tab => ({ id: tab.id, title: tab.title || platforms[platform].label }));
  }
  if (message.type === 'open-instagram' || message.type === 'open-platform') {
    const platform = enabledPlatform(message.platform);
    const tab = await chrome.tabs.create({ url: platforms[platform].home });
    return { tabId: tab.id };
  }
  if (message.type === 'stop') {
    const wasStopping = (await getJob())?.phase === 'stopping';
    await stopJob();
    return publicState(await recoverStoppingJob(wasStopping), enabledPlatforms);
  }
  if (!['start', 'resume'].includes(message.type)) throw new Error('unknown dashboard action.');
  await signupController.suspendIfDisabled();
  if (signupController.isActive(await signupController.read())) throw new Error('finish or stop account signup before starting warm-up.');
  const current = await getJob();
  const resuming = message.type === 'resume';
  if (resuming && (typeof message.sessionId !== 'string' || message.sessionId !== current?.sessionId || !resumableJob(current, enabledPlatforms))) throw new Error('this session can’t be resumed. start a new session.');
  const settings = resuming ? current.settings : sessionPlan.validateSettings(message.settings);
  const platform = enabledPlatform(settings.platform);
  if (!Number.isInteger(message.tabId)) throw new Error(`choose a ${platforms[platform].label} tab first.`);
  if (current && ['starting', 'running', 'stopping'].includes(current.phase)) throw new Error('a session is already running. stop it before starting another.');
  const tab = await chrome.tabs.get(message.tabId);
  if (!platformURL(tab.url, platform)) throw new Error(`that tab is no longer on ${platforms[platform].label}. choose it again.`);
  if (tab.incognito) throw new Error('use a regular chrome window for this session.');
  await closeOwnedRunner(current);
  const token = crypto.randomUUID();
  const remainingMs = resuming ? remainingTime(current) : settings.minutes * 60000;
  const checkpoint = resuming ? { ...normalizeCheckpoint(current.checkpoint, settings), remainingMs, elapsedMs: settings.minutes * 60000 - remainingMs } : null;
  const job = { token, sessionId: resuming ? current.sessionId : crypto.randomUUID(), tabId: tab.id, runnerTabId: null, settings, phase: 'starting', stopRequested: false, deadline: Date.now() + remainingMs, remainingMs, checkpoint,
    stats: resuming ? current.stats : {}, unconfirmed: resuming ? current.unconfirmed : normalizeUnconfirmed(), pausedActions: resuming ? current.pausedActions : [], activity: resuming ? current.activity : [], comments: resuming ? current.comments : [], message: resuming ? 'resuming your session…' : 'starting your session…', nextActionAt: null };
  await putJob(job);
  try {
    const runner = await chrome.tabs.create({ url: chrome.runtime.getURL(`runner.html#${token}`), active: false, windowId: tab.windowId });
    job.runnerTabId = runner.id;
    await putJob(job);
  } catch (error) {
    await putJob(freezeJob(job, { phase: 'error', stopRequested: true, message: 'couldn’t open the session. try again.' }));
    throw error;
  }
  return publicState(job, enabledPlatforms);
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (!message || typeof message.type !== 'string') return false;
  if (message.type.startsWith('signup-runner-')) {
    if (sender.id !== chrome.runtime.id) return false;
    const revision = signupController.revision();
    const operation = message.type === 'signup-runner-stop' ? signupController.runnerCommand(message, sender) : serial(() => signupController.runnerCommand(message, sender, revision));
    operation.then(data => respond({ ok: true, data }), error => respond({ ok: false, error: error.message }));
    return true;
  }
  // Signup details are accepted only from the packaged side panel. Neither
  // the public website bridge nor platform content can read or send them.
  if (message.type.startsWith('signup-')) {
    if (!panelSender(sender, extensionOrigin)) return false;
    const revision = signupController.revision();
    const operation = message.type === 'signup-stop' ? signupController.command(message) : serial(() => signupController.command(message, revision));
    operation.then(data => respond({ ok: true, data }), error => respond({ ok: false, error: error.message }));
    return true;
  }
  if (dashboardSender(sender) || panelSender(sender, extensionOrigin)) {
    serial(() => dashboardCommand(message)).then(data => respond({ ok: true, data }), error => respond({ ok: false, error: error.message }));
    return true;
  }
  if (sender.id !== chrome.runtime.id) return false;
  serial(async () => {
    const job = await suspendDisabledJob();
    if (!runnerSender(sender, job, extensionOrigin) || message.token !== job.token) throw new Error('this session is no longer active.');
    if (message.type === 'runner-job') return job;
    if (message.type === 'runner-stop') { await stopJob(); return null; }
    if (message.type === 'runner-show') { enabledPlatform(job.settings?.platform); await chrome.tabs.update(job.tabId, { active: true }); return null; }
    if (message.type === 'runner-checkpoint') {
      const checkpoint = normalizeCheckpoint(message.checkpoint, job.settings);
      if (!checkpoint) {
        await putJob({ ...job, checkpoint: null });
        throw new Error('couldn’t safely save this session. start a new session after stopping.');
      }
      const frozen = job.stopRequested || ['stopped', 'error', 'complete'].includes(job.phase);
      const remainingMs = frozen ? remainingTime(job) : Math.min(remainingTime(job), checkpoint.remainingMs);
      const saved = { ...checkpoint, remainingMs, elapsedMs: job.settings.minutes * 60000 - remainingMs };
      await putJob({ ...job, checkpoint: saved, remainingMs, stats: saved.stats, unconfirmed: saved.unconfirmed, pausedActions: saved.pausedActions, comments: commentHistory.normalize(saved.comments) });
      return null;
    }
    if (message.type !== 'runner-update') throw new Error('unknown session action.');
    // Repeated terminal acknowledgements are harmless; late updates must never
    // revive a finished session or overwrite its uncertain-action warning.
    if (!['starting', 'running', 'stopping'].includes(job.phase)) return null;
    const patch = message.patch || {};
    const stats = { ...job.stats };
    for (const name of ['scroll','read','search','open','like','follow','comment','skipped']) if (Number.isSafeInteger(patch.stats?.[name]) && patch.stats[name] >= 0) stats[name] = patch.stats[name];
    const outcomes = {
      stats,
      unconfirmed: normalizeUnconfirmed(patch.unconfirmed ?? job.unconfirmed, job.settings?.limits),
      pausedActions: normalizePausedActions(patch.pausedActions ?? job.pausedActions),
      comments: Array.isArray(patch.comments) ? commentHistory.normalize(patch.comments) : job.comments || []
    };
    if (job.stopRequested && !['stopped','complete','error'].includes(patch.phase)) {
      // An action already sent can finish during Stop. Keep its outcome while
      // leaving the stopping phase, timer and message under Stop's control.
      await putJob({ ...job, ...outcomes });
      return null;
    }
    const phase = ['running', 'stopped', 'complete', 'error'].includes(patch.phase) ? patch.phase : job.phase;
    const text = typeof patch.message === 'string' ? patch.message.slice(0, 600) : job.message;
    const activity = text !== job.message ? [{ time: Date.now(), message: text }, ...job.activity].slice(0, 12) : job.activity;
    const next = { ...job, ...outcomes, phase, activity, message: text, nextActionAt: Number.isFinite(patch.nextActionAt) ? Math.min(patch.nextActionAt, job.deadline) : null };
    await putJob(['stopped', 'complete', 'error'].includes(phase) ? freezeJob(job, { ...next, stopRequested: true }) : next);
    return null;
  }).then(data => respond({ ok: true, data }), error => respond({ ok: false, error: error.message }));
  return true;
});
chrome.tabs.onRemoved.addListener(tabId => { void serial(async () => { const job = await getJob(); if (job && [job.runnerTabId, job.tabId].includes(tabId) && ['starting','running','stopping'].includes(job.phase)) { await putJob(freezeJob(job, { stopRequested: true, phase: 'stopped', nextActionAt: null, message: 'session stopped because its tab closed. an action already sent may still complete.' })); } }); });
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (!change.url && !change.discarded) return;
  void serial(async () => {
    const job = await getJob();
    if (!job || !['starting','running','stopping'].includes(job.phase)) return;
    if ((tabId === job.runnerTabId && change.url && change.url !== chrome.runtime.getURL(`runner.html#${job.token}`)) || ([job.runnerTabId,job.tabId].includes(tabId) && change.discarded)) {
      await putJob(freezeJob(job, { stopRequested: true, phase: 'stopped', nextActionAt: null, message: `session stopped because a session tab changed or unloaded. check ${platforms[validPlatform(job.settings?.platform)].label} before restarting.` }));
    } else if (tabId === job.tabId && change.url && !platformURL(change.url, job.settings?.platform)) await stopJob(`session stopped because the tab left ${platforms[validPlatform(job.settings?.platform)].label}.`);
  });
});
// Chrome handles the toolbar click directly, preserving its user gesture.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(error => console.error('Could not enable warm-up side panel:', error.message));
void serial(suspendDisabledJob).catch(error => console.error('Could not stop unavailable warm-up platform:', error.message));
void serial(() => signupController.suspendIfDisabled()).catch(error => console.error('Could not stop paused account creation:', error.message));
chrome.tabs.onRemoved.addListener(tabId => { void signupController.tabRemoved(tabId).catch(() => {}); });
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.url || change.discarded) void signupController.tabUpdated(tabId, { url: change.url, discarded: change.discarded }).catch(() => {});
});
