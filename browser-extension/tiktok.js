// This observer runs in the guest's isolated world. It reads only visible
// TikTok video context and exact controls used by the local warm-up session.
function inspectTikTok(request = {}) {
  const visible = element => {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight &&
      rect.right > 0 && rect.left < innerWidth && style.visibility !== 'hidden' && style.display !== 'none';
  };
  const label = element => (element.getAttribute('aria-label') || element.getAttribute('title') || element.textContent || '').trim();
  const buttons = scope => [...scope.querySelectorAll('button, [role="button"]')].filter(visible);
  const control = (scope, accept) => buttons(scope).find(element => accept(label(element).toLowerCase(), element));
  const byData = (scope, selector) => {
    const node = scope.querySelector(selector);
    return visible(node) ? node.closest('button, [role="button"]') : null;
  };
  const point = element => {
    if (!visible(element)) return null;
    const rect = element.getBoundingClientRect();
    const x = Math.round((Math.max(0, rect.left) + Math.min(innerWidth, rect.right)) / 2);
    const y = Math.round((Math.max(0, rect.top) + Math.min(innerHeight, rect.bottom)) / 2);
    const hit = document.elementFromPoint(x, y);
    return hit && (hit === element || element.contains(hit) || element === hit.closest?.('button,[role="button"]')) ? { x, y } : null;
  };
  const videoURL = value => {
    try {
      const url = new URL(value, location.href);
      const match = url.pathname.match(/^\/@[\w.-]+\/video\/\d+\/?$/);
      return ['www.tiktok.com', 'tiktok.com'].includes(url.hostname) && match ? `https://www.tiktok.com${url.pathname.replace(/\/?$/, '/')}` : null;
    } catch { return null; }
  };
  if (!['www.tiktok.com', 'tiktok.com'].includes(location.hostname)) return { blocked: 'open tiktok before starting a niche session.' };
  if (/\/(?:login|signup)\b/.test(location.pathname) || [...document.querySelectorAll('input[type="password"]')].some(visible)) return { blocked: 'finish tiktok sign-in or account check, then start a new session.' };
  const dialogs = [...document.querySelectorAll('[role="dialog"], [role="alert"]')].filter(visible);
  const warnings = dialogs.map(element => element.innerText || '').join(' ').toLowerCase();
  if (/try again later|too fast|captcha|verify|suspended|unusual activity/.test(warnings)) return { blocked: 'tiktok needs your attention. the session has stopped.' };
  const main = document.querySelector('main,[role="main"]') || document.body;
  const sequence = [...new Set([...document.querySelectorAll('main a[href],[role="main"] a[href],a[href]')].map(link => videoURL(link.href)).filter(Boolean))];
  const posts = [...new Set([...document.querySelectorAll('main a[href],[role="main"] a[href],a[href]')].filter(visible).map(link => videoURL(link.href)).filter(Boolean))];
  // TikTok's FYP usually keeps `/foryou` in the tab URL. Resolve the active
  // video from the visible card first so a feed session can actually engage.
  const scopes = [...document.querySelectorAll('[data-e2e="browse-video"], [data-e2e="feed-video"], article, main, [role="main"]')].filter(visible);
  const scope = scopes.find(candidate => candidate.querySelector('[data-e2e="like-icon"], [data-e2e="browse-like-icon"], video')) || scopes[0] || main;
  const scopedPosts = [...scope.querySelectorAll('a[href]')].filter(visible).map(link => videoURL(link.href)).filter(Boolean);
  const id = videoURL(location.href) || scopedPosts[0] || posts[0] || null;
  if (!id) return { posts, sequence, post: null };
  const author = new URL(id).pathname.split('/')[1];
  const textNodes = [
    ...scope.querySelectorAll('[data-e2e="browse-video-desc"], [data-e2e="video-desc"], h1, h2, strong, p, a[href*="/tag/"]')
  ].filter(visible).map(element => element.innerText || element.textContent || '').filter(Boolean);
  const caption = (textNodes.join(' ') || document.querySelector('meta[property="og:description"]')?.content || '').slice(0, 6000);
  const like = byData(scope, '[data-e2e="like-icon"], [data-e2e="browse-like-icon"]') ||
    control(scope, (name, element) => /\blike\b/.test(name) && !/\bliked\b|\bunlike\b/.test(name) && !/comment/.test(name) && !element.querySelector?.('[data-e2e*="comment"]'));
  const liked = byData(scope, '[data-e2e="unlike-icon"], [data-e2e="browse-liked-icon"]') ||
    control(scope, name => /\bliked\b|\bunlike\b/.test(name));
  const follow = control(scope, name => /^follow$|^follow /.test(name));
  const following = control(scope, name => /^following$|^friends$|^requested$/.test(name));
  const next = control(document, name => /^next$|next video|scroll down/.test(name)) ||
    byData(document, '[data-e2e="arrow-right"], [data-e2e="arrow-down"]');
  const videos = [...scope.querySelectorAll('video')].filter(visible);
  const video = videos.length === 1 ? videos[0] : null;
  const videoRemainingMs = video && !video.paused && !video.ended && video.readyState >= 2 &&
    Number.isFinite(video.duration) && video.duration > 0 && video.duration <= 120 &&
    Number.isFinite(video.currentTime) && video.currentTime >= 0 && video.currentTime < video.duration &&
    Number.isFinite(video.playbackRate) && video.playbackRate > 0
    ? Math.ceil((video.duration - video.currentTime) / video.playbackRate * 1000) : null;
  const post = { id, author, videoRemainingMs, viewer: true, next: Boolean(point(next)), text: caption, caption, like: Boolean(point(like)) && !point(liked), follow: Boolean(point(follow)) && !point(following), comment: false };
  if (!request.action) return { posts, sequence, post };
  if (request.id !== id || (request.author && request.author !== author)) return { changed: true };
  if (request.action === 'next') return { point: point(next) };
  if (request.action === 'like') return { point: post.like ? point(like) : null };
  if (request.action === 'follow') return { point: post.follow ? point(follow) : null };
  if (request.action === 'comment-field' || request.action === 'comment-ready' || request.action === 'comment-submit') return { point: null, ready: false };
  if (request.action === 'verify-like') return { confirmed: Boolean(point(liked)) };
  if (request.action === 'verify-follow') return { confirmed: Boolean(point(following)) };
  if (request.action === 'verify-comment') return { confirmed: false };
  return { post, posts };
}

globalThis.inspectTikTok = inspectTikTok;
