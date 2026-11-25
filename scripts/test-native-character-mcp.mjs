import {writeCharacterFixture} from './character-test-fixture.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {once} from 'node:events';

const executable=path.resolve(process.argv[2]??'tmp/native-validation/target/x86_64-pc-windows-msvc/debug/KuroCat.exe');
assert.ok(fs.existsSync(executable),'Build the authorized local debug executable first');
const root=path.resolve(process.argv[3]??'tmp/native-validation',`stdio-${Date.now()}-${process.pid}`);
fs.mkdirSync(root,{recursive:true});
const checks=[],stderr=[];
const env={...process.env,APPDATA:path.join(root,'appdata'),LOCALAPPDATA:path.join(root,'localappdata'),TEMP:path.join(root,'temp'),TMP:path.join(root,'temp')};
for(const key of ['APPDATA','LOCALAPPDATA','TEMP'])fs.mkdirSync(env[key],{recursive:true});
function client(){
  const child=spawn(executable,['--mcp'],{env,stdio:['pipe','pipe','pipe'],windowsHide:true});
  const pending=new Map();let sequence=0;
  child.stderr.on('data',chunk=>stderr.push(chunk.toString()));
  child.on('error',error=>{for(const request of pending.values())request.reject(error);pending.clear();});
  child.on('exit',code=>{for(const request of pending.values())request.reject(new Error(`MCP exited: ${code}`));pending.clear();});
  createInterface({input:child.stdout}).on('line',line=>{
    let reply;try{reply=JSON.parse(line);}catch(error){for(const request of pending.values())request.reject(error);return;}
    const request=pending.get(reply.id);if(!request)return;
    pending.delete(reply.id);clearTimeout(request.timer);
    if(reply.error)request.reject(new Error(JSON.stringify(reply.error)));else request.resolve(reply.result);
  });
  const request=(method,params={})=>new Promise((resolve,reject)=>{
    const id=++sequence;
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`MCP timeout: ${method}`));},15000);
    pending.set(id,{resolve,reject,timer});
    child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');
  });
  return {request,async call(name,args={},expectedError){
    const result=await request('tools/call',{name,arguments:args});
    const payload=JSON.parse(result.content[0].text);
    if(expectedError){assert.equal(result.isError,true);assert.equal(payload.code,expectedError);}
    else assert.notEqual(result.isError,true,JSON.stringify(payload));
    return payload;
  },async close(){if(child.exitCode!==null)return;const exited=once(child,'exit');child.stdin.end();const [code]=await exited;assert.equal(code,0);}};
}
let rpc=client();
try {
  await rpc.request('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'native-character-regression',version:'1'}});
  const listed=await rpc.request('tools/list');
  for(const name of ['get_character_schema','validate_character_package','import_character_package','get_character_package','list_characters','switch_character','set_character_outfit'])
    assert.ok(listed.tools.some(tool=>tool.name===name),name);
  checks.push('real debug EXE initializes and exposes all seven character tools through stdio');
  const source=path.join(root,'original-source'),manifest=writeCharacterFixture(source);
  const input=path.join(root,'source');fs.mkdirSync(input);
  fs.copyFileSync(path.join(source,'character.json'),path.join(input,'character.json'));
  const assets=new Set(manifest.outfits.flatMap(outfit=>Object.values(outfit.bodySprites).filter(value=>value.endsWith('.png'))));
  for(const asset of assets){const target=path.join(input,asset);fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(source,asset),target);}
  const validation=await rpc.call('validate_character_package',{path:input});
  assert.equal(validation.valid,true);assert.equal(validation.assets,8);assert.equal(validation.outfits.length,2);
  const imported=await rpc.call('import_character_package',{path:input,activate:true});
  assert.equal(imported.activated,true);assert.equal(imported.entry.id,'motion-fixture');
  checks.push('real PNG validation, immutable publication and activation succeed for the two-outfit package');
  await rpc.call('import_character_package',{path:input},'ID_CONFLICT');
  await rpc.call('set_character_outfit',{id:'motion-fixture',outfitId:'alternate'});
  await rpc.call('set_character_outfit',{id:'motion-fixture',outfitId:'missing'},'OUTFIT_NOT_FOUND');
  let settings=await rpc.call('get_settings');assert.equal(settings.characterOutfits['motion-fixture'],'alternate');
  checks.push('duplicate import and invalid outfit reject without changing the valid selection');
  // Alter only this test's copied input; the workspace source assets remain untouched.
  const sourceEdited=process.argv.includes('--source-edit');
  if(sourceEdited){
    for(const asset of assets)fs.writeFileSync(path.join(input,asset),Buffer.from('invalidated source fixture'));
    await rpc.call('validate_character_package',{path:input},'INVALID_PNG');
  }else fs.renameSync(input,path.join(root,'source-moved'));
  const saved=await rpc.call('get_character_package',{id:'motion-fixture'});
  assert.equal(saved.integrityChecked,true);assert.equal(saved.manifest.assetNotice,manifest.assetNotice);
  for(const asset of assets)assert.equal(fs.readFileSync(path.join(saved.packagePath,asset)).compare(fs.readFileSync(path.join(source,asset))),0);
  checks.push(sourceEdited?'installed bytes and full asset notice remain readable after copied source PNGs are invalidated'
    :'installed bytes and full asset notice remain readable after the copied source moves');
  const edited=structuredClone(saved.manifest);edited.version='0.1.1';edited.outfits[0].motion2d.personality.petReactions[0].durationMs+=1;
  const invalid=structuredClone(edited);invalid.outfits[0].motion2d.privacy.clearInputOnExit=false;
  await rpc.call('import_character_package',{path:saved.packagePath,manifest:invalid,replace:true},'INVALID_MOTION');
  assert.equal((await rpc.call('get_character_package',{id:'motion-fixture'})).entry.revision,saved.entry.revision);
  const updated=await rpc.call('import_character_package',{path:saved.packagePath,manifest:edited,replace:true});
  assert.notEqual(updated.entry.revision,saved.entry.revision);
  assert.deepEqual((await rpc.call('get_character_package',{id:'motion-fixture'})).manifest,edited);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(saved.packagePath,'character.json'),'utf8')),saved.manifest);
  checks.push('inline full-manifest edit changes revision and preserves both outfits, personality, provenance and old revision; invalid update preserves registry');
  const peer=client();
  try {
    await peer.request('initialize',{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'native-character-peer',version:'1'}});
    const race=structuredClone(edited);race.id='native-race';
    const results=await Promise.all([rpc,peer].map(connection=>connection.request('tools/call',{
      name:'import_character_package',arguments:{path:saved.packagePath,manifest:race},
    })));
    assert.equal(results.filter(result=>result.isError!==true).length,1);
    const rejected=results.find(result=>result.isError===true);
    assert.ok(['IMPORT_BUSY','ID_CONFLICT'].includes(JSON.parse(rejected.content[0].text).code));
    await Promise.all([rpc.call('update_settings',{scale:.7}),peer.call('update_settings',{soundEnabled:false})]);
    const merged=await rpc.call('get_settings');assert.equal(merged.scale,.7);assert.equal(merged.soundEnabled,false);
    assert.equal(merged.activeCharacterId,'motion-fixture');
    checks.push('two real stdio processes serialize conflicting publications and preserve independent settings patches');
  } finally {await peer.close();}
  await rpc.call('update_settings',{scale:.6,soundEnabled:false});
  assert.equal((await rpc.call('get_settings')).activeCharacterId,'motion-fixture');
  const cats=await rpc.call('list_cats');
  const black=cats.cats.find(cat=>cat.id==='black');
  await rpc.call('upsert_cat',{cat:black,activate:false});
  assert.equal((await rpc.call('get_settings')).activeCharacterId,'motion-fixture');
  await rpc.call('upsert_cat',{cat:black,activate:true});
  assert.equal((await rpc.call('get_settings')).activeCharacterId,null);
  await rpc.call('switch_character',{id:'motion-fixture',outfitId:'alternate'});
  await rpc.call('switch_cat',{id:'black'});assert.equal((await rpc.call('get_settings')).activeCharacterId,null);
  await rpc.call('switch_character',{id:'motion-fixture'});
  settings=await rpc.call('get_settings');assert.equal(settings.characterOutfits['motion-fixture'],'alternate');assert.equal(settings.scale,.6);
  checks.push('ordinary settings and nonactivating cat edits preserve character; activating legacy cat tools exit it; reselect restores outfit');
  const frameOnly=structuredClone(edited);frameOnly.id='native-frame-only';
  for(const outfit of frameOnly.outfits){delete outfit.motion2d;delete outfit.bodySprites;}
  assert.equal((await rpc.call('validate_character_package',{path:saved.packagePath,manifest:frameOnly})).valid,true);
  const partial=await rpc.call('import_character_package',{path:saved.packagePath,manifest:frameOnly,activate:true});
  assert.equal(partial.entry.id,frameOnly.id);assert.equal(partial.activated,false);
  assert.equal(partial.activationError.code,'ACTIVATION_UNAVAILABLE');
  const importedFrame=await rpc.call('get_character_package',{id:frameOnly.id});
  assert.deepEqual(importedFrame.manifest,frameOnly);assert.equal(importedFrame.integrityChecked,true);
  assert.equal(importedFrame.activationSupported,false);
  assert.equal((await rpc.call('get_settings')).activeCharacterId,'motion-fixture');
  checks.push('a valid frame-only package stays imported when activation is unavailable, reports activationError separately and preserves the previous live character');
  await rpc.close();rpc=client();
  settings=await rpc.call('get_settings');assert.equal(settings.activeCharacterId,'motion-fixture');assert.equal(settings.characterOutfits['motion-fixture'],'alternate');
  assert.deepEqual((await rpc.call('get_character_package',{id:'motion-fixture'})).manifest,edited);
  checks.push('a new stdio process restores selected character, outfit and complete updated package from isolated disk data');
  const damaged=await rpc.call('get_character_package',{id:'motion-fixture'});
  const relative=path.relative(fs.realpathSync(root),fs.realpathSync(damaged.packagePath));
  assert.ok(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'Only damage this test client\'s installed package');
  const damagedAsset=path.join(damaged.packagePath,damaged.manifest.outfits[0].bodySprites.idle);
  const damage=Buffer.from('damaged sprite in isolated stdio recovery fixture');
  fs.writeFileSync(damagedAsset,damage);
  const registryPath=path.join(env.APPDATA,'kuro-cat-pet','characters.json'),registryBefore=fs.readFileSync(registryPath);
  await rpc.call('get_character_package',{id:'motion-fixture'},'INVALID_PNG');
  await rpc.call('import_character_package',{path:saved.packagePath,manifest:edited,replace:true},'INVALID_REGISTRY');
  assert.deepEqual(fs.readFileSync(registryPath),registryBefore);
  assert.deepEqual((await rpc.call('get_settings')).characterOutfits,settings.characterOutfits);
  const recovery=structuredClone(edited);recovery.version='0.1.2';
  const recovered=await rpc.call('import_character_package',{path:saved.packagePath,manifest:recovery,replace:true,activate:true});
  assert.equal(recovered.activated,true);assert.notEqual(recovered.entry.revision,damaged.entry.revision);
  assert.deepEqual((await rpc.call('get_character_package',{id:'motion-fixture'})).manifest,recovery);
  assert.deepEqual(fs.readFileSync(damagedAsset),damage,'Recovery must retain the old damaged revision');
  await rpc.close();rpc=client();
  assert.deepEqual((await rpc.call('get_character_package',{id:'motion-fixture'})).manifest,recovery);
  const recoveredSettings=await rpc.call('get_settings');
  assert.equal(recoveredSettings.activeCharacterId,'motion-fixture');assert.equal(recoveredSettings.characterOutfits['motion-fixture'],'alternate');
  checks.push('real MCP rejects damaged same-revision replacement, publishes a healthy new inline revision, reactivates with outfit preference and restores it in a new client without overwriting damaged evidence');
  const guide=await rpc.call('get_character_schema'),reference=guide.dafeiyuReferencePackage;
  assert.equal(reference.id,'dafeiyu-reference');
  const referenceSource=path.resolve('src');
  const referenceAssets=Object.values(reference.outfits[0].bodySprites).filter(value=>value.endsWith('.png'));
  const sourceBytes=referenceAssets.map(asset=>fs.readFileSync(path.join(referenceSource,asset)));
  const referenceValid=await rpc.call('validate_character_package',{path:referenceSource,manifest:reference});
  assert.equal(referenceValid.valid,true);assert.equal(referenceValid.assets,4);
  const referenceImport=await rpc.call('import_character_package',{path:referenceSource,manifest:reference,activate:true});
  assert.equal(referenceImport.activated,true);
  const referenceSaved=await rpc.call('get_character_package',{id:reference.id});
  assert.equal(referenceSaved.integrityChecked,true);
  assert.equal(referenceSaved.manifest.assetNotice,reference.assetNotice);
  assert.deepEqual(referenceSaved.manifest.outfits[0].motion2d,reference.outfits[0].motion2d);
  for(const [index,asset] of referenceAssets.entries()){
    assert.deepEqual(fs.readFileSync(path.join(referenceSaved.packagePath,asset)),sourceBytes[index]);
    assert.deepEqual(fs.readFileSync(path.join(referenceSource,asset)),sourceBytes[index]);
  }
  assert.equal((await rpc.call('get_settings')).activeCharacterId,reference.id);
  await rpc.call('switch_cat',{id:'dafeiyu'});assert.equal((await rpc.call('get_settings')).activeCharacterId,null);
  await rpc.call('switch_character',{id:'motion-fixture',outfitId:'alternate'});
  checks.push('schema-provided BigFish reference imports and activates through real MCP with all four original PNGs, motion and asset notice; source stays unchanged and legacy BigFish selection exits package mode');
  fs.writeFileSync(path.join(root,'report.json'),JSON.stringify({checks,executable,isolatedRoot:root,sourceIndependenceMode:sourceEdited?'source-content-invalidated':'source-directory-moved',stderr,nativeStdioTested:true,desktopAndHttpTested:false},null,2));
  fs.writeFileSync('tmp/native-validation/stdio-latest.json',JSON.stringify({report:path.join(root,'report.json'),checks:checks.length},null,2));
  console.log(JSON.stringify({passed:checks.length,report:path.join(root,'report.json')}));
} finally {await rpc.close();}
