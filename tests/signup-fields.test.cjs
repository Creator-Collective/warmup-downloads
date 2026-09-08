const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { webcrypto } = require('node:crypto');
const source = fs.readFileSync(require.resolve('../browser-extension/signup-fields.js'), 'utf8');
const details = { platform: 'instagram', email: 'native@example.com', username: 'native_creator', password: 'fixture-password-only', actionToken: 'fixture-action-token' };

function fixture(options = {}) {
  class Input {
    constructor(props = {}) { Object.assign(this, { type: 'text', name: '', id: '', placeholder: '', autocomplete: '', disabled: false, readOnly: false, isConnected: true, _value: '', attrs: {}, width: 100, height: 30 }, props); }
    get value() { return this._value; }
    set value(value) { this._value = value; }
    getAttribute(name) { return this.attrs[name] || null; }
    getBoundingClientRect() { return { width: this.width, height: this.height }; }
    dispatchEvent(event) { options.onEvent?.(this, event); }
    checkValidity() { return !this.invalid; }
  }
  const inputs = (options.inputs || [{ name: 'email', type: 'email' }, { name: 'fullName' }, { name: 'username' }, { name: 'password', type: 'password' }]).map(props => new Input(props));
  let clicks = 0;
  const buttons = (options.buttons || [{ innerText: 'Sign up' }]).map(props => Object.assign(new Input(props), { click() { clicks++; options.onClick?.(); } }));
  const links = (options.links || []).map(props => new Input(props));
  const frames = (options.frames || []).map(props => new Input(props));
  const alerts = (options.alerts || []).map(innerText => new Input({ innerText }));
  const document = { body: { innerText: options.text || 'Sign up with your email' }, querySelectorAll(selector) {
    if (selector === 'input' || selector === 'input, select') return inputs;
    if (selector === 'input[type="checkbox"]') return inputs.filter(input => input.type === 'checkbox');
    if (selector === 'iframe') return frames;
    if (selector === '[role="alert"], [aria-live="assertive"]') return alerts;
    if (selector === 'a[href]') return links;
    if (selector === 'button, a[href]') return [...buttons, ...links];
    if (selector === 'button, input[type="submit"], [role="button"]') return buttons;
    return [];
  } };
  const window = {}; window.top = options.subframe ? {} : window;
  const location = { href: options.url || 'https://www.instagram.com/accounts/emailsignup/' };
  const context = vm.createContext({ window, location, document, URL, crypto: webcrypto, HTMLInputElement: Input, Event: class { constructor(type) { this.type = type; } }, getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }), setTimeout: options.setTimeout || (callback => callback()) });
  vm.runInContext(source, context);
  const run = async input => { context.request = { ...details, ...input }; return structuredClone(await vm.runInContext('signupStep(request)', context)); };
  return { inputs, buttons, document, location, clicks: () => clicks, run, cancel() { vm.runInContext('globalThis.__ccNativeSignupCancelled.add("fixture-action-token")', context); }, async act(extra = {}) { const observed = await run({ mode: 'observe', ...extra }); return run({ mode: 'act', expectedDocument: observed.documentId, expectedSignature: observed.signature, ...extra }); } };
}

test('native details fill and submit once, with stable nonsecret observation signatures', async () => {
  const form = fixture();
  const before = await form.run({ mode: 'observe' });
  assert.equal(before.stage, 'details'); assert.equal(form.clicks(), 0);
  assert.equal((await form.act()).submitted, true);
  assert.deepEqual(form.inputs.map(field => field.value), [details.email, details.username, details.username, details.password]);
  const after = await form.run({ mode: 'observe' });
  assert.equal(after.signature, before.signature); assert.equal(after.documentId, before.documentId);
  assert.ok(!JSON.stringify(after).includes(details.password)); assert.ok(!JSON.stringify(after).includes(details.email));
  assert.equal((await form.act()).submitted, false); assert.equal(form.clicks(), 1);
});

