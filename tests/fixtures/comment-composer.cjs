const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../../browser-extension/instagram.js'), 'utf8');

// The live composer is a textarea and a role=button Post control inside a form.
module.exports = function commentComposer() {
  const id = 'https://www.instagram.com/p/example/';
  const caption = 'Study tips work best when you practice a little every day.';
  const request = { id, author: '/creator/', caption, comment: 'this part stood out: "Study tips work best when you practice a little every day"' };
  const rect = (left, top, width = 40, height = 30) => ({ left, top, width, height, right: left + width, bottom: top + height });
  const element = (textContent, bounds) => ({
    textContent, getAttribute: () => null, getBoundingClientRect: () => bounds,
    querySelectorAll: () => [], contains(target) { return target === this; }
  });
  let submitted = 0;
  let followClicks = 0;
  const inputs = [];
  const document = { activeElement: null };
  const author = { ...element('creator', rect(20, 20)), href: 'https://www.instagram.com/creator/' };
  const profile = { ...element('Profile', rect(0, 0)), href: 'https://www.instagram.com/me/', closest: () => null, querySelector: () => null };
  const heading = element(caption, rect(20, 60, 400));
  const state = { blocked: false, onInput() {}, onSubmit() {}, confirm: true, follow: null };
  class TextArea {
    constructor() { this._value = ''; this.placeholder = 'Add a comment...'; this.isConnected = true; }
    get value() { return this._value; }
    set value(value) { this._value = value; }
    getAttribute() { return null; }
    getBoundingClientRect() { return rect(20, 400, 300, 60); }
    closest(selector) { return selector === 'form' ? form : null; }
    focus() { document.activeElement = this; }
    dispatchEvent(event) { inputs.push(this.value); state.onInput(this, event); }
  }
  let field = new TextArea();
  const submit = {
    ...element('Post', rect(400, 410)), disabled: false, ariaDisabled: null,
    getAttribute(name) { return name === 'aria-disabled' ? this.ariaDisabled : null; },
    closest() { return this; },
    click() { submitted++; if (state.confirm) field.value = ''; state.onSubmit(); }
  };
  const follow = {
    ...element('', rect(400, 20)), disabled: false,
    get textContent() { return state.follow || ''; },
    closest() { return this; },
    click() { followClicks++; state.follow = null; }
  };
  const listeners = new Map();
  const form = {
    querySelector: () => field,
    querySelectorAll: selector => selector === 'button, [role="button"]' ? [submit] : [],
    addEventListener(type, handler) { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(handler); },
    removeEventListener(type, handler) { listeners.get(type)?.delete(handler); }
  };
  document.addEventListener = form.addEventListener;
  document.removeEventListener = form.removeEventListener;
  const row = { querySelectorAll: () => [profile, { href: `${id}c/123/` }] };
  const comment = { textContent: request.comment, children: [], parentElement: row };
  const scope = {
    ...element('', rect(0, 0, 600, 600)),
    querySelectorAll: selector => ({
      'a[href]': [author], 'h1': [heading], 'textarea': [field],
      'button, [role="button"]': [...(state.follow ? [follow] : []), submit], 'span': submitted && state.confirm ? [comment] : []
    })[selector] || []
  };
  document.querySelectorAll = selector => ({
    'article': [scope], 'a[href]': [profile],
    '[role="dialog"], [role="alert"]': state.blocked ? [{ ...element('', rect(0, 0, 200, 200)), innerText: 'We restrict certain activity' }] : []
  })[selector] || [];
  document.querySelector = () => null;
  document.elementFromPoint = (x, y) => [field, submit, ...(state.follow ? [follow] : [])].find(el => {
    const bounds = el.getBoundingClientRect();
    return x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom;
  }) || null;
  const context = vm.createContext({
    URL, Date, Event, document, HTMLTextAreaElement: TextArea,
    location: { hostname: 'www.instagram.com', origin: 'https://www.instagram.com', href: id, pathname: '/p/example/' },
    innerWidth: 1000, innerHeight: 800, getComputedStyle: () => ({ visibility: 'visible', display: 'block' })
  });
  const load = () => vm.runInContext(source, context);
  load();
  const inspect = action => context.inspectInstagram({ ...request, action });
  return {
    context, request, document, submit, state, inputs, heading, author, inspect, load,
    get field() { return field; }, get submitted() { return submitted; },
    get followClicks() { return followClicks; },
    replaceField() { field.isConnected = false; field = new TextArea(); return field; },
    interact(type, isTrusted = true) { for (const listener of listeners.get(type) || []) listener({ isTrusted, target: field }); },
    prepare() {
      inspect('comment-field'); field.focus(); field.value = request.comment;
      context.collectiveCommentBefore.drafted = true;
    },
    inject(func, args) {
      context.callArgs = args;
      return vm.runInContext(`(${func.toString()})(...callArgs)`, context);
    }
  };
};
