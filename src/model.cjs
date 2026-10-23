const clone = value => JSON.parse(JSON.stringify(value));
const uid = () => globalThis.crypto.randomUUID().replaceAll('-', '');
const ref = node => node?.canvasPortalRef;
const graph = data => ({ nodes: clone(data.nodes || []), edges: clone(data.edges || []) });
// Strip only our two separator newlines; preceding whitespace belongs to the editor.
const ID_MARKER = /(?:\n{2})?<small class="cp-persistent-id">[^<]*<\/small>\s*$/;
const title = text => String(text ?? '').replace(ID_MARKER, '');
const cardText = (name, displayId) => `${name}\n\n<small class="cp-persistent-id">${displayId}</small>`;

function rootData(data) {
  const root = clone(data);
  if (!Array.isArray(root.nodes) || !Array.isArray(root.edges)) throw Error('Canvas 형식이 올바르지 않습니다.');
  if (root.canvasPortal && root.canvasPortal.version !== 1) throw Error('지원하지 않는 포탈 데이터 버전입니다.');
  root.canvasPortal ??= { version: 1, canvasId: uid(), portals: {} };
  normalizeGroups(root);
  return root;
}

// Legacy groups used the original group ID for their entry card. Give the
// restored interior frame its own ID without changing portal/navigation IDs.
function normalizeGroups(root) {
  let changed=false;
  for(const p of Object.values(root.canvasPortal?.portals||{}))if(p.type==='group'){
    if(!p.originalEntry||p.originalEntry.type!=='group')throw Error('기존 그룹 정보가 없어 변환을 중단했습니다.');
    const group=clone(p.originalEntry),nodes=p.graph.nodes.filter(n=>n.id!==p.exitId),b=bounds(nodes);
    group.id=uid();group.label=p.name;
    if(nodes.length)Object.assign(group,{x:b.x-24,y:b.y-48,width:b.width+48,height:b.height+72});
    p.graph.nodes.unshift(group);
    p.graph.edges=p.graph.edges.map(e=>({...e,fromNode:e.fromNode===p.exitId?group.id:e.fromNode,toNode:e.toNode===p.exitId?group.id:e.toNode}));
    p.type='select';p.originalEntry=null;changed=true;
  }
  return changed;
}

const space = (root, parentId = null) => parentId ? root.canvasPortal.portals[parentId]?.graph : root;
function bounds(nodes) {
  if (!nodes.length) return { x:0,y:0,width:1,height:1 };
  const x=Math.min(...nodes.map(n=>n.x)),y=Math.min(...nodes.map(n=>n.y));
  return {x,y,width:Math.max(...nodes.map(n=>n.x+n.width))-x,height:Math.max(...nodes.map(n=>n.y+n.height))-y};
}
const overlaps = (a,b) => a.x < b.x+b.width && a.x+a.width > b.x && a.y < b.y+b.height && a.y+a.height > b.y;
function nextId(root) {
  const number=1+Math.max(0,...Object.values(root.canvasPortal.portals).map(p=>Number(p.displayId.slice(2))||0));
  return `P-${String(number).padStart(2,'0')}`;
}
function createPortal(data, selectedIds, name, parentId=null, requestedType=null) {
  const root = rootData(data);
  const parent = space(root,parentId); if (!parent) throw Error('상위 포탈을 찾을 수 없습니다.');
  const ids = new Set(selectedIds);
  // Canvas groups are spatial containers. Include their contained nodes when selected.
  const direct=parent.nodes.filter(n=>ids.has(n.id)&&ref(n)?.role!=='exit');
  const type=requestedType==='link'||(!requestedType&&direct.length===1&&direct[0].type==='file'&&direct[0].file.toLowerCase().endsWith('.canvas'))?'link':'select';
  for (const n of parent.nodes) if (ids.has(n.id) && n.type === 'group') {
    for (const child of parent.nodes) if (child.x >= n.x && child.y >= n.y && child.x + child.width <= n.x + n.width && child.y + child.height <= n.y + n.height) ids.add(child.id);
  }
  const selected = parent.nodes.filter(n => ids.has(n.id)&&ref(n)?.role!=='exit');
  ids.clear();selected.forEach(n=>ids.add(n.id));
  if (!selected.length) throw Error('포탈로 묶을 카드를 먼저 선택해 주세요.');
  const minX = Math.min(...selected.map(n => n.x));
  const minY = Math.min(...selected.map(n => n.y));
  const maxX = Math.max(...selected.map(n => n.x + n.width));
  const maxY = Math.max(...selected.map(n => n.y + n.height));
  const portalId = uid(), entryId = type==='select'?uid():direct[0].id, exitId = uid();
  const displayId = nextId(root);
  const portalName = type==='link'?fileTitle(direct[0].file):(title(name??(direct.length===1&&direct[0].type==='group'?direct[0].label:'')).trim() || '새 포탈');
  const entry = { id: entryId, type: 'text', x: (minX + maxX) / 2 - 140, y: (minY + maxY) / 2 - 80, width: 280, height: 160, text: cardText(portalName, displayId), canvasPortalRef: { id: portalId, role: 'entry' } };
  const exit = { id: exitId, type: 'text', x: minX - 320, y: minY - 190, width: 280, height: 160, text: cardText(portalName, displayId), canvasPortalRef: { id: portalId, role: 'exit' } };
  const originalEntry=type==='select'?null:clone(direct[0]);
  if(originalEntry)Object.assign(entry,{x:originalEntry.x,y:originalEntry.y});
  if(type==='link')Object.assign(entry,{width:originalEntry.width,height:originalEntry.height});
  const internalEdges = parent.edges.filter(e => ids.has(e.fromNode) && ids.has(e.toNode));
  parent.edges = parent.edges.filter(e => !internalEdges.includes(e)).map(e => ({ ...e, fromNode: ids.has(e.fromNode) ? entryId : e.fromNode, toNode: ids.has(e.toNode) ? entryId : e.toNode }));
  parent.nodes = [...parent.nodes.filter(n => !ids.has(n.id)), entry];
  const moved=type==='link'?[]:selected;
  root.canvasPortal.portals[portalId] = { id:portalId,type,parentId,displayId,name:portalName,entryId,exitId,originalEntry,target:type==='link'?originalEntry.file:null,graph:{nodes:[...clone(moved),exit],edges:type==='link'?[]:clone(internalEdges)} };
  for(const n of moved){const r=ref(n);if(r?.role==='entry')root.canvasPortal.portals[r.id].parentId=portalId;}
  validate(root);
  return { root, portalId, entryId };
}
const createSelect=(data,ids,name)=>createPortal(data,ids,name,null,'select');

