const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(path.join(process.argv[2],'playwright'));
(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  const checks=[],errors=[];
  try {
    const cases=[{query:'mode=3d',threeD:false,label:'active custom person stays 2D despite mode override'},
      {query:'mode=3d&breed=black',threeD:true,label:'explicit legacy cat override retains real Three.js rendering'},
      {query:'mode=3d&breed=dafeiyu',threeD:false,label:'built-in BigFish remains 2D'}];
    for(const item of cases){
      const page=await browser.newPage({viewport:{width:540,height:456}});
      page.on('pageerror',error=>errors.push(error.message));
      page.on('console',message=>{if(message.type()==='error'&&!message.location().url.endsWith('/favicon.ico'))errors.push(message.text());});
      await page.goto(`http://127.0.0.1:37421/obs.html?${item.query}`);
      if(item.threeD){
        await page.waitForFunction(()=>!document.getElementById('obs-canvas-3d').classList.contains('hidden'));
        assert.equal(await page.locator('#obs-canvas').isHidden(),true);
        assert.equal(await page.locator('#obs-canvas-3d').evaluate(canvas=>!!canvas.getContext('webgl2')),true);
        await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
        await page.screenshot({path:'tmp/native-validation/legacy-cat-3d.png',omitBackground:true});
      }else{
        await page.waitForFunction(()=>document.getElementById('obs-canvas-3d').classList.contains('hidden'));
        assert.equal(await page.locator('#obs-canvas').isVisible(),true);
        if(!item.query.includes('breed='))await page.waitForFunction(()=>document.getElementById('obs-character-status').hidden);
      }
      checks.push(item.label);await page.close();
    }
    assert.deepEqual(errors,[]);
    fs.writeFileSync('tmp/native-validation/render-modes-report.json',JSON.stringify({checks,errors,nativeProductionServer:true,softwareWebgl:true,realObsApplication:false,newPerson3D:false},null,2));
    console.log(JSON.stringify({passed:checks.length,errors}));
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
