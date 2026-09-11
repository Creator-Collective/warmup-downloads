const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../browser-extension/tiktok.js'), 'utf8');

function fixture({ host = 'www.tiktok.com', pathName = '/@creator/video/123', href = 'https://www.tiktok.com/@creator/video/123' } = {}) {
  const clicks = [];
  const rect = (left = 0, top = 0, width = 60, height = 36) => ({ left, top, width, height, right: left + width, bottom: top + height });
  const button = (name, left, top, onClick = () => {}) => ({
    name,
    textContent: name,
    disabled: false,
    getAttribute(key) { return key === 'aria-label' ? this.name : null; },
    getBoundingClientRect: () => rect(left, top),
    click() { clicks.push(this.name); onClick(this); },
    contains(target) { return target === this; },
    closest(selector) { return /button|\[role="button"\]/.test(selector) ? this : null; },
    querySelector: () => null,
    querySelectorAll: () => [],
  });
  const like = button('Like', 20, 120, element => { element.name = 'Liked'; element.textContent = 'Liked'; });
  const follow = button('Follow', 90, 120, element => { element.name = 'Following'; element.textContent = 'Following'; });
  const next = button('Next video', 160, 120);
  const caption = { innerText: 'personal branding setup checklist', textContent: 'personal branding setup checklist', getBoundingClientRect: () => rect(0, 20, 260, 40), getAttribute: () => null };
  const video = { paused: false, ended: false, readyState: 4, duration: 20, currentTime: 8, playbackRate: 1, getBoundingClientRect: () => rect(0, 60, 240, 320), getAttribute: () => null };
  const links = [
    { href: 'https://www.tiktok.com/@creator/video/123?lang=en', getBoundingClientRect: () => rect(0, 0, 120, 120), getAttribute: () => null },
    { href: 'https://www.tiktok.com/@other/video/456', getBoundingClientRect: () => rect(150, 0, 120, 120), getAttribute: () => null },
  ];
  const buttons = [like, follow, next];
  const scope = {
    innerText: '',
    getAttribute: () => null,
    getBoundingClientRect: () => rect(0, 0, 600, 700),
    querySelector: () => null,
    querySelectorAll(selector) {
      if (selector === 'button, [role="button"]') return buttons;
      if (selector === 'video') return [video];
      if (selector === 'a[href]') return links;
      if (selector.includes('browse-video-desc')) return [caption];
      return [];
    }
  };
  const document = {
    body: scope,
    querySelector(selector) { return selector === 'main,[role="main"]' ? scope : null; },
    querySelectorAll(selector) {
      if (selector.includes('a[href]')) return links;
      if (selector === 'button, [role="button"]') return buttons;
      if (selector.includes('[data-e2e="browse-video"]')) return [scope];
      return [];
    },
    elementFromPoint(x, y) {
      return buttons.find(element => {
        const bounds = element.getBoundingClientRect();
        return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
      }) || null;
    },
  };
  const context = vm.createContext({
    URL, document,
    location: { hostname: host, origin: `https://${host}`, href, pathname: pathName },
    innerWidth: 1000, innerHeight: 800,
    getComputedStyle: () => ({ visibility: 'visible', display: 'block' }),
  });
  vm.runInContext(source, context);
  return { clicks, like, follow, inspect: request => context.inspectTikTok(request) };
}

test('tiktok observer normalizes visible video links and exposes safe actions', () => {
  const page = fixture();
  const view = page.inspect();
  assert.deepEqual(JSON.parse(JSON.stringify(view.posts)), ['https://www.tiktok.com/@creator/video/123/', 'https://www.tiktok.com/@other/video/456/']);
  assert.equal(view.post.id, 'https://www.tiktok.com/@creator/video/123/');
  assert.equal(view.post.author, '@creator');
  assert.equal(view.post.like, true);
  assert.equal(view.post.follow, true);
  assert.equal(view.post.comment, false);
  assert.equal(view.post.videoRemainingMs, 12000);
});

test('tiktok feed URLs still expose the active card for engagement', () => {
  const page = fixture({ pathName: '/foryou', href: 'https://www.tiktok.com/foryou' });
  const view = page.inspect();
  assert.equal(view.post.id, 'https://www.tiktok.com/@creator/video/123/');
  assert.equal(view.post.viewer, true);
  assert.equal(view.post.like, true);
  assert.equal(view.post.follow, true);
});

test('tiktok likes and follows require exact visible controls and confirmation', () => {
  const page = fixture();
  const id = 'https://www.tiktok.com/@creator/video/123/';
  let point = page.inspect({ id, action: 'like' }).point;
  page.inspect().post.like && page.like.click();
  assert.ok(point);
  assert.equal(page.inspect({ id, action: 'verify-like' }).confirmed, true);
  point = page.inspect({ id, author: '@creator', action: 'follow' }).point;
  page.follow.click();
  assert.ok(point);
  assert.equal(page.inspect({ id, author: '@creator', action: 'verify-follow' }).confirmed, true);
  assert.deepEqual(page.clicks, ['Like', 'Follow']);
});

test('tiktok observer blocks non-tiktok pages', () => {
  const page = fixture({ host: 'example.com', pathName: '/', href: 'https://example.com/' });
  assert.match(page.inspect().blocked, /open tiktok/);
});
