const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

// The real tiktok.js read-only draft check against a real React 18 / Draft.js editor.
// The small fixture tests cannot reproduce how Draft.js renders its text.
const source = fs.readFileSync(path.join(__dirname, '../browser-extension/tiktok.js'), 'utf8');

test('the tiktok draft check reads a real Draft.js editor and never changes its state', async () => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://www.tiktok.com/@creator/video/7300000000000000001/', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom;
  for (const name of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'Node', 'Element', 'MutationObserver']) global[name] = name === 'window' ? window : window[name];
  global.getSelection = window.getSelection.bind(window);
  global.getComputedStyle = window.getComputedStyle.bind(window);
  global.requestAnimationFrame = window.requestAnimationFrame.bind(window);
  global.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const React = require('react');
  const { createRoot } = require('react-dom/client');
  const { Editor, EditorState, ContentState } = require('draft-js');
  const errors = [];
  window.addEventListener('error', event => errors.push(event.error));
  let current, setText;
  function App() {
    const [state, setState] = React.useState(EditorState.createEmpty());
    current = state;
    setText = text => setState(EditorState.createWithContent(ContentState.createFromText(text)));
    return React.createElement(Editor, { editorState: state, onChange: setState });
  }
  const root = createRoot(window.document.getElementById('root'));
  const comment = 'more on finding your own voice?';
  vm.runInContext(source, dom.getInternalVMContext());
  const check = value => JSON.parse(JSON.stringify(window.inspectTikTok({ action: 'draft-state', comment: value })));
  try {
    await React.act(async () => root.render(React.createElement(App)));
    let released = 0;
    window.collectiveCommentBefore = { platform: 'tiktok', drafted: false, submitted: false, interrupted: false, release: () => { released += 1; } };
    assert.deepEqual(check(comment), { known: true, holding: false });
    assert.equal(released, 1);
    await React.act(async () => setText(`draft: ${comment}`));
    assert.deepEqual(check(comment), { known: true, holding: true }, 'the rendered editor text holds the comment');
    assert.equal(current.getCurrentContent().getPlainText(), `draft: ${comment}`, 'the check never edits the editor state');
    await React.act(async () => setText('my own words'));
    window.collectiveCommentBefore = { platform: 'tiktok', drafted: true, submitted: false, interrupted: false,
      composer: window.document.querySelector('[contenteditable="true"]'), release: () => { released += 1; } };
    assert.deepEqual(check(comment), { known: true, holding: true }, 'the owned editor still holds other text');
    await React.act(async () => setText(''));
    assert.deepEqual(check(comment), { known: true, holding: false }, 'an empty owned editor holds nothing');
    assert.equal(released, 2);
    assert.deepEqual(check('   '), { known: false });
    assert.equal(current.getCurrentContent().getPlainText(), '');
    assert.deepEqual(errors, []);
  } finally {
    await React.act(async () => root.unmount());
    dom.window.close();
  }
});
