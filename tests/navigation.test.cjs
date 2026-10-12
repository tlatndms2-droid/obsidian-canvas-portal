const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const box={module:{exports:{}},require:n=>n==='obsidian'?{Plugin:class{},PluginSettingTab:class{},Modal:class{}}:require(path.join(__dirname,'../src',n))};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/main.cjs'),'utf8'),box);
const p=Object.create(box.module.exports.prototype);
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
