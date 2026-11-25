const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {chromium}=require(path.join(process.argv[2],'playwright'));
const root='tmp/native-validation',session=JSON.parse(fs.readFileSync(path.join(root,'desktop-session.json'),'utf8'));
const report={checks:[],recordsRawInput:false,screenshotsSaved:false};let request=0,page,before,selected=false;
async function rpc(name,args={}){
  const response=await fetch(`http://127.0.0.1:${session.mcpPort}/mcp`,{method:'POST',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(5000),body:JSON.stringify({jsonrpc:'2.0',id:++request,method:'tools/call',params:{name,arguments:args}})});
  const wire=await response.json();assert.ok(!wire.error);assert.notEqual(wire.result.isError,true,JSON.stringify(wire));return JSON.parse(wire.result.content[0].text);
}
(async()=>{
  const browser=await chromium.connectOverCDP(`http://127.0.0.1:${session.debugPort}`);
  page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url()==='http://tauri.localhost/');assert.ok(page);
  const state=await(await fetch(`http://127.0.0.1:${session.obsPort}/obs/state`)).json();assert.equal(state.privacy,false,'Do not interrupt active privacy input');
  before=await rpc('get_settings');assert.notEqual(before.activeCharacterId,'dafeiyu-reference','Keep the reference inactive before this selection test');
  const reference=(await rpc('get_character_schema')).dafeiyuReferencePackage;
  const catalog=await rpc('list_characters');
  if(!catalog.characters.some(c=>c.entry.id===reference.id))await rpc('import_character_package',{path:path.resolve('src'),manifest:reference});
  const saved=await rpc('get_character_package',{id:reference.id});
  assert.deepEqual(saved.manifest.outfits[0].motion2d,reference.outfits[0].motion2d);
  assert.equal(saved.manifest.assetNotice,reference.assetNotice);
  const hashes=Object.values(reference.outfits[0].bodySprites).filter(value=>value.endsWith('.png')).map(asset=>crypto.createHash('sha256').update(fs.readFileSync(path.join('src',asset))).digest('hex'));
  await page.evaluate(()=>{
    const urls=new Map(),create=URL.createObjectURL,draw=CanvasRenderingContext2D.prototype.drawImage;
    window.__referenceProbe={create,draw,hash:null};
    URL.createObjectURL=function(blob){const url=create.call(URL,blob);blob.arrayBuffer().then(b=>crypto.subtle.digest('SHA-256',b)).then(b=>urls.set(url,Array.from(new Uint8Array(b),v=>v.toString(16).padStart(2,'0')).join('')));return url;};
    CanvasRenderingContext2D.prototype.drawImage=function(image,...args){if(image instanceof HTMLImageElement&&image.naturalWidth===224&&image.naturalHeight===278)window.__referenceProbe.hash=urls.get(image.src)??window.__referenceProbe.hash;return draw.call(this,image,...args);};
  });
  selected=true;
  await rpc('switch_character',{id:reference.id,outfitId:'dafeiyu'});
  await page.waitForFunction(hashes=>hashes.includes(window.__referenceProbe.hash),hashes);
  assert.equal(await page.locator('.character-load-status').textContent(),'');
  report.checks.push('real production WebView draws a decoded reference-package PNG whose bytes match an original BigFish expression');
  const deadline=Date.now()+10000;let frame;
  do{frame=(await(await fetch(`http://127.0.0.1:${session.obsPort}/obs/state`)).json()).characterState;if(frame?.identity.id===reference.id)break;await new Promise(r=>setTimeout(r,80));}while(Date.now()<deadline);
  assert.equal(frame?.identity.id,reference.id);assert.equal(frame.identity.outfitId,'dafeiyu');assert.equal(frame.identity.revision,saved.entry.revision);
  report.referenceIdentity=frame.identity;
  report.checks.push('native IPC publisher and OBS snapshot use the selected reference package revision and outfit');
})().catch(error=>{report.error=String(error);process.exitCode=1;}).finally(async()=>{
  try{
    if(selected){
      const current=await rpc('get_settings');
      if(current.activeCharacterId==='dafeiyu-reference'){
        if(before.activeCharacterId)await rpc('switch_character',{id:before.activeCharacterId,outfitId:before.characterOutfits[before.activeCharacterId]});
        else await rpc('switch_cat',{id:before.catBreed});
        const restored=await rpc('get_settings');assert.equal(restored.activeCharacterId,before.activeCharacterId);assert.equal(restored.catBreed,before.catBreed);
        report.checks.push('original actor selection restored through real MCP after reference playback');report.selectionRestored=true;
      }else report.selectionRestoreSkipped='User independently changed selection; preserved it';
    }
    if(page)await page.evaluate(()=>{const probe=window.__referenceProbe;if(probe){URL.createObjectURL=probe.create;CanvasRenderingContext2D.prototype.drawImage=probe.draw;delete window.__referenceProbe;}});
  }catch(error){report.cleanupError=String(error);process.exitCode=1;}
  fs.writeFileSync(path.join(root,'bigfish-reference-desktop-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));process.exit(process.exitCode??0);
});
