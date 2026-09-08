const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function dashboard(panel = false, saved = null) {
  const requests = [];
  const nodes = new Map();
  let stored = saved === null ? null : JSON.stringify(saved);
  const defaults = { niche:'personal branding', minutes:'10', pace:'auto', 'mix-like':'2', 'mix-follow':'1', 'mix-comment':'1', 'instagram-tab':'7' };
  const element = id => {
    if (!nodes.has(id)) nodes.set(id,{ value:defaults[id] || '', checked:false, textContent:'', hidden:false, disabled:false, placeholder:'', dataset:{}, style:{}, listeners:{}, classList:{toggle(){}}, addEventListener(type,fn){this.listeners[type]=fn}, replaceChildren(){}, append(){} });
    return nodes.get(id);
  };
  const context=vm.createContext({ document:{getElementById:element,body:{classList:{toggle(){}}},createElement:()=>element('new')}, window:{addEventListener(){},postMessage(){}}, location:panel?{protocol:'chrome-extension:',pathname:'/sidepanel.html',origin:'chrome-extension://extension-id'}:{origin:'https://creator-collective-warmup.vercel.app'}, chrome:{runtime:{sendMessage:async message=>{requests.push(message);return {ok:true,data:message.type==='hello'?{state:{running:false,message:'ready',activity:[]}}:message.type==='tabs'?[{id:7,title:'instagram'}]:message.type==='start'?{running:true,message:'started',activity:[]}:null}}}}, crypto:{randomUUID:()=> 'id'}, localStorage:{getItem:()=>stored,setItem(key,value){stored=value}}, setTimeout:()=>1,clearTimeout(){},setInterval(){},Option:function(){},console });
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../plan.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../dashboard.js'),'utf8'),context);
  return {context,element,requests,saved:()=>JSON.parse(stored),edit(id,value){element(id).value=value;element(id).listeners.input()},settings:()=>JSON.parse(vm.runInContext('JSON.stringify(sessionPlan.validateSettings(input()))',context))};
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
 for(const [action,amount] of Object.entries({like:'10',follow:'2',comment:'1'})) {
  assert.equal(h.element(`limit-${action}`).value,amount);
  assert.equal(h.element(`limit-${action}`).placeholder,'');
  assert.equal(h.element(`limit-${action}`).disabled,false);
 }
 assert.deepEqual(h.settings().limits,{like:10,follow:2,comment:1});
 assert.deepEqual(h.saved().customLimits,{});
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
 assert.equal(h.element('limit-follow').value,'2');
 assert.deepEqual(h.saved().customLimits,{});
 h.element('limit-follow').validity={badInput:true};
 h.edit('limit-follow','');h.element('limit-follow').listeners.blur();
 assert.equal(h.element('start').disabled,true);
 assert.equal(h.element('limit-follow').value,'');
 assert.equal(h.element('form-error').hidden,false);
});

test('duration and pacing recalculate only automatic amounts, preserving typed zero',()=>{
 const h=dashboard();
 h.edit('minutes','20');assert.deepEqual(h.settings().limits,{like:20,follow:4,comment:2});
 h.edit('limit-follow','0');h.element('limit-follow').listeners.blur();
 h.edit('pace','slow');assert.deepEqual(h.settings().limits,{like:10,follow:0,comment:1});
 h.edit('minutes','60');assert.deepEqual(h.settings().limits,{like:30,follow:0,comment:3});
 assert.equal(h.element('limit-follow').value,'0');
 h.element('reset-limits').listeners.click();
 assert.deepEqual(h.settings().limits,{like:30,follow:6,comment:3});
});

test('saved settings retain explicit overrides while automatic amounts keep following duration',()=>{
 const h=dashboard();
 h.edit('limit-comment','0');h.element('limit-comment').listeners.blur();
 const restored=dashboard(false,h.saved());restored.edit('minutes','20');
 assert.deepEqual(restored.settings().limits,{like:20,follow:4,comment:0});
 assert.deepEqual(restored.saved().customLimits,{comment:'0'});
 const legacy=dashboard(false,{minutes:'10','limit-like':'5','limit-follow':'','limit-comment':'',enableComments:false});
 assert.deepEqual(legacy.settings().limits,{like:5,follow:2,comment:1});
});

test('comments can be edited directly and zero disables their session weight',()=>{
 const h=dashboard();
 h.edit('limit-comment','3');h.element('limit-comment').listeners.blur();
 assert.equal(h.settings().limits.comment,3);
 h.edit('limit-comment','0');h.element('limit-comment').listeners.blur();
 assert.equal(h.settings().limits.comment,0);assert.equal(h.settings().weights.comment,0);
 h.edit('minutes','120');assert.equal(h.settings().limits.comment,0);
});

test('out-of-range amounts and blank mix fields cannot start a session',async()=>{
 const h=dashboard(true);for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));
 for(const value of ['-1','13','1.5']) {
  h.edit('limit-follow',value);
  assert.equal(h.element('start').disabled,true,value);
  await h.element('session-form').listeners.submit({preventDefault(){}});
 }
 assert.equal(h.requests.some(r=>r.type==='start'),false);
 h.element('reset-limits').listeners.click();h.edit('mix-comment','');
 assert.equal(h.element('start').disabled,true);
});

test('the submitted plan matches the visible automatic and custom amounts',async()=>{
 const h=dashboard(true);for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));
 h.edit('limit-follow','0');h.element('limit-follow').listeners.blur();
 await h.element('session-form').listeners.submit({preventDefault(){}});
 const request=h.requests.find(r=>r.type==='start');
 assert.equal(request.settings.enableComments,true);
 assert.equal(request.settings.customLimits.follow,0);
 assert.deepEqual(h.settings().limits,{like:10,follow:0,comment:1});
 assert.equal(h.element('settings').disabled,true);
});

test('engagement mix still controls actions and reset restores its default values',()=>{
 const h=dashboard();
 h.edit('mix-comment','0');assert.equal(h.element('limit-comment').value,'0');
 assert.equal(h.settings().limits.comment,0);
 h.element('reset-mix').listeners.click();assert.equal(h.element('limit-comment').value,'1');
 assert.deepEqual(h.settings().weights,{like:2,follow:1,comment:1});
});

test('warm-up markup has no comments toggle, instructional hints or footer links',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
 assert.doesNotMatch(html,/enable-comments|class="hint"|pace-help|how comments work|plan-mode|<footer>|report a problem|>privacy</);
 for(const action of ['like','follow','comment']) {
  const tag=html.match(new RegExp(`<input id="limit-${action}"[^>]*>`))[0];
  assert.match(tag,/type="number"/);assert.match(tag,/required/);assert.doesNotMatch(tag,/placeholder|disabled/);
 }
});
