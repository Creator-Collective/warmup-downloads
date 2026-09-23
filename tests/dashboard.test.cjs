const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { publicState } = require('../browser-extension/guards.js');
const { validateSettings } = require('../plan.js');
function dashboard(panel = false, saved = null, respond = null) {
  const requests = [];
  const nodes = new Map();
  const intervals = new Map();
  let stored = saved === null ? null : JSON.stringify(saved);
  const defaults = { platform:'instagram', niche:'personal branding', minutes:'10', focus:'balanced', 'instagram-tab':'7' };
  const element = id => {
    if (!nodes.has(id)) nodes.set(id,{ value:defaults[id] || '', checked:false, textContent:'', hidden:false, disabled:false, placeholder:'', dataset:{}, style:{}, options:[], listeners:{}, classList:{toggle(){}}, addEventListener(type,fn){this.listeners[type]=fn}, replaceChildren(...children){this.options=children;this.value=children[0]?.value || ''}, add(option){this.options.push(option)}, append(){} });
    return nodes.get(id);
  };
  const context=vm.createContext({ document:{getElementById:element,body:{classList:{toggle(){}}},createElement:()=>element('new')}, window:{addEventListener(){},postMessage(){}}, location:panel?{protocol:'chrome-extension:',pathname:'/sidepanel.html',origin:'chrome-extension://extension-id'}:{origin:'https://creator-collective-warmup.vercel.app'}, chrome:{runtime:{sendMessage:async message=>{requests.push(message);const data=message.type==='hello'?{state:{running:false,message:'ready',activity:[]}}:message.type==='tabs'?[{id:message.platform==='tiktok'?8:7,title:message.platform==='tiktok'?'tiktok':'instagram'}]:message.type==='state'?{running:false,message:'ready',activity:[]}:message.type==='start'?{running:true,message:'started',activity:[]}:null;return {ok:true,data:respond?await respond(message,data):data}}}}, crypto:{randomUUID:()=> 'id'}, localStorage:{getItem:()=>stored,setItem(key,value){stored=value}}, setTimeout:()=>1,clearTimeout(){},setInterval(callback,delay){intervals.set(delay,callback)},Option:function(text,value){this.text=text;this.value=value},console });
  context.commentHistory = require('../comment-history.js');
  context.sessionResults = require('../session-results.js');
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../plan.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../dashboard.js'),'utf8'),context);
  return {context,element,requests,poll:()=>intervals.get(1500)(),saved:()=>JSON.parse(stored),edit(id,value){element(id).value=value;element(id).listeners.input()},settings:()=>JSON.parse(vm.runInContext('JSON.stringify(sessionPlan.validateSettings(input()))',context))};
}
test('operation errors remain visible across activity polls and clear on deliberate input',()=>{
 const h=dashboard();
 vm.runInContext("error('that tab is no longer on instagram. choose it again.'); render({running:false,message:'ready',activity:[]}); render({running:false,message:'ready',activity:[]});",h.context);
 assert.match(h.element('form-error').textContent,/choose it again/);
 assert.equal(h.element('form-error').hidden,false);
 h.element('niche').listeners.input();
 assert.equal(h.element('form-error').hidden,true);
});
test('invalid settings keep start disabled even after a failed submit',async()=>{
 const h=dashboard();
 vm.runInContext('connection(true)',h.context);
 h.element('minutes').value='0';
 h.element('minutes').listeners.input();
 assert.equal(h.element('start').disabled,true);
 await h.element('session-form').listeners.submit({preventDefault(){}});
 assert.equal(h.element('start').disabled,true);
 assert.equal(h.element('form-error').hidden,false);
});

test('side panel connects directly and retains activity when reopened',async()=>{
 const h=dashboard(true);
 for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.element('connection').textContent,'connected');
 assert.deepEqual(h.requests.map(r=>r.type),['hello','tabs']);
 vm.runInContext("render({running:true,message:'watching the next post.',activity:[],stats:{scroll:2}})",h.context);
 assert.equal(h.element('activity-panel').style.order,'-1');
 assert.equal(h.element('stop').hidden,false);
});

