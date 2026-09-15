const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, commentComposer, searchCommentViewer, freshCommentThread } = require('./fixtures/tiktok-comment-composer.cjs');
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

for (const withPhoto of [false, true]) {
  test(`the live search ${withPhoto ? 'photo' : 'video'} panel keeps primary actions separate from its comments`, () => {
    const h = searchCommentViewer({ withPhoto });
    const commentLike = h.element('button', { 'data-e2e': 'like-icon', 'aria-label': 'Unlike', 'aria-pressed': 'true' }, '', h.rect(680, 270, 40, 25));
    const commentFollow = h.element('button', { 'data-e2e': 'follow-button' }, 'Following', h.rect(550, 250, 70, 25));
    h.rows[0].row.append(commentLike, commentFollow);
    const post = h.context.inspectTikTok().post;
    assert.equal(post?.id, h.request.id);
    assert.equal(post.caption, h.request.caption);
    assert.equal(post.like, true); assert.equal(post.follow, true); assert.equal(post.comment, true);
    assert.equal(h.inspect('verify-like').confirmed, false);
    assert.equal(h.inspect('verify-follow').confirmed, false);
    assert.equal(h.inspect('click-like').clicked, true);
    assert.equal(h.inspect('verify-like').confirmed, true);
    assert.equal(h.inspect('click-follow').clicked, true);
    assert.equal(h.inspect('verify-follow').confirmed, true);
    h.prepare();
    assert.equal(h.inspect('click-comment-submit').clicked, true);
    assert.equal(h.inspect('click-comment-submit').clicked, false);
    assert.equal(h.inspect('verify-comment').confirmed, true);
    assert.equal(h.submitted, 1);
    assert.deepEqual(h.clicks, [h.like, h.follow, h.submit]);
  });

  test(`the search ${withPhoto ? 'photo' : 'video'} composer avatar does not replace the post author or comment identity`, () => {
    const h = searchCommentViewer({ withPhoto });
    assert.equal(h.input.contains(h.composerAvatar), false);
    assert.equal(h.footer.contains(h.composerAvatar), true);
    const post = h.context.inspectTikTok().post;
    assert.equal(post?.id, h.request.id);
    assert.equal(post.author, '@creator');
    assert.equal(post.follow, true);
    h.prepare();
    assert.equal(h.context.collectiveCommentBefore.author, '@me');
    assert.equal(h.inspect('click-comment-submit').clicked, true);
    assert.equal(h.inspect('verify-comment').confirmed, true);
    assert.equal(h.rows.at(-1).author.href, 'https://www.tiktok.com/@me/');
    assert.equal(h.submitted, 1);
  });
}

test('search comment and reply controls cannot replace missing primary post controls', () => {
  for (const attrs of [
    ...['comment-list', 'comment-item', 'comment-level-1', 'comment-level-2', 'comment-input', 'comment-text'].map(marker => ({ 'data-e2e': marker })),
    { class: 'DivCommentItemContainer' }, { class: 'DivCommentContentContainer' },
    { class: 'DivCommentBarContainer' }, { class: 'DivEnhancedBottomCommentContainer' }
  ]) {
    const marker = attrs['data-e2e'] || attrs.class;
    const h = searchCommentViewer({ open: false });
    h.like.remove(); h.follow.remove(); h.openButton.remove();
    const row = h.element('div', attrs, '', h.rect(350, 220, 350, 120));
    row.append(h.element('a', { href: 'https://www.tiktok.com/@creator/' }, '@creator', h.rect(350, 220, 100, 25)),
      h.element('button', { 'data-e2e': 'like-icon', 'aria-label': 'Unlike', 'aria-pressed': 'true' }, '', h.rect(350, 260, 60, 30)),
      h.element('button', { 'data-e2e': 'follow-button' }, 'Following', h.rect(500, 260, 80, 30)),
      h.element('button', { 'data-e2e': 'comment-icon' }, 'Comments', h.rect(600, 260, 80, 30)));
    h.details.append(row);
    const post = h.context.inspectTikTok().post;
    assert.equal(post.like, false, marker); assert.equal(post.follow, false, marker); assert.equal(post.comment, false, marker);
    assert.equal(h.inspect('verify-like').confirmed, false, marker);
    assert.equal(h.inspect('verify-follow').confirmed, false, marker);
    assert.equal(h.inspect('click-like').clicked, false, marker);
    assert.equal(h.inspect('click-follow').clicked, false, marker);
    assert.equal(h.inspect('click-comment-open').opened, false, marker);
    assert.equal(h.clicks.length, 0, marker);
  }
});

test('search panel photo ownership ignores comment authors but rejects a different primary author', () => {
  const h = searchCommentViewer({ withPhoto: true });
  assert.equal(h.context.inspectTikTok().post?.id, h.request.id);
  h.author.attrs.href = 'https://www.tiktok.com/@wrongcreator/';
  assert.equal(h.context.inspectTikTok().post, null);
  assert.equal(h.inspect('click-like').clicked, false);
  assert.equal(h.inspect('click-follow').clicked, false);
  assert.equal(h.inspect('click-comment-submit').clicked, false);
  assert.equal(h.clicks.length, 0);
});

