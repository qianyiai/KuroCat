// Existing Playwright + installed Edge; no browser download, no Tauri build.
const path=require('node:path');
const fs=require('node:fs');
const assert=require('node:assert/strict');
const {chromium}=require(path.join(process.argv[2],'playwright'));
(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  const errors=[],checks=[];
  fs.mkdirSync('tmp/visual-preview',{recursive:true});
  try{
    const page=await browser.newPage({viewport:{width:1500,height:1050},deviceScaleFactor:1});
    page.on('pageerror',error=>{errors.push(error.message);console.error('Page error:',error.message);});
    page.on('console',message=>{if(message.type()==='error'){errors.push(message.text());console.error(message.text());}});
    await page.goto('http://127.0.0.1:1422/visual-2d.html');
    await page.waitForFunction(()=>window.visual2d?.ready);
    console.log(await page.locator('button,select').allTextContents());
    async function state(id='shared'){return JSON.parse(await page.locator(`#${id}-state`).innerText());}
    async function elapsed(ms){const start=await page.evaluate(()=>window.visual2d.time);await page.waitForFunction(t=>window.visual2d.time>=t,start+ms);}
    assert.equal(await page.locator('canvas').count(),3);
    const opaque=await page.locator('canvas').evaluateAll(canvases=>canvases.map(canvas=>{
      const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
      let count=0;for(let i=3;i<pixels.length;i+=4)if(pixels[i]>0)count++;return count;
    }));assert.ok(opaque.every(count=>count>10000));checks.push({name:'three real PNG/Canvas render paths',opaque});
    await page.getByRole('button',{name:'暂停',exact:true}).click();
    const pausedTime=await page.evaluate(()=>window.visual2d.time);
    await page.getByRole('button',{name:'单步 1/60 秒',exact:true}).click();
    assert.ok(Math.abs(await page.evaluate(()=>window.visual2d.time)-pausedTime-1000/60)<.01);checks.push({name:'pause and fixed single step'});
    await page.screenshot({path:'tmp/visual-preview/2d-visual-review.png',fullPage:true});
    await page.getByRole('button',{name:'暂停',exact:true}).click();
    await page.getByRole('button',{name:'连续打字',exact:true}).click();await elapsed(650);
    await page.getByRole('button',{name:'释放所有输入',exact:true}).click();
    await page.locator('#shared').focus();await page.keyboard.down('a');
    await page.waitForFunction(()=>{const state=JSON.parse(document.getElementById('shared-state').textContent);return state.leftHeld+state.rightHeld+state.tailHeld>0;});
    assert.ok((await state()).leftHeld+(await state()).rightHeld+(await state()).tailHeld>0);
    await page.keyboard.up('a');checks.push({name:'typing control and real keyboard hold acquire a limb'});
    await page.getByRole('button',{name:'鼠标＋键盘＋尾巴',exact:true}).click();await elapsed(400);
    assert.equal((await state()).tailHeld,1);assert.equal((await state()).rightHeld,1);
    assert.equal((await state('person')).tailHeld,0);checks.push({name:'parallel mouse/key/tail and calm no-tail capability'});
    await page.getByRole('button',{name:'释放所有输入',exact:true}).click();
    assert.equal((await state()).tailHeld,0);
    await page.getByRole('button',{name:'往返抚摸',exact:true}).click();await elapsed(1100);
    assert.ok((await state()).petEnergy>.25);assert.equal((await state()).expression,'happy');assert.equal((await state('person')).expression,'shy');
    await page.screenshot({path:'tmp/visual-preview/petting.png',fullPage:true});checks.push({name:'pet strokes, happy sprite and distinct calm expression'});
    await page.getByRole('button',{name:'隐私模式',exact:true}).click();await elapsed(200);
    assert.equal((await state()).expression,'blink');assert.equal((await state()).particles,0);
    await page.getByRole('button',{name:'匿名输入反馈',exact:true}).click();await elapsed(150);
    await page.screenshot({path:'tmp/visual-preview/privacy.png',fullPage:true});checks.push({name:'privacy cover and anonymous input'});
    await page.getByRole('button',{name:'隐私模式',exact:true}).click();await elapsed(100);
    assert.equal((await state()).leftHeld+(await state()).rightHeld+(await state()).tailHeld,0);
    await page.locator('#layout').selectOption('108');await page.locator('#orientation').selectOption('viewer');await page.locator('#scale').selectOption('0.6');
    await elapsed(200);await page.screenshot({path:'tmp/visual-preview/layout-108.png',fullPage:true});checks.push({name:'108/viewer/60% layout renders'});
    await page.locator('#personality').selectOption('dafeiyu');await page.getByRole('button',{name:'鼠标＋键盘＋尾巴',exact:true}).click();await elapsed(400);
    assert.equal((await state('person')).tailHeld,1);checks.push({name:'personality replacement activates new tail capability'});
    await page.getByRole('button',{name:'释放所有输入',exact:true}).click();
    await page.setViewportSize({width:760,height:1000});await elapsed(100);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));checks.push({name:'narrow viewport no horizontal overflow'});
    assert.deepEqual(errors,[]);
    fs.writeFileSync('tmp/visual-preview/report.json',JSON.stringify({checks,errors,nativeIntegrationTested:false},null,2));
    console.log(JSON.stringify({passed:checks.length,errors}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
