const M=require('./model.cjs');
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const digest=text=>crypto.createHash('sha256').update(text).digest('hex');
const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(k=>[k,item[k]])):item);
const safe=name=>name.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,80);
function relative(value){
  if(typeof value!=='string'||!value.trim()||value!==value.trim()||value.includes('\\')||value.includes(':')||value.split('/').some(x=>!x||x==='.'||x==='..'||x.startsWith('.')))throw Error('Vault 안의 일반 폴더 경로를 입력하세요. 예: Canvas Portal Backups');
  return value;
}
function record(source,root){
  M.validate(root);
  const portals=M.clone(root.canvasPortal?.portals||{}),entries=M.clone(root.nodes.filter(n=>M.ref(n)?.role==='entry'));
  const ids=new Set(entries.map(n=>n.id));
  return {source,canvasId:root.canvasPortal?.canvasId,portals,entries,edges:M.clone(root.edges.filter(e=>ids.has(e.fromNode)||ids.has(e.toNode)))};
}
function validateRecord(r){
  relative(r.source);if(!r.source.endsWith('.canvas')||!r.canvasId||!Array.isArray(r.entries)||!Array.isArray(r.edges)||!r.portals)throw Error('복구 정보 형식이 올바르지 않습니다.');
  const root={nodes:r.entries,edges:[],canvasPortal:{version:1,canvasId:r.canvasId,portals:r.portals}};
  M.validate(root);const seen=new Set();
  const walk=(nodes,parent)=>{for(const n of nodes){const ref=M.ref(n);if(!ref)continue;const p=r.portals[ref.id];if(!p||p.id!==ref.id)throw Error('포탈 식별 정보가 손상되었습니다.');if(ref.role==='exit')continue;if(ref.role!=='entry'||seen.has(p.id)||p.entryId!==n.id||p.parentId!=parent)throw Error('포탈 연결 정보가 중복되거나 손상되었습니다.');seen.add(p.id);if(!['select','group','link'].includes(p.type))throw Error('지원하지 않는 포탈 종류입니다.');if(p.type==='link'){relative(p.target);if(p.graph.nodes.length!==1)throw Error('Link 복구 정보에 원본 자료가 들어 있습니다.');}walk(p.graph.nodes,p.id);}};
  walk(root.nodes,null);if(seen.size!==Object.keys(r.portals).length)throw Error('연결되지 않은 포탈 복구 정보가 있습니다.');
  return root;
}
function makeBundle(records,folder,createdAt=new Date().toISOString()){
  relative(folder);const exports={},files=new Map();
  for(const r of records){validateRecord(r);const names={};for(const p of Object.values(r.portals))if(p.type!=='link')names[p.id]=`${safe(M.fileTitle(r.source))}_Portal_${p.displayId}_${digest(r.source).slice(0,8)}_${p.id.slice(0,8)}.canvas`;
    for(const p of Object.values(r.portals))if(p.type!=='link'){
      const g=M.graph(p.graph);g.nodes=g.nodes.map(n=>{const ref=M.ref(n);if(!ref)return n;const other=r.portals[ref.id];const file=ref.role==='exit'?(p.parentId?`${folder}/latest/${names[p.parentId]}`:r.source):(other.type==='link'?other.target:`${folder}/latest/${names[other.id]}`);const out={...n,type:'file',file};delete out.text;delete out.canvasPortalRef;return out;});
      const text=JSON.stringify(g,null,2),name=names[p.id];if(files.has(name))throw Error('백업 파일명 충돌');files.set(name,text);exports[name]=digest(text);
    }
  }
  const payload={format:'canvas-portal-backup',version:1,createdAt,records,exports};
  files.set('portal-backup.json',JSON.stringify({payload,checksum:digest(JSON.stringify(payload))},null,2));return {files,payload};
}
function readManifest(text){
  const {payload,checksum}=JSON.parse(text);
  if(!payload||payload.format!=='canvas-portal-backup'||payload.version!==1||digest(JSON.stringify(payload))!==checksum)throw Error('백업 정보가 손상되었거나 지원하지 않는 버전입니다.');
  const seen=new Set();for(const r of payload.records){validateRecord(r);if(seen.has(r.source))throw Error('중복된 Canvas 백업');seen.add(r.source);}
  for(const name of Object.keys(payload.exports)){if(name!==path.basename(name)||!name.endsWith('.canvas'))throw Error('백업 파일 경로가 올바르지 않습니다.');}
  return payload;
}
class Store{
  constructor(base,folder,io=fs){this.base=path.resolve(base);this.folder=relative(folder);this.dir=path.resolve(base,...folder.split('/'));this.io=io;}
  async prepare(){
    let p=this.base;for(const part of this.folder.split('/')){p=path.join(p,part);try{const stat=await this.io.lstat(p);if(stat.isSymbolicLink()||!stat.isDirectory())throw Error('백업 폴더는 일반 폴더여야 합니다.');}catch(e){if(e.code!=='ENOENT')throw e;await this.io.mkdir(p);}}
  }
  async exists(p){try{await this.io.lstat(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}}
  async inspectDir(dir){
    const stat=await this.io.lstat(dir);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('안전하지 않은 백업 폴더');
    const mf=path.join(dir,'portal-backup.json');if((await this.io.lstat(mf)).isSymbolicLink())throw Error('안전하지 않은 백업 파일');
    const payload=readManifest(await this.io.readFile(mf,'utf8'));let expected;
    for(const [name,hash]of Object.entries(payload.exports)){
      const f=path.join(dir,name);if((await this.io.lstat(f)).isSymbolicLink())throw Error('안전하지 않은 내보내기 파일');
      const text=await this.io.readFile(f,'utf8');let graph;
      try{
        graph=JSON.parse(text);
        if(digest(text)!==hash){
          // Opening an ordinary Canvas can rewrite whitespace/property order.
          // Verify its content against the checksummed snapshot, never accept edits.
          expected||=makeBundle(payload.records,this.folder,payload.createdAt).files;
          if(!expected.has(name)||canonical(graph)!==canonical(JSON.parse(expected.get(name))))throw Error('content mismatch');
        }
      }catch{throw Error(`백업 파일 손상: ${name}`);}
      M.validate(graph);
    }
    return payload;
  }
  async recover(){
    const latest=path.join(this.dir,'latest'),previous=path.join(this.dir,'.cp-previous');
    if(!await this.exists(latest)&&await this.exists(previous)){await this.inspectDir(previous);await this.io.rename(previous,latest);}
  }
  async read(){await this.prepare();await this.recover();return this.inspectDir(path.join(this.dir,'latest'));}
  async owned(dir){
    const stat=await this.io.lstat(dir);if(stat.isSymbolicLink()||!stat.isDirectory())throw Error('안전하지 않은 백업 폴더');
    const manifest=path.join(dir,'portal-backup.json');if((await this.io.lstat(manifest)).isSymbolicLink())throw Error('안전하지 않은 백업 정보');
    const payload=readManifest(await this.io.readFile(manifest,'utf8')),allowed=new Set(['portal-backup.json',...Object.keys(payload.exports)]),names=await this.io.readdir(dir);
    if(names.some(n=>!allowed.has(n)))throw Error('백업 폴더에 별도 파일이 있어 자동 교체를 중단했습니다.');
    for(const name of names)if(!(await this.io.lstat(path.join(dir,name))).isFile())throw Error('안전하지 않은 백업 파일');
    return {payload,names};
  }
  async removeOwned(dir){
    const {names}=await this.owned(dir);
    // Only verified plugin-generated files, no recursive deletion or directory traversal.
    for(const name of names)await this.io.unlink(path.join(dir,name));await this.io.rmdir(dir);
  }
  async write(records,createdAt){
    await this.prepare();await this.recover();const latest=path.join(this.dir,'latest'),previous=path.join(this.dir,'.cp-previous');
    if(await this.exists(previous))await this.removeOwned(previous);
    if(await this.exists(latest))await this.owned(latest);
    const staging=path.join(this.dir,'.cp-staging-'+M.uid());await this.io.mkdir(staging);
    const bundle=makeBundle(records,this.folder,createdAt);
    for(const [name,text]of bundle.files){const handle=await this.io.open(path.join(staging,name),'wx');try{await handle.writeFile(text,'utf8');await handle.sync();}finally{await handle.close();}}
    await this.inspectDir(staging);
    let moved=false;
    try{if(await this.exists(latest)){await this.io.rename(latest,previous);moved=true;}await this.io.rename(staging,latest);}
    catch(e){if(moved&&!await this.exists(latest))await this.io.rename(previous,latest);throw e;}
    await this.inspectDir(latest);
    if(moved)await this.removeOwned(previous);
    return bundle.payload;
  }
  async retarget(oldPath,newPath){
    await this.prepare();await this.recover();const latest=path.join(this.dir,'latest');if(!await this.exists(latest))return;
    const {payload}=await this.owned(latest);let changed=false;const moved=value=>typeof value==='string'&&(value===oldPath||value.startsWith(oldPath+'/'))?newPath+value.slice(oldPath.length):value;
    for(const r of payload.records){const source=moved(r.source);if(source!==r.source){r.source=source;changed=true;}const root={nodes:r.entries,edges:[],canvasPortal:{version:1,canvasId:r.canvasId,portals:r.portals}};if(M.syncLinkNames(root,oldPath,newPath))changed=true;for(const g of [root,...Object.values(r.portals).map(p=>p.graph)])for(const n of g.nodes){const file=moved(n.file);if(file!==n.file){n.file=file;changed=true;}}}
    if(changed)await this.write(payload.records,payload.createdAt);
  }
}
function mergeRecovery(current,r){
  validateRecord(r);const root=M.rootData(current),saved=M.clone(r.portals),missing=[],affected=new Set(Object.keys(saved));
  for(const e of r.entries){const id=M.ref(e).id;if(root.canvasPortal.portals[id])for(const child of M.descendants(root,id))affected.add(child);}
  const locations=new Map();for(const g of [root,...Object.values(root.canvasPortal.portals).map(p=>p.graph)])for(const n of g.nodes){const ref=M.ref(n);if(ref?.role==='entry'&&r.entries.some(e=>M.ref(e).id===ref.id)){if(locations.has(ref.id))throw Error('같은 포탈 입장 카드가 중복되어 있습니다.');locations.set(ref.id,{g,n});}}
  for(const id of affected)delete root.canvasPortal.portals[id];Object.assign(root.canvasPortal.portals,saved);
  for(const e of r.entries){const id=M.ref(e).id,p=root.canvasPortal.portals[id],found=locations.get(id);if(found){
      if(found.n.id!==p.entryId)throw Error('포탈 카드 식별자가 변경되어 자동 복원할 수 없습니다.');
      const holder=Object.values(root.canvasPortal.portals).find(q=>q.graph===found.g);p.parentId=holder?.id||null;
      const i=found.g.nodes.indexOf(found.n);found.g.nodes[i]={...M.clone(e),x:found.n.x,y:found.n.y,width:found.n.width,height:found.n.height};
    }else{const entry=M.clone(e);if(root.nodes.some(n=>n.id===entry.id))throw Error('일반 카드와 복구 카드 ID가 충돌합니다.');missing.push(entry);root.nodes.push(entry);p.parentId=null;}}
  const nodeIds=new Set(root.nodes.map(n=>n.id)),edgeIds=new Set(root.edges.map(e=>e.id));for(const e of r.edges)if(!edgeIds.has(e.id)&&nodeIds.has(e.fromNode)&&nodeIds.has(e.toNode)){root.edges.push(M.clone(e));edgeIds.add(e.id);}
  M.validate(root);return {root,missing};
}
async function atomicRestore(base,file,expected,text,io=fs){
  relative(file);const full=path.resolve(base,...file.split('/'));let p=path.resolve(base);for(const part of file.split('/')){p=path.join(p,part);if((await io.lstat(p)).isSymbolicLink())throw Error('외부 연결 파일에는 복원할 수 없습니다.');}
  if(await io.readFile(full,'utf8')!==expected)throw Error('미리보기 이후 Canvas가 변경되었습니다. 다시 확인해 주세요.');
  const tmp=full+'.cp-restore-'+M.uid()+'.tmp';let moved=false;
  try{const h=await io.open(tmp,'wx');try{await h.writeFile(text,'utf8');await h.sync();}finally{await h.close();}if(await io.readFile(tmp,'utf8')!==text)throw Error('복원 파일 검증 실패');if(await io.readFile(full,'utf8')!==expected)throw Error('Canvas가 동시에 변경되었습니다. 복원하지 않았습니다.');await io.rename(tmp,full);moved=true;}
  finally{if(!moved)await io.unlink(tmp).catch(()=>{});}
}
module.exports={Store,record,makeBundle,readManifest,validateRecord,mergeRecovery,atomicRestore,digest,relative};