test('automatic amounts are editable values, including comments, not placeholders',()=>{
 const h=dashboard();
 for(const [action,amount] of Object.entries({like:'15',follow:'5',comment:'2'})) {
  assert.equal(h.element(`limit-${action}`).value,amount);
  assert.equal(h.element(`limit-${action}`).placeholder,'');
  assert.equal(h.element(`limit-${action}`).disabled,false);
 }
 assert.deepEqual(h.settings().limits,{like:15,follow:5,comment:2});
 assert.deepEqual(h.saved().profiles.instagram.customLimits,{});
});

test('clearing and typing an amount is stable across activity polls',()=>{
 const h=dashboard();vm.runInContext('connection(true)',h.context);
 h.edit('limit-follow','');
 vm.runInContext("render({running:false,message:'ready',activity:[]})",h.context);
 assert.equal(h.element('limit-follow').value,'');
 assert.equal(h.element('start').disabled,true);
 h.edit('limit-follow','0');h.element('limit-follow').listeners.blur();
 assert.equal(h.element('limit-follow').value,'0');
 assert.equal(h.settings().limits.follow,0);
 assert.equal(h.element('start').disabled,false);
 h.edit('limit-follow','12');h.element('limit-follow').listeners.blur();
 assert.equal(h.settings().limits.follow,12);
});

test('an empty amount returns to automatic on blur without treating invalid input as zero',()=>{
 const h=dashboard();
 h.edit('limit-follow','');h.element('limit-follow').listeners.blur();
 assert.equal(h.element('limit-follow').value,'5');
 assert.deepEqual(h.saved().profiles.instagram.customLimits,{});
 h.element('limit-follow').validity={badInput:true};
 h.edit('limit-follow','');h.element('limit-follow').listeners.blur();
 assert.equal(h.element('start').disabled,true);
 assert.equal(h.element('limit-follow').value,'');
 assert.equal(h.element('form-error').hidden,false);
});

test('duration recalculates automatic amounts, preserving typed zero',()=>{
 const h=dashboard();
 h.edit('minutes','20');assert.deepEqual(h.settings().limits,{like:30,follow:9,comment:4});
 h.edit('limit-follow','0');h.element('limit-follow').listeners.blur();
 h.edit('minutes','60');assert.deepEqual(h.settings().limits,{like:90,follow:0,comment:10});
 assert.equal(h.element('limit-follow').value,'0');
 h.element('reset-limits').listeners.click();
 assert.deepEqual(h.settings().limits,{like:90,follow:27,comment:10});
});

test('saved settings retain explicit overrides while automatic amounts keep following duration',()=>{
 const h=dashboard();
 h.edit('limit-comment','0');h.element('limit-comment').listeners.blur();
 const restored=dashboard(false,h.saved());restored.edit('minutes','20');
 assert.deepEqual(restored.settings().limits,{like:30,follow:9,comment:0});
 assert.deepEqual(restored.saved().profiles.instagram.customLimits,{comment:'0'});
 const legacy=dashboard(false,{minutes:'10','limit-like':'5','limit-follow':'','limit-comment':'',enableComments:false});
 assert.deepEqual(legacy.settings().limits,{like:5,follow:5,comment:2});
});

test('comments can be edited directly and zero disables their session weight',()=>{
 const h=dashboard();
 h.edit('limit-comment','3');h.element('limit-comment').listeners.blur();
 assert.equal(h.settings().limits.comment,3);
 h.edit('limit-comment','0');h.element('limit-comment').listeners.blur();
 assert.equal(h.settings().limits.comment,0);assert.equal(h.settings().weights.comment,0);
 h.edit('minutes','120');assert.equal(h.settings().limits.comment,0);
});

test('out-of-range amounts cannot start a session',async()=>{
 const h=dashboard(true);for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));
 for(const value of ['-1','61','1.5']) {
  h.edit('limit-follow',value);
  assert.equal(h.element('start').disabled,true,value);
  await h.element('session-form').listeners.submit({preventDefault(){}});
 }
 assert.equal(h.requests.some(r=>r.type==='start'),false);
});

