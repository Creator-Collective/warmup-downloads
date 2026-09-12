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


test('tiktok comment history canonicalizes exact video links and normalizes their matching authors', () => {
  const { normalize } = require('../comment-history.js');
  const comments = normalize([
    entry({ url: 'https://tiktok.com/@creator.name_1/video/123', author: '@creator.name_1', status: 'uncertain' }),
    entry({ url: 'https://www.tiktok.com/@other/video/456/', author: '/@other/' }),
    entry({ url: 'https://www.tiktok.com/@third/video/789', author: undefined }),
    entry({ url: 'https://www.tiktok.com/@fourth/video/987', author: '@FOURTH' }),
  ]);
  assert.deepEqual(comments.map(({ url, author, status }) => ({ url, author, status })), [
    { url: 'https://www.tiktok.com/@creator.name_1/video/123/', author: 'creator.name_1', status: 'uncertain' },
    { url: 'https://www.tiktok.com/@other/video/456/', author: 'other', status: 'confirmed' },
    { url: 'https://www.tiktok.com/@third/video/789/', author: 'third', status: 'confirmed' },
    { url: 'https://www.tiktok.com/@fourth/video/987/', author: 'fourth', status: 'confirmed' },
  ]);
});

test('comment history deduplicates post aliases within each platform without losing cross-platform posts', () => {
  const { normalize } = require('../comment-history.js');
  const comments = normalize([
    entry({ url: 'https://www.instagram.com/p/123/' }),
    entry({ url: 'https://instagram.com/reel/123' }),
    entry({ url: 'https://tiktok.com/@creator/video/123', author: '@creator', status: 'uncertain' }),
    entry({ url: 'https://www.tiktok.com/@creator/video/123/', author: 'creator' }),
  ]);
  assert.equal(comments.length, 2);
  assert.equal(comments[0].url, 'https://www.instagram.com/p/123/');
  assert.equal(comments[1].url, 'https://www.tiktok.com/@creator/video/123/');
  assert.equal(comments[1].status, 'uncertain');
});

test('tiktok history rejects off-platform and ambiguous URLs, false authors, and unposted drafts', () => {
  const { normalize } = require('../comment-history.js');
  const unsafeURLs = [
    'http://www.tiktok.com/@creator/video/123',
    'https://tiktok.com.evil.test/@creator/video/123',
    'https://www.tiktok.com@evil.test/@creator/video/123',
    'https://name:secret@www.tiktok.com/@creator/video/123',
    'https://www.tiktok.com:444/@creator/video/123',
    'https://www.tiktok.com/@creator/video/123?redirect=https://evil.test',
    'https://www.tiktok.com/@creator/video/123#comment',
    'https://www.tiktok.com/@creator/photo/not-a-photo',
    'https://www.tiktok.com/@creator/video/not-a-video',
    'https://www.tiktok.com/@%63reator/video/123',
    'https://www.tiktok.com/@creator/video/123/extra',
    'https://www.tiktok.com/@creator-name/video/123',
    'https://www.tiktok.com/@' + 'a'.repeat(31) + '/video/123',
    'javascript:alert(1)',
  ];
  for (const url of unsafeURLs) assert.deepEqual(normalize([entry({ url, author: '@creator' })]), [], url);
  const url = 'https://www.tiktok.com/@creator/video/123/';
  for (const author of ['@someone_else', '@@creator', '<img src=x>', 'creator/other']) {
    assert.deepEqual(normalize([entry({ url, author })]), [], author);
  }
  for (const status of ['draft', 'skipped', 'draft-retained']) {
    assert.deepEqual(normalize([entry({ url, author: '@creator', status })]), [], status);
  }
});

test('tiktok comments render one author marker, plain text and separate confirmed outcomes', () => {
  const { render } = require('../comment-history.js');
  const document = documentFixture();
  const text = '<script>alert(1)</script> this is the exact comment';
  render(document, [
    entry({ url: 'https://tiktok.com/@creator/video/123', author: '@creator', text }),
    entry({ url: 'https://www.tiktok.com/@other/video/456/', author: '@other', status: 'uncertain' }),
  ]);
  const rows = document.getElementById('comments').children;
  assert.equal(rows.length, 2);
  assert.equal(rows[0].children[0].children[0].textContent, "@creator's post");
  assert.equal(rows[0].children[0].children[0].href, 'https://www.tiktok.com/@creator/video/123/');
  assert.equal(rows[0].children[1].textContent, text);
  assert.equal(rows[0].children[0].children[1].textContent, 'posted');
  assert.equal(rows[1].children[0].children[1].textContent, 'not confirmed');
});


test('photo comment history retains confirmed and uncertain links without merging video identities', () => {
  const { normalize } = require('../comment-history.js');
  const result = normalize([
    entry({ url: 'https://tiktok.com/@creator/photo/123', author: '@creator' }),
    entry({ url: 'https://www.tiktok.com/@creator/photo/123/', author: '@creator' }),
    entry({ url: 'https://www.tiktok.com/@creator/video/123/', author: '@creator' }),
    entry({ url: 'https://www.tiktok.com/@other/photo/456/', author: '@other', status: 'uncertain' }),
  ]);
  assert.equal(result.length, 3);
  assert.equal(result[0].url, 'https://www.tiktok.com/@creator/photo/123/');
  assert.equal(result[0].status, 'confirmed');
  assert.equal(result[2].status, 'uncertain');
  assert.deepEqual(normalize([entry({ url: 'https://www.tiktok.com/@creator/photo/123/', author: '@different' })]), []);
});
