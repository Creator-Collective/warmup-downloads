const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const script = fs.readFileSync(path.join(__dirname, '..', 'select-ui.js'), 'utf8');

function view(content = '') {
  const dom = new JSDOM(`<form><fieldset id="settings"><label id="platform-label" for="platform">platform</label><select id="platform" name="platform"><option value="instagram">instagram</option><option value="tiktok">tiktok</option><option value="disabled" disabled>unavailable</option><option value="threads">threads</option></select>${content}</fieldset></form>`, { runScripts: 'outside-only' });
  dom.window.eval(script);
  dom.window.warmupSelects.sync();
  const document = dom.window.document;
  const select = document.getElementById('platform');
  const trigger = document.querySelector('.select-trigger');
  const menu = document.querySelector('.select-menu');
  const key = value => trigger.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }));
  return { dom, document, select, trigger, menu, key };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('the native select retains its name, value and label, with a separately named combobox', () => {
  const { dom, document, select, trigger, menu } = view();
  assert.equal(document.querySelector('label').htmlFor, 'platform');
  assert.equal(trigger.getAttribute('role'), 'combobox');
  assert.equal(trigger.getAttribute('aria-labelledby'), 'platform-label');
  assert.equal(trigger.getAttribute('aria-controls'), menu.id);
  assert.equal(trigger.textContent, 'instagram');
  assert.equal(select.tabIndex, -1);
  assert.equal(new dom.window.FormData(document.querySelector('form')).get('platform'), 'instagram');
  document.querySelector('label').click();
  assert.equal(document.activeElement, trigger);
  dom.window.close();
});

test('keyboard navigation skips disabled rows, Escape cancels and Enter commits input then change', () => {
  const { dom, select, trigger, menu, key } = view();
  const events = [];
  select.addEventListener('input', () => events.push(['input', select.value]));
  select.addEventListener('change', () => events.push(['change', select.value]));
  key('ArrowDown');
  assert.equal(menu.hidden, false);
  key('ArrowDown');
  assert.equal(menu.querySelector('.is-active').textContent, 'tiktok✓');
  assert.equal(select.value, 'instagram');
  key('Escape');
  assert.equal(menu.hidden, true);
  assert.equal(select.value, 'instagram');
  key(' ');
  key('End');
  assert.equal(menu.querySelector('.is-active').textContent, 'threads✓');
  key('ArrowUp');
  assert.equal(menu.querySelector('.is-active').textContent, 'tiktok✓');
  key('Home');
  key('ArrowDown');
  key('Enter');
  assert.equal(select.value, 'tiktok');
  assert.deepEqual(events, [['input', 'tiktok'], ['change', 'tiktok']]);
  assert.equal(trigger.textContent, 'tiktok');
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(trigger.hasAttribute('aria-activedescendant'), false);
  dom.window.close();
});

test('typeahead cycles matching options and Tab commits without trapping focus', () => {
  const { dom, select, trigger, menu, key } = view();
  key('t');
  assert.equal(menu.querySelector('.is-active').textContent, 'tiktok✓');
  key('t');
  assert.equal(menu.querySelector('.is-active').textContent, 'threads✓');
  const event = new dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
  trigger.dispatchEvent(event);
  assert.equal(event.defaultPrevented, false);
  assert.equal(select.value, 'threads');
  assert.equal(menu.hidden, true);
  dom.window.close();
});

test('explicit sync mirrors programmatic values and option replacement without changing accounts or dispatching events', async () => {
  const { dom, select, trigger, menu, key } = view();
  let changes = 0;
  select.addEventListener('change', () => changes++);
  select.value = 'tiktok';
  dom.window.warmupSelects.sync();
  assert.equal(trigger.textContent, 'tiktok');
  key('Enter');
  key('End');
  const oldRow = menu.querySelectorAll('[role=option]')[3];
  select.replaceChildren(new dom.window.Option('choose a tab', ''), new dom.window.Option('different account', '900'));
  select.value = '';
  oldRow.click();
  assert.equal(select.value, '');
  await tick();
  assert.equal(trigger.textContent, 'choose a tab');
  assert.equal(changes, 0);
  key('Enter');
  assert.equal(menu.querySelectorAll('[role=option]').length, 2);
  assert.equal(menu.querySelector('[aria-selected=true]').textContent, 'choose a tab✓');
  dom.window.close();
});

