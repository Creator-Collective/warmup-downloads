const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

// Modelled instagram desktop markup (not a capture of the live site) with a stubbed
// layout: elements with data-r get that rect, elements under data-hidden get none.
const source = fs.readFileSync(path.join(__dirname, '../browser-extension/instagram.js'), 'utf8');

const sidebar = ({ user = 'me', collapsed = false, lang = 'en', avatarAlt } = {}) => {
  const alt = avatarAlt ?? (lang === 'es' ? `Foto del perfil de ${user}` : `${user}'s profile picture`);
  const text = collapsed ? '' : `<span>${lang === 'es' ? 'Perfil' : 'Profile'}</span>`;
  const item = (href, name) => `<a href="${href}">${collapsed ? '' : `<span>${name}</span>`}</a>`;
  return `<div class="nav">${item('/', 'Home')}${item('/explore/', 'Explore')}${item('/reels/', 'Reels')}${item('/direct/inbox/', 'Messages')}<a href="/${user}/"><img alt="${alt}" data-r="10,600,24,24">${text}</a></div>`;
};
const dialog = ({ caption = 'Baking sourdough for the first time and it actually rose!!', captionTag = 'h1', lang = 'en', textareas = 1, noTextarea = false, placeholder = true } = {}) => {
  const hint = lang === 'es' ? 'Agrega un comentario...' : 'Add a comment…';
  const attributes = placeholder ? ` aria-label="${hint}" placeholder="${hint}"` : '';
  const areas = noTextarea ? '' : Array.from({ length: textareas }, (_, index) =>
    `<form data-r="600,${700 - index * 40},380,40"><textarea${attributes} data-r="610,${705 - index * 40},300,30"></textarea><div role="button" data-r="920,${705 - index * 40},40,30">Post</div></form>`).join('');
  const heading = caption ? `<${captionTag} dir="auto" data-r="650,90,300,40">${caption}</${captionTag}>` : '';
  return `<div role="dialog" data-r="100,20,900,740"><article data-r="120,30,880,720"><img alt="Photo by creator" data-r="120,30,480,700"><a href="/creator/" data-r="650,40,80,20">creator</a><div role="button" data-r="760,40,50,20">Follow</div>${heading}<a href="/p/ABC/" data-r="650,650,40,12">1h</a><section data-r="600,600,380,40"><div role="button" data-r="610,610,24,24"><svg aria-label="Like"></svg></div><div role="button" data-r="640,610,24,24"><svg aria-label="Comment"></svg></div><div role="button" data-r="950,610,24,24"><svg aria-label="Save"></svg></div></section>${areas}</article></div>`;
};
const main = (inner = '<div>search results grid</div>') => `<main role="main">${inner}</main>`;
const drawer = '<div class="drawer"><a href="/alice/"><img alt="alice\'s profile picture"></a><a href="/bob/"><img alt="bob\'s profile picture"></a></div>';

