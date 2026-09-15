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
  const target = (node, root) => {
    const button = node.closest('button, [role="button"]');
    if (button && root.contains(button)) return button;
    // Normalize wrappers and their one visible button to the same control.
    const contained = all(node, 'button, [role="button"]').filter(visible);
    if (contained.length) return contained.length === 1 ? contained[0] : null;
    // Some TikTok layouts attach the handler to a div/span instead of a button.
    return node;
  };
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
  const empty = () => request.action ? { changed: true, point: null, clicked: false, confirmed: false,
    ...(['verify-comment', 'verify-comment-fresh', 'click-comment-fresh-open'].includes(request.action) ? { reason: 'post-unavailable' } : {}) } : { posts, sequence, post: null };
  const pageId = postURL(location.href);
  const photoId = value => Boolean(value && new URL(value).pathname.includes('/photo/'));
  const area = element => {
    const r = element.getBoundingClientRect();
    return Math.max(0, Math.min(innerWidth, r.right) - Math.max(0, r.left)) * Math.max(0, Math.min(innerHeight, r.bottom) - Math.max(0, r.top));
  };
  // Search's "search-comment-container" also contains the primary author and
  // post controls. Exclude actual rows and the bottom composer bar, including
  // its signed-in avatar outside comment-input, without excluding that panel.
  const excluded = element => Boolean(element.closest('aside, nav, [data-e2e="comment-list"], [data-e2e="comment-item"], [data-e2e="comment-level-1"], [data-e2e="comment-level-2"], [data-e2e="comment-input"], [data-e2e="comment-text"], [class*="DivCommentItemContainer"], [class*="DivCommentContentContainer"], [class*="DivCommentBarContainer"], [class*="DivEnhancedBottomCommentContainer"]'));
  // Recognize TikTok's observed photo-slide structure, not a video's poster
  // image that may linger while the URL is already changing to a photo.
  const photoCarousel = image => image.matches('[class*="ImgPhotoSlide"]') ? image.closest('.swiper-horizontal') : null;
  const photoMedia = root => all(root, 'img').filter(image => {
    const rect = image.getBoundingClientRect();
    const slide = image.closest('.swiper-slide');
    if (!photoCarousel(image) || !slide?.matches('.swiper-slide-active')) return false;
    return visible(image) && image.complete === true && image.naturalWidth >= 240 && image.naturalHeight >= 240 &&
      rect.width >= 240 && rect.height >= 240 && area(image) >= 70000 && !image.closest('a[href]') && !excluded(image);
  });
  const dialogs = all(document, '[role="dialog"]').filter(element => visible(element) && (all(element, 'video').some(visible) || photoMedia(element).length));
  if (dialogs.length > 1) return empty();
  const viewer = dialogs[0] || null;
  const failureText = viewer ? warningNodes.filter(element => viewer.contains(element))
    .map(element => (element.innerText || element.textContent || '').trim().toLowerCase()) : [];
  const failedViewer = Boolean(viewer && pageId && failureText.some(text => /^something went wrong[.!]?$/.test(text)) &&
    failureText.some(text => /^sorry about that[.!]?\s*please try again later[.!]?$/.test(text)));
  if (failedViewer) {
    const closeControls = unique([
      ...all(viewer, '[data-e2e="browse-close"]'),
      ...all(viewer, 'button, [role="button"]').filter(element => /^close(?: video)?$/.test(label(element)))
    ].filter(visible).map(element => target(element, viewer)).filter(Boolean));
    const closeControl = closeControls.length === 1 ? closeControls[0] : null;
    // A missing or obstructed close does not make the covered results usable.
    if (!request.action) return { posts, sequence, post: null, unavailableViewer: pageId };
    if (request.action === 'click-close' && request.id === pageId && point(closeControl) && typeof closeControl.click === 'function') {
      closeControl.click();
      return { clicked: true };
    }
    return empty();
  }
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
      const authors = unique(all(parent, 'a[href]').filter(link => visible(link) && !excluded(link)).map(profileAuthor).filter(Boolean));
      if (authors.length) return authors.length === 1 && authors[0] === author;
      if (parent === scope) break;
    }
    return false;
  };
  const followMarkerNodes = all(scope, '[data-e2e="follow-button"], [data-e2e="browse-follow"], [data-e2e="feed-follow"], [data-e2e="follow-icon"]')
    .filter(node => visible(node) && !excluded(node));
  const followMarkers = unique(followMarkerNodes.map(node => target(node, scope)).filter(Boolean));
  const follow = only(unique([...followMarkers, ...semantic(scope, /^(?:follow|following|friends|requested|unfollow)(?:\s+@[\w.-]+)?$/)]).filter(belongsToAuthor));
  // Markers identify a control, not its current action. Its wrapper, label or
  // nested icon can change to Unfollow before the marker itself changes.
  const followRoots = follow ? unique([follow, ...followMarkerNodes.filter(node => target(node, scope) === follow)]) : [];
  // aria-hidden changes accessibility, not the visible action. A decorative
  // span can still visibly say Unfollow and must prevent a second click.
  const followRendered = element => {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    for (let node = element; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.visibility === 'hidden' || style.visibility === 'collapse' || style.display === 'none' || style.opacity === '0') return false;
    }
    return true;
  };
  const followStateNodes = unique(followRoots.flatMap(node => [node, ...all(node, '*')])).filter(followRendered);
  const renderedFollowText = node => !followRendered(node) ? '' : [...node.childNodes].map(child =>
    child.nodeType === 3 ? child.textContent : child.nodeType === 1 ? renderedFollowText(child) : '').join('');
  // Read full control/wrapper text, not fragments such as a nested @username.
  const followLabels = unique([...followRoots.map(renderedFollowText), ...followStateNodes
    .flatMap(node => [node.getAttribute('aria-label'), node.getAttribute('title')])]
    .filter(Boolean).map(text => text.replace(/\s+/g, ' ').trim().toLowerCase()).filter(Boolean));
  const relationshipLabel = text => {
    const match = text.match(/^(?:following|friends|requested|unfollow)(?:\s+(@[\w.-]+))?$/);
    return Boolean(match && (!match[1] || match[1] === author.toLowerCase()));
  };
  const relationshipState = followStateNodes.some(node => node.getAttribute('aria-pressed') === 'true' || /^(?:following|friends|requested|unfollow)$/.test(node.getAttribute('data-state') || ''));
  const following = followLabels.length ? followLabels.every(relationshipLabel) : relationshipState;
  const nonFollowState = relationshipState || followLabels.some(text => /^(?:following|friends|requested|unfollow)\b/.test(text)) ||
    followStateNodes.some(node => /^(?:following|unfollow)-icon$/.test(node.getAttribute('data-e2e') || ''));
  const canFollow = !nonFollowState && ((followLabels.length > 0 && followLabels.every(text => text === 'follow' || text === `follow ${author.toLowerCase()}`)) ||
    // The feed's unlabeled plus icon explicitly names the Follow action.
    (!followLabels.length && followStateNodes.some(node => node.getAttribute('data-e2e') === 'follow-icon')));
  // A photo's horizontal arrow changes slides, not posts. Never use it to
  // predict a URL transition; vertical browse controls retain post ownership.
  const nextMarkers = photo ? '[data-e2e="arrow-down"], [data-e2e="browse-next"]' : '[data-e2e="arrow-right"], [data-e2e="arrow-down"], [data-e2e="browse-next"]';
  const nextLabel = photo ? /^(?:next (?:video|post)|go to next (?:video|post)|scroll down)$/ : /^(?:next|next (?:video|post)|go to next (?:video|post)|scroll down)$/;
  const next = only(unique([...exact(main, nextMarkers), ...semantic(main, nextLabel)]).filter(node => !photo || !node.closest('.swiper-horizontal, .swiper-slide')));
  const close = viewer ? only(unique([...exact(viewer, '[data-e2e="browse-close"]'), ...semantic(viewer, /^close(?: video)?$/)])) : null;
  const descriptions = all(scope, '[data-e2e="browse-video-desc"], [data-e2e="video-desc"]').filter(element => visible(element) && !excluded(element));
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
    .filter(element => visible(element) && !excluded(element)).map(node => target(node, scope)).filter(Boolean)));
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
    like: Boolean(point(like)) && !liked, follow: Boolean(point(follow)) && canFollow, comment: Boolean(ownProfile && fields.length <= 1 && !replying && ((composer && submit && point(composer)) || point(commentOpen))) };
  if (!request.action) return { posts, sequence, post };
  if (request.id !== id || (request.author && request.author !== author)) return { changed: true, clicked: false, confirmed: false,
    ...(['verify-comment', 'verify-comment-fresh', 'click-comment-fresh-open'].includes(request.action) ? { reason: 'post-changed' } : {}) };
  if (request.action === 'verify-comment-fresh' || request.action === 'click-comment-fresh-open') {
    const unconfirmed = reason => ({ confirmed: false, opened: false, clicked: false, reason });
    if (!pageId || request.id !== pageId || request.author !== author) return unconfirmed('post-changed');
    if (!ownProfile || request.commenter !== ownProfile || all(document, 'a[data-e2e="nav-profile"][href]').filter(visible).length !== 1) return unconfirmed('identity-changed');
    if (typeof request.comment !== 'string' || !request.comment.trim()) return unconfirmed('comment-missing');
    if (globalThis.collectiveCommentBefore?.submitted) return unconfirmed('not-fresh-page');
    // The permalink can render multiple recommendations while its comments
    // panel lives outside every article. Only the primary post's own bubble
    // can establish which thread that external panel belongs to.
    const primary = only(all(document, 'article[data-e2e="recommend-list-item-container"][id="one-column-item-0"][data-scroll-index="0"]').filter(visible));
    const primaryAuthors = primary ? unique(all(primary, 'a[href]').filter(link => visible(link) && !excluded(link)).map(profileAuthor).filter(Boolean)) : [];
    if (!primary || scope !== primary || !primary.contains(media) || primaryAuthors.length !== 1 || primaryAuthors[0] !== author) return unconfirmed('primary-post-unavailable');
    const binding = globalThis.collectiveTikTokFreshComment;
    const bound = binding && binding.id === id && binding.author === author && binding.commenter === ownProfile &&
      binding.comment === request.comment && binding.primary === primary && binding.control === commentOpen;
    if (binding && (!bound || binding.interrupted)) return unconfirmed('thread-binding-changed');
    if (request.action === 'click-comment-fresh-open') {
      if (bound) return { opened: true, clicked: false };
      if (!commentOpen || !primary.contains(commentOpen) || !point(commentOpen) || typeof commentOpen.click !== 'function') return unconfirmed('comment-control-unavailable');
      const fresh = { id, author, commenter: ownProfile, comment: request.comment, primary, control: commentOpen, interrupted: false, panel: null };
      // Manual navigation or a different comment bubble invalidates ownership;
      // observer polling can never re-click or silently bind another thread.
      const interrupt = event => { if (event.isTrusted) fresh.interrupted = true; };
      for (const type of ['pointerdown', 'keydown', 'click']) document.addEventListener(type, interrupt, true);
      globalThis.collectiveTikTokFreshComment = fresh;
      commentOpen.click();
      return { opened: true, clicked: true };
    }
    if (!bound) return { ...unconfirmed('thread-not-opened'), needsOpen: Boolean(commentOpen && primary.contains(commentOpen) && point(commentOpen) && typeof commentOpen.click === 'function') };
    // TikTok nests several RightPanelContainer wrappers. Uniqueness belongs
    // to the actual tab panel, not its repeated layout ancestors.
    const panel = only(all(document, '[class*="DivTabContainer"]').filter(node => visible(node) && node.parentElement?.matches('[class*="RightPanelContainer"]')));
    if (!panel || panel.closest('article') || (binding.panel && binding.panel !== panel)) return unconfirmed('comment-thread-unavailable');
    const list = only(all(panel, '[class*="DivCommentListContainer"]').filter(node => visible(node) && node.parentElement?.matches('[class*="DivCommentMain"]') && node.parentElement.parentElement === panel));
    const inputs = all(panel, '[data-e2e="comment-input"]').filter(node => {
      const bar = node.closest('[class*="DivCommentBarContainer"]');
      const footer = bar?.closest('[class*="DivCommentFooter"]');
      return visible(node) && footer?.parentElement === panel;
    });
    if (!list || inputs.length !== 1) return unconfirmed('comment-thread-unavailable');
    binding.panel = panel;
    const rows = all(list, '[data-e2e="comment-level-1"]').flatMap(textNode => {
      const content = textNode.closest('[class*="DivCommentContentWrapper"]');
      const item = content?.parentElement;
      const object = item?.parentElement;
      if (!visible(textNode) || !item?.matches('[class*="DivCommentItemWrapper"]') ||
          !object?.matches('[class*="DivCommentObjectWrapper"]') || object.parentElement !== list ||
          all(item, '[data-e2e="comment-level-1"]').length !== 1) return [];
      const authors = unique(all(item, 'a[href]').filter(visible).map(profileAuthor).filter(Boolean));
      return authors.length === 1 ? [{ author: authors[0], text: composerValue(textNode) }] : [];
    });
    const matches = rows.filter(row => row.author === ownProfile && row.text === request.comment);
    if (!matches.length) return unconfirmed('own-row-missing');
    if (matches.length !== 1) return unconfirmed('own-row-ambiguous');
    return { confirmed: true, commenter: ownProfile };
  }
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
      container: commentContainer, drafted: false, submitted: false, interrupted: false, inputting: false, inputtingUntil: 0, rows };
    const events = ['beforeinput', 'input', 'pointerdown', 'keydown', 'click', 'submit'];
    const interrupt = event => {
      if (!event.isTrusted) return;
      const targetsComposer = () => event.target === before.composer || before.composer?.contains(event.target);
      if (before.inputting && ['beforeinput', 'input'].includes(event.type) && targetsComposer()) return;
      // Draft.js can replace its editor before delivering the native input
      // event. Recheck current post/account/caption and exact draft ownership
      // before adopting that node; manual beforeinput/key/pointer events revoke it.
      if (event.type === 'input' && before.drafted && !before.interrupted && Date.now() <= before.inputtingUntil) {
        // Submit can clear this same editor before its new row is rendered.
        // Keep that confirmation pending without authorizing another submit.
        const checked = inspectTikTok({ ...request, action: 'comment-input' });
        if ((checked.owned || checked.awaitingConfirmation) && targetsComposer()) return;
      }
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
  if (request.action === 'comment-input') return {
    owned: Boolean(sameDraft && owned && composerValue(composer) === before.text),
    awaitingConfirmation: Boolean(owned && before.caption === caption && before.submitted && composerValue(composer) === '')
  };
  if (request.action === 'comment-ready') return { ready: Boolean(owned && !before.drafted && !before.submitted && document.activeElement === composer && composerValue(composer) === '') };
  if (request.action === 'comment-submit' || request.action === 'click-comment-submit') {
    const ready = owned && before.caption === caption && before.drafted && !before.submitted && composerValue(composer) === request.comment && submit && point(submit);
    // Comments can load while drafting. Recheck before the one permitted
    // submit so an identical own comment arriving late is not posted twice.
    if (identity && !before.submitted && (before.duplicateFound || (owned && before.drafted &&
        commentRows().some(row => row.author === ownProfile && row.text === request.comment)))) {
      before.duplicateFound = true;
      return { point: null, clicked: false, reason: 'own-comment-already-exists' };
    }
    if (request.action === 'comment-submit') return { point: ready || null };
    if (!ready || typeof submit.click !== 'function') return { clicked: false };
    before.submitted = true;
    before.inputtingUntil = Date.now() + 1000;
    submit.click();
    return { clicked: true };
  }
  if (request.action === 'comment-clear') return { point: owned && before.drafted && !before.submitted && composerValue(composer) === request.comment ? point(composer) : null };
  if (request.action === 'comment-cleared') return { cleared: Boolean(owned && before.drafted && before.clearing && !before.submitted && composerValue(composer) === '') };
  if (request.action === 'verify-comment') {
    const unconfirmed = reason => ({ confirmed: false, reason });
    if (!identity) return unconfirmed('identity-changed');
    if (before.caption !== caption) return unconfirmed('caption-changed');
    if (!before.submitted) return unconfirmed('not-submitted');
    if (before.interrupted) return unconfirmed('interrupted');
    if (!composer) return unconfirmed('composer-unavailable');
    if (replying) return unconfirmed('reply-mode');
    if (composerValue(composer) !== '') return unconfirmed('composer-not-empty');
    const rows = commentRows();
    // React can remove or remount unrelated comments after submission. Preserve
    // our own prior text counts, including duplicates, independently of those rows.
    const rowKey = row => JSON.stringify([row.author, row.text]);
    const remaining = new Map();
    for (const row of rows) {
      const key = rowKey(row);
      remaining.set(key, (remaining.get(key) || 0) + 1);
    }
    for (const previous of before.rows) {
      if (previous.author !== before.author) continue;
      const key = rowKey(previous);
      const count = remaining.get(key) || 0;
      if (!count) return unconfirmed('baseline-changed');
      remaining.set(key, count - 1);
    }
    const added = rows.filter(row => row.author === ownProfile && row.text === request.comment && visible(row.textNode));
    if (!added.length) return unconfirmed('own-row-missing');
    if (added.length !== 1) return unconfirmed('own-row-ambiguous');
    if (before.rows.some(previous => previous.node === added[0].node || previous.textNode === added[0].textNode)) return unconfirmed('own-row-not-new');
    return { confirmed: true, commenter: ownProfile };
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
