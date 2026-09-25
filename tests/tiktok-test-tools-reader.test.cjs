const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, commentComposer } = require('./fixtures/tiktok-comment-composer.cjs');
const { warmupDiagnostics } = require('../browser-extension/guards.js');

// Test-build instruments in the TikTok reader: fixed reason codes for the like and
// follow checks, and the read-only 'check this page' probe. The probe reports only
// booleans, counts and fixed labels, never clicks or types, and keeps no state.
const id = 'https://www.tiktok.com/@creator/video/123/';
const photoId = 'https://www.tiktok.com/@creator/photo/234/';
const SEARCH = 'https://www.tiktok.com/search?q=branding';
const plain = value => JSON.parse(JSON.stringify(value));
const check = (page, action, extra = {}) => {
  const { confirmed, reason, changed } = plain(page.inspect({ id, author: '@creator', action, ...extra }));
  return { confirmed, reason, ...(changed ? { changed } : {}) };
};
const probe = page => plain(page.context.inspectTikTok({ action: 'probe' }));
const PROBE_KEYS = ['host', 'lang', 'blockReason', 'searchPage', 'searchTerm', 'resultCards', 'searchCards', 'behindViewerCards', 'dialogs', 'mediaDialogs',
  'postLinks', 'postPage', 'stage', 'viewer', 'postFound', 'kind', 'authorLink', 'caption', 'videoPlaying', 'videoShort', 'like', 'likeControls', 'likeClickable',
  'liked', 'follow', 'followControls', 'followClickable', 'following', 'next', 'close', 'commentIcon', 'commentBoxes', 'commentBox', 'commentBoxHasText',
  'postButton', 'replying', 'ownProfile', 'ownAccounts', 'commentReady', 'commentBlocker'];
// Nothing from the page's text, links or accounts may appear in a probe.
const PAGE_TEXT = ['creator', 'tiktok.com', 'personal branding', '@me', 'this setup tip', 'branding', 'http', 'photos'];
function assertOnlyStructure(result, name) {
  assert.deepEqual(Object.keys(result), ['probe'], name);
  for (const [key, value] of Object.entries(result.probe)) {
    assert.ok(typeof value === 'boolean' || Number.isSafeInteger(value) || value === null || (typeof value === 'string' && /^[a-z-]{0,20}$/i.test(value)), `${name}: ${key}`);
  }
  const text = JSON.stringify(result).toLowerCase();
  for (const fragment of PAGE_TEXT) assert.equal(text.includes(fragment), false, `${name}: ${fragment}`);
}
function assertUntouched(page, name) {
  assert.deepEqual(page.clicks, [], `${name}: nothing clicked`);
  assert.equal(page.context.collectiveCommentBefore, undefined, `${name}: no comment ownership`);
  assert.equal(page.context.collectiveTikTokPhotoBindings, undefined, `${name}: no photo bindings`);
}

test('the like and follow checks say why with a fixed code, and only ok confirms', () => {
  const page = fixture();
  assert.deepEqual(check(page, 'verify-like'), { confirmed: false, reason: 'not-liked' });
  assert.deepEqual(check(page, 'verify-follow'), { confirmed: false, reason: 'not-following' });
  page.like.click(); page.follow.click();
  assert.deepEqual(check(page, 'verify-like'), { confirmed: true, reason: 'ok' });
  assert.deepEqual(check(page, 'verify-follow'), { confirmed: true, reason: 'ok' });
  // A red heart never overrides an explicitly unpressed control.
  page.like.attrs['aria-pressed'] = 'false'; page.heart.attrs.fill = '#fe2c55';
  assert.deepEqual(check(page, 'verify-like'), { confirmed: false, reason: 'not-liked' });
  page.like.hidden = true; page.follow.hidden = true;
  assert.deepEqual(check(page, 'verify-like'), { confirmed: false, reason: 'no-control' });
  assert.deepEqual(check(page, 'verify-follow'), { confirmed: false, reason: 'no-control' });
});

