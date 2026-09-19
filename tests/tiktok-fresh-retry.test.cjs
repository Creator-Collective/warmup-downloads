const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { fixture } = require('./fixtures/tiktok-comment-composer.cjs');
const { platformURL } = require('../browser-extension/guards.js');

const source = fs.readFileSync(path.join(__dirname, '../browser-extension/runner.js'), 'utf8');
const functionSource = name => {
  const start = source.indexOf(`function ${name}(`);
  const asyncStart = source.slice(start - 6, start) === 'async ' ? start - 6 : start;
  const end = source.indexOf('\n}', start) + 2;
  return source.slice(asyncStart, end);
};

function confirmation({ action = 'like', failAt = 'files', failures = 1, error = 'Frame with ID 0 was removed.', onFailure, deadline = 30000 } = {}) {
  const fresh = fixture();
  fresh.like.attrs['aria-pressed'] = 'true';
  fresh.follow.ownText = 'Following';
  const request = { id: fresh.inspect().post.id, author: '@creator' };
  const tab = { id: 81, url: request.id, status: 'complete' };
  const injections = [], removed = [], created = [];
  const controller = new AbortController();
  let now = 1000, failureCount = 0;
  const job = { deadline };
  const context = vm.createContext({
    URL, platformURL, controller, job, Date: { now: () => now },
    assertRunning() { controller.signal.throwIfAborted(); if (now >= job.deadline) throw new Error('session expired'); },
    platformConfig: () => ({ platform: 'tiktok', script: 'tiktok.js', inspector: 'inspectTikTok', validPost: value => value === request.id }),
    sleep: async ms => { controller.signal.throwIfAborted(); now += ms; },
    chrome: {
      tabs: {
        create: async options => { created.push(options); return { ...tab }; },
        get: async () => ({ ...tab }),
        remove: async id => { removed.push(id); }
      },
      scripting: {
        executeScript: async input => {
          injections.push(input);
          if ((input.files ? 'files' : 'inspect') === failAt && failureCount < failures) {
            failureCount++;
            onFailure?.({ controller, tab, job, fresh, advance: ms => { now += ms; } });
            throw new Error(error);
          }
          if (input.files) { fresh.load(); return [{ result: null }]; }
          return [{ result: fresh.inject(input.func, input.args) }];
        }
      }
    }
  });
  // Use the real inspector and confirmation transport, with a virtual clock and
  // read-only Chrome API boundary. No engagement action is sent by this helper.
  fresh.context.Date = { now: () => now };
  vm.runInContext([functionSource('sameDestination'), functionSource('transientPageError'), functionSource('verifyEngagementOnFreshPost')].join('\n'), context);
  return { fresh, request, tab, controller, injections, removed, created, run: () => context.verifyEngagementOnFreshPost(action, request), now: () => now };
}

for (const action of ['like', 'follow']) {
  for (const failAt of ['files', 'inspect']) {
    test(`TikTok ${action} confirms after a transient fresh-page ${failAt} race without another action`, async () => {
      const h = confirmation({ action, failAt });
      assert.equal(await h.run(), true);
      assert.equal(h.created.length, 1);
      assert.equal(h.created[0].active, false);
      assert.deepEqual(h.removed, [81]);
      assert.deepEqual(h.fresh.clicks, []);
      assert.ok(h.injections.filter(input => (input.files ? 'files' : 'inspect') === failAt).length >= 2);
      assert.ok(h.injections.every(input => !input.args || input.args[2] === action));
    });
  }
}

test('fresh-page retries end at the original eight-second deadline', async () => {
  const h = confirmation({ failures: Infinity });
  assert.equal(await h.run(), false);
  assert.equal(h.now(), 9000);
  assert.equal(h.injections.length, 16);
  assert.deepEqual(h.fresh.clicks, []);
  assert.deepEqual(h.removed, [81]);
});

test('an arbitrary fresh-page read error remains unconfirmed without retry', async () => {
  const h = confirmation({ error: 'Cannot access contents of the page.' });
  assert.equal(await h.run(), false);
  assert.equal(h.injections.length, 1);
  assert.deepEqual(h.removed, [81]);
});

test('Stop during a transient fresh-page error prevents retry and still cleans up its tab', async () => {
  const h = confirmation({ onFailure: ({ controller }) => controller.abort(new Error('session stopped')) });
  await assert.rejects(h.run(), /session stopped/);
  assert.equal(h.injections.length, 1);
  assert.deepEqual(h.removed, [81]);
});

test('the session deadline during a transient error prevents retry', async () => {
  const h = confirmation({ deadline: 1500, onFailure: ({ advance }) => advance(500) });
  await assert.rejects(h.run(), /session expired/);
  assert.equal(h.injections.length, 1);
  assert.deepEqual(h.removed, [81]);
});

test('a changed fresh tab after a transient error is neither inspected again nor closed', async () => {
  const h = confirmation({ onFailure: ({ tab }) => { tab.pendingUrl = 'https://example.com/'; } });
  assert.equal(await h.run(), false);
  assert.equal(h.injections.length, 1);
  assert.deepEqual(h.removed, []);
});

test('a restriction appearing after a transient race still stops confirmation', async () => {
  const h = confirmation({ onFailure: ({ fresh }) => {
    fresh.body.append(fresh.element('p', {}, 'You are following too fast', fresh.rect(0, 700, 500, 30)));
  } });
  await assert.rejects(h.run(), /tiktok limited activity/);
  assert.deepEqual(h.fresh.clicks, []);
  assert.deepEqual(h.removed, [81]);
});
