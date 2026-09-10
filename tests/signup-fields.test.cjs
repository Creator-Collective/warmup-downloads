const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { webcrypto } = require('node:crypto');
const source = fs.readFileSync(require.resolve('../browser-extension/signup-fields.js'), 'utf8') + '\n' + fs.readFileSync(require.resolve('../browser-extension/signup-phone.js'), 'utf8');
const details = { platform: 'instagram', email: 'native@example.com', username: 'native_creator', password: 'fixture-password-only', actionToken: 'fixture-action-token' };

function fixture(options = {}) {
  class Input {
    constructor(props = {}) { Object.assign(this, { tagName: 'INPUT', type: 'text', name: '', id: '', placeholder: '', autocomplete: '', disabled: false, readOnly: false, isConnected: true, _value: '', attrs: {}, width: 100, height: 30 }, props); }
    get value() { return this._value; }
    set value(value) { this._value = value; }
    getAttribute(name) { return this.attrs[name] || null; }
    getBoundingClientRect() { return { width: this.width, height: this.height }; }
    dispatchEvent(event) { options.onEvent?.(this, event); }
    checkValidity() { return !this.invalid; }
  }
  class Select extends Input {
    constructor(props) { super({ tagName: 'SELECT', ...props }); }
    get value() { return this._value; }
    set value(value) { this._value = value; }
  }
  const selects = (options.selects || []).map(props => new Select(props));
  const inputs = (options.inputs || [{ name: 'email', type: 'email' }, { name: 'fullName' }, { name: 'username' }, { name: 'password', type: 'password' }]).map(props => new Input(props));
  let clicks = 0;
  const buttons = (options.buttons || [{ innerText: 'Sign up' }]).map(props => Object.assign(new Input(props), { click() { clicks++; options.onClick?.(); } }));
  const links = (options.links || []).map(props => new Input(props));
  const frames = (options.frames || []).map(props => new Input(props));
  const alerts = (options.alerts || []).map(innerText => new Input({ innerText }));
  let openList = null;
  const birthdayControls = (options.customBirthday || []).map(({ key, choices, ...props }) => {
    const control = new Input({ tagName: 'BUTTON', innerText: key, attrs: { 'aria-label': key, 'aria-controls': `${key}-list` }, ...props });
    const list = new Input({ id: `${key}-list`, attrs: { role: 'listbox' }, isConnected: false });
    const items = choices.map(text => Object.assign(new Input({ innerText: text, attrs: { role: 'option' } }), { click() {
      options.onBirthdayChoice?.(key, text);
      if (!options.rejectBirthday) control.innerText = text;
      list.isConnected = false; openList = null;
    } }));
    list.querySelectorAll = selector => selector === '[role="option"]' ? items : [];
    control.click = () => { options.onBirthdayOpen?.(key); openList = list; list.isConnected = true; };
    return { control, list };
  });
  const document = { body: { innerText: options.text || 'Sign up with your email' }, querySelectorAll(selector) {
    if (selector === 'input') return inputs;
    if (selector === 'input, select') return [...inputs, ...selects];
    if (selector === 'select' || selector === 'select, [role="combobox"]') return selects;
    if (selector === 'button, [role="button"], [role="combobox"], [aria-haspopup="listbox"]') return [...buttons, ...birthdayControls.map(item => item.control)];
    if (selector === '[role="listbox"]') return openList ? [openList] : [];
    if (selector === 'input[type="checkbox"]') return inputs.filter(input => input.type === 'checkbox');
    if (selector === 'iframe') return frames;
    if (selector === '[role="alert"], [aria-live="assertive"]') return alerts;
    if (selector === 'a[href]') return links;
    if (selector === 'button, a[href]') return [...buttons, ...links];
    if (selector === 'button, input[type="submit"], [role="button"]') return buttons;
    return [];
  }, getElementById(id) { return birthdayControls.find(item => item.list.id === id)?.list || null; } };
  const window = {}; window.top = options.subframe ? {} : window;
  const location = { href: options.url || 'https://www.instagram.com/accounts/emailsignup/' };
  const context = vm.createContext({ window, location, document, URL, crypto: webcrypto, HTMLInputElement: Input, HTMLSelectElement: Select, Event: class { constructor(type) { this.type = type; } }, getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }), setTimeout: options.setTimeout || (callback => callback()) });
  vm.runInContext(source, context);
  const run = async input => { context.request = { ...details, ...input }; return structuredClone(await vm.runInContext(input.phoneMode ? 'signupPhoneStep(request)' : 'signupStep(request)', context)); };
  return { inputs, selects, buttons, birthdayControls: birthdayControls.map(item => item.control), document, location, clicks: () => clicks, run, cancel() { vm.runInContext('globalThis.__ccNativeSignupCancelled.add("fixture-action-token")', context); }, async act(extra = {}) { const observed = await run({ mode: 'observe', ...extra }); return run({ mode: 'act', expectedDocument: observed.documentId, expectedSignature: observed.signature, ...extra }); } };
}

