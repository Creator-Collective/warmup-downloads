const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const root = path.resolve(__dirname,'..');
const extension = path.join(root,'browser-extension');
const { platforms, platformURL, instagramURL, dashboardSender, panelSender, runnerSender, publicState } = require('../browser-extension/guards.js');
const origin = 'https://creator-collective-warmup.vercel.app';
const sender = { id:'extension-id',url:origin+'/',frameId:0,tab:{id:2} };
const event = () => ({listeners:[],addListener(fn){this.listeners.push(fn)}});
const commentComposer = require('./fixtures/comment-composer.cjs');
const { commentComposer: tiktokCommentComposer } = require('./fixtures/tiktok-comment-composer.cjs');
function background(initial) {
  let job = initial;
  const created = [];
  const allTabs = [{id:7,title:'instagram',url:'https://www.instagram.com/'},{id:8,title:'tiktok',url:'https://www.tiktok.com/'}];
  const chrome = {sidePanel:{setPanelBehavior:async()=>{}},runtime:{id:'extension-id',getURL:p=>`chrome-extension://extension-id/${p.replace(/^\//,'')}`,getManifest:()=>({version:'0.4.2'}),onMessage:event()}, storage:{session:{get:async()=>({job:structuredClone(job)}),set:async value=>{job=structuredClone(value.job)}}},tabs:{query:async request=>request.url?allTabs:allTabs,get:async id=>allTabs.find(tab=>tab.id===id) || {id,url:'https://www.instagram.com/',windowId:1},create:async options=>{created.push(options);return {id:90}},update:async()=>({}),remove:async()=>{},onRemoved:event(),onUpdated:event()},action:{onClicked:event()},windows:{update:async()=>{}}};
  const ctx=vm.createContext({chrome,console,URL,crypto:webcrypto,structuredClone});
  ctx.importScripts=(...files)=>files.forEach(file=>vm.runInContext(fs.readFileSync(path.join(extension,file),'utf8'),ctx));
  vm.runInContext(fs.readFileSync(path.join(extension,'background.js'),'utf8'),ctx);
  const message=(request,source=sender)=>new Promise(resolve=>{const accepted=chrome.runtime.onMessage.listeners[0](request,source,resolve);if(!accepted)resolve(undefined)});
  return {message,created,chrome,job:()=>job};
}
function webBridge(worker, { pageOrigin = origin, subframe = false } = {}) {
  const forwarded = [];
  const responses = [];
  let listener;
  const window = { addEventListener(type, callback) { if (type === 'message') listener = callback; }, postMessage(data, targetOrigin) { responses.push({ data, targetOrigin }); } };
  window.top = subframe ? {} : window;
  const ctx = vm.createContext({ window, location: { origin: pageOrigin }, chrome: { runtime: { sendMessage(message) { forwarded.push(message); return worker.message(message); } } } });
  vm.runInContext(fs.readFileSync(path.join(extension, 'bridge.js'), 'utf8'), ctx);
  return { forwarded, responses, async request(data, eventOverrides = {}) { if (listener) await listener({ source: window, origin: pageOrigin, data: { channel: 'cc-warmup-request', id: 'request-id', ...data }, ...eventOverrides }); } };
}
test('only exact dashboard origin, top frame and intended platform hosts are accepted',()=>{
 assert.equal(dashboardSender(sender),true);
 for(const url of ['https://evil.example/','https://creator-collective-warmup.vercel.app.evil.example/','http://creator-collective-warmup.vercel.app/'])assert.equal(dashboardSender({...sender,url}),false);
 assert.equal(dashboardSender({...sender,frameId:1}),false);
 for(const url of ['http://www.instagram.com/','https://instagram.com.evil.example/','https://user:pass@instagram.com/','file:///tmp/test'])assert.equal(instagramURL(url),false);
 assert.equal(instagramURL('https://www.instagram.com/p/abc/'),true);
 assert.equal(platformURL('https://www.tiktok.com/@creator/video/123','tiktok'),true);
 assert.equal(platformURL('https://www.tiktok.com.evil.example/@creator/video/123','tiktok'),false);
 assert.equal(runnerSender({url:'chrome-extension://evil/runner.html#x',tab:{id:9}},{runnerTabId:9,token:'x'},'chrome-extension://extension-id/'),false);
});
test('manifest limits permissions and contains no remote code or cookie access',()=>{
 const manifest=JSON.parse(fs.readFileSync(path.join(extension,'manifest.json')));
 assert.deepEqual(manifest.permissions,['storage','scripting','sidePanel']);
 assert.deepEqual(manifest.content_scripts[0].matches,[origin+'/*']);
 assert.equal(manifest.content_scripts[0].all_frames,false);
 assert.deepEqual(manifest.host_permissions,[...platforms.instagram.patterns]);
 for(const file of ['plan.js','comment-writer.js','session.js','guards.js'])new vm.Script(fs.readFileSync(path.join(extension,file),'utf8'));
 const ctx=vm.createContext({setTimeout,clearTimeout,AbortController});
 for(const file of ['plan.js','comment-writer.js','session.js'])vm.runInContext(fs.readFileSync(path.join(extension,file),'utf8'),ctx);
 assert.equal(typeof ctx.sessionEngine.runSession,'function');
});
test('release keeps warm-up and excludes unfinished signup and phone controls',()=>{
 for(const file of ['index.html','browser-extension/sidepanel.html']) {
  const html=fs.readFileSync(path.join(root,file),'utf8');
  assert.match(html,/<h1>auto warm-up<\/h1>/);
  assert.match(html,/id="session-form"/);
  assert.doesNotMatch(html,/signup-section|signup-ui\.js|phone-ui\.js|create an account|phone setup/i);
 }
 const ctx=vm.createContext({});
 vm.runInContext(fs.readFileSync(path.join(extension,'features.js'),'utf8'),ctx);
 assert.equal(vm.runInContext('productFeatures.accountSignup',ctx),false);
 assert.doesNotMatch(fs.readFileSync(path.join(root,'setup.html'),'utf8'),/create an account|smspool|account creation is available/i);
});
test('start validates settings, creates a dedicated runner and blocks duplicate starts',async()=>{
 const h=background();
 assert.equal((await h.message({type:'start',tabId:7,settings:{minutes:0,niche:'branding'}})).ok,false);
 assert.equal(h.created.length,0);
 const response=await h.message({type:'start',tabId:7,settings:{minutes:10,niche:'personal branding',customLimits:{like:25}}});
 assert.equal(response.ok,true);assert.equal(h.job().settings.limits.like,25);assert.equal(h.job().settings.limits.comment,0);
 assert.equal(h.created.length,1);assert.equal(h.created[0].active,false);
 assert.equal((await h.message({type:'start',tabId:7,settings:{minutes:10,niche:'branding'}})).ok,false);
});
test('website and side-panel sessions create an inactive runner in the selected Instagram tab’s window', async () => {
 const panel = { id: 'extension-id', url: 'chrome-extension://extension-id/sidepanel.html' };
 for (const source of [sender, panel]) {
   for (const [platform, tabId, windowId] of [['instagram', 7, 31], ['instagram', 7, 42]]) {
     const h = background();
     const get = h.chrome.tabs.get;
     h.chrome.tabs.get = async id => ({ ...await get(id), windowId });
     h.chrome.tabs.update = h.chrome.windows.update = async () => { throw new Error('starting must not change focus'); };
     const result = await h.message({ type: 'start', tabId, settings: { platform, minutes: 1, niche: 'branding', customLimits: { like: 0, follow: 0, comment: 0 } } }, source);
     assert.equal(result.ok, true);
     assert.equal(h.job().tabId, tabId);
     assert.deepEqual(h.created.map(options => ({ ...options })), [{
       url: `chrome-extension://extension-id/runner.html#${h.job().token}`, active: false, windowId
     }]);
   }
 }
});
test('website and side panel reject TikTok listing, opening and starting without touching browser tabs',async()=>{
 const panel = { id: 'extension-id', url: 'chrome-extension://extension-id/sidepanel.html' };
 for (const source of [sender, panel]) {
  const h=background();
  const tabCalls=[];
  for (const method of ['query','get','create','update','remove']) h.chrome.tabs[method]=async()=>{tabCalls.push(method);throw new Error('TikTok must not access browser tabs');};
  for (const request of [
   {type:'tabs',platform:'tiktok'},
   {type:'open-platform',platform:'tiktok'},
   {type:'open-instagram',platform:'tiktok'},
   {type:'start',tabId:8,settings:{platform:'tiktok',minutes:10,niche:'personal branding',enableComments:true,customLimits:{like:4,follow:1,comment:2}}},
   {type:'start',tabId:7,settings:{platform:'tiktok',minutes:10,niche:'branding'}}
  ]) {
   const response=await h.message(request,source);
   assert.equal(response.ok,false);
   assert.match(response.error,/instagram only/);
  }
  assert.deepEqual(tabCalls,[]);
  assert.equal(h.job(),undefined);
 }
});
test('the public web bridge lists and opens Instagram through the real background handler', async () => {
  const h = background();
  const bridge = webBridge(h);
  for (const [platform, tabId] of [['instagram', 7]]) {
    await bridge.request({ type: 'tabs', platform });
    assert.equal(bridge.forwarded.at(-1).platform, platform);
    assert.equal(bridge.responses.at(-1).data.ok, true);
    assert.deepEqual(Array.from(bridge.responses.at(-1).data.data, tab => tab.id), [tabId]);
    assert.equal(bridge.responses.at(-1).targetOrigin, origin);
    await bridge.request({ type: 'open-platform', platform });
    assert.equal(bridge.responses.at(-1).data.ok, true);
    assert.equal(h.created.at(-1).url, platforms[platform].home);
  }
  await bridge.request({ type: 'open-instagram' });
  assert.equal(h.created.at(-1).url, platforms.instagram.home);
  assert.equal(h.job(), undefined);
});
test('the public bridge rejects TikTok and malformed platforms without querying or opening another destination', async () => {
  const h = background();
  const bridge = webBridge(h);
  for (const platform of ['tiktok', 'https://evil.example/', 'youtube', '__proto__', null, [], ['tiktok'], { platform: 'tiktok' }, 8]) {
    for (const type of ['tabs', 'open-platform']) {
      await bridge.request({ type, platform });
      assert.equal(bridge.responses.at(-1).data.ok, false);
      assert.match(bridge.responses.at(-1).data.error, /instagram only/);
    }
  }
  assert.equal(bridge.forwarded.length, 0);
  assert.equal(h.created.length, 0);
  assert.equal(h.job(), undefined);
});
test('the public bridge cannot start TikTok through either platform field', async () => {
  const h = background();
  const bridge = webBridge(h);
  for (const platform of [undefined, 'instagram', 'tiktok']) {
    await bridge.request({ type: 'start', platform, tabId: 8, settings: { platform: 'tiktok', minutes: 10, niche: 'branding' } });
    assert.equal(bridge.responses.at(-1).data.ok, false);
    assert.match(bridge.responses.at(-1).data.error, /instagram only/);
  }
  assert.equal(h.created.length, 0);
  assert.equal(h.job(), undefined);
});
test('setup reads only a capability and opens only the fixed extensions manager', async () => {
  const h = background();
  const bridge = webBridge(h);
  await bridge.request({ type: 'setup-info' });
  assert.deepEqual(Object.keys(bridge.responses.at(-1).data.data).sort(), ['canOpenExtensions', 'version']);
  assert.equal(bridge.responses.at(-1).data.data.canOpenExtensions, true);
  assert.equal(h.created.length, 0);
  assert.equal(h.job(), undefined);
  await bridge.request({ type: 'open-extensions', url: 'https://evil.example/' });
  assert.equal(bridge.responses.at(-1).data.ok, true);
  assert.equal(h.created.length, 1);
  assert.equal(h.created[0].url, 'chrome://extensions/');
  assert.equal(h.job(), undefined);
});
test('extension setup shortcuts keep the trusted origin and top-frame boundary', async () => {
  const h = background();
  for (const options of [{ pageOrigin: 'https://evil.example' }, { pageOrigin: origin + '.evil.example' }, { subframe: true }]) {
    const bridge = webBridge(h, options);
    for (const type of ['setup-info', 'open-extensions']) await bridge.request({ type });
    assert.equal(bridge.forwarded.length, 0);
  }
  for (const source of [{ ...sender, url: 'https://evil.example/' }, { ...sender, frameId: 1 }]) {
    await h.message({ type: 'open-extensions' }, source);
  }
  assert.equal(h.created.length, 0);
});
test('public bridge routing keeps its exact origin, frame, command and field boundaries', async () => {
  const h = background();
  for (const options of [{ pageOrigin: 'https://evil.example' }, { pageOrigin: origin + '.evil.example' }, { subframe: true }]) {
    const bridge = webBridge(h, options);
    await bridge.request({ type: 'open-platform', platform: 'tiktok' });
    assert.equal(bridge.forwarded.length, 0);
    assert.equal(bridge.responses.length, 0);
  }
  const bridge = webBridge(h);
  for (const eventOverrides of [{ source: {} }, { origin: 'https://evil.example' }]) await bridge.request({ type: 'open-platform', platform: 'tiktok' }, eventOverrides);
  for (const type of ['signup-start', 'runner-job', 'runner-update', 'signup-runner-stop', 'arbitrary-command']) await bridge.request({ type, platform: 'tiktok' });
  assert.equal(bridge.forwarded.length, 0);
  assert.equal(h.created.length, 0);
  await bridge.request({ type: 'tabs', platform: 'instagram', token: 'must-not-forward', url: 'https://evil.example', capability: 'must-not-forward', patch: { phase: 'running' } });
  assert.deepEqual(Object.keys(bridge.forwarded[0]).sort(), ['platform', 'settings', 'tabId', 'type']);
  assert.equal(bridge.responses.at(-1).data.ok, true);
  assert.equal(h.job(), undefined);
});
test('stop blocks replacement until runner acknowledges and preserves uncertain outcomes',async()=>{
 const h=background();
 await h.message({type:'start',tabId:7,settings:{minutes:10,niche:'branding'}});
 await h.message({type:'stop'});
 assert.equal(h.job().phase,'stopping');assert.equal(publicState(h.job()).running,true);
 assert.equal((await h.message({type:'start',tabId:7,settings:{minutes:10,niche:'branding'}})).ok,false);
 const job=h.job();const runner={id:'extension-id',url:`chrome-extension://extension-id/runner.html#${job.token}`,tab:{id:90}};
 await h.message({type:'runner-update',token:job.token,patch:{phase:'running',message:'should not overwrite stop'}},runner);
 assert.equal(h.job().phase,'stopping');
 await h.message({type:'runner-update',token:job.token,patch:{phase:'error',message:'an action may have gone through. check instagram before restarting.'}},runner);
 assert.equal(h.job().phase,'error');assert.match(h.job().message,/may have gone through/);
 assert.equal((await h.message({type:'start',tabId:7,settings:{minutes:10,niche:'branding'}})).ok,true);
});
test('Instagram outcomes survive Stop, completion and worker restart without replacing the stopping message', async () => {
 const h = background();
 await h.message({ type: 'start', tabId: 7, settings: { platform: 'instagram', minutes: 10, niche: 'study tips', enableComments: true } });
 const job = h.job();
 const runner = { id: 'extension-id', url: `chrome-extension://extension-id/runner.html#${job.token}`, tab: { id: 90 } };
 const comment = { text: 'small daily reps, got it', url: 'https://www.instagram.com/p/example/', author: 'creator', time: Date.now(), status: 'uncertain' };
 await h.message({ type: 'stop' });
 const stoppedMessage = h.job().message;
 await h.message({ type: 'runner-update', token: job.token, patch: { phase: 'running', stats: { like: 2, follow: 1, comment: 0 }, unconfirmed: { like: 0, follow: 1, comment: 1 }, pausedActions: ['comment'], comments: [comment], nextActionAt: Date.now() + 10000, message: 'must not overwrite stop' } }, runner);
 assert.equal(h.job().phase, 'stopping');
 assert.equal(h.job().message, stoppedMessage);
 assert.equal(h.job().nextActionAt, null);
 assert.deepEqual(h.job().stats, { like: 2, follow: 1, comment: 0 });
 assert.deepEqual(h.job().unconfirmed, { like: 0, follow: 1, comment: 1 });
 assert.deepEqual(h.job().pausedActions, ['comment']);
 assert.equal(h.job().comments[0].status, 'uncertain');
 await h.message({ type: 'runner-update', token: job.token, patch: { phase: 'stopped', message: stoppedMessage } }, runner);
 const restarted = background(h.job());
 const state = (await restarted.message({ type: 'state' })).data;
 assert.equal(state.running, false);
 assert.equal(state.stats.follow, 1);
 assert.equal(state.settings.limits.follow, 5);
 assert.deepEqual({ ...state.unconfirmed }, { like: 0, follow: 1, comment: 1 });
 assert.deepEqual(Array.from(state.pausedActions), ['comment']);
 assert.equal(state.comments.length, 1);
 await restarted.message({ type: 'runner-update', token: job.token, patch: { phase: 'running', stats: { follow: 99 }, unconfirmed: {}, pausedActions: [] } }, runner);
 assert.equal(restarted.job().stats.follow, 1, 'late updates cannot replace terminal results');
 assert.deepEqual(restarted.job().pausedActions, ['comment']);
});
test('session outcome normalization bounds counts, rejects invalid values and exposes safe defaults for older jobs', async () => {
 assert.deepEqual(publicState().unconfirmed, { like: 0, follow: 0, comment: 0 });
 assert.deepEqual(publicState({ stats: {}, settings: { platform: 'tiktok' } }).pausedActions, []);
 const h = background();
 await h.message({ type: 'start', tabId: 7, settings: { platform: 'instagram', minutes: 10, niche: 'study tips', enableComments: true, customLimits: { like: 4, follow: 2, comment: 1 } } });
 const job = h.job();
 const runner = { id: 'extension-id', url: `chrome-extension://extension-id/runner.html#${job.token}`, tab: { id: 90 } };
 for (const [unconfirmed, expected] of [
   [{ like: 500, follow: 500, comment: 500, injected: 1 }, { like: 4, follow: 2, comment: 1 }],
   [{ like: -1, follow: 1.5, comment: '1' }, { like: 0, follow: 0, comment: 0 }],
   [{ like: Infinity, follow: NaN, comment: Number.MAX_SAFE_INTEGER + 1 }, { like: 0, follow: 0, comment: 0 }]
 ]) {
   await h.message({ type: 'runner-update', token: job.token, patch: { phase: 'running', unconfirmed, pausedActions: ['like', 'comment', 'comment', 'follow', { comment: true }] } }, runner);
   assert.deepEqual(h.job().unconfirmed, expected);
   assert.deepEqual(h.job().pausedActions, ['comment']);
   const state = (await h.message({ type: 'state' })).data;
   assert.deepEqual({ ...state.unconfirmed }, expected);
 }
 await h.message({ type: 'runner-update', token: job.token, patch: { pausedActions: 'comment' } }, runner);
 assert.deepEqual(h.job().pausedActions, []);
 assert.deepEqual(publicState({ unconfirmed: { like: 1000, follow: 1000, comment: 1000 } }).unconfirmed, { like: 180, follow: 60, comment: 20 });
});
test('checkpoint normalization keeps a valid draft hold and rejects malformed ones', () => {
 const { normalizeCheckpoint } = require('../browser-extension/guards.js');
 const settings = { minutes: 10, terms: ['study tips'], limits: { like: 15, follow: 5, comment: 2 } };
 const base = {
   version: 1, stats: { scroll: 3, read: 0, search: 1, open: 1, like: 1, follow: 0, comment: 0, skipped: 1 },
   unconfirmed: { like: 0, follow: 0, comment: 0 }, pausedActions: ['comment'], comments: [], seen: ['instagram:a'],
   done: { like: ['instagram:a'], follow: [], comment: ['instagram:a'] }, usedComments: ['okay this is great'],
   termIndex: 1, currentSearchTerm: 'study tips', elapsedMs: 120000, remainingMs: 480000,
   cooldowns: { like: 0, follow: 0, comment: 0, engagement: 0, break: 90000 }, inFlight: null
 };
 const hold = { comment: 'okay this is great', postId: 'instagram:a', sinceMs: 100000, lastCheckMs: 110000, checks: 1, lifts: 0, reason: 'draft-retained' };
 assert.deepEqual(normalizeCheckpoint({ ...base, draftHold: hold }, settings).draftHold, hold);
 for (const reason of ['permanent', 'lifted']) assert.equal(normalizeCheckpoint({ ...base, draftHold: { ...hold, reason } }, settings).draftHold.reason, reason);
 for (const value of [base, { ...base, draftHold: null }]) assert.equal(Object.hasOwn(normalizeCheckpoint(value, settings), 'draftHold'), false);
 for (const change of [
   { reason: 'other' }, { lifts: 2 }, { checks: 11 }, { checks: -1 }, { comment: 'x'.repeat(501) }, { sinceMs: 600001 }, { lastCheckMs: -1 },
   { reason: 'draft-retained', comment: '' }, { reason: 'draft-retained', comment: '   ' }, { reason: 'draft-retained', postId: '' }, { postId: 'x'.repeat(2049) }
 ]) assert.equal(normalizeCheckpoint({ ...base, draftHold: { ...hold, ...change } }, settings), null, JSON.stringify(change).slice(0, 60));
 assert.equal(normalizeCheckpoint({ ...base, draftHold: 'held' }, settings), null);
});