test('the submitted plan matches the visible automatic and custom amounts',async()=>{
 const h=dashboard(true);for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));
 h.edit('limit-follow','0');h.element('limit-follow').listeners.blur();
 await h.element('session-form').listeners.submit({preventDefault(){}});
 const request=h.requests.find(r=>r.type==='start');
 assert.equal(request.settings.enableComments,true);
 assert.equal(request.settings.customLimits.follow,0);
 assert.deepEqual(h.settings().limits,{like:15,follow:0,comment:2});
 assert.equal(h.element('settings').disabled,true);
});

test('saved tiktok selection opens and starts only instagram with every engagement target available',async()=>{
 const h=dashboard(true,{platform:'tiktok'});for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.element('tab-label').textContent,'instagram tab');
 assert.equal(h.element('open-instagram').textContent,'open instagram ↗');
 assert.equal(h.element('limit-comment').value,'2');
 assert.equal(h.element('limit-comment').disabled,false);
 assert.deepEqual(h.settings().limits,{like:15,follow:5,comment:2});
 assert.equal(h.requests.at(-1).platform,'instagram');
 await h.element('session-form').listeners.submit({preventDefault(){}});
 const request=h.requests.findLast(r=>r.type==='start');
 assert.equal(request.settings.platform,'instagram');
});

test('instagram preferences survive a saved tiktok selection and remain separate',()=>{
 const archived = {niche:'tiktok niche',minutes:'20',customLimits:{follow:'4'}};
 const h=dashboard(false,{version:3,platform:'tiktok',profiles:{instagram:{niche:'instagram niche',minutes:'10',customLimits:{follow:'0',comment:'7'}},tiktok:archived}});
 assert.equal(h.element('niche').value,'instagram niche');
 assert.equal(h.settings().limits.follow,0);assert.equal(h.settings().limits.comment,7);
 assert.deepEqual(h.saved().profiles.tiktok,archived);
 h.edit('minutes','20');
 const reopened=dashboard(false,h.saved());
 assert.equal(reopened.settings().platform,'instagram');
 assert.deepEqual(reopened.settings(),h.settings());
 assert.equal(reopened.settings().limits.follow,0);assert.equal(reopened.settings().limits.comment,7);
});

test('legacy tiktok settings are retained without becoming instagram preferences',()=>{
 const h=dashboard(false,{version:2,platform:'tiktok',niche:'photography',minutes:'15',customLimits:{follow:'0',comment:'2'}});
 assert.equal(h.saved().version,3);
 assert.equal(h.settings().platform,'instagram');
 assert.equal(h.settings().limits.follow,5);
 assert.equal(h.settings().terms[0],'personal branding');assert.equal(h.settings().minutes,10);
 assert.equal(h.saved().profiles.tiktok.niche,'photography');
 assert.deepEqual(h.saved().profiles.tiktok.customLimits,{follow:'0',comment:'2'});
});

test('results keep their actual targets after controls return to the saved draft',()=>{
 const h=dashboard();
 h.edit('limit-follow','0');h.element('limit-follow').listeners.blur();
 h.context.live=publicState({phase:'running',tabId:8,settings:validateSettings({platform:'instagram',niche:'branding',minutes:10,enableComments:true,customLimits:{like:3,follow:2,comment:1}}),stats:{scroll:7,like:3,follow:1,comment:1},unconfirmed:{follow:1},activity:[],message:'watching'});
 vm.runInContext('render(live)',h.context);
 assert.equal(h.element('stat-follow').textContent,'1 / 2');
 assert.equal(h.element('activity-heading').textContent,'instagram session');
 vm.runInContext('render({...live,running:false,phase:"complete"})',h.context);
 assert.equal(h.element('platform').value,'instagram');
 assert.equal(h.element('limit-follow').value,'0');
 assert.equal(h.element('stat-follow').textContent,'1 / 2');
 assert.equal(h.element('stat-comment').textContent,'1 / 1');
 assert.equal(h.element('activity-heading').textContent,'instagram results');
 assert.equal(h.element('session-results-note').textContent,'1 follow not confirmed. targets are upper limits. pacing and matching posts come first.');
 h.edit('minutes','20');
 assert.equal(h.element('stat-follow').textContent,'1 / 2');
});

