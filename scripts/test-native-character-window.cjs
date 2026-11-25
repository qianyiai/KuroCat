const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(path.join(process.argv[2],'playwright'));
const output='tmp/native-validation';
const session=JSON.parse(fs.readFileSync(path.join(output,'desktop-session.json'),'utf8'));
const checks=[],sizes=[];
async function snapshot(){const r=await fetch(`http://127.0.0.1:${session.obsPort}/obs/state`);assert.equal(r.status,200);return r.json();}
async function until(read,test){const end=Date.now()+10000;while(Date.now()<end){const value=await read();if(test(value))return value;await new Promise(r=>setTimeout(r,80));}throw Error('Native window condition timed out');}
(async()=>{
  const browser=await chromium.connectOverCDP(`http://127.0.0.1:${session.debugPort}`);
  const page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url()==='http://tauri.localhost/');
  assert.ok(page,'Only use the isolated production WebView');
  const invoke=(command,args={})=>page.evaluate(({command,args})=>window.__TAURI_INTERNALS__.invoke(command,args),{command,args});
  const before=await snapshot();const original=before.settings;
  const patch=values=>invoke('update_settings',{patch:values});
  const windowCall=command=>invoke(`plugin:window|${command}`,{label:'main'});
  const restore={scale:original.scale,keyboardLayout:original.keyboardLayout,keyboardOrientation:original.keyboardOrientation,
    obsHidePet:original.obsHidePet,clickThroughLocked:original.clickThroughLocked};
  try{
    const activeId=original.activeCharacterId;assert.equal(typeof activeId,'string','Select an existing isolated test package first');
    const monitors=await invoke('plugin:window|available_monitors');
    for(const keyboardLayout of ['65','108'])for(const keyboardOrientation of ['cat','viewer']){
      const scale=keyboardLayout==='65'?0.5:1;
      await patch({scale,keyboardLayout,keyboardOrientation});
      const state=await until(snapshot,s=>s.settings.keyboardLayout===keyboardLayout&&s.settings.keyboardOrientation===keyboardOrientation);
      assert.equal(state.settings.activeCharacterId,activeId);
      assert.equal(state.settings.characterOutfits[activeId],original.characterOutfits[activeId]);
      const size=await windowCall('inner_size');const factor=await windowCall('scale_factor');
      assert.ok(size.width>0&&size.height>0&&factor>0);
      sizes.push({keyboardLayout,keyboardOrientation,scale,size,factor});
      const pixels=await page.locator('#pet-canvas').evaluate(canvas=>{
        const data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;let opaque=0;
        for(let i=3;i<data.length;i+=4)if(data[i])opaque++;
        return {width:canvas.width,height:canvas.height,opaque};
      });
      assert.ok(pixels.opaque>1000,'Native canvas must contain visible rendered pixels');
    }
    assert.ok(sizes[2].size.width>sizes[0].size.width,'Native full-size layout must resize the physical window');
    checks.push('real native settings resize both keyboard layouts and project both orientations without clearing character/outfit; native canvas contains drawn pixels');
    await patch({clickThroughLocked:true});assert.equal((await snapshot()).settings.clickThroughLocked,true);
    await patch({clickThroughLocked:false});assert.equal((await snapshot()).settings.clickThroughLocked,false);
    checks.push('native click-through lock setting can be enabled and cleared without losing character selection; physical pass-through/Alt recovery remains a separate check');
    await patch({obsHidePet:false});assert.equal(await windowCall('is_visible'),true);
    await patch({obsHidePet:true});await until(()=>windowCall('is_visible'),visible=>!visible);
    const hiddenStart=await until(snapshot,s=>s.characterState?.identity.id===activeId);
    await new Promise(r=>setTimeout(r,2400));const hiddenEnd=await snapshot();
    assert.equal(hiddenEnd.settings.activeCharacterId,activeId);
    assert.ok(hiddenEnd.characterState,'Hidden desktop must retain continuous OBS state');
    assert.ok(Number(hiddenEnd.characterState.sequence)>Number(hiddenStart.characterState.sequence),'Hidden WebView must keep publishing new frames');
    assert.ok(Date.now()-hiddenEnd.characterState.capturedAt<1500,'Hidden character state must remain fresh');
    checks.push('OBS-only hide uses native visibility and keeps continuous character state fresh beyond snapshot TTL');
    await patch({obsHidePet:false});await until(()=>windowCall('is_visible'),Boolean);
    checks.push('showing the desktop again restores native visibility and preserves selected character/outfit');
    await page.screenshot({path:path.join(output,'native-window-layout.png'),omitBackground:true});
    fs.writeFileSync(path.join(output,'window-report.json'),JSON.stringify({checks,sizes,monitors,nativeProductionFrontend:true,
      actualSystemDpiTested:sizes[0].factor,physicalDragAndPassThroughTested:false,trayAndPauseTested:false},null,2));
    console.log(JSON.stringify({passed:checks.length,sizes,monitorCount:monitors.length}));
  }finally{await patch(restore);}
})().then(()=>process.exit(0),error=>{fs.writeFileSync(path.join(output,'window-failure.json'),JSON.stringify({error:String(error),stack:error.stack,checks,sizes},null,2));console.error(error);process.exit(1);});