test('a like check with a second author link, another post or no post names that', () => {
  const ambiguous = fixture();
  ambiguous.like.click();
  ambiguous.details.append(ambiguous.element('a', { href: 'https://www.tiktok.com/@other/' }, '@other', ambiguous.rect(350, 200, 80, 20)));
  assert.deepEqual(check(ambiguous, 'verify-like'), { confirmed: false, reason: 'no-control' });
  const page = fixture();
  for (const action of ['verify-like', 'verify-follow']) {
    assert.deepEqual(check(page, action, { id: 'https://www.tiktok.com/@creator/video/999/' }), { confirmed: false, reason: 'no-post', changed: true }, action);
    assert.deepEqual(check(fixture({ href: SEARCH }), action), { confirmed: false, reason: 'no-post', changed: true }, action);
  }
  // The comment check keeps its own codes.
  assert.equal(check(page, 'verify-comment', { id: 'https://www.tiktok.com/@creator/video/999/' }).reason, 'post-changed');
  assert.equal(check(fixture({ href: SEARCH }), 'verify-comment').reason, 'post-unavailable');
  assert.deepEqual(page.clicks, []);
});

test('the page check reports a video post with comments as found and state, without text or links', () => {
  const page = commentComposer();
  const result = probe(page);
  assertOnlyStructure(result, 'video');
  assert.deepEqual(Object.keys(result.probe).sort(), [...PROBE_KEYS].sort());
  assert.deepEqual(result.probe, {
    host: true, lang: '', blockReason: null, searchPage: false, searchTerm: false, resultCards: 0, searchCards: 0, behindViewerCards: 0,
    dialogs: 1, mediaDialogs: 1, postLinks: result.probe.postLinks, postPage: true, stage: 'post', viewer: true, postFound: true, kind: 'video',
    authorLink: true, caption: true, videoPlaying: true, videoShort: true, like: true, likeControls: 1, likeClickable: true, liked: false,
    follow: true, followControls: 1, followClickable: true, following: false, next: false, close: true, commentIcon: true,
    commentBoxes: 1, commentBox: true, commentBoxHasText: false, postButton: true, replying: false, ownProfile: true, ownAccounts: 1,
    commentReady: true, commentBlocker: 'none'
  });
  assert.ok(result.probe.postLinks >= 1);
  // The same answers the session reader gives (the open comment list covers Next here).
  const view = page.inspect().post;
  assert.deepEqual([view.next, view.close, view.like, view.follow, view.comment], [result.probe.next, result.probe.close, true, true, true]);
  assertUntouched(page, 'video');
  // The normalized form keeps every reported value.
  const normalized = warmupDiagnostics.normalizeProbe(result.probe);
  for (const key of PROBE_KEYS.filter(key => !['lang', 'blockReason', 'commentBlocker'].includes(key))) assert.equal(normalized[key], result.probe[key], key);
  assert.equal(normalized.lang, 'none');
  assert.equal(normalized.blockReason, 'none');
});

test('an already liked and followed post still shows its controls in the page check', () => {
  const page = fixture({ modal: true });
  page.like.click(); page.follow.click();
  page.clicks.length = 0;
  const view = page.inspect().post;
  assert.equal(view.like, false, 'the session reader hides a liked control');
  assert.equal(view.follow, false, 'the session reader hides a followed control');
  const { probe: state } = probe(page);
  assert.deepEqual({ like: state.like, liked: state.liked, follow: state.follow, following: state.following }, { like: true, liked: true, follow: true, following: true });
  assert.equal(state.commentBlocker, 'account');
  assert.equal(state.ownAccounts, 0);
  assertUntouched(page, 'liked');
});

test('the page check reads a comment box holding text without reading, clearing or claiming it', () => {
  const page = commentComposer();
  page.prepare();
  const before = page.context.collectiveCommentBefore;
  const snapshot = { drafted: before.drafted, submitted: before.submitted, interrupted: before.interrupted, composer: before.composer, text: page.field.textContent };
  const result = probe(page);
  assertOnlyStructure(result, 'draft');
  assert.equal(result.probe.commentBoxHasText, true);
  assert.equal(page.context.collectiveCommentBefore, before);
  assert.deepEqual({ drafted: before.drafted, submitted: before.submitted, interrupted: before.interrupted, composer: before.composer, text: page.field.textContent }, snapshot);
  assert.deepEqual(page.clicks, []);
  before.release();
});