test('a genuine second photo author outside the composer still makes ownership ambiguous', () => {
  const h = searchCommentViewer({ withPhoto: true });
  assert.equal(h.context.inspectTikTok().post?.id, h.request.id);
  const otherDetails = h.element('div', { class: 'DivContentContainer' }, '', h.rect(350, 190, 200, 30));
  otherDetails.append(h.element('a', { href: 'https://www.tiktok.com/@othercreator/' }, '@othercreator', h.rect(350, 190, 150, 25)));
  h.panelContent.append(otherDetails);
  assert.equal(h.context.inspectTikTok().post, null);
  assert.equal(h.inspect('click-like').clicked, false);
  assert.equal(h.inspect('click-follow').clicked, false);
  assert.equal(h.inspect('click-comment-submit').clicked, false);
  assert.equal(h.clicks.length, 0);
});

test('a genuine second video author still prevents following the ambiguous header', () => {
  const h = searchCommentViewer();
  h.header.append(h.element('a', { href: 'https://www.tiktok.com/@othercreator/' }, '@othercreator', h.rect(600, 0, 120, 25)));
  assert.equal(h.context.inspectTikTok().post?.follow, false);
  assert.equal(h.inspect('click-follow').clicked, false);
  assert.equal(h.clicks.length, 0);
});

test('a failed TikTok photo viewer exposes only its close recovery', () => {
  const h = searchCommentViewer({ withPhoto: true });
  h.header.remove(); h.caption.remove(); h.actions.remove();
  h.details.append(
    h.element('h2', {}, 'Something went wrong', h.rect(400, 120, 220, 35)),
    h.element('p', {}, 'Sorry about that! Please try again later.', h.rect(400, 170, 280, 35))
  );
  const page = h.context.inspectTikTok();
  assert.equal(page.post, null);
  assert.equal(page.unavailableViewer, h.request.id);
  assert.equal(h.inspect('click-close').clicked, true);
  assert.deepEqual(h.clicks, [h.close]);
});

function failedPhotoViewer() {
  const h = searchCommentViewer({ withPhoto: true });
  h.header.remove(); h.caption.remove(); h.actions.remove();
  h.details.append(
    h.element('h2', {}, 'Something went wrong', h.rect(400, 120, 220, 35)),
    h.element('p', {}, 'Sorry about that! Please try again later.', h.rect(400, 170, 280, 35))
  );
  return h;
}

test('failed TikTok viewers remain unavailable when close is missing, ambiguous, disabled or covered', () => {
  for (const change of [
    h => h.close.remove(),
    h => h.main.append(h.element('button', { 'aria-label': 'Close' }, '', h.rect(620, 0, 60, 36))),
    h => { h.close.disabled = true; },
    h => { h.close.attrs['aria-disabled'] = 'true'; },
    h => h.body.append(h.element('div', {}, 'overlay', h.close.bounds))
  ]) {
    const h = failedPhotoViewer(); change(h);
    assert.equal(h.context.inspectTikTok().unavailableViewer, h.request.id);
    assert.equal(h.inspect('click-close').clicked, false);
    assert.equal(h.clicks.length, 0);
  }
});

test('failed viewer close normalizes a wrapper to its one usable button and retains post identity', () => {
  const h = failedPhotoViewer();
  h.close.attrs = { 'data-e2e': 'browse-close' }; h.close.tagName = 'DIV';
  const button = h.element('button', { 'aria-label': 'Close' }, '', h.close.bounds);
  h.close.append(button);
  assert.equal(h.context.inspectTikTok({ ...h.request, id: id, action: 'click-close' }).clicked, false);
  assert.equal(h.inspect('click-close').clicked, true);
  assert.deepEqual(h.clicks, [button]);
});

test('failed viewer recovery ignores caption, comment and editor text and preserves platform restrictions', () => {
  for (const parent of ['caption', 'field', 'comment']) {
    const h = searchCommentViewer({ withPhoto: true });
    const container = parent === 'comment' ? h.rows[0].text : h[parent];
    container.append(
      h.element('h2', {}, 'Something went wrong', h.rect(400, 120, 220, 35)),
      h.element('p', {}, 'Sorry about that! Please try again later.', h.rect(400, 170, 280, 35))
    );
    assert.equal(h.context.inspectTikTok().unavailableViewer, undefined, parent);
  }
  for (const warning of ['Too many requests', 'Verify to continue', 'Access denied']) {
    const h = failedPhotoViewer();
    h.details.append(h.element('p', {}, warning, h.rect(400, 220, 280, 35)));
    assert.ok(h.context.inspectTikTok().blocked, warning);
    assert.ok(h.inspect('click-close').blocked, warning);
    assert.equal(h.clicks.length, 0, warning);
  }
});

