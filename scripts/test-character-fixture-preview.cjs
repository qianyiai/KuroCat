const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {chromium}=require(path.join(process.argv[2],'playwright'));
(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  const checks=[],errors=[];fs.mkdirSync('tmp/motion-fixture',{recursive:true});
  try{
    const page=await browser.newPage({viewport:{width:1400,height:1000}});
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{
      const urls=new Map(),create=URL.createObjectURL.bind(URL);window.__bodySprites={};
      URL.createObjectURL=blob=>{const url=create(blob);blob.arrayBuffer().then(bytes=>crypto.subtle.digest('SHA-256',bytes)).then(bytes=>urls.set(url,Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('')));return url;};
      const draw=CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.drawImage=function(image,...args){if(image instanceof HTMLImageElement&&image.naturalWidth===224&&image.naturalHeight===278)window.__bodySprites[this.canvas.id]=urls.get(image.src);return draw.call(this,image,...args);};
    });
    const hash=role=>crypto.createHash('sha256').update(fs.readFileSync(`src/assets/dafeiyu/notail_${role}.png`)).digest('hex');
    await page.goto('http://127.0.0.1:1422/visual-character-pack.html');await page.waitForFunction(()=>window.pilotPreview?.ready);
    await page.waitForFunction(expected=>window.__bodySprites.primary===expected&&window.__bodySprites.selected===expected,hash('idle'));
    assert.deepEqual(await page.evaluate(()=>window.pilotPreview.identities.map(i=>[i.id,i.outfitId])),[['motion-fixture','primary'],['motion-fixture','alternate']]);
    checks.push('real CharacterLoader decodes existing BigFish sprites under two test-only configurations');
    await page.waitForFunction(expected=>window.__bodySprites.selected===expected,hash('blink'));
    await page.waitForFunction(expected=>window.__bodySprites.selected===expected,hash('idle'));
    checks.push('natural blink uses original BigFish PNG and returns to idle');
    await page.locator('#outfit').selectOption('primary');await page.locator('#outfit').selectOption('alternate');
    await page.waitForFunction(()=>window.pilotPreview.identities[1]?.outfitId==='alternate');
    checks.push('rapid configuration switches keep the latest identity');
    await page.locator('#typing').click();
    await page.waitForFunction(()=>window.pilotPreview.states.every(state=>state.typingHeat>.05),null,{timeout:6000});
    await page.locator('#release').click();
    checks.push('typing preview button feeds both real players and increases their measured typing heat');
    await page.locator('#pet').click();
    await page.waitForFunction(()=>window.pilotPreview.states.every(state=>state.petEnergy>.5),null,{timeout:6000});
    await page.locator('#release').click();
    checks.push('petting preview button feeds strokes into both configuration-specific interaction models');
    await page.locator('#privacy').click();
    await page.waitForFunction(expected=>window.pilotPreview.states.every(s=>s.privacy)&&window.__bodySprites.primary===expected&&window.__bodySprites.selected===expected,hash('blink'));
    await page.locator('#privacy').click();await page.waitForFunction(()=>window.pilotPreview.states.every(s=>!s.privacy));
    checks.push('privacy overrides both configurations with original closed-eye PNG and recovers');
    await page.locator('#layout').selectOption('108');await page.locator('#orientation').selectOption('viewer');await page.locator('#scale').selectOption('0.6');
    await page.locator('#retry').click();await page.waitForFunction(()=>window.pilotPreview.identities[1]?.outfitId==='alternate');
    assert.equal(await page.locator('#load-status').innerText(),'');
    checks.push('layout/orientation/scale changes and explicit loader retry preserve selected test configuration');
    await page.screenshot({path:'tmp/motion-fixture/fixture-preview.png',fullPage:true});
    assert.deepEqual(errors,[]);
    fs.writeFileSync('tmp/motion-fixture/browser-report.json',JSON.stringify({checks,errors,newArtwork:false,nativeImportTested:false},null,2));
    console.log(JSON.stringify({passed:checks.length,errors}));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
