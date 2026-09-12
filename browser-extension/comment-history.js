(() => {
  'use strict';
  function normalize(entries) {
    const seen = new Set();
    return (Array.isArray(entries) ? entries.slice(0, 20) : []).flatMap(item => {
      if (!item || typeof item.text !== 'string' || !item.text.trim() || item.text.length > 500 ||
          !['confirmed', 'uncertain'].includes(item.status) || !Number.isFinite(item.time) || item.time < 0 || item.time > 8640000000000000) return [];
      let url;
      try { url = new URL(item.url); } catch { return []; }
      if (url.protocol !== 'https:' || url.port || url.username || url.password || url.search || url.hash) return [];
      let canonical, author, identity;
      if (['www.instagram.com', 'instagram.com'].includes(url.hostname)) {
        const post = url.pathname.match(/^\/(?:p|reel)\/([\w-]+)\/?$/);
        if (!post) return [];
        identity = `instagram:${post[1]}`;
        canonical = `https://www.instagram.com/p/${post[1]}/`;
        const value = typeof item.author === 'string' ? item.author.replace(/^\/+|\/+$/g, '') : '';
        author = /^[\w.]{1,30}$/.test(value) ? value : '';
      } else if (['www.tiktok.com', 'tiktok.com'].includes(url.hostname)) {
        const post = url.pathname.match(/^\/@([\w.]{1,30})\/(video|photo)\/(\d+)\/?$/);
        if (!post) return [];
        const value = typeof item.author === 'string' ? item.author.replace(/^\/+|\/+$/g, '').replace(/^@/, '') : '';
        if (value && (!/^[\w.]{1,30}$/.test(value) || value.toLowerCase() !== post[1].toLowerCase())) return [];
        identity = `tiktok:${post[2]}:${post[3]}`;
        author = post[1];
        canonical = `https://www.tiktok.com/@${author}/${post[2]}/${post[3]}/`;
      } else return [];
      if (seen.has(identity)) return [];
      seen.add(identity);
      return [{ text: item.text, url: canonical, author, time: item.time, status: item.status }];
    });
  }

  function render(document, entries) {
    const comments = normalize(entries);
    const section = document.getElementById('comment-history');
    const list = document.getElementById('comments');
    section.hidden = !comments.length;
    const key = JSON.stringify(comments);
    if (list.dataset.key === key) return;
    list.dataset.key = key;
    const scrollTop = list.scrollTop;
    list.replaceChildren(...comments.map(item => {
      const row = document.createElement('li');
      const meta = document.createElement('div'); meta.className = 'comment-meta';
      const link = document.createElement('a');
      link.href = item.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.title = 'open post';
      link.textContent = item.author ? `@${item.author}'s post` : 'view post';
      const status = document.createElement('span'); status.className = 'comment-status';
      status.dataset.status = item.status; status.textContent = item.status === 'confirmed' ? 'posted' : 'not confirmed';
      const time = document.createElement('time'); time.dateTime = new Date(item.time).toISOString();
      time.textContent = new Date(item.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const text = document.createElement('p'); text.className = 'comment-text'; text.textContent = item.text;
      meta.append(link, status, time); row.append(meta, text); return row;
    }));
    // Activity polls and new comments must not move a comment the user is reading.
    list.scrollTop = scrollTop;
  }
  globalThis.commentHistory = { normalize, render };
  if (typeof module !== 'undefined') module.exports = globalThis.commentHistory;
})();
