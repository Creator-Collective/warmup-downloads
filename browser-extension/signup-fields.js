'use strict';

// This function is injected into the top frame. Keep it self-contained: no
// page-provided functions, remote code, cookies, or cross-frame form access.
function fillSignupFields(input) {
  const paused = message => ({ phase: 'paused', message, filled: [] });
  if (window !== window.top) return paused('open signup in the main browser tab.');
  const url = new URL(location.href);
  const hosts = input.platform === 'instagram' ? ['www.instagram.com', 'instagram.com'] : ['www.tiktok.com', 'tiktok.com'];
  if (url.protocol !== 'https:' || url.port || url.username || url.password || !hosts.includes(url.hostname)) return paused('the signup tab changed. stop and start again.');
  const signupPath = input.platform === 'instagram' ? /^\/accounts\/(emailsignup|signup|confirm_email)(\/|$)/ : /^\/signup(\/|$)/;
  if (!signupPath.test(url.pathname)) return paused('this tab is outside signup. if an account is already signed in, choose the account yourself before continuing.');
  const visible = element => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0';
  };
  const text = (document.body?.innerText || '').slice(0, 24000).toLowerCase();
  const challenges = [...document.querySelectorAll('iframe')].some(frame => visible(frame) && /captcha|recaptcha|hcaptcha|arkose|challenge/i.test(frame.src || frame.title || ''));
  if (challenges || /verify (?:that )?you(?:'re| are) (?:a )?human|security check|complete (?:the |this )?captcha|phone verification|verify your phone|(?:code|sent|send).{0,70}(?:your phone|phone number|mobile number|sms|text message)/.test(text)) return paused('finish the security or phone check in the signup tab, then continue here.');
  const inputs = [...document.querySelectorAll('input')].filter(element => visible(element) && !element.disabled && !element.readOnly);
  const birthdayFields = [...inputs, ...document.querySelectorAll('select')].filter(element => visible(element) && (element.type === 'date' || /birth|birthday|dob|^(month|day|year)$/i.test(`${element.name || ''}`) || /birth|birthday|dob/i.test(`${element.id || ''} ${element.getAttribute('aria-label') || ''}`)));
  if (birthdayFields.some(element => !element.value) || (!birthdayFields.length && /when(?:'s| is) your birthday|what(?:'s| is) your (?:birthday|date of birth)|enter your (?:birthday|date of birth)|add your birthday/.test(text))) return paused('enter your own birthday in the signup tab, then continue here.');
  if (inputs.some(element => element.type === 'tel' && /phone|mobile/i.test(`${element.name} ${element.placeholder}`)) && !inputs.some(element => element.type === 'email')) return paused('choose email signup, or finish the phone step yourself, then continue.');

  const patterns = {
    email: /^(email|emailorphone|email_or_phone|email_address)$/i,
    username: /^(username|user_name|uniqueid|unique_id)$/i,
    fullName: /^(fullname|full_name|name)$/i,
    password: /^(password|new_password|newpassword)$/i,
    code: /^(code|verification_code|verificationcode|confirmation_code|confirmationcode|email_confirmation_code|verifycode)$/i,
  };
  const matches = key => inputs.filter(element => {
    const name = element.name || element.id || '';
    const auto = element.autocomplete || '';
    const label = `${element.getAttribute('aria-label') || ''} ${element.placeholder || ''}`.trim();
    if (patterns[key].test(name)) return true;
    if (key === 'email') return element.type === 'email' || auto === 'email' || /^(mobile number or email|email address|email)$/i.test(label);
    if (key === 'password') return element.type === 'password' && auto !== 'current-password';
    if (key === 'username') return auto === 'username' || /^username$/i.test(label);
    if (key === 'fullName') return auto === 'name' || /^full name$/i.test(label);
    return auto === 'one-time-code' || /^(confirmation code|verification code|enter (?:a )?6[- ]digit code|6[- ]digit code)$/i.test(label);
  });
  const codeFields = matches('code');
  const emailStep = /(?:code|sent|send|confirm|verify).{0,100}(?:email|e-mail)|(?:email|e-mail).{0,100}(?:code|confirm|verify)/.test(text) || (input.email && text.includes(input.email.toLowerCase()));
  if ((input.mode === 'code' || input.mode === 'inspect-code') && !emailStep) return paused('this is not a clearly identified email verification step. complete it yourself.');
  const displayedEmails = text.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?/g) || [];
  const recipientMatches = typeof input.email === 'string' && input.email.length > 3 && (displayedEmails.includes(input.email.toLowerCase()) || matches('email').some(element => element.value.toLowerCase() === input.email.toLowerCase()));
  if ((input.mode === 'code' || input.mode === 'inspect-code') && !recipientMatches) return paused('the signup page does not show your selected email. check the recipient and enter the code yourself.');
  if (input.mode === 'inspect-code') return codeFields.length === 1 && !codeFields[0].value ? { phase: 'paused', message: 'email verification is ready.', codeReady: true, filled: [] } : paused(codeFields.length === 1 ? 'clear the previous code in the signup tab, then request a new email code here.' : 'open the email verification step before requesting a code.');
  const keys = input.mode === 'code' ? ['code'] : ['email', 'fullName', 'username', 'password'];
  if (input.mode !== 'code' && codeFields.length) return paused('email verification is ready. choose fill email code to use a fresh code from your account email.');
  const targets = [];
  for (const key of keys) {
    const found = matches(key);
    if (found.length > 1) return paused('this signup form has more than one matching field. fill this step yourself.');
    if (!found.length || !input[key]) continue;
    const element = found[0];
    if (element.value && element.value !== input[key]) return paused('a signup field already has different details. review it yourself before continuing.');
    targets.push({ key, element, value: input[key] });
  }
  if (!targets.length) return paused('open email signup in this tab, then continue. if the form looks different, fill this step yourself.');
  if (new Set(targets.map(target => target.element)).size !== targets.length) return paused('the signup fields are unclear. fill this step yourself.');
  const filled = [];
  for (const { key, element, value } of targets) {
    if (!element.isConnected || !visible(element) || element.disabled || element.readOnly) return paused('the signup form changed. review the fields and continue again.');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    if (element.value !== value) return paused('the platform did not accept a field. review the signup tab before continuing.');
    filled.push(key);
  }
  return { phase: 'filled', filled, message: input.mode === 'code' ? 'email code filled. review and submit it in the signup tab.' : 'available signup fields filled. review and submit this step in the signup tab, then continue here.' };
}
if (typeof module !== 'undefined') module.exports = { fillSignupFields };
