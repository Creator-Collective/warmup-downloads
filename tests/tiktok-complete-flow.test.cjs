const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { fixture, commentComposer } = require('./fixtures/tiktok-comment-composer.cjs');
const { validateSettings } = require('../browser-extension/plan.js');
const { platforms, validPlatform, platformURL } = require('../browser-extension/guards.js');

const runner = fs.readFileSync(path.join(__dirname, '../browser-extension/runner.js'), 'utf8');
const session = fs.readFileSync(path.join(__dirname, '../browser-extension/session.js'), 'utf8');
const functionSource = name => {
  const start = runner.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  return runner.slice(runner.slice(start - 6, start) === 'async ' ? start - 6 : start, runner.indexOf('\n}', start) + 2);
};

// The browser/server boundary is deliberately local. The production session,
// DOM observer, paste/submit transport and fresh-read confirmation run unchanged.
function completeFlow({ mixedFailures = false, stopAt = Infinity, seed = 23 } = {}) {
  const controller = new AbortController();
  let time = 1000, serial = 0, page, searchIds = [], currentIndex = -1, nextTab = 80;
  const settings = validateSettings({ platform: 'tiktok', minutes: 60, niche: 'personal brand, storytelling', enableComments: true,
    customLimits: { like: 180, follow: 57, comment: 16 } });
  const job = { settings, tabId: 7, deadline: time + settings.minutes * 60000 };
  const created = [], removed = [], searches = [], attempts = [], snapshots = [], clicks = [], opened = [], recovered = [];
  const pages = new Map(), freshTabs = new Map();
  const topics = [
    'A little daily practice makes the difference.',
    'Showing your process helps explain the result.',
    'These study habits helped organize the week.',
    'Telling stories helps explain the journey.',
    'The video editing took several versions.',
    'Setting your rates takes some careful thought.',
    'Cooking this recipe took the whole afternoon.',
    'The workout has a simple training routine.',
    'Posting consistently takes a little planning.'
  ];
  const advanceTime = async ms => { controller.signal.throwIfAborted(); time += ms; };
  function prepare(index, fresh = false) {
    const id = `https://www.tiktok.com/@creator${index}/video/${10000 + index}/`;
    const h = commentComposer({ modal: true, postId: id });
    h.author.attrs.href = `https://www.tiktok.com/@creator${index}/`;
    h.author.ownText = `@creator${index}`;
    h.caption.textContent = index % 4 === 0 ? 'A useful idea for today #personalbranding' : `${topics[index % topics.length]} #personalbrand`;
    Object.assign(h.request, { author: `@creator${index}`, caption: h.caption.textContent });
    h.context.Date = { now: () => time };
    if (!fresh) {
      const record = { h, id, index, like: false, follow: false };
      for (const action of ['like', 'follow']) {
        const original = h[action].onClick;
        h[action].onClick = () => {
          clicks.push({ action, id, time });
          if (!(mixedFailures && index % 11 === 0)) { original(); record[action] = true; }
        };
      }
      const submit = h.submit.onClick;
      h.submit.onClick = () => { clicks.push({ action: 'comment', id, time }); submit(); };
      if (mixedFailures && index % 19 === 0) h.like.hidden = true;
      pages.set(id, record);
    }
    return h;
  }
  function random() { seed = Math.imul(seed, 1664525) + 1013904223 >>> 0; return seed / 4294967296; }
  const context = vm.createContext({
    URL, console, controller, job, Date: { now: () => time }, platforms, validPlatform, platformURL,
    pendingDraft: false, pendingEngagement: false, messageQueue: Promise.resolve(), sleep: advanceTime,
    chrome: {
      tabs: {
        get: async id => id === 7 ? { id, url: page.context.location.href, status: 'complete' } : freshTabs.get(id).tab,
        create: async options => {
          const record = pages.get(options.url);
          assert.ok(record, 'fresh confirmation stays on an opened post');
          const h = prepare(record.index, true);
          h.like.attrs['aria-pressed'] = String(record.like);
          h.follow.ownText = record.follow ? 'Following' : 'Follow';
          const tab = { id: ++nextTab, url: record.id, status: 'complete' };
          freshTabs.set(tab.id, { tab, h, failOnce: mixedFailures && nextTab % 7 === 0 });
          created.push({ ...options, id: tab.id });
          return tab;
        },
        remove: async id => { removed.push(id); freshTabs.delete(id); }
      },
      scripting: {
        executeScript: async input => {
          const fresh = freshTabs.get(input.target.tabId);
          if (fresh?.failOnce) { fresh.failOnce = false; recovered.push(input.target.tabId); throw new Error('Frame with ID 0 was removed.'); }
          const target = fresh?.h || page;
          if (input.files) { target.load(); return [{ result: null }]; }
          const result = await target.inject(input.func, input.args);
          if (fresh) assert.deepEqual(fresh.h.clicks, [], 'confirmation must never perform an engagement');
          return [{ result }];
        }
      }
    }
  });
  vm.runInContext([
    'currentPlatform', 'platformConfig', 'assertRunning', 'sameDestination', 'transientPageError',
    'execute', 'inspect', 'recoverCommentDraft', 'verifyEngagementOnFreshPost', 'engage', 'performEngagement'
  ].map(functionSource).join('\n'), context);
  const engineContext = vm.createContext({ URL, console });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../browser-extension/comment-writer.js'), 'utf8'), engineContext);
  vm.runInContext(session, engineContext);
  const adapter = {
    update: state => { snapshots.push({ ...state, time }); },
    search: async term => {
      searches.push({ term, time });
      searchIds = Array.from({ length: 50 }, () => `https://www.tiktok.com/@creator${++serial}/video/${10000 + serial}/`);
      currentIndex = -1;
      page = fixture({ href: `https://www.tiktok.com/search?q=${encodeURIComponent(term)}`, postId: searchIds[0] });
      page.article.attrs['data-e2e'] = 'search_top-item';
      for (const id of searchIds.slice(1)) {
        const card = page.element('div', { 'data-e2e': 'search_top-item' }, '', page.rect(0, 0, 100, 100));
        card.append(page.element('a', { href: id }, '', page.rect(0, 0, 100, 100)));
        page.main.append(card);
      }
      page.context.Date = { now: () => time };
      await advanceTime(800);
      return true;
    },
    inspect: () => context.inspect(),
    open: async id => {
      currentIndex = searchIds.indexOf(id);
      const index = Number(new URL(id).pathname.match(/creator(\d+)/)[1]);
      if (mixedFailures && currentIndex === 0 && searches.length % 5 === 0) { await advanceTime(800); return false; }
      page = prepare(index); opened.push({ id, time });
      await advanceTime(600);
      return true;
    },
    advance: async () => {
      if (++currentIndex >= searchIds.length) return false;
      const id = searchIds[currentIndex], index = Number(new URL(id).pathname.match(/creator(\d+)/)[1]);
      page = prepare(index); opened.push({ id, time });
      await advanceTime(600);
      return true;
    },
    scroll: async () => false,
    leavePost: async () => { await adapter.search(searches.at(-1).term); return true; },
    engage: async (action, post, comment) => {
      if (action === 'comment') page.request.comment = comment;
      const attempt = { action, id: post.id, time };
      attempts.push(attempt);
      attempt.result = await context.engage(action, post, comment);
      return attempt.result;
    }
  };
  return {
    settings, job, controller, created, removed, searches, attempts, snapshots, clicks, opened, recovered,
    time: () => time,
    run: () => engineContext.sessionEngine.runSession(settings, adapter, controller.signal, {
      now: () => time, random,
      sleep: async ms => {
        await advanceTime(ms);
        if (time >= stopAt) controller.abort(new Error('session stopped'));
      }
    })
  };
}

