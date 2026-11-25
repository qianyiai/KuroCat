const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {chromium}=require(path.join(process.argv[2],'playwright'));
const output=path.resolve('tmp/native-validation'),session=JSON.parse(fs.readFileSync(path.join(output,'desktop-session.json'),'utf8'));
const controlPath=path.join(output,'live-update-control.json');
let request=0,ownBrowser,original,changed=false,restored=false;const checks=[];
async function rpc(name,args={}){
  const response=await fetch(`http://127.0.0.1:${session.mcpPort}/mcp`,{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({jsonrpc:'2.0',id:++request,method:'tools/call',params:{name,arguments:args}})});
  assert.equal(response.status,200);const wire=await response.json();assert.ok(!wire.error);assert.notEqual(wire.result.isError,true,JSON.stringify(wire));
  return JSON.parse(wire.result.content[0].text);
}
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
async function until(read,test){const end=Date.now()+10000;while(Date.now()<end){const value=await read();if(test(value))return value;await new Promise(r=>setTimeout(r,60));}throw Error('Live update condition timed out');}
const state=async()=>{const response=await fetch(`http://127.0.0.1:${session.obsPort}/obs/state`);return response.json();};
function observeSprites(){
  window.__spriteLoads=[];const create=URL.createObjectURL.bind(URL);
  URL.createObjectURL=blob=>{const url=create(blob);blob.arrayBuffer().then(bytes=>crypto.subtle.digest('SHA-256',bytes)).then(bytes=>window.__spriteLoads.push(Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('')));return url;};
}
async function restore(){
  if(!changed)return;
  const result=await rpc('import_character_package',{path:original.packagePath,manifest:original.manifest,replace:true});
  assert.equal(result.entry.revision,original.entry.revision);
  await until(state,s=>s.characterState?.identity.revision===original.entry.revision);restored=true;changed=false;
}
async function run(){
  const native=await chromium.connectOverCDP(`http://127.0.0.1:${session.debugPort}`);
  const desktop=native.contexts().flatMap(c=>c.pages()).find(p=>p.url()==='http://tauri.localhost/');assert.ok(desktop);
  const settings=await rpc('get_settings');const id=settings.activeCharacterId;assert.ok(['motion-fixture','native-race'].includes(id),'Expected an isolated pilot fixture');
  original=await rpc('get_character_package',{id});
  const relative=path.relative(fs.realpathSync(session.root),fs.realpathSync(original.packagePath));
  assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'Update only the isolated fixture');
  const outfit=original.manifest.outfits.find(o=>o.id===settings.characterOutfits[id]);assert.ok(outfit);
  const fixture=path.join(output,`live-update-${Date.now()}-${process.pid}`);fs.mkdirSync(fixture);
  const manifest=structuredClone(original.manifest);manifest.version+='-live-update';
  const assets=[...new Set(manifest.outfits.flatMap(o=>['idle','blink','shy','happy'].map(role=>o.bodySprites[role])))];
  for(const name of assets){const target=path.join(fixture,name);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(original.packagePath,name),target);}
  const originalIdle=fs.readFileSync(path.join(original.packagePath,outfit.bodySprites.idle));
  const replacement=fs.readFileSync(path.join(original.packagePath,outfit.bodySprites.happy));
  assert.notEqual(hash(originalIdle),hash(replacement));
  fs.writeFileSync(path.join(fixture,outfit.bodySprites.idle),replacement);
  fs.writeFileSync(path.join(fixture,'character.json'),JSON.stringify(manifest,null,2));
  fs.writeFileSync(path.join(fixture,'restore.json'),JSON.stringify({packagePath:original.packagePath,manifest:original.manifest,revision:original.entry.revision},null,2));
  await desktop.addInitScript(observeSprites);await desktop.reload();
  await until(state,s=>s.characterState?.identity.revision===original.entry.revision);
  ownBrowser=await chromium.launch({channel:'msedge',headless:true});const obs=await ownBrowser.newPage({viewport:{width:540,height:456}});
  await obs.addInitScript(observeSprites);await obs.goto(`http://127.0.0.1:${session.obsPort}/obs.html?mode=2d`);
  await obs.locator('#obs-character-status').waitFor({state:'hidden'});
  await Promise.all([desktop,obs].map(p=>p.evaluate(()=>{window.__spriteLoads=[];})));
  const valid=await rpc('validate_character_package',{path:fixture});assert.equal(valid.valid,true);
  const update=await rpc('import_character_package',{path:fixture,replace:true});changed=true;
  assert.notEqual(update.entry.revision,original.entry.revision);assert.equal(update.activated,false);
  const fresh=await until(state,s=>s.characterState?.identity.revision===update.entry.revision);
  assert.equal(fresh.settings.activeCharacterId,id);assert.equal(fresh.characterState.identity.outfitId,outfit.id);
  checks.push('full read/edit/import updates a real PNG content revision while preserving the active character and outfit without reactivation');
  await Promise.all([desktop,obs].map(p=>p.waitForFunction(expected=>window.__spriteLoads.filter(h=>h===expected).length>=2,hash(replacement))));
  await desktop.screenshot({path:path.join(output,'native-live-update.png'),omitBackground:true});
  await obs.screenshot({path:path.join(output,'obs-live-update.png'),omitBackground:true});
  checks.push('desktop and production OBS frontend both decode updated installed PNG bytes through real native transports');
  const oldResponse=await fetch(`http://127.0.0.1:${session.obsPort}/characters/${id}/${original.entry.revision}/${outfit.bodySprites.idle}`);
  assert.equal(oldResponse.status,409);assert.equal((await oldResponse.json()).code,'STALE_REVISION');
  assert.equal(hash(fs.readFileSync(path.join(original.packagePath,outfit.bodySprites.idle))),hash(originalIdle));
  checks.push('old requests receive STALE_REVISION and the original installed revision bytes remain unchanged');
  const readBack=await rpc('get_character_package',{id});assert.deepEqual(readBack.manifest,manifest);assert.equal(readBack.integrityChecked,true);
  checks.push('full manifest readback preserves all motion, personality, outfit and asset provenance fields after the resource update');
  if(process.argv.includes('--hold')){
    fs.writeFileSync(controlPath,JSON.stringify({continue:false,pid:process.pid,updatedRevision:update.entry.revision,fixture},null,2));
    console.log('UPDATED_READY_FOR_OBS');const end=Date.now()+60000;
    while(Date.now()<end){if(JSON.parse(fs.readFileSync(controlPath,'utf8')).continue)break;await new Promise(r=>setTimeout(r,150));}
  }
  await Promise.all([desktop,obs].map(p=>p.evaluate(()=>{window.__spriteLoads=[];})));
  await restore();
  await Promise.all([desktop,obs].map(p=>p.waitForFunction(expected=>window.__spriteLoads.includes(expected),hash(originalIdle))));
  assert.equal((await rpc('get_character_package',{id})).entry.revision,original.entry.revision);
  checks.push('restoring through MCP reuses the intact original revision and both live frontends decode its original idle sprite again');
  fs.writeFileSync(path.join(output,'live-update-report.json'),JSON.stringify({checks,restored,fixture,originalRevision:original.entry.revision,
    updatedRevision:update.entry.revision,characterId:id,outfitId:outfit.id,actualPngReplacement:true,realNativeTransport:true,realObsApplication:false},null,2));
  console.log(JSON.stringify({passed:checks.length,restored}));
}
run().then(async()=>{if(ownBrowser)await ownBrowser.close();process.exit(0);},async error=>{
  let restoreError;try{await restore();}catch(e){restoreError=String(e);}
  fs.writeFileSync(path.join(output,'live-update-failure.json'),JSON.stringify({error:String(error),stack:error.stack,checks,restored,restoreError},null,2));
  if(ownBrowser)await ownBrowser.close();console.error(error);process.exit(1);
});
