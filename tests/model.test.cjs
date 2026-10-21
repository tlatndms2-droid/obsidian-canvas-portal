const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../src/model.cjs');
const data = () => ({ nodes: [
  { id:'a', type:'text', text:'A', x:0,y:0,width:200,height:100 },
  { id:'b', type:'text', text:'B', x:300,y:120,width:200,height:100 },
  { id:'out', type:'file', file:'원본.md', x:800,y:0,width:200,height:100 }
], edges:[{id:'inside',fromNode:'a',toNode:'b'},{id:'external',fromNode:'out',toNode:'a'}] });
test('delete removes nested records and incident edges while keeping unrelated file references',()=>{
  const child=M.createSelect(data(),['a','b'],'child'),outer=M.createSelect(child.root,[child.entryId],'outer');
  const before=JSON.stringify(outer.root),result=M.deletePortals(outer.root,[outer.portalId]);
  assert.deepEqual(result.root.nodes.map(n=>n.file),['원본.md']);assert.equal(result.root.edges.length,0);
  assert.equal(Object.keys(result.root.canvasPortal.portals).length,0);assert.equal(JSON.stringify(outer.root),before);
});
test('move retains subtree and internal lines but drops every line outside selected portals',()=>{
  const a=M.createSelect(data(),['a','b'],'A'),b=M.createSelect(a.root,['out'],'B');
  const internal=M.clone(b.root.canvasPortal.portals[a.portalId].graph);
  const moved=M.movePortals(b.root,[a.portalId],null,b.portalId);
  assert.equal(moved.root.nodes.length,1);assert.equal(moved.root.edges.length,0);
  assert.deepEqual(moved.root.canvasPortal.portals[a.portalId].graph,internal);
  assert.equal(moved.root.canvasPortal.portals[a.portalId].parentId,b.portalId);
  const dest=moved.root.canvasPortal.portals[b.portalId].graph,entry=dest.nodes.find(n=>n.id===a.entryId);
  assert.ok(dest.nodes.filter(n=>n!==entry).every(n=>!M.overlaps(n,entry)));
  assert.throws(()=>M.movePortals(b.root,[a.portalId],null,a.portalId),/자기 자신/);
  assert.throws(()=>M.movePortals(moved.root,[b.portalId],null,a.portalId),/하위 포탈/);
});
test('cross-file multi move remaps colliding IDs, preserves nested file cards, and removes source entries',()=>{
  const a=M.createSelect(data(),['a','b'],'A'),b=M.createSelect(a.root,['out'],'B');
  const target=M.clone(b.root),moved=M.movePortals(b.root,[a.portalId,b.portalId],null,null,target);
  assert.equal(moved.root.nodes.length,0);assert.equal(Object.keys(moved.root.canvasPortal.portals).length,0);
  assert.equal(moved.target.nodes.length,4);assert.equal(Object.keys(moved.target.canvasPortal.portals).length,4);
  for(const n of moved.nodes)assert.ok(!target.nodes.some(old=>old.id===n.id));
  assert.equal(Object.values(moved.target.canvasPortal.portals).filter(p=>p.graph.nodes.some(n=>n.file==='원본.md')).length,2);
  assert.deepEqual(target,b.root);M.validate(moved.target);
});
test('deleting a Link never follows or edits the referenced Canvas, and exit IDs cannot be ordinary deletions',()=>{
  const input=data();input.nodes.push({id:'link',type:'file',file:'linked.canvas',x:1400,y:0,width:200,height:100});
  const link=M.createPortal(input,['link'],'link'),p=link.root.canvasPortal.portals[link.portalId];
  const deleted=M.deletePortals(link.root,[p.id],null,['a']);
  assert.deepEqual(deleted.root.nodes.map(n=>n.id),['b','out']);assert.equal(deleted.root.edges.length,0);
  assert.equal(input.nodes.find(n=>n.id==='link').file,'linked.canvas');
  assert.throws(()=>M.deletePortals(link.root,[p.id],p.id),/위치/);
});
test('select moves nodes, preserves relative layout and rewires only external edges',()=>{
  const input=data(), initial=JSON.stringify(input); const {root,portalId,entryId}=M.createSelect(input,['a','b'],'자료');
  const p=root.canvasPortal.portals[portalId]; M.validate(root);
  assert.equal(JSON.stringify(input),initial);
  assert.equal(root.nodes.length,2); assert.equal(p.graph.nodes.length,3);
  assert.equal(p.graph.edges[0].id,'inside'); assert.equal(root.edges[0].toNode,entryId);
  assert.equal(p.graph.nodes[1].x-p.graph.nodes[0].x,300);
  assert.equal(root.nodes.find(n=>n.id===entryId).x,110);
});
test('IDs independent of names, numbering unique, file references unchanged',()=>{
  const one=M.createSelect(data(),['a'],'동일 이름');
  const two=M.createSelect(one.root,['out'],'동일 이름');
  const a=two.root.canvasPortal.portals[one.portalId],b=two.root.canvasPortal.portals[two.portalId];
  assert.notEqual(a.id,b.id); assert.equal(a.displayId,'P-01'); assert.equal(b.displayId,'P-02');
  assert.equal(b.graph.nodes[0].file,'원본.md'); M.validate(two.root);
});
test('empty selection fails, existing portal can be wrapped without changing input',()=>{
  assert.throws(()=>M.createSelect(data(),[],'x'));
  const one=M.createSelect(data(),['a'],'x');const saved=JSON.stringify(one.root);
  const nested=M.createSelect(one.root,[one.entryId],'상위');assert.equal(JSON.stringify(one.root),saved);
  assert.equal(nested.root.canvasPortal.portals[one.portalId].parentId,nested.portalId);M.validate(nested.root);
});
test('Group becomes the entry, current content restores in a sized group, empty group stays',()=>{
  const input=data();input.nodes.push({id:'group',type:'group',label:'그룹',x:-20,y:-20,width:550,height:280});
  const result=M.createPortal(input,['group'],'그룹 포탈');const p=result.root.canvasPortal.portals[result.portalId];assert.equal(p.type,'group');assert.equal(result.entryId,'group');assert.equal(p.graph.nodes.length,3);
  p.graph.nodes.find(n=>n.id==='b').x=900;
  const restored=M.unportal(result.root,[p.id]);const g=restored.root.nodes.find(n=>n.id==='group');assert.equal(g.type,'group');assert.ok(g.width>1000);assert.equal(restored.root.nodes.find(n=>n.id==='b').x,900);
  const empty=M.createPortal({nodes:[{id:'g',type:'group',label:'빈 그룹',x:0,y:0,width:400,height:300}],edges:[]},['g'],'빈 그룹');const out=M.unportal(empty.root,[empty.portalId]);assert.equal(out.root.nodes[0].type,'group');assert.equal(out.root.nodes.length,1);
});
test('Link keeps the same entry identity and file reference, stores only its exit, detach keeps current geometry',()=>{
  const input={nodes:[{id:'link',type:'file',file:'자료.canvas',x:10,y:20,width:300,height:200}],edges:[]};
  const result=M.createPortal(input,['link'],'자료');const p=result.root.canvasPortal.portals[result.portalId];assert.equal(p.type,'link');assert.equal(p.target,'자료.canvas');assert.equal(p.graph.nodes.length,1);assert.equal(result.entryId,'link');
  result.root.nodes[0].x=700;const out=M.unportal(result.root,[p.id]);assert.equal(out.root.nodes[0].file,'자료.canvas');assert.equal(out.root.nodes[0].x,700);assert.deepEqual(input.nodes[0],{id:'link',type:'file',file:'자료.canvas',x:10,y:20,width:300,height:200});
});
test('nested clone remaps portals and edges independently, Markdown source remains shared',()=>{
  const child=M.createSelect(data(),['a','b'],'하위');const upper=M.createPortal(child.root,[child.entryId,'out'],'상위');const copied=M.clonePortal(upper.root,upper.portalId);M.validate(copied.root);
  const newParent=copied.root.canvasPortal.portals[copied.portalId],newEntry=newParent.graph.nodes.find(n=>M.ref(n)?.role==='entry'),newChild=copied.root.canvasPortal.portals[M.ref(newEntry).id];assert.notEqual(newChild.id,child.portalId);assert.notEqual(newChild.graph.nodes[0].id,'a');assert.equal(newParent.graph.nodes.find(n=>n.type==='file').file,'원본.md');newChild.graph.nodes[0].text='복제만 수정';assert.equal(copied.root.canvasPortal.portals[child.portalId].graph.nodes[0].text,'A');
  const out=M.unportal(upper.root,[upper.portalId]);assert.ok(out.root.nodes.some(n=>M.ref(n)?.id===child.portalId));assert.equal(out.root.canvasPortal.portals[child.portalId].parentId,null);
});
test('current contents restore with relative placement, external entry edges disappear, cancel input is immutable',()=>{
  const result=M.createSelect(data(),['a','b'],'자료'),before=JSON.stringify(result.root),p=result.root.canvasPortal.portals[result.portalId];p.graph.nodes.push({id:'new',type:'text',text:'추가',x:800,y:300,width:200,height:100});
  const saved=JSON.stringify(result.root);const out=M.unportal(result.root,[p.id],null,{x:100,y:200});assert.equal(JSON.stringify(result.root),saved);assert.equal(out.root.nodes.find(n=>n.id==='new').x,900);assert.equal(out.root.nodes.find(n=>n.id==='b').x-out.root.nodes.find(n=>n.id==='a').x,300);assert.equal(out.root.edges.some(e=>e.id==='external'),false);assert.equal(out.root.edges.some(e=>e.id==='inside'),true);assert.notEqual(before,saved);
});
test('cross-Canvas portal paste copies the subtree, not its source files',()=>{
  const source=M.createSelect(data(),['a','b'],'자료'),p=source.root.canvasPortal.portals[source.portalId],entry=source.root.nodes.find(n=>n.id===p.entryId);
  const out=M.pasteTransfer({nodes:[],edges:[]},{nodes:[entry],edges:[],canvasPortalTransfer:{version:1,portals:source.root.canvasPortal.portals}},null,{x:10,y:20});assert.notEqual(out.nodes[0].canvasPortalRef.id,p.id);assert.equal(out.nodes[0].x,entry.x+10);M.validate(out.root);
});
test('Link clone keeps its source path and gives its temporary exit independent identity and geometry',()=>{
  const result=M.createPortal({nodes:[{id:'f',type:'file',file:'원본.canvas',x:0,y:0,width:300,height:200}],edges:[]},['f'],'연결');const copy=M.clonePortal(result.root,result.portalId),a=copy.root.canvasPortal.portals[result.portalId],b=copy.root.canvasPortal.portals[copy.portalId];assert.equal(b.target,a.target);assert.equal(b.originalEntry.file,'원본.canvas');assert.notEqual(b.exitId,a.exitId);b.graph.nodes[0].x=999;assert.notEqual(a.graph.nodes[0].x,999);assert.equal(b.graph.nodes.length,1);M.validate(copy.root);
});
test('selected spatial group includes contained nodes and group itself',()=>{
  const input=data();input.nodes.push({id:'g',type:'group',x:-10,y:-10,width:220,height:120,label:'G'});
  const {root,portalId}=M.createSelect(input,['g'],'그룹 자료');
  assert.ok(root.canvasPortal.portals[portalId].graph.nodes.some(n=>n.id==='a'));
  assert.ok(root.canvasPortal.portals[portalId].graph.nodes.some(n=>n.id==='g')); M.validate(root);
});
test('saved JSON roundtrip retains exit and ordinary file references',()=>{
  const {root}=M.createSelect(data(),['a','b'],'자료');const loaded=M.rootData(JSON.parse(JSON.stringify(root)));
  M.validate(loaded);assert.deepEqual(loaded,root);
});
test('version mismatch and missing exit rejected',()=>{
  assert.throws(()=>M.rootData({nodes:[],edges:[],canvasPortal:{version:99}}));
  const {root,portalId}=M.createSelect(data(),['a'],'x');root.canvasPortal.portals[portalId].graph.nodes.pop();assert.throws(()=>M.validate(root));
});

