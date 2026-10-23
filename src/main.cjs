const { Plugin, PluginSettingTab, Setting, Modal, Notice, setIcon } = require('obsidian');
const M = require("./model.cjs");
const B = require("./backup.cjs");
const S = require("./safety.cjs");
const historyGraph = data => ({...M.graph(data), ...(data.cpLifecycle?{cpLifecycle:data.cpLifecycle}:{})});
const canonical = value => JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);

class PortalDeleteModal extends Modal {
  constructor(plugin,s,ids,ordinary){super(plugin.app);Object.assign(this,{plugin,s,ids,ordinary});}
  onOpen(){
    this.titleEl.setText('포탈 삭제');
    this.contentEl.createEl('p',{text:`선택한 포탈 ${this.ids.length}개를 어떻게 삭제할까요?`});
    new Setting(this.contentEl).setName('내용을 꺼내고 포탈만 삭제').setDesc('내부 카드를 현재 화면의 빈 곳에 배치합니다. Link 포탈은 연결된 Canvas 파일 카드로 돌아갑니다.').addButton(b=>b.setButtonText('내용 꺼내기').onClick(()=>{this.close();this.plugin.beginUnportal(this.s,this.ids,this.ordinary);}));
    new Setting(this.contentEl).setName('포탈과 내부까지 삭제').setDesc('내부 카드와 하위 포탈을 함께 삭제합니다. 원본 노트·이미지·연결된 Canvas 파일은 유지합니다.').addButton(b=>b.setButtonText('내부까지 삭제').setWarning().onClick(()=>{this.close();this.plugin.deleteContents(this.s,this.ids,this.ordinary);}));
    if(this.ordinary.length)this.contentEl.createEl('p',{text:`함께 선택한 일반 카드 ${this.ordinary.length}개도 삭제됩니다.`});
    new Setting(this.contentEl).addButton(b=>b.setButtonText('취소').onClick(()=>this.close()));
  }
  onClose(){this.s.deleteModal=null;this.contentEl.empty();}
}

class PortalNameModal extends Modal {
  constructor(app, done, initialName='새 포탈') { super(app); this.done = done; this.initialName=initialName; }
  onOpen() {
    this.contentEl.createEl('h3', { text: '포탈 만들기' });
    let name = this.initialName || '새 포탈';
    const setting = new Setting(this.contentEl).setName('포탈 이름').addText(t => {
      t.setValue(name).onChange(v => name = v);
      t.inputEl.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); this.close(); this.done(name); } });
      setTimeout(() => { t.inputEl.focus(); t.inputEl.select(); }, 50);
    });
    new Setting(this.contentEl).addButton(b => b.setButtonText('만들기').setCta().onClick(() => { this.close(); this.done(name); }));
  }
  onClose() { this.contentEl.empty(); }
}

class RecoveryModal extends Modal {
  constructor(plugin,payload){super(plugin.app);this.plugin=plugin;this.payload=payload;}
  onOpen(){
    this.titleEl.setText('백업 확인 · 복원');
    this.contentEl.createEl('p',{text:`백업 시각: ${new Date(this.payload.createdAt).toLocaleString()}`});
    this.contentEl.createEl('p',{text:'선택한 Canvas의 포탈 내용을 백업 상태로 바꿉니다. 일반 카드와 연결된 Markdown·Link 원본 파일은 유지합니다. 사라진 입장 카드는 빈 위치에 직접 놓습니다.'});
    const candidates=this.plugin.canvasFiles();
    for(const r of this.payload.records){
      let target=this.app.vault.getAbstractFileByPath(r.source)?r.source:'';
      const row=new Setting(this.contentEl).setName(r.source).setDesc(`포탈 ${Object.keys(r.portals).length}개 · ${target?'기존 입장 카드는 현재 위치 유지':'원래 Canvas 없음: 복원할 기존 Canvas를 선택하세요'}`);
      if(!target)row.addDropdown(d=>{d.addOption('','복원할 Canvas 선택');for(const f of candidates)d.addOption(f.path,f.path);d.onChange(value=>target=value);});
      row.addButton(b=>b.setButtonText('이 Canvas 복원').setWarning().onClick(async()=>{if(!target){new Notice('복원할 기존 Canvas를 선택하세요.');return;}b.setDisabled(true);try{this.close();await this.plugin.beginRecovery(r,target);}catch(e){new Notice(e.message);b.setDisabled(false);}}));
    }
  }
  onClose(){this.contentEl.empty();}
}
class PortalSettings extends PluginSettingTab {
  display() {
    this.containerEl.empty();
    this.containerEl.createEl('h2', { text: 'Canvas Portal · 백업과 복원' });
    this.containerEl.createEl('p', { text: '최신 백업 1회분을 유지합니다. 새 백업을 검증한 뒤 이전 백업을 교체합니다.' });
    let folder=this.plugin.settings.backupFolder||'';
    new Setting(this.containerEl).setName('백업 폴더').setDesc('Vault 안의 폴더. 예: Canvas Portal Backups. 기존 백업 폴더를 지정해도 자동으로 복원하지 않습니다.').addText(t=>t.setValue(folder).setPlaceholder('Canvas Portal Backups').onChange(v=>folder=v)).addButton(b=>b.setButtonText('폴더 적용').onClick(async()=>{try{B.relative(folder);this.plugin.settings.backupFolder=folder;this.plugin.settings.autoMinutes=0;this.plugin.backupFingerprint=null;await this.plugin.saveData(this.plugin.settings);this.display();new Notice('폴더를 적용했습니다. 자동 백업은 필요한 경우 켜 주세요.');}catch(e){new Notice(e.message);}}));
    new Setting(this.containerEl).setName('자동 백업').setDesc('변경이 있을 때만 백업합니다. 폴더 변경·재설치 직후에는 꺼져 있습니다.').addDropdown(d=>{for(const [v,label]of [['0','꺼짐'],['1','1분'],['5','5분'],['15','15분'],['30','30분']])d.addOption(v,label);d.setValue(String(this.plugin.settings.autoMinutes||0)).onChange(async v=>{this.plugin.settings.autoMinutes=Number(v);this.plugin.lastAutoAttempt=Date.now();await this.plugin.saveData(this.plugin.settings);});});
    new Setting(this.containerEl).setName('마지막 백업 상태').setDesc(this.plugin.settings.backupStatus||'아직 백업하지 않았습니다.');
    new Setting(this.containerEl).setName('지금 백업').setDesc('현재 Vault의 포탈을 지정 폴더에 저장합니다.').addButton(b=>b.setButtonText('지금 백업').setCta().onClick(async()=>{b.setDisabled(true);await this.plugin.runBackup(false);this.display();}));
    new Setting(this.containerEl).setName('백업 목록 확인·복원').setDesc('내용과 대상 Canvas를 확인한 뒤 직접 복원을 실행합니다.').addButton(b=>b.setButtonText('백업 목록 열기').onClick(async()=>{try{const payload=await this.plugin.backupStore().read();new RecoveryModal(this.plugin,payload).open();}catch(e){new Notice('백업을 읽지 못했습니다: '+e.message);}}));
    new Setting(this.containerEl).setName('플러그인 제거 준비').setDesc('최신 백업과 일반 Canvas 내보내기를 갱신·검증합니다. 플러그인을 삭제하지는 않습니다.').addButton(b=>b.setButtonText('제거 준비').onClick(async()=>{b.setDisabled(true);await this.plugin.runBackup(false,true);this.display();}));
    new Setting(this.containerEl).setName('단축키').setDesc('설정 → 단축키에서 Canvas Portal을 검색해 생성과 입장·퇴장 단축키를 변경할 수 있습니다.');
    new Setting(this.containerEl).setName('발광 색상').setDesc('포탈 카드 주변 발광 색상').addColorPicker(c => c.setValue(this.plugin.settings.glowColor).onChange(async value => { this.plugin.settings.glowColor = value; this.plugin.applyColor(); await this.plugin.saveData(this.plugin.settings); }));
  }
}

