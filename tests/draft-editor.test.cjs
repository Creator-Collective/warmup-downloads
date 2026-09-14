const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

// Exercise the production injected action against the real controlled editor.
// The small platform fixture tests cannot reproduce React's DOM ownership.
const source = fs.readFileSync(path.join(__dirname, '../browser-extension/runner.js'), 'utf8');
const marker = 'const clicked = await execute(';
const start = source.indexOf(marker, source.indexOf('async function performEngagement')) + marker.length;
const end = source.indexOf(', [action, request, job.deadline]);', start);
const injected = source.slice(start, end);

test('TikTok draft entry updates real Draft.js state, survives rerenders and submits that exact text', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://www.tiktok.com/@creator/video/123/', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  for (const name of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'Node', 'Element', 'MutationObserver']) global[name] = name === 'window' ? window : window[name];
  global.getSelection = window.getSelection.bind(window);
  global.getComputedStyle = window.getComputedStyle.bind(window);
  global.requestAnimationFrame = window.requestAnimationFrame.bind(window);
  global.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
  global.IS_REACT_ACT_ENVIRONMENT = true;
  window.Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, bottom: 10, right: 10, width: 10, height: 10 });
  window.Range.prototype.getClientRects = () => [];
  Object.defineProperty(window.HTMLElement.prototype, 'isContentEditable', { get() { return this.getAttribute('contenteditable') === 'true'; } });
  const React = require('react');
  const { createRoot } = require('react-dom/client');
  const { Editor, EditorState } = require('draft-js');
  const errors = [];
  window.addEventListener('error', event => errors.push(event.error));
  window.DataTransfer = class {
    constructor() { this.types = []; this.files = []; this.items = []; this.data = {}; }
    setData(type, value) { this.types.push(type); this.data[type] = value; }
    getData(type) { return this.data[type] || ''; }
  };
  window.ClipboardEvent = class extends window.Event {
    constructor(type, options) { super(type, options); this.clipboardData = options.clipboardData; }
  };
  window.document.execCommand = () => { throw new Error('native DOM edits are not editor state updates'); };
  let current, forceRender, submit;
  let submitted;
  function App() {
    const [state, setState] = React.useState(EditorState.createEmpty());
    const [, setRevision] = React.useState(0);
    current = state;
    forceRender = () => setRevision(value => value + 1);
    submit = () => { submitted = state.getCurrentContent().getPlainText(); setState(EditorState.createEmpty()); };
    return React.createElement(Editor, { editorState: state, onChange: setState });
  }
  const root = createRoot(window.document.getElementById('root'));
  const request = { id: window.location.href, author: '@creator', comment: 'more on finding your own voice?' };
  window.inspectTikTok = ({ action }) => {
    const field = window.document.querySelector('[contenteditable="true"]');
    if (action === 'comment-field') window.collectiveCommentBefore = { composer: field };
    return { point: { x: 10, y: 10 }, ready: action === 'comment-ready' && !field.textContent.trim() };
  };
  window.callArgs = ['comment', request, Date.now() + 60000];
  try {
    await React.act(async () => root.render(React.createElement(App)));
    let result;
    await React.act(async () => { result = vm.runInContext(`(${injected})(...callArgs)`, dom.getInternalVMContext()); });
    assert.equal(result, 'draft');
    assert.equal(current.getCurrentContent().getPlainText(), request.comment);
    await React.act(async () => forceRender());
    assert.equal(window.document.querySelector('[contenteditable="true"]').textContent, request.comment);
    assert.deepEqual(errors, []);
    await React.act(async () => submit());
    assert.equal(submitted, request.comment);
    assert.equal(current.getCurrentContent().getPlainText(), '');
    assert.equal(window.document.querySelector('[contenteditable="true"]').textContent, '');
    assert.deepEqual(errors, []);
  } finally {
    await React.act(async () => root.unmount());
    dom.window.close();
  }
});