test('instagram get-started form prefills details but leaves birthday and Submit to the user', async () => {
  const form = fixture({
    text: 'Get started on Instagram\nMobile number or email\nPassword\nBirthday\nMonth\nDay\nYear\nName\nUsername\nSubmit',
    inputs: [
      { placeholder: 'Mobile number or email', attrs: { 'aria-label': 'Mobile number or email' } },
      { placeholder: 'Password', type: 'password', attrs: { 'aria-label': 'Password' } },
      { placeholder: 'Full name', attrs: { 'aria-label': 'Full name' } },
      { placeholder: 'Username', attrs: { 'aria-label': 'Username' } },
    ], buttons: [{ innerText: 'Month' }, { innerText: 'Day' }, { innerText: 'Year' }, { innerText: 'Submit', disabled: true }, { innerText: 'I already have an account' }],
  });
  const observed = await form.run({ mode: 'observe' });
  assert.equal(observed.stage, 'birthday');
  assert.equal(observed.canFill, true);
  assert.equal(observed.canSubmit, false);
  const filled = await form.run({ mode: 'fill', expectedDocument: observed.documentId, expectedSignature: observed.signature });
  assert.equal(filled.filled, true);
  assert.equal(filled.submitted, false);
  assert.deepEqual(form.inputs.map(field => field.value), [details.email, details.password, details.username, details.username]);
  assert.equal(form.clicks(), 0);
  assert.equal((await form.act()).submitted, false);
  assert.equal(form.clicks(), 0);
});

test('Submit is accepted only for a complete recognized instagram details form', async () => {
  const form = fixture({ buttons: [{ innerText: 'Submit' }] });
  assert.equal((await form.act()).submitted, true);
  assert.equal((await fixture({ inputs: [{ name: 'email' }], buttons: [{ innerText: 'Submit' }] }).act()).submitted, false);
});

test('birthday prefill preserves user edits and refuses changed documents or security checks', async () => {
  for (const change of ['occupied', 'document', 'captcha', 'validation']) {
    const form = fixture({ text: 'Get started on Instagram\nBirthday', buttons: [{ innerText: 'Submit' }] });
    const observed = await form.run({ mode: 'observe' });
    if (change === 'occupied') form.inputs[0].value = 'another@example.com';
    if (change === 'captcha') form.document.body.innerText += '\nVerify you are human';
    if (change === 'validation') form.document.body.innerText += '\nThis username is already taken';
    const result = await form.run({ mode: 'fill', expectedDocument: change === 'document' ? 'changed' : observed.documentId, expectedSignature: observed.signature });
    assert.notEqual(result.filled, true);
    assert.equal(form.inputs.at(-1).value, '');
    assert.equal(form.clicks(), 0);
  }
});

test('birthday fill-only stops when cancelled or a security check appears while fields settle', async () => {
  for (const change of ['cancel', 'captcha']) {
    let settleInputs;
    const form = fixture({ text: 'Get started on Instagram\nBirthday', buttons: [{ innerText: 'Submit' }], setTimeout: callback => { settleInputs = callback; } });
    const observed = await form.run({ mode: 'observe' });
    const pending = form.run({ mode: 'fill', expectedDocument: observed.documentId, expectedSignature: observed.signature });
    for (let tick = 0; tick < 5; tick++) await Promise.resolve();
    assert.equal(typeof settleInputs, 'function');
    if (change === 'cancel') form.cancel();
    else form.document.body.innerText += '\nVerify you are human';
    settleInputs();
    const result = await pending;
    assert.notEqual(result.filled, true);
    assert.equal(result.submitted, false);
    assert.equal(form.clicks(), 0);
  }
});

test('changed document or stage does not fill or submit', async () => {
  const form = fixture(), observation = await form.run({ mode: 'observe' });
  const outcome = await form.run({ mode: 'act', expectedDocument: 'old-document', expectedSignature: observation.signature });
  assert.equal(outcome.submitted, false); assert.equal(form.inputs[0].value, ''); assert.equal(form.clicks(), 0);
});

test('existing different details, duplicate fields and unknown buttons pause', async () => {
  const occupied = fixture({ inputs: [{ name: 'email', _value: 'someone@example.com' }] });
  assert.equal((await occupied.act()).submitted, false); assert.equal(occupied.clicks(), 0);
  assert.equal((await fixture({ inputs: [{ name: 'email' }, { type: 'email' }] }).run({ mode: 'observe' })).canSubmit, false);
  assert.equal((await fixture({ buttons: [{ innerText: 'Log in with Facebook' }] }).run({ mode: 'observe' })).canSubmit, false);
  assert.equal((await fixture({ buttons: [{ innerText: 'Sign up' }, { innerText: 'Continue' }] }).run({ mode: 'observe' })).canSubmit, false);
});

test('birthday, phone, captcha and validation errors require a person', async () => {
  for (const [options, stage] of [
    [{ inputs: [{ name: 'birthday', type: 'date', _value: '1995-01-01' }] }, 'birthday'],
    [{ text: 'verify your phone number' }, 'phone'],
    [{ frames: [{ src: 'https://captcha.example/challenge' }] }, 'captcha'],
    [{ text: 'this username is already taken' }, 'username-unavailable'],
    [{ alerts: ['Your password must be longer'] }, 'unknown'],
  ]) { const form = fixture(options); assert.equal((await form.act()).stage, stage); assert.equal(form.clicks(), 0); }
});

