const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function dashboard(panel = false) {
  const requests = [];
  const nodes = new Map();
  const defaults = { niche:'personal branding', minutes:'10', pace:'auto', 'mix-like':'2', 'mix-follow':'1', 'mix-comment':'1', 'instagram-tab':'7' };
  const element = id => {
    if (!nodes.has(id)) nodes.set(id,{ value:defaults[id] || '', checked:false, textContent:'', hidden:false, disabled:false, placeholder:'', dataset:{}, style:{}, listeners:{}, classList:{toggle(){}}, addEventListener(type,fn){this.listeners[type]=fn}, replaceChildren(){}, append(){} });
    return nodes.get(id);
  };
  const context=vm.createContext({ document:{getElementById:element,body:{classList:{toggle(){}}},createElement:()=>element('new')}, window:{addEventListener(){},postMessage(){}}, location:panel?{protocol:'chrome-extension:',pathname:'/sidepanel.html',origin:'chrome-extension://extension-id'}:{origin:'https://creator-collective-warmup.vercel.app'}, chrome:{runtime:{sendMessage:async message=>{requests.push(message);return {ok:true,data:message.type==='hello'?{state:{running:false,message:'ready',activity:[]}}:message.type==='tabs'?[{id:7,title:'instagram'}]:null}}}}, crypto:{randomUUID:()=> 'id'}, localStorage:{getItem:()=>null,setItem(){}}, setTimeout:()=>1,clearTimeout(){},setInterval(){},Option:function(){},console });
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../plan.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../dashboard.js'),'utf8'),context);
  return {context,element,requests};
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