function descendants(root,id,result=new Set()) {
  if(result.has(id))throw Error('포탈 연결이 순환합니다.');result.add(id);
  const p=root.canvasPortal.portals[id];if(!p)throw Error('포탈 정보가 없습니다.');
  for(const n of p.graph.nodes)if(ref(n)?.role==='entry')descendants(root,ref(n).id,result);
  return result;
}
function clonePortal(data,id,parentId=null,offset={x:320,y:0}) {
  const root=rootData(data),ids=[...descendants(root,id)],records=clone(root.canvasPortal.portals),portalMap=new Map(),nodeMap=new Map();
  ids.forEach(id=>portalMap.set(id,uid()));
  for(const old of ids){const p=records[old];for(const n of p.graph.nodes)nodeMap.set(n.id,uid());nodeMap.set(p.entryId,nodeMap.get(p.entryId)||uid());}
  for(const old of ids){const p=clone(records[old]);p.id=portalMap.get(old);p.displayId=nextId(root);p.entryId=nodeMap.get(p.entryId);p.exitId=nodeMap.get(p.exitId);p.parentId=old===id?parentId:portalMap.get(p.parentId);
    p.graph.nodes=p.graph.nodes.map(n=>{const r=ref(n),d={...n,id:nodeMap.get(n.id)};if(r){d.canvasPortalRef={id:portalMap.get(r.id),role:r.role};const name=records[r.id].name;d.text=cardText(name,old===r.id?p.displayId:'');}return d;});
    p.graph.edges=p.graph.edges.map(e=>({...e,id:uid(),fromNode:nodeMap.get(e.fromNode),toNode:nodeMap.get(e.toNode)}));
    if(p.originalEntry)p.originalEntry.id=p.entryId;
    root.canvasPortal.portals[p.id]=p;
  }
  // Allocate all display IDs before writing nested labels.
  for(const old of ids){const p=root.canvasPortal.portals[portalMap.get(old)];for(const n of p.graph.nodes){const r=ref(n);if(r){const child=root.canvasPortal.portals[r.id];n.text=cardText(child.name,child.displayId);}}}
  const source=space(root,parentId).nodes.find(n=>ref(n)?.id===id&&ref(n)?.role==='entry');if(!source)throw Error('복제할 입장 카드가 없습니다.');
  const top=root.canvasPortal.portals[portalMap.get(id)],entry={...clone(source),id:top.entryId,x:source.x+offset.x,y:source.y+offset.y,text:cardText(top.name,top.displayId),canvasPortalRef:{id:top.id,role:'entry'}};
  space(root,parentId).nodes.push(entry);validate(root);return {root,portalId:top.id,entryId:entry.id};
}
function restoreItems(root,id) {
  const p=root.canvasPortal.portals[id];if(!p)throw Error('해제할 포탈 정보가 없습니다.');
  if(p.type==='link'){const entry=space(root,p.parentId).nodes.find(n=>n.id===p.entryId);return {nodes:[{...clone(p.originalEntry),x:entry.x,y:entry.y,width:entry.width,height:entry.height}],edges:[]};}
  const nodes=clone(p.graph.nodes.filter(n=>n.id!==p.exitId));
  let edges=clone(p.graph.edges.filter(e=>e.fromNode!==p.exitId&&e.toNode!==p.exitId));
  return {nodes,edges};
}
function unportal(data,ids,parentId=null,offset={x:0,y:0},deleteIds=[]) {
  const root=rootData(data),parent=space(root,parentId),remove=new Set(deleteIds),nodes=[],edges=[],keepEdges=new Set(ids.filter(id=>root.canvasPortal.portals[id]?.type==='link').map(id=>root.canvasPortal.portals[id].entryId));
  for(const id of ids){const p=root.canvasPortal.portals[id];remove.add(p.entryId);const content=restoreItems(root,id);nodes.push(...content.nodes.map(n=>({...n,x:n.x+offset.x,y:n.y+offset.y})));edges.push(...content.edges);for(const n of content.nodes){const r=ref(n);if(r?.role==='entry')root.canvasPortal.portals[r.id].parentId=parentId;}delete root.canvasPortal.portals[id];}
  parent.nodes=[...parent.nodes.filter(n=>!remove.has(n.id)),...nodes];parent.edges=[...parent.edges.filter(e=>(!remove.has(e.fromNode)||keepEdges.has(e.fromNode))&&(!remove.has(e.toNode)||keepEdges.has(e.toNode))),...edges];validate(root);return {root,nodes};
}
function pasteTransfer(data,selection,parentId=null,offset={x:0,y:0}) {
  const root=rootData(data),transfer=selection.canvasPortalTransfer;
  if(!transfer||transfer.version!==1)throw Error('포탈 복사 정보를 읽을 수 없습니다.');
  const temp=rootData({nodes:clone(selection.nodes),edges:clone(selection.edges||[]),canvasPortal:{version:1,canvasId:uid(),portals:{...clone(root.canvasPortal.portals),...clone(transfer.portals)}}});
  const idMap=new Map(),nodes=[];
  for(const n of selection.nodes){const r=ref(n);if(r?.role==='exit')continue;
    if(r?.role==='entry'){
      const copied=clonePortal(temp,r.id,null,offset);temp.canvasPortal=copied.root.canvasPortal;
      const entry=copied.root.nodes.find(n=>n.id===copied.entryId);nodes.push(entry);idMap.set(n.id,entry.id);
      for(const id of descendants(copied.root,copied.portalId))root.canvasPortal.portals[id]=clone(copied.root.canvasPortal.portals[id]);
      root.canvasPortal.portals[copied.portalId].parentId=parentId;
    }else{const d={...clone(n),id:uid(),x:n.x+offset.x,y:n.y+offset.y};nodes.push(d);idMap.set(n.id,d.id);}
  }
  const edges=(selection.edges||[]).filter(e=>idMap.has(e.fromNode)&&idMap.has(e.toNode)).map(e=>({...e,id:uid(),fromNode:idMap.get(e.fromNode),toNode:idMap.get(e.toNode)}));
  space(root,parentId).nodes.push(...nodes);space(root,parentId).edges.push(...edges);validate(root);return {root,nodes,edges};
}

