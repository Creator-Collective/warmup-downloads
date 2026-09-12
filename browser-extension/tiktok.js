// Runs in the guest's isolated world. Every action resolves its control again
// inside the active post's card; a search tile is never an open viewer.
function inspectTikTok(request = {}) {
  const rendered = element => {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    for (let node = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (node.getAttribute('aria-hidden') === 'true' || style.visibility === 'hidden' || style.visibility === 'collapse' || style.display === 'none' || style.opacity === '0') return false;
    }
    return true;
  };
  const visible = element => {
    if (!rendered(element)) return false;
    const rect = element.getBoundingClientRect();
    return rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth;
  };
  const all = (scope, selector) => [...scope.querySelectorAll(selector)];
  const unique = values => [...new Set(values)];
  const label = element => (element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent || '').trim().toLowerCase();
  const point = element => {
    if (!visible(element)) return null;
    for (let node = element; node; node = node.parentElement) {
      if (node.disabled || node.getAttribute('aria-disabled') === 'true') return null;
    }
    const rect = element.getBoundingClientRect();
    const x = Math.round((Math.max(0, rect.left) + Math.min(innerWidth, rect.right)) / 2);
    const y = Math.round((Math.max(0, rect.top) + Math.min(innerHeight, rect.bottom)) / 2);
    const hit = document.elementFromPoint(x, y);
    return hit && (hit === element || element.contains(hit)) ? { x, y } : null;
  };
  const postURL = value => {
    try {
      const url = new URL(value, location.href);
      return url.protocol === 'https:' && !url.port && !url.username && !url.password && ['www.tiktok.com', 'tiktok.com'].includes(url.hostname) && /^\/@[\w.-]+\/(?:video|photo)\/\d+\/?$/.test(url.pathname)
        ? `https://www.tiktok.com${url.pathname.replace(/\/?$/, '/')}` : null;
    } catch { return null; }
  };
  if (!['www.tiktok.com', 'tiktok.com'].includes(location.hostname)) return { blocked: 'open tiktok before starting a niche session.' };
  if (/\/(?:login|signup)\b/.test(location.pathname) || all(document, 'input[type="password"], #loginModalContentContainer, #loginContainer, #login-modal').some(visible)) {
    return { blocked: 'finish tiktok sign-in or account check, then start a new session.', blockReason: 'sign-in' };
  }
  // TikTok also serves full-page denials and plain banners, without a dialog.
  // Inspect visible warning text, excluding video captions and comments.
  const warningNodes = all(document, 'h1, h2, h3, p, div, span, [role="alert"], [role="dialog"]')
    .filter(element => visible(element) && !element.closest('[data-e2e="video-desc"], [data-e2e="browse-video-desc"], [data-e2e="comment-level-1"], [data-e2e="comment-level-2"], [data-e2e="comment-text"], [contenteditable="true"]') &&
      (!element.children.length || /^(H1|H2|H3|P)$/.test(element.tagName) || element.getAttribute('role') === 'alert'));
  const warnings = warningNodes.map(element => (element.innerText || element.textContent || '').trim().toLowerCase()).filter(text => text.length < 2000);
  if (warnings.some(text => /^access denied\b|you (?:do not|don't) have permission to access|access to this page (?:has been|is) denied/.test(text))) {
    return { blocked: 'tiktok denied access. the session has stopped; check tiktok before starting again.', blockReason: 'access-denied' };
  }
  if (all(document, '[id*="captcha"], [data-e2e*="captcha"], iframe[src*="captcha"]').some(visible) || warnings.some(text => /verify (?:that )?you(?:'re| are) (?:a )?human|verify to continue|complete (?:the|this) (?:puzzle|captcha)|drag the slider|unusual activity/.test(text))) {
    return { blocked: 'tiktok needs an account check. the session has stopped; complete the check yourself.', blockReason: 'challenge' };
  }
  if (warnings.some(text => /(?:you(?:'re| are) )?(?:tapping|following|commenting|liking) too fast|too many (?:requests|attempts)|^try again later[.!]?$|temporarily (?:blocked|restricted)|account (?:is |has been )?suspended/.test(text))) {
    return { blocked: 'tiktok limited activity. the session has stopped; wait before starting another session.', blockReason: 'rate-limit' };
  }
  if (warnings.some(text => /couldn.t post (?:your |the )?comment|failed to post (?:your |the )?comment|unable to post (?:your |the )?comment/.test(text))) {
    return { blocked: 'tiktok could not post the comment. the session has stopped; check tiktok before trying again.', blockReason: 'comment-failed' };
  }
  const links = all(document, 'a[href]');
  // Keep rendered offscreen results in order, but never select hidden preload anchors.
  const sequence = unique(links.filter(rendered).map(link => postURL(link.href)).filter(Boolean));
  const posts = unique(links.filter(visible).map(link => postURL(link.href)).filter(Boolean));
  const empty = () => request.action ? { changed: true, point: null, clicked: false, confirmed: false } : { posts, sequence, post: null };
  const pageId = postURL(location.href);
  const photoId = value => Boolean(value && new URL(value).pathname.includes('/photo/'));
  const area = element => {
    const r = element.getBoundingClientRect();
    return Math.max(0, Math.min(innerWidth, r.right) - Math.max(0, r.left)) * Math.max(0, Math.min(innerHeight, r.bottom) - Math.max(0, r.top));
  };
  // Recognize TikTok's observed photo-slide structure, not a video's poster
  // image that may linger while the URL is already changing to a photo.
  const photoCarousel = image => image.matches('[class*="ImgPhotoSlide"]') ? image.closest('.swiper-horizontal') : null;
  const photoMedia = root => all(root, 'img').filter(image => {
    const rect = image.getBoundingClientRect();
    const slide = image.closest('.swiper-slide');
    if (!photoCarousel(image) || !slide?.matches('.swiper-slide-active')) return false;
    return visible(image) && image.complete === true && image.naturalWidth >= 240 && image.naturalHeight >= 240 &&
      rect.width >= 240 && rect.height >= 240 && area(image) >= 70000 && !image.closest('a[href], nav, aside, [data-e2e*="comment"]');
  });
  const dialogs = all(document, '[role="dialog"]').filter(element => visible(element) && (all(element, 'video').some(visible) || photoMedia(element).length));
  if (dialogs.length > 1) return empty();
  const viewer = dialogs[0] || null;
  // Search/profile cards can autoplay previews. Opening one is required first.
  if (!pageId && !viewer && !/^\/(?:foryou|following|friends)\/?$/.test(location.pathname)) return empty();
  const main = viewer || document.querySelector('main, [role="main"]') || document.body;
  const videos = all(main, 'video').filter(visible);
  const playing = videos.filter(video => !video.paused && !video.ended && video.readyState >= 2);
  const images = pageId ? (photoId(pageId) ? photoMedia(main) : []) : (viewer ? photoMedia(main) : []);
  const candidates = [...(photoId(pageId) ? [] : (playing.length ? playing : videos)), ...images].sort((a, b) => area(b) - area(a));
  const media = candidates[0];
  if (!media || (candidates[1] && area(media) < area(candidates[1]) * 2)) return empty();
  const photo = media.tagName === 'IMG';
  const video = photo ? null : media;
  // Include sibling author/action panels, but never cross into another card.
  let scope = media.parentElement;
  for (let parent = scope; parent && main.contains(parent); parent = parent.parentElement) {
    // Browse dialogs preload the next post below the viewport. Only that
    // trusted viewer may ignore its offscreen media while finding siblings.
    if (all(parent, 'video').some(other => other !== media && (!viewer || visible(other))) ||
        (photo && photoMedia(parent).some(other => other !== media))) break;
    scope = parent;
    if (parent === main || parent.matches('article, [data-e2e="recommend-list-item-container"], [data-e2e="feed-item"]')) break;
  }
  if (!scope) return empty();
  const scopedIds = unique(all(scope, 'a[href]').filter(link => rendered(link) && (!viewer || visible(link))).map(link => postURL(link.href)).filter(Boolean));
  const id = pageId || (scopedIds.length === 1 ? scopedIds[0] : null);
  if (!id || photo !== photoId(id) || (pageId && scopedIds.length && !scopedIds.includes(pageId))) return empty();
  const author = new URL(id).pathname.split('/')[1];
  const excluded = element => Boolean(element.closest('[data-e2e*="comment"], aside, nav'));
  const target = (node, root) => {
    const button = node.closest('button, [role="button"]');
    if (button && root.contains(button)) return button;
    // browse-follow wraps its actual button; normalize both discoveries to it.
    const contained = all(node, 'button, [role="button"]').filter(visible);
    if (contained.length) return contained.length === 1 ? contained[0] : null;
    // Some TikTok layouts attach the handler to a div/span instead of a button.
    return node;
  };
  const exact = (root, selector) => unique(all(root, selector).filter(node => visible(node) && !excluded(node)).map(node => target(node, root)).filter(Boolean));
  const only = values => values.length === 1 ? values[0] : null;
  const semantic = (root, pattern) => all(root, 'button, [role="button"]').filter(element => visible(element) && !excluded(element) && pattern.test(label(element)));
  const likeMarkers = exact(scope, '[data-e2e="like-icon"], [data-e2e="browse-like-icon"], [data-e2e="unlike-icon"], [data-e2e="browse-liked-icon"]');
  const like = only(likeMarkers.length ? likeMarkers : semantic(scope, /^(?:like|liked|unlike)(?:\b|$)/));
  const likeStateNodes = like ? [like, ...all(like, '[aria-pressed], [aria-label], [data-state], [data-e2e], svg, [fill]')] : [];
  const liked = likeStateNodes.some(node => node.getAttribute('aria-pressed') === 'true' || /^(?:liked|active|on)$/.test(node.getAttribute('data-state') || '') ||
    /^(?:unlike|liked)\b/.test(label(node)) || /^(?:unlike-icon|browse-liked-icon)$/.test(node.getAttribute('data-e2e') || '') ||
    // The same data-e2e like-icon stays mounted after a like; its heart turns red.
    /^(?:#fe2c55|#ff385c|rgb\(254,\s*44,\s*85\)|rgb\(255,\s*56,\s*92\)|rgba\(254,\s*44,\s*85,\s*1\)|rgba\(255,\s*56,\s*92,\s*1\))$/i.test(getComputedStyle(node).fill || node.getAttribute('fill') || ''));
  const profileAuthor = link => {
    try { const url = new URL(link.href, location.href); return ['www.tiktok.com', 'tiktok.com'].includes(url.hostname) && /^\/@[\w.-]+\/?$/.test(url.pathname) ? url.pathname.split('/')[1] : null; } catch { return null; }
  };
  if (photo) {
    const authors = unique(all(scope, 'a[href]').filter(link => visible(link) && !excluded(link)).map(profileAuthor).filter(Boolean));
    const hasDetails = all(scope, '[data-e2e="browse-video-desc"], [data-e2e="video-desc"], [data-e2e="browse-like-icon"], [data-e2e="like-icon"]').some(element => visible(element) && !excluded(element));
    if (authors.length !== 1 || authors[0] !== author || !hasDetails) return empty();
    // A permalink can update before React replaces its old carousel. Bind the
    // entire source set, not the active slide, so autoplay and DOM recreation
    // cannot relabel old media as a new post. Keep state in the isolated world
    // across observer reinjections; signed CDN query refreshes are immaterial.
    const sourceKey = image => {
      try {
        const source = image.currentSrc || image.getAttribute('src');
        if (!source) return null;
        const url = new URL(source, location.href);
        return url.protocol === 'https:' && !url.username && !url.password ? `${url.origin}${url.pathname}` : null;
      } catch { return null; }
    };
    const carousel = photoCarousel(media);
    const sources = unique(all(carousel, 'img[class*="ImgPhotoSlide"]').map(sourceKey).filter(Boolean));
    if (!sourceKey(media) || !sources.length) return empty();
    const bindings = globalThis.collectiveTikTokPhotoBindings ||= { carousels: new WeakMap(), sources: new Map() };
    const previous = bindings.carousels.get(carousel);
    if ((previous && previous.id !== id && sources.some(source => previous.sources.has(source))) ||
        sources.some(source => bindings.sources.has(source) && bindings.sources.get(source) !== id)) return empty();
    const remembered = previous?.id === id ? previous.sources : new Set();
    for (const source of sources) { remembered.add(source); bindings.sources.set(source, id); }
    bindings.carousels.set(carousel, { id, sources: remembered });
  }
  const belongsToAuthor = element => {
    for (let parent = element.parentElement; parent && scope.contains(parent); parent = parent.parentElement) {
      const authors = unique(all(parent, 'a[href]').map(profileAuthor).filter(Boolean));
      if (authors.length) return authors.length === 1 && authors[0] === author;
      if (parent === scope) break;
    }
    return false;
  };
  const followMarkers = exact(scope, '[data-e2e="follow-button"], [data-e2e="browse-follow"], [data-e2e="feed-follow"], [data-e2e="follow-icon"]');
  const follow = only(unique([...followMarkers, ...semantic(scope, /^(?:follow|following|friends|requested)(?:\s+@[\w.-]+)?$/)]).filter(belongsToAuthor));
  const following = Boolean(follow && (/^(?:following|friends|requested)(?:\s+@[\w.-]+)?$/.test(label(follow)) || follow.getAttribute('aria-pressed') === 'true' || /^(?:following|requested)$/.test(follow.getAttribute('data-state') || '')));
  // A photo's horizontal arrow changes slides, not posts. Never use it to
  // predict a URL transition; vertical browse controls retain post ownership.
  const nextMarkers = photo ? '[data-e2e="arrow-down"], [data-e2e="browse-next"]' : '[data-e2e="arrow-right"], [data-e2e="arrow-down"], [data-e2e="browse-next"]';
  const nextLabel = photo ? /^(?:next (?:video|post)|go to next (?:video|post)|scroll down)$/ : /^(?:next|next (?:video|post)|go to next (?:video|post)|scroll down)$/;
  const next = only(unique([...exact(main, nextMarkers), ...semantic(main, nextLabel)]).filter(node => !photo || !node.closest('.swiper-horizontal, .swiper-slide')));
  const close = viewer ? only(unique([...exact(viewer, '[data-e2e="browse-close"]'), ...semantic(viewer, /^close(?: video)?$/)])) : null;
  const descriptions = all(scope, '[data-e2e="browse-video-desc"], [data-e2e="video-desc"]').filter(visible);
  const textNodes = (descriptions.length ? descriptions : all(scope, 'h1, h2, p, a[href*="/tag/"]').filter(element => visible(element) && !excluded(element)))
    .map(element => element.innerText || element.textContent || '').filter(Boolean);
  const caption = (textNodes.join(' ') || (pageId ? document.querySelector('meta[property="og:description"]')?.content : '') || '').slice(0, 6000);
  // A permalink's comments panel can sit beside the video card. A browse
  // dialog contains its own panel; never inspect another card's composer.
  const commentRoot = viewer || (pageId ? document : scope);
  const ownProfiles = unique(all(document, 'a[data-e2e="nav-profile"][href]').filter(visible).map(profileAuthor).filter(Boolean));
  const ownProfile = ownProfiles.length === 1 ? ownProfiles[0] : null;
  const inputContainers = all(commentRoot, '[data-e2e="comment-input"]').filter(visible);
  const fields = unique(inputContainers.flatMap(container => all(container, '[contenteditable="true"][role="textbox"]')
    .filter(field => visible(field) && container.contains(field.closest('[data-e2e="comment-text"]')))));
  const composer = only(fields);
  const composerHint = composer ? [(composer.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean).map(ref => document.getElementById(ref)?.textContent || '').join(' '), composer.getAttribute('aria-label') || ''].join(' ') : '';
  const replying = /add (?:a )?reply|write (?:a )?reply|reply(?:ing)? to/i.test(composerHint);
  const composerValue = field => (field?.textContent || '').replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ');
  let commentContainer = null;
  let submit = null;
  for (let parent = composer?.parentElement; parent && commentRoot.contains(parent); parent = parent.parentElement) {
    const submits = unique(all(parent, '[data-e2e="comment-post"]').filter(visible).map(node => target(node, parent)).filter(Boolean));
    if (submits.length) {
      if (submits.length === 1 && all(parent, '[contenteditable="true"][role="textbox"]').filter(visible).length === 1) {
        commentContainer = parent; submit = submits[0];
      }
      break;
    }
    if (parent === commentRoot) break;
  }
  const commentOpen = only(unique(all(scope, '[data-e2e="comment-icon"], [data-e2e="browse-comment-icon"]')
    .filter(visible).map(node => target(node, scope)).filter(Boolean)));
  const commentRows = () => all(commentRoot, '[data-e2e="comment-level-1"]').flatMap(textNode => {
    for (let row = textNode.parentElement; row && commentRoot.contains(row); row = row.parentElement) {
      if (all(row, '[data-e2e="comment-level-1"]').length !== 1) return [];
      const authors = unique(all(row, 'a[href]').map(profileAuthor).filter(Boolean));
      if (authors.length > 1) return [];
      if (authors.length === 1) return [{ node: row, textNode, author: authors[0], text: composerValue(textNode) }];
      if (row === commentRoot) break;
    }
    return [];
  });
  const videoRemainingMs = video && !video.paused && !video.ended && video.readyState >= 2 &&
    Number.isFinite(video.duration) && video.duration > 0 && video.duration <= 120 &&
    Number.isFinite(video.currentTime) && video.currentTime >= 0 && video.currentTime < video.duration &&
    Number.isFinite(video.playbackRate) && video.playbackRate > 0
    ? Math.ceil((video.duration - video.currentTime) / video.playbackRate * 1000) : null;
  const post = { id, author, videoRemainingMs, viewer: true, next: Boolean(point(next)), close: Boolean(point(close)), text: caption, caption,
    like: Boolean(point(like)) && !liked, follow: Boolean(point(follow)) && !following, comment: Boolean(ownProfile && fields.length <= 1 && !replying && ((composer && submit && point(composer)) || point(commentOpen))) };
  if (!request.action) return { posts, sequence, post };
  if (request.id !== id || (request.author && request.author !== author)) return { changed: true, clicked: false, confirmed: false };
  if (['click-comment-open', 'comment-field', 'comment-ready', 'comment-submit', 'click-comment-submit'].includes(request.action) && request.caption !== caption) {
    return { changed: true, point: null, ready: false, clicked: false, opened: false, reason: 'caption-changed' };
  }
  if (request.action === 'click-comment-open') {
    if (!ownProfile || fields.length > 1 || replying) return { opened: false };
    if (composer && submit && point(composer)) return { opened: true };
    if (!point(commentOpen) || typeof commentOpen.click !== 'function') return { opened: false };
    commentOpen.click();
    return { opened: true };
  }
  if (request.action === 'comment-field') {
    if (!ownProfile || !composer || replying || !submit || !point(composer) || composerValue(composer) !== '' || typeof request.comment !== 'string' || !request.comment.trim()) return { point: null };
    const previous = globalThis.collectiveCommentBefore;
    if (previous?.platform === 'tiktok' && previous.postId === id && previous.postAuthor === author && previous.author === ownProfile && previous.caption === caption && previous.text === request.comment) {
      if (previous.interrupted || previous.drafted || previous.submitted) return { point: null, reason: 'draft-already-owned' };
      if (previous.composer?.isConnected === false) { previous.composer = composer; previous.container = commentContainer; }
      return { point: previous.composer === composer ? point(composer) : null };
    }
    const rows = commentRows();
    // TikTok does not expose stable comment IDs here. Existing identical own
    // text makes a later confirmation ambiguous, so do not submit another copy.
    if (rows.some(row => row.author === ownProfile && row.text === request.comment)) return { point: null, reason: 'own-comment-already-exists' };
    globalThis.collectiveCommentBefore?.release?.();
    const before = { platform: 'tiktok', postId: id, postAuthor: author, author: ownProfile, caption, text: request.comment, composer,
      container: commentContainer, drafted: false, submitted: false, interrupted: false, inputting: false, rows };
    const events = ['beforeinput', 'input', 'pointerdown', 'keydown', 'click', 'submit'];
    const interrupt = event => {
      if (!event.isTrusted || (before.inputting && ['beforeinput', 'input'].includes(event.type))) return;
      const input = event.target?.closest?.('[data-e2e="comment-input"]');
      if (event.target === before.composer || before.composer?.contains(event.target) || before.container?.contains(event.target) || (input && commentRoot.contains(input))) before.interrupted = true;
    };
    for (const type of events) document.addEventListener(type, interrupt, true);
    before.release = () => { for (const type of events) document.removeEventListener(type, interrupt, true); };
    globalThis.collectiveCommentBefore = before;
    return { point: point(composer) };
  }
  const before = globalThis.collectiveCommentBefore;
  const identity = Boolean(ownProfile && before?.platform === 'tiktok' && before.postId === id && before.postAuthor === author && before.author === ownProfile && before.text === request.comment);
  const sameDraft = identity && before.caption === caption && before.drafted && !before.submitted && !before.interrupted;
  if (sameDraft && before.composer?.isConnected === false && composer &&
      (composerValue(composer) === before.text || (request.action === 'comment-cleared' && before.clearing && composerValue(composer) === ''))) {
    before.composer = composer; before.container = commentContainer;
  }
  const owned = Boolean(identity && composer && !replying && before.composer === composer && !before.interrupted);
  if (request.action === 'comment-ready') return { ready: Boolean(owned && !before.drafted && !before.submitted && document.activeElement === composer && composerValue(composer) === '') };
  if (request.action === 'comment-submit' || request.action === 'click-comment-submit') {
    const ready = owned && before.caption === caption && before.drafted && !before.submitted && composerValue(composer) === request.comment && submit && point(submit);
    if (request.action === 'comment-submit') return { point: ready || null };
    if (!ready || typeof submit.click !== 'function') return { clicked: false };
    before.submitted = true;
    submit.click();
    return { clicked: true };
  }
  if (request.action === 'comment-clear') return { point: owned && before.drafted && !before.submitted && composerValue(composer) === request.comment ? point(composer) : null };
  if (request.action === 'comment-cleared') return { cleared: Boolean(owned && before.drafted && before.clearing && !before.submitted && composerValue(composer) === '') };
  if (request.action === 'verify-comment') {
    if (!identity || before.caption !== caption || !before.submitted || before.interrupted || !composer || replying || composerValue(composer) !== '') return { confirmed: false };
    const rows = commentRows();
    const baselineIntact = before.rows.every(previous => rows.some(row => row.node === previous.node && row.textNode === previous.textNode && row.author === previous.author && row.text === previous.text));
    const added = rows.filter(row => row.author === ownProfile && row.text === request.comment && visible(row.textNode) && !before.rows.some(previous => previous.textNode === row.textNode));
    return { confirmed: Boolean(baselineIntact && added.length === 1) };
  }
  if (request.action === 'verify-like') return { confirmed: Boolean(liked && visible(like)) };
  if (request.action === 'verify-follow') return { confirmed: Boolean(following && visible(follow)) };
  const controls = { like: post.like ? like : null, follow: post.follow ? follow : null, next, close };
  if (Object.hasOwn(controls, request.action)) return { point: point(controls[request.action]) };
  if (request.action.startsWith('click-') && Object.hasOwn(controls, request.action.slice(6))) {
    const element = controls[request.action.slice(6)];
    if (!point(element) || typeof element.click !== 'function') return { clicked: false };
    element.click();
    return { clicked: true };
  }
  return { point: null, ready: false };
}

globalThis.inspectTikTok = inspectTikTok;
