const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, commentComposer } = require('./fixtures/tiktok-comment-composer.cjs');
const id = 'https://www.tiktok.com/@creator/video/123/';

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

test('unknown comment composers stay unavailable and non-tiktok pages are blocked', () => {
  const page = fixture();
  assert.equal(page.inspect({ id, action: 'comment-field' }).point, null);
  assert.equal(page.inspect({ id, action: 'verify-comment' }).confirmed, false);
  assert.match(fixture({ href: 'https://example.com/' }).inspect().blocked, /open tiktok/);
});


for (const modal of [false, true]) {
  test(`TikTok ${modal ? 'dialog' : 'permalink'} comments use their exact contenteditable and submit once`, () => {
    const h = commentComposer({ modal });
    assert.equal(h.context.inspectTikTok().post.comment, true);
    assert.ok(h.inspect('comment-field').point);
    h.field.focus();
    assert.equal(h.inspect('comment-ready').ready, true);
    h.field.textContent = h.request.comment; h.submit.disabled = false;
    h.context.collectiveCommentBefore.drafted = true;
    h.document.activeElement = h.heading;
    assert.ok(h.inspect('comment-submit').point);
    assert.equal(h.inspect('click-comment-submit').clicked, true);
    assert.equal(h.inspect('click-comment-submit').clicked, false);
    assert.equal(h.inspect('verify-comment').confirmed, true);
    assert.equal(h.submitted, 1);
    assert.equal(h.context.inspectTikTok().post.caption, h.request.caption);
  });
}

test('a closed TikTok comment panel is opened once before preparing its composer', () => {
  const h = commentComposer({ open: false, modal: false });
  assert.equal(h.context.inspectTikTok().post.comment, true);
  assert.equal(h.inspect('comment-field').point, null);
  assert.equal(h.inspect('click-comment-open').opened, true);
  assert.equal(h.state.opens, 1);
  assert.equal(h.inspect('click-comment-open').opened, true);
  assert.equal(h.state.opens, 1);
  assert.ok(h.inspect('comment-field').point);
});

test('re-reading an empty TikTok field retains its baseline and manual interruption', () => {
  const h = commentComposer();
  assert.ok(h.inspect('comment-field').point);
  const before = h.context.collectiveCommentBefore;
  assert.ok(h.inspect('comment-field').point);
  assert.equal(h.context.collectiveCommentBefore, before);
  h.interact('pointerdown');
  assert.equal(h.inspect('comment-field').point, null);
  assert.equal(h.context.collectiveCommentBefore, before);
  h.field.focus();
  assert.equal(h.inspect('comment-ready').ready, false);
});

test('TikTok does not overwrite existing text or post without a resolved account', () => {
  const existing = commentComposer(); existing.field.textContent = 'my unfinished comment';
  assert.equal(existing.inspect('comment-field').point, null);
  assert.equal(existing.field.textContent, 'my unfinished comment');
  const unknown = commentComposer(); unknown.profile.attrs['data-e2e'] = 'someone-else';
  assert.equal(unknown.context.inspectTikTok().post.comment, false);
  assert.equal(unknown.inspect('comment-field').point, null);
});

test('an existing identical own TikTok comment prevents an ambiguous duplicate', () => {
  const h = commentComposer(); h.addComment(h.request.comment);
  assert.equal(h.inspect('comment-field').point, null);
  assert.equal(h.inspect('click-comment-submit').clicked, false);
  assert.equal(h.submitted, 0);
});

test('trusted browser input is allowed only inside the extension controlled input window', () => {
  for (const controlled of [true, false]) {
    const h = commentComposer(); h.inspect('comment-field'); h.field.focus();
    const before = h.context.collectiveCommentBefore;
    before.drafted = true; before.inputting = controlled;
    const range = h.document.createRange(); range.selectNodeContents(h.field);
    h.document.getSelection().addRange(range);
    h.document.execCommand('insertText', false, h.request.comment);
    before.inputting = false;
    assert.equal(Boolean(h.inspect('comment-submit').point), controlled);
    assert.equal(before.interrupted, !controlled);
  }
});

test('TikTok manual edits and manual post interactions revoke draft ownership', () => {
  for (const event of ['input', 'beforeinput', 'pointerdown', 'keydown', 'click', 'submit']) {
    const h = commentComposer(); h.prepare();
    h.interact(event, true, event === 'click' || event === 'submit' ? h.submit : h.field);
    assert.equal(h.inspect('comment-submit').point, null);
    assert.equal(h.inspect('click-comment-submit').clicked, false);
    assert.equal(h.inspect('comment-clear').point, null);
    assert.equal(h.field.textContent, h.request.comment);
  }
});

