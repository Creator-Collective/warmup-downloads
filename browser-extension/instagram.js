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
  // Read-only: is any copy of this extension's comment text still in a composer?
  // Works after the post changed, so it runs before post identity checks.
  if (request.action === 'draft-state') {
    const text = typeof request.comment === 'string' ? request.comment.trim() : '';
    if (!text) return { known: false };
    const before = globalThis.collectiveCommentBefore;
    const owned = Boolean(before && before.drafted && !before.submitted && before.composer?.isConnected === true &&
      (before.interrupted || String(before.composer.value || '').trim() !== ''));
    const holding = owned || [...document.querySelectorAll('textarea')].some(field => String(field.value || '').includes(text)) ||
      [...document.querySelectorAll('[contenteditable="true"]')].some(field => (field.textContent || '').includes(text));
    if (!holding) before?.release?.();
    return { known: true, holding };
  }
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
  // Keep repeated tiles here: Next follows occurrences, not unique post IDs.
  const sequence = [...document.querySelectorAll('main a[href],[role="main"] a[href]')].map(link => postURL(link.href)).filter(Boolean);
  const posts = [...new Set([...document.querySelectorAll('main a[href],[role="main"] a[href]')].filter(visible).map(link => postURL(link.href)).filter(Boolean))];
  // Membership metadata: only the keyword grid itself, or the same grid under an open viewer.
  const gridPosts = [...new Set(sequence)].slice(0, 500);
  const search = /^\/explore\/search\/keyword\/?$/.test(location.pathname) && !postDialog
    ? { term: new URL(location.href).searchParams.get('q') || '', posts: gridPosts }
    : postDialog && !/^\/explore\//.test(location.pathname) ? { term: null, behindViewer: true, posts: gridPosts } : null;
  const listing = extra => ({ posts, sequence, ...extra, ...(search ? { search } : {}) });
  if (!scope) return listing({ post: null });
  const locationPost = postURL(location.href);
  const contentPost = [...scope.querySelectorAll('a[href]')].map(link => {
    try {
      const u = new URL(link.href);
      const m = u.pathname.match(/^\/(?:p|reel)\/([\w-]+)(?:\/(?:c\/\d+|liked_by))?\/?$/) || u.pathname.match(/^\/[\w.]+\/reel\/([\w-]+)\/?$/);
      return u.origin === location.origin && m ? `${u.origin}/p/${m[1]}/` : null;
    } catch { return null; }
  }).find(Boolean);
  if (postDialog && (!locationPost || !contentPost)) return listing({ post: null });
  if (locationPost && contentPost && new URL(locationPost).pathname.split('/')[2] !== new URL(contentPost).pathname.split('/')[2]) return listing({ post: null });
  const id = locationPost || contentPost;
  if (!id) return listing({ post: null });
  const reserved = new Set(['explore', 'accounts', 'direct', 'reels', 'stories', 'about', 'legal']);
  const authorLink = [...scope.querySelectorAll('a[href]')].find(link => {
    const url = new URL(link.href);
    const parts = url.pathname.split('/').filter(Boolean);
    return url.origin === location.origin && parts.length === 1 && !reserved.has(parts[0]) && /^[\w.]+$/.test(parts[0]);
  });
  const author = authorLink ? new URL(authorLink.href).pathname : null;
  const visibleCaption = [...scope.querySelectorAll('h1')].filter(visible).map(element => element.innerText || element.textContent).join(' ');
  // Single-page navigation can leave meta tags from an earlier post; use them only when they name this post.
  const shortcode = value => typeof value === 'string' ? value.match(/\/(?:p|reel)\/([\w-]+)/)?.[1] || null : null;
  const ogCode = shortcode(document.querySelector('meta[property="og:url"]')?.content);
  const ogText = ogCode && ogCode === shortcode(id) && postURL(location.href)
    ? (document.querySelector('meta[property="og:description"]')?.content || '')
      .replace(/^(?:[\d.,kKmM\s]+likes?,\s*[\d.,kKmM\s]+comments?\s*-\s*)?[\w.]+\s+on\s+[^:]{3,40}:\s*/u, '').replace(/^["“]|["”]\.?$/gu, '').trim()
    : '';
  const caption = visibleCaption || ogText;
  const alt = [...scope.querySelectorAll('img[alt]')].map(element => element.alt).filter(text => !/profile picture/i.test(text)).join(' ');
  // The student's own profile link: outside posts and dialogs, deduplicated by account,
  // visible links and navigation preferred. Any remaining ambiguity fails closed.
  const profileReserved = new Set([...reserved, 'p', 'reel', 'tv', 'notifications', 'create']);
  const foldLabel = value => String(value || '').normalize('NFKC').replace(/[’‘`´ʼ]/g, "'").trim().toLowerCase();
  const ownCandidates = [...document.querySelectorAll('a[href]')].flatMap(link => {
    if (link.closest('article, [role="dialog"]')) return [];
    let url; try { url = new URL(link.href); } catch { return []; }
    const parts = url.pathname.split('/').filter(Boolean);
    if (url.origin !== location.origin || url.search || parts.length !== 1 || !/^[\w.]{1,30}$/.test(parts[0]) || profileReserved.has(parts[0].toLowerCase())) return [];
    const user = parts[0].toLowerCase();
    const labelled = foldLabel(label(link)) === 'profile' || [...link.querySelectorAll('svg[aria-label]')].some(icon => foldLabel(icon.getAttribute('aria-label')) === 'profile');
    const avatar = [...link.querySelectorAll('img[alt]')].some(image => foldLabel(image.alt) === `${user}'s profile picture`);
    const inNav = Boolean(link.closest('nav, [role="navigation"]'));
    if (link.closest('main, [role="main"]') && !inNav && !labelled) return [];
    return labelled || avatar ? [{ path: `/${parts[0]}/`, user, labelled, avatar, inNav, shown: visible(link) }] : [];
  });
  const shownProfiles = ownCandidates.some(item => item.shown) ? ownCandidates.filter(item => item.shown) : ownCandidates;
  const navProfiles = shownProfiles.some(item => item.inNav) ? shownProfiles.filter(item => item.inNav) : shownProfiles;
  const strongProfiles = navProfiles.filter(item => item.labelled && item.avatar);
  const labelledProfiles = navProfiles.filter(item => item.labelled);
  const chosenProfiles = strongProfiles.length ? strongProfiles : labelledProfiles.length ? labelledProfiles : navProfiles;
  const ownProfile = new Set(chosenProfiles.map(item => item.user)).size === 1 ? chosenProfiles[0].path : null;
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
  const visibleFields = [...scope.querySelectorAll('textarea')].filter(visible);
  const hintedFields = visibleFields.filter(element => /comment/i.test(element.placeholder || element.getAttribute('aria-label') || ''));
  const hasPostLabel = form => [...form.querySelectorAll('button, [role="button"]')].some(element => label(element).toLowerCase() === 'post');
  const formFields = visibleFields.filter(element => { const form = element.closest('form'); return form && scope.contains(form) && form.querySelectorAll('textarea').length === 1 && hasPostLabel(form); });
  const textarea = hintedFields.length === 1 ? hintedFields[0] : !hintedFields.length && visibleFields.length === 1 && formFields.length === 1 ? formFields[0] : null;
  // A comment's heart also says Like. Only use the post toolbar, identified by
  // its Comment and Save/Unsave controls, so comment hearts can never be selected.
  const commentButton = control(scope, 'comment');
  let actionBar = commentButton?.parentElement;
  while (actionBar && actionBar !== scope && !control(actionBar, 'save') && !control(actionBar, 'unsave')) actionBar = actionBar.parentElement;
  if (actionBar === scope) actionBar = null;
  const like = actionBar ? control(actionBar, 'like') : null;
  // Only the author's follow button near the post header, never suggestions or commenters.
  const authorControl = name => control(scope, name, element => authorLink && Math.abs(element.getBoundingClientRect().top - authorLink.getBoundingClientRect().top) <= 48);
  const follow = authorControl('follow');
  // Viewer navigation sits outside the article; carousel arrows sit inside it.
  const viewerNext = postDialog && scope !== postDialog ? control(postDialog, 'next', element => !scope.contains(element)) : null;
  const videos = [...scope.querySelectorAll('video')].filter(visible);
  const video = videos.length === 1 ? videos[0] : null;
  const videoPlayback = video &&
    Number.isFinite(video.duration) && video.duration > 0 && video.duration <= 120 &&
    Number.isFinite(video.currentTime) && video.currentTime >= 0 && video.currentTime <= video.duration &&
    Number.isFinite(video.playbackRate) && video.playbackRate > 0
    ? { positionMs: Math.round(video.currentTime * 1000), durationMs: Math.round(video.duration * 1000), rate: video.playbackRate,
      playing: !video.paused && !video.ended && video.readyState >= 2, ended: Boolean(video.ended), source: video.currentSrc || video.src || '' } : null;
  const videoRemainingMs = videoPlayback?.playing ? Math.ceil((video.duration - video.currentTime) / video.playbackRate * 1000) : null;
  const post = { id, author, videoRemainingMs, videoPlayback, viewer: Boolean(postDialog), next: Boolean(point(viewerNext)), text: `${caption} ${alt}`.slice(0, 6000), caption: visibleCaption.slice(0, 6000), like: Boolean(point(like)), follow: Boolean(point(follow)), comment: Boolean(ownProfile && point(textarea)) };
  if (!post.comment) {
    const blocker = !ownProfile ? 'account' : 'composer';
    const lang = (document.documentElement?.getAttribute('lang') || '').trim();
    post.commentBlocker = lang && !/^en\b/i.test(lang) ? 'language' : blocker;
  }
  if (!request.action) return listing({ post });
  if (request.id !== id || (request.author && request.author !== author)) return { changed: true, reason: 'post-or-author-changed' };
  if (request.action === 'close') {
    if (!postDialog || dialogs.length !== 1) return { point: null };
    const buttons = [...document.querySelectorAll('button, [role="button"]')].filter(element =>
      !scope.contains(element) && visible(element) && !element.disabled && element.getAttribute('aria-disabled') !== 'true' &&
      (label(element).toLowerCase() === 'close' || [...element.querySelectorAll('svg[aria-label]')].some(icon => icon.getAttribute('aria-label').toLowerCase() === 'close' && icon.closest('button, [role="button"]') === element)));
    return { point: buttons.length === 1 ? point(buttons[0]) : null };
  }
  if (['comment-field', 'comment-ready', 'comment-submit'].includes(request.action) && request.caption !== post.caption) return { changed: true, reason: 'caption-changed' };
  if (request.action === 'next') return { point: point(viewerNext) };
  if (request.action === 'like') return { point: point(like) };
  if (request.action === 'follow') return { point: point(follow) };
  if (request.action === 'comment-field') {
    if (!ownProfile || !textarea || textarea.value.trim()) return { point: null };
    globalThis.collectiveCommentBefore?.release?.();
    const before = { postId: id, author: ownProfile, caption: post.caption, text: request.comment, composer: textarea, drafted: false, submitted: false, interrupted: false, ids: commentRows(request.comment).map(row => row.id) };
    // A real edit or manual Post click revokes ownership even if the text is unchanged.
    const events = ['beforeinput', 'input', 'pointerdown', 'keydown', 'click', 'submit'];
    const interrupt = event => {
      if (!event.isTrusted) return;
      const form = event.target?.closest?.('form');
      if (event.target === before.composer || event.target?.tagName === 'TEXTAREA' || form?.querySelector('textarea')) before.interrupted = true;
    };
    // Instagram replaces the textarea on input. Document capture protects the
    // replacement too, including edits made before the next inspection.
    for (const type of events) document.addEventListener(type, interrupt, true);
    before.release = () => { for (const type of events) document.removeEventListener(type, interrupt, true); };
    globalThis.collectiveCommentBefore = before;
    return { point: point(textarea) };
  }
  const before = globalThis.collectiveCommentBefore;
  const sameDraft = ownProfile && before?.postId === id && before.author === ownProfile && before.caption === post.caption && before.text === request.comment && before.drafted && !before.submitted && !before.interrupted;
  if (sameDraft && before.composer?.isConnected === false && textarea &&
      (textarea.value === before.text || (request.action === 'comment-cleared' && before.clearing && textarea.value === ''))) before.composer = textarea;
  const ownDraft = Boolean(ownProfile && before?.postId === id && before.author === ownProfile && before.text === request.comment && textarea && before.composer === textarea && !before.interrupted);
  if (request.action === 'comment-ready') return { ready: Boolean(ownDraft && !before.drafted && !before.submitted && document.activeElement === textarea && textarea.value === '') };
  if (request.action === 'comment-submit') {
    const form = textarea?.closest('form');
    const issue = !ownProfile ? 'account-unresolved' : !textarea ? 'composer-hidden' : before?.composer !== textarea ? 'composer-replaced' : before?.interrupted ? 'manual-edit-detected' : !ownDraft ? 'draft-not-owned' : textarea.value !== request.comment ? 'draft-text-changed' : !form ? 'form-missing' : 'post-control-unavailable';
    return { point: ownDraft && before.drafted && !before.submitted && textarea.value === request.comment && form ? point(control(form, 'post')) : null, reason: issue };
  }
  if (request.action === 'comment-clear') {
    return { point: ownDraft && before.drafted && !before.submitted && textarea.value === request.comment ? point(textarea) : null };
  }
  if (request.action === 'comment-cleared') {
    return { cleared: Boolean(ownDraft && before.drafted && !before.submitted && textarea.value === '') };
  }
  if (request.action === 'verify-like') return { confirmed: Boolean(actionBar && control(actionBar, 'unlike')) };
  if (request.action === 'verify-follow') return { confirmed: ['following', 'requested'].some(name => Boolean(authorControl(name))) };
  if (request.action === 'verify-comment') {
    return { confirmed: confirmedOwnComment(globalThis.collectiveCommentBefore, commentRows(request.comment), textarea?.value, id) };
  }
  return { post, posts };
}

globalThis.inspectInstagram = inspectInstagram;
