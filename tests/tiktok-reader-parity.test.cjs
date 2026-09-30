const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

// TikTok reader parity with the Instagram reader: own-profile fallbacks, comment
// blocker codes, the language stop, the og caption guard, the read-only draft
// check, result cards behind the search viewer and submit readiness codes.
// Modelled desktop markup (not a capture of the live site) with a stubbed layout:
// elements with data-r get that rect, elements under data-hidden get none.
const source = fs.readFileSync(path.join(__dirname, '../browser-extension/tiktok.js'), 'utf8');
const VIDEO = 'https://www.tiktok.com/@creator/video/7300000000000000001/';
const SEARCH = 'https://www.tiktok.com/search?q=personal%20brand';
const CAPTION = 'personal branding setup checklist';
const COMMENT = 'this setup tip is useful for personal branding';
const result = n => `https://www.tiktok.com/@result${n}/video/${7400000000000000000n + BigInt(n)}/`;

const nav = ({ user = 'me', marker = true, text = 'Profile', hidden = false } = {}) =>
  `<nav data-r="0,0,200,800"><a href="https://www.tiktok.com/foryou" data-r="10,100,180,40">For You</a>` +
  `<a ${marker ? 'data-e2e="nav-profile" ' : ''}href="https://www.tiktok.com/@${user}"${hidden ? ' data-hidden' : ''} data-r="10,300,180,40">${text}</a></nav>`;
const post = ({ id = VIDEO, caption = CAPTION, fields = 1, replyLabel = '', composer = true, open = true, avatar = '' } = {}) => {
  const editors = Array.from({ length: fields }, (_, index) =>
    `<div data-e2e="comment-input" data-r="640,${610 - index * 70},400,60"><div data-e2e="comment-text" data-r="640,${610 - index * 70},400,60">` +
    `<div contenteditable="true" role="textbox"${replyLabel ? ` aria-label="${replyLabel}"` : ''} data-r="645,${615 - index * 70},390,50"></div></div></div>`).join('');
  const bar = composer ? `<div class="css-1-DivCommentBarContainer" data-r="580,600,600,100">${avatar}${editors}<button data-e2e="comment-post" data-r="1050,615,80,40">Post</button></div>` : '';
  const description = caption ? `<p data-e2e="browse-video-desc" data-r="580,90,500,40">${caption}</p>` : '';
  const commentIcon = open ? '<button aria-label="Comments" data-r="660,180,60,36"><span data-e2e="comment-icon" data-r="665,185,50,26"></span></button>' : '';
  return `<article data-r="220,20,1000,760"><div data-r="220,60,340,500"><video data-r="220,60,340,500"></video></div>` +
    `<div data-r="580,20,600,740"><div data-r="580,20,300,60"><a href="https://www.tiktok.com/@creator" data-r="580,20,100,30">@creator</a>` +
    `<button data-e2e="follow-button" data-r="700,20,80,30">Follow</button></div>${description}` +
    `<a href="${id}?lang=en" data-r="580,140,200,30">video</a>` +
    `<div data-r="580,180,300,40"><button data-e2e="like-icon" aria-pressed="false" data-r="580,180,60,36"></button>${commentIcon}</div>` +
    `<div data-e2e="comment-list" data-r="580,240,500,300"></div>${bar}</div></article>`;
};
const cards = (numbers, extra = '') => numbers.map((n, index) =>
  `<div data-e2e="search_top-item"${extra} data-r="${220 + (index % 4) * 200},${20 + Math.floor(index / 4) * 320},190,300"><a href="${result(n)}" data-r="${220 + (index % 4) * 200},${20 + Math.floor(index / 4) * 320},190,300">result</a></div>`).join('');

