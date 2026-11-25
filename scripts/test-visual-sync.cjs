const path=require('node:path');
const fs=require('node:fs');
const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const {chromium}=require(path.join(process.argv[2],'playwright'));
(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  const errors=[],checks=[];fs.mkdirSync('tmp/visual-sync',{recursive:true});
  try{
    const page=await browser.newPage({viewport:{width:1300,height:1080}});
    page.on('pageerror',error=>{errors.push(error.message);console.error(error.message);});
    page.on('console',message=>{if(message.type()==='error'){errors.push(message.text());console.error(message.text());}});
    await page.goto('http://127.0.0.1:1422/visual-sync-2d.html');await page.waitForFunction(()=>window.visualSync?.ready&&window.visualSync.accepted>0);
    console.log(await page.locator('button,select').allTextContents());
    await page.getByRole('button',{name:'往返抚摸',exact:true}).click();
    await page.waitForFunction(()=>{const source=JSON.parse(document.getElementById('desktop-state').textContent),target=JSON.parse(document.getElementById('replica-state').textContent);
      return source.petEnergy>.5&&target.petEnergy>.5&&Math.abs(source.petEnergy-target.petEnergy)<.15;});
    assert.equal(JSON.parse(await page.locator('#replica-state').innerText()).reaction.event,'pet');checks.push('real PNG pet energy and personality synchronization');
    await page.screenshot({path:'tmp/visual-sync/2d-sync-review.png',fullPage:true});
    const wire=await page.evaluate(()=>window.visualSync.frame);assert.ok(!/rawKeys|heldKeys|packagePath|keyLabel/.test(JSON.stringify(wire)));checks.push('display snapshot excludes raw input and local paths');
    await page.locator('#latency').selectOption('800');await page.getByRole('button',{name:'隐私模式',exact:true}).click();
    await page.waitForFunction(()=>{const v=JSON.parse(document.getElementById('replica-state').textContent);return v.privacy&&v.petEnergy===0&&v.reaction===null;});
    // Wait through the delayed pre-privacy frames; they must not restore the previous reaction.
    const start=await page.evaluate(()=>performance.now());await page.waitForFunction(t=>performance.now()-t>1000,start);
    const hidden=JSON.parse(await page.locator('#replica-state').innerText());assert.equal(hidden.privacy,true);assert.equal(hidden.petEnergy,0);checks.push('late pre-privacy frames are rejected');
    await page.getByRole('button',{name:'隐私模式',exact:true}).click();
    await page.getByRole('button',{name:'断开连接',exact:true}).click();
    assert.equal(await page.evaluate(()=>window.visualSync.connected),false);
    await page.getByRole('button',{name:'往返抚摸',exact:true}).click();
    const before=await page.evaluate(()=>window.visualSync.accepted);
    await page.waitForFunction(()=>JSON.parse(document.getElementById('desktop-state').textContent).petEnergy>.5);
    assert.equal(await page.evaluate(()=>window.visualSync.accepted),before);
    assert.equal(JSON.parse(await page.locator('#replica-state').innerText()).petEnergy,0);
    await page.getByRole('button',{name:'重新连接',exact:true}).click();
    await page.waitForFunction(count=>window.visualSync.accepted>count,before);checks.push('disconnect clears state; reconnect uses a current snapshot');
    await page.locator('#preset').selectOption('calm');
    await page.waitForFunction(()=>window.visualSync.desktopIdentity.outfitId==='calm'&&window.visualSync.replicaIdentity.outfitId==='calm');
    await page.getByRole('button',{name:'往返抚摸',exact:true}).click();
    await page.waitForFunction(()=>JSON.parse(document.getElementById('replica-state').textContent).reaction?.event==='pet');
    checks.push('asynchronous outfit replacement accepts only the matching revision');

    // Run the actual OBS frontend with transport-only substitutes. Images and rendering remain real.
    const obs=await browser.newPage({viewport:{width:540,height:456}});
    let expectedResourceFailure=false;const expectedRequestErrors=[];
    obs.on('pageerror',error=>errors.push(error.message));obs.on('console',message=>{
      if(message.type()!=='error')return;
      if(expectedResourceFailure&&message.text().startsWith('Failed to load resource:'))expectedRequestErrors.push(message.text());
      else errors.push(message.text());
    });
    const motion=JSON.parse(fs.readFileSync('src-tauri/protocol/dafeiyu-motion-2d.json','utf8'));
    const bodySprites={idle:'assets/default/notail_idle.png',blink:'assets/default/notail_blink.png',shy:'assets/default/notail_shy.png',happy:'assets/default/notail_happy2.png'};
    const metadata={entry:{id:'sync-test',revision:'a'.repeat(64),name:'Sync test'},outfitId:'default',manifest:{outfits:[{id:'default',motion2d:motion,bodySprites}]}};
    let resourceMode='healthy',manifestReads=0;
    await obs.route('**/characters/**',route=>{
      if(route.request().url().endsWith('/manifest')){manifestReads++;return route.fulfill({json:metadata});}
      if(resourceMode==='missing')return route.fulfill({status:404,json:{code:'ASSET_MISSING',message:'Character resource unavailable'}});
      if(resourceMode==='stale'&&new URL(route.request().url()).pathname.split('/')[3]==='a'.repeat(64)) {
        metadata.entry.revision='b'.repeat(64);
        return route.fulfill({status:409,json:{code:'STALE_REVISION',message:'Character resource unavailable'}});
      }
      const file=new URL(route.request().url()).pathname.split('/').pop();
      if(!Object.values(bodySprites).some(asset=>asset.endsWith('/'+file)))return route.fulfill({status:404});
      return route.fulfill({contentType:'image/png',body:fs.readFileSync(path.join('src/assets/dafeiyu',file))});
    });
    await obs.addInitScript(()=>{
      class MockStream extends EventTarget {constructor(){super();window.__obsStream=this;setTimeout(()=>this.dispatchEvent(new Event('open')),0);}}
      window.EventSource=MockStream;
      window.__obsDecodedSprites=0;
      const decode=HTMLImageElement.prototype.decode;
      HTMLImageElement.prototype.decode=function(){return decode.call(this).then(()=>{window.__obsDecodedSprites++;});};
      const urls=new Map(),create=URL.createObjectURL.bind(URL);
      URL.createObjectURL=blob=>{const url=create(blob);blob.arrayBuffer().then(bytes=>crypto.subtle.digest('SHA-256',bytes)).then(bytes=>urls.set(url,Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('')));return url;};
      const draw=CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.drawImage=function(image,...args){if(image instanceof HTMLImageElement&&image.naturalWidth===224&&image.naturalHeight===278)window.__bodySprite=urls.get(image.src);return draw.call(this,image,...args);};
    });
    await obs.goto('http://127.0.0.1:1422/obs.html?mode=2d');await obs.waitForFunction(()=>window.__obsStream);
    await obs.evaluate(()=>window.__obsStream.dispatchEvent(new MessageEvent('state',{data:JSON.stringify({settings:{activeCharacterId:'sync-test',characterOutfits:{'sync-test':'default'},catBreed:'black',renderMode:'2d'},privacy:false})})));
    const hash=role=>crypto.createHash('sha256').update(fs.readFileSync(path.join('src/assets/dafeiyu',bodySprites[role].split('/').pop()))).digest('hex');
    await obs.waitForFunction(expected=>window.__bodySprite===expected,hash('idle'));
    const happy={version:1,epoch:'1',sequence:1,capturedAt:0,identity:{id:'sync-test',revision:'a'.repeat(64),outfitId:'default'},
      state:{privacy:false,petEnergy:1,petInside:true,moodTier:0,typingHeat:0,blushLevel:.4,blinkRemainingMs:0,phaseMs:10000,reaction:{event:'pet',index:0,elapsedMs:0}}};
    async function send(event,value){await obs.evaluate(({event,value})=>window.__obsStream.dispatchEvent(new MessageEvent(event,{data:JSON.stringify(value)})),{event,value});}
    happy.capturedAt=Date.now();await send('characterState',happy);
    await obs.waitForFunction(expected=>window.__bodySprite===expected,hash('happy'));checks.push('production obsMain + CharacterLoader selects the real happy PNG');
    await send('characterReset',{epoch:'2'});await send('privacy',true);
    await send('characterState',{...happy,sequence:2,capturedAt:Date.now()});
    await obs.waitForFunction(expected=>window.__bodySprite===expected,hash('blink'));
    await send('characterReset',{epoch:'3'});await send('privacy',false);
    await obs.waitForFunction(expected=>window.__bodySprite===expected,hash('idle'));
    await send('characterState',{...happy,epoch:'3',sequence:3,capturedAt:Date.now()-3000});
    await obs.waitForFunction(expected=>window.__bodySprite===expected,hash('idle'));checks.push('production OBS privacy/exit and expired snapshot rejection');
    await obs.screenshot({path:'tmp/visual-sync/obs-frontend.png'});
    resourceMode='missing';expectedResourceFailure=true;
    metadata.entry.revision='c'.repeat(64);
    await send('settings',{activeCharacterId:'sync-test'});
    await obs.locator('#obs-character-status').waitFor({state:'visible'});
    assert.match(await obs.locator('#obs-character-error').innerText(),/ASSET_MISSING/);
    await obs.screenshot({path:'tmp/visual-sync/obs-load-error.png'});
    resourceMode='healthy';await obs.getByRole('button',{name:'重试人物加载',exact:true}).click();
    await obs.locator('#obs-character-status').waitFor({state:'hidden'});
    await obs.waitForFunction(expected=>window.__bodySprite===expected,hash('idle'));
    expectedResourceFailure=false;checks.push('production OBS displays missing-resource error and recovers through retry');

    resourceMode='missing';expectedResourceFailure=true;metadata.entry.revision='d'.repeat(64);
    await send('settings',{activeCharacterId:'sync-test'});await obs.locator('#obs-character-status').waitFor({state:'visible'});
    await send('settings',{activeCharacterId:null,catBreed:'dafeiyu'});
    await obs.locator('#obs-character-status').waitFor({state:'hidden'});
    resourceMode='stale';metadata.entry.revision='a'.repeat(64);const beforeReads=manifestReads;
    const beforeDecodes=await obs.evaluate(()=>window.__obsDecodedSprites);
    const freshResponse=obs.waitForResponse(response=>response.url().includes('/'+'b'.repeat(64)+'/')&&response.ok());
    await send('settings',{activeCharacterId:'sync-test'});
    await freshResponse;
    await obs.waitForFunction(before=>window.__obsDecodedSprites>=before+4,beforeDecodes);
    await obs.waitForFunction(expected=>window.__bodySprite===expected,hash('idle'));
    await obs.waitForFunction(()=>document.getElementById('obs-character-status').hidden);
    // A fresh manifest request follows the stale asset responses, then all sprites decode.
    assert.equal(manifestReads-beforeReads,2);
    expectedResourceFailure=false;checks.push('production OBS clears errors on cat switch and refreshes stale revision once');
    assert.deepEqual(errors,[]);
    fs.writeFileSync('tmp/visual-sync/report.json',JSON.stringify({checks,errors,expectedRequestErrors,nativeIpcAndSseTested:false},null,2));
    console.log(JSON.stringify({passed:checks.length,errors}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