test('untrusted senders and wrong runner tokens cannot change session state',async()=>{
 const h=background();
 assert.equal(await h.message({type:'start'},{url:'https://evil.example',frameId:0,tab:{id:1}}),undefined);
 await h.message({type:'start',tabId:7,settings:{minutes:10,niche:'branding'}});
 const job=h.job();
 const wrong={id:'extension-id',url:`chrome-extension://extension-id/runner.html#${job.token}`,tab:{id:91}};
 assert.equal((await h.message({type:'runner-stop',token:job.token},wrong)).ok,false);
 assert.equal(h.job().phase,'starting');
});
test('closing either session tab stops the job and a worker restart retains its state',async()=>{
 const h=background();await h.message({type:'start',tabId:7,settings:{minutes:10,niche:'branding'}});
 const restarted=background(h.job());
 assert.equal((await restarted.message({type:'state'})).data.running,true);
 restarted.chrome.tabs.onRemoved.listeners[0](7);
 await restarted.message({type:'state'}); // flush the worker queue
 assert.equal(restarted.job().phase,'stopped');
 assert.equal(publicState(restarted.job()).running,false);
});
test('packaged files parse and website script paths resolve',()=>{
 for(const file of fs.readdirSync(extension).filter(f=>f.endsWith('.js')))new vm.Script(fs.readFileSync(path.join(extension,file),'utf8'),{filename:file});
 for(const file of ['index.html','setup.html','privacy.html']){
  const html=fs.readFileSync(path.join(root,file),'utf8');
  for(const [,src] of html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g))assert.ok(fs.existsSync(path.join(root,src)),src);
 }
 new vm.Script(fs.readFileSync(path.join(root,'dashboard.js'),'utf8'));
});
function runnerContext(phase = 'starting', operation) {
 const elements=new Map(); const calls=[];
 const job={token:'test-token',tabId:7,runnerTabId:90,deadline:Date.now()+600000,phase,settings:{minutes:10},stats:{},activity:[],message:'starting'};
 const chrome={runtime:{sendMessage:async message=>{calls.push(message);return {ok:true,data:message.type==='runner-job'?job:null}}},tabs:{get:async()=>({url:'https://www.instagram.com/'}),update:async()=>({}),onUpdated:event()},storage:{onChanged:event()},scripting:{executeScript:async request=>{calls.push({injection:request});return [{result:{posts:[],post:null}}]}}};
 const node=()=>({textContent:'',disabled:false,dataset:{},scrollTop:0,addEventListener(){},replaceChildren(){},append(){},click(){},classList:{toggle(){}}});
 const ctx=vm.createContext({chrome,URL,console,setTimeout,clearTimeout,setInterval,clearInterval,AbortController,Date,location:{hash:'#test-token'},platforms,validPlatform:require('../browser-extension/guards.js').validPlatform,platformURL,instagramURL,document:{getElementById:id=>{if(!elements.has(id))elements.set(id,node());return elements.get(id)},createElement:node,body:{classList:{toggle(){}}},addEventListener(){}},sessionEngine:{runSession:operation || (async()=>{})}});
 ctx.commentHistory = require('../comment-history.js');
 ctx.sessionResults = require('../session-results.js');
 return {ctx,calls,chrome,job,elements,start(){vm.runInContext(fs.readFileSync(path.join(extension,'runner.js'),'utf8'),ctx)}};
}
const settle=async()=>{for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve))};

