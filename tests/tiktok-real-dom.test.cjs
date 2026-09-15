const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

// Use the real observer and injected runner action together. The platform tree
// fixtures cannot expose differences between Draft.js state and its owned DOM.
const observerSource = fs.readFileSync(path.join(__dirname, '../browser-extension/tiktok.js'), 'utf8');
const runnerSource = fs.readFileSync(path.join(__dirname, '../browser-extension/runner.js'), 'utf8');
const marker = 'const clicked = await execute(';
const start = runnerSource.indexOf(marker, runnerSource.indexOf('async function performEngagement')) + marker.length;
const end = runnerSource.indexOf(', [action, request, job.deadline]);', start);
assert.ok(start >= marker.length && end > start, 'production injected draft action must be found');
const injectedAction = runnerSource.slice(start, end);

async function withTikTokEditor({ kind = 'video', afterSubmit = 'append' } = {}, exercise) {
  const id = `https://www.tiktok.com/@creator/${kind}/123/`;
  const caption = 'personal branding setup checklist';
  const request = { id, author: '@creator', caption, comment: 'this setup tip is useful for personal branding' };
  const dom = new JSDOM('<div id="root"></div>', { url: id, runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  const globals = ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'Node', 'Element', 'MutationObserver',
    'getSelection', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame', 'IS_REACT_ACT_ENVIRONMENT'];
  const previousGlobals = new Map(globals.map(name => [name, Object.getOwnPropertyDescriptor(global, name)]));
  for (const name of globals.slice(0, 7)) global[name] = name === 'window' ? window : window[name];
  for (const name of globals.slice(7, 11)) global[name] = window[name].bind(window);
  global.IS_REACT_ACT_ENVIRONMENT = true;

  const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });
  const editorRect = rect(500, 650, 300, 40);
  const submitRect = rect(850, 650, 80, 40);
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.matches('video, img.ImgPhotoSlide')) return rect(0, 70, 340, 500);
    if (this.matches('[data-e2e="comment-post"]')) return submitRect;
    if (this.closest('[data-e2e="comment-input"]')) return editorRect;
    return rect(0, 0, 1000, 800);
  };
  window.Range.prototype.getBoundingClientRect = () => editorRect;
  window.Range.prototype.getClientRects = () => [editorRect];
  Object.defineProperty(window.HTMLElement.prototype, 'isContentEditable', { get() { return this.getAttribute('contenteditable') === 'true'; } });
  window.document.elementFromPoint = (x, y) => {
    if (x >= submitRect.left && x <= submitRect.right && y >= submitRect.top && y <= submitRect.bottom) return window.document.querySelector('[data-e2e="comment-post"]');
    if (x >= editorRect.left && x <= editorRect.right && y >= editorRect.top && y <= editorRect.bottom) return window.document.querySelector('[contenteditable="true"]');
    return window.document.body;
  };
  window.DataTransfer = class {
    constructor() { this.types = []; this.files = []; this.items = []; this.data = {}; }
    setData(type, value) { this.types.push(type); this.data[type] = value; }
    getData(type) { return this.data[type] || ''; }
  };
  window.ClipboardEvent = class extends window.Event {
    constructor(type, options) { super(type, options); this.clipboardData = options.clipboardData; }
  };
  window.document.execCommand = () => { throw new Error('native DOM edits must not replace controlled editor state'); };

  const React = require('react');
  const { createRoot } = require('react-dom/client');
  const { Editor, EditorState } = require('draft-js');
  const h = React.createElement;
  const errors = [];
  window.addEventListener('error', event => errors.push(event.error));
  let current, rerender, setCommentRows;
  const submitted = [];
  function App() {
    const [editorState, setEditorState] = React.useState(EditorState.createEmpty());
    const [rows, setRows] = React.useState([
      { key: 'first', author: '@someone', text: 'an existing comment about the setup' },
      { key: 'second', author: '@another', text: 'another existing comment' }
    ]);
    const [revision, setRevision] = React.useState(0);
    current = editorState;
    rerender = () => setRevision(value => value + 1);
    setCommentRows = setRows;
    const submit = () => {
      const text = editorState.getCurrentContent().getPlainText();
      submitted.push(text);
      setEditorState(EditorState.createEmpty());
      setRows(previous => {
        let retained = previous;
        if (afterSubmit === 'remove-unrelated') retained = previous.filter(row => row.key !== 'first');
        if (afterSubmit === 'remount' || afterSubmit === 'remount-without-new-row') retained = retained.map(row => ({ ...row, key: `${row.key}-remounted` }));
        return afterSubmit === 'remount-without-new-row' ? retained : [...retained, { key: 'submitted', author: '@me', text }];
      });
    };
    const media = kind === 'photo'
      ? h('div', { className: 'swiper-horizontal' }, h('div', { className: 'swiper-slide swiper-slide-active' }, h('img', { className: 'ImgPhotoSlide', src: 'https://p16-sign.tiktokcdn-us.com/photos/123.jpeg' })))
      : h('video');
    return h(React.Fragment, null,
      h('nav', null, h('a', { 'data-e2e': 'nav-profile', href: '/@me/' }, 'Profile')),
      h('main', { 'data-revision': revision },
        h('article', null, media,
          h('section', null, h('a', { href: '/@creator/' }, '@creator'), h('p', { 'data-e2e': 'browse-video-desc' }, caption))),
        h('div', { 'data-e2e': 'comment-list' }, rows.map(row => h('div', { key: row.key },
          h('a', { href: `/${row.author}/` }, row.author), h('span', { 'data-e2e': 'comment-level-1' }, row.text)))),
        h('footer', null,
          h('div', { 'data-e2e': 'comment-input' }, h('div', { 'data-e2e': 'comment-text' },
            h(Editor, { editorState, onChange: setEditorState, ariaLabel: 'Add comment...' }))),
          h('button', { 'data-e2e': 'comment-post', disabled: !editorState.getCurrentContent().getPlainText(), onClick: submit }, 'Post'))));
  }
  const root = createRoot(window.document.getElementById('root'));
  const context = dom.getInternalVMContext();
  vm.runInContext(observerSource, context);
  const inspect = action => window.inspectTikTok({ ...request, ...(action ? { action } : {}) });
  try {
    await React.act(async () => root.render(h(App)));
    if (kind === 'photo') {
      const image = window.document.querySelector('img');
      for (const [name, value] of Object.entries({ complete: true, naturalWidth: 928, naturalHeight: 1400 })) Object.defineProperty(image, name, { value });
    } else {
      const video = window.document.querySelector('video');
      for (const [name, value] of Object.entries({ paused: false, ended: false, readyState: 4, duration: 20, currentTime: 8, playbackRate: 1 })) Object.defineProperty(video, name, { value });
    }
    assert.equal(inspect().post?.comment, true, 'production observer must find the actual editor');
    await exercise({
      request, window, inspect, submitted,
      getPlainText: () => current.getCurrentContent().getPlainText(),
      async draft() {
        window.callArgs = ['comment', request, Date.now() + 60000];
        let result;
        await React.act(async () => { result = vm.runInContext(`(${injectedAction})(...callArgs)`, context); });
        assert.equal(result, 'draft');
        assert.equal(current.getCurrentContent().getPlainText(), request.comment);
        await React.act(async () => rerender());
        assert.equal(window.document.querySelector('[contenteditable="true"]').textContent, request.comment);
      },
      async submit() {
        let result;
        await React.act(async () => { result = inspect('click-comment-submit'); });
        return result;
      },
      async addOwnDuplicate() {
        await React.act(async () => setCommentRows(previous => [...previous, { key: 'arrived-after-draft', author: '@me', text: request.comment }]));
      }
    });
    assert.deepEqual(errors, [], 'real React/Draft.js lifecycle must remain free of DOM ownership errors');
  } finally {
    window.collectiveCommentBefore?.release?.();
    await React.act(async () => root.unmount());
    window.close();
    for (const [name, descriptor] of previousGlobals) {
      if (descriptor) Object.defineProperty(global, name, descriptor);
      else delete global[name];
    }
  }
}