function page(body, { url = VIDEO, lang, head = '' } = {}) {
  const dom = new JSDOM(`<!doctype html><html${lang === undefined ? '' : ` lang="${lang}"`}><head>${head}</head><body>${body}</body></html>`, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  const rects = new Map();
  for (const element of window.document.querySelectorAll('[data-r]')) {
    const [left, top, width, height] = element.getAttribute('data-r').split(',').map(Number);
    rects.set(element, { left, top, width, height, right: left + width, bottom: top + height });
  }
  const hidden = element => Boolean(element.closest('[data-hidden]'));
  window.Element.prototype.getBoundingClientRect = function () {
    return !hidden(this) && rects.get(this) || { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 };
  };
  window.document.elementFromPoint = (x, y) => [...rects.entries()]
    .filter(([element, rect]) => !hidden(element) && x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom)
    .sort((a, b) => a[1].width * a[1].height - b[1].width * b[1].height)[0]?.[0] || null;
  window.innerWidth = 1280; window.innerHeight = 800;
  const clicks = [];
  window.document.addEventListener('click', event => clicks.push(event.target), true);
  window.eval(source);
  const inspect = (request = {}) => window.inspectTikTok(request);
  return { window, document: window.document, clicks, inspect, $: selector => window.document.querySelector(selector) };
}
const plain = value => JSON.parse(JSON.stringify(value));
const commentRequest = (h, action) => ({ id: VIDEO, author: '@creator', caption: h.inspect().post.caption, comment: COMMENT, action });

test('the own tiktok account is found from its nav marker, a nav profile label or the comment bar avatar', () => {
  const avatar = user => `<a href="https://www.tiktok.com/@${user}" data-r="585,615,40,40"><img alt="" data-r="585,615,40,40"></a>`;
  for (const [name, body] of [
    ['nav marker', nav() + `<main data-r="200,0,1080,800">${post()}</main>`],
    ['labelled nav link without the marker', nav({ marker: false }) + `<main data-r="200,0,1080,800">${post()}</main>`],
    ['aria-labelled icon-only nav link', nav({ marker: false, text: '' }).replace('<a href="https://www.tiktok.com/@me"', '<a aria-label="Profile" href="https://www.tiktok.com/@me"') + `<main data-r="200,0,1080,800">${post()}</main>`],
    ['signed-in avatar in the comment bar', `<main data-r="200,0,1080,800">${post({ avatar: avatar('me') })}</main>`],
    ['hidden nav marker only', nav({ hidden: true }) + `<main data-r="200,0,1080,800">${post()}</main>`],
    ['visible marker preferred over a hidden stale avatar', nav() + `<main data-r="200,0,1080,800">${post({ avatar: avatar('old').replace('<a ', '<a data-hidden ') })}</main>`]
  ]) {
    const h = page(body);
    const view = h.inspect().post;
    assert.equal(view.comment, true, name);
    assert.equal(view.commentBlocker, undefined, name);
    assert.ok(h.inspect(commentRequest(h, 'comment-field')).point, name);
    assert.equal(h.window.collectiveCommentBefore.author, '@me', name);
    h.window.collectiveCommentBefore.release();
  }
});

test('an ambiguous or unmarked own account fails closed with the account blocker', () => {
  const avatar = user => `<a href="https://www.tiktok.com/@${user}" data-r="585,615,40,40"><img alt="" data-r="585,615,40,40"></a>`;
  for (const [name, body] of [
    ['nav marker and comment avatar disagree', nav() + `<main data-r="200,0,1080,800">${post({ avatar: avatar('other') })}</main>`],
    ['two nav markers for different accounts', nav() + nav({ user: 'other' }) + `<main data-r="200,0,1080,800">${post()}</main>`],
    ['a profile-labelled link outside site navigation', `<main data-r="200,0,1080,800"><a href="https://www.tiktok.com/@me" data-r="220,0,100,20">Profile</a>${post()}</main>`],
    ['an avatar without the comment bar', `<main data-r="200,0,1080,800">${post()}<a href="https://www.tiktok.com/@me" data-r="220,780,20,20"><img alt="" data-r="220,780,20,20"></a></main>`],
    ['a commenter avatar inside comment rows', `<main data-r="200,0,1080,800">${post({ avatar: `<div data-e2e="comment-item" data-r="585,605,50,50">${avatar('me')}</div>` })}</main>`],
    ['no account link at all', `<main data-r="200,0,1080,800">${post()}</main>`]
  ]) {
    const h = page(body);
    const view = h.inspect().post;
    assert.equal(view.comment, false, name);
    assert.equal(view.commentBlocker, 'account', name);
    assert.equal(h.inspect(commentRequest(h, 'comment-field')).point, null, name);
    assert.equal(h.window.collectiveCommentBefore, undefined, name);
    assert.equal(view.like, true, name);
  }
});

test('comment blocker codes name the composer problem, and a comment-ready post reports none', () => {
  const main = inner => nav() + `<main data-r="200,0,1080,800">${inner}</main>`;
  for (const [name, options] of [
    ['two editors', { fields: 2 }],
    ['reply mode', { replyLabel: 'Add a reply...' }],
    ['no composer and no comment icon', { composer: false, open: false }]
  ]) {
    const view = page(main(post(options))).inspect().post;
    assert.equal(view.comment, false, name);
    assert.equal(view.commentBlocker, 'composer', name);
  }
  const closed = page(main(post({ composer: false }))).inspect().post;
  assert.equal(closed.comment, true, 'a closed panel with its comment icon can still be opened');
  assert.equal(closed.commentBlocker, undefined);
  assert.equal(page(main(post())).inspect().post.commentBlocker, undefined);
});

test('a page that declares a non-english language stops before any read or click', () => {
  const body = nav() + `<main data-r="200,0,1080,800">${post()}</main>`;
  const message = "tiktok isn't in english, so the session can't read its warnings. switch tiktok to english, then start a new session.";
  for (const lang of ['de', 'es-MX', 'fr-FR', 'pt_BR', 'zh-Hans']) {
    const h = page(body, { lang });
    assert.deepEqual(plain(h.inspect()), { blocked: message, blockReason: 'language' }, lang);
    for (const action of ['click-like', 'click-follow', 'click-comment-open', 'draft-state', 'verify-like']) {
      assert.equal(h.inspect({ id: VIDEO, author: '@creator', comment: COMMENT, action }).blockReason, 'language', `${lang} ${action}`);
    }
    assert.deepEqual(h.clicks, [], lang);
  }
  for (const lang of [undefined, '', 'en', 'en-US', 'EN-gb', 'en_GB']) {
    const view = page(body, { lang }).inspect();
    assert.equal(view.blocked, undefined, String(lang));
    assert.equal(view.post.id, VIDEO, String(lang));
  }
});

test('page meta text is the caption only when its og:url names this video', () => {
  const meta = url => `${url === null ? '' : `<meta property="og:url" content="${url}">`}<meta property="og:description" content="a caption about personal branding">`;
  const body = nav() + `<main data-r="200,0,1080,800">${post({ caption: '' })}</main>`;
  for (const [url, expected] of [
    [VIDEO, 'a caption about personal branding'],
    [VIDEO.replace(/\/$/, '') + '?lang=en&is_from_webapp=1', 'a caption about personal branding'],
    [VIDEO.replace('www.tiktok.com', 'tiktok.com'), 'a caption about personal branding'],
    [new URL(VIDEO).pathname, 'a caption about personal branding'],
    ['https://www.tiktok.com/@creator/video/7300000000000000999/', ''],
    ['https://www.tiktok.com/@other/video/7300000000000000001/', ''],
    ['https://example.com/@creator/video/7300000000000000001/', ''],
    ['', ''],
    [null, '']
  ]) {
    const view = page(body, { head: meta(url) }).inspect().post;
    assert.equal(view.caption, expected, String(url));
    assert.equal(view.text, expected, String(url));
  }
  const visible = page(nav() + `<main data-r="200,0,1080,800">${post()}</main>`, { head: meta(VIDEO) }).inspect().post;
  assert.equal(visible.caption, CAPTION, 'a visible description is still preferred');
});

test('the draft check finds any copy of the comment text, hidden or not, and never edits it', () => {
  const body = nav() + `<main data-r="200,0,1080,800">${post()}</main>`;
  const check = (h, comment = COMMENT) => plain(h.inspect({ action: 'draft-state', comment }));
  let released = 0;
  const owned = page(body);
  const field = owned.$('[contenteditable="true"]');
  field.textContent = 'my own words';
  owned.window.collectiveCommentBefore = { platform: 'tiktok', drafted: true, submitted: false, interrupted: false, composer: field, release: () => { released += 1; } };
  assert.deepEqual(check(owned), { known: true, holding: true }, 'the owned editor still holds text');
  field.textContent = '';
  owned.window.collectiveCommentBefore.interrupted = true;
  assert.deepEqual(check(owned), { known: true, holding: true }, 'a manual edit keeps it unknown to us, so it is held');
  owned.window.collectiveCommentBefore.interrupted = false;
  owned.window.collectiveCommentBefore.submitted = true;
  assert.deepEqual(check(owned), { known: true, holding: false }, 'a submitted, empty editor holds nothing');
  assert.equal(released, 1);
  for (const [name, extra] of [
    ['hidden editor', `<div data-hidden contenteditable="true">draft: ${COMMENT}</div>`],
    ['non-breaking spaces', `<div contenteditable="true" data-r="0,0,10,10">${COMMENT.replace(/ /g, '\xa0')}</div>`],
    ['textarea', `<textarea data-hidden>${COMMENT}</textarea>`]
  ]) {
    const h = page(body + extra);
    h.window.collectiveCommentBefore = { platform: 'tiktok', release: () => { released += 1; } };
    assert.deepEqual(check(h), { known: true, holding: true }, name);
  }
  assert.equal(released, 1);
  const elsewhere = page(nav() + `<main data-r="200,0,1080,800">${cards([1, 2])}</main>`, { url: SEARCH });
  assert.deepEqual(check(elsewhere), { known: true, holding: false }, 'answers without any post on the page');
  const instagramOwned = page(body);
  instagramOwned.$('[contenteditable="true"]').textContent = 'unrelated';
  instagramOwned.window.collectiveCommentBefore = { drafted: true, submitted: false, composer: instagramOwned.$('[contenteditable="true"]') };
  assert.deepEqual(check(instagramOwned), { known: true, holding: false }, 'only a tiktok-owned draft counts as owned');
  const blank = page(body);
  for (const comment of ['', '   ', undefined, 42]) assert.deepEqual(plain(blank.inspect({ action: 'draft-state', comment })), { known: false }, String(comment));
  const blocked = page(body + '<div id="captcha-verify-container" data-r="0,0,300,300"></div>');
  assert.equal(blocked.inspect({ action: 'draft-state', comment: COMMENT }).blockReason, 'challenge');
  const untouched = page(body + `<div contenteditable="true" data-r="0,0,10,10">${COMMENT}</div>`);
  check(untouched);
  assert.equal(untouched.document.querySelectorAll('[contenteditable="true"]')[1].textContent, COMMENT);
  assert.deepEqual(untouched.clicks, []);
});

test('result cards behind the search viewer are reported without a term, and only real laid-out cards count', () => {
  const dialog = inner => `<div role="dialog" data-r="200,0,1080,800">${inner}</div>`;
  const behind = (h) => plain(h.inspect().search);
  const viewer = page(nav() + `<main data-r="200,0,1080,800">${cards([1, 2, 3, 4, 5, 6])}</main>` + dialog(post()));
  assert.equal(viewer.inspect().post.id, VIDEO);
  assert.deepEqual(behind(viewer), { term: null, behindViewer: true, posts: [1, 2, 3, 4, 5, 6].map(result) });
  const stillOnSearch = page(nav() + `<main data-r="200,0,1080,800">${cards([1, 2])}</main>` + dialog(post()), { url: SEARCH });
  assert.deepEqual(behind(stillOnSearch), { term: null, behindViewer: true, posts: [1, 2].map(result) });
  const ariaHidden = page(nav() + `<main aria-hidden="true" data-r="200,0,1080,800">${cards([1, 2])}</main>` + dialog(post()));
  assert.deepEqual(behind(ariaHidden).posts, [1, 2].map(result), 'a modal may mark the background aria-hidden');
  const mixed = page(nav() + `<main data-r="200,0,1080,800">${cards([1])}${cards([2], ' data-hidden')}${cards([3], ' style="display:none"')}` +
    `<div data-e2e="search_top-item" data-r="220,400,190,300"><a href="${result(4)}" data-r="220,400,90,300">a</a><a href="${result(5)}" data-r="320,400,90,300">b</a></div>` +
    `<aside data-r="1100,0,180,800">${cards([6])}</aside></main>` + dialog(post().replace('</article>', `${cards([7])}</article>`)));
  assert.deepEqual(behind(mixed).posts, [result(1)], 'hidden, collapsed, ambiguous, sidebar and in-viewer cards are left out');
  const none = page(nav() + '<main data-r="200,0,1080,800"><p data-r="220,20,100,20">no results</p></main>' + dialog(post()));
  assert.equal(none.inspect().search, undefined);
  const permalink = page(nav() + `<main data-r="200,0,1080,800">${post()}</main><div data-r="0,780,1280,20">${cards([1])}</div>`);
  assert.equal(permalink.inspect().search, undefined, 'a permalink page without a viewer reports no search');
});

test('submit readiness gives a fixed reason and never the editor text', () => {
  const body = nav() + `<main data-r="200,0,1080,800">${post()}</main>`;
  const prepared = (text, change = () => {}) => {
    const h = page(body);
    assert.ok(h.inspect(commentRequest(h, 'comment-field')).point);
    const field = h.$('[contenteditable="true"]');
    field.focus();
    h.window.collectiveCommentBefore.drafted = true;
    field.textContent = text;
    change(h);
    return h;
  };
  for (const [reason, h] of [
    ['composer-empty', prepared('')],
    ['text-mismatch', prepared('this setup tip')],
    ['submit-unavailable', prepared(COMMENT, h => { h.$('[data-e2e="comment-post"]').disabled = true; })],
    ['not-owned', prepared(COMMENT, h => { h.window.collectiveCommentBefore.interrupted = true; })],
    ['not-owned', prepared(COMMENT, h => { h.window.collectiveCommentBefore.drafted = false; })]
  ]) {
    const answer = plain(h.inspect(commentRequest(h, 'click-comment-submit')));
    assert.deepEqual(answer, { clicked: false, reason }, reason);
    assert.deepEqual(h.clicks, [], reason);
  }
  const never = page(body);
  assert.deepEqual(plain(never.inspect(commentRequest(never, 'click-comment-submit'))), { clicked: false, reason: 'not-owned' });
  const ready = prepared(COMMENT);
  assert.deepEqual(plain(ready.inspect(commentRequest(ready, 'click-comment-submit'))), { clicked: true });
  assert.equal(ready.clicks.length, 1);
});