async function finishRunner(h) {
 h.start();
 for (let i = 0; i < 400 && !h.calls.some(call => call.patch && ['complete','stopped','error'].includes(call.patch.phase)); i++) await new Promise(resolve => setTimeout(resolve, 2));
 assert.ok(h.calls.some(call => call.patch && ['complete','stopped','error'].includes(call.patch.phase)), 'runner must settle');
}

test('temporary page replacement is retried for reads, while persistent unreadability returns unavailable', async () => {
 for (const failures of [2, 5]) {
   let attempts = 0; let page;
   const h = runnerContext('starting', async (settings, adapter) => { page = await adapter.inspect(); });
   h.ctx.setTimeout = (fn, ms) => setTimeout(fn, ms >= 3000 ? 100 : 0);
   h.chrome.scripting.executeScript = async request => {
     if (request.files && ++attempts <= failures) throw new Error('Frame with ID 0 was removed.');
     return [{ result: { post: null, posts: [] } }];
   };
   await finishRunner(h);
   assert.equal(attempts, 3);
   assert.equal(Boolean(page.unavailable), failures > 2);
   assert.ok(h.calls.some(call => call.patch?.phase === 'complete'));
 }
});

test('empty searches and posts that never load return recoverable results without ending the session', async () => {
 for (const operation of ['search', 'open']) {
   let now = Date.now(); let result;
   const target = 'https://www.instagram.com/p/example/';
   const search = 'https://www.instagram.com/explore/search/keyword/?q=branding';
   const h = runnerContext('starting', async (settings, adapter) => { result = await adapter[operation](operation === 'search' ? 'branding' : target); });
   h.ctx.Date = { now: () => now };
   h.ctx.setTimeout = (fn, ms) => setTimeout(() => { if (ms < 3000) now += ms; fn(); }, ms >= 3000 ? 100 : 0);
   h.chrome.tabs.get = async () => ({ url: operation === 'search' ? search : target, status: 'complete' });
   h.chrome.scripting.executeScript = async request => {
     if (request.args?.[0] === target) return [{ result: true }];
     return [{ result: { posts: operation === 'open' ? [target] : [], sequence: [target], post: null } }];
   };
   await finishRunner(h);
   assert.equal(result, false);
   assert.ok(h.calls.some(call => call.patch?.phase === 'complete'));
 }
});

test('a missing search result is skipped without clicking an unrelated post', async () => {
 let result;
 const h = runnerContext('starting', async (settings, adapter) => { result = await adapter.open('https://www.instagram.com/p/missing/'); });
 await finishRunner(h);
 assert.equal(result, false);
 assert.equal(h.calls.filter(call => call.injection?.args?.[0] === 'https://www.instagram.com/p/missing/').length, 0);
});

test('canonical post addresses do not cancel the session, but a different post still does', async () => {
 const h = runnerContext('starting', async (settings, adapter, signal) => {
   vm.runInContext("expectedDestination = 'https://www.instagram.com/reel/example/'", h.ctx);
   h.chrome.tabs.onUpdated.listeners[0](7, { url: 'https://www.instagram.com/p/example/' });
   assert.equal(signal.aborted, false);
   h.chrome.tabs.onUpdated.listeners[0](7, { url: 'https://www.instagram.com/p/other/' });
   assert.equal(signal.aborted, true);
 });
 await finishRunner(h);
 assert.ok(h.calls.some(call => call.patch?.phase === 'stopped'));
 assert.equal(vm.runInContext("sameDestination('https://www.tiktok.com/@creator/video/123', 'https://www.tiktok.com/@creator/video/123/')", h.ctx), true);
 assert.equal(vm.runInContext("sameDestination('https://www.instagram.com/p/example/?different=1', 'https://www.instagram.com/reel/example/')", h.ctx), false);
});

test('normal TikTok search and video URL rewrites do not stop the session', async () => {
 const h = runnerContext('starting', async (settings, adapter, signal) => {
   h.job.settings.platform = 'tiktok';
   vm.runInContext("expectedDestination = 'https://www.tiktok.com/search?q=personal%20branding'", h.ctx);
   h.chrome.tabs.onUpdated.listeners[0](7, { url: 'https://www.tiktok.com/search/video?q=personal%20branding&lang=en' });
   assert.equal(signal.aborted, false);
   vm.runInContext("expectedDestination = 'https://www.tiktok.com/@creator/video/123/'", h.ctx);
   h.chrome.tabs.onUpdated.listeners[0](7, { url: 'https://www.tiktok.com/@creator/video/123?lang=en&is_from_webapp=1' });
   assert.equal(signal.aborted, false);
   h.chrome.tabs.onUpdated.listeners[0](7, { url: 'https://www.tiktok.com/@creator/video/456' });
   assert.equal(signal.aborted, true);
 });
 await finishRunner(h);
 assert.ok(h.calls.some(call => call.patch?.phase === 'stopped'));
});

test('a TikTok URL update before the first controlled navigation does not stop startup', async () => {
 const h = runnerContext('starting', async (settings, adapter, signal) => {
   h.job.settings.platform = 'tiktok';
   h.chrome.tabs.onUpdated.listeners[0](7, { url: 'https://www.tiktok.com/foryou' });
   assert.equal(signal.aborted, false);
 });
 await finishRunner(h);
 assert.ok(h.calls.some(call => call.patch?.phase === 'complete'));
});

test('lost activity acknowledgements retry only status and hold the next page action until recovered', async () => {
 let acknowledgements = 0;
 const h = runnerContext('starting', async (settings, adapter) => {
   adapter.update({ message: 'running' });
   await adapter.inspect();
 });
 h.ctx.setTimeout = (fn, ms) => setTimeout(fn, ms >= 3000 ? 100 : 0);
 h.chrome.runtime.sendMessage = async message => {
   h.calls.push(message);
   if (message.patch?.phase === 'running' && ++acknowledgements < 3) throw new Error('temporary connection error');
   return { ok: true, data: message.type === 'runner-job' ? h.job : null };
 };
 h.chrome.scripting.executeScript = async request => {
   if (request.func) assert.equal(acknowledgements, 3);
   return [{ result: { post: null, posts: [] } }];
 };
 await finishRunner(h);
 assert.equal(acknowledgements, 3);
 assert.ok(h.calls.some(call => call.patch?.phase === 'complete'));
});
test('runner does not pass AbortSignal into Chrome script arguments',async()=>{
 const h=runnerContext('starting',async(settings,adapter,signal)=>{await adapter.inspect(signal)});
 h.start();await settle();
 const injections=h.calls.filter(x=>x.injection).map(x=>x.injection);
 assert.equal(injections.length,2);
 assert.deepEqual(JSON.parse(JSON.stringify(injections[1].args)),['inspectInstagram',{}]);
 assert.ok(h.calls.some(x=>x.patch?.phase==='complete'));
});
test('runner waits for delayed follow confirmation before treating it as uncertain',async()=>{
 let verifications=0;
 const h=runnerContext('starting',async(settings,adapter)=>{
   const result=await adapter.engage('follow',{id:'https://www.instagram.com/p/example/',author:'/creator/'});
   assert.equal(result,'confirmed');
 });
 h.ctx.setTimeout=(fn)=>setTimeout(fn,0);
 h.chrome.scripting.executeScript=async request=>{
   h.calls.push({injection:request});
   if(request.files)return [{result:null}];
   if(request.args?.[0]==='inspectInstagram'){
     const requested=request.args[1]||{};
     if(requested.action==='verify-follow')return [{result:{confirmed:++verifications>=5}}];
     return [{result:{}}];
   }
   if(request.args?.[0]==='follow')return [{result:true}];
   return [{result:{}}];
 };
 h.start();
 for(let i=0;i<40&&!h.calls.some(x=>x.patch);i++)await new Promise(resolve=>setTimeout(resolve,1));
 assert.equal(verifications,5);
 assert.ok(h.calls.some(x=>x.patch?.phase==='complete'));
});

test('Instagram likes keep their existing viewer confirmation without opening a temporary tab', async () => {
 let result; let clicks = 0; let created = 0;
 const h = runnerContext('starting', async (_settings, adapter) => {
   result = await adapter.engage('like', { id: 'https://www.instagram.com/p/example/', author: '/creator/' });
 });
 h.ctx.setTimeout = fn => setTimeout(fn, 0);
 h.chrome.tabs.create = async () => { created++; throw new Error('unexpected temporary tab'); };
 h.chrome.scripting.executeScript = async request => {
   if (request.files) return [{ result: null }];
   if (request.args?.[0] === 'like') { clicks++; return [{ result: true }]; }
   if (request.args?.[1]?.action === 'verify-like') return [{ result: { confirmed: true } }];
   return [{ result: {} }];
 };
 await finishRunner(h);
 assert.equal(result, 'confirmed');
 assert.equal(clicks, 1);
 assert.equal(created, 0);
});

