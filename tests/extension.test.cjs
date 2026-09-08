const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const root = path.resolve(__dirname,'..');
const extension = path.join(root,'browser-extension');
const { instagramURL, dashboardSender, panelSender, runnerSender, publicState } = require('../browser-extension/guards.js');
const origin = 'https://creator-collective-warmup.vercel.app';
const sender = { id:'extension-id',url:origin+'/',frameId:0,tab:{id:2} };
const event = () => ({listeners:[],addListener(fn){this.listeners.push(fn)}});
function background(initial) {
  let job = initial;
  const created = [];
  const chrome = {sidePanel:{setPanelBehavior:async()=>{}},runtime:{id:'extension-id',getURL:p=>`chrome-extension://extension-id/${p.replace(/^\//,'')}`,getManifest:()=>({version:'0.4.2'}),onMessage:event()}, storage:{session:{get:async()=>({job:structuredClone(job)}),set:async value=>{job=structuredClone(value.job)}}},tabs:{query:async()=>[{id:7,title:'instagram',url:'https://www.instagram.com/'}],get:async id=>({id,url:'https://www.instagram.com/',windowId:1}),create:async options=>{created.push(options);return {id:90}},update:async()=>({}),onRemoved:event(),onUpdated:event()},action:{onClicked:event()},windows:{update:async()=>{}}};
  const ctx=vm.createContext({chrome,console,URL,crypto:webcrypto,structuredClone});
  ctx.importScripts=(...files)=>files.forEach(file=>vm.runInContext(fs.readFileSync(path.join(extension,file),'utf8'),ctx));
  vm.runInContext(fs.readFileSync(path.join(extension,'background.js'),'utf8'),ctx);
  const message=(request,source=sender)=>new Promise(resolve=>{const accepted=chrome.runtime.onMessage.listeners[0](request,source,resolve);if(!accepted)resolve(undefined)});
  return {message,created,chrome,job:()=>job};
}
test('only exact dashboard origin, top frame and intended Instagram hosts are accepted',()=>{
 assert.equal(dashboardSender(sender),true);
 for(const url of ['https://evil.example/','https://creator-collective-warmup.vercel.app.evil.example/','http://creator-collective-warmup.vercel.app/'])assert.equal(dashboardSender({...sender,url}),false);
 assert.equal(dashboardSender({...sender,frameId:1}),false);
 for(const url of ['http://www.instagram.com/','https://instagram.com.evil.example/','https://user:pass@instagram.com/','file:///tmp/test'])assert.equal(instagramURL(url),false);
 assert.equal(instagramURL('https://www.instagram.com/p/abc/'),true);
 assert.equal(runnerSender({url:'chrome-extension://evil/runner.html#x',tab:{id:9}},{runnerTabId:9,token:'x'},'chrome-extension://extension-id/'),false);
});
test('manifest limits permissions and contains no remote code or cookie access',()=>{
 const manifest=JSON.parse(fs.readFileSync(path.join(extension,'manifest.json')));
 assert.deepEqual(manifest.permissions,['storage','scripting','sidePanel']);
 assert.deepEqual(manifest.content_scripts[0].matches,[origin+'/*']);
 assert.equal(manifest.content_scripts[0].all_frames,false);
 for(const file of ['plan.js','session.js','guards.js'])new vm.Script(fs.readFileSync(path.join(extension,file),'utf8'));
 const ctx=vm.createContext({setTimeout,clearTimeout,AbortController});
 for(const file of ['plan.js','session.js'])vm.runInContext(fs.readFileSync(path.join(extension,file),'utf8'),ctx);
 assert.equal(typeof ctx.sessionEngine.runSession,'function');
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
 const node=()=>({textContent:'',disabled:false,addEventListener(){},replaceChildren(){},append(){},click(){},classList:{toggle(){}}});
 const ctx=vm.createContext({chrome,URL,console,setTimeout,clearTimeout,setInterval,clearInterval,AbortController,Date,location:{hash:'#test-token'},instagramURL,document:{getElementById:id=>{if(!elements.has(id))elements.set(id,node());return elements.get(id)},createElement:node,body:{classList:{toggle(){}}},addEventListener(){}},sessionEngine:{runSession:operation || (async()=>{})}});
 return {ctx,calls,chrome,job,elements,start(){vm.runInContext(fs.readFileSync(path.join(extension,'runner.js'),'utf8'),ctx)}};
}
const settle=async()=>{for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve))};
test('runner does not pass AbortSignal into Chrome script arguments',async()=>{
 const h=runnerContext('starting',async(settings,adapter,signal)=>{await adapter.inspect(signal)});
 h.start();await settle();
 const injections=h.calls.filter(x=>x.injection).map(x=>x.injection);
 assert.equal(injections.length,2);
 assert.deepEqual(JSON.parse(JSON.stringify(injections[1].args)),[{}]);
 assert.ok(h.calls.some(x=>x.patch?.phase==='complete'));
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
