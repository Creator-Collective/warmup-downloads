'use strict';
const signupController = (() => {
  const DASHBOARD = 'https://trycreatorcollective.com/dashboard/account-emails';
  const activePhases = ['starting', 'paused', 'filled'];
  let cancellationRevision = 0;
  let activeTabs = null;
  const assertRevision = revision => { if (revision !== cancellationRevision) throw new Error('signup stopped. fields already sent may still appear in the platform tab.'); };
  const platforms = ['instagram', 'tiktok'];
  function dashboardURL(value) {
    try { const u = new URL(value); return u.protocol === 'https:' && !u.port && !u.username && !u.password && ['trycreatorcollective.com', 'www.trycreatorcollective.com'].includes(u.hostname) && /^\/dashboard(?:\/|$)/.test(u.pathname); } catch { return false; }
  }
  function platformURL(value, platform) {
    try { const u = new URL(value); return platforms.includes(platform) && u.protocol === 'https:' && !u.port && !u.username && !u.password && [`www.${platform}.com`, `${platform}.com`].includes(u.hostname); } catch { return false; }
  }
  function username(value, platform) {
    const clean = typeof value === 'string' ? value.trim().replace(/^@/, '') : '';
    const valid = platform === 'instagram' ? /^[a-zA-Z0-9._]{1,30}$/.test(clean) : platform === 'tiktok' && /^[a-zA-Z0-9._]{2,24}$/.test(clean) && !clean.endsWith('.');
    if (!valid) throw new Error('enter a valid username for the selected platform.');
    return clean;
  }
  const trackTabs = job => { activeTabs = job && activePhases.includes(job.phase) ? { tabId: job.tabId, dashboardTabId: job.dashboardTabId, platform: job.platform } : null; };
  const save = job => { trackTabs(job); return chrome.storage.session.set({ signupJob: job }); };
  const isActive = job => Boolean(job && activePhases.includes(job.phase));
  async function read() {
    const job = (await chrome.storage.session.get('signupJob')).signupJob;
    trackTabs(job);
    if (isActive(job) && Date.now() >= job.expiresAt) {
      const expired = { ...job, password: '', phase: 'stopped', message: 'signup paused for 30 minutes. start again to reconnect your email.' };
      await save(expired); return expired;
    }
    return job;
  }
  function publicState(job) {
    return { phase: job?.phase || 'ready', active: isActive(job), message: job?.message || 'connect your student dashboard to create an account.', platform: job?.platform, email: job?.email, username: job?.username, tabId: job?.tabId };
  }
  function safeAlias(alias) {
    if (!alias || typeof alias.id !== 'string' || typeof alias.email !== 'string') throw new Error('the dashboard returned an incomplete email. reconnect and try again.');
    return { id: alias.id, email: alias.email, platform: alias.platform || null, accountUsername: alias.accountUsername || null };
  }
  // Fetch only this fixed API from a validated student dashboard tab. The
  // extension never receives the dashboard's cookies or Supabase access token.
  async function api(tabId, body, expectedProfileId, revision = cancellationRevision) {
    const tab = await chrome.tabs.get(tabId);
    assertRevision(revision);
    if (!dashboardURL(tab.url) || tab.incognito) throw new Error('open your signed-in student dashboard in a regular chrome tab, then reconnect.');
    const result = await chrome.scripting.executeScript({ target: { tabId }, func: async (body, expectedOrigin) => {
      if (window !== window.top || location.origin !== expectedOrigin || !/^\/dashboard(?:\/|$)/.test(location.pathname)) return { ok: false, error: 'the dashboard tab changed. reconnect it.' };
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), 12000);
      try {
        const response = await fetch('/api/account-setup', { method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error', ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}), signal: abort.signal });
        if (response.status === 404 && !body) return { ok: false, error: 'the dashboard signup connection is not available yet. its update needs to be released first.' };
        if (response.status === 401) return { ok: false, error: 'sign in to your student dashboard, then reconnect.' };
        const data = await response.json();
        return response.ok && data?.ok ? data : { ok: false, error: typeof data?.error === 'string' ? data.error : 'the dashboard could not complete this request.' };
      } catch { return { ok: false, error: 'the student dashboard did not respond. check that tab and try again.' }; }
      finally { clearTimeout(timer); }
    }, args: [body ? { ...body, expectedProfileId } : null, new URL(tab.url).origin] });
    assertRevision(revision);
    const data = result[0]?.result;
    if (!data?.ok) throw new Error(data?.error || 'the dashboard tab did not respond. reconnect it.');
    return data;
  }
  async function connection(revision = cancellationRevision) {
    const saved = (await chrome.storage.session.get('signupConnection')).signupConnection;
    assertRevision(revision);
    if (!saved) throw new Error('connect your student dashboard first.');
    const data = await api(saved.tabId, null, null, revision);
    if (data.profile?.id !== saved.profileId) {
      await chrome.storage.session.remove('signupConnection');
      const job = await read();
      if (isActive(job)) await save({ ...job, password: '', phase: 'stopped', message: 'the dashboard account changed. reconnect before starting again.' });
      throw new Error('the dashboard account changed. reconnect before starting again.');
    }
    return { ...saved, data };
  }
  async function current() {
    const job = await read();
    if (!isActive(job)) throw new Error('start an account signup first.');
    return job;
  }
  async function fill(job, mode = 'details', code, revision = cancellationRevision) {
    const tab = await chrome.tabs.get(job.tabId);
    assertRevision(revision);
    if (!platformURL(tab.url, job.platform) || tab.pendingUrl || tab.status !== 'complete') {
      const next = { ...job, phase: 'paused', message: 'wait for the signup page to finish loading, then continue.' }; await save(next); return publicState(next);
    }
    const result = await chrome.scripting.executeScript({ target: { tabId: job.tabId }, func: fillSignupFields, args: [{ mode, platform: job.platform, email: job.email, username: job.username, fullName: job.fullName, ...(mode === 'details' ? { password: job.password } : {}), ...(code ? { code } : {}) }] });
    assertRevision(revision);
    const outcome = result[0]?.result;
    const next = { ...job, phase: outcome?.phase === 'filled' ? 'filled' : 'paused', message: outcome?.message || 'the signup form did not respond. continue manually in its tab.' };
    await save(next);
    return publicState(next);
  }
  async function command(message) {
    const revision = cancellationRevision;
    if (message.type === 'signup-state') return publicState(await read());
    if (message.type === 'signup-dashboard-tabs') {
      const tabs = await chrome.tabs.query({ url: ['https://trycreatorcollective.com/dashboard*', 'https://www.trycreatorcollective.com/dashboard*'] });
      return tabs.filter(tab => dashboardURL(tab.url) && !tab.incognito).map(tab => ({ id: tab.id, title: tab.title || 'student dashboard' }));
    }
    if (message.type === 'signup-open-dashboard') return { tabId: (await chrome.tabs.create({ url: DASHBOARD })).id };
    if (message.type === 'signup-connect') {
      if (isActive(await read())) throw new Error('stop the current signup before changing dashboards.');
      if (!Number.isInteger(message.dashboardTabId)) throw new Error('choose a student dashboard tab.');
      const data = await api(message.dashboardTabId, null, null, revision);
      if (typeof data.profile?.id !== 'string' || !Array.isArray(data.aliases)) throw new Error('the dashboard connection is incomplete. refresh it and try again.');
      await chrome.storage.session.set({ signupConnection: { tabId: message.dashboardTabId, profileId: data.profile.id } });
      return { profile: { id: data.profile.id, fullName: data.profile.fullName }, aliases: data.aliases.map(safeAlias) };
    }
    if (message.type === 'signup-stop') {
      cancellationRevision++;
      const job = await read();
      if (job) await save({ ...job, password: '', phase: 'stopped', message: 'signup stopped. any fields already filled remain in the platform tab.' });
      return publicState(await read());
    }
    if (message.type === 'signup-generate') {
      if (isActive(await read())) throw new Error('stop the current signup before generating another email.');
      if (!platforms.includes(message.platform)) throw new Error('choose instagram or tiktok.');
      const linked = await connection(revision);
      return safeAlias((await api(linked.tabId, { action: 'generate', platform: message.platform }, linked.profileId, revision)).alias);
    }
    if (message.type === 'signup-start') {
      if (isActive(await read())) throw new Error('finish or stop the current signup first.');
      const warmup = await getJob();
      if (warmup && ['starting', 'running', 'stopping'].includes(warmup.phase)) throw new Error('stop the warm-up session before creating an account.');
      const chosenUsername = username(message.username, message.platform);
      if (typeof message.password !== 'string' || message.password.length < 8 || message.password.length > 64) throw new Error('use a password between 8 and 64 characters.');
      if (typeof message.fullName !== 'string' || !message.fullName.trim() || message.fullName.trim().length > 100) throw new Error('enter the name for this account.');
      const linked = await connection(revision);
      const alias = linked.data.aliases.map(safeAlias).find(alias => alias.id === message.aliasId);
      if (!alias) throw new Error('that email is no longer available. reconnect your dashboard.');
      if (alias.accountUsername || (alias.platform && alias.platform !== message.platform)) throw new Error('choose an unused email for this platform.');
      const job = { token: crypto.randomUUID(), dashboardTabId: linked.tabId, profileId: linked.profileId, aliasId: alias.id, email: alias.email, platform: message.platform, username: chosenUsername, fullName: message.fullName.trim(), password: message.password, phase: 'starting', message: 'opening signup…', since: new Date().toISOString(), expiresAt: Date.now() + 30 * 60000, tabId: null, usedCodeIds: [] };
      assertRevision(revision);
      await save(job);
      try {
        assertRevision(revision);
        const tab = await chrome.tabs.create({ url: message.platform === 'instagram' ? 'https://www.instagram.com/accounts/emailsignup/' : 'https://www.tiktok.com/signup/phone-or-email/email', active: true });
        assertRevision(revision);
        const next = { ...job, tabId: tab.id, message: 'signup is opening. available fields will fill once it loads; you review and submit them.' }; await save(next);
        return publicState(next);
      } catch {
        assertRevision(revision);
        await save({ ...job, password: '', phase: 'error', message: 'could not open signup. start again.' });
        throw new Error('could not open signup. start again.');
      }
    }
    const job = await current();
    if (message.type === 'signup-show') { await chrome.tabs.update(job.tabId, { active: true }); return publicState(job); }
    if (message.type === 'signup-continue' || message.type === 'signup-code' || message.type === 'signup-complete') {
      const linked = await connection(revision);
      if (linked.profileId !== job.profileId || linked.tabId !== job.dashboardTabId) throw new Error('the connected dashboard changed. stop and reconnect.');
      if (message.type === 'signup-continue') return fill(job, 'details', undefined, revision);
      if (message.type === 'signup-code') {
        const tab = await chrome.tabs.get(job.tabId);
        assertRevision(revision);
        if (!platformURL(tab.url, job.platform) || tab.pendingUrl || tab.status !== 'complete') throw new Error('open the email verification step in your signup tab first.');
        const inspection = await chrome.scripting.executeScript({ target: { tabId: job.tabId }, func: fillSignupFields, args: [{ platform: job.platform, email: job.email, mode: 'inspect-code' }] });
        assertRevision(revision);
        if (!inspection[0]?.result?.codeReady) throw new Error(inspection[0]?.result?.message || 'open the email verification step first.');
        const data = await api(job.dashboardTabId, { action: 'code', aliasId: job.aliasId, platform: job.platform, since: job.since, ...(job.usedCodeIds.length ? { excludeId: job.usedCodeIds.at(-1) } : {}) }, job.profileId, revision);
        const verification = data.verification;
        const received = Date.parse(verification?.receivedAt);
        if (!verification || !Number.isFinite(received) || typeof verification.id !== 'string' || job.usedCodeIds.includes(verification.id) || !/^\d{6}$/.test(verification.code) || received <= Date.parse(job.since) || received < Date.now() - 10 * 60000 || received > Date.now()) throw new Error('no fresh email code yet. request one in the signup tab, then try again.');
        // Record consumption before injection so an uncertain response cannot
        // silently replay the same verification on the next click.
        const next = { ...job, usedCodeIds: [...job.usedCodeIds, verification.id].slice(-50) };
        await save(next);
        return fill(next, 'code', verification.code, revision);
      }
      const actualUsername = username(message.username, job.platform);
      await api(job.dashboardTabId, { action: 'complete', aliasId: job.aliasId, platform: job.platform, username: actualUsername }, job.profileId, revision);
      const next = { ...job, password: '', username: actualUsername, phase: 'complete', message: 'your confirmed username is saved with this account email. instagram accounts can now be selected for warm-up.' };
      await save(next); return publicState(next);
    }
    throw new Error('unknown signup action.');
  }
  async function tabRemoved(tabId) {
    const interrupted = activeTabs && [activeTabs.tabId, activeTabs.dashboardTabId].includes(tabId);
    if (interrupted) cancellationRevision++;
    const job = await read();
    if (isActive(job) && [job.tabId, job.dashboardTabId].includes(tabId)) { if (!interrupted) cancellationRevision++; await save({ ...job, password: '', phase: 'stopped', message: 'signup stopped because its platform or dashboard tab closed. fields already filled remain in the platform.' }); }
  }
  async function tabUpdated(tabId, change) {
    const revision = cancellationRevision;
    const invalid = tabs => tabs && ((change.discarded && [tabs.tabId, tabs.dashboardTabId].includes(tabId)) || (change.url && ((tabId === tabs.tabId && !platformURL(change.url, tabs.platform)) || (tabId === tabs.dashboardTabId && !dashboardURL(change.url)))));
    const interrupted = invalid(activeTabs);
    if (interrupted) cancellationRevision++;
    const job = await read();
    if (!isActive(job)) return;
    if (invalid(job)) { if (!interrupted) cancellationRevision++; await save({ ...job, password: '', phase: 'stopped', message: 'signup stopped because a connected tab changed or unloaded. reconnect to continue.' }); }
    else if (tabId === job.tabId && change.status === 'complete' && job.phase === 'starting') { assertRevision(revision); await fill(job, 'details', undefined, revision); }
  }
  return { command, read, isActive, publicState, dashboardURL, platformURL, username, tabRemoved, tabUpdated };
})();
