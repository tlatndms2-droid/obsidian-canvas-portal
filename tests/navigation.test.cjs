const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const box={module:{exports:{}},require:n=>n==='obsidian'?{Plugin:class{},PluginSettingTab:class{},Modal:class{}}:require(path.join(__dirname,'../src',n))};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/main.cjs'),'utf8'),box);
const p=Object.create(box.module.exports.prototype);
test('capture copies visible data without serializing the hidden registry',()=>{
 let serialized=0;
 const meta={version:1,canvasId:'c',portals:{hidden:{id:'hidden',parentId:null,graph:{nodes:[],edges:[]}}},toJSON(){serialized++;return {};}};
 const data={nodes:[{id:'entry',type:'text',text:'Name',canvasPortalRef:{id:'hidden',role:'entry'}}],edges:[],canvasPortal:meta};
 meta.portals.hidden.name='Name';meta.portals.hidden.displayId='P-01';
 const s={c:{getData:()=>data},root:{...data},archives:new Map(),current:null};
 p.capture(s);
 assert.equal(serialized,0);assert.equal(s.root.canvasPortal,meta);
 assert.notEqual(s.root.nodes,data.nodes);assert.notEqual(s.root.nodes[0],data.nodes[0]);
});
test('steady decoration does not inspect ordinary cards again; additions are bound when dirty',()=>{
 let reads=0;const n={id:'n',getData:()=>{reads++;return {id:'n',type:'text'};},showMenu(){}};
 const s={c:{nodes:new Map([['n',n]])},nodesDirty:true,portalNodes:new Set(),menuUndos:new Map(),nodeUndos:new Map()};
 p.decorate(s);assert.equal(reads,1);assert.equal(s.menuUndos.size,1);
 p.decorate(s);p.decorate(s);assert.equal(reads,1);
 s.c.nodes.clear();s.nodesDirty=true;p.decorate(s);assert.equal(s.menuUndos.size,0);assert.equal(s.portalNodes.size,0);
});
test('replaced portal records release stale bindings even when native node identity is unchanged',()=>{
 let restored=0;const old={},current={},n={id:'n',getData:()=>({canvasPortalRef:{id:'p',role:'entry'}})};
 const restore=()=>restored++;restore.record=old;restore.role='entry';
 const s={c:{nodes:new Map([['n',n]])},root:{canvasPortal:{portals:{p:current}}},nodesDirty:false,portalNodes:new Set(),menuUndos:new Map(),nodeUndos:new Map([[n,restore]])};
 p.decorate(s);assert.equal(restored,1);assert.equal(s.nodeUndos.size,0);
});
const node=(id,role)=>({id,getData:()=>({canvasPortalRef:role?{id:'p',role}:undefined})});
const ordinary=node('ordinary'),entry=node('entry','entry'),exit=node('exit','exit');
const session=(selected=[],extra={})=>({c:{selection:new Set(selected),nodes:new Map([ordinary,entry,exit].map(n=>[n.id,n]))},root:{canvasPortal:{portals:{p:{}}}},current:null,...extra});
test('navigation follows a single selected portal; otherwise exits only from an inner space',()=>{
 assert.equal(p.navigationAction(session()),null);
 assert.equal(p.navigationAction(session([ordinary])),null);
 assert.equal(p.navigationAction(session([entry])).portal.role,'entry');
 assert.equal(p.navigationAction(session([exit],{current:'p'})).portal.role,'exit');
 for(const selection of [[],[ordinary]]){
  assert.equal(p.navigationAction(session(selection,{current:'p'})).back,'virtual');
  assert.equal(p.navigationAction(session(selection,{linkBack:{id:'p'}})).back,'link');
 }
 assert.equal(p.navigationAction(session([],{current:'nested',linkBack:{id:'p'}})).back,'virtual');
 assert.equal(p.navigationAction(session([entry,ordinary],{current:'p'})),null);
 assert.equal(p.navigationAction(session([entry,exit],{current:'p'})),null);
 assert.equal(p.navigationAction(session([],{current:'p',busy:true})),null);
 assert.equal(p.navigationAction(session([],{current:'p',preview:{}})),null);
});

test('one physical keydown cannot leave and re-enter, even after the first transition finishes',async()=>{
 const plugin=Object.create(box.module.exports.prototype),calls=[];
 const event={type:'keydown'},s={c:{wrapperEl:{ownerDocument:{defaultView:{event}}}}};
 plugin.leave=async()=>{calls.push('leave');};
 plugin.transition=()=>calls.push('enter');
 await plugin.navigate(s,{back:'virtual'});
 plugin.navigate(s,{portal:{role:'entry'}},event);
 assert.deepEqual(calls,['leave']);
 plugin.navigate(s,{portal:{role:'entry'}},{type:'keydown'});
 assert.deepEqual(calls,['leave','enter']);
 // Non-keyboard command invocations must remain independent.
 s.c.wrapperEl.ownerDocument.defaultView.event=undefined;
 await plugin.navigate(s,{back:'virtual'});await plugin.navigate(s,{back:'virtual'});
 assert.deepEqual(calls,['leave','enter','leave','leave']);
});

test('entry selects the leftmost card, breaks ties upward, and excludes exits and group frames',()=>{
 const card=(id,x,y,type='text',role)=>({id,x,y,getData:()=>({id,x,y,type,canvasPortalRef:role?{id:'p',role}:undefined})});
 const cards=[card('right',30,0),card('lower',-20,50),card('upper',-20,-50),card('exit',-100,-100,'text','exit'),card('group',-200,-200,'group')];
 let selected;
 const s={c:{nodes:new Map(cards.map(n=>[n.id,n])),selectOnly:n=>selected=n.id,deselectAll:()=>selected=null}};
 p.selectLeftmostCard(s);assert.equal(selected,'upper');
 const nested=card('nested',-30,0,'text','entry');s.c.nodes.set(nested.id,nested);
 p.selectLeftmostCard(s);assert.equal(selected,'nested');
 s.c.nodes=new Map(cards.slice(3).map(n=>[n.id,n]));p.selectLeftmostCard(s);assert.equal(selected,null);
});
