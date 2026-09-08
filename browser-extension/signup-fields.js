'use strict';

// Serialized into Chrome's isolated top-frame world. The page cannot supply
// executable code, credentials, selectors, or destinations to this function.
async function signupStep(input) {
  const stop = (stage, message) => ({ stage, message, canSubmit: false, submitted: false });
  const url = new URL(location.href);
  if (window !== window.top || !['instagram', 'tiktok'].includes(input.platform) || url.protocol !== 'https:' || url.port || url.username || url.password || ![input.platform + '.com', 'www.' + input.platform + '.com'].includes(url.hostname)) return stop('unknown', 'the signup tab changed. stop and start again.');
  if (!globalThis.__ccNativeSignupCancelled) globalThis.__ccNativeSignupCancelled = new Set();
  const cancelled = () => globalThis.__ccNativeSignupCancelled.has(input.actionToken);
  if (cancelled()) return stop('unknown', 'signup stopped.');
  if (!globalThis.__ccNativeSignupDocument) globalThis.__ccNativeSignupDocument = { id: crypto.randomUUID(), submitted: new Set() };
  const state = globalThis.__ccNativeSignupDocument;
  const visible = element => {
    const box = element.getBoundingClientRect(), css = getComputedStyle(element);
    return element.isConnected && box.width > 0 && box.height > 0 && css.visibility !== 'hidden' && css.display !== 'none' && css.opacity !== '0';
  };
  const all = selector => [...document.querySelectorAll(selector)].filter(visible);
  const label = element => (element.innerText || element.value || element.getAttribute('aria-label') || '').trim().toLowerCase();
  const text = () => (document.body?.innerText || '').slice(0, 30000).toLowerCase();
  const blockers = () => {
    const body = text();
    if (all('iframe').some(frame => /captcha|recaptcha|hcaptcha|arkose|challenge/i.test(`${frame.src || ''} ${frame.title || ''}`)) || /verify (?:that )?you(?:'re| are) (?:a )?human|security check|complete (?:the |this )?captcha|unusual activity|suspicious activity/.test(body)) return stop('captcha', 'finish the security check in the signup tab, then continue here.');
    if (/phone verification|verify your phone|(?:code|sent|send).{0,70}(?:your phone|phone number|mobile number|sms|text message)/.test(body)) return stop('phone', 'finish the phone check in the signup tab, then continue here.');
    const birthdays = all('input, select').filter(field => field.type === 'date' || /birth|birthday|dob|^(month|day|year)$/i.test(field.name || '') || /birth|birthday|dob/i.test(`${field.id || ''} ${field.getAttribute('aria-label') || ''}`));
    if (birthdays.length || /when(?:'s| is) your birthday|what(?:'s| is) your (?:birthday|date of birth)|enter your (?:birthday|date of birth)|add your birthday/.test(body)) return stop('birthday', 'enter your birthday and finish that step in the signup tab, then continue here.');
    if (/username.{0,55}(?:isn.t available|is not available|is unavailable|is already taken|is taken|already exists)|(?:this|that) username.{0,30}(?:taken|unavailable)|try another username/.test(body)) return stop('username-unavailable', 'that username is unavailable. stop and try another username.');
    if (all('[role="alert"], [aria-live="assertive"]').map(label).some(value => /error|incorrect|invalid|try again|couldn.t|can.t|not allowed|too many|must be|at least/.test(value))) return stop('unknown', 'the platform needs a correction. check its message, fix that step, then continue here.');
    return null;
  };
  const signupPath = input.platform === 'instagram' ? /^\/accounts\/(emailsignup|signup|confirm_email)(\/|$)/ : /^\/signup(\/|$)/;
  const inspect = () => {
    const blocked = blockers();
    if (blocked) return blocked;
    if (!signupPath.test(url.pathname)) {
      // Neither a public profile nor a home redirect proves account ownership.
      const links = all('a[href]');
      const ownPath = input.platform === 'instagram' ? `/${input.username}` : `/@${input.username}`;
      const path = link => { try { const u = new URL(link.href, url); return u.origin === url.origin ? u.pathname.replace(/\/$/, '').toLowerCase() : ''; } catch { return ''; } };
      const own = links.filter(link => (label(link) === 'profile' || link.getAttribute('data-e2e') === 'nav-profile') && path(link) === ownPath.toLowerCase());
      const privateLink = links.some(link => input.platform === 'instagram' ? /^\/(direct\/inbox|accounts\/edit)(\/|$)/.test(path(link)) : /^\/(settings|setting)(\/|$)/.test(path(link)));
      const login = all('button, a[href]').some(element => /^(log in|login|sign in)$/.test(label(element)));
      if (own.length === 1 && privateLink && !login) return { stage: 'complete', username: input.username, canSubmit: false, message: 'your new account is signed in.' };
      return stop('signed-in', 'instagram is already signed in here. continue opens a private signup window with this email, so your current login stays untouched.');
    }
    const fields = all('input').filter(field => !field.disabled && !field.readOnly && !['hidden', 'submit', 'button', 'checkbox', 'radio'].includes(field.type));
    const patterns = {
      email: /^(email|emailorphone|email_or_phone|email_address)$/i,
      username: /^(username|user_name|uniqueid|unique_id)$/i,
      fullName: /^(fullname|full_name|name)$/i,
      password: /^(password|new_password|newpassword)$/i,
      code: /^(code|verification_code|verificationcode|confirmation_code|confirmationcode|email_confirmation_code|verifycode)$/i,
    };
    const matches = key => fields.filter(field => {
      const name = field.name || field.id || '';
      const accessibleName = `${field.getAttribute('aria-label') || ''} ${field.placeholder || ''}`.trim();
      if (patterns[key].test(name)) return true;
      if (key === 'email') return field.type === 'email' || field.autocomplete === 'email' || /^(mobile number or email|email address|email)$/i.test(accessibleName);
      if (key === 'password') return field.type === 'password' && field.autocomplete !== 'current-password';
      if (key === 'username') return field.autocomplete === 'username' || /^username$/i.test(accessibleName);
      if (key === 'fullName') return field.autocomplete === 'name' || /^full name$/i.test(accessibleName);
      return field.autocomplete === 'one-time-code' || /^(confirmation code|verification code|enter (?:a )?6[- ]digit code|6[- ]digit code)$/i.test(accessibleName);
    });
    if (fields.some(field => field.type === 'tel' && /phone|mobile/i.test(`${field.name} ${field.placeholder}`)) && !matches('email').length) return stop('phone', 'choose email signup in the platform tab, then continue here.');
    const recognized = Object.fromEntries(Object.keys(patterns).map(key => [key, matches(key)]));
    if (Object.values(recognized).some(found => found.length > 1)) return stop('unknown', 'the signup fields are unclear. finish this step in the platform tab.');
    const buttons = all('button, input[type="submit"], [role="button"]');
    const send = buttons.filter(button => /^(send code|send verification code)$/.test(label(button)));
    const body = text();
    const codeSent = /(?:we(?:.ve| have)? sent|code (?:was |has been )?sent|check your (?:email|inbox)|enter (?:the |your )?(?:confirmation|verification|6.digit) code|resend code|resend in|send again in)/.test(body);
    const codeStep = recognized.code.length === 1 && !(input.platform === 'tiktok' && send.length === 1 && !codeSent);
    if (codeStep) {
      const emails = body.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?/g) || [];
      const recipient = typeof input.email === 'string' && (emails.includes(input.email.toLowerCase()) || recognized.email.some(field => field.value.toLowerCase() === input.email.toLowerCase()));
      if (!recipient || !/(?:email|e-mail|inbox)/.test(body)) return stop('unknown', 'the verification step does not show your signup email. check the recipient and complete that step yourself.');
      if (recognized.code[0].value && recognized.code[0].value !== input.code && state.submittedCodeField !== recognized.code[0]) return stop('unknown', 'a code is already entered. finish that step in the platform tab, then continue here.');
    }
    const stage = codeStep ? 'email-code' : 'details';
    const keys = codeStep ? ['code'] : ['email', 'fullName', 'username', 'password'];
    const targets = keys.flatMap(key => recognized[key].map(element => ({ key, element })));
    if (!targets.length || new Set(targets.map(target => target.element)).size !== targets.length) return stop('unknown', 'open email signup in this tab, then continue here.');
    const normal = codeStep ? /^(next|continue|confirm|confirm email|verify|verify email|sign up|signup)$/ : /^(sign up|signup|next|continue)$/;
    const candidates = input.platform === 'tiktok' && !codeStep && send.length === 1 ? send : buttons.filter(button => normal.test(label(button)));
    if (candidates.length !== 1) return stop('unknown', 'the next signup button is unclear. finish that step in the platform tab.');
    const button = candidates[0];
    const form = button.form || targets[0].element.form;
    if (form?.action) { try { if (new URL(form.action, url).origin !== url.origin) return stop('unknown', 'the signup form changed. review it in the platform tab.'); } catch { return stop('unknown', 'the signup form changed. review it in the platform tab.'); } }
    if (targets.some(({ element }) => element.form && form && element.form !== form)) return stop('unknown', 'the signup fields belong to different forms. finish this step yourself.');
    const signature = JSON.stringify([url.pathname, stage, targets.map(({ key, element }) => [key, element.name || element.id || element.type]), label(button)]);
    return { stage, signature, canSubmit: true, message: codeStep ? 'waiting for the email code…' : 'entering your signup details…', targets, button };
  };
  const view = inspect();
  const publicView = value => { const { targets, button, ...result } = value; return { ...result, documentId: state.id }; };
  if (input.mode !== 'act') return publicView(view);
  if (!view.canSubmit || input.expectedDocument !== state.id || input.expectedSignature !== view.signature || state.submitted.has(view.signature)) return { ...publicView(view), submitted: false, message: 'the signup step changed or was already sent. check the platform tab.' };
  if (view.stage === 'email-code' && !/^\d{6}$/.test(input.code || '')) return { ...publicView(view), submitted: false, message: 'waiting for a fresh email code.' };
  const values = { email: input.email, username: input.username, fullName: input.fullName || input.username, password: input.password, code: input.code };
  for (const { key, element } of view.targets) {
    const value = values[key];
    if (typeof value !== 'string' || !value || (element.value && element.value !== value)) return { ...publicView(view), submitted: false, message: 'a signup field has different details. review that step in the platform tab.' };
  }
  for (const { key, element } of view.targets) {
    if (!visible(element) || element.disabled || element.readOnly) return { ...publicView(view), submitted: false, message: 'the signup form changed. check the platform tab.' };
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, values[key]);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    if (element.value !== values[key]) return { ...publicView(view), submitted: false, message: 'the platform did not accept a field. check that step.' };
  }
  // Allow controlled-input handlers to settle, without retries or double clicks.
  await new Promise(resolve => setTimeout(resolve, 100));
  if (cancelled()) return { ...publicView(view), submitted: false, message: 'signup stopped.' };
  const blocked = blockers();
  if (blocked) return { ...publicView(blocked), submitted: false };
  if (location.href !== url.href || !visible(view.button) || view.button.disabled || view.button.getAttribute('aria-disabled') === 'true' || view.targets.some(({ key, element }) => !visible(element) || element.value !== values[key] || (element.checkValidity && !element.checkValidity()))) return { ...publicView(view), submitted: false, message: 'check the signup fields and next button in the platform tab, then continue here.' };
  if (all('input[type="checkbox"]').some(field => field.required && !field.checked)) return { ...publicView(view), submitted: false, message: 'review the required choice on the platform, then continue here.' };
  state.submitted.add(view.signature);
  if (view.stage === 'email-code') state.submittedCodeField = view.targets[0].element;
  view.button.click();
  return { ...publicView(view), submitted: true, message: view.stage === 'email-code' ? 'email code sent. checking the next step…' : 'signup details sent. checking the next step…' };
}
if (typeof module !== 'undefined') module.exports = { signupStep };