function tiktokRunner(operation, configure = () => {}) {
 const id = 'https://www.tiktok.com/@creator/video/123/';
 const search = 'https://www.tiktok.com/search?q=branding';
 const requests = []; const clicks = []; const navigations = [];
 const state = { url: id, liked: false, followed: false, blocked: null, loseActionResponse: false };
 const h = runnerContext('starting', operation);
 h.job.settings.platform = 'tiktok';
 h.ctx.setTimeout = (fn, ms) => setTimeout(fn, ms >= 3000 ? 100 : 0);
 const post = { id, author: '@creator', viewer: true, close: true, like: true, follow: true, comment: false };
 const page = vm.createContext({ URL, Date, location: new URL(state.url) });
 const changeURL = url => {
   state.url = url; page.location = new URL(url);
   h.chrome.tabs.onUpdated.listeners[0](7, { url });
 };
 const inspect = request => {
   requests.push(request || {});
   if (state.blocked && (!state.blockOnClick || request?.action?.startsWith('click-'))) return { blocked: state.blocked };
   if (request?.action === 'click-like' || request?.action === 'click-follow') {
     clicks.push(request.action); state[request.action === 'click-like' ? 'liked' : 'followed'] = true;
     return { clicked: true };
   }
   if (request?.action === 'verify-like') return { confirmed: state.liked };
   if (request?.action === 'verify-follow') return { confirmed: state.followed };
   if (request?.action === 'click-close') { clicks.push(request.action); changeURL(search + '&lang=en'); return { clicked: true }; }
   return { post: state.url.includes('/video/123') ? post : null, posts: [id], sequence: [id] };
 };
 page.inspectTikTok = inspect;
 const resultLink = { href: id, getAttribute: () => null, getBoundingClientRect: () => ({ width: 100, height: 50, left: 0, right: 100, top: 0, bottom: 50 }), scrollIntoView() {}, click() { clicks.push('open'); changeURL(id); } };
 page.getComputedStyle = () => ({ display: 'block', visibility: 'visible', opacity: '1' });
 page.innerWidth = 1000; page.innerHeight = 800;
 page.document = {
   // Search opening checks the link; engagement still resolves inside inspector.
   elementFromPoint: () => resultLink,
   querySelectorAll: () => [resultLink]
 };
 h.chrome.tabs.get = async () => ({ id: 7, url: state.url, status: 'complete' });
 h.chrome.tabs.update = async (tabId, options) => { navigations.push(options.url); changeURL(options.url); return { id: tabId, url: state.url }; };
 h.chrome.scripting.executeScript = async request => {
   h.calls.push({ injection: request });
   if (request.files) return [{ result: null }];
   page.injectionArgs = request.args || [];
   const result = await vm.runInContext(`(${request.func.toString()})(...injectionArgs)`, page);
   if (state.loseActionResponse && ['like', 'follow'].includes(request.args?.[0])) throw new Error('Frame with ID 0 was removed.');
   return [{ result }];
 };
 const fixture = { h, id, search, post, page, state, requests, clicks, navigations, changeURL };
 configure(fixture);
 return fixture;
}

for (const action of ['like', 'follow']) {
 test(`TikTok runner ${action} uses the exact inspector click without a button ancestor`, async () => {
   let result;
   const f = tiktokRunner(async (settings, adapter) => { result = await adapter.engage(action, f.post); });
   await finishRunner(f.h);
   assert.equal(result, 'uncertain', 'same-viewer state alone cannot confirm TikTok engagement');
   assert.deepEqual(f.clicks, [`click-${action}`]);
   const request = f.requests.find(request => request.action === `click-${action}`);
   assert.equal(request.id, f.id); assert.equal(request.author, '@creator');
   assert.ok(f.requests.some(request => request.action === `verify-${action}`));
   assert.ok(f.h.calls.some(call => call.patch?.phase === 'complete'));
 });
 test(`a lost TikTok ${action} response stays uncertain and never replays the click`, async () => {
   let result; let continued = false;
   const f = tiktokRunner(async (settings, adapter) => {
     result = await adapter.engage(action, f.post);
     await adapter.inspect(); continued = true;
   }, ({ state }) => { state.loseActionResponse = true; });
   await finishRunner(f.h);
   assert.equal(result, 'uncertain'); assert.equal(continued, true);
   assert.deepEqual(f.clicks, [`click-${action}`]);
   assert.equal(f.requests.filter(request => request.action === `click-${action}`).length, 1);
   assert.ok(f.h.calls.some(call => call.patch?.phase === 'complete'));
 });
}

test('an access denial appearing at the TikTok click remains visible in the terminal error', async () => {
 let continued = false;
 const message = 'tiktok denied access. the session has stopped; check tiktok before starting again.';
 const f = tiktokRunner(async (settings, adapter) => { await adapter.engage('like', f.post); continued = true; }, ({ state }) => {
   state.blocked = message; state.blockOnClick = true;
 });
 await finishRunner(f.h);
 assert.equal(continued, false); assert.deepEqual(f.clicks, []);
 const terminal = f.h.calls.find(call => call.patch?.phase === 'error').patch;
 assert.match(terminal.message, /tiktok denied access/);
 assert.notEqual(terminal.message, 'an action may have gone through. check tiktok before restarting.');
});

test('TikTok navigation does not reload a page that has denied access', async () => {
 const f = tiktokRunner(async (settings, adapter) => { await adapter.search('branding'); }, ({ state }) => {
   state.blocked = 'tiktok denied access. the session has stopped; check tiktok before starting again.';
 });
 await finishRunner(f.h);
 assert.deepEqual(f.navigations, []); assert.deepEqual(f.clicks, []);
 assert.ok(f.h.calls.some(call => call.patch?.phase === 'error' && /denied access/.test(call.patch.message)));
});

test('TikTok closes its search viewer without reloading results or cancelling the allowed URL change', async () => {
 const results = [];
 const f = tiktokRunner(async (settings, adapter, signal) => {
   results.push(await adapter.search('branding'));
   results.push(await adapter.open(f.id));
   results.push(await adapter.leavePost(f.post));
   results.push(signal.aborted);
 });
 await finishRunner(f.h);
 assert.deepEqual(results, [true, true, true, false]);
 assert.deepEqual(f.navigations, [f.search]);
 assert.deepEqual(f.clicks, ['open', 'click-close']);
 assert.equal(f.requests.filter(request => request.action === 'click-close').length, 1);
 assert.ok(f.h.calls.some(call => call.patch?.phase === 'complete'));
});

async function runHiddenFollow(configure = () => {}) {
 const viewer = commentComposer();
 const fresh = commentComposer();
 viewer.state.follow = 'Follow';
 fresh.state.follow = 'Following';
 let result;
 let continued = false;
 let now = Date.now();
 const created = [];
 const removed = [];
 const confirmationTab = { id: 81, url: viewer.request.id, status: 'complete' };
 const h = runnerContext('starting', async (settings, adapter) => {
   result = await adapter.engage('follow', viewer.request);
   await adapter.inspect();
   continued = true;
 });
 h.ctx.Date = { now: () => now };
 h.ctx.setTimeout = (fn, ms) => setTimeout(() => { if (ms < 3000) now += ms; fn(); }, ms >= 3000 ? 100 : 0);
 h.chrome.tabs.get = async id => id === 81 ? confirmationTab : { id: 7, url: viewer.request.id };
 h.chrome.tabs.create = async options => { created.push(options); return confirmationTab; };
 h.chrome.tabs.remove = async id => { removed.push(id); };
 h.chrome.scripting.executeScript = async request => {
   h.calls.push({ injection: request });
   const page = request.target.tabId === 81 ? fresh : viewer;
   if (request.files) { page.load(); return [{ result: null }]; }
   return [{ result: await page.inject(request.func, request.args) }];
 };
 configure({ viewer, fresh, h, confirmationTab });
 h.start();
 for (let i = 0; i < 300 && !h.calls.some(call => call.patch); i++) await new Promise(resolve => setTimeout(resolve, 2));
 assert.ok(h.calls.some(call => call.patch), 'follow confirmation must settle');
 return { viewer, fresh, h, created, removed, result, continued };
}

test('a hidden viewer follow is confirmed from the same fresh post without another follow click', async () => {
 for (const state of ['Following', 'Requested']) {
   const { viewer, fresh, h, created, removed, result, continued } = await runHiddenFollow(({ fresh }) => { fresh.state.follow = state; });
   assert.equal(result, 'confirmed');
   assert.equal(viewer.followClicks, 1);
   assert.equal(fresh.followClicks, 0);
   assert.deepEqual(JSON.parse(JSON.stringify(created)), [{ url: viewer.request.id, active: false }]);
   assert.deepEqual(removed, [81]);
   assert.equal(continued, true);
   assert.ok(h.calls.some(call => call.patch?.phase === 'complete'));
 }
});

test('missing follow confirmation or a different author remains uncertain and never retries the follow', async () => {
 for (const change of [fresh => { fresh.state.follow = null; }, fresh => { fresh.author.href = 'https://www.instagram.com/someone-else/'; }]) {
   const { viewer, fresh, removed, result, continued } = await runHiddenFollow(({ fresh }) => { change(fresh); });
   assert.equal(result, 'uncertain');
   assert.equal(viewer.followClicks, 1);
   assert.equal(fresh.followClicks, 0);
   assert.deepEqual(removed, [81]);
   assert.equal(continued, true);
 }
});

test('failed read-only confirmation does not stop the session', async () => {
 const { viewer, result, continued, removed } = await runHiddenFollow(({ h }) => {
   const execute = h.chrome.scripting.executeScript;
   h.chrome.scripting.executeScript = async request => {
     if (request.target.tabId === 81) throw new Error('temporary read error');
     return execute(request);
   };
 });
 assert.equal(result, 'uncertain');
 assert.equal(viewer.followClicks, 1);
 assert.equal(continued, true);
 assert.deepEqual(removed, [81]);
});

test('a follow result lost during page replacement is not retried and does not end the session', async () => {
 const { viewer, result, continued, created } = await runHiddenFollow(({ h }) => {
   const execute = h.chrome.scripting.executeScript;
   h.chrome.scripting.executeScript = async request => {
     const result = await execute(request);
     if (request.args?.[0] === 'follow') throw new Error('Frame with ID 0 was removed.');
     return result;
   };
 });
 assert.equal(viewer.followClicks, 1);
 assert.equal(result, 'uncertain');
 assert.equal(continued, true);
 assert.deepEqual(created, []);
});

test('Stop or the deadline during fallback closes only its temporary tab and prevents further inspection', async () => {
 for (const expired of [false, true]) {
   const { viewer, h, removed, continued } = await runHiddenFollow(({ h, confirmationTab }) => {
     h.chrome.tabs.create = async () => {
       if (expired) h.job.deadline = Date.now() - 1;
       else vm.runInContext("controller.abort(new Error('session stopped.'))", h.ctx);
       return confirmationTab;
     };
   });
   assert.equal(viewer.followClicks, 1);
   assert.deepEqual(removed, [81]);
   assert.equal(continued, false);
   assert.equal(h.calls.filter(call => call.injection?.target.tabId === 81).length, 0);
   assert.ok(h.calls.some(call => call.patch?.phase === 'error' && /action may have gone through/.test(call.patch.message)));
 }
});

test('a confirmation tab navigated elsewhere is neither trusted nor closed', async () => {
 const { result, removed, continued } = await runHiddenFollow(({ confirmationTab }) => {
   confirmationTab.url = 'https://example.com/';
 });
 assert.equal(result, 'uncertain');
 assert.deepEqual(removed, []);
 assert.equal(continued, true);
});