test('retired mix opt-outs become visible zero targets while pacing becomes automatic',()=>{
 const h=dashboard(false,{version:3,platform:'instagram',profiles:{instagram:{pace:'slow','mix-like':'0',niche:'branding',minutes:'10',customLimits:{comment:'0'}}}});
 assert.equal(h.settings().pace,'auto');
 assert.deepEqual(h.settings().limits,{like:0,follow:5,comment:0});
 assert.equal(h.element('limit-like').value,'0');
 assert.deepEqual(h.settings().weights,{like:0,follow:1,comment:0});
});

const LIMIT_HINT="more than this pace usually fits. the session stops when time runs out, it won't rush.";
test('a custom target above the usual pace shows the plain limit hint',()=>{
 const h=dashboard();
 h.edit('minutes','40');
 assert.equal(h.element('limit-hint').hidden,true);
 h.edit('limit-like','180');h.element('limit-like').listeners.blur();
 assert.equal(h.settings().limits.like,180);
 assert.equal(h.element('limit-hint').hidden,false);
 assert.equal(h.element('limit-hint').textContent,LIMIT_HINT);
 h.element('reset-limits').listeners.click();
 assert.equal(h.element('limit-hint').hidden,true);
 assert.equal(h.element('limit-hint').textContent,'');
});

test('automatic targets never show the limit hint at any session length',()=>{
 for(const minutes of ['1','10','40','120']) {
  const h=dashboard();
  h.edit('minutes',minutes);
  assert.equal(h.element('limit-hint').hidden,true,minutes);
  assert.equal(h.element('limit-hint').textContent,'',minutes);
 }
});

test('invalid settings hide the limit hint',()=>{
 const h=dashboard();
 h.edit('minutes','40');h.edit('limit-like','180');h.element('limit-like').listeners.blur();
 assert.equal(h.element('limit-hint').hidden,false);
 h.edit('minutes','0');
 assert.equal(h.element('limit-hint').hidden,true);
});

test('warm-up markup has no comments toggle, instructional hints or footer links',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
 assert.doesNotMatch(html.slice(html.indexOf('<form id="session-form"')),/enable-comments|class="hint"|pace-help|pacing &amp; engagement mix|id="pace"|id="mix-|how comments work|plan-mode|<footer>|report a problem|>privacy</);
 assert.match(html,/session targets/);
 assert.match(html,/<input id="platform" type="hidden" value="instagram">/);
 assert.doesNotMatch(html,/tiktok|<select id="platform"/i);
 for(const action of ['like','follow','comment']) {
  const tag=html.match(new RegExp(`<input id="limit-${action}"[^>]*>`))[0];
  assert.match(tag,/type="number"/);assert.match(tag,/required/);assert.doesNotMatch(tag,/placeholder|disabled/);
 }
});

test('reopened controls show the running plan and target without replacing their saved draft',async()=>{
 const h=dashboard(true);
 for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));
 h.edit('niche','my next session');h.edit('minutes','20');
 h.edit('limit-comment','0');h.element('limit-comment').listeners.blur();
 const saved=h.saved();
 h.context.live=publicState({phase:'running',tabId:42,settings:validateSettings({niche:'photography, lighting',minutes:2,pace:'slow',enableComments:true,customLimits:{like:3,follow:0,comment:0}}),stats:{scroll:1},activity:[],message:'watching'});
 vm.runInContext('render(live)',h.context);
 assert.equal(h.element('niche').value,'photography, lighting');
 assert.equal(h.element('minutes').value,'2');
 assert.equal(h.element('limit-like').value,'3');assert.equal(h.element('limit-follow').value,'0');assert.equal(h.element('limit-comment').value,'0');
 assert.equal(h.element('instagram-tab').value,'42');
 assert.equal(h.element('settings').disabled,true);
 assert.deepEqual(h.saved(),saved);
 await vm.runInContext('tabs()',h.context);
 vm.runInContext('render({...live,phase:"stopping"})',h.context);
 assert.equal(h.element('instagram-tab').value,'42');assert.equal(h.element('limit-comment').value,'0');
 assert.equal(h.element('instagram-tab').options.filter(o=>o.value==='42').length,1);
 assert.deepEqual(h.saved(),saved);
 vm.runInContext('render({...live,running:false,phase:"stopped"})',h.context);
 assert.equal(h.element('niche').value,'my next session');assert.equal(h.element('minutes').value,'20');
 assert.equal(h.element('instagram-tab').value,'7');assert.equal(h.element('limit-comment').value,'0');
 assert.equal(h.element('settings').disabled,false);assert.deepEqual(h.saved(),saved);
});