test('a search page reports its result cards, and a covering dialog shows why none are counted', () => {
  const page = fixture({ href: SEARCH, postId: 'https://www.tiktok.com/@creator/video/100/' });
  page.article.attrs['data-e2e'] = 'search_top-item';
  for (const n of [2, 3]) {
    const card = page.element('div', { 'data-e2e': 'search_top-item' }, '', page.rect(0, 0, 100, 100));
    card.append(page.element('a', { href: `https://www.tiktok.com/@creator/video/${n}00/` }, '', page.rect(0, 0, 100, 100)));
    page.main.append(card);
  }
  const open = probe(page);
  assertOnlyStructure(open, 'search');
  assert.deepEqual({ ...open.probe, postLinks: 0 }, {
    host: true, lang: '', blockReason: null, searchPage: true, searchTerm: true, resultCards: 3, searchCards: 3, behindViewerCards: 0,
    dialogs: 0, mediaDialogs: 0, postLinks: 0, postPage: false, stage: 'not-a-post'
  });
  assert.equal(page.inspect().search.posts.length, 3);
  page.body.append(page.element('div', { role: 'dialog' }, 'cookie settings', page.rect(0, 700, 900, 100)));
  const covered = probe(page).probe;
  assert.deepEqual({ resultCards: covered.resultCards, searchCards: covered.searchCards, dialogs: covered.dialogs, mediaDialogs: covered.mediaDialogs },
    { resultCards: 3, searchCards: 0, dialogs: 1, mediaDialogs: 0 });
  assert.equal(page.inspect().search, undefined, 'the session gate that the dialog trips');
  assertUntouched(page, 'search');
});

test('a blocked page reports its block code and language instead of stopping', () => {
  const challenge = fixture();
  challenge.body.append(challenge.element('div', { id: 'captcha-verify-container' }, '', challenge.rect(0, 0, 300, 300)));
  assert.equal(challenge.inspect().blockReason, 'challenge');
  assert.deepEqual(probe(challenge), { probe: { host: true, lang: '', blockReason: 'challenge', stage: 'blocked' } });
  const german = fixture();
  german.document.documentElement = { getAttribute: name => name === 'lang' ? 'de-DE' : null };
  assert.deepEqual(probe(german), { probe: { host: true, lang: 'de-DE', blockReason: 'language', stage: 'blocked' } });
  assert.equal(warmupDiagnostics.normalizeProbe(probe(german).probe).lang, 'de-de');
  assert.deepEqual(probe(fixture({ href: 'https://www.tiktok.com/login' })), { probe: { host: true, lang: '', blockReason: 'sign-in', stage: 'blocked' } });
  assert.deepEqual(probe(fixture({ href: 'https://www.example.com/@creator/video/123/' })), { probe: { host: false, stage: 'blocked' } });
  for (const page of [challenge, german]) assertUntouched(page, 'blocked');
});

test('the page check on a photo post never creates the photo bindings the session keeps', () => {
  const page = fixture({ postId: photoId, withPhoto: true, modal: true });
  const result = probe(page);
  assertOnlyStructure(result, 'photo');
  assert.equal(result.probe.stage, 'post');
  assert.equal(result.probe.kind, 'photo');
  assert.equal(result.probe.videoPlaying, false);
  assertUntouched(page, 'photo');
  assert.equal(page.inspect().post.id, photoId);
  const bindings = page.context.collectiveTikTokPhotoBindings;
  assert.ok(bindings, 'the session reader still binds photos');
  // A slide that loads later is not added to the session's bindings by the check.
  const slide = page.element('div', { class: 'swiper-slide' }, '', page.rect(340, 60, 340, 500));
  slide.append(page.element('img', { class: 'ImgPhotoSlide', src: 'https://p16-sign.tiktokcdn-us.com/photos/second.jpeg' }, '', page.rect(340, 60, 340, 500)));
  page.carousel.append(slide);
  const sources = [...bindings.sources.keys()];
  assert.equal(probe(page).probe.stage, 'post');
  assert.deepEqual([...bindings.sources.keys()], sources);
  assert.equal(page.context.collectiveTikTokPhotoBindings, bindings);
  page.inspect();
  assert.equal(bindings.sources.size, sources.length + 1, 'the session reader does add it');
});

test('each detection step that stops early is named, with no post details', () => {
  const twoViewers = fixture({ modal: true });
  const second = twoViewers.element('div', { role: 'dialog' }, '', twoViewers.rect(0, 0, 400, 400));
  const video = twoViewers.element('video', {}, '', twoViewers.rect(0, 0, 400, 400));
  Object.assign(video, { paused: false, ended: false, readyState: 4 });
  second.append(video); twoViewers.body.append(second);
  const noMedia = fixture({ withVideo: false });
  for (const [page, stage] of [[twoViewers, 'several-viewers'], [noMedia, 'no-media']]) {
    const result = probe(page);
    assertOnlyStructure(result, stage);
    assert.equal(result.probe.stage, stage);
    assert.equal(result.probe.postFound, undefined, stage);
    assert.equal(warmupDiagnostics.normalizeProbe(result.probe).postFound, false, stage);
    assertUntouched(page, stage);
  }
});
