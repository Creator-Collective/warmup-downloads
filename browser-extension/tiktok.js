// Runs in the guest's isolated world. Every action resolves its control again
// inside the active video's card; a search tile is never an open viewer.
function inspectTikTok(request = {}) {
  const visible = element => {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight &&
      rect.right > 0 && rect.left < innerWidth && style.visibility !== 'hidden' && style.display !== 'none';
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
  const videoURL = value => {
    try {
      const url = new URL(value, location.href);
      return ['www.tiktok.com', 'tiktok.com'].includes(url.hostname) && /^\/@[\w.-]+\/video\/\d+\/?$/.test(url.pathname)
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
    .filter(element => visible(element) && !element.closest('[data-e2e="video-desc"], [data-e2e="browse-video-desc"], [data-e2e*="comment"]') &&
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
  const links = all(document, 'a[href]');
  const sequence = unique(links.map(link => videoURL(link.href)).filter(Boolean));
  const posts = unique(links.filter(visible).map(link => videoURL(link.href)).filter(Boolean));
  const empty = () => request.action ? { changed: true, point: null, clicked: false, confirmed: false } : { posts, sequence, post: null };
  const pageId = videoURL(location.href);
  const dialogs = all(document, '[role="dialog"]').filter(element => visible(element) && all(element, 'video').some(visible));
  if (dialogs.length > 1) return empty();
  const viewer = dialogs[0] || null;
  // Search/profile cards can autoplay previews. Opening one is required first.
  if (!pageId && !viewer && !/^\/(?:foryou|following|friends)\/?$/.test(location.pathname)) return empty();
  const main = viewer || document.querySelector('main, [role="main"]') || document.body;
  const videos = all(main, 'video').filter(visible);
  const area = element => {
    const r = element.getBoundingClientRect();
    return (Math.min(innerWidth, r.right) - Math.max(0, r.left)) * (Math.min(innerHeight, r.bottom) - Math.max(0, r.top));
  };
  const playing = videos.filter(video => !video.paused && !video.ended && video.readyState >= 2);
  const candidates = (playing.length ? playing : videos).sort((a, b) => area(b) - area(a));
  const video = candidates[0];
  if (!video || (candidates[1] && area(video) < area(candidates[1]) * 2)) return empty();
  // Include sibling author/action panels, but never cross into another card.
  let scope = video.parentElement;
  for (let parent = scope; parent && main.contains(parent); parent = parent.parentElement) {
    // Browse dialogs preload the next video below the viewport. Only that
    // trusted viewer may ignore its offscreen video while finding siblings.
    if (all(parent, 'video').some(other => other !== video && (!viewer || visible(other)))) break;
    scope = parent;
    if (parent === main || parent.matches('article, [data-e2e="recommend-list-item-container"], [data-e2e="feed-item"]')) break;
  }
  if (!scope) return empty();
  const scopedIds = unique(all(scope, 'a[href]').filter(link => !viewer || visible(link)).map(link => videoURL(link.href)).filter(Boolean));
  const id = pageId || (scopedIds.length === 1 ? scopedIds[0] : null);
  if (!id || (pageId && scopedIds.length && !scopedIds.includes(pageId))) return empty();
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
  const next = only(unique([...exact(main, '[data-e2e="arrow-right"], [data-e2e="arrow-down"], [data-e2e="browse-next"]'), ...semantic(main, /^(?:next|next video|go to next video|scroll down)$/)]));
  const close = viewer ? only(unique([...exact(viewer, '[data-e2e="browse-close"]'), ...semantic(viewer, /^close(?: video)?$/)])) : null;
  const textNodes = all(scope, '[data-e2e="browse-video-desc"], [data-e2e="video-desc"], h1, h2, p, a[href*="/tag/"]')
    .filter(visible).map(element => element.innerText || element.textContent || '').filter(Boolean);
  const caption = (textNodes.join(' ') || (pageId ? document.querySelector('meta[property="og:description"]')?.content : '') || '').slice(0, 6000);
  const videoRemainingMs = !video.paused && !video.ended && video.readyState >= 2 &&
    Number.isFinite(video.duration) && video.duration > 0 && video.duration <= 120 &&
    Number.isFinite(video.currentTime) && video.currentTime >= 0 && video.currentTime < video.duration &&
    Number.isFinite(video.playbackRate) && video.playbackRate > 0
    ? Math.ceil((video.duration - video.currentTime) / video.playbackRate * 1000) : null;
  const post = { id, author, videoRemainingMs, viewer: true, next: Boolean(point(next)), close: Boolean(point(close)), text: caption, caption,
    like: Boolean(point(like)) && !liked, follow: Boolean(point(follow)) && !following, comment: false };
  if (!request.action) return { posts, sequence, post };
  if (request.id !== id || (request.author && request.author !== author)) return { changed: true, clicked: false, confirmed: false };
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
  if (request.action === 'verify-comment') return { confirmed: false };
  return { point: null, ready: false };
}

globalThis.inspectTikTok = inspectTikTok;
