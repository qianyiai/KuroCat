// User-operated tray selection check. Stores identities only, never subscribes to input.
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require(path.join(process.argv[2],'playwright'));
const root='tmp/native-validation',session=JSON.parse(fs.readFileSync(path.join(root,'desktop-session.json'),'utf8'));
const controlPath=path.join(root,'tray-selection-control.json'),reportPath=path.join(root,'tray-selection-report.json');
const report={processId:session.pid,settingsTransitions:[],displayTransitions:[],recordsRawInput:false,inputSubscribed:false,stopped:false};
let busy=false,timer,limit,finished=false,lastSettings,lastDisplay;
const save=()=>fs.writeFileSync(reportPath,JSON.stringify(report,null,2));
function finish(error){
  if(finished)return;finished=true;clearInterval(timer);clearTimeout(limit);
  if(error){report.error=String(error);process.exitCode=1;}
  report.stopped=true;save();console.log(JSON.stringify({stopped:true,settingsTransitions:report.settingsTransitions.length,displayTransitions:report.displayTransitions.length,recordsRawInput:false}));
  process.exit(process.exitCode??0);
}
(async()=>{
  const browser=await chromium.connectOverCDP(`http://127.0.0.1:${session.debugPort}`);
  const page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url()==='http://tauri.localhost/');
  if(!page)throw Error('Isolated native page absent');
  const tooltip='KuroCat 测试版 5.1.0（人物换装验收）';
  const rid=await page.evaluate(async tooltip=>{
    const invoke=window.__TAURI_INTERNALS__.invoke;
    const rid=await invoke('plugin:tray|get_by_id',{id:'kuro-tray'});
    if(!rid)throw Error('Test tray absent');
    await invoke('plugin:tray|set_tooltip',{rid,tooltip});return rid;
  },tooltip);
  fs.writeFileSync(path.join(root,'tray-test-identity.json'),JSON.stringify({rid,tooltip,processId:session.pid},null,2));
  fs.writeFileSync(controlPath,JSON.stringify({stop:false}));
  const observe=async()=>{
    if(busy||finished)return;busy=true;
    try{
      if(JSON.parse(fs.readFileSync(controlPath,'utf8')).stop){finish();return;}
      const response=await fetch(`http://127.0.0.1:${session.obsPort}/obs/state`,{signal:AbortSignal.timeout(4000)});
      if(!response.ok)throw Error(`Snapshot HTTP ${response.status}`);
      const state=await response.json(),id=state.settings.activeCharacterId;
      const settings={id,outfitId:id?state.settings.characterOutfits?.[id]??null:null};
      const display=state.characterState?.identity??null;
      for(const [key,value,previous] of [['settingsTransitions',settings,lastSettings],['displayTransitions',display,lastDisplay]]){
        if(JSON.stringify(value)!==JSON.stringify(previous))report[key].push({at:Date.now(),identity:value});
      }
      lastSettings=settings;lastDisplay=display;save();
    }catch(error){finish(error);}finally{busy=false;}
  };
  await observe();if(finished)return;
  timer=setInterval(()=>void observe(),200);limit=setTimeout(()=>finish(),180000);
  console.log('Tray character monitor ready: selection and display identities only; no input subscription.');
})().catch(finish);