for (const kind of ['video', 'photo']) {
  test(`TikTok ${kind}: production observer and real Draft.js submit the exact draft once`, async () => {
    await withTikTokEditor({ kind }, async page => {
      await page.draft();
      assert.equal((await page.submit()).clicked, true);
      assert.deepEqual(page.submitted, [page.request.comment]);
      assert.equal(page.getPlainText(), '');
      assert.equal(page.window.document.querySelector('[contenteditable="true"]').textContent, '');
      assert.equal(page.inspect('verify-comment').confirmed, true);
      assert.equal((await page.submit()).clicked, false, 'verification must not allow a second submission');
      assert.deepEqual(page.submitted, [page.request.comment]);
    });
  });
}

test('TikTok real React comment remount preserves confirmation of one independently added own row', async () => {
  await withTikTokEditor({ afterSubmit: 'remount' }, async page => {
    await page.draft();
    assert.equal((await page.submit()).clicked, true);
    assert.equal(page.inspect('verify-comment').confirmed, true);
  });
});

test('TikTok real React unchanged-comment remount alone cannot confirm a submission', async () => {
  await withTikTokEditor({ afterSubmit: 'remount-without-new-row' }, async page => {
    await page.draft();
    assert.equal((await page.submit()).clicked, true);
    assert.equal(page.getPlainText(), '');
    const result = page.inspect('verify-comment');
    assert.equal(result.confirmed, false);
    assert.equal(result.reason, 'own-row-missing');
  });
});

test('TikTok real React removal of an unrelated comment does not hide a new own submission', async () => {
  await withTikTokEditor({ afterSubmit: 'remove-unrelated' }, async page => {
    await page.draft();
    assert.equal((await page.submit()).clicked, true);
    assert.equal(page.getPlainText(), '');
    assert.deepEqual(page.submitted, [page.request.comment]);
    assert.equal(page.inspect('verify-comment').confirmed, true);
  });
});

test('TikTok real React duplicate own row arriving after draft prevents the submission', async () => {
  await withTikTokEditor({}, async page => {
    await page.draft();
    await page.addOwnDuplicate();
    assert.equal((await page.submit()).clicked, false);
    assert.deepEqual(page.submitted, []);
    assert.equal(page.getPlainText(), page.request.comment, 'declining a duplicate must preserve the controlled draft');
  });
});