test('a restriction displayed beside the search panel composer still stops actions', () => {
  const h = searchCommentViewer();
  h.input.append(h.element('p', {}, "You're commenting too fast", h.rect(350, 670, 250, 25)));
  assert.equal(h.inspect('click-like').blockReason, 'rate-limit');
  assert.equal(h.inspect('click-comment-submit').blockReason, 'rate-limit');
  assert.equal(h.clicks.length, 0);
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

test('follow markers require an explicit Follow action, not an unknown or different action', () => {
  for (const marker of ['follow-button', 'browse-follow', 'feed-follow', 'follow-icon']) {
    for (const text of ['Message', 'Remove', 'Follow back', 'Follow @someoneelse', 'Loading', '']) {
      if (marker === 'follow-icon' && text === '') continue;
      const page = fixture(); page.follow.attrs = { 'data-e2e': marker }; page.follow.ownText = text;
      assert.equal(page.inspect().post.follow, false, `${marker}: ${text}`);
      assert.equal(page.inspect({ id, author: '@creator', action: 'click-follow' }).clicked, false, `${marker}: ${text}`);
      assert.equal(page.inspect({ id, author: '@creator', action: 'verify-follow' }).confirmed, false, `${marker}: ${text}`);
      assert.equal(page.clicks.length, 0);
    }
  }
  for (const text of ['Follow', 'Follow @creator']) {
    const page = fixture(); page.follow.ownText = text;
    assert.equal(page.inspect().post.follow, true, text);
    assert.equal(page.inspect({ id, author: '@creator', action: 'click-follow' }).clicked, true, text);
  }
});

test('known unlabeled follow icons remain eligible without trusting generic unlabeled markers', () => {
  for (const wrapped of [false, true]) {
    const page = fixture(); page.follow.attrs = { 'data-e2e': 'follow-icon' }; page.follow.ownText = '';
    let control = page.follow;
    if (wrapped) {
      page.follow.remove(); page.follow.onClick = null;
      control = page.element('button', {}, '', page.rect(500, 0, 80, 30));
      control.onClick = () => { control.attrs['aria-label'] = 'Unfollow'; };
      control.append(page.follow); page.header.append(control);
    }
    assert.equal(page.inspect().post.follow, true);
    assert.equal(page.inspect({ id, author: '@creator', action: 'click-follow' }).clicked, true);
    assert.equal(page.inspect({ id, author: '@creator', action: 'verify-follow' }).confirmed, true);
    assert.equal(page.inspect({ id, author: '@creator', action: 'click-follow' }).clicked, false);
    assert.deepEqual(page.clicks, [control]);
  }
});

test('follow action labels must agree across the visible control and its wrapper', () => {
  for (const text of ['Message', 'Remove', 'Loading', 'Follow @someoneelse']) {
    for (const placement of ['text', 'title', 'wrapper']) {
      const page = fixture();
      page.follow.attrs['aria-label'] = 'Follow';
      if (placement === 'text') page.follow.ownText = text;
      else if (placement === 'title') page.follow.attrs.title = text;
      else {
        page.follow.attrs = { 'data-e2e': 'browse-follow', 'aria-label': text }; page.follow.ownText = '';
        page.follow.append(page.element('button', { 'aria-label': 'Follow' }, 'Follow', page.rect(500, 0, 80, 30)));
      }
      assert.equal(page.inspect().post.follow, false, `${placement}: ${text}`);
      assert.equal(page.inspect({ id, author: '@creator', action: 'click-follow' }).clicked, false);
      assert.equal(page.inspect({ id, author: '@creator', action: 'verify-follow' }).confirmed, false);
      assert.equal(page.clicks.length, 0);
    }
  }
});

test('hidden relationship text cannot confirm a follow or hide a visible action', () => {
  const page = fixture(); page.follow.ownText = ''; page.follow.attrs['aria-label'] = 'Follow';
  const oldLabel = page.element('span', {}, 'Unfollow', page.rect(510, 0, 50, 30)); oldLabel.hidden = true;
  page.follow.append(oldLabel);
  assert.equal(page.inspect({ id, author: '@creator', action: 'verify-follow' }).confirmed, false);
  assert.equal(page.inspect().post.follow, true);
  assert.equal(page.clicks.length, 0);
});

test('visible action text still matters when hidden from accessibility', () => {
  for (const text of ['Unfollow', 'Message']) {
    const page = fixture(); page.follow.ownText = ''; page.follow.attrs['aria-label'] = 'Follow';
    page.follow.append(page.element('span', { 'aria-hidden': 'true' }, text, page.rect(510, 0, 50, 30)));
    assert.equal(page.inspect().post.follow, false, text);
    assert.equal(page.inspect({ id, author: '@creator', action: 'click-follow' }).clicked, false);
    assert.equal(page.inspect({ id, author: '@creator', action: 'verify-follow' }).confirmed, false);
    assert.equal(page.clicks.length, 0);
  }
});

test('complete follow labels remain valid when split across nested spans', () => {
  for (const state of ['Follow', 'Following']) {
    for (const wrapped of [false, true]) {
      const page = fixture(); page.follow.ownText = ''; page.follow.attrs = { 'data-e2e': 'browse-follow', 'aria-label': `${state} @creator` };
      const control = wrapped ? page.element('button', { 'aria-label': `${state} @creator` }, '', page.rect(500, 0, 80, 30)) : page.follow;
      control.append(page.element('span', {}, `${state} `, page.rect(500, 0, 40, 30)), page.element('span', {}, '@creator', page.rect(540, 0, 40, 30)));
      if (wrapped) page.follow.append(control);
      assert.equal(page.inspect().post.follow, state === 'Follow', `${state}, wrapped=${wrapped}`);
      assert.equal(page.inspect({ id, author: '@creator', action: 'verify-follow' }).confirmed, state === 'Following');
      assert.equal(page.inspect({ id, author: '@creator', action: 'click-follow' }).clicked, state === 'Follow');
      assert.equal(page.clicks.length, state === 'Follow' ? 1 : 0);
    }
  }
});

test('conflicting visible relationship labels cannot confirm following', () => {
  for (const text of ['Follow', 'Message', 'Following @someoneelse']) {
    const page = fixture(); page.follow.attrs['aria-label'] = 'Following'; page.follow.ownText = text;
    assert.equal(page.inspect().post.follow, false);
    assert.equal(page.inspect({ id, author: '@creator', action: 'verify-follow' }).confirmed, false);
    assert.equal(page.inspect({ id, author: '@creator', action: 'click-follow' }).clicked, false);
    assert.equal(page.clicks.length, 0);
  }
});

test('current relationship labels always prevent following, including stale positive labels and nested state', () => {
  for (const text of ['Following', 'Friends', 'Requested', 'Unfollow', 'Unfollow @creator']) {
    for (const placement of ['text', 'aria-label', 'title', 'wrapper', 'nested']) {
      const page = fixture();
      if (placement === 'text') { page.follow.attrs['aria-label'] = 'Follow'; page.follow.ownText = text; }
      else if (placement === 'wrapper') {
        page.follow.attrs = { 'data-e2e': 'browse-follow', 'aria-label': text }; page.follow.ownText = '';
        page.follow.append(page.element('button', {}, 'Follow', page.rect(500, 0, 80, 30)));
      } else if (placement === 'nested') {
        page.follow.append(page.element('span', { 'aria-label': text }, '', page.rect(510, 0, 50, 30)));
      } else page.follow.attrs[placement] = text;
      assert.equal(page.inspect().post.follow, false, `${placement}: ${text}`);
      assert.equal(page.inspect({ id, author: '@creator', action: 'click-follow' }).clicked, false, `${placement}: ${text}`);
      assert.equal(page.clicks.length, 0);
    }
  }
});

test('follow eligibility is rechecked after a previously eligible control changes state', () => {
  for (const attrs of [{ 'aria-label': 'Unfollow' }, { 'title': 'Following' }, { 'aria-pressed': 'true' }, { 'data-state': 'requested' }, { 'data-state': 'friends' }, { 'data-state': 'unfollow' }, { 'aria-label': 'Message' }]) {
    const page = fixture({ modal: true });
    page.follow.attrs = { 'data-e2e': 'browse-follow' }; page.follow.ownText = '';
    const button = page.element('button', {}, 'Follow', page.rect(500, 0, 80, 30)); page.follow.append(button);
    assert.equal(page.inspect().post.follow, true);
    Object.assign(button.attrs, attrs);
    assert.equal(page.inspect({ id, author: '@creator', action: 'follow' }).point, null);
    assert.equal(page.inspect({ id, author: '@creator', action: 'click-follow' }).clicked, false);
    assert.equal(page.clicks.length, 0);
  }
});

test('a stale Follow label cannot override a nested unfollow icon or another named account', () => {
  const page = fixture();
  page.follow.append(page.element('span', { 'data-e2e': 'unfollow-icon' }, '', page.rect(510, 0, 50, 30)));
  assert.equal(page.inspect().post.follow, false);
  assert.equal(page.inspect({ id, author: '@creator', action: 'click-follow' }).clicked, false);
  assert.equal(page.clicks.length, 0);
  const other = fixture(); other.follow.ownText = 'Unfollow @someoneelse';
  assert.equal(other.inspect().post.follow, false);
  assert.equal(other.inspect({ id, author: '@creator', action: 'verify-follow' }).confirmed, false);
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
    h.interact('beforeinput');
    h.field.textContent = h.request.comment;
    h.submit.disabled = false;
    h.interact('input');
    before.inputting = false;
    assert.equal(Boolean(h.inspect('comment-submit').point), controlled);
    assert.equal(before.interrupted, !controlled);
  }
});

test('delayed trusted input keeps exact extension drafts owned after an editor replacement', () => {
  for (const replace of [false, true]) {
    const h = commentComposer(); h.prepare();
    const before = h.context.collectiveCommentBefore;
    before.inputtingUntil = Date.now() + 1000;
    if (replace) h.replaceField(h.request.comment);
    h.interact('input');
    assert.equal(before.interrupted, false);
    assert.ok(h.inspect('comment-submit').point);
    assert.equal(before.composer, h.field);
    assert.equal(h.inspect('click-comment-submit').clicked, true);
    assert.equal(h.submitted, 1);
  }
});

test('the delayed input window never excuses manual events, unknown text or a changed comment context', () => {
  for (const change of [
    h => h.interact('beforeinput'),
    h => h.interact('pointerdown'),
    h => h.interact('keydown'),
    h => h.interact('click'),
    h => { h.field.textContent = ''; h.interact('input'); },
    h => { h.field.textContent = 'my edit'; h.interact('input'); },
    h => { h.heading.ownText = 'changed caption'; h.interact('input'); },
    h => { h.profile.attrs.href = 'https://www.tiktok.com/@someoneelse/'; h.interact('input'); },
    h => { h.context.location = new URL(id.replace('123', '999')); h.interact('input'); },
    h => { h.context.collectiveCommentBefore.inputtingUntil = Date.now() - 1; h.interact('input'); },
    h => {
      const other = h.element('div', { contenteditable: 'true', role: 'textbox' }, h.request.comment, h.field.bounds);
      h.editor.append(other); h.interact('input', true, other);
    }
  ]) {
    for (const replace of [false, true]) {
      const h = commentComposer(); h.prepare();
      const before = h.context.collectiveCommentBefore;
      before.inputtingUntil = Date.now() + 1000;
      if (replace) h.replaceField(h.request.comment);
      change(h);
      assert.equal(before.interrupted, true);
      assert.equal(h.inspect('click-comment-submit').clicked, false);
      assert.equal(h.inspect('comment-clear').point, null);
      assert.equal(h.submitted, 0);
    }
  }
});

test('a post-submit trusted clear input preserves independently confirmed own comments', () => {
  const h = commentComposer(); h.prepare();
  const before = h.context.collectiveCommentBefore;
  before.inputtingUntil = Date.now() + 1000;
  h.state.onSubmit = () => h.interact('input');
  assert.equal(h.inspect('click-comment-submit').clicked, true);
  assert.equal(before.interrupted, false);
  assert.equal(h.inspect('verify-comment').confirmed, true);
  assert.equal(h.inspect('click-comment-submit').clicked, false);
  assert.equal(h.submitted, 1);
});

test('a submitted editor clear can precede the new own row but never confirms without that row', () => {
  const h = commentComposer(); h.prepare();
  const before = h.context.collectiveCommentBefore;
  before.inputtingUntil = Date.now() - 1;
  h.state.confirm = false;
  h.state.onSubmit = () => { h.field.textContent = ''; h.interact('input'); };
  assert.equal(h.inspect('click-comment-submit').clicked, true);
  assert.equal(before.interrupted, false);
  assert.equal(h.inspect('verify-comment').confirmed, false);
  assert.equal(h.inspect('click-comment-submit').clicked, false);
  h.addComment(h.request.comment);
  assert.equal(h.inspect('verify-comment').confirmed, true);
  assert.equal(h.submitted, 1);
});

test('post-submit input still revokes ownership after manual interaction or changed context', () => {
  for (const change of [
    h => h.interact('beforeinput'),
    h => h.interact('pointerdown'),
    h => h.interact('keydown'),
    h => h.interact('click'),
    h => { h.field.textContent = 'my new draft'; },
    h => { h.heading.ownText = 'changed caption'; },
    h => { h.profile.attrs.href = 'https://www.tiktok.com/@someoneelse/'; },
    h => { h.context.location = new URL(id.replace('123', '999')); },
    h => { h.context.collectiveCommentBefore.inputtingUntil = Date.now() - 1; }
  ]) {
    const h = commentComposer(); h.prepare();
    const before = h.context.collectiveCommentBefore;
    before.inputtingUntil = Date.now() + 1000;
    h.state.onSubmit = () => { change(h); h.interact('input'); };
    assert.equal(h.inspect('click-comment-submit').clicked, true);
    assert.equal(before.interrupted, true);
    assert.equal(h.inspect('verify-comment').confirmed, false);
    assert.equal(h.inspect('click-comment-submit').clicked, false);
    assert.equal(h.submitted, 1);
  }
});

test('a pending post-submit clear cannot confirm missing, wrong, hidden or ambiguous new rows', () => {
  for (const change of [
    h => { h.rows.at(-1).row.remove(); },
    h => { h.rows.at(-1).author.attrs.href = 'https://www.tiktok.com/@someoneelse/'; },
    h => { h.rows.at(-1).row.hidden = true; },
    h => h.addComment(h.request.comment),
    h => { h.rows[0].text.ownText = 'changed baseline'; }
  ]) {
    const h = commentComposer();
    h.rows[0].author.attrs.href = 'https://www.tiktok.com/@me/';
    h.prepare();
    h.state.onSubmit = () => { change(h); h.interact('input'); };
    assert.equal(h.inspect('click-comment-submit').clicked, true);
    assert.equal(h.inspect('verify-comment').confirmed, false);
    assert.equal(h.inspect('click-comment-submit').clicked, false);
    assert.equal(h.submitted, 1);
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
    const h = commentComposer();
    h.rows[0].author.attrs.href = 'https://www.tiktok.com/@me/';
    h.prepare(); change(h);
    assert.equal(h.inspect('click-comment-submit').clicked, true);
    assert.equal(h.inspect('verify-comment').confirmed, false);
    assert.equal(h.inspect('click-comment-submit').clicked, false);
  }
});

test('unrelated TikTok comment changes do not hide one new own submission', () => {
  for (const change of ['removed', 'text', 'author', 'remounted']) {
    const h = commentComposer();
    const old = h.rows[0];
    h.addComment('an older own comment');
    h.prepare();
    h.state.onSubmit = () => {
      if (change === 'text') old.text.ownText = 'edited by someone else';
      if (change === 'author') old.author.attrs.href = 'https://www.tiktok.com/@different/';
      if (change === 'removed' || change === 'remounted') old.row.remove();
      if (change === 'remounted') h.addComment(old.text.textContent, '@someone');
    };
    assert.equal(h.inspect('click-comment-submit').clicked, true);
    assert.equal(h.field.textContent, '');
    assert.equal(h.inspect('verify-comment').confirmed, true);
    assert.equal(h.inspect('click-comment-submit').clicked, false);
    assert.equal(h.submitted, 1);
  }
});

test('an identical own TikTok comment arriving after drafting prevents duplicate submission', () => {
  const h = commentComposer(); h.prepare();
  assert.ok(h.inspect('comment-submit').point);
  h.addComment(h.request.comment);
  assert.equal(h.inspect('comment-submit').point, null);
  assert.equal(h.inspect('click-comment-submit').clicked, false);
  assert.equal(h.inspect('click-comment-submit').reason, 'own-comment-already-exists');
  assert.equal(h.submitted, 0);
  assert.equal(h.field.textContent, h.request.comment);
  assert.equal(h.inspect('verify-comment').confirmed, false);
});

test('a late own TikTok duplicate keeps submission blocked after its row disappears', () => {
  const h = commentComposer(); h.prepare();
  h.submit.disabled = true;
  const duplicate = h.addComment(h.request.comment);
  assert.equal(h.inspect('click-comment-submit').clicked, false);
  duplicate.row.remove();
  h.submit.disabled = false;
  assert.equal(h.inspect('comment-submit').point, null);
  assert.equal(h.inspect('click-comment-submit').clicked, false);
  assert.equal(h.inspect('click-comment-submit').reason, 'own-comment-already-exists');
  assert.equal(h.submitted, 0);
  assert.equal(h.field.textContent, h.request.comment);
});

test('an identical TikTok comment from someone else does not block one own submission', () => {
  const h = commentComposer(); h.prepare();
  h.addComment(h.request.comment, '@someone');
  assert.equal(h.inspect('click-comment-submit').clicked, true);
  assert.equal(h.inspect('verify-comment').confirmed, true);
  assert.equal(h.submitted, 1);
});

test('an unrelated old TikTok row cannot be reused as the new own comment', () => {
  const h = commentComposer(); h.prepare();
  h.state.confirm = false;
  h.state.onSubmit = () => {
    h.field.textContent = '';
    h.rows[0].author.attrs.href = 'https://www.tiktok.com/@me/';
    h.rows[0].text.ownText = h.request.comment;
  };
  assert.equal(h.inspect('click-comment-submit').clicked, true);
  assert.equal(h.inspect('verify-comment').confirmed, false);
  assert.equal(h.inspect('verify-comment').reason, 'own-row-not-new');
  assert.equal(h.inspect('click-comment-submit').clicked, false);
  assert.equal(h.submitted, 1);
});

test('unchanged own TikTok baseline comments can remount with equivalent normalized text', () => {
  for (const modal of [false, true]) {
    const h = commentComposer({ modal });
    const old = h.rows[0];
    old.author.attrs.href = 'https://www.tiktok.com/@me/';
    old.text.ownText = 'an\u00a0existing\r\ncomment';
    h.prepare();
    h.state.onSubmit = () => {
      old.row.remove();
      h.addComment('an existing\ncomment', '@me');
    };
    assert.equal(h.inspect('click-comment-submit').clicked, true);
    assert.equal(old.row.isConnected, false);
    assert.equal(h.inspect('verify-comment').confirmed, true);
    assert.equal(h.inspect('click-comment-submit').clicked, false);
    assert.equal(h.submitted, 1);
  }
});

test('remounting cannot conceal a missing or changed own TikTok baseline comment', () => {
  for (const change of ['missing', 'text', 'author']) {
    const h = commentComposer();
    const old = h.rows[0];
    old.author.attrs.href = 'https://www.tiktok.com/@me/';
    h.prepare();
    h.state.onSubmit = () => {
      old.row.remove();
      if (change !== 'missing') h.addComment(change === 'text' ? 'changed text' : old.text.textContent, change === 'author' ? '@different' : '@me');
    };
    assert.equal(h.inspect('click-comment-submit').clicked, true);
    const result = h.inspect('verify-comment');
    assert.equal(result.confirmed, false);
    assert.equal(result.reason, 'baseline-changed');
  }
});

test('TikTok own baseline preservation retains duplicate comment cardinality after remounting', () => {
  for (const copies of [1, 2]) {
    const h = commentComposer();
    h.rows[0].author.attrs.href = 'https://www.tiktok.com/@me/';
    const text = h.rows[0].text.textContent;
    h.addComment(text, '@me');
    const baseline = [...h.rows];
    h.prepare();
    h.state.onSubmit = () => {
      for (const old of baseline) old.row.remove();
      for (let index = 0; index < copies; index++) h.addComment(text, '@me');
    };
    assert.equal(h.inspect('click-comment-submit').clicked, true);
    const result = h.inspect('verify-comment');
    assert.equal(result.confirmed, copies === 2);
    if (copies === 1) assert.equal(result.reason, 'baseline-changed');
  }
});

test('an older own TikTok row cannot become the new comment even when its baseline text is restored elsewhere', () => {
  for (const replaceTextNode of [false, true]) {
    const h = commentComposer();
    const old = h.addComment('an older own comment');
    h.prepare();
    h.state.confirm = false;
    h.state.onSubmit = () => {
      h.field.textContent = '';
      if (replaceTextNode) {
        old.text.remove();
        old.row.append(h.element('span', { 'data-e2e': 'comment-level-1' }, h.request.comment, old.text.bounds));
      } else old.text.ownText = h.request.comment;
      h.addComment('an older own comment');
    };
    assert.equal(h.inspect('click-comment-submit').clicked, true);
    const result = h.inspect('verify-comment');
    assert.equal(result.confirmed, false);
    assert.equal(result.reason, 'own-row-not-new');
  }
});

test('TikTok confirmation failures expose only a compact reason for each confirmation gate', () => {
  for (const [reason, change] of [
    ['identity-changed', h => { h.profile.attrs.href = 'https://www.tiktok.com/@different/'; }],
    ['caption-changed', h => { h.heading.ownText = 'a changed caption'; }],
    ['not-submitted', h => { h.context.collectiveCommentBefore.submitted = false; }],
    ['interrupted', h => h.interact('pointerdown')],
    ['composer-unavailable', h => h.field.remove()],
    ['reply-mode', h => { h.field.attrs['aria-label'] = 'Add a reply'; }],
    ['composer-not-empty', h => { h.field.textContent = 'another draft'; }],
    ['own-row-missing', h => h.rows.at(-1).row.remove()],
    ['own-row-ambiguous', h => h.addComment(h.request.comment)]
  ]) {
    const h = commentComposer(); h.prepare();
    assert.equal(h.inspect('click-comment-submit').clicked, true);
    change(h);
    const result = h.inspect('verify-comment');
    assert.equal(result.confirmed, false);
    assert.equal(result.reason, reason);
    assert.deepEqual(Object.keys(result).sort(), ['confirmed', 'reason']);
  }
});

test('TikTok comment diagnostics distinguish a changed post from an unavailable viewer', () => {
  for (const [reason, change] of [
    ['post-changed', h => { h.request.author = '@anothercreator'; }],
    ['post-unavailable', h => { h.video.hidden = true; }]
  ]) {
    const h = commentComposer(); h.prepare();
    assert.equal(h.inspect('click-comment-submit').clicked, true);
    change(h);
    const result = h.inspect('verify-comment');
    assert.equal(result.confirmed, false);
    assert.equal(result.reason, reason);
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

test('same-page confirmation returns the bound signed-in commenter for a fresh read', () => {
  const h = commentComposer(); h.prepare();
  assert.equal(h.inspect('click-comment-submit').clicked, true);
  assert.equal(h.inspect('verify-comment').commenter, '@me');
});

for (const open of [false, true]) {
  test(`fresh comments ${open ? 'already open' : 'closed'} require one bound primary bubble before accepting exact own text`, () => {
    const h = freshCommentThread({ open });
    h.addComment(h.request.comment);
    h.field.textContent = 'an unrelated manual draft';
    const initial = h.inspect('verify-comment-fresh');
    assert.equal(initial.confirmed, false);
    assert.equal(initial.needsOpen, true);
    assert.equal(h.clicks.length, 0);
    assert.equal(h.inspect('click-comment-fresh-open').clicked, true);
    const checked = h.inspect('verify-comment-fresh');
    assert.equal(checked.confirmed, true);
    assert.equal(checked.commenter, '@me');
    assert.equal(h.inspect('click-comment-fresh-open').clicked, false);
    h.load();
    assert.equal(h.inspect('verify-comment-fresh').confirmed, true);
    assert.equal(h.state.opens, 1);
    assert.deepEqual(h.clicks, [h.openButton]);
    assert.equal(h.submitted, 0);
    assert.deepEqual(h.inputs, []);
    assert.equal(h.field.textContent, 'an unrelated manual draft');
    assert.equal(h.document.activeElement, null);
  });
}

test('fresh read ignores counts, other authors, other text, hidden rows and duplicate exact rows', () => {
  for (const populate of [
    h => { h.count.textContent = '4'; },
    h => { h.addComment(h.request.comment, '@someone'); },
    h => { h.addComment(`${h.request.comment}!`); },
    h => { h.addComment(h.request.comment).object.hidden = true; },
    h => { h.addComment(h.request.comment); h.addComment(h.request.comment); },
  ]) {
    const h = freshCommentThread(); populate(h);
    assert.equal(h.inspect('click-comment-fresh-open').clicked, true);
    assert.equal(h.inspect('verify-comment-fresh').confirmed, false);
    assert.equal(h.submitted, 0);
  }
});

test('fresh read will not open the primary thread for a wrong or ambiguous account, post or author', () => {
  for (const mutate of [
    h => { h.request.id = id.replace('/123/', '/999/'); },
    h => { h.request.author = '@another'; },
    h => { delete h.request.author; },
    h => { h.request.commenter = '@another'; },
    h => { delete h.request.commenter; },
    h => { h.profile.remove(); },
    h => { h.body.append(h.element('a', { 'data-e2e': 'nav-profile', href: 'https://www.tiktok.com/@another/' }, 'Profile', h.rect(850, 40, 100, 36))); },
    h => { h.body.append(h.element('a', { 'data-e2e': 'nav-profile', href: 'https://www.tiktok.com/@me/' }, 'Profile', h.rect(850, 40, 100, 36))); },
    h => { h.author.attrs.href = 'https://www.tiktok.com/@another/'; },
    h => { h.article.attrs['data-scroll-index'] = '1'; },
    h => { h.article.attrs.id = 'one-column-item-1'; },
  ]) {
    const h = freshCommentThread(); h.addComment(h.request.comment); mutate(h);
    assert.notEqual(h.inspect('verify-comment-fresh').needsOpen, true);
    assert.equal(h.inspect('click-comment-fresh-open').clicked, false);
    assert.equal(h.inspect('verify-comment-fresh').confirmed, false);
    assert.equal(h.clicks.length, 0);
  }
});

test('a generic Comments tab and another card bubble cannot open a fresh primary thread', () => {
  const h = freshCommentThread(); h.openButton.remove();
  h.panel.append(h.element('button', { role: 'tab' }, 'Comments', h.rect(350, 220, 100, 25)));
  h.secondary.bounds = h.rect(0, 0, 750, 650);
  const otherBubble = h.secondary.querySelector('[data-e2e="comment-icon"]');
  otherBubble.bounds = h.rect(600, 150, 60, 36);
  assert.equal(h.inspect('verify-comment-fresh').needsOpen, false);
  assert.equal(h.inspect('click-comment-fresh-open').clicked, false);
  assert.equal(h.clicks.length, 0);
});

test('fresh read only accepts the exact primary panel row hierarchy and its one composer footer', () => {
  for (const mutate of [
    h => { const row = h.rows[0].object; row.remove(); h.secondary.append(row); },
    h => { const row = h.rows[0].object; row.remove(); h.article.append(row); },
    h => { h.rows[0].content.attrs.class = 'unrelated-comment-text'; },
    h => { h.footer.remove(); },
    h => { h.panel.attrs.class = 'unrelated-tab'; },
    h => { h.panel.remove(); h.article.append(h.panel); },
    h => { const other = h.element('div', { class: 'DivTabContainer' }, '', h.panel.bounds); h.rightPanel.append(other); },
    h => { const other = h.element('div', { class: 'RightPanelContainer' }, '', h.rightPanel.bounds); other.append(h.element('div', { class: 'DivTabContainer' }, '', h.panel.bounds)); h.main.append(other); },
  ]) {
    const h = freshCommentThread(); h.addComment(h.request.comment);
    assert.equal(h.inspect('click-comment-fresh-open').clicked, true);
    mutate(h);
    assert.equal(h.inspect('verify-comment-fresh').confirmed, false);
  }
});

test('fresh thread ownership is revoked by manual interaction, account changes and a replaced primary bubble', () => {
  for (const mutate of [
    h => { h.interact('click', true, h.secondary); },
    h => { h.interact('pointerdown', true, h.field); },
    h => { h.interact('keydown', true, h.field); },
    h => { h.profile.attrs.href = 'https://www.tiktok.com/@someone/'; },
    h => { h.request.comment = 'different exact text'; },
    h => { h.openButton.remove(); const replacement = h.element('div', { role: 'button', 'data-e2e': 'comment-icon' }, '', h.openButton.bounds); h.actions.append(replacement); },
  ]) {
    const h = freshCommentThread(); h.addComment(h.request.comment);
    assert.equal(h.inspect('click-comment-fresh-open').clicked, true);
    mutate(h);
    assert.equal(h.inspect('verify-comment-fresh').confirmed, false);
    assert.equal(h.inspect('click-comment-fresh-open').clicked, false);
    assert.equal(h.state.opens, 1);
  }
});

test('fresh inspection cannot upgrade the same document that submitted the comment', () => {
  const h = freshCommentThread({ open: true }); h.addComment(h.request.comment);
  h.context.collectiveCommentBefore = { submitted: true };
  assert.equal(h.inspect('click-comment-fresh-open').clicked, false);
  assert.equal(h.inspect('verify-comment-fresh').reason, 'not-fresh-page');
  assert.equal(h.clicks.length, 0);
});

test('fresh photo comments remain bound while autoplay changes image_index from 5 to 1', () => {
  const h = freshCommentThread({ withPhoto: true });
  h.addComment(h.request.comment);
  h.field.textContent = 'keep this manual photo draft';
  h.photoSlides[0].attrs.class = 'swiper-slide';
  h.photoSlides[4].attrs.class = 'swiper-slide swiper-slide-active';
  h.context.location = new URL(`${h.request.id}?image_index=5`);
  assert.equal(h.document.querySelectorAll('video').length, 0);
  assert.equal(h.context.inspectTikTok().post.id, h.request.id);
  assert.equal(h.inspect('verify-comment-fresh').needsOpen, true);
  assert.equal(h.inspect('click-comment-fresh-open').clicked, true);
  assert.equal(h.inspect('verify-comment-fresh').confirmed, true);
  h.photoSlides[4].attrs.class = 'swiper-slide';
  h.photoSlides[0].attrs.class = 'swiper-slide swiper-slide-active';
  h.context.location = new URL(`${h.request.id}?image_index=1`);
  h.load();
  const confirmed = h.inspect('verify-comment-fresh');
  assert.equal(confirmed.confirmed, true);
  assert.equal(confirmed.commenter, '@me');
  assert.equal(h.inspect('click-comment-fresh-open').clicked, false);
  assert.equal(h.state.opens, 1);
  assert.deepEqual(h.clicks, [h.openButton]);
  assert.equal(h.submitted, 0);
  assert.deepEqual(h.inputs, []);
  assert.equal(h.field.textContent, 'keep this manual photo draft');
  assert.equal(h.document.activeElement, null);
});

test('fresh photo comment reads reject another post even when identical own text remains visible', () => {
  for (const change of ['request', 'location']) {
    const h = freshCommentThread({ withPhoto: true });
    h.addComment(h.request.comment);
    assert.equal(h.inspect('click-comment-fresh-open').clicked, true);
    assert.equal(h.inspect('verify-comment-fresh').confirmed, true);
    const anotherId = h.request.id.replace('/234/', '/999/');
    if (change === 'request') h.request.id = anotherId;
    else h.context.location = new URL(`${anotherId}?image_index=1`);
    assert.equal(h.inspect('verify-comment-fresh').confirmed, false);
    assert.equal(h.inspect('click-comment-fresh-open').clicked, false);
    assert.equal(h.state.opens, 1);
    assert.equal(h.submitted, 0);
    assert.deepEqual(h.inputs, []);
  }
});