test('TikTok rejects changed account, post author, caption and edited draft text', () => {
  for (const change of [
    h => { h.profile.attrs.href = 'https://www.tiktok.com/@someoneelse/'; },
    h => { h.request.author = '@differentcreator'; },
    h => { h.heading.ownText = 'a changed caption'; },
    h => { h.field.textContent = 'an edited comment'; }
  ]) {
    const h = commentComposer(); h.prepare(); change(h);
    assert.equal(h.inspect('click-comment-submit').clicked, false);
    assert.equal(h.submitted, 0);
  }
});

test('an untouched TikTok draft follows a detached editor replacement without being written twice', () => {
  const h = commentComposer(); h.prepare();
  const original = h.field;
  h.replaceField(h.request.comment);
  assert.equal(original.isConnected, false);
  assert.ok(h.inspect('comment-submit').point);
  assert.equal(h.context.collectiveCommentBefore.composer, h.field);
  assert.equal(h.inspect('click-comment-submit').clicked, true);
  assert.equal(h.submitted, 1);
  assert.equal(h.inspect('verify-comment').confirmed, true);
});

test('a replacement TikTok editor cannot be adopted after manual input or caption changes', () => {
  for (const change of [h => h.interact('input'), h => { h.heading.ownText = 'changed caption'; }]) {
    const h = commentComposer(); h.prepare(); h.replaceField(h.request.comment); change(h);
    assert.equal(h.inspect('comment-submit').point, null);
    assert.equal(h.inspect('comment-clear').point, null);
  }
});

test('only an untouched unsubmitted TikTok draft can be cleared', () => {
  const h = commentComposer(); h.prepare();
  assert.ok(h.inspect('comment-clear').point);
  h.context.collectiveCommentBefore.clearing = true;
  h.field.textContent = '';
  assert.equal(h.inspect('comment-cleared').cleared, true);
  const submitted = commentComposer(); submitted.state.confirm = false; submitted.prepare();
  submitted.inspect('click-comment-submit');
  assert.equal(submitted.inspect('comment-clear').point, null);
  assert.equal(submitted.field.textContent, submitted.request.comment);
});

test('TikTok comment confirmation requires a new own row, cleared editor and the submitted flag', () => {
  for (const change of [
    h => { h.state.confirm = false; },
    h => { h.state.onSubmit = () => { h.rows.at(-1).author.attrs.href = 'https://www.tiktok.com/@someoneelse/'; }; },
    h => { h.state.onSubmit = () => { h.field.textContent = h.request.comment; }; },
    h => { h.state.onSubmit = () => { h.context.collectiveCommentBefore.submitted = false; }; },
    h => { h.state.onSubmit = () => { h.rows[0].text.ownText = 'changed baseline'; }; },
    h => { h.state.onSubmit = () => { h.rows[0].row.remove(); }; },
    h => { h.state.onSubmit = () => { h.addComment(h.request.comment); }; },
    h => { h.state.onSubmit = () => { h.rows.at(-1).row.hidden = true; }; }
  ]) {
    const h = commentComposer(); h.prepare(); change(h);
    assert.equal(h.inspect('click-comment-submit').clicked, true);
    assert.equal(h.inspect('verify-comment').confirmed, false);
    assert.equal(h.inspect('click-comment-submit').clicked, false);
  }
});

test('a TikTok rejection during drafting blocks submit and leaves the draft untouched', () => {
  const h = commentComposer(); h.prepare(); h.state.blocked = true;
  assert.equal(h.inspect('click-comment-submit').blockReason, 'rate-limit');
  assert.equal(h.submitted, 0);
  assert.equal(h.field.textContent, h.request.comment);
});


test('an empty Draft.js placeholder newline does not count as an existing comment', () => {
  const h = commentComposer();
  Object.defineProperty(h.field, 'innerText', { get: () => '\n' });
  assert.equal(h.field.textContent, '');
  assert.ok(h.inspect('comment-field').point);
  h.field.focus();
  assert.equal(h.inspect('comment-ready').ready, true);
});


