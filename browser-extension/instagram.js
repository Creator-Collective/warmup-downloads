function confirmedOwnComment(before, rows, composerValue, expectedPost) {
  return Boolean(before && before.postId === expectedPost && before.author && composerValue === '' &&
    rows.some(row => row.postId === expectedPost && row.author === before.author && row.text === before.text && !before.ids.includes(row.id)));
}

// This observer runs in the guest's isolated world. It returns only the visible
// post and exact controls used by the local session; it never reads credentials.
function inspectInstagram(request = {}) {
  const visible = element => {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight &&
      rect.right > 0 && rect.left < innerWidth && style.visibility !== 'hidden' && style.display !== 'none';
  };
  const label = element => (element.getAttribute('aria-label') || element.textContent || '').trim();
  const control = (scope, name, accept = () => true) => [...scope.querySelectorAll('button, [role="button"]')].find(element =>
    accept(element) && visible(element) && !element.disabled && element.getAttribute('aria-disabled') !== 'true' &&
    (label(element).toLowerCase() === name || [...element.querySelectorAll('svg[aria-label]')].some(icon => icon.getAttribute('aria-label').toLowerCase() === name && icon.closest('button, [role="button"]') === element)));
  const point = element => {
    if (!visible(element)) return null;
    const rect = element.getBoundingClientRect();
    const x = Math.round((Math.max(0, rect.left) + Math.min(innerWidth, rect.right)) / 2);
    const y = Math.round((Math.max(0, rect.top) + Math.min(innerHeight, rect.bottom)) / 2);
    const hit = document.elementFromPoint(x, y);
    return hit && (hit === element || element.contains(hit)) ? { x, y } : null;
  };
  if (location.hostname !== 'www.instagram.com' && location.hostname !== 'instagram.com') return { blocked: 'open instagram before starting a niche session.' };
  if (/\/(accounts|challenge|checkpoint)\//.test(location.pathname) || [...document.querySelectorAll('input[type="password"]')].some(visible)) return { blocked: 'finish instagram’s sign-in or account check, then start a new session.' };
  const dialogs = [...document.querySelectorAll('[role="dialog"], [role="alert"]')].filter(visible);
  const warnings = dialogs.map(element => element.innerText || '').join(' ').toLowerCase();
  if (/try again later|we restrict certain activity|action blocked|suspended|confirm.*identity|unusual activity|couldn.t post|couldn.t send/.test(warnings)) return { blocked: 'instagram needs your attention. the session has stopped.' };
  const scopes = [...document.querySelectorAll('article')].filter(visible);
  const postDialog = dialogs.find(element => element.querySelector('a[href*="/p/"], a[href*="/reel/"], textarea'));
  let scope = postDialog?.querySelector('article') || postDialog || scopes.sort((a, b) => {
    const distance = element => Math.abs(element.getBoundingClientRect().top + Math.min(element.getBoundingClientRect().height, innerHeight) / 2 - innerHeight / 2);
    return distance(a) - distance(b);
  })[0];
  // Newer Instagram permalink pages use ordinary containers instead of article.
  // Find the smallest container shared by the post media and its composer.
  if (!scope && /^\/(p|reel)\/[\w-]+\/?$/.test(location.pathname)) {
    const main = document.querySelector('main,[role="main"]') || document.body;
    const media = main?.querySelector('video') || [...(main?.querySelectorAll('img[alt]') || [])].find(image => !/profile picture/i.test(image.alt) && visible(image));
    const composer = main?.querySelector('textarea') || control(main, 'comment');
    if (media && composer) {
      let parent = composer.parentElement;
      while (parent && parent !== main && !parent.contains(media)) parent = parent.parentElement;
      if (parent && parent !== main) scope = parent;
    }
  }
  const postURL = value => {
    try { const url = new URL(value, location.href); return url.origin === location.origin && /^\/(p|reel)\/[\w-]+\/?$/.test(url.pathname) ? `${url.origin}${url.pathname.replace(/\/?$/, '/')}` : null; } catch { return null; }
  };
  const sequence = [...new Set([...document.querySelectorAll('main a[href],[role="main"] a[href]')].map(link => postURL(link.href)).filter(Boolean))];
  const posts = [...new Set([...document.querySelectorAll('main a[href],[role="main"] a[href]')].filter(visible).map(link => postURL(link.href)).filter(Boolean))];
  if (!scope) return { posts, sequence, post: null };
  const locationPost = postURL(location.href);
  const contentPost = [...scope.querySelectorAll('a[href]')].map(link => {
    try {
      const u = new URL(link.href);
      const m = u.pathname.match(/^\/(?:p|reel)\/([\w-]+)(?:\/(?:c\/\d+|liked_by))?\/?$/) || u.pathname.match(/^\/[\w.]+\/reel\/([\w-]+)\/?$/);
      return u.origin === location.origin && m ? `${u.origin}/p/${m[1]}/` : null;
    } catch { return null; }
  }).find(Boolean);
  if (postDialog && (!locationPost || !contentPost)) return {posts, sequence, post:null};
  if (locationPost && contentPost && new URL(locationPost).pathname.split('/')[2] !== new URL(contentPost).pathname.split('/')[2]) return {posts, sequence, post:null};
  const id = locationPost || contentPost;
  if (!id) return { posts, sequence, post: null };
  const reserved = new Set(['explore', 'accounts', 'direct', 'reels', 'stories', 'about', 'legal']);
  const authorLink = [...scope.querySelectorAll('a[href]')].find(link => {
    const url = new URL(link.href);
    const parts = url.pathname.split('/').filter(Boolean);
    return url.origin === location.origin && parts.length === 1 && !reserved.has(parts[0]) && /^[\w.]+$/.test(parts[0]);
  });
  const author = authorLink ? new URL(authorLink.href).pathname : null;
  const visibleCaption = [...scope.querySelectorAll('h1')].filter(visible).map(element => element.innerText || element.textContent).join(' ');
  const caption = visibleCaption || (postURL(location.href) ? document.querySelector('meta[property="og:description"]')?.content || '' : '');
  const alt = [...scope.querySelectorAll('img[alt]')].map(element => element.alt).filter(text => !/profile picture/i.test(text)).join(' ');
  const ownLinks = [...document.querySelectorAll('a[href]')].filter(link => {
    if (link.closest('main, article, [role="dialog"]')) return false;
    const url = new URL(link.href);
    const username = url.pathname.split('/').filter(Boolean);
    if (url.origin !== location.origin || username.length !== 1 || !/^[\w.]+$/.test(username[0])) return false;
    const image = link.querySelector('img[alt]');
    return label(link).toLowerCase() === 'profile' || image?.alt.toLowerCase() === `${username[0].toLowerCase()}'s profile picture`;
  });
  const ownProfile = ownLinks.length === 1 ? new URL(ownLinks[0].href).pathname : null;
  const commentRows = text => [...scope.querySelectorAll('span')].flatMap(span => {
    if (span.textContent !== text || [...span.children].some(child => child.textContent === text)) return [];
    let row = span.parentElement;
    while (row && row !== scope) {
      const permalinks = [...row.querySelectorAll('a[href]')].filter(link => {
        const url = new URL(link.href);
        return url.origin === location.origin && /^\/(p|reel)\/[\w-]+\/c\/\d+\/?$/.test(url.pathname) && url.pathname.split('/')[2] === new URL(id).pathname.split('/')[2];
      });
      const ids = [...new Set(permalinks.map(link => new URL(link.href).pathname))];
      if (ids.length > 1) return [];
      if (ids.length === 1) {
        const authorLinks = [...row.querySelectorAll('a[href]')].filter(link => {
          const url = new URL(link.href);
          return url.origin === location.origin && /^\/[\w.]+\/$/.test(url.pathname);
        });
        const authors = [...new Set(authorLinks.map(link => new URL(link.href).pathname))];
        if (authors.length !== 1) return [];
        return [{ id: ids[0], postId: id, author: authors[0], text }];
      }
      row = row.parentElement;
    }
    return [];
  });
  const textarea = [...scope.querySelectorAll('textarea')].find(element => visible(element) && /comment/i.test(element.placeholder || element.getAttribute('aria-label') || ''));
  // A comment's heart also says Like. Only use the post toolbar, identified by
  // its Comment and Save/Unsave controls, so comment hearts can never be selected.
  const commentButton = control(scope, 'comment');
  let actionBar = commentButton?.parentElement;
  while (actionBar && actionBar !== scope && !control(actionBar, 'save') && !control(actionBar, 'unsave')) actionBar = actionBar.parentElement;
  if (actionBar === scope) actionBar = null;
  const like = actionBar ? control(actionBar, 'like') : null;
  let follow = control(scope, 'follow');
  // Only the author's follow button near the post header, never suggestions or commenters.
  if (!authorLink || !follow || Math.abs(follow.getBoundingClientRect().top - authorLink.getBoundingClientRect().top) > 48) follow = null;
  // Viewer navigation sits outside the article; carousel arrows sit inside it.
  const viewerNext = postDialog && scope !== postDialog ? control(postDialog, 'next', element => !scope.contains(element)) : null;
  const videos = [...scope.querySelectorAll('video')].filter(visible);
  const video = videos.length === 1 ? videos[0] : null;
  const videoRemainingMs = video && !video.paused && !video.ended && video.readyState >= 2 &&
    Number.isFinite(video.duration) && video.duration > 0 && video.duration <= 120 &&
    Number.isFinite(video.currentTime) && video.currentTime >= 0 && video.currentTime < video.duration &&
    Number.isFinite(video.playbackRate) && video.playbackRate > 0
    ? Math.ceil((video.duration - video.currentTime) / video.playbackRate * 1000) : null;
  const post = { id, author, videoRemainingMs, viewer: Boolean(postDialog), next: Boolean(point(viewerNext)), text: `${caption} ${alt}`.slice(0, 6000), caption: visibleCaption.slice(0, 6000), like: Boolean(point(like)), follow: Boolean(point(follow)), comment: Boolean(ownProfile && point(textarea)) };
  if (!request.action) return { posts, sequence, post };
  if (request.id !== id || (request.author && request.author !== author)) return { changed: true };
  if (request.action.startsWith('comment-') && request.caption !== post.caption) return { changed: true };
  if (request.action === 'next') return { point: point(viewerNext) };
  if (request.action === 'like') return { point: point(like) };
  if (request.action === 'follow') return { point: point(follow) };
  if (request.action === 'comment-field') {
    if (!ownProfile || !textarea || textarea.value.trim()) return { point: null };
    globalThis.collectiveCommentBefore = { postId: id, author: ownProfile, text: request.comment, ids: commentRows(request.comment).map(row => row.id) };
    return { point: point(textarea) };
  }
  if (request.action === 'comment-ready') return { ready: Boolean(ownProfile && globalThis.collectiveCommentBefore?.author === ownProfile && textarea && document.activeElement === textarea && textarea.value === '') };
  if (request.action === 'comment-submit') {
    const form = textarea?.closest('form');
    return { point: document.activeElement === textarea && textarea?.value === request.comment && form ? point(control(form, 'post')) : null };
  }
  if (request.action === 'verify-like') return { confirmed: Boolean(actionBar && control(actionBar, 'unlike')) };
  if (request.action === 'verify-follow') return { confirmed: ['following', 'requested'].some(name => {
    const button = control(scope, name);
    return button && authorLink && Math.abs(button.getBoundingClientRect().top - authorLink.getBoundingClientRect().top) <= 48;
  }) };
  if (request.action === 'verify-comment') {
    return { confirmed: confirmedOwnComment(globalThis.collectiveCommentBefore, commentRows(request.comment), textarea?.value, id) };
  }
  return { post, posts };
}

globalThis.inspectInstagram = inspectInstagram;
