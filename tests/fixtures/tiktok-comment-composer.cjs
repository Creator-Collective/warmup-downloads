const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../../browser-extension/tiktok.js'), 'utf8');
const id = 'https://www.tiktok.com/@creator/video/123/';

// A small DOM tree fixture, with selector matching and bubbling click targets.
// Unlike flat querySelector stubs, sibling and ancestor scoping are exercised.
function fixture({ postId = id, href = postId, modal = false, tag = 'div', withVideo = true, withPhoto = false } = {}) {
  const clicks = [];
  const rect = (left = 0, top = 0, width = 60, height = 36) => ({ left, top, width, height, right: left + width, bottom: top + height });
  class Element {
    constructor(tagName, attrs = {}, text = '', bounds = rect()) {
      this.tagName = tagName.toUpperCase(); this.attrs = { ...attrs }; this.ownText = text;
      this.bounds = bounds; this.children = []; this.parentElement = null; this.disabled = false;
    }
    append(...nodes) { for (const node of nodes) { node.parentElement = this; this.children.push(node); } return this; }
    remove() { this.parentElement.children = this.parentElement.children.filter(node => node !== this); this.parentElement = null; }
    get textContent() { return this.ownText + this.children.map(child => child.textContent).join(' '); }
    set textContent(value) { this.ownText = value; this.children = []; }
    get isConnected() { return body.contains(this); }
    get isContentEditable() { return this.attrs.contenteditable === 'true'; }
    get innerText() { return this.textContent; }
    get href() { return this.attrs.href; }
    getAttribute(key) { return this.attrs[key] ?? null; }
    getBoundingClientRect() { for (let node = this; node; node = node.parentElement) if (node.hidden) return rect(0, 0, 0, 0); return this.bounds; }
    contains(target) { return target === this || this.children.some(child => child.contains(target)); }
    matches(selector) {
      return selector.split(',').some(part => {
        const rule = part.trim();
        const tagName = rule.match(/^[a-z][\w-]*/i)?.[0];
        if (tagName && tagName.toUpperCase() !== this.tagName) return false;
        for (const className of rule.replace(/\[[^\]]*\]/g, '').matchAll(/\.([\w-]+)/g)) if (!(this.attrs.class || '').split(/\s+/).includes(className[1])) return false;
        const id = rule.match(/#([\w-]+)/)?.[1];
        if (id && this.attrs.id !== id) return false;
        for (const match of rule.matchAll(/\[([\w-]+)(\*=|=)?(?:"([^"]*)")?\]/g)) {
          const [, key, op, value] = match;
          if (!(key in this.attrs) || (op === '=' && this.attrs[key] !== value) || (op === '*=' && !this.attrs[key].includes(value))) return false;
        }
        return true;
      });
    }
    closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
    querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    scrollIntoView() { this.scrolled = true; }
    focus() { document.activeElement = this; }
    dispatchEvent(event) { event.target = this; for (const listener of listeners.get(event.type) || []) listener(event); }
    click() { clicks.push(this); for (let node = this; node; node = node.parentElement) node.onClick?.(); }
  }
  const element = (tagName, attrs, text, bounds) => new Element(tagName, attrs, text, bounds);
  const body = element('body', {}, '', rect(0, 0, 1000, 800));
  const main = element('main', modal ? { role: 'dialog' } : {}, '', rect(0, 0, 800, 750));
  const article = element('article', {}, '', rect(0, 0, 750, 650));
  const media = element('div', { 'data-e2e': 'browse-video' }, '', rect(0, 60, 340, 500));
  const video = element('video', {}, '', rect(0, 60, 340, 500));
  Object.assign(video, { paused: false, ended: false, readyState: 4, duration: 20, currentTime: 8, playbackRate: 1 });
  if (withVideo && !withPhoto) media.append(video);
  const photo = element('img', { class: 'ImgPhotoSlide', src: `https://p16-sign.tiktokcdn-us.com/photos/${new URL(postId).pathname.split('/').filter(Boolean).at(-1)}.jpeg?token=first` }, '', rect(0, 60, 340, 500));
  Object.assign(photo, { complete: true, naturalWidth: 928, naturalHeight: 1400 });
  const slide = element('div', { class: 'swiper-slide swiper-slide-active' }, '', rect(0, 60, 340, 500));
  const carousel = element('div', { class: 'swiper swiper-horizontal' }, '', rect(0, 60, 340, 500));
  if (withPhoto) { slide.append(photo); carousel.append(slide); media.append(carousel); }
  const details = element('div', {}, '', rect(350, 0, 300, 500));
  const header = element('div', {}, '', rect(350, 0, 300, 60));
  const author = element('a', { href: 'https://www.tiktok.com/@creator/' }, '@creator', rect(350, 0, 100, 30));
  const follow = element(tag, { 'data-e2e': 'follow-button' }, 'Follow', rect(500, 0, 80, 30));
  follow.onClick = () => { follow.ownText = 'Following'; };
  const caption = element('p', { 'data-e2e': 'browse-video-desc' }, 'personal branding setup checklist', rect(350, 60, 280, 40));
  const link = element('a', { href: postId + '?lang=en' }, 'video', rect(350, 110, 200, 30));
  const actions = element('div', {}, '', rect(350, 150, 240, 40));
  const like = element(tag, { 'data-e2e': 'like-icon', 'aria-pressed': 'false' }, '', rect(350, 150, 60, 36));
  const heart = element('svg', { fill: 'rgb(22, 24, 35)' }, '', rect(355, 155, 50, 26));
  like.append(heart); like.onClick = () => { like.attrs['aria-pressed'] = 'true'; };
  const next = element('button', { 'aria-label': 'Next video' }, '', rect(700, 500, 60, 36));
  const close = element('button', { 'aria-label': 'Close' }, '', rect(700, 0, 60, 36));
  header.append(author, follow); actions.append(like); details.append(header, caption, link, actions); article.append(media, details); main.append(article, next); if (modal) main.append(close); body.append(main);
  const listeners = new Map();
  const document = {
    body, activeElement: null, contains: node => body.contains(node),
    addEventListener(type, listener) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(listener); },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener); },
    getElementById: id => body.querySelectorAll('[id]').find(node => node.attrs.id === id) || null,
    querySelectorAll: selector => body.querySelectorAll(selector),
    querySelector: selector => body.querySelector(selector),
    elementFromPoint(x, y) {
      function hit(node) {
        if (node.hidden) return null;
        for (const child of [...node.children].reverse()) { const found = hit(child); if (found) return found; }
        const r = node.bounds;
        return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom ? node : null;
      }
      return hit(body);
    }
  };
  const location = new URL(href);
  const context = vm.createContext({ URL, document, location, innerWidth: 1000, innerHeight: 800,
    getComputedStyle: node => ({ visibility: node.hidden ? 'hidden' : 'visible', display: node.hidden ? 'none' : 'block', fill: node.computedFill || node.attrs.fill || '' }) });
  const load = () => vm.runInContext(source, context);
  load();
  return { element, rect, body, main, article, media, details, header, author, follow, caption, link, actions, like, heart, video, photo, slide, carousel, next, close, clicks, document, context,
    load,
    interact(type, target = document.activeElement, isTrusted = true) { for (const listener of listeners.get(type) || []) listener({ type, isTrusted, target }); },
    inject(func, args) { context.callArgs = args; return vm.runInContext(`(${func.toString()})(...callArgs)`, context); },
    inspect: request => context.inspectTikTok(request) };
}