test('comment text cannot trigger a warning, but a nearby platform rejection stops submission', () => {
  const h = commentComposer(); h.addComment('Too many requests');
  assert.ok(h.context.inspectTikTok().post);
  h.prepare();
  h.input.append(h.element('p', {}, "You're commenting too fast", h.rect(350, 670, 250, 25)));
  assert.equal(h.inspect('click-comment-submit').blockReason, 'rate-limit');
  assert.equal(h.submitted, 0);
  const failed = commentComposer();
  failed.input.append(failed.element('p', {}, "Couldn't post comment. Try again.", failed.rect(350, 670, 300, 25)));
  assert.equal(failed.inspect('comment-field').blockReason, 'comment-failed');
});


test('a single TikTok reply composer cannot be used for a top-level comment before or after drafting', () => {
  for (const drafted of [false, true]) {
    const h = commentComposer();
    if (drafted) h.prepare();
    const placeholder = h.element('div', { id: 'reply-placeholder' }, 'Add a reply...', h.rect(350, 600, 200, 30));
    h.input.append(placeholder); h.field.attrs['aria-describedby'] = 'reply-placeholder';
    assert.equal(h.context.inspectTikTok().post.comment, false);
    assert.equal(h.inspect('click-comment-open').opened, false);
    assert.equal(h.inspect('comment-field').point, null);
    assert.equal(h.inspect('click-comment-submit').clicked, false);
    assert.equal(h.inspect('comment-clear').point, null);
    assert.equal(h.submitted, 0);
  }
});

test('the live two-editor reply layout never selects or toggles either composer', () => {
  const h = commentComposer();
  const input = h.element('div', { 'data-e2e': 'comment-input' }, '', h.rect(350, 420, 280, 60));
  const editor = h.element('div', { 'data-e2e': 'comment-text' }, '', h.rect(350, 420, 280, 60));
  const reply = h.element('div', { contenteditable: 'true', role: 'textbox', 'aria-label': 'Add a reply...' }, '', h.rect(350, 420, 280, 60));
  editor.append(reply); input.append(editor); h.main.append(input);
  assert.equal(h.context.inspectTikTok().post.comment, false);
  assert.equal(h.inspect('click-comment-open').opened, false);
  assert.equal(h.inspect('comment-field').point, null);
  assert.equal(h.inspect('click-comment-submit').clicked, false);
  assert.equal(h.state.opens, 0);
});

const photoId = 'https://www.tiktok.com/@creator/photo/234/';

test('TikTok search sequence skips hidden preload links and retains rendered offscreen video and photo order', () => {
  const page = fixture({ href: 'https://www.tiktok.com/search?q=branding' });
  const hidden = page.element('a', { href: 'https://www.tiktok.com/@hidden/video/1/' }, '', page.rect(0, 0, 0, 0));
  const hiddenParent = page.element('div', { 'aria-hidden': 'true' });
  hiddenParent.append(page.element('a', { href: 'https://www.tiktok.com/@hidden/photo/2/' }));
  page.main.children.unshift(hidden, hiddenParent); hidden.parentElement = page.main; hiddenParent.parentElement = page.main;
  page.main.append(page.element('a', { href: photoId }, '', page.rect(350, 900, 200, 100)));
  assert.deepEqual(Array.from(page.inspect().sequence), [id, photoId]);
  assert.deepEqual(Array.from(page.inspect().posts), [id]);
  assert.equal(page.inspect().post, null);
});

for (const modal of [false, true]) {
  test(`a ${modal ? 'dialog' : 'permalink'} photo keeps active slides and post engagement separate`, () => {
    const page = fixture({ postId: photoId, modal, withPhoto: true });
    // TikTok's clipped neighboring slide can still intersect the viewport.
    const neighbor = page.element('div', { class: 'swiper-slide' }, '', page.rect(250, 60, 340, 500));
    const image = page.element('img', { class: 'ImgPhotoSlide' }, '', page.rect(250, 60, 340, 500));
    Object.assign(image, { complete: true, naturalWidth: 928, naturalHeight: 1400 }); neighbor.append(image); page.carousel.append(neighbor);
    const horizontal = page.element('button', { 'data-e2e': 'arrow-right', 'aria-label': 'Next' }, '', page.rect(200, 650, 60, 36));
    page.carousel.append(horizontal);
    const post = page.inspect().post;
    assert.equal(post.id, photoId); assert.equal(post.videoRemainingMs, null); assert.equal(post.next, true);
    assert.equal(page.inspect({ id: photoId, action: 'click-like' }).clicked, true);
    assert.equal(page.inspect({ id: photoId, action: 'verify-like' }).confirmed, true);
    assert.equal(page.inspect({ id: photoId, author: '@creator', action: 'click-follow' }).clicked, true);
    assert.equal(page.inspect({ id: photoId, author: '@creator', action: 'verify-follow' }).confirmed, true);
    assert.equal(page.inspect({ id: photoId, action: 'click-next' }).clicked, true);
    assert.deepEqual(page.clicks, [page.like, page.follow, page.next]);
    page.next.remove();
    assert.equal(page.inspect().post.next, false);
    assert.equal(page.inspect({ id: photoId, action: 'click-next' }).clicked, false);
  });
}