test('public running plan excludes runner tokens and unrelated stored data',()=>{
 const settings=validateSettings({niche:'branding',minutes:10,enableComments:true,customLimits:{follow:0,comment:0}});
 const state=publicState({token:'private-token',runnerTabId:90,tabId:7,phase:'running',settings:{...settings,privateData:'not public'},privateData:'not public'});
 assert.deepEqual(state.settings,{platform:'instagram',minutes:10,terms:['branding'],pace:'auto',limits:{like:15,follow:0,comment:0},weights:{like:2,follow:0,comment:0},focus:'balanced'});
 assert.equal(state.tabId,7);assert.equal(state.token,undefined);assert.equal(state.runnerTabId,undefined);
 assert.equal(state.privateData,undefined);assert.equal(state.settings.privateData,undefined);
});

async function settleDashboard() {
  for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve));
}

test('idle discovery finds an instagram tab despite a saved tiktok selection', async () => {
  let availableTabs = [];
  const h = dashboard(true, { platform: 'tiktok' }, (message, data) => message.type === 'tabs' ? availableTabs : data);
  await settleDashboard();
  assert.equal(h.element('connection').textContent, 'connected');
  assert.equal(h.element('instagram-tab').value, '');
  assert.equal(h.element('start').disabled, true);

  availableTabs = [{ id: 8, title: 'Instagram' }];
  await h.poll();
  assert.equal(h.element('instagram-tab').value, '8');
  assert.equal(h.element('start').disabled, false);
  assert.equal(h.requests.at(-1).platform, 'instagram');
  assert.equal(h.requests.some(request => request.type === 'start'), false);
});

test('the open-platform action recovers when its new tab has not loaded yet', async () => {
  for (const platform of ['instagram', 'tiktok']) {
    let availableTabs = [];
    const h = dashboard(true, { platform }, (message, data) => message.type === 'tabs' ? availableTabs : data);
    await settleDashboard();
    await h.element('open-instagram').listeners.click();
    assert.equal(h.requests.find(request => request.type === 'open-platform').platform, 'instagram');
    assert.equal(h.element('start').disabled, true);
    availableTabs = [{ id: 12, title: 'instagram' }];
    await h.poll();
    assert.equal(h.element('instagram-tab').value, '12');
    assert.equal(h.element('start').disabled, false);
  }
});

test('idle discovery preserves an explicit choice and never silently replaces a closed selected tab', async () => {
  let availableTabs = [{ id: 8, title: 'Instagram one' }, { id: 9, title: 'Instagram two' }];
  const h = dashboard(true, { platform: 'tiktok' }, (message, data) => message.type === 'tabs' ? availableTabs : data);
  await settleDashboard();
  assert.equal(h.element('instagram-tab').value, '');
  h.element('instagram-tab').value = '9';
  h.element('instagram-tab').listeners.change();
  const unchangedOptions = h.element('instagram-tab').options;
  await h.poll();
  assert.equal(h.element('instagram-tab').options, unchangedOptions);
  availableTabs = [...availableTabs, { id: 10, title: 'Instagram three' }];
  await h.poll();
  assert.equal(h.element('instagram-tab').value, '9');
  availableTabs = [{ id: 8, title: 'Instagram one' }];
  await h.poll();
  await h.poll();
  assert.equal(h.element('instagram-tab').value, '');
  assert.equal(h.element('start').disabled, true);
});

