// Corrupts one sprite only in the isolated native fixture, then restores its exact bytes.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {chromium}=require(path.join(process.argv[2],'playwright'));
const output='tmp/native-validation',session=JSON.parse(fs.readFileSync(path.join(output,'desktop-session.json'),'utf8'));
let request=0,ownBrowser,asset,original,restored=false;const checks=[];
async function rpc(name,args={}){
  const response=await fetch(`http://127.0.0.1:${session.mcpPort}/mcp`,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:++request,method:'tools/call',params:{name,arguments:args}})});
  const wire=await response.json();assert.ok(!wire.error);assert.notEqual(wire.result.isError,true,JSON.stringify(wire));return JSON.parse(wire.result.content[0].text);
}
async function run(){
  const browser=await chromium.connectOverCDP(`http://127.0.0.1:${session.debugPort}`);
  const desktop=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url()==='http://tauri.localhost/');assert.ok(desktop);
  const settings=await rpc('get_settings');assert.equal(settings.activeCharacterId,'motion-fixture');
  const saved=await rpc('get_character_package',{id:'motion-fixture'});
  const fixtureRoot=fs.realpathSync(session.root),packageRoot=fs.realpathSync(saved.packagePath);
  const relative=path.relative(fixtureRoot,packageRoot);assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'Only mutate an installed copy inside this isolated fixture');
  const outfit=saved.manifest.outfits.find(o=>o.id===settings.characterOutfits['motion-fixture']);assert.ok(outfit);
  asset=path.join(packageRoot,outfit.bodySprites.idle);original=fs.readFileSync(asset);
  const backup=path.join(output,'recovery-sprite-original.png');fs.writeFileSync(backup,original);
  fs.writeFileSync(path.join(output,'recovery-target.json'),JSON.stringify({asset,backup:path.resolve(backup),sha256:crypto.createHash('sha256').update(original).digest('hex')},null,2));
  try{
    fs.writeFileSync(asset,Buffer.from('invalid PNG in isolated corruption test'));
    const response=await fetch(`http://127.0.0.1:${session.obsPort}/characters/motion-fixture/${saved.entry.revision}/${outfit.bodySprites.idle}`);
    assert.equal(response.status,404);const failure=await response.json();assert.equal(typeof failure.code,'string');
    assert.ok(!JSON.stringify(failure).includes(session.root),'HTTP errors must not expose fixture filesystem paths');
    checks.push(`real native asset endpoint rejects corrupted installed PNG (${failure.code}) without filesystem path leakage`);
    await desktop.reload();await desktop.waitForFunction(()=>document.querySelector('.character-load-status')?.textContent.includes('角色加载失败'));
    await desktop.screenshot({path:path.join(output,'native-corrupt-resource.png'),omitBackground:true});
    checks.push('real desktop reload shows explicit character failure instead of silently accepting a corrupted installed sprite');
    ownBrowser=await chromium.launch({channel:'msedge',headless:true});
    const obs=await ownBrowser.newPage({viewport:{width:540,height:456}});await obs.goto(`http://127.0.0.1:${session.obsPort}/obs.html?mode=2d`);
    await obs.locator('#obs-character-status').waitFor({state:'visible'});
    assert.match(await obs.locator('#obs-character-error').innerText(),/人物加载失败/);
    assert.equal(await obs.locator('#obs-character-retry').isEnabled(),true);
    await obs.screenshot({path:path.join(output,'obs-native-corrupt-resource.png'),omitBackground:true});
    checks.push('production OBS frontend against actual native transport shows a visible error and enabled recovery button');
    fs.writeFileSync(asset,original);restored=true;
    await obs.locator('#obs-character-retry').click();await obs.locator('#obs-character-status').waitFor({state:'hidden'});
    await rpc('switch_cat',{id:'black'});await desktop.waitForFunction(()=>document.querySelector('.character-load-status')?.textContent==='');
    const selectedAt=Date.now();await rpc('switch_character',{id:'motion-fixture',outfitId:outfit.id});
    const deadline=Date.now()+10000;let active;
    do{
      active=(await (await fetch(`http://127.0.0.1:${session.obsPort}/obs/state`)).json()).characterState;
      if(active?.identity.id==='motion-fixture'&&active.identity.outfitId===outfit.id
        &&active.identity.revision===saved.entry.revision&&active.capturedAt>=selectedAt)break;
      await new Promise(resolve=>setTimeout(resolve,80));
    }while(Date.now()<deadline);
    assert.ok(active?.identity.id==='motion-fixture'&&active.identity.outfitId===outfit.id
      &&active.identity.revision===saved.entry.revision&&active.capturedAt>=selectedAt,'Reselected desktop must publish a new frame after the restored sprites decode');
    await desktop.waitForFunction(()=>document.querySelector('.character-load-status')?.textContent==='');
    const healthy=await rpc('get_character_package',{id:'motion-fixture'});assert.equal(healthy.integrityChecked,true);assert.equal(healthy.entry.revision,saved.entry.revision);
    await desktop.screenshot({path:path.join(output,'native-resource-restored.png'),omitBackground:true});
    checks.push('restoring original sprite bytes enables OBS retry and native cat/person reselection; registered revision remains unchanged and integrity checked');
    fs.writeFileSync(path.join(output,'recovery-report.json'),JSON.stringify({checks,restored:true,revision:saved.entry.revision,realNativeTransport:true,realObsApplication:false,backup:path.resolve(backup)},null,2));
    console.log(JSON.stringify({passed:checks.length,restored}));
  }finally{
    if(original){fs.writeFileSync(asset,original);restored=true;}
    if(ownBrowser)await ownBrowser.close();
  }
}
run().then(()=>process.exit(0),error=>{fs.writeFileSync(path.join(output,'recovery-failure.json'),JSON.stringify({error:String(error),stack:error.stack,checks,restored},null,2));console.error(error);process.exit(1);});