test('public photo article requires matching author and loaded media even without a permalink anchor', () => {
  const page = fixture({ postId: photoId, withPhoto: true });
  page.article.attrs = { 'data-e2e': 'recommend-list-item-container', 'data-scroll-index': '0' };
  page.media.tagName = 'SECTION'; page.media.attrs['data-e2e'] = 'feed-video';
  page.link.remove();
  const offscreen = page.element('article', { 'data-e2e': 'recommend-list-item-container', 'data-scroll-index': '1' }, '', page.rect(0, 900, 750, 650));
  offscreen.append(page.element('video', {}, '', page.rect(0, 900, 340, 500)));
  page.main.append(offscreen);
  assert.equal(page.inspect().post.id, photoId);
  assert.equal(page.inspect().post.like, true);
  page.photo.complete = false;
  assert.equal(page.inspect().post, null);
  page.photo.complete = true; page.author.attrs.href = 'https://www.tiktok.com/@someoneelse/';
  assert.equal(page.inspect().post, null);
});

test('photo grid thumbnails, ambiguous media, and a video loaded under a photo identity cannot receive actions', () => {
  const grid = fixture({ href: 'https://www.tiktok.com/search?q=branding', postId: photoId, withPhoto: true });
  assert.equal(grid.inspect().post, null);
  assert.deepEqual(Array.from(grid.inspect().posts), [photoId]);
  const mismatch = fixture({ postId: photoId });
  assert.equal(mismatch.inspect().post, null);
  const ambiguous = fixture({ postId: photoId, withPhoto: true });
  const image = ambiguous.element('img', { class: 'ImgPhotoSlide', src: 'https://p16-sign.tiktokcdn-us.com/photos/ambiguous.jpeg' }, '', ambiguous.rect(400, 60, 340, 500));
  const secondCarousel = ambiguous.element('div', { class: 'swiper-horizontal' }, '', ambiguous.rect(400, 60, 340, 500));
  const secondSlide = ambiguous.element('div', { class: 'swiper-slide swiper-slide-active' }, '', ambiguous.rect(400, 60, 340, 500));
  Object.assign(image, { complete: true, naturalWidth: 928, naturalHeight: 1400 }); secondSlide.append(image); secondCarousel.append(secondSlide); ambiguous.main.append(secondCarousel);
  assert.equal(ambiguous.inspect().post, null);
  for (const page of [grid, mismatch, ambiguous]) {
    assert.equal(page.inspect({ id: photoId, action: 'click-like' }).clicked, false);
    assert.equal(page.clicks.length, 0);
  }
});

for (const modal of [false, true]) {
  test(`photo ${modal ? 'dialog' : 'permalink'} comments submit once and require a new own exact row`, () => {
    const h = commentComposer({ modal, postId: photoId, withPhoto: true });
    assert.equal(h.context.inspectTikTok().post.comment, true);
    h.prepare();
    assert.equal(h.inspect('click-comment-submit').clicked, true);
    assert.equal(h.inspect('click-comment-submit').clicked, false);
    assert.equal(h.inspect('verify-comment').confirmed, true);
    assert.equal(h.submitted, 1);
    h.profile.attrs.href = 'https://www.tiktok.com/@someoneelse/';
    assert.equal(h.inspect('verify-comment').confirmed, false);
  });
}

test('photo comments preserve manual drafts and reject an unexpected post identity', () => {
  const manual = commentComposer({ postId: photoId, withPhoto: true });
  manual.field.textContent = 'my draft';
  assert.equal(manual.inspect('comment-field').point, null);
  assert.equal(manual.inspect('click-comment-submit').clicked, false);
  const moved = commentComposer({ postId: photoId, withPhoto: true }); moved.prepare();
  moved.context.location = new URL(photoId.replace('/234/', '/999/'));
  assert.equal(moved.inspect('click-comment-submit').clicked, false);
  assert.equal(moved.submitted, 0);
});