const birthday = { birthDate: '2006-05-30' };
const nativeBirthday = () => ['month', 'day', 'year'].map((key, index) => ({ name: `birthday_${key}`, options: [{ textContent: key, value: '' }, { textContent: ['May', '30', '2006'][index], value: ['4', '30', '2006'][index] }] }));
const customBirthday = () => [{ key: 'month', choices: ['April', 'May', 'June'] }, { key: 'day', choices: ['29', '30', '31'] }, { key: 'year', choices: ['2005', '2006', '2007'] }];

test('custom birthday menus choose the exact date and confirm all three values before submitting', async () => {
  const selected = [];
  const form = fixture({ text: 'Get started on Instagram\nBirthday', customBirthday: customBirthday(), buttons: [{ innerText: 'Submit' }], onBirthdayChoice: (key, value) => selected.push([key, value]) });
  const before = await form.run({ mode: 'observe', ...birthday });
  assert.equal((await form.act(birthday)).submitted, true);
  assert.deepEqual(selected, [['month', 'May'], ['day', '30'], ['year', '2006']]);
  assert.deepEqual(form.birthdayControls.map(control => control.innerText), ['May', '30', '2006']);
  const after = await form.run({ mode: 'observe', ...birthday });
  assert.equal(after.signature, before.signature);
  assert.equal((await form.act(birthday)).submitted, false);
  assert.equal(form.clicks(), 1);
});

test('custom birthday menus stop on cancellation, security checks, missing choices or rejected selections', async () => {
  for (const change of ['cancel', 'captcha', 'missing', 'ambiguous', 'rejected', 'detached', 'navigation', 'edited', 'submit-trigger']) {
    const menus = customBirthday();
    if (change === 'missing') menus[0].choices = ['April', 'June'];
    if (change === 'ambiguous') menus[0].choices.push('May');
    if (change === 'submit-trigger') menus[0].type = 'submit';
    let choices = 0;
    const form = fixture({ text: 'Birthday', customBirthday: menus, buttons: [{ innerText: 'Submit' }], rejectBirthday: change === 'rejected', onBirthdayOpen: () => {
      if (change === 'cancel') form.cancel();
      if (change === 'captcha') form.document.body.innerText += '\nVerify you are human';
      if (change === 'detached') form.birthdayControls[0].isConnected = false;
      if (change === 'navigation') form.location.href = 'https://www.instagram.com/accounts/login/';
      if (change === 'edited') form.birthdayControls[0].innerText = 'June';
    }, onBirthdayChoice: () => choices++ });
    const result = await form.act(birthday);
    assert.equal(result.submitted, false, change);
    assert.equal(form.clicks(), 0, change);
    assert.equal(choices, change === 'rejected' ? 1 : 0, change);
  }
});

test('native birthday placeholders need not use empty values and invalid options cannot submit', async () => {
  const selects = nativeBirthday();
  for (const field of selects) { field.options[0].value = 'unset'; field._value = 'unset'; }
  const form = fixture({ text: 'Birthday', selects, buttons: [{ innerText: 'Submit' }] });
  assert.equal((await form.act(birthday)).submitted, true);
  const disabled = nativeBirthday(); disabled[0].options[1].disabled = true;
  assert.equal((await fixture({ text: 'Birthday', selects: disabled }).act(birthday)).submitted, false);
});

