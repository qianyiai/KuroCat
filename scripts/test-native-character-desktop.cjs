const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {spawnSync}=require('node:child_process');
const {chromium}=require(path.join(process.argv[2],'playwright'));
const output='tmp/native-validation';
const session=JSON.parse(fs.readFileSync(path.join(output,'desktop-session.json'),'utf8'));
const obsBase=`http://127.0.0.1:${session.obsPort}`;
const checks=[],errors=[],expectedNetworkErrors=[];let ownBrowser,selectionTransition=false;
function recordConsole(message){
  if(message.type()!=='error')return;
  const entry={message:message.text(),url:message.location().url};
  if(entry.message.includes('404')&&entry.url.endsWith('/favicon.ico'))expectedNetworkErrors.push({...entry,reason:'development page has no favicon'});
  else if(selectionTransition&&entry.message.includes('404')&&[`${obsBase}/characters/motion-fixture/manifest`,'http://127.0.0.1:1420/characters/motion-fixture/manifest'].includes(entry.url))
    expectedNetworkErrors.push({...entry,reason:'in-flight manifest request after native selection clears; loader generation discards it'});
  else errors.push(entry);
}
function observeSprites(){
  const urls=new Map(),create=URL.createObjectURL.bind(URL);window.__nativeSprite='';
  URL.createObjectURL=blob=>{const url=create(blob);blob.arrayBuffer().then(bytes=>crypto.subtle.digest('SHA-256',bytes)).then(bytes=>urls.set(url,Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('')));return url;};
  const draw=CanvasRenderingContext2D.prototype.drawImage;
  CanvasRenderingContext2D.prototype.drawImage=function(image,...args){if(image instanceof HTMLImageElement&&image.naturalWidth===224&&image.naturalHeight===278)window.__nativeSprite=urls.get(image.src);return draw.call(this,image,...args);};
}
let requestId=0;
async function rpc(name,args={}){
  const reply=await fetch(`http://127.0.0.1:${session.mcpPort}/mcp`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:++requestId,method:'tools/call',params:{name,arguments:args}})});
  assert.equal(reply.status,200);const wire=await reply.json();assert.ok(!wire.error,JSON.stringify(wire.error));
  const value=JSON.parse(wire.result.content[0].text);assert.notEqual(wire.result.isError,true,JSON.stringify(value));return value;
}
async function snapshot(){return (await fetch(`http://127.0.0.1:${session.obsPort}/obs/state`)).json();}
async function until(action,predicate){const started=Date.now();while(Date.now()-started<10000){const value=await action();if(predicate(value))return value;await new Promise(resolve=>setTimeout(resolve,50));}throw new Error('Native state condition timed out');}
const hashes=outfit=>['idle','blink','shy','happy2'].map(role=>crypto.createHash('sha256').update(fs.readFileSync(`src/assets/dafeiyu/notail_${role}.png`)).digest('hex'));
(async()=>{
  const native=await chromium.connectOverCDP(`http://127.0.0.1:${session.debugPort}`);
  const desktop=native.contexts().flatMap(context=>context.pages()).find(page=>{
    const url=new URL(page.url());return url.pathname==='/'&&
      ((url.hostname==='localhost'&&url.port==='1420')||url.hostname==='tauri.localhost'||url.protocol==='tauri:');
  });
  assert.ok(desktop,'Attach only to this isolated KuroCat WebView');
  desktop.on('pageerror',error=>errors.push(error.message));
  desktop.on('console',recordConsole);
  const diskSelection=JSON.parse(fs.readFileSync(path.join(session.appdata,'kuro-cat-pet/character-selection.json'),'utf8'));
  const restored=await rpc('get_settings');
  assert.equal(restored.activeCharacterId,diskSelection.activeCharacterId);
  assert.equal(restored.characterOutfits['motion-fixture'],diskSelection.characterOutfits['motion-fixture']);
  checks.push('running native instance restores the character and outfit recorded in its persistent selection file');
  await rpc('switch_character',{id:'motion-fixture',outfitId:'alternate'});
  await desktop.addInitScript(observeSprites);await desktop.reload();
  await desktop.waitForFunction(expected=>expected.includes(window.__nativeSprite),hashes('alternate'));
  await until(snapshot,state=>state.characterState?.identity.outfitId==='alternate');
  await desktop.screenshot({path:path.join(output,'desktop-character.png'),omitBackground:true});
  checks.push('real native desktop decodes installed pilot sprites and publishes continuous state through Tauri IPC');
  const saved=await rpc('get_character_package',{id:'motion-fixture'});assert.equal(saved.integrityChecked,true);
  await rpc('set_character_outfit',{id:'motion-fixture',outfitId:'primary'});
  await desktop.waitForFunction(expected=>expected.includes(window.__nativeSprite),hashes('primary'));
  await until(snapshot,state=>state.characterState?.identity.outfitId==='primary');
  checks.push('real HTTP MCP outfit switch reaches desktop settings, decoded sprites and OBS identity');
  const privacyBlocked=await fetch(`http://127.0.0.1:${session.mcpPort}/mcp`,{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://example.invalid'},body:JSON.stringify({jsonrpc:'2.0',id:999,method:'tools/call',params:{name:'switch_character',arguments:{id:'motion-fixture'}}})});
  assert.equal(privacyBlocked.status,403);checks.push('HTTP character mutation rejects browser Origin before execution');
  const input=JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'set_character_outfit',arguments:{id:'motion-fixture',outfitId:'alternate'}}})+'\n';
  const stdio=spawnSync(session.executable,['--mcp'],{input,encoding:'utf8',windowsHide:true,timeout:15000,env:{...process.env,APPDATA:session.appdata,LOCALAPPDATA:path.join(session.root,'localappdata'),TMP:path.join(session.root,'temp'),TEMP:path.join(session.root,'temp')}});
  assert.equal(stdio.status,0,stdio.stderr);assert.notEqual(JSON.parse(stdio.stdout.trim()).result.isError,true);
  await desktop.waitForFunction(expected=>expected.includes(window.__nativeSprite),hashes('alternate'));
  await until(snapshot,state=>state.characterState?.identity.outfitId==='alternate');
  checks.push('independent real stdio outfit write reaches the running desktop through its storage watcher');
  ownBrowser=await chromium.launch({channel:'msedge',headless:true});
  const obs=await ownBrowser.newPage({viewport:{width:540,height:456}});await obs.addInitScript(observeSprites);
  obs.on('pageerror',error=>errors.push(error.message));obs.on('console',recordConsole);
  await obs.goto(`${obsBase}/obs.html?mode=2d`);
  await obs.waitForFunction(expected=>expected.includes(window.__nativeSprite),hashes('alternate'));
  assert.equal(await obs.locator('#obs-character-status').isHidden(),true);
  const manifest=await (await fetch(`http://127.0.0.1:${session.obsPort}/characters/motion-fixture/manifest`)).json();
  const image=await (await fetch(`http://127.0.0.1:${session.obsPort}/characters/motion-fixture/${manifest.entry.revision}/${manifest.manifest.outfits.find(outfit=>outfit.id==='alternate').bodySprites.idle}`)).arrayBuffer();
  assert.equal(crypto.createHash('sha256').update(Buffer.from(image)).digest('hex'),hashes('alternate')[0]);
  await obs.screenshot({path:path.join(output,'obs-native-transport.png'),omitBackground:true});
  checks.push('production OBS HTML/bundles load directly from the native server and consume real SSE, selected manifest and verified PNG bytes');
  await rpc('set_character_outfit',{id:'motion-fixture',outfitId:'primary'});
  await Promise.all([desktop,obs].map(page=>page.waitForFunction(expected=>expected.includes(window.__nativeSprite),hashes('primary'))));
  selectionTransition=true;
  await rpc('switch_cat',{id:'black'});await until(snapshot,state=>state.settings.activeCharacterId===null);
  await desktop.waitForFunction(()=>document.querySelector('.character-menu .active')===null);
  await rpc('switch_character',{id:'motion-fixture',outfitId:'alternate'});
  await Promise.all([desktop,obs].map(page=>page.waitForFunction(expected=>expected.includes(window.__nativeSprite),hashes('alternate'))));
  await until(snapshot,state=>state.characterState?.identity.outfitId==='alternate');
  assert.equal(await obs.locator('#obs-character-status').isHidden(),true);
  assert.equal(await desktop.locator('.character-load-status').innerText(),'');
  selectionTransition=false;
  checks.push('native HTTP switching updates desktop and OBS together and restores pilot after legacy cat selection');
  const existingMenu=native.contexts().flatMap(context=>context.pages()).find(page=>new URL(page.url()).pathname==='/menu.html');
  const menuReady=existingMenu?Promise.resolve(existingMenu):native.contexts()[0].waitForEvent('page');
  await desktop.locator('#pet-canvas').click({button:'right',position:{x:180,y:180}});
  const menu=await menuReady;await menu.waitForURL('**/menu.html');
  await menu.waitForFunction(()=>document.querySelector('.character-menu .active')?.dataset.characterId==='motion-fixture'
    &&document.querySelector('.character-menu .active')?.dataset.outfitId==='alternate');
  assert.equal(await menu.evaluate(()=>window.__TAURI_INTERNALS__.invoke('plugin:window|is_visible',{label:'menu'})),true);
  assert.match(await menu.locator('[data-character-id="native-race"][data-outfit-id="primary"]').innerText(),/native-race/);
  await menu.locator('[data-character-id="motion-fixture"][data-outfit-id="primary"]').click();
  await desktop.waitForFunction(expected=>expected.includes(window.__nativeSprite),hashes('primary'));
  await menu.waitForFunction(()=>document.getElementById('menu-header').textContent.includes('primary'));
  const compactLabel=await menu.locator('[data-character-id="motion-fixture"][data-outfit-id="primary"]').evaluate(button=>({
    whiteSpace:getComputedStyle(button).whiteSpace,textOverflow:getComputedStyle(button).textOverflow,title:button.title,
    height:button.getBoundingClientRect().height,catHeight:document.querySelector('#breed-pills .breed-pill').getBoundingClientRect().height,
  }));
  assert.equal(compactLabel.whiteSpace,'nowrap');assert.equal(compactLabel.textOverflow,'ellipsis');
  assert.ok(compactLabel.title.includes('motion-fixture')&&compactLabel.title.includes('primary'));
  assert.ok(Math.abs(compactLabel.height-compactLabel.catHeight)<1,'character buttons must match legacy cat button height');
  await menu.screenshot({path:path.join(output,'native-menu.png')});
  // Inject only the notification; this does not claim to click a real system tray item.
  const selectionError='人物切换失败（OUTFIT_NOT_FOUND）：Unknown outfit；保留原选择，请重试或重新导入。';
  const beforeFailure=await rpc('get_settings');
  const rejected=await desktop.evaluate(async()=>{
    try {await window.__TAURI_INTERNALS__.invoke('switch_character',{id:'motion-fixture',outfitId:'missing-outfit'});return null;}
    catch(error){return String(error);}
  });
  assert.match(rejected,/Unknown outfit/);
  await desktop.evaluate(payload=>window.__TAURI_INTERNALS__.invoke('plugin:event|emit',{event:'kuro-character-selection-error',payload}),selectionError);
  await desktop.waitForFunction(message=>document.querySelector('.character-load-status').textContent===message,selectionError);
  await menu.waitForFunction(message=>document.querySelector('.character-menu-status').textContent===message,selectionError);
  const afterFailure=await rpc('get_settings');
  assert.equal(afterFailure.activeCharacterId,beforeFailure.activeCharacterId);
  assert.deepEqual(afterFailure.characterOutfits,beforeFailure.characterOutfits);
  checks.push('real native IPC rejects an invalid outfit without changing selection; injected Tauri error notification appears in both production windows');
  await menu.locator('[data-character-id="motion-fixture"][data-outfit-id="primary"]').click();
  await desktop.waitForFunction(()=>document.querySelector('.character-load-status').textContent==='');
  await menu.waitForFunction(()=>document.querySelector('.character-menu-status').textContent==='');
  checks.push('successful real native selection clears the notification in desktop and standalone menu, including a retry of the current outfit');
  await menu.locator('#btn-close-menu').click();
  assert.equal(await menu.evaluate(()=>window.__TAURI_INTERNALS__.invoke('plugin:window|is_visible',{label:'menu'})),false);
  await rpc('set_character_outfit',{id:'motion-fixture',outfitId:'alternate'});
  await Promise.all([desktop,obs].map(page=>page.waitForFunction(expected=>expected.includes(window.__nativeSprite),hashes('alternate'))));
  checks.push('real native context menu opens as a Tauri window, switches outfit and closes through native window commands');
  assert.deepEqual(errors,[]);
  const staticResponse=await fetch(`http://127.0.0.1:${session.obsPort}/obs.html`);
  assert.equal(staticResponse.status,200);
  fs.writeFileSync(path.join(output,'desktop-report.json'),JSON.stringify({checks,errors,expectedNetworkErrors,nativeDesktopAndHttpTested:true,desktopUrl:desktop.url(),standaloneFrontend:!desktop.url().includes(':1420'),realSseAndAssetsTested:true,obsHtmlServedByDevelopmentVite:false,nativeObsStaticStatus:staticResponse.status,realObsApplicationTested:false,systemInputTested:false,traySelectionClicked:false,selectionErrorNotificationInjected:true},null,2));
  await ownBrowser.close();
  // Closing this Node connection must not close the user's native WebView/browser process.
  process.stdout.write(JSON.stringify({passed:checks.length,errors,nativeObsStaticStatus:staticResponse.status})+'\n',()=>process.exit(0));
})().catch(async error=>{
  const failure={message:error.stack??String(error),completed:checks,errors};
  fs.writeFileSync(path.join(output,'desktop-failure.json'),JSON.stringify(failure,null,2));
  if(ownBrowser)await ownBrowser.close().catch(()=>{});
  process.stderr.write(JSON.stringify(failure)+'\n',()=>process.exit(1));
});
