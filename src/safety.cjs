// Keep recovery copies outside the mounted/synced Vault. Never truncate a
// protected destination: fully write and verify a sibling before replacing it.
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const hash=text=>crypto.createHash('sha256').update(text).digest('hex');
function parse(text){try{const d=JSON.parse(text);return Array.isArray(d.nodes)&&Array.isArray(d.edges)?d:null}catch{return null}}
function portal(d){return !!d?.canvasPortal}
class SafetyStore {
  constructor(base,io=fs){this.base=base;this.io=io;this.pending=new Map();this.tracked=new Set();}
  preserve(file,text){
    if(portal(parse(text)))this.tracked.add(file);
    const task=(this.pending.get(file)||Promise.resolve()).catch(()=>{}).then(()=>this.preserveNow(file,text));
    this.pending.set(file,task);task.finally(()=>{if(this.pending.get(file)===task)this.pending.delete(file)}).catch(()=>{});return task;
  }
  async preserveNow(file,text){
    const d=parse(text);if(!d||(!d.nodes.length&&!Object.values(d.canvasPortal?.portals||{}).some(p=>p.graph?.nodes?.length)))return;
    const dir=path.join(this.base,hash(file)),name=hash(text)+'.canvas',dest=path.join(dir,name);
    await this.io.mkdir(dir,{recursive:true});
    try{await this.io.access(dest)}catch(e){
      if(e.code!=='ENOENT')throw e;
      const tmp=dest+'.'+crypto.randomUUID()+'.tmp';
      try{const h=await this.io.open(tmp,'wx');try{await h.writeFile(text,'utf8');await h.sync()}finally{await h.close()}
        if(await this.io.readFile(tmp,'utf8')!==text)throw Error('복구 사본 검증 실패');await this.io.rename(tmp,dest);
      }finally{await this.io.unlink(tmp).catch(()=>{})}
    }
    if(await this.io.readFile(dest,'utf8')!==text)throw Error('복구 사본 검증 실패');
    await this.io.writeFile(path.join(dir,'source.json'),JSON.stringify({file}), 'utf8');
    // Refresh a reused revision so it remains among the most recent 20.
    const now=new Date();await this.io.utimes(dest,now,now);
    const files=await Promise.all((await this.io.readdir(dir)).filter(n=>n.endsWith('.canvas')).map(async n=>({n,mtime:(await this.io.stat(path.join(dir,n))).mtimeMs})));
    files.sort((a,b)=>b.mtime-a.mtime);for(const f of files.slice(20))if(f.n!==name)await this.io.unlink(path.join(dir,f.n));
  }
}
async function protectedWrite(full,file,before,text,store,io=fs){
  const old=parse(before),next=parse(text);
  if(!portal(old)&&!portal(next))return false;
  await store.preserve(file,before);
  if(!next||!portal(next))throw Error('포탈 데이터가 사라진 저장을 차단했습니다. 로컬 복구 사본을 확인하세요.');
  await store.preserve(file,text);
  const tmp=full+'.cp-save-'+crypto.randomUUID()+'.tmp';let moved=false;
  try{
    const h=await io.open(tmp,'wx');try{await h.writeFile(text,'utf8');await h.sync()}finally{await h.close()}
    if(await io.readFile(tmp,'utf8')!==text)throw Error('Canvas 임시 저장 검증 실패');
    let current;try{current=await io.readFile(full,'utf8')}catch(e){if(e.code!=='ENOENT'||before!==null)throw e;current=null}
    if(current!==before)throw Error('Canvas가 동시에 변경되어 저장을 중단했습니다. 로컬 복구 사본은 보존했습니다.');
    await io.rename(tmp,full);moved=true;return true;
  }finally{if(!moved)await io.unlink(tmp).catch(()=>{})}
}
function install(adapter,base,onError){
  const store=new SafetyStore(base),undos=[];
  for(const method of ['write','process']){
    const original=adapter[method],had=Object.hasOwn(adapter,method);
    const wrapped=function(file,value,options){
      if(!file.toLowerCase().endsWith('.canvas'))return original.call(this,file,value,options);
      return this.queue(async()=>{
        const full=this.getFullPath(file);let before;
        if(method==='write'&&portal(parse(value)))await store.preserve(file,value);
        try{before=await this.fsPromises.readFile(full,'utf8')}catch(e){if(e.code!=='ENOENT'||method==='process')throw e;before=null}
        const text=method==='process'?value(before):value;
        if(method==='process'&&text===before)return before;
        try{
          if(store.tracked.has(file)&&!portal(parse(text)))throw Error('포탈 데이터가 사라진 저장을 차단했습니다. 로컬 복구 사본을 확인하세요.');
          if(!await protectedWrite(full,file,before,text,store,this.fsPromises))await this.fsPromises.writeFile(full,text,'utf8');
          await this.applyWriteOptions(full,options);
          if(method==='process')return text;
        }catch(e){onError(e);throw e}
        finally{await this.reconcileInternalFile(file)}
      });
    };
    adapter[method]=wrapped;
    undos.push(()=>{if(adapter[method]===wrapped){if(had)adapter[method]=original;else delete adapter[method]}});
  }
  return {store,dispose(){undos.reverse().forEach(fn=>fn())}};
}
module.exports={SafetyStore,protectedWrite,install,hash};