module.exports = class CanvasPortal extends Plugin {
  async onload() {
    this.settings = { glowColor: '#9966ee', backupFolder:'',autoMinutes:0, ...(await this.loadData()) };
    this.sessions = new Map();
    this.errors = [];
    this.viewHooks=new Map();this.pendingPositions=new WeakMap();
    this.installViewState();
    const local=require('node:path').join(process.env.LOCALAPPDATA||require('node:os').homedir(),'CanvasPortalSafety',S.hash(this.app.vault.adapter.basePath));
    this.safety=S.install(this.app.vault.adapter,local,e=>this.notifyError(e));
    this.register(()=>this.safety.dispose());
    this.addSettingTab(new PortalSettings(this.app, this));
    this.addCommand({ id: 'create-select-portal', name: 'Create Portal · 선택 자료 묶기', checkCallback: checking => {
      const s = this.active(); const enabled = !!s && !s.preview && !s.c.readonly && [...s.c.selection].some(n => s.c.nodes.has(n.id) && M.ref(n.getData())?.role!=='exit');
      if (!checking && enabled) this.askCreate(s); return enabled;
    }});
    this.addCommand({ id: 'toggle-portal', name: '입장·퇴장', hotkeys: [{ modifiers: ['Ctrl'], key: 'Enter' }], checkCallback: checking => {
      const s = this.active(), action = this.navigationAction(s); if (!action) return false;
      if (s.c.wrapperEl.contains(document.activeElement) && document.activeElement.closest('textarea,input,[contenteditable="true"]')) return false;
      if (!checking) this.navigate(s, action); return true;
    }});
    this.addCommand({id:'clone-portal',name:'포탈 복제',checkCallback:checking=>{const s=this.active(),r=s&&this.selectedPortal(s);if(r?.role!=='entry')return false;if(!checking)this.copyPortal(s,r.id);return true;}});
    this.addCommand({id:'unportal',name:'포탈 해제 · 현재 자료 꺼내기',checkCallback:checking=>{const s=this.active(),r=s&&this.selectedPortal(s);if(r?.role!=='entry')return false;if(!checking)this.beginUnportal(s,[r.id]);return true;}});
    this.addCommand({id:'move-portals',name:'다른 포탈로 이동',checkCallback:checking=>{const s=this.active(),ids=s&&this.selectedEntries(s);if(!ids?.length)return false;if(!checking)this.beginMove(s,ids);return true;}});
    this.registerEvent(this.app.workspace.on('layout-change', () => this.discover()));
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.discover()));
    this.registerEvent(this.app.vault.on('rename',(file,oldPath)=>{this.renameTask=(this.renameTask||Promise.resolve()).then(()=>this.renameLinks(oldPath,file.path)).catch(e=>this.notifyError(e));}));
    this.registerEvent(this.app.workspace.on('canvas:selection-menu', (menu, canvas) => {
      const s = [...this.sessions.values()].find(s => s.c === canvas);
      if(s)this.addPortalMenu(s,menu);
    }));
    // Window capture precedes Canvas's native keyboard scope. Resolve customized hotkeys each time.
    this.keyHandler = e => {
      if (e.isComposing) return;
      const s = this.active(); if (!s || !s.c.wrapperEl.contains(e.target)) return;
      if(s.preview){if(e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();this.cancelPreview(s);}return;}
      const action = this.navigationAction(s); if (!action) return;
      if (e.target.closest('textarea,input,[contenteditable="true"]')) return;
      const commandId = `${this.manifest.id}:toggle-portal`;
      const manager = this.app.hotkeyManager;
      const customized = manager?.getHotkeys(commandId);
      const hotkeys = customized === undefined ? [{ modifiers: ['Ctrl'], key: 'Enter' }] : customized;
      if (!hotkeys.some(h => this.matchesKey(e, h))) return;
      e.preventDefault(); e.stopImmediatePropagation(); this.navigate(s, action, e);
    };
    window.addEventListener('keydown', this.keyHandler, true);
    this.register(() => window.removeEventListener('keydown', this.keyHandler, true));
    this.app.workspace.onLayoutReady(() => this.discover());
    this.registerInterval(window.setInterval(() => this.discover(), 1000));
    this.registerInterval(window.setInterval(()=>this.maybeAutoBackup(),10000));
  }

  installViewState(){
    const registry=this.app.viewRegistry,original=registry.viewByType.canvas,plugin=this;
    if(typeof original!=='function')throw Error('Canvas 탭 상태 기능을 찾을 수 없습니다.');
    const factory=function(...args){const v=original.apply(this,args);plugin.hookViewState(v);return v;};
    registry.viewByType.canvas=factory;
    this.register(()=>{if(registry.viewByType.canvas===factory)registry.viewByType.canvas=original;for(const undo of this.viewHooks.values())undo();this.viewHooks.clear();});
    for(const leaf of this.app.workspace.getLeavesOfType('canvas'))if(leaf.view.canvas)this.hookViewState(leaf.view);
  }
  hookViewState(v){
    if(this.viewHooks.has(v))return;
    const get=v.getState,set=v.setState,hadGet=Object.hasOwn(v,'getState'),hadSet=Object.hasOwn(v,'setState'),plugin=this;
    const read=function(...args){const state=get.apply(this,args),s=plugin.sessions.get(v),position=s?plugin.positionState(s):plugin.pendingPositions.get(v);if(position)state.canvasPortalPosition=M.clone(position);return state;};
    const write=async function(state,...args){
      const position=state?.canvasPortalPosition;
      plugin.pendingPositions.delete(v);
      if(position?.version===1)plugin.pendingPositions.set(v,M.clone(position));
      const result=await set.call(this,state,...args);
      plugin.discover();
      const s=plugin.sessions.get(v);
      if(s&&position?.version===1)await plugin.restorePosition(s,position);
      return result;
    };
    v.getState=read;v.setState=write;
    this.viewHooks.set(v,()=>{if(v.getState===read){if(hadGet)v.getState=get;else delete v.getState;}if(v.setState===write){if(hadSet)v.setState=set;else delete v.setState;}});
  }
  positionState(s,seen=new Set()){
    if(s.detaching)return s.lastPosition;
    if(s.restoring)return this.pendingPositions.get(s.v);
    if(seen.has(s)||seen.size>=32)return null;seen.add(s);
    const path=[],visited=new Set();let id=s.current;
    while(id&&!visited.has(id)){visited.add(id);const p=s.root.canvasPortal?.portals[id];if(!p)break;path.unshift(id);id=p.parentId;}
    const result={version:1,file:s.path,path,viewport:{x:s.c.tx,y:s.c.ty,zoom:s.c.tZoom}};
    if(s.linkBack){const owner=s.linkBack.owner;result.link={ownerLeaf:owner.v.leaf.id,portal:s.linkBack.id,owner:this.positionState(owner,seen)};}
    return result;
  }
  requestPositionSave(s){
    if(s.detaching||s.restoring||s.switching)return;
    clearTimeout(s.positionTimer);
    s.positionTimer=setTimeout(()=>{s.positionTimer=null;if(!s.detaching)this.app.workspace.requestSaveLayout();},250);
  }
  async restorePosition(s,position,seen=new Set()){
    if(position.file!==s.path||seen.has(s.path)||seen.size>=32)return;
    seen.add(s.path);s.restoring=true;this.pendingPositions.set(s.v,position);
    try{
      if(position.link?.owner){
        const saved=position.link.owner,file=this.app.vault.getAbstractFileByPath(saved.file);
        if(file?.extension==='canvas'&&!seen.has(saved.file)){
          let owner=[...this.sessions.values()].find(o=>o.v.leaf.id===position.link.ownerLeaf&&o.path===saved.file);
          if(!owner){const leaf=this.app.workspace.getLeavesOfType('canvas').find(l=>l.id===position.link.ownerLeaf&&(l.view.file?.path||l.getViewState().state?.file)===saved.file);if(leaf){await leaf.loadIfDeferred();this.discover();owner=this.sessions.get(leaf.view);}}
          if(!owner){const active=this.app.workspace.activeLeaf,leaf=this.app.workspace.getLeaf('tab');await leaf.openFile(file,{active:false});this.discover();owner=this.sessions.get(leaf.view);if(active)this.app.workspace.setActiveLeaf(active,{focus:false});}
          if(owner){
            await this.restorePosition(owner,saved,new Set(seen));
            const p=owner.root.canvasPortal?.portals[position.link.portal];
            if(p?.type==='link'&&p.target===s.path){
              const sourceText=await this.app.vault.read(s.v.file);
              s.linkBack={owner,id:p.id,leaf:s.v.leaf,sourceText,baseline:JSON.stringify(s.root)};
            }
          }
        }
      }
      let current=null;
      for(const id of position.path||[]){const p=s.root.canvasPortal?.portals[id];if(!p||((p.parentId??null)!==current)||!M.space(s.root,current)?.nodes.some(n=>M.ref(n)?.role==='entry'&&M.ref(n).id===id)||p.type==='link')break;current=id;}
      s.current=current;s.stack=[];
      this.show(s,this.displayData(s));this.decorate(s);
      const viewport=position.viewport;
      if(viewport&&['x','y','zoom'].every(k=>Number.isFinite(viewport[k]))){s.c.zoomToFitQueued=false;s.c.setViewport(viewport.x,viewport.y,viewport.zoom);}
      else s.c.zoomToFit();
    }finally{s.restoring=false;this.pendingPositions.delete(s.v);}
  }

  matchesKey(e, hotkey) {
    const mods = new Set(hotkey.modifiers);
    return String(hotkey.key).toLowerCase() === e.key.toLowerCase() && !!e.ctrlKey === (mods.has('Ctrl') || mods.has('Mod')) && !!e.altKey === mods.has('Alt') && !!e.shiftKey === mods.has('Shift') && !!e.metaKey === mods.has('Meta');
  }
  backupStore(){if(!this.settings.backupFolder)throw Error('설정에서 백업 폴더를 먼저 지정하세요.');return new B.Store(this.app.vault.adapter.basePath,this.settings.backupFolder);}
  canvasFiles(){const folder=this.settings.backupFolder;return this.app.vault.getFiles().filter(f=>f.extension==='canvas'&&(!folder||!f.path.startsWith(folder+'/')));}
  async maybeAutoBackup(){const minutes=this.settings.autoMinutes;if(!minutes||!this.settings.backupFolder||this.backupBusy||this.recoveryBusy||[...this.sessions.values()].some(s=>s.preview)||Date.now()-(this.lastAutoAttempt||0)<minutes*60000)return;this.lastAutoAttempt=Date.now();await this.runBackup(true);}
  async runBackup(automatic=false,prepare=false){
    if(this.backupBusy||this.recoveryBusy||[...this.sessions.values()].some(s=>s.preview)){if(!automatic)new Notice('진행 중인 배치나 백업을 먼저 마쳐 주세요.');return false;}
    this.backupBusy=true;
    try{
      const store=this.backupStore();
      for(const s of this.sessions.values()){this.flushEditors(s);this.capture(s);await s.v.save();}
      const records=[];for(const f of this.canvasFiles()){const root=JSON.parse(await this.app.vault.read(f));if(Object.keys(root.canvasPortal?.portals||{}).length)records.push(B.record(f.path,root));}
      if(!records.length)throw Error('백업할 포탈이 없습니다. 이전 백업은 유지합니다.');
      const fingerprint=B.digest(JSON.stringify(records));if(automatic&&fingerprint===this.backupFingerprint)return true;
      const result=await store.write(records);this.backupFingerprint=fingerprint;
      this.settings.backupStatus=`${prepare?'제거 준비 완료':'백업 완료'} · ${new Date(result.createdAt).toLocaleString()} · Canvas ${records.length}개`;
      await this.saveData(this.settings);if(!automatic)new Notice(this.settings.backupStatus);return true;
    }catch(e){this.settings.backupStatus='백업 실패 · '+e.message;await this.saveData(this.settings);new Notice(this.settings.backupStatus);return false;}
    finally{this.backupBusy=false;}
  }
  async beginRecovery(record,target){
    if(this.backupBusy||this.recoveryBusy||[...this.sessions.values()].some(s=>s.preview))throw Error('진행 중인 작업을 먼저 마쳐 주세요.');
    const latest=await this.backupStore().read(),fresh=latest.records.find(r=>r.source===record.source);
    if(JSON.stringify(fresh)!==JSON.stringify(record))throw Error('백업이 갱신되었습니다. 목록을 다시 열어 주세요.');
    const file=this.app.vault.getAbstractFileByPath(target);if(!file||file.extension!=='canvas'||!this.canvasFiles().includes(file))throw Error('Vault 안의 기존 Canvas를 선택하세요.');
    this.app.setting?.close();
    const leaf=this.app.workspace.getLeaf(false);await leaf.openFile(file);this.discover();const s=this.sessions.get(leaf.view);if(!s)throw Error('Canvas가 준비되지 않았습니다.');
    if(s.linkBack)throw Error('Link에서 퇴장한 후 복원해 주세요.');
    while(s.current)await this.leave(s);
    this.flushEditors(s);this.capture(s);await s.v.save();const baseline=await this.app.vault.read(file),current=M.clone(s.root);
    const draft=B.mergeRecovery(current,record);
    const commit=async offset=>{
      this.recoveryBusy=true;
      try{
        this.flushEditors(s);this.capture(s);if(JSON.stringify(s.root)!==JSON.stringify(current))throw Error('미리보기 중 Canvas가 변경되었습니다. 다시 복원해 주세요.');
        const root=M.clone(draft.root);for(const n of draft.missing){const entry=root.nodes.find(x=>x.id===n.id);entry.x+=offset.x;entry.y+=offset.y;}
        M.validate(root);const text=JSON.stringify(root,null,'\t');s.v.requestSave?.cancel?.();
        await B.atomicRestore(this.app.vault.adapter.basePath,target,baseline,text);
        s.root=root;s.current=null;s.histories.clear();s.archives.clear();this.show(s,root);this.decorate(s);await s.v.save();
        this.cancelPreview(s);new Notice('포탈을 백업 상태로 복원했습니다.');
      }finally{this.recoveryBusy=false;}
    };
    if(!draft.missing.length){await commit({x:0,y:0});return;}
    const host=s.c.wrapperEl.createDiv({cls:'cp-placement-host'}),status=host.createDiv({cls:'cp-placement-status'}),ghosts=host.createDiv({cls:'cp-placement-ghosts'});
    const preview=s.preview={items:draft.missing,bounds:M.bounds(draft.missing),ignored:new Set(),host,status,ghosts,offset:{x:0,y:0},valid:false};
    host.addEventListener('pointermove',e=>this.updatePreview(s,s.c.posFromEvt(e)));
    host.addEventListener('pointerdown',async e=>{e.preventDefault();e.stopImmediatePropagation();if(e.button!==0||this.recoveryBusy)return;this.updatePreview(s,s.c.posFromEvt(e));if(!preview.valid){new Notice('기존 카드와 겹치지 않는 위치를 선택하세요.');return;}try{await commit(preview.offset);}catch(error){this.cancelPreview(s);new Notice('복원하지 못했습니다: '+error.message);}});
    s.c.wrapperEl.focus();this.updatePreview(s,s.c.posCenter());
  }
  notifyError(error) { this.errors.push(String(error)); console.error('[Canvas Portal]', error); new Notice(`Canvas Portal: ${error.message || error}`); }
  active() { const leaf = this.app.workspace.getMostRecentLeaf(); return leaf && this.sessions.get(leaf.view); }
  selectedPortal(s) {
    if (s.busy || s.preview || s.c.selection.size !== 1) return null;
    const n = [...s.c.selection][0]; if (!n?.getData || !s.c.nodes.has(n.id)) return null;
    const r = M.ref(n.getData()); return r && this.portal(s,r.id) ? r : null;
  }
  selectedEntries(s){
    if(s.busy||s.preview||s.c.readonly||!s.c.selection.size)return [];
    const nodes=[...s.c.selection];
    return nodes.every(n=>s.c.nodes.has(n.id)&&M.ref(n.getData())?.role==='entry')?nodes.map(n=>M.ref(n.getData()).id):[];
  }
  navigationAction(s) {
    if(!s || s.busy || s.preview)return null;
    const selected=this.selectedPortal(s);
    if(selected)return {portal:selected};
    // A mixed or multiple-portal selection is ambiguous; never treat it as no portal selected.
    if([...s.c.selection].some(n=>s.c.nodes.has(n.id)&&n.getData&&M.ref(n.getData())))return null;
    return s.current ? {back:'virtual'} : s.linkBack ? {back:'link'} : null;
  }
  navigate(s,action,event=s.c.wrapperEl?.ownerDocument?.defaultView?.event){
    // Obsidian's command handler and our capture listener can receive the same
    // keydown, with a completed async transition between them. Consume its
    // identity once so leaving cannot immediately enter the selected portal again.
    if(event?.type==='keydown'){
      this.navigationEvents ||= new WeakSet();
      if(this.navigationEvents.has(event))return;
      this.navigationEvents.add(event);
    }
    if(action.portal)return this.transition(s,action.portal);
    return action.back==='virtual'?this.leave(s):this.leaveLink(s);
  }
  portal(s,id){return s.root.canvasPortal?.portals[id] || (s.linkBack?.id===id?s.linkBack.owner.root.canvasPortal.portals[id]:null);}
  addPortalMenu(s,menu){
    if(s.preview||s.c.readonly||menu.canvasPortalAdded)return;menu.canvasPortalAdded=true;
    if([...s.c.selection].some(n=>s.c.nodes.has(n.id)&&M.ref(n.getData())?.role!=='exit'))menu.addItem(item=>item.setTitle('Create Portal').setSection('action').setIcon('log-in').onClick(()=>this.askCreate(s)));
    const r=this.selectedPortal(s);if(r?.role==='entry'){menu.addItem(item=>item.setTitle('포탈 복제').setIcon('copy').onClick(()=>this.copyPortal(s,r.id)));menu.addItem(item=>item.setTitle('포탈 해제 · 현재 자료 꺼내기').setIcon('log-out').onClick(()=>this.beginUnportal(s,[r.id])));}
    const ids=this.selectedEntries(s);if(ids.length){menu.addItem(item=>item.setTitle('다른 포탈로 이동').setIcon('folder-input').onClick(()=>this.beginMove(s,ids)));menu.addItem(item=>item.setTitle('포탈 삭제…').setIcon('trash-2').onClick(()=>this.askDelete(s,ids)));}
  }
  currentData(s){return M.space(s.root,s.current);}
  async renameLinks(oldPath,newPath){
    if(this.settings.backupFolder&&(oldPath.startsWith(this.settings.backupFolder+'/')||newPath.startsWith(this.settings.backupFolder+'/')))return;
    const open=new Set();
    for(const s of this.sessions.values()){
      if(s.path===oldPath||s.path.startsWith(oldPath+'/'))s.path=newPath+s.path.slice(oldPath.length);
      open.add(s.path);this.flushEditors(s);this.capture(s);
      const changed=M.syncLinkNames(s.root,oldPath,newPath);
      const archive={nodes:[],canvasPortal:{portals:Object.fromEntries(s.archives)}};M.syncLinkNames(archive,oldPath,newPath);
      for(const history of [s.c.history,...s.histories.values()])for(const graph of history.data||[])M.syncLinkNames(graph,oldPath,newPath);
      if(changed){const viewport={x:s.c.x,y:s.c.y,z:s.c.zoom};this.rememberHistory(s);this.show(s,this.displayData(s));s.c.setViewport(viewport.x,viewport.y,viewport.z);this.decorate(s);await s.v.save();}
    }
    for(const file of this.canvasFiles().filter(f=>!open.has(f.path))){
      const text=await this.app.vault.read(file);if(!text.includes('"canvasPortal"'))continue;
      const data=JSON.parse(text);if(!M.syncLinkNames(data,oldPath,newPath))continue;
      await this.app.vault.process(file,current=>{const root=JSON.parse(current);return M.syncLinkNames(root,oldPath,newPath)?JSON.stringify(root,null,'\t'):current;});
    }
    for(const s of this.sessions.values())this.decorate(s);
    if(this.settings.backupFolder){if(this.backupBusy)throw Error('백업 중 경로가 변경되었습니다. 백업을 다시 실행해 주세요.');this.backupBusy=true;try{await this.backupStore().retarget(oldPath,newPath);}finally{this.backupBusy=false;}}
  }
  flushEditors(s){for(const n of s.c.nodes.values()){const child=n.child;if(!child)continue;child.requestSave?.cancel?.();child.requestSaveFolds?.cancel?.();if(M.ref(n.getData())?.role!=='exit'&&child.editMode&&child.editor)child.save(child.editor.getValue(),true);child.requestSave?.cancel?.();child.requestSaveFolds?.cancel?.();}}
  applyColor() { for (const s of this.sessions.values()) s.c.wrapperEl.style.setProperty('--cp-glow', this.settings.glowColor); }
  discover() {
    for (const leaf of this.app.workspace.getLeavesOfType('canvas')) {
      const v = leaf.view;
      if (!v.canvas || !v.file || this.sessions.has(v)) continue;
      try { this.attach(v); } catch (e) { this.notifyError(e); }
    }
    for (const [v, s] of this.sessions) if (!v.containerEl.isConnected) { this.detach(s); this.sessions.delete(v);const undo=this.viewHooks.get(v);undo?.();this.viewHooks.delete(v); }
  }
  attach(v) {
    this.hookViewState(v);
    const c = v.canvas;
    if (!c.getData || !c.importData || !v.getViewData) throw Error('이 Obsidian의 Canvas 기능을 지원하지 않습니다.');
    const root = M.clone(c.getData());
    const loadedText = v.data || v.lastSavedData;
    if (loadedText && !root.canvasPortal) {
      const loaded = JSON.parse(loadedText);
      if (loaded.canvasPortal) root.canvasPortal = M.clone(loaded.canvasPortal);
    }
    const s = { v, c, path: v.file.path, root, current: null, stack:[], archives:new Map(), menuUndos:new Map(), busy: false, switching: false, histories: new Map(), nodeUndos: new Map(), portalNodes: new Set(), nodesDirty: true, undo: [], frame: null };
    this.sessions.set(v, s);
    if(root.canvasPortal&&this.safety){s.migrationReady=this.safety.store.preserve(s.path,JSON.stringify(root));s.migrationReady.catch(e=>this.notifyError(e));}
    M.normalizeGroups(root);
    const replace = (object, key, factory) => {
      const had = Object.hasOwn(object, key), original = object[key]; if (typeof original !== 'function') return;
      object[key] = factory(original); s.undo.push(() => { if (had) object[key] = original; else delete object[key]; });
    };
    replace(v,'save',original=>async(...args)=>{await s.migrationReady;return original.apply(v,args);});
    replace(c,'markViewportChanged',original=>(...args)=>{const result=original.apply(c,args);this.requestPositionSave(s);return result;});
    replace(v, 'getViewData', original => () => {
      if (s.switching) return JSON.stringify(s.root);
      if (v.file?.path !== s.path) { s.path = v.file?.path; s.current = null; s.histories.clear(); s.root = M.clone(c.getData()); }
      this.capture(s);
      if(s.preservedSource&&JSON.stringify(s.root)===s.preservedSource.baseline)return s.preservedSource.sourceText;
      if (!s.root.canvasPortal&&!s.linkBack) return original.call(v);
      M.validate(s.root);
      if(s.linkBack&&JSON.stringify(s.root)===s.linkBack.baseline)return s.linkBack.sourceText;
      return JSON.stringify(s.root, null, '\t');
    });
    replace(v, 'setViewData', original => (text, clear) => {
      if(s.lifecycleWriting)return;
      const parsed = JSON.parse(text);
      if (parsed.canvasPortal && parsed.canvasPortal.version !== 1) throw Error('지원하지 않는 포탈 데이터 버전');
      if(Object.values(parsed.canvasPortal?.portals||{}).some(p=>p.type==='group')){s.migrationReady=this.safety.store.preserve(v.file.path,text);s.migrationReady.catch(e=>this.notifyError(e));M.normalizeGroups(parsed);text=JSON.stringify(parsed);}
      // A save from another tab reloads this view too. Keep its current portal
      // and camera when that space still exists in the same Canvas.
      const sameFile=s.path===v.file?.path,current=sameFile&&s.current&&parsed.canvasPortal?.portals[s.current]?s.current:null;
      const viewport={x:c.x,y:c.y,zoom:c.zoom},previous=s.root;
      const histories=new Map();
      if(sameFile)for(const [id,history]of s.histories){
        const before=id==='main'?M.graph(previous):previous.canvasPortal?.portals[id]?.graph;
        const after=id==='main'?M.graph(parsed):parsed.canvasPortal?.portals[id]?.graph;
        if(before&&after&&JSON.stringify(before)===JSON.stringify(after))histories.set(id,history);
      }
      this.cancelPreview(s);s.root = M.clone(parsed); s.path = v.file?.path; s.current = current; s.stack=[]; s.histories=histories;s.archives.clear();
      const switching = s.switching; s.switching = true;
      try {
        const result=original.call(v, text, clear);
        if(sameFile&&(s.current||s.linkBack)){this.show(s,this.displayData(s));c.setViewport(viewport.x,viewport.y,viewport.zoom);}
        return result;
      }
      finally { s.switching = switching; this.queue(s); }
    });
    replace(c, 'addNode', original => n => {
      const result = original.call(c, n); s.nodesDirty = true; this.queue(s); return result;
    });
    replace(c, 'removeNode', original => n => {
      if (s.switching || s.rebuilding) { const result = original.call(c, n); s.nodesDirty = true; this.queue(s); return result; }
      const r = M.ref(n.getData());
      if (r?.role === 'exit') { new Notice('퇴장 포탈 카드는 삭제할 수 없습니다.'); return; }
      if (r?.role === 'entry') { this.askDelete(s,[r.id]); return; }
      const result = original.call(c, n); s.nodesDirty = true; this.queue(s); return result;
    });
    replace(c,'deleteSelection',original=>(...args)=>{
      const entries=[...c.selection].map(n=>n.getData?.()).filter(n=>M.ref(n)?.role==='entry');
      if(!entries.length)return original.apply(c,args);
      const ordinary=[...c.selection].map(n=>n.getData?.()).filter(n=>n&&!M.ref(n)).map(n=>n.id);
      this.askDelete(s,entries.map(n=>M.ref(n).id),ordinary);
    });
    replace(c, 'getSelectionData', original => (...args) => {
      this.capture(s);
      const d = original.apply(c, args), blocked = new Set(d.nodes.filter(n => M.ref(n)?.role==='exit').map(n => n.id));
      if (blocked.size) {
        d.nodes = d.nodes.filter(n => !blocked.has(n.id)); d.edges = d.edges.filter(e => !blocked.has(e.fromNode) && !blocked.has(e.toNode));
        if (d.nodes.length) d.center = {
          x: (Math.min(...d.nodes.map(n => n.x)) + Math.max(...d.nodes.map(n => n.x + n.width))) / 2,
          y: (Math.min(...d.nodes.map(n => n.y)) + Math.max(...d.nodes.map(n => n.y + n.height))) / 2
        };
      }
      const portals={};for(const n of d.nodes){const r=M.ref(n);if(r?.role==='entry')for(const id of M.descendants(s.root,r.id))portals[id]=M.clone(s.root.canvasPortal.portals[id]);}
      if(Object.keys(portals).length)d.canvasPortalTransfer={version:1,portals};
      return d;
    });
    replace(c,'cloneData',original=>(data,offset)=>{
      if(!data.canvasPortalTransfer&&data.nodes?.some(n=>M.ref(n))){new Notice('포탈을 복사하려면 Canvas Portal이 켜진 상태에서 다시 복사하세요.');return {nodes:[],edges:[]};}
      if(!data.canvasPortalTransfer)return original.call(c,data,offset);
      try{this.capture(s);const result=M.pasteTransfer(s.root,data,s.current,offset||{x:0,y:0});s.root.canvasPortal=result.root.canvasPortal;return {nodes:result.nodes,edges:result.edges};}
      catch(e){this.notifyError(e);return {nodes:[],edges:[]};}
    });
    replace(c,'pushHistory',original=>data=>{
      const next={nodes:data.nodes,edges:data.edges,cpLifecycle:s.lifecycleRevision||0};
      if(s.lifecycleDedup){const last=c.history.data[c.history.current];if(last&&(last.cpLifecycle||0)===next.cpLifecycle&&canonical(M.graph(last))===canonical(M.graph(next)))return;s.lifecycleDedup=false;}
      return original.call(c,next);
    });
    replace(c,'overrideHistory',original=>(...args)=>{const result=original.apply(c,args),data=c.history.data[c.history.current];if(data)data.cpLifecycle=s.lifecycleRevision||0;return result;});
    for(const [method,step]of [['undo',-1],['redo',1]])replace(c,method,original=>(...args)=>{
      if(s.busy||s.preview||s.deleteModal)return;
      const next=c.history.data[c.history.current+step];
      if(next&&(next.cpLifecycle||0)!==(s.lifecycleRevision||0))return this.restoreLifecycle(s,next,c.history.current+step);
      return original.apply(c,args);
    });
    replace(c, 'applyHistory', original => data => {
      if (s.current) {
        const p = s.root.canvasPortal.portals[s.current], exit = p.graph.nodes.find(n => n.id === p.exitId);
        data = M.clone(data);
        if (!data.nodes.some(n => n.id === p.exitId)) data.nodes.push(M.clone(exit));
      }
      if(!s.current&&s.linkBack){data=M.clone(data);const p=this.portal(s,s.linkBack.id);if(!data.nodes.some(n=>n.id===p.exitId))data.nodes.push(M.clone(p.graph.nodes[0]));}
      this.revive(s,data);
      const result = original.call(c, data); this.capture(s); this.queue(s); return result;
    });
    replace(c, 'importData', original => (...args) => {
      const rebuilding = s.rebuilding; s.rebuilding = true;
      try {
        // Native import keeps an existing node's constructor even if its type changed.
        for(const data of args[0]?.nodes||[]){const old=c.nodes.get(data.id);if(old&&old.getData().type!==data.type)c.removeNode(old);}
        return original.apply(c, args);
      }
      finally { s.rebuilding = rebuilding; s.nodesDirty = true; this.queue(s); }
    });
    replace(c,'clear',original=>(...args)=>{const rebuilding=s.rebuilding,switching=s.switching;s.rebuilding=true;s.switching=true;try{return original.apply(c,args);}finally{s.rebuilding=rebuilding;s.switching=switching;s.nodesDirty=true;this.queue(s);}});
    replace(c, 'virtualize', original => (...args) => this.batchViewportUnmount(s, original, args));
    replace(c, 'handlePaste', original => (...args) => {
      const result = original.apply(c, args); this.queue(s); return result;
    });
    s.double = e => {
      if (!e.ctrlKey) return;
      const element = e.target.closest('.canvas-node'); if (!element) return;
      const node = [...c.nodes.values()].find(n => n.nodeEl === element), r = node && M.ref(node.getData());
      if (!r || !this.portal(s,r.id)) return;
      e.preventDefault(); e.stopImmediatePropagation(); this.transition(s, r);
    };
    // Capture at the window so native node editing never consumes Ctrl+doubleclick.
    s.doubleWindow = e => { if (c.wrapperEl.contains(e.target)) s.double(e); };
    window.addEventListener('dblclick', s.doubleWindow, true);
    s.observer = new MutationObserver(() => this.queue(s));
    // Portal child replacement is handled by its render hook. Ordinary Markdown
    // and toolbar mutations do not require revisiting every card in the Canvas.
    s.observer.observe(c.canvasEl, { childList: true });
    c.wrapperEl.style.setProperty('--cp-glow', this.settings.glowColor);
    this.queue(s);
  }
  batchViewportUnmount(s, original, args) {
    const c = s.c;
    if (s.batchingUnmount || c.zoom > c.zoomBreakpoint || typeof c.getIntersectingNodes !== 'function' || typeof c.getViewportBBox !== 'function') return original.apply(c, args);
    const restores = [], writes = [];
    s.batchingUnmount = true;
    try {
      // Native unmount reads scroll positions, then detaches each card's body.
      // Keep those native reads and state changes, but apply the DOM writes
      // together so the next card does not force another style/layout pass.
      for (const n of c.getIntersectingNodes(c.getViewportBBox())) {
        if (n.getData?.().type !== 'text' || !n.initialized || !n.isContentMounted || n.alwaysKeepLoaded || n.isEditing || Object.hasOwn(n, 'unmountContent') || typeof n.unmountContent !== 'function') continue;
        if (!n.contentEl || !n.contentBlockerEl || !n.containerEl || typeof n.contentEl.detach !== 'function' || typeof n.contentBlockerEl.detach !== 'function') continue;
        const unmount = n.unmountContent;
        n.unmountContent = function (...values) {
          const undo = [];
          try {
            for (const [el, key] of [[this.contentEl, 'detach'], [this.contentBlockerEl, 'detach'], [this.containerEl, 'appendChild']]) {
              const own = Object.hasOwn(el, key), method = el[key];
              el[key] = function (...inputs) { writes.push(() => method.apply(this, inputs)); return key === 'appendChild' ? inputs[0] : undefined; };
              undo.push(() => { if (own) el[key] = method; else delete el[key]; });
            }
            return unmount.apply(this, values);
          } finally { undo.reverse().forEach(restore => restore()); }
        };
        restores.push(() => { delete n.unmountContent; });
      }
      return original.apply(c, args);
    } finally {
      restores.reverse().forEach(restore => restore());
      try { for (const write of writes) write(); }
      finally { s.batchingUnmount = false; }
    }
  }
  capture(s) {
    if (s.capturing || s.switching) return;
    s.capturing = true;
    try {
      // Keep the canonical portal registry below; do not clone and then discard
      // every hidden graph whenever the visible space is captured.
      const d = M.clone({ ...s.c.getData(), canvasPortal: undefined, cpLifecycle:undefined });
      if(!s.current&&s.linkBack){
        const p=this.portal(s,s.linkBack.id),exit=d.nodes.find(n=>n.id===p.exitId);
        if(exit&&JSON.stringify(exit)!==JSON.stringify(p.graph.nodes[0])){p.graph.nodes[0]={...exit,text:M.cardText(p.name,p.displayId)};s.linkBack.owner.v.requestSave();}
        d.nodes=d.nodes.filter(n=>n.id!==p.exitId);d.edges=d.edges.filter(e=>e.fromNode!==p.exitId&&e.toNode!==p.exitId);
      }
      if (s.current) {
        const p = s.root.canvasPortal.portals[s.current];
        const exit = d.nodes.find(n => n.id === p.exitId);
        if (!exit) throw Error('퇴장 포탈을 찾을 수 없어 저장을 중단했습니다.');
        exit.text = M.cardText(p.name, p.displayId);
        p.graph = { nodes: d.nodes || [], edges: d.edges || [] };
      } else {
        const metadata = s.root.canvasPortal;
        s.root = d;
        if (metadata) s.root.canvasPortal = metadata;
      }
        for (const n of this.currentData(s).nodes) {
          const r = M.ref(n); if (r?.role !== 'entry') continue;
          this.revive(s,{nodes:[n]});const p=s.root.canvasPortal?.portals[r.id];if(!p)continue;
          p.name = M.title(n.text); n.text = M.cardText(p.name, p.displayId);
          const exit = p.graph.nodes.find(n => n.id === p.exitId);
          if (exit) exit.text = M.cardText(p.name, p.displayId);
        }
      this.syncRegistry(s);M.syncLinkNames(s.root);
    } finally { s.capturing = false; }
  }
  revive(s,data){
    const seen=new Set(),visit=id=>{if(seen.has(id))return;seen.add(id);let p=s.root.canvasPortal?.portals[id];if(!p){const saved=s.archives.get(id);if(!saved)throw Error('실행 취소할 포탈 정보를 찾을 수 없습니다.');s.root.canvasPortal||={version:1,canvasId:M.uid(),portals:{}};p=s.root.canvasPortal.portals[id]=M.clone(saved);}for(const n of p.graph.nodes)if(M.ref(n)?.role==='entry')visit(M.ref(n).id);};
    for(const n of data.nodes||[])if(M.ref(n)?.role==='entry')visit(M.ref(n).id);
  }
  syncRegistry(s){
    if(!s.root.canvasPortal)return;
    const seen=new Set(),visit=(nodes,parentId)=>{for(const n of nodes){const r=M.ref(n);if(r?.role!=='entry')continue;if(seen.has(r.id))throw Error('같은 포탈이 중복 연결되어 있습니다.');seen.add(r.id);const p=s.root.canvasPortal.portals[r.id];if(!p)throw Error('포탈 데이터가 없습니다.');if(parentId!==null||Object.hasOwn(p,'parentId'))p.parentId=parentId;visit(p.graph.nodes,r.id);}};
    visit(s.root.nodes,null);
    for(const [id,p] of Object.entries(s.root.canvasPortal.portals))if(!seen.has(id)){s.archives.set(id,M.clone(p));delete s.root.canvasPortal.portals[id];}
  }
  queue(s) {
    if (s.frame != null) return;
    s.frame = requestAnimationFrame(() => { s.frame = null; if (this.sessions.has(s.v)) this.decorate(s); });
  }
  bindNodeMenu(s, n) {
    if (s.menuUndos.has(n) || typeof n.showMenu !== 'function') return;
    // Separate closure scope: a menu must not retain a replaced portal record
    // through the decoration loop's shared lexical context.
    const had = Object.hasOwn(n, 'showMenu'), original = n.showMenu;
    n.showMenu = menu => { original.call(n, menu); this.addPortalMenu(s, menu); };
    s.menuUndos.set(n, () => { if (had) n.showMenu = original; else delete n.showMenu; });
  }
  decorate(s) {
    if (s.nodesDirty) {
      for(const [n,restore] of s.menuUndos)if(s.c.nodes.get(n.id)!==n){restore();s.menuUndos.delete(n);}
      s.portalNodes.clear();
      for (const n of s.c.nodes.values()) {
        this.bindNodeMenu(s, n);
        if (M.ref(n.getData())) s.portalNodes.add(n);
      }
      s.nodesDirty = false;
    }
    for (const [old, restore] of s.nodeUndos) {
      const r = M.ref(old.getData());
      if (s.c.nodes.get(old.id) !== old || !r || restore.record !== this.portal(s, r.id) || restore.role !== r.role) {
        restore(); s.nodeUndos.delete(old);
      }
    }
    for (const n of s.portalNodes) {
      const r = M.ref(n.getData()), p = r && this.portal(s,r.id);
      if (!r || !p || !n.nodeEl) continue;
      n.nodeEl.classList.add('cp-portal', r.role === 'entry' ? 'cp-entry' : 'cp-exit');
      let marker = n.nodeEl.querySelector(':scope > .cp-marker');
      if (!marker) { marker = document.createElement('div'); marker.className = 'cp-marker'; n.nodeEl.appendChild(marker); if (r.role === 'entry') { const icon = marker.createSpan({ cls: 'cp-enter-icon' }); setIcon(icon, p.type==='link'?'link':'log-in');icon.setAttribute('aria-label',p.type==='link'?'Link 포탈':'입장 포탈'); } marker.createSpan({ cls: 'cp-display-id', text: p.displayId }); }
      const styled=r.role==='entry'&&p.type!=='link';
      n.nodeEl.classList.toggle('cp-large-entry',styled);
      let large=n.nodeEl.querySelector(':scope > .cp-large-icon');
      if(styled&&!large){large=n.nodeEl.createDiv({cls:'cp-large-icon',attr:{'aria-hidden':'true'}});setIcon(large,'log-in');}
      if(!styled)large?.remove();
      if(styled){const width=Math.max(1,n.width),height=Math.max(1,n.height),size=Math.max(8,Math.min(64,width*.20,height*.45)),gap=Math.max(4,Math.min(24,width*.07));n.nodeEl.style.setProperty('--cp-icon-size',size+'px');n.nodeEl.style.setProperty('--cp-icon-gap',gap+'px');}
      const id = marker.querySelector('.cp-display-id'); if (id.textContent !== p.displayId) id.textContent = p.displayId;
      if(p.type==='link'){
        let filename=marker.querySelector('.cp-link-filename');
        if(!filename)filename=marker.createSpan({cls:'cp-link-filename'});
        const label=M.fileTitle(p.target);if(filename.textContent!==label)filename.textContent=label;
        filename.title=p.target;
      }
      if (!s.nodeUndos.has(n)) {
        const restorers = [];
        const patch = (key, factory) => { const original = n[key], had = Object.hasOwn(n, key); if (typeof original !== 'function') return; n[key] = factory(original); restorers.push(() => { if (had) n[key] = original; else delete n[key]; }); };
        patch('setData', original => (data, ...args) => {
          if (r.role === 'exit') data = { ...data, text: M.cardText(p.name, p.displayId), canvasPortalRef: r };
          else if (data.text != null) { p.name = M.title(data.text); data = { ...data, text: M.cardText(p.name, p.displayId), canvasPortalRef: r }; }
          const result=original.call(n, data, ...args);this.queue(s);return result;
        });
        {
          let child = null, restoreChild = null;
          const cleanEditor = () => {
            if (!n.child || n.child === child || typeof n.child.set!=='function') return;
            restoreChild?.();
            child = n.child;
            const originalSet = child.set, had = Object.hasOwn(child, 'set'), target = child;
            // Keep the persistent ID in saved Canvas data, outside the native editor's text.
            target.set = (text, ...args) => originalSet.call(target, M.title(text), ...args);
            const editable = target.editable;
            if (r.role === 'exit') { target.editable = false; target.showPreview(); n.setIsEditing(false); }
            restoreChild = () => { if (had) target.set = originalSet; else delete target.set; target.editable = editable; };
            target.set(n.text);
          };
          patch('render', original => (...args) => { const result = original.apply(n, args); cleanEditor(); return result; });
          cleanEditor();
          restorers.push(() => { restoreChild?.(); if (child && n.child === child && !n.destroyed && n.nodeEl.isConnected) child.set(n.text); });
        }
        if (r.role === 'exit') {
          patch('setIsEditing', original => (editing, ...args) => { if (editing) return; return original.call(n, editing, ...args); });
          patch('startEditing', _original => () => {});
          patch('setText', original => () => original.call(n, M.cardText(p.name, p.displayId)));
          if(r.role==='exit')patch('setColor', _original => () => {});
        }
        patch('convertToFile', _original => () => { new Notice('포탈 카드는 Markdown 파일로 변환할 수 없습니다.'); });
        const restore = () => { restorers.reverse().forEach(fn => fn()); n.nodeEl?.classList.remove('cp-portal', 'cp-entry', 'cp-exit','cp-large-entry');n.nodeEl?.querySelector(':scope > .cp-large-icon')?.remove();n.nodeEl?.style.removeProperty('--cp-icon-size');n.nodeEl?.style.removeProperty('--cp-icon-gap'); marker.remove(); };
        restore.record = p; restore.role = r.role;
        s.nodeUndos.set(n, restore);
      }
    }
  }
  askCreate(s) {
    if(s.preview)return;
    const selected=[...s.c.selection].map(n=>n.getData());
    if(selected.length===1&&selected[0].type==='file'&&selected[0].file.toLowerCase().endsWith('.canvas')){this.create(s,M.fileTitle(selected[0].file));return;}
    new PortalNameModal(this.app, name => this.create(s, name),selected.length===1&&selected[0].type==='group'?selected[0].label:'새 포탈').open();
  }
  async create(s, name) {
    if (s.busy) return; s.busy = true;
    try {
      this.flushEditors(s);this.capture(s);
      const ids = [...s.c.selection].filter(n => s.c.nodes.has(n.id)).map(n => n.id);
      const { root, entryId, portalId } = M.createPortal(s.root, ids, name,s.current); M.validate(root);
      await this.commitRoot(s,root,[entryId]);new Notice('포탈을 만들었습니다. Ctrl+Enter로 입장하세요.');
    } catch (e) { this.notifyError(e); } finally { s.busy = false; }
  }
  async commitRoot(s,root,selected=[],save=true){
    M.validate(root);this.rememberHistory(s);
    for(const [id,p] of Object.entries(s.root.canvasPortal?.portals||{}))if(!root.canvasPortal.portals[id])s.archives.set(id,M.clone(p));
    const revision=s.lifecycleRevision||0;s.root=root;this.show(s,this.displayData(s));s.lifecycleRevision=revision;s.c.pushHistory(M.graph(s.c.getData()));s.c.deselectAll();for(const id of selected){const n=s.c.nodes.get(id);if(n)s.c.select(n);}this.decorate(s);if(save)await s.v.save();
  }
  displayData(s){const data=M.clone(this.currentData(s));if(!s.current&&s.linkBack)data.nodes.push(M.clone(this.portal(s,s.linkBack.id).graph.nodes[0]));return data;}
  rememberHistory(s) {
    s.c.requestPushHistory?.run?.();
    s.histories.set(s.current || 'main', { data: s.c.history.data.map(historyGraph), current: s.c.history.current });
  }
  show(s, data) {
    s.switching = true;
    try {
      s.c.requestPushHistory?.cancel?.();
      // importData updates nodes/edges but does not adopt new top-level metadata.
      s.c.data = M.clone(data);
      s.c.importData(M.clone(data), true);
      s.c.getData();
      const history = s.histories.get(s.current || 'main');
      s.c.history.data = history?.data.length ? M.clone(history.data) : [M.graph(data)];
      s.c.history.current = history?.data.length ? history.current : 0;
      s.lifecycleRevision=s.c.history.data[s.c.history.current]?.cpLifecycle||0;
      s.c.updateHistoryUI();
    }
    finally { s.switching = false; }
    this.queue(s);
  }
  transition(s, r) {if(r.role==='entry')return this.enter(s,r.id);if(r.role==='exit'&&s.current===r.id)return this.leave(s);if(r.role==='exit'&&s.linkBack?.id===r.id)return this.leaveLink(s);}
  selectLeftmostCard(s){
    const cards=[...s.c.nodes.values()].filter(n=>{
      const data=n.getData();return data.type!=='group'&&M.ref(data)?.role!=='exit';
    });
    cards.sort((a,b)=>a.x-b.x||a.y-b.y||String(a.id).localeCompare(String(b.id)));
    if(cards.length)s.c.selectOnly(cards[0]);else s.c.deselectAll();
  }
  async enter(s, id) {
    if (s.busy) return; s.busy = true;
    try {
      this.flushEditors(s);this.capture(s);const p=s.root.canvasPortal.portals[id];if(!p)throw Error('포탈 정보가 없습니다.');
      if(!this.currentData(s).nodes.some(n=>M.ref(n)?.id===id&&M.ref(n)?.role==='entry'))throw Error('현재 공간의 입장 카드가 아닙니다.');
      if(p.type==='link'){await this.enterLink(s,p);return;}
      await s.v.save();
      this.rememberHistory(s);
      s.stack.push({parentId:s.current});s.current = id; this.show(s, p.graph); this.decorate(s);
      this.selectLeftmostCard(s);s.c.zoomToFit();
      s.c.wrapperEl.focus(); await s.v.save();
    } catch (e) { this.notifyError(e); } finally { s.busy = false; }
  }
  async leave(s) {
    if (s.busy || !s.current) return; s.busy = true;
    try {
      const p=s.root.canvasPortal.portals[s.current],entryId=p.entryId;
      this.flushEditors(s);this.capture(s);await s.v.save();this.rememberHistory(s);s.current=s.stack.pop()?.parentId??p.parentId??null;this.show(s,this.displayData(s));this.decorate(s);
      const entry = s.c.nodes.get(entryId);
      if (!entry) throw Error('돌아갈 입장 포탈 카드를 찾을 수 없습니다.');
      s.c.selectOnly(entry); s.c.zoomToSelection();
      s.c.wrapperEl.focus(); await s.v.save();
    } catch (e) { this.notifyError(e); } finally { s.busy = false; }
  }
  leaveActive(){const s=this.active();if(s?.preview)return;if(s?.current)this.leave(s);else if(s?.linkBack)this.leaveLink(s);}
  async enterLink(owner,p){
    const file=this.app.vault.getAbstractFileByPath(p.target);if(!file||file.extension!=='canvas')throw Error('연결된 Canvas 파일을 찾을 수 없습니다.');
    const sourceText=await this.app.vault.read(file),leaf=this.app.workspace.getLeaf('tab');
    try{
      await leaf.openFile(file);this.discover();const s=this.sessions.get(leaf.view);if(!s)throw Error('Link Canvas를 열 수 없습니다.');
      this.capture(s);
      if(!p.linkExitPlaced){const b=M.bounds(s.root.nodes);Object.assign(p.graph.nodes[0],{x:b.x-320,y:b.y-190});p.linkExitPlaced=true;}
      await owner.v.save();
      s.linkBack={owner,id:p.id,leaf,sourceText,baseline:JSON.stringify(s.root)};
      const cached=owner.histories.get('link:'+p.id);if(cached)s.histories.set('main',M.clone(cached));
      this.show(s,this.displayData(s));this.decorate(s);this.selectLeftmostCard(s);s.c.zoomToFit();s.c.wrapperEl.focus();
    }catch(e){leaf.detach();throw e;}
  }
  async leaveLink(s){
    if(s.busy||!s.linkBack)return;s.busy=true;
    try{
      this.flushEditors(s);this.capture(s);await s.v.save();this.rememberHistory(s);
      const back=s.linkBack,p=this.portal(s,back.id);back.owner.histories.set('link:'+back.id,M.clone(s.histories.get('main')));await back.owner.v.save();
      s.preservedSource={baseline:back.baseline,sourceText:back.sourceText};s.linkBack=null;
      // Remove the temporary node before any native unload serialization.
      this.show(s,s.root);s.v.requestSave.cancel?.();
      this.detach(s);this.sessions.delete(s.v);back.leaf.detach();
      this.app.workspace.setActiveLeaf(back.owner.v.leaf,{focus:true});
      const entry=back.owner.c.nodes.get(p.entryId);if(entry){back.owner.c.selectOnly(entry);back.owner.c.zoomToSelection();back.owner.c.setViewport(entry.x+entry.width/2,entry.y+entry.height/2,back.owner.c.tZoom);back.owner.c.wrapperEl.focus();}
    }catch(e){this.notifyError(e);}finally{s.busy=false;}
  }
  async copyPortal(s,id){
    if(s.busy||s.preview)return;s.busy=true;
    try{this.flushEditors(s);this.capture(s);const result=M.clonePortal(s.root,id,s.current);await this.commitRoot(s,result.root,[result.entryId]);new Notice('독립 포탈을 복제했습니다.');}
    catch(e){this.notifyError(e);}finally{s.busy=false;}
  }
  askDelete(s,ids,ordinary=[]){
    if(s.busy||s.preview||s.deleteModal||s.c.readonly)return;
    s.deleteModal=new PortalDeleteModal(this,s,ids,ordinary);s.deleteModal.open();
  }
  async deleteContents(s,ids,ordinary){
    if(s.busy||s.preview||s.c.readonly)return;s.busy=true;
    try{this.flushEditors(s);this.capture(s);await this.commitRoot(s,M.deletePortals(s.root,ids,s.current,ordinary).root);new Notice('포탈과 내부 카드를 삭제했습니다. 원본 파일은 유지됩니다.');}
    catch(e){this.notifyError(e);}finally{s.busy=false;}
  }
  beginMove(s,ids){
    if(s.busy||s.preview||s.c.readonly)return;
    this.flushEditors(s);this.capture(s);
    const host=s.c.wrapperEl.createDiv({cls:'cp-placement-host cp-move-host'}),status=host.createDiv({cls:'cp-placement-status',text:'목적지 포탈을 클릭하세요 · Esc 취소'});
    s.preview={kind:'move',host,status,ids};
    host.addEventListener('pointerdown',async e=>{
      e.preventDefault();e.stopImmediatePropagation();if(e.button!==0||s.busy)return;
      const pos=s.c.posFromEvt(e),node=[...s.c.nodes.values()].reverse().find(n=>pos.x>=n.x&&pos.x<=n.x+n.width&&pos.y>=n.y&&pos.y<=n.y+n.height&&M.ref(n.getData())?.role==='entry');
      if(!node){status.setText('목적지 포탈 카드를 클릭하세요 · Esc 취소');return;}
      const id=M.ref(node.getData()).id;if(ids.includes(id)){status.setText('옮길 포탈 자신은 목적지가 될 수 없습니다 · Esc 취소');return;}
      s.busy=true;
      try{await this.moveSelection(s,ids,id);this.cancelPreview(s);new Notice('포탈을 옮겼습니다. 바깥 연결선은 제거했습니다.');}
      catch(error){status.setText(error.message+' · Esc 취소');new Notice(error.message);}
      finally{s.busy=false;}
    });
    s.c.wrapperEl.focus();
  }
  async changeFile(file,expected,next){
    await this.app.vault.process(file,text=>{if(text!==expected&&canonical(JSON.parse(text))!==canonical(JSON.parse(expected)))throw Error('Canvas가 변경되었습니다. 다시 시도해 주세요.');return next;});
  }
  async moveSelection(s,ids,destinationId){
    this.flushEditors(s);this.capture(s);M.selectedEntries(s.root,ids,s.current);
    const destination=s.root.canvasPortal.portals[destinationId];
    if(!destination||!this.currentData(s).nodes.some(n=>M.ref(n)?.id===destinationId))throw Error('목적지 포탈을 다시 선택하세요.');
    let external=null,result;
    if(destination.type==='link'){
      if(destination.target===s.path)throw Error('현재 Canvas 자신을 가리키는 Link로는 옮길 수 없습니다.');
      const file=this.app.vault.getAbstractFileByPath(destination.target);if(!file||file.extension!=='canvas')throw Error('연결된 Canvas를 찾을 수 없습니다.');
      for(const id of ids)for(const child of M.descendants(s.root,id)){const p=s.root.canvasPortal.portals[child];if(p.type==='link'&&p.target===file.path)throw Error('목적지 Canvas를 가리키는 포탈은 그 Canvas 안으로 옮길 수 없습니다.');}
      for(const other of this.sessions.values())if(other.path===file.path){if(other.busy||other.preview)throw Error('목적지 Canvas의 진행 중인 작업을 먼저 마쳐 주세요.');this.flushEditors(other);this.capture(other);await other.v.save();}
      const text=await this.app.vault.read(file),target=M.rootData(JSON.parse(text));
      result=M.movePortals(s.root,ids,s.current,null,target);
      external={file,before:text,after:JSON.stringify(result.target,null,'\t')};
    }else result=M.movePortals(s.root,ids,s.current,destinationId);
    await this.commitMove(s,result.root,external);
  }
  async commitMove(s,root,external){
    this.rememberHistory(s);await s.v.save();
    const before=M.clone(s.root),beforeText=await this.app.vault.read(s.v.file),afterText=JSON.stringify(root,null,'\t');
    const previous=s.lifecycleRevision||0,revision=(s.lifecycleSequence||0)+1;
    await this.writeMoveFiles(s,beforeText,afterText,external);
    s.lifecycleSequence=revision;s.lifecycleRevision=revision;
    await this.commitRoot(s,root,[],false);this.capture(s);
    s.lifecycleDedup=true;
    // Native history stores visible cards only. Keep a snapshot only for a move boundary.
    s.lifecycleRecords??=new Map();s.lifecycleRecords.set(revision,{previous,revision,parent:s.current,before,after:M.clone(s.root),external});
    const retained=new Set(s.c.history.data.map(d=>d.cpLifecycle||0));
    for(const [key,history]of s.histories)if(key!==(s.current||'main'))for(const d of history.data)retained.add(d.cpLifecycle||0);
    for(const id of s.lifecycleRecords.keys())if(!retained.has(id))s.lifecycleRecords.delete(id);
  }
  async writeMoveFiles(s,beforeText,afterText,external){
    const affected=[...this.sessions.values()].filter(other=>other.path===s.path||other.path===external?.file.path);
    const locks=affected.map(other=>[other,other.c.readonly]);
    for(const [other]of locks){other.c.setReadonly(true);other.v.requestSave?.cancel?.();other.lifecycleWriting=true;}
    let targetWritten=false;
    try{
      if(external){await this.changeFile(external.file,external.before,external.after);targetWritten=true;}
      await this.changeFile(s.v.file,beforeText,afterText);
    }catch(error){
      if(targetWritten)try{await this.changeFile(external.file,external.after,external.before);}catch(rollback){throw Error('원본은 유지했지만 목적지 복구에 실패했습니다. 양쪽 Canvas를 확인하세요: '+rollback.message);}
      throw error;
    }finally{for(const [other,readonly]of locks){other.lifecycleWriting=false;other.c.setReadonly(readonly);}}
    for(const [other]of locks)if(other!==s){const text=other.path===s.path?afterText:external.after;await other.v.setViewData(text,false);}
  }
  async restoreLifecycle(s,data,index){
    const current=s.lifecycleRevision||0,wanted=data.cpLifecycle||0;
    const undo=s.lifecycleRecords?.get(current),redo=s.lifecycleRecords?.get(wanted);
    const record=undo?.previous===wanted?undo:redo?.previous===current?redo:null;
    if(!record||record.parent!==s.current){new Notice('다른 공간에서 변경된 이동 기록은 되돌릴 수 없습니다.');return;}
    const backwards=record===undo,expected=backwards?record.after:record.before,next=M.clone(backwards?record.before:record.after);
    s.busy=true;
    try{
      this.flushEditors(s);this.capture(s);
      const hidden=root=>{const copy=M.clone(root),g=M.space(copy,s.current);g.nodes=[];g.edges=[];return canonical(copy);};
      if(hidden(s.root)!==hidden(expected))throw Error('이동 후 내부 내용이 변경되었습니다. 내부 변경을 먼저 되돌려 주세요.');
      const g=M.space(next,s.current);Object.assign(g,M.graph(data));M.validate(next);
      await s.v.save();const beforeText=await this.app.vault.read(s.v.file);
      let external=record.external;
      if(external&&backwards)external={file:external.file,before:external.after,after:external.before};
      await this.writeMoveFiles(s,beforeText,JSON.stringify(next,null,'\t'),external);
      s.root=next;s.lifecycleRevision=wanted;s.c.history.current=index;
      s.c.applyHistory(data);s.lifecycleDedup=true;this.decorate(s);
    }catch(e){new Notice(e.message);}finally{s.busy=false;}
  }
  async beginUnportal(s,ids,deleteIds=[],deleting=false){
    if(s.busy||s.preview)return;
    try{
      this.flushEditors(s);this.capture(s);
      const links=ids.filter(id=>s.root.canvasPortal.portals[id]?.type==='link'),virtual=ids.filter(id=>!links.includes(id));
      if(!virtual.length){
        let root=M.clone(s.root);
        if(deleting){const parent=M.space(root,s.current),removed=new Set([...deleteIds,...links.map(id=>root.canvasPortal.portals[id].entryId)]);parent.nodes=parent.nodes.filter(n=>!removed.has(n.id));parent.edges=parent.edges.filter(e=>!removed.has(e.fromNode)&&!removed.has(e.toNode));links.forEach(id=>delete root.canvasPortal.portals[id]);}
        else root=M.unportal(root,links,s.current,{x:0,y:0},deleteIds).root;
        await this.commitRoot(s,root);return;
      }
      const items=virtual.flatMap(id=>M.restoreItems(s.root,id).nodes),bounds=M.bounds(items),ignored=new Set([...deleteIds,...ids.map(id=>s.root.canvasPortal.portals[id].entryId)]);
      const host=s.c.wrapperEl.createDiv({cls:'cp-placement-host'}),status=host.createDiv({cls:'cp-placement-status'}),ghosts=host.createDiv({cls:'cp-placement-ghosts'});
      const preview=s.preview={ids,links,virtual,deleteIds,deleting,items,bounds,ignored,host,status,ghosts,offset:{x:0,y:0},valid:false};
      preview.move=e=>this.updatePreview(s,s.c.posFromEvt(e));
      preview.click=async e=>{
        e.preventDefault();e.stopImmediatePropagation();if(e.button!==0)return;
        this.updatePreview(s,s.c.posFromEvt(e));if(!preview.valid){new Notice('기존 카드와 겹치지 않는 빈 곳을 선택하세요.');return;}
        s.busy=true;
        try{
          let root=M.unportal(s.root,virtual,s.current,preview.offset,deleteIds).root;
          for(const id of links){if(deleting){const p=root.canvasPortal.portals[id],parent=M.space(root,s.current);parent.nodes=parent.nodes.filter(n=>n.id!==p.entryId);parent.edges=parent.edges.filter(e=>e.fromNode!==p.entryId&&e.toNode!==p.entryId);delete root.canvasPortal.portals[id];}else root=M.unportal(root,[id],s.current).root;}
          await this.commitRoot(s,root);this.cancelPreview(s);new Notice('현재 내부 자료를 꺼내고 포탈을 해제했습니다.');
        }catch(error){this.notifyError(error);}finally{s.busy=false;}
      };
      host.addEventListener('pointermove',preview.move);host.addEventListener('pointerdown',preview.click);s.c.wrapperEl.focus();
      this.updatePreview(s,s.c.posCenter());
    }catch(e){this.notifyError(e);}
  }
  updatePreview(s,pos){
    const p=s.preview;if(!p||p.kind==='move')return;p.offset={x:pos.x-p.bounds.x,y:pos.y-p.bounds.y};
    const nodes=p.items.map(n=>({...n,x:n.x+p.offset.x,y:n.y+p.offset.y})),obstacles=[...s.c.nodes.values()].map(n=>n.getData()).filter(n=>!p.ignored.has(n.id));
    p.valid=!nodes.some(n=>obstacles.some(o=>M.overlaps(n,o)));
    p.host.toggleClass('is-blocked',!p.valid);p.status.textContent=p.valid?'빈 곳을 클릭해 배치 · Esc 취소':'기존 카드와 겹칩니다 · 다른 위치로 이동 · Esc 취소';
    p.ghosts.empty();const area=s.c.wrapperEl.getBoundingClientRect(),zoom=2**s.c.zoom;
    for(const n of nodes.length?nodes:[{x:pos.x,y:pos.y,width:160,height:80,text:'빈 포탈 해제'}]){const el=p.ghosts.createDiv({cls:'cp-placement-node',text:(n.label||(n.type==='file'?n.file:M.title(n.text))||'카드').slice(0,60)});Object.assign(el.style,{left:`${(n.x-s.c.x)*zoom+s.c.canvasRect.cx-area.left}px`,top:`${(n.y-s.c.y)*zoom+s.c.canvasRect.cy-area.top}px`,width:`${n.width*zoom}px`,height:`${n.height*zoom}px`});}
  }
  cancelPreview(s){if(!s.preview)return;s.preview.host.remove();s.preview=null;s.c.wrapperEl.focus();}
  detach(s) {
    s.lastPosition=this.positionState(s);s.detaching=true;
    clearTimeout(s.positionTimer);this.pendingPositions.set(s.v,s.lastPosition);
    s.deleteModal?.close();
    this.cancelPreview(s);
    if (s.frame != null) cancelAnimationFrame(s.frame);
    s.observer?.disconnect(); window.removeEventListener('dblclick', s.doubleWindow, true);
    try {
      this.capture(s);
      if (s.current) { this.rememberHistory(s); s.current = null; this.show(s, s.root); }
      // Keep native Canvas serialization pointed at the canonical root on disable.
      s.c.data = M.clone(s.root);
      s.c.importData(M.clone(s.root), true); s.c.getData();
      if(!s.preservedSource||JSON.stringify(s.root)!==s.preservedSource.baseline)s.v.save();
    } catch (e) { this.notifyError(e); }
    s.nodeUndos.forEach(fn => fn()); s.nodeUndos.clear();
    s.menuUndos.forEach(fn=>fn());s.menuUndos.clear();
    s.portalNodes.clear();
    s.undo.reverse().forEach(fn => fn()); s.c.wrapperEl.style.removeProperty('--cp-glow');
    if (s.frame != null) cancelAnimationFrame(s.frame);
  }
  onunload(){for(const s of this.sessions.values()){s.lastPosition=this.positionState(s);this.pendingPositions.set(s.v,s.lastPosition);try{this.flushEditors(s);this.capture(s);}catch(e){this.notifyError(e);}}this.app.workspace.saveLayout();for(const s of this.sessions.values()){s.detaching=true;if(s.linkBack){s.preservedSource=s.linkBack;s.linkBack=null;if(!s.current)this.show(s,s.root);}this.detach(s);}this.sessions.clear();}
};