test('account restrictions found during follow confirmation still stop the session', async () => {
 const { h, removed, continued } = await runHiddenFollow(({ fresh }) => { fresh.state.blocked = true; });
 assert.equal(continued, false);
 assert.deepEqual(removed, [81]);
 assert.ok(h.calls.some(call => call.patch?.phase === 'error'));
});

async function runComment(configure = () => {}, composer = commentComposer(), platform = 'instagram') {
 let result;
 let continued = false;
 const h = runnerContext('starting', async (settings, adapter) => {
   result = await adapter.engage('comment', { ...composer.request, viewer: true }, composer.request.comment);
   await adapter.inspect();
   continued = true;
 });
 h.job.settings.platform = platform;
 if (platform === 'tiktok') h.chrome.tabs.get = async () => ({ id: 7, url: composer.request.id });
 h.ctx.setTimeout = (fn, ms) => setTimeout(fn, ms >= 3000 ? 100 : 0);
 h.chrome.scripting.executeScript = async request => {
   h.calls.push({ injection: request });
   if (request.files) { composer.load(); return [{ result: null }]; }
   return [{ result: await composer.inject(request.func, request.args) }];
 };
 configure(composer, h);
 h.start();
 for (let i = 0; i < 300 && !h.calls.some(call => call.patch); i++) await new Promise(resolve => setTimeout(resolve, 2));
 assert.ok(h.calls.some(call => call.patch), 'comment flow must settle');
 return { composer, h, result, continued };
}

const runTikTokComment = (configure, options) => runComment(configure, tiktokCommentComposer(options), 'tiktok');

test('TikTok opens comments, types through its editor, submits once and confirms on both layouts', async () => {
 for (const modal of [false, true]) {
   const { composer, result, continued } = await runTikTokComment(undefined, { modal, open: false });
   assert.equal(result, 'confirmed');
   assert.equal(composer.state.opens, 1);
   assert.equal(composer.submitted, 1);
   assert.deepEqual(composer.inputs, [composer.request.comment]);
   assert.equal(continued, true);
 }
});

test('TikTok waits for an enabled Post and tolerates focus loss and editor replacement', async () => {
 const { composer, result } = await runTikTokComment(composer => {
   composer.state.onInput = field => {
     composer.replaceField(field.textContent);
     composer.document.activeElement = composer.heading;
     composer.submit.disabled = true;
   };
   const inject = composer.inject;
   let attempts = 0;
   composer.inject = (func, args) => {
     if (String(func).includes("action: 'click-comment-submit'") && ++attempts === 3) composer.submit.disabled = false;
     return inject(func, args);
   };
 });
 assert.equal(result, 'confirmed');
 assert.equal(composer.submitted, 1);
 assert.deepEqual(composer.inputs, [composer.request.comment]);
});

test('TikTok keeps its draft after the editor delivers a delayed controlled input event', async () => {
 const { composer, result, continued } = await runTikTokComment(composer => {
   const inject = composer.inject;
   composer.inject = (func, args) => {
     const result = inject(func, args);
     if (args?.[0] === 'comment' && result === 'draft') composer.interact('input');
     return result;
   };
 });
 assert.equal(result, 'confirmed');
 assert.equal(composer.submitted, 1);
 assert.deepEqual(composer.inputs, [composer.request.comment]);
 assert.equal(continued, true);
});

test('TikTok preserves its unsent draft without native DOM deletion when Post stays unavailable', async () => {
 const { composer, result, continued } = await runTikTokComment(composer => {
   composer.state.onInput = () => { composer.submit.disabled = true; };
 });
 assert.equal(result, 'draft-retained');
 assert.equal(composer.submitted, 0);
 assert.equal(composer.field.textContent, composer.request.comment);
 assert.deepEqual(composer.inputs, [composer.request.comment]);
 assert.equal(continued, true);
});

test('TikTok preserves manual comments before and after drafting without clicking Post', async () => {
 for (const when of ['before', 'after']) {
   const { composer, result, continued } = await runTikTokComment(composer => {
     if (when === 'before') composer.field.textContent = 'my own comment';
     else composer.state.onInput = field => { field.textContent = 'my own comment'; composer.interact('input'); };
   });
   assert.equal(result, when === 'before' ? 'skipped' : 'draft-retained');
   assert.equal(composer.field.textContent, 'my own comment');
   assert.equal(composer.submitted, 0);
   assert.equal(continued, true);
 }
});

test('TikTok never retries or deletes an unconfirmed submitted comment', async () => {
 const { composer, result, continued } = await runTikTokComment(composer => { composer.state.confirm = false; });
 assert.equal(result, 'uncertain');
 assert.equal(composer.submitted, 1);
 assert.deepEqual(composer.inputs, [composer.request.comment]);
 assert.equal(continued, true);
});

test('TikTok lost draft and submit responses preserve uncertainty without replay or cleanup', async () => {
 for (const duringSubmit of [false, true]) {
   const { composer, result, continued } = await runTikTokComment((composer, h) => {
     const execute = h.chrome.scripting.executeScript;
     h.chrome.scripting.executeScript = async request => {
       const result = await execute(request);
       if (duringSubmit ? String(request.func).includes("action: 'click-comment-submit'") : request.args?.[0] === 'comment') throw new Error('Frame with ID 0 was removed.');
       return result;
     };
   });
   assert.equal(result, duringSubmit ? 'uncertain-draft' : 'draft-retained');
   assert.equal(composer.submitted, duringSubmit ? 1 : 0);
   assert.deepEqual(composer.inputs, [composer.request.comment]);
   assert.equal(continued, true);
 }
});

test('TikTok stop, timeout and platform restrictions prevent comment submission and cleanup', async () => {
 for (const reason of ['stop', 'timeout', 'blocked']) {
   const { composer, h, continued } = await runTikTokComment((composer, h) => {
     composer.state.onInput = () => {
       if (reason === 'timeout') h.job.deadline = Date.now() - 1;
       else if (reason === 'blocked') composer.state.blocked = true;
       else vm.runInContext("controller.abort(new Error('session stopped.'))", h.ctx);
     };
   });
   assert.equal(composer.submitted, 0);
   assert.deepEqual(composer.inputs, [composer.request.comment]);
   assert.equal(continued, false);
   assert.ok(h.calls.some(call => call.patch?.phase === 'error'));
 }
});

test('runner waits for Post readiness and submits a focus-lost draft only once', async () => {
 const { composer, h, result, continued } = await runComment(composer => {
   composer.submit.disabled = true;
   composer.state.onInput = () => { composer.document.activeElement = composer.heading; };
   const inject = composer.inject;
   let checks = 0;
   composer.inject = (func, args) => {
     if (String(func).includes("action: 'comment-submit'") && ++checks === 3) composer.submit.disabled = false;
     return inject(func, args);
   };
 });
 assert.equal(result, 'confirmed');
 assert.equal(composer.submitted, 1);
 assert.equal(continued, true);
 assert.ok(h.calls.some(call => call.patch?.phase === 'complete'));
 assert.deepEqual(composer.inputs, [composer.request.comment]);
});

test('an unavailable Post control clears only the extension draft and lets the session continue', async () => {
 const { composer, h, result, continued } = await runComment(composer => { composer.submit.disabled = true; });
 assert.equal(result, 'skipped');
 assert.equal(composer.submitted, 0);
 assert.equal(composer.field.value, '');
 assert.deepEqual(composer.inputs, [composer.request.comment, '']);
 assert.equal(continued, true);
 assert.ok(h.calls.some(call => call.patch?.phase === 'complete'));
});

test('a retained or edited draft pauses comments without stopping the session or overwriting text', async () => {
 for (const edited of [false, true]) {
   const { composer, h, result, continued } = await runComment(composer => {
     composer.submit.disabled = true;
     composer.state.onInput = field => { field.value = edited ? 'my own edited comment' : composer.request.comment; };
   });
   assert.equal(result, 'draft-retained');
   assert.equal(composer.submitted, 0);
   assert.equal(composer.field.value, edited ? 'my own edited comment' : composer.request.comment);
   if (edited) assert.deepEqual(composer.inputs, [composer.request.comment]);
   assert.equal(continued, true);
   assert.ok(h.calls.some(call => call.patch?.phase === 'complete'));
 }
});

test('a replaced draft is submitted once and counted only after confirmation', async () => {
 const { composer, result, continued } = await runComment(composer => {
   composer.state.onInput = field => { const text = field.value; composer.replaceField().value = text; };
 });
 assert.equal(result, 'confirmed');
 assert.equal(composer.submitted, 1);
 assert.deepEqual(composer.inputs, [composer.request.comment]);
 assert.equal(continued, true);
});

test('an unavailable Post control clears an untouched draft through textarea replacements', async () => {
 const { composer, result, continued } = await runComment(composer => {
   composer.submit.ariaDisabled = 'true';
   composer.state.onInput = field => { const text = field.value; composer.replaceField().value = text; };
 });
 assert.equal(result, 'skipped');
 assert.equal(composer.submitted, 0);
 assert.equal(composer.field.value, '');
 assert.equal(continued, true);
});

test('an unconfirmed submitted comment is never clicked twice or cleared', async () => {
 const { composer, result, continued } = await runComment(composer => { composer.state.confirm = false; });
 assert.equal(result, 'uncertain');
 assert.equal(composer.submitted, 1);
 assert.deepEqual(composer.inputs, [composer.request.comment]);
 assert.equal(continued, true);
});

test('a manual Post interaction is never followed by another submit or draft deletion', async () => {
 const { composer, result, continued } = await runComment(composer => {
   composer.state.onInput = () => { composer.interact('click'); };
 });
 assert.equal(result, 'draft-retained');
 assert.equal(composer.submitted, 0);
 assert.deepEqual(composer.inputs, [composer.request.comment]);
 assert.equal(continued, true);
});

test('a lost draft result pauses only comments without filling or submitting again', async () => {
 const { composer, result, continued } = await runComment((composer, h) => {
   const execute = h.chrome.scripting.executeScript;
   h.chrome.scripting.executeScript = async request => {
     const result = await execute(request);
     if (request.args?.[0] === 'comment') throw new Error('Frame with ID 0 was removed.');
     return result;
   };
 });
 assert.equal(result, 'draft-retained');
 assert.equal(composer.submitted, 0);
 assert.deepEqual(composer.inputs, [composer.request.comment]);
 assert.equal(continued, true);
});

const frameRemoved = () => new Error('Frame with ID 0 was removed.');
const readAction = request => request.args?.[1]?.action;

test('losing the page while only focusing the empty composer is a clean skip', async () => {
 let phaseOne = 0;
 const { composer, h, result, continued } = await runComment((composer, h) => {
   const execute = h.chrome.scripting.executeScript;
   h.chrome.scripting.executeScript = async request => {
     // Phase one is the injected function that takes the composer and returns 'focused'.
     if (request.func && String(request.func).includes("action: 'comment-field'") && String(request.func).includes("'focused'")) { phaseOne++; throw frameRemoved(); }
     return execute(request);
   };
 });
 assert.equal(phaseOne, 1);
 assert.equal(result, 'skipped');
 assert.deepEqual(composer.inputs, []);
 assert.equal(composer.submitted, 0);
 assert.equal(continued, true);
 assert.ok(h.calls.some(call => call.patch?.phase === 'complete'));
});

