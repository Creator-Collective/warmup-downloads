const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { validateSettings, validateFocus } = require('../plan.js');
const context = vm.createContext({ setTimeout, clearTimeout, AbortController, URL });
{ const filename = path.join(__dirname, '../browser-extension/comment-writer.js'); vm.runInContext(fs.readFileSync(filename, 'utf8'), context, { filename }); }
vm.runInContext(fs.readFileSync(path.join(__dirname, '../browser-extension/session.js'), 'utf8'), context);
const { runSession, targetAction, expectedActions } = vm.runInContext('({ runSession, targetAction, expectedActions })', context);
const base = { minutes: 10, platform: 'tiktok', niche: 'study tips', enableComments: true };

test('session focus accepts only supported choices and leaves session targets unchanged', () => {
  const defaultSettings = validateSettings(base);
  assert.equal(defaultSettings.focus, 'balanced');
  assert.equal(validateFocus(), 'balanced');
  for (const focus of ['balanced', 'like', 'follow', 'comment']) {
    const settings = validateSettings({ ...base, focus });
    assert.equal(settings.focus, focus);
    for (const key of ['limits', 'weights', 'terms', 'minutes', 'pauseScale']) assert.deepEqual(settings[key], defaultSettings[key]);
  }
  for (const focus of ['likes', '', null, [], {}, true, 1, '__proto__']) assert.throws(() => validateSettings({ ...base, focus }), /session focus/);
});

test('focus wins only among eligible actions that are due and never creates a disabled target', () => {
  const settings = validateSettings(base);
  const empty = { like: 0, follow: 0, comment: 0 };
  for (const focus of ['like', 'follow', 'comment']) {
    assert.ok(expectedActions(settings, focus, 180000) > 0);
    assert.equal(targetAction(['like', 'follow', 'comment'], settings, empty, 180000, focus), focus);
    const others = ['like', 'follow', 'comment'].filter(action => action !== focus);
    assert.notEqual(targetAction(others, settings, empty, 180000, focus), focus, 'focus cannot bypass eligibility or cooldown');
    const caughtUp = { ...empty, [focus]: expectedActions(settings, focus, 180000) };
    assert.notEqual(targetAction(['like', 'follow', 'comment'], settings, caughtUp, 180000, focus), focus, 'focus cannot pull future targets forward');
  }
  assert.equal(targetAction(['like', 'follow', 'comment'], settings, empty, 0, 'comment'), null);
  const disabled = validateSettings({ ...base, customLimits: { like: 0, follow: 0, comment: 0 } });
  assert.equal(targetAction(['like', 'follow', 'comment'], disabled, empty, 180000, 'comment'), null);
});

function sessionHarness() {
  let time = 0;
  let postIndex = 0;
  let focus = 'like';
  const calls = [];
  const updates = [];
  const controller = new AbortController();
  const adapter = {
    update: patch => updates.push(patch),
    search: async () => { if (time < 120000) time = 120000; return true; },
    inspect: async () => ({ post: { id: `post-${postIndex++}`, author: `creator-${postIndex}`, text: 'study tips', caption: 'Study tips work best when you practice a little every day.', like: true, follow: true, comment: true } }),
    open: async () => true,
    leavePost: async () => {},
    scroll: async () => true,
    engage: async action => {
      calls.push({ action, time, focus });
      focus = calls.length === 1 ? 'follow' : calls.length === 2 ? 'comment' : 'balanced';
      return 'confirmed';
    },
  };
  const options = { now: () => time, random: () => .999, sleep: async ms => { time += ms; }, getFocus: () => focus };
  return { adapter, options, calls, updates, controller, time: () => time, setFocus: value => { focus = value; } };
}

test('a running session reads changed focus for later actions while preserving counts, caps and deadline', async () => {
  const h = sessionHarness();
  const settings = validateSettings({ ...base, customLimits: { like: 3, follow: 3, comment: 2 } });
  const before = structuredClone(settings);
  const stats = await runSession(settings, h.adapter, h.controller.signal, h.options);
  assert.deepEqual(h.calls.slice(0, 3).map(call => call.action), ['like', 'follow', 'comment']);
  assert.deepEqual(h.calls.slice(0, 3).map(call => call.focus), ['like', 'follow', 'comment']);
  for (const action of ['like', 'follow', 'comment']) {
    assert.equal(stats[action], h.calls.filter(call => call.action === action).length);
    assert.ok(stats[action] <= settings.limits[action]);
  }
  assert.deepEqual(settings, before, 'changing focus must not mutate initial settings or targets');
  assert.ok(h.calls.every(call => call.time < 600000));
  assert.equal(h.updates.at(-1).deadline, 600000);
  assert.equal(h.updates.at(-1).remainingMs, 0);
  assert.match(h.updates.at(-1).message, /session is complete/);
});

test('focusing a metric does not remove its cooldown or exceed its limit', async () => {
  const h = sessionHarness();
  h.options.getFocus = () => 'follow';
  const settings = validateSettings({ ...base, customLimits: { like: 0, follow: 3, comment: 0 } });
  const stats = await runSession(settings, h.adapter, h.controller.signal, h.options);
  assert.equal(stats.follow, 3);
  assert.equal(h.calls.length, 3);
  for (let index = 1; index < h.calls.length; index++) assert.ok(h.calls[index].time - h.calls[index - 1].time >= 18000);
});

test('a focus change never re-enables a zero target or starts another action after Stop', async () => {
  const h = sessionHarness();
  h.options.getFocus = () => 'comment';
  h.adapter.engage = async action => {
    h.calls.push({ action, time: h.time() });
    h.controller.abort();
    return 'confirmed';
  };
  const stats = await runSession(validateSettings({ ...base, customLimits: { like: 1, follow: 0, comment: 0 } }), h.adapter, h.controller.signal, h.options);
  assert.deepEqual(h.calls.map(call => call.action), ['like']);
  assert.equal(stats.like, 1);
  assert.equal(stats.comment, 0);
  assert.match(h.updates.at(-1).message, /session stopped/);
});