test('legacy video next controls remain usable while photo carousel controls never become post-next', () => {
  for (const attrs of [{ 'data-e2e': 'arrow-right' }, { 'aria-label': 'Next' }]) {
    const video = fixture(); video.next.attrs = attrs;
    assert.equal(video.inspect().post.next, true);
    assert.equal(video.inspect({ id, action: 'click-next' }).clicked, true);
    const photo = fixture({ postId: photoId, withPhoto: true }); photo.next.attrs = attrs;
    assert.equal(photo.inspect().post.next, false);
  }
  const photo = fixture({ postId: photoId, withPhoto: true });
  photo.next.remove(); photo.next.attrs = { 'data-e2e': 'browse-next', 'aria-label': 'Next post' }; photo.carousel.append(photo.next);
  assert.equal(photo.inspect().post.next, false);
  assert.equal(photo.inspect({ id: photoId, action: 'click-next' }).clicked, false);
});


test('a URL change cannot relabel the same unanchored photo before its media updates, including reinjection', () => {
  const page = fixture({ postId: photoId, withPhoto: true }); page.link.remove();
  assert.equal(page.inspect().post.id, photoId);
  const nextId = photoId.replace('/234/', '/999/');
  page.context.location = new URL(nextId);
  page.load();
  assert.equal(page.inspect().post, null);
  assert.equal(page.inspect({ id: nextId, author: '@creator', action: 'click-like' }).clicked, false);
  assert.equal(page.clicks.length, 0);
  page.photo.attrs.src = 'https://p16-sign.tiktokcdn-us.com/photos/999.jpeg?token=new';
  assert.equal(page.inspect().post.id, nextId);
  assert.equal(page.inspect({ id: nextId, author: '@creator', action: 'click-like' }).clicked, true);
});

test('recreated photo nodes and CDN token refreshes preserve the previous post binding', () => {
  const page = fixture({ postId: photoId, withPhoto: true }); page.link.remove();
  assert.equal(page.inspect().post.id, photoId);
  const nextId = photoId.replace('/234/', '/999/');
  const clone = fixture({ postId: photoId, withPhoto: true }); clone.link.remove();
  clone.photo.attrs.src = clone.photo.attrs.src.replace('?token=first', '?token=refreshed&expires=99999');
  page.context.document = clone.document; page.context.location = new URL(nextId); page.load();
  assert.equal(page.inspect().post, null);
  assert.equal(page.inspect({ id: nextId, author: '@creator', action: 'click-follow' }).clicked, false);
  assert.equal(clone.clicks.length, 0);
  page.context.location = new URL(photoId + '?image_index=14&q=branding');
  assert.equal(page.inspect().post.id, photoId);
});

test('photo autoplay uses the whole source set instead of rebinding each active slide', () => {
  const page = fixture({ postId: photoId, withPhoto: true }); page.link.remove();
  const nextSlide = page.element('div', { class: 'swiper-slide' }, '', page.rect(0, 60, 340, 500));
  const nextImage = page.element('img', { class: 'ImgPhotoSlide', src: 'https://p16-sign.tiktokcdn-us.com/photos/234-slide-2.jpeg?token=first' }, '', page.rect(0, 60, 340, 500));
  Object.assign(nextImage, { complete: true, naturalWidth: 928, naturalHeight: 1400 }); nextSlide.append(nextImage); page.carousel.append(nextSlide);
  assert.equal(page.inspect().post.id, photoId);
  page.slide.attrs.class = 'swiper-slide'; nextSlide.attrs.class = 'swiper-slide swiper-slide-active';
  page.context.location = new URL(photoId + '?image_index=2');
  assert.equal(page.inspect().post.id, photoId);
  page.slide.remove();
  const nextId = photoId.replace('/234/', '/999/'); page.context.location = new URL(nextId);
  assert.equal(page.inspect().post, null);
  assert.equal(page.inspect({ id: nextId, action: 'click-like' }).clicked, false);
  assert.equal(page.clicks.length, 0);
});

test('unrecognized posters and source-less photo media cannot acquire a photo identity', () => {
  for (const change of [
    page => { page.photo.attrs.class = 'video-poster'; },
    page => { page.carousel.attrs.class = 'video-player'; },
    page => { delete page.photo.attrs.src; },
  ]) {
    const page = fixture({ postId: photoId, withPhoto: true }); change(page);
    assert.equal(page.inspect().post, null);
    assert.equal(page.inspect({ id: photoId, action: 'click-like' }).clicked, false);
    assert.equal(page.clicks.length, 0);
  }
});