test('a lost frame after typing is a skip only when no copy of the text remains', async () => {
 const { composer, result, continued } = await runComment((composer, h) => {
   const execute = h.chrome.scripting.executeScript;
   h.chrome.scripting.executeScript = async request => {
     const result = await execute(request);
     if (request.args?.[0] === 'comment') { composer.replaceField(); throw frameRemoved(); }
     return result;
   };
 });
 assert.equal(result, 'skipped');
 assert.deepEqual(composer.inputs, [composer.request.comment]);
 assert.equal(composer.field.value, '');
 assert.equal(composer.submitted, 0);
 assert.equal(continued, true);
});

test('an unreadable draft check after a lost frame keeps the draft result', async () => {
 let checks = 0;
 const { composer, result, continued } = await runComment((composer, h) => {
   const execute = h.chrome.scripting.executeScript;
   h.chrome.scripting.executeScript = async request => {
     if (readAction(request) === 'draft-state') { checks++; return [{ result: null }]; }
     const result = await execute(request);
     if (request.args?.[0] === 'comment') { composer.replaceField(); throw frameRemoved(); }
     return result;
   };
 });
 assert.equal(result, 'draft-retained');
 assert.ok(checks >= 3, `draft checks: ${checks}`);
 assert.equal(composer.submitted, 0);
 assert.equal(continued, true);
});

test('a clear check that is briefly unreadable is retried before keeping the draft', async () => {
 let unreadable = 0;
 const { composer, result, continued } = await runComment((composer, h) => {
   composer.submit.disabled = true;
   const execute = h.chrome.scripting.executeScript;
   h.chrome.scripting.executeScript = async request => {
     if (readAction(request) === 'comment-cleared' && unreadable < 3) { unreadable++; return [{ result: null }]; }
     return execute(request);
   };
 });
 assert.equal(unreadable, 3, 'the first clear check came back unavailable');
 assert.equal(result, 'skipped');
 assert.equal(composer.field.value, '');
 assert.equal(composer.submitted, 0);
 assert.equal(continued, true);
});

test('comment confirmation polls twelve times before it is uncertain', async () => {
 let verifies = 0;
 const { composer, result } = await runComment((composer, h) => {
   composer.state.confirm = false;
   const execute = h.chrome.scripting.executeScript;
   h.chrome.scripting.executeScript = async request => {
     if (readAction(request) === 'verify-comment') verifies++;
     return execute(request);
   };
 });
 assert.equal(result, 'uncertain');
 assert.equal(verifies, 12);
 assert.equal(composer.submitted, 1);
});

