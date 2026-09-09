const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../browser-extension/instagram.js'), 'utf8');

function postFixture({ saved = false, liked = false, bookmark = true } = {}) {
  const id = 'https://www.instagram.com/p/example/';
  const clicks = [];
  const rect = (left = 0, top = 0, width = 40, height = 30) => ({ left, top, width, height, right: left + width, bottom: top + height });
  const button = (name, left, top, onClick = () => {}) => {
    const element = {
      name,
      textContent: '',
      getAttribute: () => null,
      getBoundingClientRect: () => rect(left, top),
      click() { clicks.push(this.name); onClick(this); },
      contains: target => target === icon,
      querySelectorAll: selector => selector === 'svg[aria-label]' ? [icon] : [],
    };
    const icon = { getAttribute: key => key === 'aria-label' ? element.name : null, closest: () => element };
    return element;
  };
  const like = button(liked ? 'Unlike' : 'Like', 20, 100, element => { element.name = element.name === 'Like' ? 'Unlike' : 'Like'; });
  const comment = button('Comment', 80, 100);
  const save = button(saved ? 'Unsave' : 'Save', 140, 100, element => { element.name = element.name === 'Save' ? 'Unsave' : 'Save'; });
  const commentHeart = button('Like', 200, 300);
  const toolbarButtons = [like, comment, ...(bookmark ? [save] : [])];
  const allButtons = [...toolbarButtons, commentHeart];
  const toolbar = { querySelectorAll: selector => selector === 'button, [role="button"]' ? toolbarButtons : [] };
  const scope = {
    getBoundingClientRect: () => rect(0, 0, 600, 500),
    querySelectorAll: selector => selector === 'button, [role="button"]' ? allButtons : [],
  };
  toolbar.parentElement = scope;
  for (const element of toolbarButtons) element.parentElement = toolbar;
  commentHeart.parentElement = scope;
  const document = {
    querySelectorAll: selector => selector === 'article' ? [scope] : [],
    querySelector: () => null,
    elementFromPoint: (x, y) => allButtons.find(element => {
      const bounds = element.getBoundingClientRect();
      return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
    }) || null,
  };
  const context = vm.createContext({
    URL, document,
    location: { hostname: 'www.instagram.com', origin: 'https://www.instagram.com', href: id, pathname: '/p/example/' },
    innerWidth: 1000, innerHeight: 800,
    getComputedStyle: () => ({ visibility: 'visible', display: 'block' }),
  });
  vm.runInContext(source, context);
  return { id, clicks, like, save, commentHeart, document, inspect: request => context.inspectInstagram(request) };
}

for (const saved of [false, true]) {
  test(`${saved ? 'saved' : 'unsaved'} posts can be liked and confirmed without changing their bookmark`, () => {
    const fixture = postFixture({ saved });
    assert.equal(fixture.inspect().post.like, true);
    assert.equal(fixture.inspect({ id: fixture.id, action: 'verify-like' }).confirmed, false);
    const { point } = fixture.inspect({ id: fixture.id, action: 'like' });
    assert.ok(point);
    const target = fixture.document.elementFromPoint(point.x, point.y);
    assert.equal(target, fixture.like);
    target.click();
    assert.equal(fixture.inspect({ id: fixture.id, action: 'verify-like' }).confirmed, true);
    assert.equal(fixture.inspect().post.like, false);
    assert.equal(fixture.inspect({ id: fixture.id, action: 'like' }).point, null);
    assert.deepEqual(fixture.clicks, ['Like']);
    assert.equal(fixture.save.name, saved ? 'Unsave' : 'Save');
    assert.equal(fixture.commentHeart.name, 'Like');
  });
}

test('an already liked saved post never exposes its unlike button or a comment heart as a like action', () => {
  const fixture = postFixture({ saved: true, liked: true });
  assert.equal(fixture.inspect().post.like, false);
  assert.equal(fixture.inspect({ id: fixture.id, action: 'like' }).point, null);
  assert.equal(fixture.inspect({ id: fixture.id, action: 'verify-like' }).confirmed, true);
  assert.deepEqual(fixture.clicks, []);
});

test('a missing bookmark control does not broaden like detection to the whole post', () => {
  const fixture = postFixture({ bookmark: false });
  assert.equal(fixture.inspect().post.like, false);
  assert.equal(fixture.inspect({ id: fixture.id, action: 'like' }).point, null);
  assert.equal(fixture.inspect({ id: fixture.id, action: 'verify-like' }).confirmed, false);
});
