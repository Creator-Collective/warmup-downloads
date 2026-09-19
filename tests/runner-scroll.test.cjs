const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../browser-extension/runner.js'), 'utf8');
const scrollSource = source.slice(source.indexOf('async function scroll()'), source.indexOf('async function recoverCommentDraft'));

function fixture({ platform = 'instagram', movement = 560, blocked, expired = false } = {}) {
  const calls = [];
  const rect = { width: 200, height: 100, top: 200, bottom: 300, left: 300, right: 500 };
  const element = (name, parent = null, scrollable = false) => ({
    name, parentElement: parent, scrollHeight: scrollable ? 2000 : 0, clientHeight: scrollable ? 800 : 0,
    scrollTop: 0, style: { overflowY: scrollable ? 'auto' : 'visible', visibility: 'visible', display: 'block', opacity: '1' },
    getAttribute: () => null,
    getBoundingClientRect: () => ({ ...rect }),
    scrollBy(options) { calls.push({ name, options }); this.scrollTop += movement; },
  });
  const html = element('html');
  const body = element('body', html);
  const grid = element('grid', body, true);
  const sidebar = element('sidebar', body, true);
  const link = element('result', grid);
  const origin = `https://www.${platform}.com`;
  link.href = `${origin}${platform === 'tiktok' ? '/@creator/video/123/' : '/p/example/'}`;
  const links = [link];
  const document = {
    documentElement: html, scrollingElement: html,
    querySelectorAll: () => links,
    elementFromPoint: () => sidebar,
  };
  let afterScroll = () => {};
  const context = vm.createContext({
    URL, Date, document, location: { hostname: `www.${platform}.com`, origin, href: `${origin}/` },
    innerWidth: 1000, innerHeight: 800, getComputedStyle: element => element.style,
    inspectInstagram: () => ({ blocked }), inspectTikTok: () => ({ blocked }),
    job: { deadline: Date.now() + (expired ? -1000 : 60000) },
    assertRunning() {}, transientPageError: () => false,
    setTimeout(callback) { afterScroll(); callback(); },
  });
  context.execute = async (operation, args) => operation(...args);
  vm.runInContext(scrollSource, context);
  return { calls, html, body, grid, sidebar, link, links, document, element, run: () => context.scroll(), afterScroll(fn) { afterScroll = fn; } };
}

test('result containers scroll instead of a sidebar under the viewport center', async () => {
  for (const platform of ['instagram', 'tiktok']) {
    const h = fixture({ platform });
    assert.equal(await h.run(), true);
    assert.equal(h.calls.length, 1);
    assert.equal(h.calls[0].name, 'grid');
    assert.equal(h.sidebar.scrollTop, 0);
  }
});

test('the actual document scrolling element is used when the ancestor walk reaches html', async () => {
  const h = fixture();
  h.links.length = 0;
  h.document.elementFromPoint = () => h.body;
  h.document.scrollingElement = h.body;
  assert.equal(await h.run(), true);
  assert.equal(h.calls[0].name, 'body');
  assert.equal(h.html.scrollTop, 0);
});

test('small final movements and replaced result tiles still count as scrolling', async () => {
  for (const movement of [60, 560]) {
    const h = fixture({ movement });
    h.afterScroll(() => { h.links.length = 0; h.link.parentElement = null; });
    assert.equal(await h.run(), true);
    assert.equal(h.grid.scrollTop, movement);
  }
});

test('unrelated layout changes cannot confirm an exhausted scroll', async () => {
  const h = fixture({ movement: 0 });
  h.afterScroll(() => { h.link.getBoundingClientRect = () => ({ width: 200, height: 100, top: -400, bottom: -300 }); });
  assert.equal(await h.run(), false);
});

test('offscreen, hidden and external result links do not choose the scrolling container', async () => {
  for (const alter of [
    h => { h.link.getBoundingClientRect = () => ({ width: 200, height: 100, top: 900, bottom: 1000, left: 300, right: 500 }); },
    h => { h.link.style.visibility = 'hidden'; },
    h => { h.link.href = 'https://example.com/p/example/'; },
  ]) {
    const h = fixture();
    alter(h);
    assert.equal(await h.run(), true);
    assert.equal(h.calls[0].name, 'sidebar');
  }
});

test('retained hidden result ancestors are skipped in favor of the active grid', async () => {
  for (const hide of [
    grid => { grid.getAttribute = name => name === 'aria-hidden' ? 'true' : null; },
    grid => { grid.style.visibility = 'hidden'; },
    grid => { grid.style.visibility = 'collapse'; },
    grid => { grid.style.display = 'none'; },
    grid => { grid.style.opacity = '0'; },
  ]) {
    const h = fixture();
    hide(h.grid);
    const activeGrid = h.element('active-grid', h.body, true);
    const activeLink = h.element('active-result', activeGrid);
    activeLink.href = h.link.href;
    h.links.push(activeLink);
    assert.equal(await h.run(), true);
    assert.equal(h.calls[0].name, 'active-grid');
    assert.equal(activeGrid.scrollTop, 560);
    assert.equal(h.grid.scrollTop, 0);
  }
});

test('deadline and account restrictions prevent every scroll', async () => {
  const expired = fixture({ expired: true });
  assert.equal(await expired.run(), false);
  assert.equal(expired.calls.length, 0);
  const blocked = fixture({ blocked: 'instagram needs your attention.' });
  await assert.rejects(blocked.run(), /instagram needs your attention/);
  assert.equal(blocked.calls.length, 0);
});
