'use strict';
const signupController = (() => {
  const ENDPOINT = 'https://www.trycreatorcollective.com/api/warmup/native-inbox';
  const activePhases = ['starting', 'running', 'paused'];
  const platforms = ['instagram', 'tiktok'];
  const MAX_SAVED_ACCOUNTS = 3000;
  let cancellationRevision = 0;
  let activeTabs = null;
  let writes = Promise.resolve();
  const requests = new Set();
  const assertRevision = revision => { if (revision !== cancellationRevision) throw new Error('signup stopped. an action already sent may still complete.'); };
  const isActive = job => Boolean(job && activePhases.includes(job.phase));
  function platformURL(value, platform) {
    try { const u = new URL(value); return platforms.includes(platform) && u.protocol === 'https:' && !u.port && !u.username && !u.password && [`www.${platform}.com`, `${platform}.com`].includes(u.hostname); } catch { return false; }
  }
  function username(value, platform) {
    const clean = typeof value === 'string' ? value.trim().replace(/^@/, '') : '';
    const valid = platform === 'instagram' ? /^[a-zA-Z0-9._]{1,30}$/.test(clean) : platform === 'tiktok' && /^[a-zA-Z0-9._]{2,24}$/.test(clean) && !clean.endsWith('.');
    if (!valid) throw new Error('enter a valid username for the selected platform.');
    return clean;
  }
  function track(job) { activeTabs = isActive(job) ? { tabId: job.tabId, runnerTabId: job.runnerTabId, token: job.token, platform: job.platform } : null; }
  function recovery(job) {
    return { requestId: job.requestId, aliasId: job.aliasId, email: job.email, platform: job.platform, username: job.username, phase: job.phase, since: job.since, updatedAt: Date.now() };
  }
  function write(operation) {
    const result = writes.then(operation);
    writes = result.catch(() => {});
    return result;
  }
  async function persist(job, revision) {
    assertRevision(revision);
    track(job);
    await chrome.storage.session.set({ signupJob: job });
    assertRevision(revision);
    if (job.email) {
      const saved = (await chrome.storage.local.get('nativeSignupAccounts')).nativeSignupAccounts;
      assertRevision(revision);
      const accounts = Array.isArray(saved) ? saved : [];
      const index = accounts.findIndex(account => account.requestId === job.requestId);
      const account = recovery(job);
      if (index < 0 && accounts.length >= MAX_SAVED_ACCOUNTS) throw new Error('this device has reached its saved account limit. keep your existing account emails before starting more.');
      if (index < 0) accounts.push(account); else accounts[index] = account;
      await chrome.storage.local.set({ nativeSignupRecovery: account, nativeSignupAccounts: accounts, nativeSignupPending: null });
    } else if (job.requestId) await chrome.storage.local.set({ nativeSignupPending: recovery(job) });
    assertRevision(revision);
    return job;
  }
  const save = (job, revision) => write(() => persist(job, revision));
  function cancelPage(tabs) {
    if (!tabs?.tabId) return Promise.resolve();
    return chrome.scripting.executeScript({ target: { tabId: tabs.tabId }, injectImmediately: true, func: function cancelSignupPage(token, platform) {
      if (window !== window.top || location.protocol !== 'https:' || ![`${platform}.com`, `www.${platform}.com`].includes(location.hostname)) return;
      if (!(globalThis.__ccNativeSignupCancelled instanceof Set)) globalThis.__ccNativeSignupCancelled = new Set();
      globalThis.__ccNativeSignupCancelled.add(token);
    }, args: [tabs.token, tabs.platform] }).catch(() => {});
  }
  // Invalidation happens before any storage/network await. A terminal write is
  // ordered after already-started writes so stale credentials cannot win last.
  async function halt(message = 'signup stopped. an action already sent may still complete.') {
    const revision = ++cancellationRevision;
    const tabs = activeTabs;
    activeTabs = null;
    for (const request of requests) request.abort();
    const cancelled = cancelPage(tabs);
    const stopped = write(async () => {
      assertRevision(revision);
      const job = (await chrome.storage.session.get('signupJob')).signupJob;
      assertRevision(revision);
      if (!job) return null;
      if (!tabs) await cancelPage(job);
      return persist({ ...job, password: '', phase: 'stopped', message }, revision);
    });
    const [job] = await Promise.all([stopped, cancelled]);
    return job;
  }
  async function read(revision = cancellationRevision) {
    const job = (await chrome.storage.session.get('signupJob')).signupJob;
    assertRevision(revision);
    track(job);
    if (isActive(job) && Date.now() >= job.expiresAt) return halt('signup expired after 30 minutes. your account email is saved on this device.');
    return job;
  }
  function publicState(job) {
    return { phase: job?.phase || 'ready', active: isActive(job), message: job?.message || 'choose your platform and account details to start.', platform: job?.platform, email: job?.email, username: job?.username, tabId: job?.tabId, nextPollMs: job?.waitingForCode ? 5000 : 1500 };
  }
  async function state() {
    const job = await read();
    if (job) return publicState(job);
    const local = await chrome.storage.local.get(['nativeSignupRecovery', 'nativeSignupAccounts']);
    const saved = local.nativeSignupRecovery?.email ? local.nativeSignupRecovery : Array.isArray(local.nativeSignupAccounts) ? local.nativeSignupAccounts.at(-1) : null;
    return saved?.email ? publicState({ ...saved, phase: saved.phase === 'complete' ? 'complete' : 'recovery', message: saved.phase === 'complete' ? 'your account email and username are saved on this device.' : 'your previous account email is saved. check that account before starting another signup.' }) : publicState(null);
  }
  async function installCapability(revision) {
    // Content scripts must never gain access to the install capability.
    await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
    assertRevision(revision);
    const stored = (await chrome.storage.local.get('nativeSignupInstall')).nativeSignupInstall;
    assertRevision(revision);
    if (typeof stored === 'string' && /^[a-f0-9]{64}$/.test(stored)) return stored;
    const capability = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
    await chrome.storage.local.set({ nativeSignupInstall: capability });
    assertRevision(revision);
    return capability;
  }
  async function api(body, revision) {
    const capability = await installCapability(revision);
    assertRevision(revision);
    const abort = new AbortController();
    requests.add(abort);
    const timer = setTimeout(() => abort.abort(), 12000);
    try {
      const response = await fetch(ENDPOINT, { method: 'POST', credentials: 'omit', cache: 'no-store', redirect: 'error', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${capability}` }, body: JSON.stringify(body), signal: abort.signal });
      assertRevision(revision);
      const data = await response.json();
      assertRevision(revision);
      if (!response.ok || data?.ok !== true) throw new Error(response.status === 429 ? 'too many signup requests. wait a little before continuing.' : response.status === 404 ? 'account signup is not available yet. its email update needs to be released first.' : 'the account email service could not complete this step. try continuing shortly.');
      return data;
    } catch (error) {
      assertRevision(revision);
      if (error?.name === 'AbortError' || error instanceof TypeError) throw new Error('the account email service did not respond. try continuing shortly.');
      throw error;
    } finally { clearTimeout(timer); requests.delete(abort); }
  }
  function safeAlias(alias, platform) {
    if (!alias || typeof alias.id !== 'string' || !/^[\w-]{1,100}$/.test(alias.id) || typeof alias.email !== 'string' || alias.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(alias.email) || alias.platform !== platform) throw new Error('the account email service returned an incomplete address. try again.');
    return { id: alias.id, email: alias.email, accountUsername: alias.accountUsername || null };
  }
  async function patch(job, changes, revision) { return save({ ...job, ...changes }, revision); }
  async function pause(job, message, revision) { return patch(job, { phase: 'paused', waitingForCode: false, message }, revision); }
  function runnerSender(sender, job, token) {
    return Boolean(job && sender.id === chrome.runtime.id && sender.tab?.id === job.runnerTabId && (sender.frameId === undefined || sender.frameId === 0) && sender.url === chrome.runtime.getURL(`signup-runner.html#${job.token}`) && token === job.token);
  }
  async function inject(job, input, revision, browserDocument) {
    const tab = await chrome.tabs.get(job.tabId);
    assertRevision(revision);
    if (!platformURL(tab.url, job.platform) || tab.incognito) throw new Error('the signup tab changed. stop and open signup again.');
    if (tab.pendingUrl || tab.status !== 'complete') return null;
    const result = await chrome.scripting.executeScript({ target: { tabId: job.tabId, ...(browserDocument ? { documentIds: [browserDocument] } : {}) }, func: signupStep, args: [{ platform: job.platform, email: job.email, username: job.username, fullName: job.username, actionToken: job.token, ...input }] });
    assertRevision(revision);
    return result[0] ? { ...result[0].result, browserDocument: result[0].documentId } : null;
  }
  const validObservation = observation => observation && ['details', 'email-code', 'birthday', 'phone', 'captcha', 'username-unavailable', 'signed-in', 'complete', 'unknown', 'loading'].includes(observation.stage) && typeof observation.documentId === 'string' && observation.documentId.length > 0 && observation.documentId.length < 150;
  async function advance(job, revision) {
    if (job.phase === 'paused') return publicState(job);
    if (!isActive(job)) return publicState(job);
    try {
      const observed = await inject(job, { mode: 'observe' }, revision);
      if (!observed) return publicState(job);
      if (!validObservation(observed)) return publicState(await pause(job, 'the signup page could not be identified. finish this step in its tab.', revision));
      if (observed.stage === 'complete') {
        if (!job.detailsSubmitted || typeof observed.username !== 'string' || observed.username.toLowerCase() !== job.username.toLowerCase()) return publicState(await pause(job, 'check the account signed in to this tab before continuing.', revision));
        job = await patch(job, { password: '', message: 'account confirmed. saving your account email…' }, revision);
        const alias = safeAlias((await api({ action: 'complete', requestId: job.requestId, platform: job.platform, username: job.username }, revision)).alias, job.platform);
        if (alias.id !== job.aliasId || alias.email.toLowerCase() !== job.email.toLowerCase() || typeof alias.accountUsername !== 'string' || alias.accountUsername.toLowerCase() !== job.username.toLowerCase()) throw new Error('your account opened, but its email details could not be saved. try continuing.');
        return publicState(await patch(job, { phase: 'complete', pendingAction: null, waitingForCode: false, message: 'your account is ready. its email and username are saved on this device.' }, revision));
      }
      if (['birthday', 'phone', 'captcha', 'username-unavailable', 'signed-in'].includes(observed.stage)) return publicState(await pause(job, observed.message || 'finish this check in the signup tab, then continue here.', revision));
      if (['details', 'email-code'].includes(observed.stage) && observed.canSubmit && (typeof observed.signature !== 'string' || !observed.signature || observed.signature.length >= 1000)) return publicState(await pause(job, 'this signup action could not be identified. finish the step in its tab.', revision));
      const previous = job.attempts.find(attempt => attempt.signature === observed.signature);
      if (previous) {
        if (Date.now() - previous.at < 25000 && job.phase !== 'paused') return publicState(job);
        return publicState(await pause(job, 'this step may already have been submitted. check the signup tab; it will not be submitted twice.', revision));
      }
      if (!['details', 'email-code'].includes(observed.stage) || !observed.canSubmit) {
        if (job.pendingAction && Date.now() - job.pendingAction.at < 25000) return publicState(job);
        if (observed.stage === 'loading' && Date.now() - job.startedAt < 25000) return publicState(job);
        return publicState(await pause(job, observed.message || 'finish this step in the signup tab, then continue here.', revision));
      }
      let code;
      let codeId;
      if (observed.stage === 'email-code') {
        if (!job.detailsSubmitted) return publicState(await pause(job, 'this email check was opened before signup started. check the account in that tab.', revision));
        if (Date.now() < (job.nextCodeAt || 0)) return publicState(job);
        job = await patch(job, { nextCodeAt: Date.now() + 5000, waitingForCode: true, message: 'waiting for your signup email code…' }, revision);
        const verification = (await api({ action: 'code', requestId: job.requestId, platform: job.platform, since: job.since, ...(job.usedCodeIds.length ? { excludeId: job.usedCodeIds.at(-1) } : {}) }, revision)).verification;
        if (verification === null) return publicState(job);
        const received = Date.parse(verification?.receivedAt);
        if (!verification || typeof verification.id !== 'string' || verification.id.length > 100 || job.usedCodeIds.includes(verification.id) || !/^\d{6}$/.test(verification.code) || !Number.isFinite(received) || received <= Date.parse(job.since) || received < Date.now() - 10 * 60000 || received > Date.now()) return publicState(await pause(job, 'a fresh signup code is not available. check the email step before continuing.', revision));
        code = verification.code; codeId = verification.id;
      }
      if (job.attempts.length >= 30) return publicState(await pause(job, 'signup needs a manual check. finish in the platform tab.', revision));
      const attempt = { signature: observed.signature, documentId: observed.documentId, stage: observed.stage, at: Date.now() };
      // Persist intent and code consumption before the click, including when the
      // page navigates or the extension disappears before its result returns.
      job = await patch(job, { phase: 'running', pendingAction: attempt, attempts: [...job.attempts, attempt], usedCodeIds: codeId ? [...job.usedCodeIds, codeId].slice(-50) : job.usedCodeIds, waitingForCode: false, message: 'continuing account signup…' }, revision);
      const outcome = await inject(job, { mode: 'act', expectedSignature: observed.signature, expectedDocument: observed.documentId, ...(observed.stage === 'details' ? { password: job.password } : { code }) }, revision, observed.browserDocument);
      if (!outcome?.submitted || outcome.signature !== observed.signature || outcome.documentId !== observed.documentId) return publicState(await pause(job, outcome?.message || 'the signup step changed. check its tab before continuing.', revision));
      job = await patch(job, { detailsSubmitted: job.detailsSubmitted || observed.stage === 'details', message: 'signup step sent. waiting for the next screen…' }, revision);
      return publicState(job);
    } catch (error) {
      assertRevision(revision);
      return publicState(await pause(job, error?.message || 'signup needs your attention. check its tab.', revision));
    }
  }
  async function command(message, scheduledRevision = cancellationRevision) {
    if (message.type === 'signup-stop') return publicState(await halt());
    const revision = scheduledRevision;
    assertRevision(revision);
    if (message.type === 'signup-state') return state();
    if (message.type === 'signup-start') {
      const previous = await read(revision);
      if (isActive(previous)) throw new Error('finish or stop the current signup first.');
      const warmup = await getJob(); assertRevision(revision);
      if (warmup && ['starting', 'running', 'stopping'].includes(warmup.phase)) throw new Error('stop the warm-up session before creating an account.');
      const chosenUsername = username(message.username, message.platform);
      if (typeof message.password !== 'string' || message.password.length < 8 || message.password.length > 64) throw new Error('use a password between 8 and 64 characters.');
      const local = await chrome.storage.local.get(['nativeSignupAccounts', 'nativeSignupPending']);
      assertRevision(revision);
      if (Array.isArray(local.nativeSignupAccounts) && local.nativeSignupAccounts.length >= MAX_SAVED_ACCOUNTS) throw new Error('this device has reached its saved account limit. keep your existing account emails before starting more.');
      const pending = previous?.phase === 'error' && !previous.email ? previous : local.nativeSignupPending;
      const retryRequest = pending?.phase === 'error' && !pending.email && pending.platform === message.platform && pending.username === chosenUsername && /^[a-f0-9-]{36}$/i.test(pending.requestId || '') ? pending.requestId : null;
      let job = { token: crypto.randomUUID(), requestId: retryRequest || crypto.randomUUID(), platform: message.platform, username: chosenUsername, password: message.password, phase: 'starting', message: 'creating your account email…', since: new Date().toISOString(), startedAt: Date.now(), expiresAt: Date.now() + 30 * 60000, tabId: null, runnerTabId: null, runnerStarted: false, attempts: [], usedCodeIds: [], detailsSubmitted: false, pendingAction: null };
      await save(job, revision);
      try {
        const alias = safeAlias((await api({ action: 'prepare', requestId: job.requestId, platform: job.platform }, revision)).alias, job.platform);
        if (alias.accountUsername) throw new Error('this email already has an account. check it before starting again.');
        job = await patch(job, { email: alias.email, aliasId: alias.id, message: 'opening account signup…' }, revision);
        const tab = await chrome.tabs.create({ url: job.platform === 'instagram' ? 'https://www.instagram.com/accounts/emailsignup/' : 'https://www.tiktok.com/signup/phone-or-email/email', active: true });
        assertRevision(revision);
        job = await patch(job, { tabId: tab.id }, revision);
        const runner = await chrome.tabs.create({ url: chrome.runtime.getURL(`signup-runner.html#${job.token}`), active: false, windowId: tab.windowId });
        assertRevision(revision);
        job = await patch(job, { runnerTabId: runner.id, phase: 'running', message: 'starting account signup…' }, revision);
        return publicState(job);
      } catch (error) {
        assertRevision(revision);
        await patch(job, { password: '', phase: 'error', message: error.message || 'could not start signup. try again.' }, revision);
        throw error;
      }
    }
    const job = await read(revision);
    assertRevision(revision);
    if (!isActive(job)) throw new Error('start an account signup first.');
    if (message.type === 'signup-show') { await chrome.tabs.update(job.tabId, { active: true }); assertRevision(revision); return publicState(job); }
    if (message.type === 'signup-continue') return publicState(await patch(job, { phase: 'running', message: 'checking the signup tab…', waitingForCode: false }, revision));
    throw new Error('unknown signup action.');
  }
  async function runnerCommand(message, sender, scheduledRevision = cancellationRevision) {
    if (message.type === 'signup-runner-stop' && runnerSender(sender, activeTabs, message.token)) return publicState(await halt());
    const revision = scheduledRevision;
    assertRevision(revision);
    const job = await read(revision);
    assertRevision(revision);
    if (!runnerSender(sender, job, message.token)) throw new Error('this signup session is no longer active.');
    if (message.type === 'signup-runner-stop') return publicState(await halt());
    if (message.type === 'signup-runner-show') { await chrome.tabs.update(job.tabId, { active: true }); assertRevision(revision); return publicState(job); }
    if (message.type === 'signup-runner-state') return publicState(job);
    if (message.type === 'signup-runner-ready') {
      if (!isActive(job)) return publicState(job);
      if (job.runnerStarted) return publicState(await halt('signup stopped after its runner refreshed. check the platform before starting again.'));
      return publicState(await patch(job, { runnerStarted: true }, revision));
    }
    if (message.type === 'signup-runner-tick') {
      if (!job.runnerStarted) throw new Error('signup runner is still starting.');
      return advance(job, revision);
    }
    throw new Error('unknown signup runner action.');
  }
  async function tabRemoved(tabId) {
    if (activeTabs && [activeTabs.tabId, activeTabs.runnerTabId].includes(tabId)) return halt('signup stopped because a signup tab closed. your account email is saved.');
    const revision = cancellationRevision;
    const job = await read(revision);
    assertRevision(revision);
    if (isActive(job) && [job.tabId, job.runnerTabId].includes(tabId)) return halt('signup stopped because a signup tab closed. your account email is saved.');
  }
  async function tabUpdated(tabId, change) {
    const invalid = tabs => tabs && ((change.discarded && [tabs.tabId, tabs.runnerTabId].includes(tabId)) || (change.url && ((tabId === tabs.tabId && !platformURL(change.url, tabs.platform)) || (tabId === tabs.runnerTabId && change.url !== chrome.runtime.getURL(`signup-runner.html#${tabs.token}`)))));
    if (invalid(activeTabs)) return halt('signup stopped because a signup tab changed or unloaded. your account email is saved.');
    const revision = cancellationRevision;
    const job = await read(revision);
    assertRevision(revision);
    if (isActive(job) && invalid(job)) return halt('signup stopped because a signup tab changed or unloaded. your account email is saved.');
  }
  return { command, runnerCommand, read, isActive, publicState, platformURL, username, tabRemoved, tabUpdated, revision: () => cancellationRevision };
})();