test('native birthday is checked again after controlled-input changes and never ignores a security check', async () => {
  for (const change of ['date', 'captcha', 'disabled']) {
    const form = fixture({ text: 'Birthday', selects: nativeBirthday(), buttons: [{ innerText: 'Submit' }], onEvent: element => {
      if (element.name === 'birthday_year') {
        if (change === 'date') form.selects[0].value = '8';
        if (change === 'captcha') form.document.body.innerText += '\nVerify you are human';
        if (change === 'disabled') form.buttons[0].disabled = true;
      }
    } });
    assert.equal((await form.act(birthday)).submitted, false, change);
    assert.equal(form.clicks(), 0);
  }
});

test('configured birthday fills exact native options and submits the inline form once', async () => {
  const form = fixture({ text: 'Get started on Instagram\nBirthday', selects: nativeBirthday(), buttons: [{ innerText: 'Submit' }] });
  const before = await form.run({ mode: 'observe', ...birthday });
  assert.equal(before.stage, 'details'); assert.equal(before.canSubmit, true);
  assert.equal((await form.act(birthday)).submitted, true);
  assert.deepEqual(form.selects.map(field => field.value), ['4', '30', '2006'], 'use May option value, not a guessed month index');
  assert.equal((await form.act(birthday)).submitted, false);
  assert.equal(form.clicks(), 1);
});

test('configured birthday supports a named date input without exposing it in the signature', async () => {
  const form = fixture({ text: 'Birthday', inputs: [{ name: 'email' }, { name: 'fullName' }, { name: 'username' }, { name: 'password', type: 'password' }, { name: 'birthday', type: 'date' }], buttons: [{ innerText: 'Submit' }] });
  const result = await form.act(birthday);
  assert.equal(result.submitted, true);
  assert.equal(form.inputs.at(-1).value, birthday.birthDate);
  assert.equal(result.signature.includes(birthday.birthDate), false);
});

test('birthday automation preserves existing dates and pauses on missing or ambiguous controls', async () => {
  for (const kind of ['occupied', 'missing', 'duplicate', 'invalid']) {
    const selects = nativeBirthday();
    if (kind === 'occupied') selects[0]._value = '8';
    if (kind === 'missing') selects.pop();
    if (kind === 'duplicate') selects.push({ ...selects[0] });
    const form = fixture({ text: 'Birthday', selects, buttons: [{ innerText: 'Submit' }] });
    const result = await form.act(kind === 'invalid' ? { birthDate: '2006-02-30' } : birthday);
    assert.equal(result.submitted, false, kind);
    assert.equal(form.clicks(), 0, kind);
    assert.equal(form.inputs[0].value, '', kind);
  }
});

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

test('Instagram confirmation copy without the word email still requires the exact saved recipient', async () => {
  for (const recipient of [details.email, 'different@example.com', 'n***@example.com']) {
    const form = fixture({ inputs: [{ placeholder: 'Confirmation code', attrs: { 'aria-label': 'Confirmation code' } }], text: `Enter the confirmation code\nTo confirm your account, enter the 6-digit code we sent to ${recipient}.`, buttons: [{ innerText: 'Continue' }, { innerText: "I didn't get the code" }] });
    const observed = await form.run({ mode: 'observe' });
    assert.equal(observed.stage, recipient === details.email ? 'email-code' : 'unknown');
    assert.equal((await form.act({ code: '123456' })).submitted, recipient === details.email);
  }
});

test('submission waits briefly for validation without refilling or repeatedly clicking', async () => {
  let waits = 0, events = 0;
  const form = fixture({ buttons: [{ innerText: 'Submit', disabled: true }], setTimeout: callback => { if (++waits === 4) form.buttons[0].disabled = false; callback(); }, onEvent: () => events++ });
  const result = await form.act();
  assert.equal(result.submitted, true);
  assert.equal(events, 8, 'fill each field once');
  assert.equal(form.clicks(), 1);
});

test('a replacement submit button is freshly checked after the form rerenders', async () => {
  let oldClicks = 0, newClicks = 0, replaced = false;
  const form = fixture({ buttons: [{ innerText: 'Submit' }], setTimeout: callback => {
    if (!replaced) {
      replaced = true;
      const old = form.buttons[0]; old.click = () => oldClicks++;
      const replacement = Object.assign(Object.create(Object.getPrototypeOf(old)), old, { click: () => newClicks++ });
      old.isConnected = false; form.buttons[0] = replacement;
    }
    callback();
  } });
  assert.equal((await form.act()).submitted, true);
  assert.equal(oldClicks, 0); assert.equal(newClicks, 1);
});

