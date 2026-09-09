const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../browser-extension/instagram.js'), 'utf8');
const commentComposer = require('./fixtures/comment-composer.cjs');

function postFixture({ saved = false, liked = false, bookmark = true, followState, unrelatedFollowState } = {}) {
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
  const author = { href: 'https://www.instagram.com/creator/', getBoundingClientRect: () => rect(20, 20) };
  const follow = followState ? button(followState, 250, 20) : null;
  const unrelatedFollow = unrelatedFollowState ? button(unrelatedFollowState, 250, 300) : null;
  const toolbarButtons = [like, comment, ...(bookmark ? [save] : [])];
  const allButtons = [...(unrelatedFollow ? [unrelatedFollow] : []), ...toolbarButtons, commentHeart, ...(follow ? [follow] : [])];
  const toolbar = { querySelectorAll: selector => selector === 'button, [role="button"]' ? toolbarButtons : [] };
  const scope = {
    getBoundingClientRect: () => rect(0, 0, 600, 500),
    querySelectorAll: selector => selector === 'button, [role="button"]' ? allButtons : selector === 'a[href]' ? [author] : [],
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
  return { id, clicks, like, save, commentHeart, follow, document, inspect: request => context.inspectInstagram(request) };
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

test('the author follow control is found even when an unrelated Follow button appears first', () => {
  const h = postFixture({ followState: 'Follow', unrelatedFollowState: 'Follow' });
  const target = h.inspect({ id: h.id, author: '/creator/', action: 'follow' });
  assert.ok(target.point);
  assert.equal(h.document.elementFromPoint(target.point.x, target.point.y), h.follow);
});

test('Following and Requested must belong to the post author, not another account', () => {
  for (const followState of ['Following', 'Requested']) {
    const h = postFixture({ followState, unrelatedFollowState: followState });
    assert.equal(h.inspect({ id: h.id, author: '/creator/', action: 'verify-follow' }).confirmed, true);
    assert.equal(h.inspect({ id: h.id, author: '/other/', action: 'verify-follow' }).changed, true);
    const other = postFixture({ unrelatedFollowState: followState });
    assert.equal(other.inspect({ id: other.id, author: '/creator/', action: 'verify-follow' }).confirmed, false);
  }
});

test('a disappearing Follow button alone is not confirmation', () => {
  const h = postFixture();
  assert.equal(h.inspect({ id: h.id, author: '/creator/', action: 'verify-follow' }).confirmed, false);
});

test('a verified extension draft can submit after the textarea loses focus', () => {
  const h = commentComposer();
  h.prepare();
  h.document.activeElement = h.heading;
  assert.ok(h.inspect('comment-submit').point);
  h.submit.ariaDisabled = 'true';
  assert.equal(h.inspect('comment-submit').point, null);
});

test('comment submission and cleanup never target edited, replaced or submitted drafts', () => {
  for (const change of [
    h => { h.field.value = 'a comment written by the user'; },
    h => { h.replaceField().value = h.request.comment; },
    h => { h.context.collectiveCommentBefore.submitted = true; },
    h => { h.context.collectiveCommentBefore.author = '/someone-else/'; },
    h => { h.context.collectiveCommentBefore.postId = 'https://www.instagram.com/p/other/'; }
  ]) {
    const h = commentComposer(); h.prepare(); change(h);
    assert.equal(h.inspect('comment-submit').point, null);
    assert.equal(h.inspect('comment-clear').point, null);
    assert.equal(h.inspect('comment-cleared').cleared, false);
  }
});

test('a changed caption blocks posting but still allows clearing the exact extension draft', () => {
  const h = commentComposer(); h.prepare();
  h.heading.textContent = 'an updated caption';
  assert.equal(h.inspect('comment-submit').changed, true);
  assert.ok(h.inspect('comment-clear').point);
  h.field.value = '';
  assert.equal(h.inspect('comment-cleared').cleared, true);
});

test('a manual composer interaction revokes draft ownership even when its text stays unchanged', () => {
  for (const type of ['input', 'pointerdown', 'keydown', 'click', 'submit']) {
    const h = commentComposer(); h.prepare();
    h.interact(type, false);
    assert.ok(h.inspect('comment-submit').point);
    h.interact(type);
    assert.equal(h.inspect('comment-submit').point, null);
    assert.equal(h.inspect('comment-clear').point, null);
    assert.equal(h.field.value, h.request.comment);
  }
});