function commentComposer({ modal = true, open = true, postId = id, withPhoto = false } = {}) {
  const page = fixture({ modal, postId, withPhoto });
  const caption = page.caption.textContent;
  const request = { id: postId, author: '@creator', caption, comment: 'this setup tip is useful for personal branding' };
  const profile = page.element('a', { 'data-e2e': 'nav-profile', href: 'https://www.tiktok.com/@me/' }, 'Profile', page.rect(850, 0, 100, 36));
  page.body.append(profile);
  const footer = page.element('footer', {}, '', page.rect(350, 590, 400, 120));
  const input = page.element('div', { 'data-e2e': 'comment-input' }, '', page.rect(350, 600, 280, 60));
  const editor = page.element('div', { 'data-e2e': 'comment-text' }, '', page.rect(350, 600, 280, 60));
  const newField = () => page.element('div', { contenteditable: 'true', role: 'textbox', 'aria-label': 'Add comment...' }, '', page.rect(350, 600, 280, 60));
  let field = newField();
  const submit = page.element('button', { 'data-e2e': 'comment-post', 'aria-label': 'Post' }, 'Post', page.rect(650, 610, 70, 36));
  submit.disabled = true;
  let submitted = 0;
  const inputs = [];
  const state = { confirm: true, onInput() {}, onSubmit() {}, opens: 0 };
  const warning = page.element('div', {}, 'Too many requests', page.rect(0, 720, 900, 60));
  warning.hidden = true; page.body.append(warning);
  Object.defineProperty(state, 'blocked', { get: () => !warning.hidden, set: value => { warning.hidden = !value; } });
  const list = page.element('div', { 'data-e2e': 'comment-list' }, '', page.rect(350, 230, 380, 320));
  const rows = [];
  function addComment(text, author = '@me') {
    const top = 250 + rows.length * 55;
    const row = page.element('div', {}, '', page.rect(350, top, 340, 50));
    const authorLink = page.element('a', { href: `https://www.tiktok.com/${author}/` }, author, page.rect(350, top, 80, 20));
    const textNode = page.element('span', { 'data-e2e': 'comment-level-1' }, text, page.rect(350, top + 20, 330, 25));
    row.append(authorLink, textNode); list.append(row);
    const result = { row, author: authorLink, text: textNode }; rows.push(result); return result;
  }
  addComment('a different existing comment', '@someone');
  const openButton = page.element('button', { 'aria-label': 'Comments' }, '', page.rect(440, 150, 60, 36));
  openButton.append(page.element('span', { 'data-e2e': 'comment-icon' }, '', page.rect(445, 155, 50, 26)));
  openButton.onClick = () => { state.opens++; footer.hidden = false; list.hidden = false; };
  page.actions.append(openButton);
  submit.onClick = () => {
    submitted++;
    if (state.confirm) { addComment(request.comment); field.textContent = ''; submit.disabled = true; }
    state.onSubmit();
  };
  editor.append(field); input.append(editor); footer.append(input, submit); page.main.append(list, footer);
  footer.hidden = !open; list.hidden = !open;
  let selectionRange;
  page.document.createRange = () => ({ field: null, selectNodeContents(element) { this.field = element; }, collapse() {} });
  page.document.getSelection = () => ({ removeAllRanges() { selectionRange = null; }, addRange(range) { selectionRange = range; } });
  page.context.getSelection = page.document.getSelection;
  page.document.execCommand = (command, _ui, value) => {
    if (selectionRange?.field !== field || page.document.activeElement !== field) return false;
    page.interact('beforeinput', field);
    if (command === 'insertText') field.textContent = value;
    else if (command === 'delete') field.textContent = '';
    else return false;
    submit.disabled = field.textContent === '';
    inputs.push(field.textContent);
    page.interact('input', field);
    state.onInput(field, command);
    return true;
  };
  return {
    ...page, request, profile, footer, editor, input, submit, openButton, list, rows, state, inputs, addComment, heading: page.caption,
    interact(type, isTrusted = true, target = field) { page.interact(type, target, isTrusted); },
    get field() { return field; }, get submitted() { return submitted; },
    inspect: action => page.inspect({ ...request, action }),
    prepare() {
      page.inspect({ ...request, action: 'comment-field' }); field.focus(); field.textContent = request.comment; submit.disabled = false;
      page.context.collectiveCommentBefore.drafted = true;
    },
    replaceField(value = '') { const old = field; old.remove(); field = newField(); field.textContent = value; editor.append(field); return field; }
  };
}

module.exports = { fixture, commentComposer };