test('rapid refreshes discard older discovery responses', async () => {
  const pendingTabs = [];
  let defer = false;
  const h = dashboard(true, null, (message, data) => {
    if (message.type === 'tabs' && defer) return new Promise(resolve => pendingTabs.push({ platform: message.platform, resolve }));
    return data;
  });
  await settleDashboard();
  defer = true;
  for (let attempt = 0; attempt < 3; attempt++) h.element('refresh-tabs').listeners.click();
  assert.deepEqual(pendingTabs.map(request => request.platform), ['instagram', 'instagram', 'instagram']);
  pendingTabs[2].resolve([{ id: 7, title: 'new Instagram' }]);
  await settleDashboard();
  pendingTabs[1].resolve([{ id: 8, title: 'earlier Instagram' }]);
  pendingTabs[0].resolve([{ id: 9, title: 'old Instagram' }]);
  await settleDashboard();
  assert.equal(h.element('instagram-tab').value, '7');
  assert.deepEqual(Array.from(h.element('instagram-tab').options, option => option.value), ['', '7']);
  assert.equal(h.element('start').disabled, false);
});

test('tab responses arriving after disconnect cannot repopulate or enable the panel', async () => {
  let resolveTabs;
  let defer = false;
  const h = dashboard(true, null, (message, data) => message.type === 'tabs' && defer ? new Promise(resolve => { resolveTabs = resolve; }) : data);
  await settleDashboard();
  defer = true;
  const refresh = h.element('refresh-tabs').listeners.click();
  const optionsBefore = h.element('instagram-tab').options;
  vm.runInContext('connection(false)', h.context);
  resolveTabs([{ id: 12, title: 'new Instagram' }]);
  await refresh;
  assert.equal(h.element('instagram-tab').options, optionsBefore);
  assert.equal(h.element('connection').textContent, 'extension needed');
  assert.equal(h.element('start').disabled, true);
});

test('active sessions retain their exact tab and do not poll discovery', async () => {
  let resolveTabs;
  let defer = false;
  let liveState = null;
  const h = dashboard(true, null, (message, data) => {
    if (message.type === 'tabs' && defer) return new Promise(resolve => { resolveTabs = resolve; });
    return message.type === 'state' && liveState ? liveState : data;
  });
  await settleDashboard();
  defer = true;
  const refresh = h.element('refresh-tabs').listeners.click();
  liveState = publicState({ phase: 'running', tabId: 42, settings: validateSettings({ platform: 'instagram', niche: 'branding', minutes: 10 }), activity: [], message: 'watching' });
  h.context.liveState = liveState;
  vm.runInContext('render(liveState)', h.context);
  resolveTabs([{ id: 12, title: 'Instagram' }]);
  await refresh;
  const discoveryCount = h.requests.filter(request => request.type === 'tabs').length;
  await h.poll();
  assert.equal(h.requests.filter(request => request.type === 'tabs').length, discoveryCount);
  assert.equal(h.element('instagram-tab').value, '42');
  assert.equal(h.element('platform').value, 'instagram');
  assert.equal(h.element('start').disabled, true);
});

test('a transient discovery failure stays connected and recovers on the next idle poll', async () => {
  let failed = true;
  const h = dashboard(true, { platform: 'tiktok' }, (message, data) => {
    if (message.type === 'tabs' && failed) throw new Error('could not list tabs');
    return data;
  });
  await settleDashboard();
  assert.equal(h.element('connection').textContent, 'connected');
  assert.equal(h.element('form-error').textContent, 'could not list tabs');
  await h.poll();
  assert.equal(h.element('connection').textContent, 'connected');
  failed = false;
  await h.poll();
  assert.equal(h.element('instagram-tab').value, '7');
  assert.equal(h.element('start').disabled, false);
  assert.equal(h.element('form-error').hidden, true);
});
