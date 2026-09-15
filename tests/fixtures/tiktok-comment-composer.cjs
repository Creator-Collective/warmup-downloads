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
    get nodeType() { return 1; }
    get childNodes() { return [...(this.ownText ? [{ nodeType: 3, textContent: this.ownText }] : []), ...this.children]; }
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

function commentComposer({ modal = true, open = true, postId = id, withPhoto = false, searchPanel = false } = {}) {
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
  const list = page.element('div', searchPanel ? {} : { 'data-e2e': 'comment-list' }, '', page.rect(350, 230, 380, 320));
  const rows = [];
  function addComment(text, author = '@me') {
    const top = 250 + rows.length * 55;
    const row = page.element('div', searchPanel ? { class: 'DivCommentItemContainer' } : {}, '', page.rect(350, top, 340, 50));
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
  page.context.DataTransfer = class {
    constructor() { this.data = new Map(); }
    setData(type, value) { this.data.set(type, value); }
    getData(type) { return this.data.get(type) || ''; }
  };
  page.context.ClipboardEvent = class {
    constructor(type, options) { this.type = type; Object.assign(this, options); this.isTrusted = false; }
  };
  const dispatch = Object.getPrototypeOf(field).dispatchEvent;
  Object.getPrototypeOf(field).dispatchEvent = function(event) {
    dispatch.call(this, event);
    if (event.type !== 'paste' || this !== field || page.document.activeElement !== field || state.ignorePaste) return;
    field.textContent = event.clipboardData.getData('text/plain');
    submit.disabled = field.textContent === '';
    inputs.push(field.textContent);
    state.onInput(field, 'paste');
  };
  page.document.execCommand = () => { throw new Error('native DOM editing must not touch Draft.js'); };
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

// Captured TikTok search viewer: the right-hand panel's "comment" name also
// covers the post author, caption and primary engagement controls.
function searchCommentViewer({ withPhoto = false, open = true } = {}) {
  const postId = withPhoto ? 'https://www.tiktok.com/@creator/photo/234/' : id;
  const page = commentComposer({ modal: true, postId, withPhoto, open, searchPanel: true });
  page.article.tagName = 'DIV';
  page.details.attrs['data-e2e'] = 'search-comment-container';
  page.details.bounds = page.rect(350, 0, 400, 720);
  page.list.remove();
  const panelContent = page.element('div', { class: 'DivCommentListContainer' }, '', page.rect(350, 0, 400, 580));
  for (const child of [...page.details.children]) { child.remove(); panelContent.append(child); }
  panelContent.append(page.list); page.details.append(panelContent);
  // The signed-in avatar sits beside the editor, outside comment-input, in
  // the search viewer's separate bottom composer bar.
  page.footer.attrs.class = 'css-search-DivCommentBarContainer';
  const enhancedCommentBar = page.element('div', { class: 'css-search-DivEnhancedBottomCommentContainer' }, '', page.footer.bounds);
  const composerContent = page.element('div', { class: 'css-search-DivContentContainer' }, '', page.footer.bounds);
  const composerAvatar = page.element('a', { href: 'https://www.tiktok.com/@me/' }, '', page.rect(300, 610, 36, 36));
  composerAvatar.append(page.element('img', { alt: 'Your profile' }, '', page.rect(300, 610, 36, 36)));
  page.input.remove(); page.submit.remove();
  composerContent.append(composerAvatar, page.input, page.submit);
  enhancedCommentBar.append(composerContent); page.footer.append(enhancedCommentBar);
  const preload = page.element('div', { 'aria-hidden': 'true' }, '', page.rect(0, 900, 750, 650));
  const nextVideo = page.element('video', {}, '', page.rect(0, 900, 340, 500));
  Object.assign(nextVideo, { paused: false, ended: false, readyState: 4 });
  preload.append(nextVideo,
    page.element('a', { href: 'https://www.tiktok.com/@next/video/456/' }, 'next post', page.rect(350, 950, 100, 30)),
    page.element('a', { href: 'https://www.tiktok.com/@next/' }, '@next', page.rect(350, 900, 100, 30)),
    page.element('button', { 'data-e2e': 'like-icon' }, 'Like', page.rect(350, 1000, 60, 36)),
    page.element('button', { 'data-e2e': 'follow-button' }, 'Follow', page.rect(500, 900, 80, 30)));
  page.main.append(preload);
  return Object.assign(page, { preload, nextVideo, panelContent, enhancedCommentBar, composerContent, composerAvatar });
}

// Sanitized permalink structure observed during the persistence check. The
// recommendation cards share a sibling comment panel with no post-id attribute.
function freshCommentThread({ withPhoto = false, postId = withPhoto ? 'https://www.tiktok.com/@creator/photo/234/' : id, open = false } = {}) {
  const page = commentComposer({ modal: false, postId, open, withPhoto });
  const postAuthor = new URL(postId).pathname.split('/')[1];
  page.request.author = postAuthor;
  page.author.attrs.href = `https://www.tiktok.com/${postAuthor}/`;
  page.author.ownText = postAuthor;
  let photoVideoContainer = null;
  const photoSlides = withPhoto ? [page.slide] : [];
  if (withPhoto) {
    page.media.attrs = { class: 'css-live-DivPhotoPlayerContainer' };
    photoVideoContainer = page.element('div', { class: 'css-live-DivPhotoVideoContainer' }, '', page.media.bounds);
    page.carousel.remove(); photoVideoContainer.append(page.carousel); page.media.append(photoVideoContainer);
    for (let index = 2; index <= 5; index++) {
      const slide = page.element('div', { class: 'swiper-slide' }, '', page.slide.bounds);
      const image = page.element('img', { class: 'css-live-ImgPhotoSlide', src: `https://media.example.test/photo-slide-${index}.jpeg` }, '', page.photo.bounds);
      Object.assign(image, { complete: true, naturalWidth: 928, naturalHeight: 1400 });
      slide.append(image); page.carousel.append(slide); photoSlides.push(slide);
    }
  }
  Object.assign(page.article.attrs, { id: 'one-column-item-0', 'data-e2e': 'recommend-list-item-container', 'data-scroll-index': '0' });
  page.request.commenter = '@me';
  page.openButton.tagName = 'DIV';
  page.openButton.attrs = { role: 'button', tabindex: '0', 'aria-label': 'Read or add comments\n3 comments', 'data-e2e': 'comment-icon', 'data-key-interaction': 'action_comment' };
  for (const child of [...page.openButton.children]) child.remove();
  const icon = page.element('span', {}, '', page.rect(445, 155, 40, 26));
  const iconContainer = page.element('div', { 'data-testid': 'tux-web-icon-button-container' }, '', icon.bounds);
  const iconButton = page.element('button', { type: 'button', 'data-testid': 'tux-web-icon-button' }, '', icon.bounds);
  iconContainer.append(iconButton); icon.append(iconContainer);
  const count = page.element('strong', { 'data-e2e': 'comment-count' }, '3', page.rect(485, 155, 15, 26));
  page.openButton.append(icon, count);
  const rightPanel = page.element('div', { class: 'css-live-RightPanelContainer' }, '', page.rect(350, 220, 400, 500));
  const rightPanelShell = page.element('div', { class: 'css-live-DivRightPanelContainer' }, '', rightPanel.bounds);
  const panel = page.element('div', { class: 'css-live-DivTabContainer' }, '', rightPanel.bounds);
  const commentMain = page.element('div', { class: withPhoto ? 'css-live-DivCommentMainWithoutScroll' : 'css-live-DivCommentMain' }, '', page.list.bounds);
  page.list.remove(); page.list.attrs = { class: 'css-live-DivCommentListContainer' };
  for (const row of [...page.list.children]) row.remove();
  page.rows.length = 0;
  page.footer.remove(); page.footer.tagName = 'DIV'; page.footer.attrs.class = 'css-live-DivCommentFooter';
  const commentBar = page.element('div', { class: 'css-live-DivCommentBarContainer' }, '', page.footer.bounds);
  page.input.remove(); page.submit.remove(); commentBar.append(page.input, page.submit); page.footer.append(commentBar);
  if (withPhoto) {
    const inputWrapper = page.element('div', { class: 'css-live-DivCommentInputWrapper' }, '', page.footer.bounds);
    const generic = page.element('div', {}, '', page.footer.bounds);
    const inputWithPost = page.element('div', { class: 'css-live-DivTextInputWithPostContainer' }, '', page.footer.bounds);
    page.input.remove(); page.submit.remove(); inputWithPost.append(page.input, page.submit);
    generic.append(inputWithPost); inputWrapper.append(generic); commentBar.append(inputWrapper);
  }
  commentMain.append(page.list); panel.append(commentMain, page.footer); rightPanel.append(panel); rightPanelShell.append(rightPanel); page.main.append(rightPanelShell);
  rightPanel.hidden = !open;
  page.openButton.onClick = () => { page.state.opens++; rightPanel.hidden = false; page.footer.hidden = false; page.list.hidden = false; };
  function addComment(text, author = '@me') {
    const top = 250 + page.rows.length * 55;
    const object = page.element('div', { class: 'css-live-DivCommentObjectWrapper' }, '', page.rect(350, top, 340, 50));
    const row = page.element('div', { class: 'css-live-DivCommentItemWrapper' }, '', object.bounds);
    const content = page.element('div', { class: 'css-live-DivCommentContentWrapper' }, '', object.bounds);
    const authorLink = page.element('a', { href: `https://www.tiktok.com/${author}/` }, author, page.rect(350, top, 80, 20));
    const textNode = page.element('span', { 'data-e2e': 'comment-level-1' }, text, page.rect(350, top + 20, 330, 25));
    content.append(authorLink, textNode); row.append(content); object.append(row); page.list.append(object);
    const result = { object, row, content, author: authorLink, text: textNode }; page.rows.push(result); return result;
  }
  const secondary = page.element('article', { id: 'one-column-item-1', 'data-e2e': 'recommend-list-item-container', 'data-scroll-index': '1' }, '', page.rect(0, 900, 750, 650));
  const secondaryVideo = page.element('video', {}, '', page.rect(0, 960, 340, 500));
  Object.assign(secondaryVideo, { paused: true, ended: false, readyState: 4 });
  secondary.append(secondaryVideo, page.element('a', { href: 'https://www.tiktok.com/@another/video/456/' }, 'next post', page.rect(350, 910, 200, 30)),
    page.element('a', { href: 'https://www.tiktok.com/@another/' }, '@another', page.rect(350, 900, 100, 30)),
    page.element('div', { role: 'button', 'data-e2e': 'comment-icon', 'aria-label': 'Read or add comments' }, '', page.rect(440, 1050, 60, 36)));
  if (withPhoto) secondaryVideo.remove();
  page.main.append(secondary);
  return Object.assign(page, { rightPanel, rightPanelShell, panel, commentMain, commentBar, iconButton, count, secondary, secondaryVideo, photoVideoContainer, photoSlides, addComment });
}

module.exports = { fixture, commentComposer, searchCommentViewer, freshCommentThread };