test('Link file rename preserves editable text and updates nested clone and detach references',()=>{
  const made=M.createPortal({nodes:[{id:'f',type:'file',file:'폴더/회의.canvas',x:0,y:0,width:300,height:200}],edges:[]},['f'],'임의 이름');
  assert.equal(made.root.canvasPortal.portals[made.portalId].name,'회의');
  const copy=M.clonePortal(made.root,made.portalId),wrapped=M.createPortal(copy.root,[made.entryId,copy.entryId],'상위');
  assert.equal(M.syncLinkNames(wrapped.root,'폴더/회의.canvas','폴더/변경.canvas'),true);
  for(const id of [made.portalId,copy.portalId]){const p=wrapped.root.canvasPortal.portals[id];assert.equal(p.name,'회의');assert.equal(p.originalEntry.file,'폴더/변경.canvas');assert.ok(p.graph.nodes[0].text.startsWith('회의'));assert.equal(M.restoreItems(wrapped.root,id).nodes[0].file,'폴더/변경.canvas');}
  assert.equal(M.syncLinkNames(wrapped.root),false);M.validate(wrapped.root);
});
test('renaming a referenced folder updates hidden file cards without renaming portal text',()=>{
  const base={nodes:[{id:'md',type:'file',file:'자료/노트.md',x:0,y:0,width:240,height:140}],edges:[]};
  const result=M.createPortal(base,['md'],'내 포탈');
  assert.equal(M.syncLinkNames(result.root,'자료','이동/자료'),true);
  const p=Object.values(result.root.canvasPortal.portals)[0];
  assert.equal(p.graph.nodes.find(n=>n.id==='md').file,'이동/자료/노트.md');
  assert.equal(p.name,'내 포탈');
});

