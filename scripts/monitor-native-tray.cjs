// User-operated native tray check. Stores aggregate event counts, never key values or text.
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require(path.join(process.argv[2],'playwright'));
const output='tmp/native-validation',session=JSON.parse(fs.readFileSync(path.join(output,'desktop-session.json'),'utf8'));
const reportPath=path.join(output,'tray-monitor-report.json'),controlPath=path.join(output,'tray-monitor-control.json');
const report={phases:{},visibilityTransitions:[],recordsRawInput:false};
let phase='starting',busy=false,stop=false,visibilityTimer,limit;
const abort=new AbortController();
const save=()=>fs.writeFileSync(reportPath,JSON.stringify(report,null,2));
const current=()=>report.phases[phase]??=( {events:{},frames:0} );
(async()=>{
  const browser=await chromium.connectOverCDP(`http://127.0.0.1:${session.debugPort}`);
  const page=browser.contexts().flatMap(c=>c.pages()).find(p=>p.url()==='http://tauri.localhost/');if(!page)throw Error('Isolated native page absent');
  let hiddenSeen=false,lastVisibility;
  const observe=async()=>{
    if(busy||stop)return;busy=true;
    try{
      const visible=await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke('plugin:window|is_visible',{label:'main'}));
      if(visible!==lastVisibility){report.visibilityTransitions.push({visible,at:Date.now()});lastVisibility=visible;}
      if(!visible)hiddenSeen=true;
      phase=visible?(hiddenSeen?'restored':'baseline'):'hidden';current();save();
      if(JSON.parse(fs.readFileSync(controlPath,'utf8')).stop){stop=true;abort.abort();}
    }catch(error){report.observationError=String(error);abort.abort();}
    finally{busy=false;}
  };
  fs.writeFileSync(controlPath,JSON.stringify({stop:false,pid:process.pid}));await observe();
  visibilityTimer=setInterval(()=>void observe(),150);limit=setTimeout(()=>abort.abort(),180000);
  const response=await fetch(`http://127.0.0.1:${session.obsPort}/obs/events`,{signal:abort.signal});if(!response.ok)throw Error(`SSE ${response.status}`);
  console.log('Tray monitor ready: aggregate input counts and native visibility only.');
  const decoder=new TextDecoder();let buffer='';
  for await(const bytes of response.body){
    buffer+=decoder.decode(bytes,{stream:true}).replace(/\r\n/g,'\n');let boundary;
    while((boundary=buffer.indexOf('\n\n'))>=0){
      const block=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);
      const event=block.split('\n').find(line=>line.startsWith('event:'))?.slice(6).trim();
      const text=block.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
      if(!text)continue;let value;try{value=JSON.parse(text);}catch{continue;}
      if(event==='input'&&['keyDown','keyUp','mouseDown','mouseUp','mouseMove','mouseWheel','privacyTyping'].includes(value.kind)){
        const counts=current().events;counts[value.kind]=(counts[value.kind]??0)+1;
      }else if(event==='characterState'&&value?.identity){current().frames++;current().lastIdentity=value.identity;}
    }
    save();
  }
})().catch(error=>{if(error.name!=='AbortError'){report.error=String(error);process.exitCode=1;}}).finally(()=>{
  stop=true;clearInterval(visibilityTimer);clearTimeout(limit);report.stopped=true;save();
  console.log(JSON.stringify({phases:Object.keys(report.phases),recordsRawInput:false}));process.exit(process.exitCode??0);
});
