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
 assert.deepEqual(manifest.host_permissions,[...platforms.instagram.patterns,...platforms.tiktok.patterns]);
 for(const file of ['plan.js','session.js','guards.js'])new vm.Script(fs.readFileSync(path.join(extension,file),'utf8'));
 const ctx=vm.createContext({setTimeout,clearTimeout,AbortController});
 for(const file of ['plan.js','session.js'])vm.runInContext(fs.readFileSync(path.join(extension,file),'utf8'),ctx);
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
 assert.equal(h.created.length,1);assert.equal(h.created[0].active,true);
 assert.equal((await h.message({type:'start',tabId:7,settings:{minutes:10,niche:'branding'}})).ok,false);
});
test('tiktok tabs can start warm-up with likes, follows and comments',async()=>{
 const h=background();
 const tabs=await h.message({type:'tabs',platform:'tiktok'});
 assert.deepEqual(tabs.data.map(tab=>tab.id),[8]);
 const response=await h.message({type:'start',tabId:8,settings:{platform:'tiktok',minutes:10,niche:'personal branding',enableComments:true,customLimits:{like:4,follow:1,comment:2}}});
 assert.equal(response.ok,true);
 assert.equal(h.job().settings.platform,'tiktok');
 assert.deepEqual(h.job().settings.limits,{like:4,follow:1,comment:2});
 assert.equal((await h.message({type:'start',tabId:7,settings:{platform:'tiktok',minutes:10,niche:'branding'}})).ok,false);
});
test('the public web bridge lists and opens the requested platform through the real background handler', async () => {
  const h = background();
  const bridge = webBridge(h);
  for (const [platform, tabId] of [['instagram', 7], ['tiktok', 8]]) {
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
test('the public bridge rejects malformed platforms without querying or opening another destination', async () => {
  const h = background();
  const bridge = webBridge(h);
  for (const platform of ['https://evil.example/', 'youtube', '__proto__', null, [], ['tiktok'], { platform: 'tiktok' }, 8]) {
    for (const type of ['tabs', 'open-platform']) {
      await bridge.request({ type, platform });
      assert.equal(bridge.responses.at(-1).data.ok, false);
      assert.match(bridge.responses.at(-1).data.error, /choose instagram or tiktok/);
    }
  }
  assert.equal(bridge.forwarded.length, 0);
  assert.equal(h.created.length, 0);
  assert.equal(h.job(), undefined);
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
  await bridge.request({ type: 'tabs', platform: 'tiktok', token: 'must-not-forward', url: 'https://evil.example', capability: 'must-not-forward', patch: { phase: 'running' } });
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
 page.document = {
   // A TikTok marker need not have a button ancestor. Any runner fallback to
   // coordinate/button resolution would fail this test instead of clicking.
   elementFromPoint() { throw new Error('TikTok clicks must remain inside the inspector'); },
   querySelectorAll() { return [{ href: id, getBoundingClientRect: () => ({ width: 100 }), scrollIntoView() {}, click() { clicks.push('open'); changeURL(id); } }]; }
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
   assert.equal(result, 'confirmed');
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

test('TikTok clears only its unchanged unsent draft when Post stays unavailable', async () => {
 const { composer, result, continued } = await runTikTokComment(composer => {
   composer.state.onInput = () => { composer.submit.disabled = true; };
 });
 assert.equal(result, 'skipped');
 assert.equal(composer.submitted, 0);
 assert.equal(composer.field.textContent, '');
 assert.deepEqual(composer.inputs, [composer.request.comment, '']);
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
