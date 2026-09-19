const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture } = require('./fixtures/tiktok-comment-composer.cjs');

for (const withPhoto of [false, true]) {
  test(`caption mentions do not invalidate the ${withPhoto ? 'photo' : 'video'} author or like confirmation`, () => {
    const id = `https://www.tiktok.com/@creator/${withPhoto ? 'photo' : 'video'}/123/`;
    const page = fixture({ postId: id, withPhoto });
    // The live September 19 viewer renders "Replying to @DatsLife" as a
    // profile anchor inside its data-e2e browse-video-desc caption.
    page.caption.append(page.element('a', { href: 'https://www.tiktok.com/@mentioned/' }, '@mentioned'));
    page.like.attrs['aria-pressed'] = 'true';
    assert.equal(page.inspect().post.id, id);
    assert.equal(page.inspect().post.follow, true);
    assert.equal(page.inspect({ id, author: '@creator', action: 'verify-like' }).confirmed, true);
    assert.equal(page.inspect({ id, author: '@mentioned', action: 'verify-like' }).confirmed, false);
    assert.deepEqual(page.clicks, []);
  });
}

test('an author present only in caption text never establishes post ownership', () => {
  const page = fixture();
  page.author.remove();
  page.caption.append(page.element('a', { href: 'https://www.tiktok.com/@creator/' }, '@creator'));
  page.like.attrs['aria-pressed'] = 'true';
  assert.equal(page.inspect({ id: 'https://www.tiktok.com/@creator/video/123/', author: '@creator', action: 'verify-like' }).confirmed, false);
  assert.equal(page.inspect().post.follow, false);
});

test('conflicting primary authors outside captions still prevent confirmation', () => {
  const page = fixture();
  page.details.append(page.element('a', { href: 'https://www.tiktok.com/@other/' }, '@other'));
  page.like.attrs['aria-pressed'] = 'true';
  assert.equal(page.inspect({ id: 'https://www.tiktok.com/@creator/video/123/', author: '@creator', action: 'verify-like' }).confirmed, false);
});
