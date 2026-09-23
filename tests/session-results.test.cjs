const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { render } = require('../session-results.js');

function view(prefix = 'stat-') {
  return new JSDOM(`<h2 id="activity-heading"></h2><div>${['scroll','like','follow','comment'].map(action => `<b id="${prefix}${action}"></b>`).join('')}</div><p id="session-results-note" hidden></p>`).window.document;
}

test('successful tiktok results include confirmed follows without an uncertainty message', () => {
  for (const prefix of ['stat-', '']) {
    const document = view(prefix);
    render(document, {phase:'complete',settings:{platform:'tiktok',limits:{like:3,follow:2,comment:1}},stats:{scroll:12,like:3,follow:2,comment:1}}, prefix);
    assert.equal(document.getElementById(`${prefix}follow`).textContent,'2 / 2');
    assert.equal(document.getElementById(`${prefix}comment`).textContent,'1 / 1');
    assert.equal(document.getElementById('activity-heading').textContent,'tiktok results');
    assert.equal(document.getElementById('session-results-note').hidden,true);
  }
});

test('unconfirmed actions and retained drafts remain distinct from confirmed counts', () => {
  const document = view();
  render(document,{phase:'stopped',settings:{platform:'tiktok',limits:{like:4,follow:2,comment:2}},stats:{like:2,follow:0,comment:1},unconfirmed:{like:2,follow:1},pausedActions:['comment']});
  assert.equal(document.getElementById('stat-follow').textContent,'0 / 2');
  assert.equal(document.getElementById('session-results-note').textContent,'2 likes not confirmed. 1 follow not confirmed. comments paused after a draft problem. check the comment box in your platform tab.');
  assert.equal(document.getElementById('session-results-note').hidden,false);
  render(document,{phase:'running',settings:{platform:'instagram',limits:{like:0,follow:0,comment:0}},stats:{}});
  assert.equal(document.getElementById('session-results-note').hidden,true);
  assert.equal(document.getElementById('session-results-note').textContent,'');
  assert.equal(document.getElementById('activity-heading').textContent,'instagram session');
});

test('completed sessions below a target explain that targets are upper limits', () => {
  const document = view();
  render(document,{phase:'complete',settings:{platform:'instagram',limits:{like:60,follow:18,comment:7}},stats:{scroll:120,like:58,follow:18,comment:6}});
  assert.equal(document.getElementById('session-results-note').textContent,'targets are upper limits. pacing and matching posts come first.');
  assert.equal(document.getElementById('session-results-note').hidden,false);
  render(document,{phase:'complete',settings:{platform:'instagram',limits:{like:4,follow:2,comment:2}},stats:{like:4,follow:1,comment:2},unconfirmed:{follow:1}});
  assert.equal(document.getElementById('session-results-note').textContent,'1 follow not confirmed. targets are upper limits. pacing and matching posts come first.');
});

test('stopped sessions and sessions at target get no upper-limit note', () => {
  const document = view();
  render(document,{phase:'stopped',settings:{platform:'instagram',limits:{like:60,follow:18,comment:7}},stats:{like:10,follow:2,comment:1}});
  assert.equal(document.getElementById('session-results-note').hidden,true);
  assert.doesNotMatch(document.getElementById('session-results-note').textContent,/upper limits/);
  render(document,{phase:'complete',settings:{platform:'instagram',limits:{like:15,follow:5,comment:2}},stats:{like:15,follow:5,comment:2}});
  assert.equal(document.getElementById('session-results-note').hidden,true);
  render(document,{phase:'running',settings:{platform:'instagram',limits:{like:15,follow:5,comment:2}},stats:{like:1}});
  assert.equal(document.getElementById('session-results-note').hidden,true);
});

test('older stored sessions remain readable and invalid counts do not render', () => {
  const document = view();
  render(document,{stats:{scroll:5,like:2,follow:NaN,comment:-1},unconfirmed:{like:'2',follow:Infinity,comment:-1}});
  assert.equal(document.getElementById('stat-scroll').textContent,'5');
  assert.equal(document.getElementById('stat-like').textContent,'2');
  assert.equal(document.getElementById('stat-follow').textContent,'0');
  assert.equal(document.getElementById('stat-comment').textContent,'0');
  assert.equal(document.getElementById('session-results-note').hidden,true);
});
