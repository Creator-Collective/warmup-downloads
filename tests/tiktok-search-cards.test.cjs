const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./fixtures/tiktok-comment-composer.cjs');
const id = 'https://www.tiktok.com/@creator/video/123/';

function grid(type = 'top') {
  const page = fixture({ href: `https://www.tiktok.com/search${type === 'video' ? '/video' : ''}?q=personal%20brand` });
  // Observed September 19: search_top-item and search_video-item wrap the
  // media link, inside their corresponding item-list containers.
  page.article.attrs['data-e2e'] = `search_${type}-item`;
  return page;
}
for (const type of ['top', 'video']) test(`TikTok ${type} result cards expose exact search membership, not a viewer`, () => {
  const page = grid(type);
  const result = page.inspect();
  assert.equal(result.post, null);
  assert.equal(result.search.term, 'personal brand');
  assert.deepEqual(Array.from(result.search.posts), [id]);
  assert.deepEqual(page.clicks, []);
});

test('search membership excludes loose links, hidden cards and hidden media links', () => {
  for (const change of [
    page => { delete page.article.attrs['data-e2e']; },
    page => { page.article.hidden = true; },
    page => { page.link.hidden = true; },
    page => { page.article.attrs['aria-hidden'] = 'true'; },
  ]) {
    const page = grid(); change(page);
    assert.deepEqual(Array.from(page.inspect().search.posts), []);
  }
});

test('search membership excludes sidebar, comment and ambiguous multi-post cards', () => {
  for (const change of [
    page => { page.article.tagName = 'ASIDE'; },
    page => { page.article.tagName = 'NAV'; },
    page => { page.article.attrs.class = 'DivCommentContentContainer'; },
    page => { page.article.append(page.element('a', { href: 'https://www.tiktok.com/@different/video/999/' }, 'recommended')); },
  ]) {
    const page = grid(); change(page);
    assert.deepEqual(Array.from(page.inspect().search.posts), []);
  }
});

test('rendered offscreen result cards are retained but offscreen viewer recommendations are not trusted', () => {
  const page = grid();
  page.article.bounds = page.rect(0, 1000, 750, 650);
  page.link.bounds = page.rect(350, 1110, 200, 30);
  assert.deepEqual(Array.from(page.inspect().search.posts), [id]);
  page.main.attrs.role = 'dialog';
  assert.equal(page.inspect().search, undefined);
});

test('a visible non-video dialog prevents hidden search results granting relevance', () => {
  const page = grid();
  page.body.append(page.element('div', { role: 'dialog' }, 'choose your settings'));
  assert.equal(page.inspect().search, undefined);
});

test('post permalinks, profiles, feeds, missing query and long queries never emit search membership', () => {
  for (const href of [id + '?q=personal%20brand', 'https://www.tiktok.com/@creator?q=personal%20brand', 'https://www.tiktok.com/foryou?q=personal%20brand', 'https://www.tiktok.com/search', 'https://www.tiktok.com/search?q=', 'https://www.tiktok.com/search?q=' + 'a'.repeat(61)]) {
    const page = fixture({ href }); page.article.attrs['data-e2e'] = 'search_top-item';
    assert.equal(page.inspect().search, undefined);
  }
});

test('search membership is bounded even for a very large result grid', () => {
  const page = grid();
  for (let i = 0; i < 520; i++) {
    const card = page.element('div', { 'data-e2e': 'search_top-item' });
    card.append(page.element('a', { href: `https://www.tiktok.com/@creator/video/${1000 + i}/` }));
    page.main.append(card);
  }
  assert.equal(page.inspect().search.posts.length, 500);
});
