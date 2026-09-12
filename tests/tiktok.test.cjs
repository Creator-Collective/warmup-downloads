const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../browser-extension/tiktok.js'), 'utf8');
const id = 'https://www.tiktok.com/@creator/video/123/';

// A small DOM tree fixture, with selector matching and bubbling click targets.
// Unlike flat querySelector stubs, sibling and ancestor scoping are exercised.
function fixture({ href = id, modal = false, tag = 'div', withVideo = true } = {}) {
  const clicks = [];
  const rect = (left = 0, top = 0, width = 60, height = 36) => ({ left, top, width, height, right: left + width, bottom: top + height });
  class Element {
    constructor(tagName, attrs = {}, text = '', bounds = rect()) {
      this.tagName = tagName.toUpperCase(); this.attrs = { ...attrs }; this.ownText = text;
      this.bounds = bounds; this.children = []; this.parentElement = null; this.disabled = false;
    }
    append(...nodes) { for (const node of nodes) { node.parentElement = this; this.children.push(node); } return this; }
    remove() { this.parentElement.children = this.parentElement.children.filter(node => node !== this); this.parentElement = null; }
    get textContent() { return this.ownText + this.children.map(child => child.textContent).join(' '); }
    get innerText() { return this.textContent; }
    get href() { return this.attrs.href; }
    getAttribute(key) { return this.attrs[key] ?? null; }
    getBoundingClientRect() { return this.bounds; }
    contains(target) { return target === this || this.children.some(child => child.contains(target)); }
    matches(selector) {
      return selector.split(',').some(part => {
        const rule = part.trim();
        const tagName = rule.match(/^[a-z][\w-]*/i)?.[0];
        if (tagName && tagName.toUpperCase() !== this.tagName) return false;
        const id = rule.match(/#([\w-]+)/)?.[1];
        if (id && this.attrs.id !== id) return false;
        for (const match of rule.matchAll(/\[([\w-]+)(\*=|=)?(?:"([^"]*)")?\]/g)) {
          const [, key, op, value] = match;
          if (!(key in this.attrs) || (op === '=' && this.attrs[key] !== value) || (op === '*=' && !this.attrs[key].includes(value))) return false;
        }
        return true;
      });
    }
    closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
    querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    click() { clicks.push(this); for (let node = this; node; node = node.parentElement) node.onClick?.(); }
  }
  const element = (tagName, attrs, text, bounds) => new Element(tagName, attrs, text, bounds);
  const body = element('body', {}, '', rect(0, 0, 1000, 800));
  const main = element('main', modal ? { role: 'dialog' } : {}, '', rect(0, 0, 800, 750));
  const article = element('article', {}, '', rect(0, 0, 750, 650));
  const media = element('div', { 'data-e2e': 'browse-video' }, '', rect(0, 60, 340, 500));
  const video = element('video', {}, '', rect(0, 60, 340, 500));
  Object.assign(video, { paused: false, ended: false, readyState: 4, duration: 20, currentTime: 8, playbackRate: 1 });
  if (withVideo) media.append(video);
  const details = element('div', {}, '', rect(350, 0, 300, 500));
  const header = element('div', {}, '', rect(350, 0, 300, 60));
  const author = element('a', { href: 'https://www.tiktok.com/@creator/' }, '@creator', rect(350, 0, 100, 30));
  const follow = element(tag, { 'data-e2e': 'follow-button' }, 'Follow', rect(500, 0, 80, 30));
  follow.onClick = () => { follow.ownText = 'Following'; };
  const caption = element('p', { 'data-e2e': 'browse-video-desc' }, 'personal branding setup checklist', rect(350, 60, 280, 40));
  const link = element('a', { href: id + '?lang=en' }, 'video', rect(350, 110, 200, 30));
  const actions = element('div', {}, '', rect(350, 150, 240, 40));
  const like = element(tag, { 'data-e2e': 'like-icon', 'aria-pressed': 'false' }, '', rect(350, 150, 60, 36));
  const heart = element('svg', { fill: 'rgb(22, 24, 35)' }, '', rect(355, 155, 50, 26));
  like.append(heart); like.onClick = () => { like.attrs['aria-pressed'] = 'true'; };
  const next = element('button', { 'aria-label': 'Next video' }, '', rect(700, 500, 60, 36));
  const close = element('button', { 'aria-label': 'Close' }, '', rect(700, 0, 60, 36));
  header.append(author, follow); actions.append(like); details.append(header, caption, link, actions); article.append(media, details); main.append(article, next); if (modal) main.append(close); body.append(main);
  const document = {
    body,
    querySelectorAll: selector => body.querySelectorAll(selector),
    querySelector: selector => body.querySelector(selector),
    elementFromPoint(x, y) {
      function hit(node) {
        if (node.hidden) return null;
        for (const child of [...node.children].reverse()) { const found = hit(child); if (found) return found; }
        const r = node.bounds;
        return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom ? node : null;
      }
      return hit(body);
    }
  };
  const location = new URL(href);
  const context = vm.createContext({ URL, document, location, innerWidth: 1000, innerHeight: 800,
    getComputedStyle: node => ({ visibility: node.hidden ? 'hidden' : 'visible', display: node.hidden ? 'none' : 'block', fill: node.computedFill || node.attrs.fill || '' }) });
  vm.runInContext(source, context);
  return { element, rect, body, main, article, media, details, header, author, follow, caption, link, actions, like, heart, video, next, close, clicks, document, context,
    inspect: request => context.inspectTikTok(request) };
}

test('a feed video includes its sibling action and author panels', () => {
  const page = fixture({ href: 'https://www.tiktok.com/foryou' });
  const view = page.inspect();
  assert.equal(view.post.id, id);
  assert.equal(view.post.author, '@creator');
  assert.equal(view.post.like, true);
  assert.equal(view.post.follow, true);
  assert.equal(view.post.comment, false);
  assert.equal(view.post.videoRemainingMs, 12000);
});

for (const tag of ['div', 'span', 'button']) {
  test(`TikTok ${tag} data-e2e actions click once and confirm persistent state`, () => {
    const page = fixture({ tag });
    assert.equal(page.inspect({ id, action: 'click-like' }).clicked, true);
    assert.equal(page.inspect({ id, action: 'verify-like' }).confirmed, true);
    assert.equal(page.inspect({ id, action: 'click-like' }).clicked, false);
    assert.equal(page.inspect({ id, author: '@creator', action: 'click-follow' }).clicked, true);
    assert.equal(page.inspect({ id, author: '@creator', action: 'verify-follow' }).confirmed, true);
    assert.equal(page.inspect({ id, action: 'click-follow' }).clicked, false);
    assert.deepEqual(page.clicks, [page.like, page.follow]);
  });
}

test('a persistent like-icon with a red heart is already liked, even without a changed label', () => {
  const page = fixture();
  delete page.like.attrs['aria-pressed']; page.heart.attrs.fill = 'rgba(254, 44, 85, 1)';
  assert.equal(page.inspect().post.like, false);
  assert.equal(page.inspect({ id, action: 'verify-like' }).confirmed, true);
  assert.equal(page.inspect({ id, action: 'click-like' }).clicked, false);
});

test('a heart using currentColor confirms its resolved red fill', () => {
  const page = fixture();
  delete page.like.attrs['aria-pressed'];
  page.heart.attrs.fill = 'currentColor'; page.heart.computedFill = 'rgb(254, 44, 85)';
  assert.equal(page.inspect().post.like, false);
  assert.equal(page.inspect({ id, action: 'verify-like' }).confirmed, true);
  assert.equal(page.inspect({ id, action: 'click-like' }).clicked, false);
});

test('like confirmation also accepts explicit unlike and data-state changes', () => {
  for (const attrs of [{ 'aria-label': 'Unlike video' }, { 'data-state': 'liked' }, { 'data-e2e': 'browse-liked-icon' }]) {
    const page = fixture(); Object.assign(page.like.attrs, attrs);
    assert.equal(page.inspect().post.like, false);
    assert.equal(page.inspect({ id, action: 'verify-like' }).confirmed, true);
  }
});

test('a vanished follow button or unchanged clicked heart is never counted as success', () => {
  const page = fixture(); page.like.onClick = () => {};
  assert.equal(page.inspect({ id, action: 'click-like' }).clicked, true);
  assert.equal(page.inspect({ id, action: 'verify-like' }).confirmed, false);
  page.follow.remove();
  assert.equal(page.inspect({ id, action: 'verify-follow' }).confirmed, false);
});

test('search grids and profile previews expose candidates, never a viewer or engagement', () => {
  for (const href of ['https://www.tiktok.com/search?q=branding', 'https://www.tiktok.com/search/video?q=branding', 'https://www.tiktok.com/@creator']) {
    const page = fixture({ href });
    assert.equal(page.inspect().post, null);
    assert.deepEqual(Array.from(page.inspect().posts), [id]);
    assert.equal(page.inspect({ id, action: 'click-like' }).clicked, false);
    assert.equal(page.clicks.length, 0);
  }
});

test('a video permalink without an actual video is not a ready viewer', () => {
  const page = fixture({ withVideo: false });
  assert.equal(page.inspect().post, null);
});

test('a search viewer dialog can engage and close its unique control', () => {
  const page = fixture({ href: 'https://www.tiktok.com/search?q=branding', modal: true });
  assert.equal(page.inspect().post.id, id);
  assert.equal(page.inspect().post.close, true);
  assert.equal(page.inspect({ id, action: 'click-close' }).clicked, true);
  assert.deepEqual(page.clicks, [page.close]);
});

test('a search dialog ignores offscreen preload videos while finding sibling actions', () => {
  const page = fixture({ href: 'https://www.tiktok.com/search?q=branding', modal: true });
  page.article.tagName = 'DIV';
  const preload = page.element('div', {}, '', page.rect(0, 900, 340, 500));
  const nextVideo = page.element('video', {}, '', page.rect(0, 900, 340, 500));
  Object.assign(nextVideo, { paused: false, ended: false, readyState: 4 });
  preload.append(nextVideo, page.element('a', { href: 'https://www.tiktok.com/@next/video/456/' }, '', page.rect(0, 920, 100, 30)));
  page.media.append(preload);
  const post = page.inspect().post;
  assert.equal(post.id, id); assert.equal(post.like, true); assert.equal(post.follow, true);
  assert.equal(page.inspect({ id, action: 'click-like' }).clicked, true);
  assert.deepEqual(page.clicks, [page.like]);
});

test('the verified browse-follow wrapper resolves its contained button once', () => {
  const page = fixture({ modal: true });
  page.follow.attrs = { 'data-e2e': 'browse-follow' }; page.follow.ownText = ''; page.follow.onClick = null;
  const button = page.element('button', {}, 'Follow', page.rect(500, 0, 80, 30));
  button.onClick = () => { button.ownText = 'Following'; }; page.follow.append(button);
  assert.equal(page.inspect().post.follow, true);
  assert.equal(page.inspect({ id, author: '@creator', action: 'click-follow' }).clicked, true);
  assert.equal(page.inspect({ id, author: '@creator', action: 'verify-follow' }).confirmed, true);
  assert.equal(page.inspect({ id, action: 'click-follow' }).clicked, false);
  assert.deepEqual(page.clicks, [button]);
});

test('the verified browse-like span uses its pressed-state button', () => {
  const page = fixture({ modal: true });
  page.like.remove(); page.like.tagName = 'SPAN'; page.like.attrs = { 'data-e2e': 'browse-like-icon' }; page.like.onClick = null;
  const button = page.element('button', { 'aria-pressed': 'false' }, '', page.rect(350, 150, 60, 36));
  button.onClick = () => { button.attrs['aria-pressed'] = 'true'; }; button.append(page.like); page.actions.append(button);
  assert.equal(page.inspect().post.like, true);
  assert.equal(page.inspect({ id, action: 'click-like' }).clicked, true);
  assert.equal(page.inspect({ id, action: 'verify-like' }).confirmed, true);
  assert.equal(page.inspect({ id, action: 'click-like' }).clicked, false);
  assert.deepEqual(page.clicks, [button]);
});

test('offscreen videos do not broaden feed scope into a different post', () => {
  const page = fixture({ href: 'https://www.tiktok.com/foryou' });
  const offscreen = page.element('video', {}, '', page.rect(0, 900, 340, 500));
  page.article.append(offscreen);
  assert.equal(page.inspect().post, null);
  assert.equal(page.inspect({ id, action: 'click-like' }).clicked, false);
});

test('a second same-size playing feed card is ambiguous and cannot receive actions', () => {
  const page = fixture({ href: 'https://www.tiktok.com/foryou' });
  const second = page.element('video', {}, '', page.rect(400, 60, 340, 500));
  Object.assign(second, { paused: false, ended: false, readyState: 4 }); page.main.append(second);
  assert.equal(page.inspect().post, null);
  assert.equal(page.inspect({ id, action: 'click-like' }).clicked, false);
});

test('unrelated posts and comment hearts cannot become the active video actions', () => {
  const page = fixture({ href: 'https://www.tiktok.com/foryou' });
  const aside = page.element('aside', {}, '', page.rect(810, 0, 180, 700));
  const other = page.element('a', { href: 'https://www.tiktok.com/@other/video/456/' }, '', page.rect(820, 0, 120, 30));
  const otherLike = page.element('button', { 'aria-label': 'Like' }, '', page.rect(820, 80, 60, 30));
  const comment = page.element('div', { 'data-e2e': 'comment-item' }, '', page.rect(350, 250, 250, 50));
  const commentLike = page.element('button', { 'aria-label': 'Like' }, '', page.rect(350, 260, 60, 30));
  comment.append(commentLike); page.details.append(comment); aside.append(other, otherLike); page.body.append(aside);
  assert.equal(page.inspect().post.id, id);
  assert.equal(page.inspect({ id, action: 'click-like' }).clicked, true);
  assert.deepEqual(page.clicks, [page.like]);
  page.like.remove();
  assert.equal(page.inspect().post.like, false);
});

test('following state must belong to the active author', () => {
  const page = fixture();
  page.author.attrs.href = 'https://www.tiktok.com/@someoneelse/'; page.follow.ownText = 'Following';
  assert.equal(page.inspect().post.follow, false);
  assert.equal(page.inspect({ id, action: 'verify-follow' }).confirmed, false);
});

test('actions reject changed posts, authors, disabled controls and overlays', () => {
  const page = fixture();
  assert.equal(page.inspect({ id: id.replace('123', '999'), action: 'click-like' }).changed, true);
  assert.equal(page.inspect({ id, author: '@other', action: 'click-follow' }).changed, true);
  page.like.attrs['aria-disabled'] = 'true';
  assert.equal(page.inspect({ id, action: 'click-like' }).clicked, false);
  delete page.like.attrs['aria-disabled'];
  page.actions.attrs['aria-disabled'] = 'true';
  assert.equal(page.inspect({ id, action: 'click-like' }).clicked, false);
  delete page.actions.attrs['aria-disabled'];
  page.body.append(page.element('div', {}, '', page.rect(300, 100, 300, 200)));
  assert.equal(page.inspect({ id, action: 'click-like' }).clicked, false);
  assert.equal(page.clicks.length, 0);
});

for (const [message, reason] of [
  ['Access Denied', 'access-denied'],
  ["You don't have permission to access this page", 'access-denied'],
  ['Verify you are human', 'challenge'],
  ["You're tapping too fast. Take a break!", 'rate-limit'],
  ['Too many requests', 'rate-limit'],
  ['Try again later', 'rate-limit']
]) {
  test(`a plain page warning stops actions: ${message}`, () => {
    const page = fixture(); page.body.append(page.element('div', {}, message, page.rect(0, 700, 900, 60)));
    assert.equal(page.inspect().blockReason, reason);
    assert.equal(page.inspect({ id, action: 'click-like' }).blockReason, reason);
    assert.equal(page.clicks.length, 0);
  });
}

test('hidden warnings and captions do not stop healthy videos', () => {
  for (const modal of [false, true]) {
    const page = fixture({ modal }); page.caption.ownText = 'too many requests';
    const warning = page.element('div', {}, 'Access Denied'); warning.hidden = true; page.body.append(warning);
    assert.ok(page.inspect().post);
  }
});

test('visible captcha and passwordless login gates stop engagement', () => {
  for (const attrs of [{ id: 'captcha-verify-container' }, { id: 'loginModalContentContainer' }, { id: 'login-modal' }]) {
    const page = fixture(); page.body.append(page.element('div', attrs));
    assert.ok(page.inspect().blocked);
    page.inspect({ id, action: 'click-like' });
    assert.equal(page.clicks.length, 0);
  }
});

test('comments stay unsupported and non-tiktok pages are blocked', () => {
  const page = fixture();
  assert.equal(page.inspect({ id, action: 'comment-field' }).point, null);
  assert.equal(page.inspect({ id, action: 'verify-comment' }).confirmed, false);
  assert.match(fixture({ href: 'https://example.com/' }).inspect().blocked, /open tiktok/);
});