function validate(root) {
  const allGraphs = [root, ...Object.values(root.canvasPortal?.portals || {}).map(p => p.graph)];
  for (const g of allGraphs) {
    const ids = new Set(g.nodes.map(n => n.id));
    if (ids.size !== g.nodes.length) throw Error('중복 카드 ID');
    if (g.edges.some(e => !ids.has(e.fromNode) || !ids.has(e.toNode))) throw Error('연결 대상이 없는 선');
  }
  for (const p of Object.values(root.canvasPortal?.portals || {})) {
    if (!p.graph.nodes.some(n => n.id === p.exitId && ref(n)?.role === 'exit')) throw Error('퇴장 포탈 없음');
    descendants(root,p.id);
  }
}
function fileTitle(path){return String(path||'').split('/').pop().replace(/\.canvas$/i,'');}
function syncLinkNames(root,oldPath=null,newPath=null){
  let changed=false;
  const records=root.canvasPortal?.portals||{};
  // Obsidian only updates visible, ordinary Canvas nodes on file rename.
  // Keep file cards stored inside virtual portal spaces connected as well.
  if(oldPath)for(const g of [root,...Object.values(records).map(p=>p.graph)])for(const n of g.nodes||[]){
    if(typeof n.file==='string'&&(n.file===oldPath||n.file.startsWith(oldPath+'/'))){n.file=newPath+n.file.slice(oldPath.length);changed=true;}
  }
  for(const p of Object.values(records))if(p.type==='link'){
    if(oldPath&&(p.target===oldPath||p.target.startsWith(oldPath+'/'))){p.target=newPath+p.target.slice(oldPath.length);changed=true;}
    if(p.originalEntry&&p.originalEntry.file!==p.target){p.originalEntry.file=p.target;changed=true;}
  }
  return changed;
}
function selectedEntries(root, ids, parentId) {
  const parent=space(root,parentId),unique=[...new Set(ids)];
  if(!parent||!unique.length)throw Error('이동하거나 삭제할 포탈을 선택하세요.');
  return unique.map(id=>{const p=root.canvasPortal.portals[id],n=parent.nodes.find(n=>ref(n)?.role==='entry'&&ref(n).id===id);
    if(!p||!n||p.parentId!==parentId)throw Error('선택한 포탈의 위치가 변경되었습니다. 다시 선택하세요.');return n;});
}
function deletePortals(data,ids,parentId=null,ordinary=[]) {
  const root=rootData(data),entries=selectedEntries(root,ids,parentId),parent=space(root,parentId);
  const removed=new Set([...entries.map(n=>n.id),...ordinary.filter(id=>parent.nodes.some(n=>n.id===id&&!ref(n)))]);
  const records=new Set();for(const id of ids)for(const child of descendants(root,id))records.add(child);
  parent.nodes=parent.nodes.filter(n=>!removed.has(n.id));parent.edges=parent.edges.filter(e=>!removed.has(e.fromNode)&&!removed.has(e.toNode));
  for(const id of records)delete root.canvasPortal.portals[id];validate(root);return {root};
}
// Passing a destination document explicitly means a transfer between Canvas files.
function movePortals(data,ids,parentId=null,destinationId=null,destinationData=null) {
  const source=rootData(data),entries=selectedEntries(source,ids,parentId),target=destinationData?rootData(destinationData):source;
  const moving=new Set();for(const id of ids)for(const child of descendants(source,id))moving.add(child);
  if(!destinationData&&(moving.has(destinationId)||destinationId===parentId))throw Error('자기 자신이나 하위 포탈로는 옮길 수 없습니다.');
  const destination=space(target,destinationId);
  if(!destination||target.canvasPortal.portals[destinationId]?.type==='link')throw Error('올바른 목적지 공간이 아닙니다.');
  let nodes=clone(entries),edges=[];
  // Every line outside a moved portal is removed, including lines between selected entries.
  if(destinationData){
    const portals=Object.fromEntries([...moving].map(id=>[id,source.canvasPortal.portals[id]]));
    const copied=pasteTransfer(target,{nodes,edges:[],canvasPortalTransfer:{version:1,portals}},destinationId);
    Object.assign(target,copied.root);nodes=copied.nodes;
  }else{
    for(const id of ids)source.canvasPortal.portals[id].parentId=destinationId;
    destination.nodes.push(...nodes);
  }
  const dest=space(target,destinationId),entryIds=new Set(nodes.map(n=>n.id)),obstacles=dest.nodes.filter(n=>!entryIds.has(n.id));
  const b=bounds(nodes),o=bounds(obstacles),dx=obstacles.length?o.x+o.width+80-b.x:0,dy=obstacles.length?o.y-b.y:0;
  for(const n of nodes){n.x+=dx;n.y+=dy;}
  const sourceIds=new Set(entries.map(n=>n.id)),parent=space(source,parentId);
  parent.nodes=parent.nodes.filter(n=>!sourceIds.has(n.id));parent.edges=parent.edges.filter(e=>!sourceIds.has(e.fromNode)&&!sourceIds.has(e.toNode));
  if(destinationData)for(const id of moving)delete source.canvasPortal.portals[id];
  validate(source);validate(target);return {root:source,target,nodes,edges};
}
module.exports = { clone, uid, ref, graph, title, cardText, fileTitle, syncLinkNames, normalizeGroups, rootData, createSelect, createPortal, space, bounds, overlaps, clonePortal, descendants, restoreItems, unportal, pasteTransfer, validate, deletePortals, movePortals, selectedEntries };
