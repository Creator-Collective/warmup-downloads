'use strict';

async function signupPhoneStep(input) {
  const stop = message => ({ stage: 'phone', canSubmit: false, submitted: false, message });
  const url = new URL(location.href);
  if (window !== window.top || url.protocol !== 'https:' || url.port || url.username || url.password || !['instagram', 'tiktok'].includes(input.platform) || ![`${input.platform}.com`, `www.${input.platform}.com`].includes(url.hostname)) return stop('the signup tab changed. check its address.');
  if (!globalThis.__ccNativeSignupDocument) globalThis.__ccNativeSignupDocument = { id: crypto.randomUUID(), submitted: new Set() };
  const state = globalThis.__ccNativeSignupDocument;
  if (!globalThis.__ccNativeSignupCancelled) globalThis.__ccNativeSignupCancelled = new Set();
  const cancelled = () => globalThis.__ccNativeSignupCancelled?.has(input.actionToken);
  const visible = element => { const box = element.getBoundingClientRect(), css = getComputedStyle(element); return element.isConnected && box.width > 0 && box.height > 0 && css.display !== 'none' && css.visibility !== 'hidden' && css.opacity !== '0'; };
  const all = selector => [...document.querySelectorAll(selector)].filter(visible);
  const label = element => (element.innerText || element.value || element.getAttribute('aria-label') || '').trim().toLowerCase();
  const inspect = () => {
    if (cancelled()) return stop('signup stopped.');
    const allowed = input.platform === 'instagram' ? /^\/accounts\/(emailsignup|signup|confirm_phone)(\/|$)/ : /^\/signup(\/|$)/;
    if (!allowed.test(new URL(location.href).pathname)) return stop('finish this account check in the platform tab, then continue here.');
    const body = (document.body?.innerText || '').slice(0, 30000).toLowerCase();
    if (/captcha|security check|suspicious|unusual activity|verify.{0,30}human|account.{0,25}(suspended|disabled|restricted)|too many|try again later/.test(body) || all('iframe').some(frame => /captcha|challenge|arkose/i.test(`${frame.src} ${frame.title}`))) return stop('finish the security check in the platform tab, then continue here.');
    if (all('[role="alert"], [aria-live="assertive"]').some(element => /incorrect|invalid|error|try again|not allowed|couldn.t/.test(label(element)))) return stop('check the platform’s message before continuing.');
    if (!/phone|mobile|sms|text message/.test(body)) return stop('this page does not show a phone signup step.');
    const fields = all('input').filter(field => !field.disabled && !field.readOnly && !['hidden', 'submit', 'checkbox', 'radio', 'button'].includes(field.type));
    const names = field => [field.name, field.id, field.placeholder, field.getAttribute('aria-label'), ...Array.from(field.labels || [], item => item.textContent)].filter(Boolean).map(value => value.trim());
    const codes = fields.filter(field => field.autocomplete === 'one-time-code' || names(field).some(value => /^(code|verification_code|confirmation_code|sms_code|security_code|verification code|confirmation code|security code|enter (?:a |the )?6[- ]digit code|6[- ]digit code)$/i.test(value)));
    const numbers = fields.filter(field => field.type === 'tel' && field.autocomplete !== 'one-time-code' && names(field).some(value => /^(phone|phone_number|phonenumber|mobile|mobile_number|phone number|mobile number)$/i.test(value)));
    const stage = codes.length === 1 && numbers.length === 0 ? 'sms-code' : numbers.length === 1 && codes.length === 0 ? 'phone-number' : null;
    if (!stage || fields.length !== 1) return stop('the phone form is unclear. finish it in the platform tab.');
    if (stage === 'sms-code') {
      if (!input.phoneSubmitted || !/^\+[1-9]\d{7,14}$/.test(input.phone || '')) return stop('this phone code was not requested by the current signup. check the recipient yourself.');
      const recipients = body.match(/\+?[\d*•x][\d\s().*•x-]{5,}\d/g) || [];
      const expected = input.phone.slice(1);
      const matches = recipients.map(value => value.replace(/[\s().-]/g, '').replace(/^\+/, '')).filter(value => value === expected || (/^[*•x]+\d{4}$/.test(value) && value.slice(-4) === expected.slice(-4)));
      if (matches.length !== 1 || !/(sent|send|enter|confirmation|verification|security code)/.test(body)) return stop('the code screen does not show your saved phone number. check its recipient yourself.');
    }
    // Country pickers need a separately verified adapter; never guess a prefix.
    if (stage === 'phone-number' && all('select, [role="combobox"]').length) return stop('choose the correct country and enter your saved number in the platform tab, then continue here.');
    const buttons = all('button, input[type="submit"], [role="button"]').filter(button => (stage === 'phone-number' ? /^(send code|send confirmation|send verification code|next|continue)$/ : /^(confirm|verify|next|continue|submit|sign up)$/).test(label(button)));
    if (buttons.length !== 1) return stop('the next phone button is unclear. finish this step in its tab.');
    const field = stage === 'phone-number' ? numbers[0] : codes[0], button = buttons[0];
    const form = field.form || button.form;
    if ((field.form && button.form && field.form !== button.form) || (form?.action && new URL(form.action, url).origin !== url.origin)) return stop('the phone form changed. check it before continuing.');
    const signature = JSON.stringify([url.pathname, stage, field.name || field.id || field.type, label(button)]);
    return { stage, canSubmit: true, signature, field, button };
  };
  const publicView = ({ field, button, ...view }) => ({ ...view, documentId: state.id });
  const view = inspect();
  if (input.mode !== 'act') return publicView(view);
  if (!view.canSubmit || state.id !== input.expectedDocument || view.signature !== input.expectedSignature || state.submitted.has(view.signature)) return { ...publicView(view), submitted: false };
  const value = view.stage === 'phone-number' ? input.phone : input.code;
  if (!(view.stage === 'phone-number' ? /^\+[1-9]\d{7,14}$/ : /^\d{6}$/).test(value || '')) return { ...publicView(view), submitted: false };
  if (view.field.value && view.field.value !== value) return { ...publicView(view), submitted: false, message: 'the phone field already has different details. check it yourself.' };
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(view.field, value);
  view.field.dispatchEvent(new Event('input', { bubbles: true }));
  view.field.dispatchEvent(new Event('change', { bubbles: true }));
  for (let attempt = 0; attempt < 31; attempt++) {
    if (cancelled() || location.href !== url.href) return { ...publicView(view), submitted: false, message: 'signup stopped or its page changed.' };
    const current = inspect();
    if (!current.canSubmit || current.signature !== view.signature || current.field.value !== value) return { ...publicView(current), submitted: false, message: current.message || 'the phone form changed. check it yourself.' };
    if (all('input[type="checkbox"]').some(field => field.required && !field.checked)) return { ...publicView(view), submitted: false, message: 'review the required choice in the platform tab.' };
    if ((!current.field.checkValidity || current.field.checkValidity()) && !current.button.disabled && current.button.getAttribute('aria-disabled') !== 'true') {
      state.submitted.add(current.signature);
      current.button.click();
      return { ...publicView(current), submitted: true };
    }
    if (attempt < 30) await new Promise(resolve => setTimeout(resolve, 100));
  }
  return { ...publicView(view), submitted: false, message: 'the platform has not enabled the phone step. check its message.' };
}