test('Group name comes from its label, including nested groups and unnamed fallback',()=>{
  for(const label of ['기획 자료', '', undefined]){
    const input={nodes:[{id:'g',type:'group',label,x:0,y:0,width:400,height:300}],edges:[]};
    const made=M.createPortal(input,['g'],'이름을 덮어쓰면 안 됨'),p=made.root.canvasPortal.portals[made.portalId];
    assert.equal(p.name,label||'새 포탈');
    assert.equal(M.title(made.root.nodes[0].text),p.name);
    assert.equal(M.title(p.graph.nodes[0].text),p.name);
  }
  const input={nodes:[{id:'g',type:'group',label:'내부 그룹',x:0,y:0,width:400,height:300}],edges:[]};
  const parent=M.createSelect(input,['g'],'상위');
  const child=M.createPortal(parent.root,['g'],'다른 이름',parent.portalId);
  assert.equal(child.root.canvasPortal.portals[child.portalId].name,'내부 그룹');
});

test('Group entry does not retain large group dimensions; restore still encloses its contents',()=>{
 const group={id:'g',type:'group',label:'기획',x:-20,y:-40,width:2000,height:1400};
 const child={id:'n',type:'text',text:'자료',x:1000,y:700,width:240,height:140};
 const made=M.createPortal({nodes:[group,child],edges:[]},['g']);
 const entry=made.root.nodes[0],p=made.root.canvasPortal.portals[made.portalId];
 assert.ok(entry.width<group.width&&entry.height<group.height);
 assert.equal(entry.x,group.x);assert.equal(entry.y,group.y);
 assert.deepEqual(p.originalEntry,group);assert.deepEqual(p.graph.nodes.find(n=>n.id==='n'),child);
 const restored=M.restoreItems(made.root,made.portalId),g=restored.nodes.find(n=>n.id==='g');
 assert.ok(g.x<=child.x&&g.y<=child.y&&g.x+g.width>=child.x+child.width&&g.y+g.height>=child.y+child.height);
});
test('portal editor preserves spaces, blank text and trailing newlines through saved ID round trips', () => {
  for (const text of ['', ' ', '첫 줄 ', '첫 줄\n', '첫 줄\n\n', '첫 줄\n둘째 줄 ', '  한글  ']) {
    assert.equal(M.title(text), text);
    assert.equal(M.title(M.cardText(text, 'P001')), text);
  }
});