test('a disabled fieldset closes the menu and prevents a stale click or key from choosing an account', async () => {
  const { dom, document, select, trigger, menu, key } = view();
  key('Enter');
  const tiktokRow = menu.querySelectorAll('[role=option]')[1];
  document.getElementById('settings').disabled = true;
  tiktokRow.click();
  key('End');
  key('Enter');
  assert.equal(select.value, 'instagram');
  await tick();
  assert.equal(trigger.disabled, true);
  assert.equal(menu.hidden, true);
  document.getElementById('settings').disabled = false;
  await tick();
  assert.equal(trigger.disabled, false);
  dom.window.close();
});

test('option labels are plain text, label attributes render, and hidden options are excluded', async () => {
  const { dom, select, trigger, menu } = view();
  const hostile = '<img src=x onerror="window.executed=true">';
  select.replaceChildren(new dom.window.Option(hostile, 'hostile'), new dom.window.Option('hidden', 'hidden'));
  select.options[1].hidden = true;
  select.value = 'hostile';
  await tick();
  assert.equal(trigger.textContent, hostile);
  assert.equal(menu.querySelector('img'), null);
  assert.equal(menu.querySelectorAll('[role=option]').length, 1);
  assert.equal(dom.window.executed, undefined);
  select.options[0].label = 'renamed tab';
  await tick();
  assert.equal(trigger.textContent, 'renamed tab');
  dom.window.close();
});

test('outside pointer presses close the popup and placement fits a narrow viewport above the trigger', () => {
  const { dom, document, trigger, menu } = view();
  Object.defineProperty(dom.window, 'innerWidth', { value: 320 });
  Object.defineProperty(dom.window, 'innerHeight', { value: 300 });
  trigger.getBoundingClientRect = () => ({ left: 280, right: 700, width: 420, top: 250, bottom: 288 });
  trigger.click();
  assert.equal(menu.dataset.placement, 'top');
  assert.equal(parseFloat(menu.style.width), 304);
  assert.equal(parseFloat(menu.style.left), 8);
  assert.ok(parseFloat(menu.style.top) >= 8);
  assert.ok(parseFloat(menu.style.maxHeight) <= 236);
  document.body.dispatchEvent(new dom.window.Event('pointerdown', { bubbles: true }));
  assert.equal(menu.hidden, true);
  dom.window.close();
});

test('the custom trigger receives native validation focus and form reset restores its label', async () => {
  const { dom, document, select, trigger } = view();
  select.replaceChildren(new dom.window.Option('choose', '', true, true), new dom.window.Option('tiktok', 'tiktok'));
  select.required = true;
  dom.window.warmupSelects.sync();
  assert.equal(document.querySelector('form').checkValidity(), false);
  assert.equal(document.activeElement, trigger);
  assert.equal(trigger.getAttribute('aria-invalid'), 'true');
  select.value = 'tiktok';
  dom.window.warmupSelects.sync();
  assert.equal(trigger.hasAttribute('aria-invalid'), false);
  document.querySelector('form').reset();
  await tick();
  assert.equal(trigger.textContent, 'choose');
  dom.window.close();
});

test('an implicit wrapping label remains named without mutation feedback loops', async () => {
  const dom = new JSDOM('<label>pace<select><option>automatic</option><option>slow</option></select></label>', { runScripts: 'outside-only' });
  dom.window.eval(script);
  dom.window.warmupSelects.sync();
  await tick();
  const label = dom.window.document.querySelector('label');
  assert.equal(dom.window.document.querySelector('.select-trigger').getAttribute('aria-labelledby'), label.id);
  label.firstChild.textContent = 'speed';
  await tick();
  assert.equal(dom.window.document.querySelectorAll('.select-trigger').length, 1);
  dom.window.close();
});


test('popup height includes its borders without overflowing the available viewport', () => {
  const { dom, trigger, menu } = view();
  Object.defineProperties(menu, {
    scrollHeight: { value: 82 },
    offsetHeight: { value: 84 },
    clientHeight: { value: 82 }
  });
  Object.defineProperty(dom.window, 'innerHeight', { value: 200 });
  trigger.getBoundingClientRect = () => ({ left: 20, width: 200, top: 12, bottom: 50 });
  trigger.click();
  assert.equal(menu.style.maxHeight, '84px');
  trigger.getBoundingClientRect = () => ({ left: 20, width: 200, top: 92, bottom: 130 });
  dom.window.dispatchEvent(new dom.window.Event('resize'));
  assert.equal(menu.dataset.placement, 'top');
  assert.equal(menu.style.maxHeight, '78px');
  dom.window.close();
});
