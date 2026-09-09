const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const entry = (patch = {}) => ({ text: 'this part stood out: "a useful idea for your personal branding"', url: 'https://www.instagram.com/p/example/', author: '/creator/', time: 100000, status: 'confirmed', ...patch });
function documentFixture() {
  const nodes = new Map();
  const create = tag => ({ tag, textContent: '', hidden: false, dataset: {}, children: [], scrollTop: 0, replacements: 0, append(...children) { this.children.push(...children); }, replaceChildren(...children) { this.children = children; this.replacements++; this.scrollTop = 0; } });
  return { createElement: create, getElementById(id) { if (!nodes.has(id)) nodes.set(id, create('div')); return nodes.get(id); } };
}

test('comment history validates links and statuses, bounds storage, and strips private fields', () => {
  const { normalize } = require('../comment-history.js');
  const result = normalize([entry({ token: 'private', caption: 'not needed' }), entry({ url: 'https://www.instagram.com/reel/example/' }), entry({ url: 'javascript:alert(1)' }), entry({ url: 'https://instagram.com.evil.test/p/abc/' }), entry({ url: 'https://name:secret@www.instagram.com/p/abc/' }), entry({ status: 'draft' }), entry({ time: NaN }), entry({ text: 'x'.repeat(501) }), entry({ text: '' })]);
  assert.equal(result.length, 1);
  assert.deepEqual(Object.keys(result[0]).sort(), ['author', 'status', 'text', 'time', 'url']);
  assert.equal(result[0].author, 'creator');
  assert.equal(result[0].text, entry().text);
  assert.equal(normalize(null).length, 0);
  assert.equal(normalize(Array.from({ length: 30 }, (_, i) => entry({ url: `https://www.instagram.com/p/post${i}/` }))).length, 20);
});

test('comment history renders complete readable text, labelled outcomes and safe post links without jumping on polls', () => {
  const { render } = require('../comment-history.js');
  const document = documentFixture();
  const text = '<img src=x onerror=alert(1)> ' + 'longword'.repeat(30);
  const entries = [entry({ text }), entry({ url: 'https://www.instagram.com/p/second/', status: 'uncertain', time: 110000 })];
  render(document, entries);
  const list = document.getElementById('comments');
  assert.equal(document.getElementById('comment-history').hidden, false);
  assert.equal(list.children.length, 2);
  assert.equal(list.children[0].children[1].textContent, text);
  const meta = list.children[0].children[0].children;
  assert.equal(meta[0].tag, 'a');
  assert.equal(meta[0].href, entry().url);
  assert.equal(meta[0].textContent, "@creator's post");
  assert.equal(meta[0].target, '_blank');
  assert.match(meta[0].rel, /noopener/);
  assert.equal(meta[1].textContent, 'posted');
  assert.equal(list.children[1].children[0].children[1].textContent, 'not confirmed');
  list.scrollTop = 100;
  render(document, structuredClone(entries));
  assert.equal(list.replacements, 1);
  assert.equal(list.scrollTop, 100);
  render(document, [...entries, entry({ url: 'https://www.instagram.com/p/third/' })]);
  assert.equal(list.scrollTop, 100);
  render(document, []);
  assert.equal(document.getElementById('comment-history').hidden, true);
  assert.equal(list.children.length, 0);
});

test('every activity surface includes the shared comment history before its activity feed', () => {
  for (const file of ['index.html', 'browser-extension/runner.html']) {
    const html = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    assert.match(html, /src="comment-history.js"/);
    assert.match(html, /id="comment-history"[^>]*hidden/);
    assert.ok(html.indexOf('id="comments"') < html.indexOf('id="activity"'));
  }
  for (const file of ['dashboard.js', 'browser-extension/runner.js']) {
    assert.match(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), /commentHistory.render\(document, state.comments\)/);
  }
});
