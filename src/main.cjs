const { Plugin, PluginSettingTab, Setting, Modal, Notice, setIcon } = require('obsidian');
const M = require("./model.cjs");
const B = require("./backup.cjs");

class PortalNameModal extends Modal {
  constructor(app, done) { super(app); this.done = done; }
  onOpen() {
    this.contentEl.createEl('h3', { text: '포탈 만들기' });
    let name = '새 포탈';
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
    new Setting(this.containerEl).setName('현재 내부 공간에서 나가기').addButton(b => b.setButtonText('상위 Canvas로 복귀').onClick(() => this.plugin.leaveActive()));
  }
}

module.exports = class CanvasPortal extends Plugin {
  async onload() {
    this.settings = { glowColor: '#9966ee', backupFolder:'',autoMinutes:0, ...(await this.loadData()) };
    this.sessions = new Map();
    this.errors = [];
    this.addSettingTab(new PortalSettings(this.app, this));
    this.addCommand({ id: 'create-select-portal', name: 'Create Portal · 선택 자료 묶기', checkCallback: checking => {
      const s = this.active(); const enabled = !!s && !s.preview && !s.c.readonly && [...s.c.selection].some(n => s.c.nodes.has(n.id) && M.ref(n.getData())?.role!=='exit');
      if (!checking && enabled) this.askCreate(s); return enabled;
    }});
    this.addCommand({ id: 'toggle-portal', name: '입장·퇴장', hotkeys: [{ modifiers: ['Ctrl'], key: 'Enter' }], checkCallback: checking => {
      const s = this.active(), selected = s && this.selectedPortal(s); if (!selected) return false;
      if (!checking) this.transition(s, selected); return true;
    }});
    this.addCommand({ id: 'leave-portal', name: '상위 Canvas로 복귀', checkCallback: checking => {
      const s = this.active(); if (!s?.current&&!s?.linkBack) return false; if (!checking) this.leaveActive(); return true;
    }});
    this.addCommand({id:'clone-portal',name:'포탈 복제',checkCallback:checking=>{const s=this.active(),r=s&&this.selectedPortal(s);if(r?.role!=='entry')return false;if(!checking)this.copyPortal(s,r.id);return true;}});
    this.addCommand({id:'unportal',name:'포탈 해제 · 현재 자료 꺼내기',checkCallback:checking=>{const s=this.active(),r=s&&this.selectedPortal(s);if(r?.role!=='entry')return false;if(!checking)this.beginUnportal(s,[r.id]);return true;}});
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
      const selected = this.selectedPortal(s); if (!selected) return;
      if (e.target.closest('textarea,input,[contenteditable="true"]')) return;
      const commandId = `${this.manifest.id}:toggle-portal`;
      const manager = this.app.hotkeyManager;
      const customized = manager?.getHotkeys(commandId);
      const hotkeys = customized === undefined ? [{ modifiers: ['Ctrl'], key: 'Enter' }] : customized;
      if (!hotkeys.some(h => this.matchesKey(e, h))) return;
      e.preventDefault(); e.stopImmediatePropagation(); this.transition(s, selected);
    };
    window.addEventListener('keydown', this.keyHandler, true);
    this.register(() => window.removeEventListener('keydown', this.keyHandler, true));
    this.app.workspace.onLayoutReady(() => this.discover());
    this.registerInterval(window.setInterval(() => this.discover(), 1000));
    this.registerInterval(window.setInterval(()=>this.maybeAutoBackup(),10000));
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
  portal(s,id){return s.root.canvasPortal?.portals[id] || (s.linkBack?.id===id?s.linkBack.owner.root.canvasPortal.portals[id]:null);}
  addPortalMenu(s,menu){
    if(s.preview||s.c.readonly||menu.canvasPortalAdded)return;menu.canvasPortalAdded=true;
    if([...s.c.selection].some(n=>s.c.nodes.has(n.id)&&M.ref(n.getData())?.role!=='exit'))menu.addItem(item=>item.setTitle('Create Portal').setSection('action').setIcon('log-in').onClick(()=>this.askCreate(s)));
    const r=this.selectedPortal(s);if(r?.role==='entry'){menu.addItem(item=>item.setTitle('포탈 복제').setIcon('copy').onClick(()=>this.copyPortal(s,r.id)));menu.addItem(item=>item.setTitle('포탈 해제 · 현재 자료 꺼내기').setIcon('log-out').onClick(()=>this.beginUnportal(s,[r.id])));}
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
    for (const [v, s] of this.sessions) if (!v.containerEl.isConnected) { this.detach(s); this.sessions.delete(v); }
  }
  attach(v) {
    const c = v.canvas;
    if (!c.getData || !c.importData || !v.getViewData) throw Error('이 Obsidian의 Canvas 기능을 지원하지 않습니다.');
    const root = M.clone(c.getData());
    const loadedText = v.data || v.lastSavedData;
    if (loadedText && !root.canvasPortal) {
      const loaded = JSON.parse(loadedText);
      if (loaded.canvasPortal) root.canvasPortal = M.clone(loaded.canvasPortal);
    }
    const s = { v, c, path: v.file.path, root, current: null, stack:[], archives:new Map(), menuUndos:new Map(), busy: false, switching: false, histories: new Map(), nodeUndos: new Map(), undo: [], frame: null };
    this.sessions.set(v, s);
    const replace = (object, key, factory) => {
      const had = Object.hasOwn(object, key), original = object[key]; if (typeof original !== 'function') return;
      object[key] = factory(original); s.undo.push(() => { if (had) object[key] = original; else delete object[key]; });
    };
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
      const parsed = JSON.parse(text);
      if (parsed.canvasPortal && parsed.canvasPortal.version !== 1) throw Error('지원하지 않는 포탈 데이터 버전');
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
    replace(c, 'removeNode', original => n => {
      if (s.switching || s.rebuilding) return original.call(c, n);
      const r = M.ref(n.getData());
      if (r?.role === 'exit') { new Notice('퇴장 포탈 카드는 삭제할 수 없습니다.'); return; }
      if (r?.role === 'entry') { this.beginUnportal(s,[r.id],[],true); return; }
      return original.call(c, n);
    });
    replace(c,'deleteSelection',original=>(...args)=>{
      const entries=[...c.selection].map(n=>n.getData?.()).filter(n=>M.ref(n)?.role==='entry');
      if(!entries.length)return original.apply(c,args);
      const ordinary=[...c.selection].map(n=>n.getData?.()).filter(n=>n&&!M.ref(n)).map(n=>n.id);
      this.beginUnportal(s,entries.map(n=>M.ref(n).id),ordinary,true);
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
      finally { s.rebuilding = rebuilding; this.queue(s); }
    });
    replace(c,'clear',original=>(...args)=>{const rebuilding=s.rebuilding,switching=s.switching;s.rebuilding=true;s.switching=true;try{return original.apply(c,args);}finally{s.rebuilding=rebuilding;s.switching=switching;}});
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
    s.observer.observe(c.wrapperEl, { childList: true, subtree: true });
    c.wrapperEl.style.setProperty('--cp-glow', this.settings.glowColor);
    this.queue(s);
  }
  capture(s) {
    if (s.capturing || s.switching) return;
    s.capturing = true;
    try {
      const d = M.clone(s.c.getData());
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
        p.graph = M.graph(d);
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
  decorate(s) {
    for(const [n,restore] of s.menuUndos)if(s.c.nodes.get(n.id)!==n){restore();s.menuUndos.delete(n);}
    for (const [old, restore] of s.nodeUndos) if (!s.c.nodes.has(old.id) || s.c.nodes.get(old.id) !== old) { restore(); s.nodeUndos.delete(old); }
    for (const n of s.c.nodes.values()) {
      if(!s.menuUndos.has(n)&&typeof n.showMenu==='function'){const had=Object.hasOwn(n,'showMenu'),original=n.showMenu;n.showMenu=menu=>{original.call(n,menu);this.addPortalMenu(s,menu);};s.menuUndos.set(n,()=>{if(had)n.showMenu=original;else delete n.showMenu;});}
      const r = M.ref(n.getData()), p = r && this.portal(s,r.id);
      if (!r || !p || !n.nodeEl) continue;
      n.nodeEl.classList.add('cp-portal', r.role === 'entry' ? 'cp-entry' : 'cp-exit');
      let marker = n.nodeEl.querySelector(':scope > .cp-marker');
      if (!marker) { marker = document.createElement('div'); marker.className = 'cp-marker'; n.nodeEl.appendChild(marker); if (r.role === 'entry') { const icon = marker.createSpan({ cls: 'cp-enter-icon' }); setIcon(icon, p.type==='link'?'link':p.type==='group'?'group':'log-in');icon.setAttribute('aria-label',p.type==='link'?'Link 포탈':p.type==='group'?'Group 포탈':'입장 포탈'); } marker.createSpan({ cls: 'cp-display-id', text: p.displayId }); }
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
          return original.call(n, data, ...args);
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
        const restore = () => { restorers.reverse().forEach(fn => fn()); n.nodeEl?.classList.remove('cp-portal', 'cp-entry', 'cp-exit'); marker.remove(); };
        s.nodeUndos.set(n, restore);
      }
    }
  }
  askCreate(s) {
    if(s.preview)return;
    const selected=[...s.c.selection].map(n=>n.getData());
    if(selected.length===1&&selected[0].type==='group'){this.create(s,selected[0].label);return;}
    if(selected.length===1&&selected[0].type==='file'&&selected[0].file.toLowerCase().endsWith('.canvas')){this.create(s,M.fileTitle(selected[0].file));return;}
    new PortalNameModal(this.app, name => this.create(s, name)).open();
  }
  async create(s, name) {
    if (s.busy) return; s.busy = true;
    try {
      this.flushEditors(s);this.capture(s);
      const ids = [...s.c.selection].filter(n => s.c.nodes.has(n.id)).map(n => n.id);
      const { root, entryId, portalId } = M.createPortal(s.root, ids, name,s.current); M.validate(root);
      if(root.canvasPortal.portals[portalId].type==='group'){
        const probe=document.createElement('div');
        probe.textContent=root.canvasPortal.portals[portalId].name;
        probe.style.cssText='position:absolute;visibility:hidden;pointer-events:none;box-sizing:border-box;width:max-content;min-width:120px;max-width:360px;padding:16px 24px;white-space:pre-wrap;overflow-wrap:anywhere;font-family:var(--font-text);font-size:var(--font-text-size,16px);line-height:var(--line-height-normal,1.5);';
        s.c.wrapperEl.appendChild(probe);
        try { const entry=M.space(root,s.current).nodes.find(n=>n.id===entryId);entry.width=Math.ceil(probe.offsetWidth);entry.height=Math.max(64,Math.ceil(probe.offsetHeight)); }
        finally { probe.remove(); }
      }
      await this.commitRoot(s,root,[entryId]);new Notice('포탈을 만들었습니다. Ctrl+Enter로 입장하세요.');
    } catch (e) { this.notifyError(e); } finally { s.busy = false; }
  }
  async commitRoot(s,root,selected=[]){
    M.validate(root);this.rememberHistory(s);
    for(const [id,p] of Object.entries(s.root.canvasPortal?.portals||{}))if(!root.canvasPortal.portals[id])s.archives.set(id,M.clone(p));
    s.root=root;this.show(s,this.displayData(s));s.c.pushHistory(M.graph(s.c.getData()));s.c.deselectAll();for(const id of selected){const n=s.c.nodes.get(id);if(n)s.c.select(n);}this.decorate(s);await s.v.save();
  }
  displayData(s){const data=M.clone(this.currentData(s));if(!s.current&&s.linkBack)data.nodes.push(M.clone(this.portal(s,s.linkBack.id).graph.nodes[0]));return data;}
  rememberHistory(s) {
    s.c.requestPushHistory?.run?.();
    s.histories.set(s.current || 'main', { data: s.c.history.data.map(M.graph), current: s.c.history.current });
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
      s.c.updateHistoryUI();
    }
    finally { s.switching = false; }
    this.queue(s);
  }
  transition(s, r) {if(r.role==='entry')return this.enter(s,r.id);if(r.role==='exit'&&s.current===r.id)return this.leave(s);if(r.role==='exit'&&s.linkBack?.id===r.id)return this.leaveLink(s);}
  async enter(s, id) {
    if (s.busy) return; s.busy = true;
    try {
      this.flushEditors(s);this.capture(s);const p=s.root.canvasPortal.portals[id];if(!p)throw Error('포탈 정보가 없습니다.');
      if(!this.currentData(s).nodes.some(n=>M.ref(n)?.id===id&&M.ref(n)?.role==='entry'))throw Error('현재 공간의 입장 카드가 아닙니다.');
      if(p.type==='link'){await this.enterLink(s,p);return;}
      await s.v.save();
      this.rememberHistory(s);
      s.stack.push({parentId:s.current});s.current = id; this.show(s, p.graph); this.decorate(s);
      s.c.zoomToFit();
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
      this.show(s,this.displayData(s));this.decorate(s);s.c.zoomToFit();s.c.wrapperEl.focus();
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
  async beginUnportal(s,ids,deleteIds=[],deleting=false){
    if(s.busy||s.preview)return;
    try{
      this.flushEditors(s);this.capture(s);
      const links=ids.filter(id=>s.root.canvasPortal.portals[id]?.type==='link'),virtual=ids.filter(id=>!links.includes(id));
      if(!virtual.length){
        let root=M.clone(s.root);
        if(deleting){const parent=M.space(root,s.current),removed=new Set([...deleteIds,...links.map(id=>root.canvasPortal.portals[id].entryId)]);parent.nodes=parent.nodes.filter(n=>!removed.has(n.id));parent.edges=parent.edges.filter(e=>!removed.has(e.fromNode)&&!removed.has(e.toNode));links.forEach(id=>delete root.canvasPortal.portals[id]);}
        else root=M.unportal(root,links,s.current).root;
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
    const p=s.preview;if(!p)return;p.offset={x:pos.x-p.bounds.x,y:pos.y-p.bounds.y};
    const nodes=p.items.map(n=>({...n,x:n.x+p.offset.x,y:n.y+p.offset.y})),obstacles=[...s.c.nodes.values()].map(n=>n.getData()).filter(n=>!p.ignored.has(n.id));
    p.valid=!nodes.some(n=>obstacles.some(o=>M.overlaps(n,o)));
    p.host.toggleClass('is-blocked',!p.valid);p.status.textContent=p.valid?'빈 곳을 클릭해 배치 · Esc 취소':'기존 카드와 겹칩니다 · 다른 위치로 이동 · Esc 취소';
    p.ghosts.empty();const area=s.c.wrapperEl.getBoundingClientRect(),zoom=2**s.c.zoom;
    for(const n of nodes.length?nodes:[{x:pos.x,y:pos.y,width:160,height:80,text:'빈 포탈 해제'}]){const el=p.ghosts.createDiv({cls:'cp-placement-node',text:(n.label||(n.type==='file'?n.file:M.title(n.text))||'카드').slice(0,60)});Object.assign(el.style,{left:`${(n.x-s.c.x)*zoom+s.c.canvasRect.cx-area.left}px`,top:`${(n.y-s.c.y)*zoom+s.c.canvasRect.cy-area.top}px`,width:`${n.width*zoom}px`,height:`${n.height*zoom}px`});}
  }
  cancelPreview(s){if(!s.preview)return;s.preview.host.remove();s.preview=null;s.c.wrapperEl.focus();}
  detach(s) {
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
    s.undo.reverse().forEach(fn => fn()); s.c.wrapperEl.style.removeProperty('--cp-glow');
    if (s.frame != null) cancelAnimationFrame(s.frame);
  }
  onunload(){for(const s of this.sessions.values()){try{this.flushEditors(s);this.capture(s);}catch(e){this.notifyError(e);}}for(const s of this.sessions.values()){if(s.linkBack){s.preservedSource=s.linkBack;s.linkBack=null;if(!s.current)this.show(s,s.root);}this.detach(s);}this.sessions.clear();}
};
