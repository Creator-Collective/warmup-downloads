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
    if (/username.{0,55}(?:isn.t available|is not available|is unavailable|is already taken|is taken|already exists)|(?:this|that) username.{0,30}(?:taken|unavailable)|try another username/.test(body)) return stop('username-unavailable', 'that username is unavailable. stop and try another username.');
    if (all('[role="alert"], [aria-live="assertive"]').map(label).some(value => /error|incorrect|invalid|try again|couldn.t|can.t|not allowed|too many|must be|at least/.test(value))) return stop('unknown', 'the platform needs a correction. check its message, fix that step, then continue here.');
    if (birthdays.length || /when(?:'s| is) your birthday|what(?:'s| is) your (?:birthday|date of birth)|enter your (?:birthday|date of birth)|add your birthday|(?:^|\n)\s*birthday\b/.test(body)) return stop('birthday', 'finish the birthday step in the signup tab, then continue here.');
    return null;
  };
  const signupPath = input.platform === 'instagram' ? /^\/accounts\/(emailsignup|signup|confirm_email)(\/|$)/ : /^\/signup(\/|$)/;
  const names = element => [element.name, element.id, element.getAttribute('aria-label'), element.getAttribute('title'), element.placeholder, ...Array.from(element.labels || [], item => item.textContent)].filter(Boolean).map(value => value.trim().toLowerCase());
  const birthdayFields = () => {
    if (input.platform !== 'instagram' || !/^\d{4}-\d{2}-\d{2}$/.test(input.birthDate || '')) return null;
    const date = new Date(`${input.birthDate}T00:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== input.birthDate) return null;
    const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
    const wanted = { month: months[date.getUTCMonth()], day: String(date.getUTCDate()), year: String(date.getUTCFullYear()) };
    const dates = all('input').filter(field => field.type === 'date');
    const controls = [...new Set([...all('select'), ...all('button, [role="button"], [role="combobox"], [aria-haspopup="listbox"]')])];
    const fields = ['month', 'day', 'year'].map(key => {
      const candidates = controls.filter(element => names(element).some(value => value.replace(/^(birthday|birth|dob)[_ -]*/, '').replace(/:$/, '') === key) || label(element) === key || state.birthdayFields?.some(previous => previous.key === key && previous.element === element));
      if (candidates.length !== 1) return null;
      const element = candidates[0];
      const kind = element.tagName === 'SELECT' ? 'select' : 'custom';
      const options = kind === 'select' ? Array.from(element.options).filter(option => !option.disabled && (option.textContent || '').trim().toLowerCase() === wanted[key]) : [];
      if (kind === 'select' && options.length !== 1) return null;
      return { key, element, kind, wanted: wanted[key], value: options[0]?.value };
    });
    if (dates.length) return dates.length === 1 && fields.every(field => !field) ? [{ key: 'date', kind: 'date', element: dates[0], value: input.birthDate }] : null;
    if (fields.some(field => !field) || new Set(fields.map(field => field.element)).size !== 3) return null;
    state.birthdayFields = fields;
    return fields;
  };
  const birthdayValue = field => {
    if (field.kind !== 'custom') return field.element.value;
    return label(field.element).replace(new RegExp(`^${field.key}[\\s:]+`), '').trim();
  };
  const birthdayMatches = field => birthdayValue(field) === (field.kind === 'custom' ? field.wanted : field.value);
  const birthdayEditable = field => {
    const element = field.element;
    if (!visible(element) || element.disabled || element.readOnly || element.getAttribute('aria-disabled') === 'true' || (field.kind === 'custom' && element.type === 'submit')) return false;
    const value = birthdayValue(field);
    if (field.kind === 'select' && Array.from(element.options).some(option => option.value === value && (option.textContent || '').trim().toLowerCase().replace(/:$/, '') === field.key)) return true;
    return !value || value === field.key || birthdayMatches(field);
  };
  const fillBirthday = async fields => {
    const safe = () => { const blocked = blockers(); return !cancelled() && location.href === url.href && (!blocked || blocked.stage === 'birthday'); };
    const waitFor = async predicate => {
      for (let check = 0; check < 20; check++) {
        if (!safe()) return false;
        if (predicate()) return true;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      return false;
    };
    for (const field of fields) {
      if (!safe() || !birthdayEditable(field)) return false;
      if (birthdayMatches(field)) continue;
      const element = field.element;
      if (field.kind === 'custom') {
        if (element.getAttribute('aria-expanded') !== 'true') element.click();
        let choice;
        const found = await waitFor(() => {
          const controlled = element.getAttribute('aria-controls');
          const linked = controlled ? document.getElementById(controlled) : null;
          const lists = linked && visible(linked) && linked.getAttribute('role') === 'listbox' ? [linked] : all('[role="listbox"]');
          if (lists.length !== 1) return false;
          const options = [...lists[0].querySelectorAll('[role="option"]')].filter(option => visible(option) && option.getAttribute('aria-disabled') !== 'true' && label(option) === field.wanted);
          if (options.length !== 1) return false;
          choice = options[0];
          return true;
        });
        if (!found || !safe() || !birthdayEditable(field)) return false;
        choice.click();
        if (!await waitFor(() => visible(element) && birthdayMatches(field))) return false;
      } else {
        const prototype = field.kind === 'select' ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, field.value);
        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    await new Promise(resolve => setTimeout(resolve, 100));
    return safe() && fields.every(field => visible(field.element) && birthdayMatches(field) && (!field.element.checkValidity || field.element.checkValidity()));
  };
  const inspect = () => {
    const blocked = blockers();
    if (blocked && (blocked.stage !== 'birthday' || input.platform !== 'instagram' || !signupPath.test(url.pathname))) return blocked;
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
      const accessibleNames = [field.getAttribute('aria-label'), field.placeholder, ...Array.from(field.labels || [], item => item.textContent)].filter(Boolean).map(value => value.trim());
      if (patterns[key].test(name)) return true;
      if (key === 'email') return field.type === 'email' || field.autocomplete === 'email' || accessibleNames.some(value => /^(mobile number or email|email address|email)$/i.test(value));
      if (key === 'password') return field.type === 'password' && field.autocomplete !== 'current-password';
      if (key === 'username') return field.autocomplete === 'username' || accessibleNames.some(value => /^username$/i.test(value));
      if (key === 'fullName') return field.autocomplete === 'name' || accessibleNames.some(value => /^(full name|name)$/i.test(value));
      return field.autocomplete === 'one-time-code' || accessibleNames.some(value => /^(confirmation code|verification code|enter (?:a )?6[- ]digit code|6[- ]digit code)$/i.test(value));
    });
    if (fields.some(field => field.type === 'tel' && /phone|mobile/i.test(`${field.name} ${field.placeholder}`)) && !matches('email').length) return stop('phone', 'choose email signup in the platform tab, then continue here.');
    const recognized = Object.fromEntries(Object.keys(patterns).map(key => [key, matches(key)]));
    if (Object.values(recognized).some(found => found.length > 1)) return stop('unknown', 'the signup fields are unclear. finish this step in the platform tab.');
    const fullDetails = ['email', 'fullName', 'username', 'password'].every(key => recognized[key].length === 1);
    if (blocked && (!fullDetails || recognized.code.length)) return blocked;
    const birthday = blocked?.stage === 'birthday' ? birthdayFields() : null;
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
    const stage = blocked && !birthday ? 'birthday' : codeStep ? 'email-code' : 'details';
    const keys = codeStep ? ['code'] : ['email', 'fullName', 'username', 'password'];
    const targets = keys.flatMap(key => recognized[key].map(element => ({ key, element })));
    if (!targets.length || new Set(targets.map(target => target.element)).size !== targets.length) return stop('unknown', 'open email signup in this tab, then continue here.');
    const normal = codeStep ? /^(next|continue|confirm|confirm email|verify|verify email|sign up|signup)$/ : /^(sign up|signup|next|continue)$/;
    const candidates = input.platform === 'tiktok' && !codeStep && send.length === 1 ? send : buttons.filter(button => normal.test(label(button)) || (input.platform === 'instagram' && !codeStep && fullDetails && label(button) === 'submit'));
    if (candidates.length !== 1) return stop('unknown', 'the next signup button is unclear. finish that step in the platform tab.');
    const button = candidates[0];
    const form = button.form || targets[0].element.form;
    if (form?.action) { try { if (new URL(form.action, url).origin !== url.origin) return stop('unknown', 'the signup form changed. review it in the platform tab.'); } catch { return stop('unknown', 'the signup form changed. review it in the platform tab.'); } }
    if (targets.some(({ element }) => element.form && form && element.form !== form)) return stop('unknown', 'the signup fields belong to different forms. finish this step yourself.');
    if (birthday?.some(({ element }) => element.form && form && element.form !== form)) return stop('unknown', 'the birthday belongs to a different form. check the signup tab.');
    const signature = JSON.stringify([url.pathname, stage, targets.map(({ key, element }) => [key, element.name || element.id || element.type]), label(button), ...(birthday ? [birthday.map(({ key, kind }) => [key, kind])] : [])]);
    return { stage, signature, canSubmit: !blocked || Boolean(birthday), canFill: Boolean(blocked && !birthday), message: blocked && !birthday ? blocked.message : codeStep ? 'waiting for the email code…' : 'entering your signup details…', targets, button, birthday };
  };
  const view = inspect();
  const publicView = value => { const { targets, button, birthday, ...result } = value; return { ...result, documentId: state.id }; };
  const fillOnly = input.mode === 'fill' && view.stage === 'birthday' && view.canFill;
  if (input.mode !== 'act' && !fillOnly) return publicView(view);
  if ((!fillOnly && !view.canSubmit) || input.expectedDocument !== state.id || input.expectedSignature !== view.signature || state.submitted.has(view.signature)) return { ...publicView(view), submitted: false, message: 'the signup step changed or was already sent. check the platform tab.' };
  if (view.stage === 'email-code' && !/^\d{6}$/.test(input.code || '')) return { ...publicView(view), submitted: false, message: 'waiting for a fresh email code.' };
  if (view.birthday?.some(field => !birthdayEditable(field))) return { ...publicView(view), submitted: false, message: 'a birthday field has different details. check the date in instagram before continuing.' };
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
  if (view.birthday && !await fillBirthday(view.birthday)) return { ...publicView(view), submitted: false, message: cancelled() ? 'signup stopped.' : 'the birthday could not be confirmed. check the signup tab before continuing.' };
  // Allow controlled-input handlers to settle, without retries or double clicks.
  await new Promise(resolve => setTimeout(resolve, 100));
  if (cancelled()) return { ...publicView(view), submitted: false, message: 'signup stopped.' };
  const blocked = blockers();
  if (blocked && (!(fillOnly || view.birthday) || blocked.stage !== 'birthday')) return { ...publicView(blocked), submitted: false };
  if (fillOnly) {
    const filled = location.href === url.href && view.targets.every(({ key, element }) => visible(element) && element.value === values[key]);
    return { ...publicView(view), filled, submitted: false, message: filled ? 'details filled. choose your birthday and press submit in instagram, then continue here.' : 'the signup form changed. check its details before continuing.' };
  }
  if (location.href !== url.href || !visible(view.button) || view.button.disabled || view.button.getAttribute('aria-disabled') === 'true' || view.targets.some(({ key, element }) => !visible(element) || element.value !== values[key] || (element.checkValidity && !element.checkValidity()))) return { ...publicView(view), submitted: false, message: 'check the signup fields and next button in the platform tab, then continue here.' };
  if (all('input[type="checkbox"]').some(field => field.required && !field.checked)) return { ...publicView(view), submitted: false, message: 'review the required choice on the platform, then continue here.' };
  if (view.birthday && !view.birthday.every(field => visible(field.element) && birthdayMatches(field))) return { ...publicView(view), submitted: false, message: 'the birthday changed. check the signup tab before continuing.' };
  state.submitted.add(view.signature);
  if (view.stage === 'email-code') state.submittedCodeField = view.targets[0].element;
  view.button.click();
  return { ...publicView(view), submitted: true, message: view.stage === 'email-code' ? 'email code sent. checking the next step…' : 'signup details sent. checking the next step…' };
}
if (typeof module !== 'undefined') module.exports = { signupStep };
