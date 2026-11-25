// Temporarily damages one installed fixture sprite; always restores its saved bytes.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {chromium}=require(path.join(process.argv[2],'playwright'));
const root='tmp/native-validation',session=JSON.parse(fs.readFileSync(path.join(root,'desktop-session.json'),'utf8'));
const reportPath=path.join(root,'tray-recovery-report.json'),controlPath=path.join(root,'tray-recovery-control.json');
const report={recordsRawInput:false,restored:false,failureObserved:false,failurePreservesSelection:false,recoveryObserved:false};
let asset,original,request=0,stop=false;
const save=()=>fs.writeFileSync(reportPath,JSON.stringify(report,null,2));
const choice=s=>({id:s.activeCharacterId,catBreed:s.catBreed,outfits:s.characterOutfits});
async function rpc(name,args={}){
  const response=await fetch(`http://127.0.0.1:${session.mcpPort}/mcp`,{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(5000),
    body:JSON.stringify({jsonrpc:'2.0',id:++request,method:'tools/call',params:{name,arguments:args}})});
  const wire=await response.json();assert.ok(!wire.error);assert.notEqual(wire.result.isError,true,JSON.stringify(wire));return JSON.parse(wire.result.content[0].text);
}
function restore(){
  if(original&&!report.restored){fs.writeFileSync(asset,original);assert.deepEqual(fs.readFileSync(asset),original);report.restored=true;save();}
}
process.on('SIGINT',()=>{stop=true;});process.on('SIGTERM',()=>{stop=true;});
(async()=>{
  const browser=await chromium.connectOverCDP(`http://127.0.0.1:${session.debugPort}`);
  const desktop=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url()==='http://tauri.localhost/');assert.ok(desktop);
  const before=await rpc('get_settings');assert.notEqual(before.activeCharacterId,'motion-fixture','Keep another actor active while testing the inactive package');
  report.before=choice(before);
  const pack=await rpc('get_character_package',{id:'motion-fixture'});assert.equal(pack.integrityChecked,true);
  const relative=path.relative(fs.realpathSync(session.root),fs.realpathSync(pack.packagePath));
  assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'Installed fixture must stay inside the isolated session');
  const outfit=pack.manifest.outfits.find(o=>o.id==='primary');assert.ok(outfit?.bodySprites);
  asset=path.join(pack.packagePath,outfit.bodySprites.idle);original=fs.readFileSync(asset);
  report.asset=asset;report.backup=path.resolve(root,'tray-recovery-sprite-original.png');
  report.originalSha256=crypto.createHash('sha256').update(original).digest('hex');fs.writeFileSync(report.backup,original);
  fs.writeFileSync(controlPath,JSON.stringify({restore:false,stop:false}));
  const tooltip='KuroCat 测试版 5.1.0（失败恢复验收）';
  await desktop.evaluate(async tooltip=>{const invoke=window.__TAURI_INTERNALS__.invoke;const rid=await invoke('plugin:tray|get_by_id',{id:'kuro-tray'});if(!rid)throw Error('Test tray absent');await invoke('plugin:tray|set_tooltip',{rid,tooltip});},tooltip);
  fs.writeFileSync(asset,Buffer.from('invalid PNG for isolated user-operated tray recovery test'));save();
  console.log('Damaged fixture ready. Original sprite backed up; automatic restoration after three minutes.');
  const start=Date.now();
  while(!stop&&Date.now()-start<300000){
    const control=JSON.parse(fs.readFileSync(controlPath,'utf8'));if(control.stop)break;
    if(control.restore||Date.now()-start>=180000){
      if(!report.restored){restore();const healthy=await rpc('get_character_package',{id:'motion-fixture'});assert.equal(healthy.integrityChecked,true);report.integrityRestored=true;console.log('Original sprite restored and package integrity verified.');}
    }
    const snapshot=await(await fetch(`http://127.0.0.1:${session.obsPort}/obs/state`,{signal:AbortSignal.timeout(4000)})).json();
    const error=await desktop.locator('.character-load-status').textContent();
    if(!report.restored&&error?.includes('人物切换失败')){
      report.failureObserved=true;report.failureMessage=error;
      report.failurePreservesSelection=JSON.stringify(choice(snapshot.settings))===JSON.stringify(report.before);
    }
    if(report.restored&&snapshot.characterState?.identity.id==='motion-fixture'&&snapshot.characterState.identity.outfitId==='primary'&&!error){report.recoveryObserved=true;report.recoveredIdentity=snapshot.characterState.identity;}
    save();await new Promise(resolve=>setTimeout(resolve,250));
  }
})().catch(error=>{report.error=String(error);process.exitCode=1;}).finally(()=>{
  try{restore();}catch(error){report.restorationError=String(error);process.exitCode=1;}
  report.stopped=true;save();console.log(JSON.stringify({stopped:true,restored:report.restored,failureObserved:report.failureObserved,recoveryObserved:report.recoveryObserved}));process.exit(process.exitCode??0);
});