function page(body, { url = 'https://www.instagram.com/p/ABC/', lang, head = '' } = {}) {
  const dom = new JSDOM(`<!doctype html><html${lang ? ` lang="${lang}"` : ''}><head>${head}</head><body>${body}</body></html>`, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  const rects = new Map();
  for (const element of window.document.querySelectorAll('[data-r]')) {
    const [left, top, width, height] = element.getAttribute('data-r').split(',').map(Number);
    rects.set(element, { left, top, width, height, right: left + width, bottom: top + height });
  }
  const rectOf = element => rects.get(element) || (element.closest('[data-hidden]')
    ? { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }
    : { left: 1, top: 1, width: 10, height: 10, right: 11, bottom: 11 });
  window.Element.prototype.getBoundingClientRect = function () { return rectOf(this); };
  window.document.elementFromPoint = (x, y) => [...rects.entries()]
    .filter(([element, rect]) => !element.closest('[data-hidden]') && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom)
    .sort((a, b) => a[1].width * a[1].height - b[1].width * b[1].height)[0]?.[0] || null;
  window.innerWidth = 1280; window.innerHeight = 800;
  window.eval(source);
  return { window, document: window.document, inspect: (request = {}) => window.inspectInstagram(request) };
}
const plain = value => JSON.parse(JSON.stringify(value));

test('the own profile link and comment box are found across sidebar layouts', () => {
  for (const [name, body, options, expected] of [
    ['A expanded sidebar', sidebar() + main() + dialog(), {}, { comment: true }],
    ['B collapsed sidebar', sidebar({ collapsed: true }) + main() + dialog(), {}, { comment: true }],
    ['C hidden duplicate nav', sidebar() + `<div data-hidden style="display:none">${sidebar({ collapsed: true })}</div>` + main() + dialog(), {}, { comment: true }],
    ['D same-href avatar twice', sidebar() + '<header><a href="/me/"><img alt="me\'s profile picture"></a></header>' + main() + dialog(), {}, { comment: true }],
    ['E spanish ui with html lang', sidebar({ lang: 'es' }) + main() + dialog({ lang: 'es' }), { lang: 'es' }, { comment: false, commentBlocker: 'language' }],
    ['E spanish ui without a lang attribute', sidebar({ lang: 'es' }) + main() + dialog({ lang: 'es' }), {}, { comment: false, commentBlocker: 'account' }],
    ['F curly apostrophe', sidebar({ collapsed: true, avatarAlt: 'me’s profile picture' }) + main() + dialog(), {}, { comment: true }],
    ['G no caption', sidebar() + main() + dialog({ caption: '' }), {}, { comment: true, caption: '' }],
    ['H span caption', sidebar() + main() + dialog({ captionTag: 'span' }), {}, { comment: true, caption: '' }],
    ['I two textareas', sidebar() + main() + dialog({ textareas: 2 }), {}, { comment: false, commentBlocker: 'composer' }],
    ['J no textarea', sidebar() + main() + dialog({ noTextarea: true }), {}, { comment: false, commentBlocker: 'composer' }],
    ['K sidebar inside main', main(`${sidebar()}<div>grid</div>`) + dialog(), {}, { comment: true }],
    ['L drawer and collapsed sidebar', sidebar({ collapsed: true }) + drawer + main() + dialog(), {}, { comment: false, commentBlocker: 'account' }],
    ['M drawer and expanded sidebar', sidebar() + drawer + main() + dialog(), {}, { comment: true }],
    ['N2 two strong links for different users', sidebar() + sidebar({ user: 'other' }) + main() + dialog(), {}, { comment: false, commentBlocker: 'account' }],
    ['O avatar-only own link inside main', sidebar({ collapsed: true, avatarAlt: 'x' }) + main('<a href="/me/"><img alt="me\'s profile picture"></a>') + dialog(), {}, { comment: false, commentBlocker: 'account' }],
    ['P sole placeholder-free textarea in a form with post', sidebar() + main() + dialog({ placeholder: false }), {}, { comment: true }]
  ]) {
    const { post } = page(body, options).inspect();
    assert.ok(post, name);
    assert.equal(post.comment, expected.comment, name);
    if (expected.comment) assert.equal(post.commentBlocker, undefined, name);
    else assert.equal(post.commentBlocker, expected.commentBlocker, name);
    if ('caption' in expected) assert.equal(post.caption, expected.caption, name);
    assert.equal(post.like, true, name);
    assert.equal(post.follow, true, name);
  }
});

test('the own profile path always keeps the comment-row author format', () => {
  const h = page(sidebar() + main() + dialog());
  const field = h.inspect({ id: 'https://www.instagram.com/p/ABC/', author: '/creator/', caption: 'Baking sourdough for the first time and it actually rose!!', comment: 'this is so good', action: 'comment-field' });
  assert.ok(field.point);
  assert.equal(h.window.collectiveCommentBefore.author, '/me/');
  h.window.collectiveCommentBefore.release();
});

test('keyword grids report their own query and posts, and only non-explore viewers report the grid behind them', () => {
  const grid = '<a href="/p/A1/">a</a><a href="/p/A2/">b</a><a href="/p/A1/">a again</a><a href="/reel/R1/">c</a><a href="/someone/">profile</a>';
  const expected = ['https://www.instagram.com/p/A1/', 'https://www.instagram.com/p/A2/', 'https://www.instagram.com/reel/R1/'];
  const results = page(sidebar() + main(grid), { url: 'https://www.instagram.com/explore/search/keyword/?q=ugc%20creator' }).inspect();
  assert.equal(results.post, null);
  assert.deepEqual(plain(results.search), { term: 'ugc creator', posts: expected });
  const viewer = page(sidebar() + main(grid) + dialog()).inspect();
  assert.ok(viewer.post);
  assert.equal(viewer.search.behindViewer, true);
  assert.equal(viewer.search.term, null);
  assert.deepEqual(plain(viewer.search.posts), expected);
  for (const url of ['https://www.instagram.com/explore/search/keyword/?q=ugc%20creator', 'https://www.instagram.com/explore/']) {
    assert.equal(page(sidebar() + main(grid) + dialog(), { url }).inspect().search, undefined, url);
  }
});

test('page meta text is used only when it names this post, without its counts prefix', () => {
  const meta = (url, description) => `<meta property="og:url" content="${url}"><meta property="og:description" content='${description}'>`;
  const body = sidebar() + main() + dialog({ caption: '' });
  const stale = page(body, { head: meta('https://www.instagram.com/p/OTHER/', 'a stale caption from another post') }).inspect().post;
  assert.doesNotMatch(stale.text, /stale caption/);
  assert.equal(stale.caption, '');
  const current = page(body, { head: meta('https://www.instagram.com/p/ABC/', '12 likes, 3 comments - creator on September 1, 2026: "baking tips"') }).inspect().post;
  assert.match(current.text, /^baking tips/);
  assert.equal(current.caption, '');
});

test('draft state reads any copy of the comment text without needing the same post', () => {
  const body = sidebar() + main() + dialog();
  const other = page(body, { url: 'https://www.instagram.com/p/OTHER/' });
  other.document.querySelector('textarea').value = 'this is so good ';
  assert.deepEqual(plain(other.inspect({ action: 'draft-state', comment: 'this is so good' })), { known: true, holding: true });

  const editable = page(body + '<div contenteditable="true">draft: this is so good</div>');
  assert.deepEqual(plain(editable.inspect({ action: 'draft-state', comment: 'this is so good' })), { known: true, holding: true });

  const empty = page(body);
  let released = 0;
  empty.window.collectiveCommentBefore = { drafted: false, submitted: false, release: () => { released += 1; } };
  assert.deepEqual(plain(empty.inspect({ action: 'draft-state', comment: 'this is so good' })), { known: true, holding: false });
  assert.equal(released, 1);

  const owned = page(body);
  const composer = owned.document.querySelector('textarea');
  composer.value = 'my own words';
  owned.window.collectiveCommentBefore = { drafted: true, submitted: false, interrupted: false, composer, release: () => { released += 1; } };
  assert.deepEqual(plain(owned.inspect({ action: 'draft-state', comment: 'this is so good' })), { known: true, holding: true });
  composer.value = '';
  owned.window.collectiveCommentBefore.interrupted = true;
  assert.deepEqual(plain(owned.inspect({ action: 'draft-state', comment: 'this is so good' })), { known: true, holding: true });
  assert.equal(released, 1);

  for (const comment of ['', '   ', undefined]) assert.deepEqual(plain(empty.inspect({ action: 'draft-state', comment })), { known: false });
});