test('the runner loads the comment writer before the engine and both archives ship it', () => {
 const html = fs.readFileSync(path.join(extension, 'runner.html'), 'utf8');
 const order = ['src="plan.js"', 'src="comment-writer.js"', 'src="session.js"'].map(item => html.indexOf(item));
 assert.ok(order.every(index => index >= 0), 'all three scripts are loaded');
 assert.ok(order[0] < order[1] && order[1] < order[2], 'plan, writer, then engine');
 for (const script of ['package-extension.mjs', 'check-extension-package.mjs']) {
   const source = fs.readFileSync(path.join(root, 'scripts', script), 'utf8');
   const files = JSON.parse(source.match(/const files = (\[[^\]]+\]);/)[1].replace(/'/g, '"'));
   assert.equal(files[files.indexOf('plan.js') + 1], 'comment-writer.js', script);
   assert.equal(files.filter(file => file === 'comment-writer.js').length, 1, script);
   assert.doesNotMatch(source, /path\.join\(root,\s*'comment-writer\.js'\)/, `${script} has no root mirror of the writer`);
 }
 const check = fs.readFileSync(path.join(root, 'scripts/check-extension-package.mjs'), 'utf8');
 const mirrors = JSON.parse(check.match(/for \(const file of (\[[^\]]+\])\) \{\s*equal\(read\(file\), read\(`browser-extension\//)[1].replace(/'/g, '"'));
 assert.ok(mirrors.includes('plan.js'));
 assert.equal(mirrors.includes('comment-writer.js'), false);
 assert.equal(fs.existsSync(path.join(root, 'comment-writer.js')), false);
});

test('Stop and the deadline during comment readiness prevent submission and cleanup', async () => {
 for (const expired of [false, true]) {
   const { composer, h, continued } = await runComment((composer, h) => {
     composer.state.onInput = () => {
       if (expired) h.job.deadline = Date.now() - 1;
       else vm.runInContext("controller.abort(new Error('session stopped.'))", h.ctx);
     };
   });
   assert.equal(composer.submitted, 0);
   assert.deepEqual(composer.inputs, [composer.request.comment]);
   assert.equal(continued, false);
   assert.ok(h.calls.some(call => call.patch?.phase === 'error' && /draft may remain/.test(call.patch.message)));
 }
});

test('an Instagram restriction during comment readiness still stops all actions', async () => {
 const { composer, h, continued } = await runComment(composer => {
   composer.state.onInput = () => { composer.state.blocked = true; };
 });
 assert.equal(composer.submitted, 0);
 assert.deepEqual(composer.inputs, [composer.request.comment]);
 assert.equal(continued, false);
 assert.ok(h.calls.some(call => call.patch?.phase === 'error'));
});
test('stop during tab lookup prevents function injection',async()=>{
 const h=runnerContext('starting',async(settings,adapter,signal)=>{await adapter.inspect(signal)});
 h.chrome.tabs.get=async()=>{vm.runInContext("controller.abort(new Error('stopped'))",h.ctx);return {url:'https://www.instagram.com/'}};
 h.start();await settle();
 assert.equal(h.calls.filter(x=>x.injection?.func).length,0);
 assert.ok(h.calls.some(x=>x.patch?.phase==='stopped'));
});
test('refreshing a running session stops it instead of replaying actions',async()=>{
 let runs=0;
 const h=runnerContext('running',async()=>{runs++});h.start();await settle();
 assert.equal(runs,0);assert.ok(h.calls.some(x=>x.type==='runner-stop'));
 assert.ok(h.calls.some(x=>x.patch?.phase==='stopped'));
});
test('navigating away from the runner or discarding it releases the session lock safely',async()=>{
 for(const change of [{url:'https://example.com/'},{discarded:true}]){
  const h=background();await h.message({type:'start',tabId:7,settings:{minutes:10,niche:'branding'}});
  h.chrome.tabs.onUpdated.listeners[0](90,change);await h.message({type:'state'});
  assert.equal(h.job().phase,'stopped');assert.equal(h.job().stopRequested,true);
 }
});

test('navigation waits for the requested document rather than accepting an old feed', async()=>{
 const target='https://www.instagram.com/explore/search/keyword/?q=branding';
 const h=runnerContext('starting',async(settings,adapter)=>{await adapter.search('branding')});
 let reads=0;
 h.chrome.tabs.get=async()=>{
  reads++;
  return reads===1?{url:'https://www.instagram.com/',pendingUrl:target,status:'complete'}:{url:target,status:'complete'};
 };
 h.chrome.scripting.executeScript=async request=>{h.calls.push({injection:request,reads});return [{result:{posts:['https://www.instagram.com/p/example/']}}]};
 h.ctx.setTimeout=(fn,ms)=>setTimeout(fn,0);
 h.start();
 for(let i=0;i<20&&!h.calls.some(x=>x.patch?.phase==='complete');i++)await new Promise(resolve=>setTimeout(resolve,5));
 const inspections=h.calls.filter(x=>x.injection);
 assert.ok(inspections.length>0);
 assert.ok(inspections.every(x=>x.reads>=2),'the old page must never be inspected as the search result');
 assert.ok(h.calls.some(x=>x.patch?.phase==='complete'));
});
test('a normally returning engine after cancellation is reported as stopped',async()=>{
 const h=runnerContext('starting',async()=>{vm.runInContext("controller.abort(new Error('session stopped. you have control.'))",h.ctx)});
 h.start();await settle();
 assert.ok(h.calls.some(x=>x.patch?.phase==='stopped'));
 assert.ok(!h.calls.some(x=>x.patch?.phase==='complete'));
});

test('only the exact local side panel can send dashboard commands', async()=>{
 const trusted={id:'extension-id',url:'chrome-extension://extension-id/sidepanel.html'};
 assert.equal(panelSender(trusted,'chrome-extension://extension-id/'),true);
 for(const patch of [{id:'evil'},{url:'https://example.com/sidepanel.html'},{url:'chrome-extension://extension-id/runner.html'},{url:'chrome-extension://evil/sidepanel.html'},{frameId:1}])assert.equal(panelSender({...trusted,...patch},'chrome-extension://extension-id/'),false);
 const h=background();
 const result=await h.message({type:'start',tabId:7,settings:{minutes:1,niche:'branding',customLimits:{like:0,follow:0}}},trusted);
 assert.equal(result.ok,true);
 assert.equal(h.created[0].active,false,'side-panel start must not steal focus from instagram');
 assert.equal((await h.message({type:'stop'},trusted)).ok,true);
 assert.equal(h.job().phase,'stopping');
});
test('toolbar is configured to open the packaged panel',()=>{
 const manifest=JSON.parse(fs.readFileSync(path.join(extension,'manifest.json')));
 assert.equal(manifest.side_panel.default_path,'sidepanel.html');
 assert.ok(fs.existsSync(path.join(extension,manifest.side_panel.default_path)));
 assert.ok(!manifest.action.default_popup);
});

test('opening and advancing viewer use its controls without navigating back to the grid',async()=>{
 const first='https://www.instagram.com/p/first/';const second='https://www.instagram.com/p/second/';
 let current=null;const updates=[];
 const h=runnerContext('starting',async(settings,adapter)=>{
   await adapter.open(first);
   assert.equal(await adapter.advance({id:first,viewer:true,next:true}),true);
 });
 h.chrome.tabs.get=async()=>({url:current || 'https://www.instagram.com/'});
 h.chrome.tabs.update=async options=>{updates.push(options)};
 h.chrome.scripting.executeScript=async request=>{
   h.calls.push({injection:request});
   if(request.files)return [{result:null}];
   if(request.args?.[0]===first && typeof request.args?.[1]==='number'){
     current=current?second:first;return [{result:true}];
   }
   return [{result:{sequence:[first,second],posts:[first,second],post:current?{id:current,viewer:true,next:true}:null}}];
 };
 h.start();await settle();
 assert.equal(current,second);
 assert.equal(updates.length,0);
 assert.ok(h.calls.some(x=>x.patch?.phase==='complete'));
});
test('stop during viewer advance prevents clicking next',async()=>{
 const first='https://www.instagram.com/p/first/';const second='https://www.instagram.com/p/second/';
 const h=runnerContext('starting',async(settings,adapter)=>{
   vm.runInContext(`viewerSequence = ['${first}', '${second}']; controller.abort(new Error('stopped'))`,h.ctx);
   await adapter.advance({id:first,viewer:true,next:true});
 });
 h.start();await settle();
 assert.equal(h.calls.filter(x=>x.injection).length,0);
 assert.ok(h.calls.some(x=>x.patch?.phase==='stopped'));
});

test('viewer next refreshes its sequence, matches canonical ids and refuses previously watched targets', async () => {
 for (const seen of [false, true]) {
  const first = 'https://www.instagram.com/p/first/'; const second = 'https://www.instagram.com/p/second/';
  let current = first; let clicks = 0; let result;
  const h = runnerContext('starting', async (settings, adapter) => {
   vm.runInContext(`viewerSequence = ['${first}']`, h.ctx);
   result = await adapter.advance({ id: first.replace('/p/', '/reel/'), viewer: true, next: true }, null, target => seen && target === second);
  });
  h.chrome.scripting.executeScript = async request => {
   if (request.files) return [{ result: null }];
   if (typeof request.args?.[1] === 'number') { clicks++; current = second; return [{ result: true }]; }
   return [{ result: { sequence: [first, second], post: { id: current, viewer: true, next: true } } }];
  };
  await finishRunner(h);
  assert.equal(result, !seen);
  assert.equal(clicks, seen ? 0 : 1);
 }
});

test('returning from Instagram viewer closes the modal and never reloads the search', async () => {
 const search = 'https://www.instagram.com/explore/search/keyword/?q=branding';
 const post = { id: 'https://www.instagram.com/p/first/', viewer: true };
 let current = search; let closes = 0; const navigations = [];
 const h = runnerContext('starting', async (settings, adapter, signal) => {
  await adapter.search('branding');
  current = post.id;
  vm.runInContext(`expectedDestination = '${post.id}'`, h.ctx);
  assert.equal(await adapter.leavePost(post, signal), true);
  assert.equal(signal.aborted, false);
 });
 h.chrome.tabs.get = async () => ({ url: current, status: 'complete' });
 h.chrome.tabs.update = async (id, options) => { navigations.push(options.url); current = options.url; };
 h.chrome.scripting.executeScript = async request => {
  if (request.files) return [{ result: null }];
  if (request.args?.[0] === post.id) {
   assert.match(request.func.toString(), /action: 'close'/);
   closes++; current = search;
   h.chrome.tabs.onUpdated.listeners[0](7, { url: search });
   return [{ result: true }];
  }
  return [{ result: { posts: [post.id], post: current === post.id ? post : null } }];
 };
 await finishRunner(h);
 assert.deepEqual(navigations, [search]);
 assert.equal(closes, 1);
 assert.ok(h.calls.some(call => call.patch?.phase === 'complete'));
});

test('repeated tiles cannot make Next replay a watched post or guess an ambiguous occurrence', async () => {
 const first = 'https://www.instagram.com/p/first/'; const second = 'https://www.instagram.com/p/second/'; const third = 'https://www.instagram.com/p/third/';
 for (const id of [first, second]) {
  let clicks = 0; let result;
  const h = runnerContext('starting', async (settings, adapter, signal) => {
   result = await adapter.advance({ id, viewer: true, next: true }, signal, target => target === first || target === second);
  });
  h.chrome.scripting.executeScript = async request => {
   if (request.files) return [{ result: null }];
   if (typeof request.args?.[1] === 'number') { clicks++; return [{ result: true }]; }
   return [{ result: { sequence: [first, second, first, third], post: { id, viewer: true, next: true } } }];
  };
  await finishRunner(h);
  assert.equal(result, false);
  assert.equal(clicks, 0);
 }
});

test('missing close control does not reload the search or click a different control', async () => {
 const post = { id: 'https://www.instagram.com/p/first/', viewer: true };
 const search = 'https://www.instagram.com/explore/search/keyword/?q=branding';
 let navigations = 0; let result;
 const h = runnerContext('starting', async () => {
  result = await vm.runInContext(`returnToResults(${JSON.stringify(post)}, '${search}')`, h.ctx);
 });
 h.chrome.tabs.update = async () => { navigations++; };
 h.chrome.scripting.executeScript = async () => [{ result: false }];
 await finishRunner(h);
 assert.equal(result, false);
 assert.equal(navigations, 0);
});

test('viewer waits for content identity when the address changes before the modal',()=>{
 for(const hrefs of [[],['https://www.instagram.com/p/old/c/123/']]){
   const rect=()=>({width:600,height:500,left:0,top:0,right:600,bottom:500});
   const article={getBoundingClientRect:rect,querySelectorAll:selector=>selector==='a[href]'?hrefs.map(href=>({href})):[]};
   const dialog={getBoundingClientRect:rect,innerText:'',querySelector:selector=>selector==='article'?article:{}};
   const document={querySelectorAll:selector=>selector==='[role="dialog"], [role="alert"]'?[dialog]:selector==='article'?[article]:[]};
   const ctx=vm.createContext({URL,document,location:{hostname:'www.instagram.com',origin:'https://www.instagram.com',href:'https://www.instagram.com/p/new/',pathname:'/p/new/'},innerWidth:1000,innerHeight:800,getComputedStyle:()=>({visibility:'visible',display:'block'})});
   vm.runInContext(fs.readFileSync(path.join(extension,'instagram.js'),'utf8'),ctx);
   assert.equal(ctx.inspectInstagram().post,null);
 }
});

function inspectedTikTokRunner(page, operation) {
 const h = runnerContext('starting', operation);
 h.job.settings.platform = 'tiktok';
 h.chrome.tabs.get = async () => ({ id: 7, url: page.context.location.href, status: 'complete' });
 h.chrome.scripting.executeScript = async request => {
   h.calls.push({ injection: request });
   if (request.files) { page.load(); return [{ result: null }]; }
   return [{ result: await page.inject(request.func, request.args || []) }];
 };
 return h;
}

test('the actual TikTok observer and injected opener skip hidden candidates and open a rendered exact link', async () => {
 const { fixture } = require('./fixtures/tiktok-comment-composer.cjs');
 const id = 'https://www.tiktok.com/@creator/video/123/';
 const page = fixture({ href: 'https://www.tiktok.com/search?q=branding' });
 const hidden = page.element('a', { href: 'https://www.tiktok.com/@hidden/video/1/' }, '', page.rect(0, 0, 0, 0));
 const duplicate = page.element('a', { href: id }, '', page.rect(0, 0, 0, 0));
 const external = page.element('a', { href: 'https://example.com/@creator/video/123/' }, '', page.rect(0, 0, 100, 30));
 page.main.children.unshift(hidden, duplicate, external);
 for (const node of [hidden, duplicate, external]) node.parentElement = page.main;
 let result;
 const h = inspectedTikTokRunner(page, async (settings, adapter) => {
   const observed = await adapter.inspect();
   assert.deepEqual(Array.from(observed.sequence), [id]);
   result = await adapter.open(observed.sequence[0]);
 });
 page.link.onClick = () => {
   page.context.location = new URL(id + '?q=branding');
   h.chrome.tabs.onUpdated.listeners[0](7, { url: page.context.location.href });
 };
 await finishRunner(h);
 assert.equal(result, true);
 assert.deepEqual(page.clicks, [page.link]);
 assert.equal(hidden.scrolled, undefined); assert.equal(duplicate.scrolled, undefined); assert.equal(external.scrolled, undefined);
 assert.ok(h.calls.some(call => call.patch?.phase === 'complete'));
});

test('TikTok opener rechecks hidden links and overlays immediately before clicking', async () => {
 const { fixture } = require('./fixtures/tiktok-comment-composer.cjs');
 for (const change of [page => { page.link.hidden = true; }, page => { page.body.append(page.element('div', {}, '', page.rect(300, 100, 300, 100))); }]) {
   const page = fixture({ href: 'https://www.tiktok.com/search?q=branding' });
   let result;
   const h = inspectedTikTokRunner(page, async (settings, adapter) => { result = await adapter.open('https://www.tiktok.com/@creator/video/123/'); });
   const inject = h.chrome.scripting.executeScript;
   h.chrome.scripting.executeScript = async request => {
     if (typeof request.args?.[0] === 'string' && request.args[0].startsWith('https://')) change(page);
     return inject(request);
   };
   await finishRunner(h);
   assert.equal(result, false);
   assert.equal(page.clicks.length, 0);
 }
});

test('actual TikTok next-post navigation preserves mixed photo order and same-photo slide rewrites', async () => {
 const { fixture } = require('./fixtures/tiktok-comment-composer.cjs');
 const photoId = 'https://www.tiktok.com/@creator/photo/234/';
 const page = fixture();
 page.main.append(page.element('a', { href: photoId }, '', page.rect(0, 900, 100, 100)));
 page.main.append(page.element('a', { href: 'https://www.tiktok.com/@creator/video/456/' }, '', page.rect(0, 1100, 100, 100)));
 let result;
 const h = inspectedTikTokRunner(page, async (settings, adapter, signal) => {
   const before = await adapter.inspect();
   assert.deepEqual(Array.from(before.sequence), [before.post.id, photoId, 'https://www.tiktok.com/@creator/video/456/']);
   result = await adapter.advance(before.post);
   assert.equal(result, true);
   assert.equal(signal.aborted, false);
   const photo = (await adapter.inspect()).post;
   assert.equal(photo.id, photoId); assert.equal(photo.like, true); assert.equal(photo.follow, true);
   h.chrome.tabs.onUpdated.listeners[0](7, { url: photoId + '?image_index=14&q=personal%20branding' });
   assert.equal(signal.aborted, false);
   h.chrome.tabs.onUpdated.listeners[0](7, { url: photoId.replace('/234/', '/999/') });
   assert.equal(signal.aborted, true);
 });
 page.next.onClick = () => {
   page.video.remove(); page.slide.append(page.photo); page.carousel.append(page.slide); page.media.append(page.carousel);
   page.link.attrs.href = photoId; page.context.location = new URL(photoId + '?image_index=0&q=branding');
   h.chrome.tabs.onUpdated.listeners[0](7, { url: page.context.location.href });
 };
 await finishRunner(h);
 assert.equal(result, true);
 assert.deepEqual(page.clicks, [page.next]);
 assert.ok(h.calls.some(call => call.patch?.phase === 'stopped'));
 for (const different of ['https://www.tiktok.com/@creator/video/234/', 'https://www.tiktok.com/@other/photo/234/', 'https://www.tiktok.com/@creator/photo/999/', 'https://tiktok.com.evil.test/@creator/photo/234/', 'http://www.tiktok.com/@creator/photo/234/']) {
   h.ctx.expectedPhoto = photoId; h.ctx.differentPhoto = different;
   assert.equal(vm.runInContext('sameDestination(differentPhoto, expectedPhoto)', h.ctx), false, different);
 }
});

async function runTikTokFreshEngagement(action, configure = () => {}) {
 const viewer = tiktokCommentComposer();
 const fresh = tiktokCommentComposer();
 fresh.follow.textContent = 'Following';
 fresh.like.attrs['aria-pressed'] = 'true';
 let now = Date.now(); let result; let continued = false;
 const created = []; const removed = [];
 const confirmationTab = { id: 81, url: viewer.request.id, status: 'complete' };
 const h = runnerContext('starting', async (_settings, adapter) => {
   result = await adapter.engage(action, viewer.request);
   await adapter.inspect(); continued = true;
 });
 h.job.settings.platform = 'tiktok';
 h.ctx.Date = { now: () => now };
 h.ctx.setTimeout = (fn, ms) => setTimeout(() => { if (ms < 3000) now += ms; fn(); }, ms >= 3000 ? 100 : 0);
 h.chrome.tabs.get = async id => id === 81 ? confirmationTab : { id: 7, url: viewer.request.id };
 h.chrome.tabs.create = async options => { created.push(options); return confirmationTab; };
 h.chrome.tabs.remove = async id => removed.push(id);
 h.chrome.scripting.executeScript = async request => {
   h.calls.push({ injection: request });
   const page = request.target.tabId === 81 ? fresh : viewer;
   if (request.files) { assert.deepEqual(Array.from(request.files), ['tiktok.js']); page.load(); return [{ result: null }]; }
   return [{ result: await page.inject(request.func, request.args) }];
 };
 configure({ viewer, fresh, h, confirmationTab });
 await finishRunner(h);
 return { viewer, fresh, h, created, removed, result, continued };
}

for (const action of ['like', 'follow']) {
test(`TikTok counts an optimistic ${action} only after a separate page confirms it, including canonical redirects`, async () => {
 for (const canonical of [false, true]) {
   const f = await runTikTokFreshEngagement(action, ({ confirmationTab }) => { if (canonical) confirmationTab.url = confirmationTab.url.replace(/\/$/, ''); });
   assert.equal(f.result, 'confirmed');
   assert.deepEqual(f.created.map(value => JSON.parse(JSON.stringify(value))), [{ url: f.viewer.request.id, active: false }]);
   assert.equal(f.viewer.clicks.filter(node => node === f.viewer[action]).length, 1);
   assert.equal(f.fresh.clicks.length, 0);
   assert.deepEqual(f.removed, [81]);
   assert.deepEqual([...new Set(f.h.calls.filter(call => call.injection?.target.tabId === 81 && call.injection.func).map(call => call.injection.args[2]))], [action]);
 }
});

test(`TikTok ${action} rollback, missing state and mismatched identity remain uncertain without retrying`, async () => {
 const rollback = f => { if (action === 'like') f.like.attrs['aria-pressed'] = 'false'; else f.follow.textContent = 'Follow'; };
 for (const change of [rollback, f => f[action].remove(), f => { f.author.attrs.href = 'https://www.tiktok.com/@different/'; }, f => {
   f.context.location = new URL('https://www.tiktok.com/@creator/video/999/');
   f.link.attrs.href = f.context.location.href;
 }]) {
   const f = await runTikTokFreshEngagement(action, ({ fresh }) => change(fresh));
   assert.equal(f.result, 'uncertain');
   assert.equal(f.viewer.inspect(`verify-${action}`).confirmed, true);
   assert.equal(f.viewer.clicks.filter(node => node === f.viewer[action]).length, 1);
   assert.equal(f.fresh.clicks.length, 0);
   assert.equal(f.continued, true);
   assert.deepEqual(f.removed, [81]);
 }
});

test(`TikTok fresh ${action} confirmation preserves moved tabs and refuses pending navigation`, async () => {
 for (const field of ['url', 'pendingUrl']) {
   const f = await runTikTokFreshEngagement(action, ({ confirmationTab }) => { confirmationTab[field] = 'https://www.tiktok.com/@other/video/999/'; });
   assert.equal(f.result, 'uncertain');
   assert.deepEqual(f.removed, []);
   assert.equal(f.h.calls.filter(call => call.injection?.target.tabId === 81).length, 0);
 }
});

test(`TikTok fresh ${action} checks obey Stop, deadline and account restrictions without further actions`, async () => {
 for (const reason of ['stop', 'deadline', 'restriction']) {
   const f = await runTikTokFreshEngagement(action, ({ h, fresh, confirmationTab }) => {
     if (reason === 'restriction') fresh.state.blocked = true;
     else h.chrome.tabs.create = async () => {
       if (reason === 'deadline') h.job.deadline = Date.now() - 1;
       else vm.runInContext("controller.abort(new Error('session stopped.'))", h.ctx);
       return confirmationTab;
     };
   });
   assert.equal(f.continued, false);
   assert.equal(f.viewer.clicks.filter(node => node === f.viewer[action]).length, 1);
   assert.equal(f.fresh.clicks.length, 0);
   assert.deepEqual(f.removed, [81]);
   assert.ok(f.h.calls.some(call => /an action may have gone through/.test(call.patch?.message || '')));
 }
});
}

test('a fresh TikTok like with contradictory pressed state is uncertain and never clicked again', async () => {
 const f = await runTikTokFreshEngagement('like', ({ fresh }) => {
   fresh.like.attrs['aria-pressed'] = 'false';
   fresh.heart.attrs.fill = 'rgb(254, 44, 85)';
 });
 assert.equal(f.result, 'uncertain');
 assert.equal(f.viewer.clicks.length, 1);
 assert.equal(f.fresh.clicks.length, 0);
 assert.deepEqual(f.removed, [81]);
});

test('fresh TikTok like confirmation rechecks Stop and deadline after looking up its temporary tab', async () => {
 for (const reason of ['stop', 'deadline']) {
   const f = await runTikTokFreshEngagement('like', ({ h }) => {
     const get = h.chrome.tabs.get;
     h.chrome.tabs.get = async id => {
       const tab = await get(id);
       if (id === 81) {
         if (reason === 'deadline') h.job.deadline = Date.now() - 1;
         else vm.runInContext("controller.abort(new Error('session stopped.'))", h.ctx);
       }
       return tab;
     };
   });
   assert.equal(f.continued, false);
   assert.equal(f.h.calls.filter(call => call.injection?.target.tabId === 81).length, 0);
   assert.deepEqual(f.removed, [81]);
 }
});

test('a fresh TikTok like cannot confirm or close a tab that moves during inspection', async () => {
 const f = await runTikTokFreshEngagement('like', ({ h, confirmationTab }) => {
   const inject = h.chrome.scripting.executeScript;
   h.chrome.scripting.executeScript = async request => {
     const result = await inject(request);
     if (request.target.tabId === 81 && request.func) confirmationTab.pendingUrl = 'https://www.tiktok.com/@other/video/999/';
     return result;
   };
 });
 assert.equal(f.result, 'uncertain');
 assert.equal(f.fresh.clicks.length, 0);
 assert.deepEqual(f.removed, []);
});

test('TikTok ignored paste is not submitted or counted and does not use native DOM editing', async () => {
 const f = await runTikTokComment(composer => { composer.state.ignorePaste = true; });
 assert.equal(f.result, 'draft-retained');
 assert.equal(f.composer.submitted, 0);
 assert.deepEqual(f.composer.inputs, []);
});

function instagramNavigationFixture(nextDestination) {
 const search = 'https://www.instagram.com/explore/search/keyword/?q=drop%20shipping';
 const first = 'https://www.instagram.com/p/first/';
 const second = 'https://www.instagram.com/p/second/';
 let current = search; let time = Date.now(); let clicks = 0; let closes = 0;
 const h = runnerContext('starting', async (settings, adapter, signal) => {
  assert.equal(await adapter.search('drop shipping'), true);
  assert.equal(await adapter.open(first), true);
  h.result = await adapter.advance({ id:first, viewer:true, next:true }, signal);
  if (!h.result) assert.equal(await adapter.leavePost({id:first,viewer:true}, signal), true);
  h.idleDestination = vm.runInContext('expectedDestination', h.ctx);
  h.activeTransition = vm.runInContext('viewerNavigation', h.ctx);
  if (h.after) h.after(signal);
 });
 const change = url => { current = url; h.chrome.tabs.onUpdated.listeners[0](7, { url }); };
 h.ctx.Date = { now: () => time };
 h.ctx.setTimeout = (fn, ms) => setTimeout(() => { if (ms < 3000) time += ms; fn(); }, ms >= 3000 ? 100 : 0);
 h.chrome.tabs.get = async () => ({url:current,status:'complete'});
 h.chrome.tabs.update = async (id, options) => { change(options.url); };
 h.chrome.scripting.executeScript = async request => {
  if (request.files) return [{result:null}];
  if (typeof request.args?.[1] === 'number') {
   if (/action: 'close'/.test(request.func.toString())) { closes++; change(search); return [{result:true}]; }
   clicks++;
   if (clicks === 1) change(first);
   else if (nextDestination === 'failed' || nextDestination === 'slow-failed') { if (nextDestination === 'slow-failed') time += 17000; return [{result:false}]; }
   else {
    change(first); // Instagram can deliver the outgoing URL after Next starts.
    change(search.replace('%20', '+'));
    if (nextDestination !== 'grid') change(nextDestination || second);
   }
   return [{result:true}];
  }
  return [{result:{posts:[first,second],sequence:[first,second],post:/\/p\//.test(current)?{id:current,viewer:true,next:true}:null}}];
 };
 return {h, search, first, second, change, clicks:()=>clicks, closes:()=>closes};
}

test('Instagram Next permits only its own source and same-search intermediate before the target', async () => {
 const f = instagramNavigationFixture();
 await finishRunner(f.h);
 assert.equal(f.h.result,true);
 assert.equal(f.h.idleDestination,f.second);
 assert.equal(f.h.activeTransition,null);
 assert.equal(f.clicks(),2);
 assert.equal(f.closes(),0);
 assert.ok(f.h.calls.some(call=>call.patch?.phase==='complete'));
});

test('Instagram Next can settle back on its search without another stale Close click', async () => {
 const f = instagramNavigationFixture('grid');
 await finishRunner(f.h);
 assert.equal(f.h.result,false);
 assert.equal(f.closes(),0);
 assert.equal(f.h.activeTransition,null);
 assert.ok(f.h.calls.some(call=>call.patch?.phase==='complete'));
});

test('Instagram transition still rejects unrelated posts, searches and external destinations', async () => {
 for (const destination of ['https://www.instagram.com/p/unrelated/','https://www.instagram.com/explore/search/keyword/?q=other','https://www.instagram.com/accounts/login/','https://example.com/']) {
  const f = instagramNavigationFixture(destination);
  await finishRunner(f.h);
  assert.ok(f.h.calls.some(call=>call.patch?.phase==='stopped' && /page changed/.test(call.patch.message)), destination);
  assert.equal(f.closes(),0);
  assert.equal(vm.runInContext('viewerNavigation',f.h.ctx),null);
 }
});

test('Instagram transition allowance ends on success and failed clicks; idle manual navigation stops', async () => {
 for (const result of [undefined,'failed']) {
  const f = instagramNavigationFixture(result);
  f.h.after = signal => {
   assert.equal(signal.aborted,false);
   f.change(result === 'failed' ? f.second : f.search);
   assert.equal(signal.aborted,true);
  };
  await finishRunner(f.h);
  assert.equal(f.h.activeTransition,null);
  assert.ok(f.h.calls.some(call=>call.patch?.phase==='stopped'));
 }
});

test('a slow failed Instagram click restores its source after the transition allowance expires', async () => {
 const f = instagramNavigationFixture('slow-failed');
 await finishRunner(f.h);
 assert.equal(f.h.result,false);
 assert.equal(f.closes(),1);
 assert.equal(f.h.idleDestination,f.search);
 assert.equal(f.h.activeTransition,null);
 assert.ok(f.h.calls.some(call=>call.patch?.phase==='complete'));
});

test('a stopped runner keeps its stopped result when final acknowledgement passes the old deadline', async () => {
 let now = Date.now();
 const h = runnerContext('starting', async () => {
  h.job.stopRequested = true;
  h.job.remainingMs = 1000;
  now = h.job.deadline + 5000;
  vm.runInContext("controller.abort(new Error('session stopped. you have control.'))",h.ctx);
 });
 h.ctx.Date = { now:()=>now };
 await finishRunner(h);
 assert.ok(h.calls.some(call=>call.patch?.phase==='stopped'));
 assert.ok(!h.calls.some(call=>call.patch?.phase==='complete'));
});