for (const mixedFailures of [false, true]) {
  test(`a local complete TikTok hour counts real fixture actions${mixedFailures ? ' while recovering from no-op clicks and page reloads' : ''}`, async t => {
    const h = completeFlow({ mixedFailures });
    const stats = await h.run();
    const last = h.snapshots.findLast(state => state.stats);
    t.diagnostic(JSON.stringify({ stats, unconfirmed: last.unconfirmed, searches: h.searches.length, freshReadRecoveries: h.recovered.length }));
    const counts = action => ({ clicks: h.clicks.filter(item => item.action === action).length,
      confirmed: h.attempts.filter(item => item.action === action && item.result === 'confirmed').length,
      uncertain: h.attempts.filter(item => item.action === action && item.result === 'uncertain').length });
    assert.equal(h.time(), h.job.deadline);
    for (const action of ['like', 'follow', 'comment']) {
      const count = counts(action);
      assert.equal(stats[action], count.confirmed);
      assert.equal(last.unconfirmed[action], count.uncertain);
      assert.equal(count.clicks, count.confirmed + count.uncertain);
      assert.ok(count.clicks <= h.settings.limits[action]);
      assert.equal(new Set(h.attempts.filter(item => item.action === action).map(item => item.id)).size, count.clicks, 'no post action is replayed');
    }
    assert.ok(stats.like >= 120, `likes continue over the hour: ${stats.like}`);
    assert.ok(stats.follow >= 35, `follows continue over the hour: ${stats.follow}`);
    assert.ok(stats.comment >= (mixedFailures ? 12 : 16), `comments keep using distinct supported captions: ${stats.comment}`);
    assert.ok(h.searches.length >= 20);
    assert.deepEqual([...new Set(h.searches.map(item => item.term))], ['personal brand', 'storytelling']);
    assert.ok(h.attempts.some(item => Number(new URL(item.id).pathname.match(/creator(\d+)/)[1]) % 4 === 0 && item.action === 'like'), 'current search members are eligible despite the personalbrand/personalbranding mismatch');
    assert.deepEqual(h.removed, h.created.map(tab => tab.id));
    assert.ok(h.created.every(tab => tab.active === false));
    if (mixedFailures) {
      assert.ok(last.unconfirmed.like + last.unconfirmed.follow > 0);
      assert.ok(h.recovered.length > 0);
      const firstUncertain = h.attempts.find(item => item.result === 'uncertain');
      assert.ok(h.attempts.some(item => item.time > firstUncertain.time && item.result === 'confirmed'));
    } else {
      assert.equal(last.unconfirmed.like + last.unconfirmed.follow + last.unconfirmed.comment, 0);
    }
  });
}

test('Stop during a local TikTok viewing pause ends the composed flow without another action', async () => {
  const h = completeFlow({ stopAt: 125000 });
  const stats = await h.run();
  const last = h.snapshots.at(-1);
  assert.equal(h.controller.signal.aborted, true);
  assert.match(last.message, /session stopped/);
  assert.ok(h.time() < h.job.deadline);
  assert.ok(h.attempts.every(attempt => attempt.time < 125000));
  assert.equal(stats.like, h.attempts.filter(item => item.action === 'like' && item.result === 'confirmed').length);
  assert.deepEqual(h.removed, h.created.map(tab => tab.id));
});