test('email codes require an exact visible recipient and never replace an existing code', async () => {
  for (const recipient of ['other@example.com', 'other-native@example.com', 'native@example.com.evil', 'n***@example.com']) {
    const form = fixture({ inputs: [{ name: 'confirmation_code' }], text: `check your email. we sent a code to ${recipient}`, buttons: [{ innerText: 'Next' }] });
    assert.equal((await form.act({ code: '123456' })).submitted, false); assert.equal(form.clicks(), 0);
  }
  const form = fixture({ inputs: [{ name: 'confirmation_code' }], text: `check your email. we sent a code to ${details.email}`, buttons: [{ innerText: 'Next' }] });
  assert.equal((await form.run({ mode: 'observe' })).stage, 'email-code');
  assert.equal((await form.act({ code: '123456' })).submitted, true); assert.equal(form.inputs[0].value, '123456');
  assert.equal((await form.run({ mode: 'observe' })).stage, 'email-code');
  assert.equal((await form.act({ code: '654321' })).submitted, false); assert.equal(form.clicks(), 1);
});

test('stop during controlled input settling prevents the pending submission', async () => {
  let settleInputs;
  const form = fixture({ setTimeout: callback => { settleInputs = callback; } });
  const pending = form.act();
  for (let tick = 0; tick < 5; tick++) await Promise.resolve();
  assert.equal(typeof settleInputs, 'function');
  form.cancel(); settleInputs();
  assert.equal((await pending).submitted, false); assert.equal(form.clicks(), 0);
  assert.equal((await form.act()).submitted, false);
});

test('tiktok sends its code once before observing the same-form verification step', async () => {
  const form = fixture({ url: 'https://www.tiktok.com/signup/phone-or-email/email', inputs: [{ type: 'email', name: 'email' }, { type: 'password', name: 'password' }, { name: 'code' }], buttons: [{ innerText: 'Send code' }, { innerText: 'Sign up' }], text: 'Sign up with email. Send code' });
  assert.equal((await form.run({ platform: 'tiktok', mode: 'observe' })).stage, 'details');
  assert.equal((await form.act({ platform: 'tiktok' })).submitted, true);
  form.document.body.innerText = 'check your email. code sent to native@example.com';
  assert.equal((await form.run({ platform: 'tiktok', mode: 'observe' })).stage, 'email-code');
});

test('form validation, required choices, cross-origin actions and detached buttons prevent a click', async () => {
  for (const options of [
    { inputs: [{ name: 'email', invalid: true }] },
    { inputs: [{ name: 'email' }, { type: 'checkbox', required: true, checked: false }] },
    { buttons: [{ innerText: 'Sign up', form: { action: 'https://other.example/signup' } }] },
    { buttons: [{ innerText: 'Sign up', disabled: true }] },
  ]) { const form = fixture(options); assert.equal((await form.act()).submitted, false); assert.equal(form.clicks(), 0); }
  const changed = fixture({ onEvent: () => { changed.buttons[0].isConnected = false; } });
  assert.equal((await changed.act()).submitted, false); assert.equal(changed.clicks(), 0);
});

test('only matching signed-in profile navigation supplies completion evidence', async () => {
  const profile = { href: 'https://www.instagram.com/native_creator/', innerText: 'Profile' };
  const inbox = { href: 'https://www.instagram.com/direct/inbox/', innerText: 'Messages' };
  for (const options of [{}, { links: [profile] }, { links: [{ ...profile, href: 'https://www.instagram.com/another/' }, inbox] }, { links: [profile, inbox], buttons: [{ innerText: 'Log in' }] }]) {
    assert.equal((await fixture({ url: 'https://www.instagram.com/native_creator/', buttons: [], ...options }).run({ mode: 'observe' })).stage, 'signed-in');
  }
  const result = await fixture({ url: 'https://www.instagram.com/', buttons: [], links: [profile, inbox] }).run({ mode: 'observe' });
  assert.equal(result.stage, 'complete'); assert.equal(result.username, details.username);
});

test('wrong hosts, login pages and child frames never receive details', async () => {
  for (const options of [{ url: 'https://www.instagram.com.evil/accounts/emailsignup/' }, { url: 'http://www.instagram.com/accounts/emailsignup/' }, { url: 'https://www.instagram.com:8443/accounts/emailsignup/' }, { url: 'https://www.instagram.com/accounts/login/' }, { subframe: true }]) {
    const form = fixture(options); assert.equal((await form.act()).submitted, false); assert.equal(form.inputs[0].value, ''); assert.equal(form.clicks(), 0);
  }
});