test('readiness waiting stops for cancellation, security checks, navigation and user edits', async () => {
  for (const change of ['cancel', 'captcha', 'navigation', 'edit']) {
    let waits = 0;
    const form = fixture({ buttons: [{ innerText: 'Submit', disabled: true }], setTimeout: callback => {
      if (++waits === 3) {
        if (change === 'cancel') form.cancel();
        if (change === 'captcha') form.document.body.innerText += '\nVerify you are human';
        if (change === 'navigation') form.location.href = 'https://www.instagram.com/accounts/login/';
        if (change === 'edit') form.inputs[0].value = 'changed@example.com';
        form.buttons[0].disabled = false;
      }
      callback();
    } });
    assert.equal((await form.act()).submitted, false, change);
    assert.equal(form.clicks(), 0);
  }
});

test('readiness timeout names the blocking field or button without exposing its value', async () => {
  for (const reason of ['password', 'button']) {
    const form = fixture({ buttons: [{ innerText: 'Submit', disabled: reason === 'button' }] });
    if (reason === 'password') form.inputs.at(-1).validity = { valid: false };
    const result = await form.act();
    assert.equal(result.submitted, false);
    assert.match(result.message, new RegExp(reason));
    assert.equal(result.message.includes(details.password), false);
    assert.equal(form.clicks(), 0);
  }
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

const phoneInput = { phoneMode: true, phone: '+12025550199', phoneSubmitted: false };
test('phone signup fills the reserved number once and never exposes it in observation signatures', async () => {
  const form = fixture({ text: 'Add your phone number', inputs: [{ name: 'phone_number', type: 'tel' }], buttons: [{ innerText: 'Send code' }] });
  const observed = await form.run({ mode: 'observe', ...phoneInput });
  assert.equal(observed.stage, 'phone-number');
  assert.equal((await form.act(phoneInput)).submitted, true);
  assert.equal(form.inputs[0].value, phoneInput.phone);
  assert.equal(observed.signature.includes(phoneInput.phone), false);
  assert.equal((await form.act(phoneInput)).submitted, false);
  assert.equal(form.clicks(), 1);
});
test('sms codes require the saved number or its masked suffix and a prior confirmed number submission', async () => {
  for (const recipient of ['+1 (202) 555-0199', '******0199', '+12025550222']) {
    const form = fixture({ text: `Enter the SMS confirmation code sent to ${recipient}`, inputs: [{ name: 'sms_code', autocomplete: 'one-time-code' }], buttons: [{ innerText: 'Confirm' }] });
    const input = { ...phoneInput, phoneSubmitted: true, code: '654321' };
    const observed = await form.run({ mode: 'observe', ...input });
    assert.equal(observed.canSubmit, recipient !== '+12025550222', recipient);
    assert.equal((await form.act(input)).submitted, recipient !== '+12025550222', recipient);
  }
  const form = fixture({ text: 'Enter the SMS code sent to +12025550199', inputs: [{ name: 'sms_code' }], buttons: [{ innerText: 'Confirm' }] });
  assert.equal((await form.act({ ...phoneInput, code: '654321' })).submitted, false);
});
test('phone automation pauses on security checkpoints, unknown country pickers, edited numbers and cancellation', async () => {
  for (const kind of ['security', 'checkpoint', 'country', 'edited', 'cancel']) {
    const form = fixture({ text: kind === 'security' ? 'Security check: verify your phone' : 'Add your phone number', url: kind === 'checkpoint' ? 'https://www.instagram.com/challenge/' : undefined, inputs: [{ name: 'phone_number', type: 'tel', _value: kind === 'edited' ? '+12025550222' : '' }], selects: kind === 'country' ? [{ name: 'country' }] : [], buttons: [{ innerText: 'Send code' }], onEvent: () => { if (kind === 'cancel') form.cancel(); } });
    assert.equal((await form.act(phoneInput)).submitted, false, kind);
    assert.equal(form.clicks(), 0, kind);
  }
});
