// Keeps event kinds/counts and non-sensitive display metrics only; never records key values.
import fs from 'node:fs';
const root='tmp/native-validation';
const name=process.argv[2]??'input-monitor';
if(!/^[a-z][a-z0-9-]{0,47}$/.test(name))throw new Error('Expected a portable monitor name');
const controlPath=`${root}/${name}-control.json`;
const reportPath=`${root}/${name}-report.json`;
const report={phases:{},rawDisplayFieldDetected:false,privacyPulseHasExtraFields:false,rawKeyDuringPrivacy:false,privacyDisplayStateViolation:false,privacyTransitions:0,recordsRawInput:false};
let observedPrivacy=false;
let control={phase:'baseline',stop:false};
fs.writeFileSync(controlPath,JSON.stringify(control));
const abort=new AbortController();
const timer=setInterval(()=>{
  try{control=JSON.parse(fs.readFileSync(controlPath,'utf8'));}catch{}
  if(control.stop)abort.abort();
},100);
const limit=setTimeout(()=>abort.abort(),180000);
function phase(){return report.phases[control.phase]??=(
  {events:{},publicEvents:{},privateEvents:{},frames:0,privacyFrames:0,maxTypingHeat:0,maxPetEnergy:0,maxMoodTier:0,
    petInsideFrames:0,petReactionFrames:0,lastPetEnergy:0});}
function privacy(active){if(active!==observedPrivacy)report.privacyTransitions++;observedPrivacy=active;}
function display(frame){
  if(!frame?.state)return;
  const p=phase(),s=frame.state;p.frames++;
  if(s.privacy)p.privacyFrames++;
  if(s.privacy&&(s.typingHeat!==0||s.moodTier!==0||s.petEnergy!==0||s.reaction!==null))report.privacyDisplayStateViolation=true;
  p.maxTypingHeat=Math.max(p.maxTypingHeat,s.typingHeat??0);
  p.maxPetEnergy=Math.max(p.maxPetEnergy,s.petEnergy??0);
  p.maxMoodTier=Math.max(p.maxMoodTier,s.moodTier??0);
  if(s.petInside)p.petInsideFrames++;
  if(s.reaction?.event==='pet')p.petReactionFrames++;
  p.lastPetEnergy=s.petEnergy??0;
  p.lastIdentity=frame.identity;
  if(/rawKeys|heldKeys|keyLabel|packagePath/.test(JSON.stringify(frame)))report.rawDisplayFieldDetected=true;
}
try{
  const response=await fetch('http://127.0.0.1:37421/obs/events',{signal:abort.signal});
  if(!response.ok)throw new Error(`Native SSE status ${response.status}`);
  console.log('Monitoring native SSE event counts; input values are discarded.');
  const decoder=new TextDecoder();let buffer='';
  for await(const bytes of response.body){
    buffer+=decoder.decode(bytes,{stream:true}).replace(/\r\n/g,'\n');
    let boundary;
    while((boundary=buffer.indexOf('\n\n'))>=0){
      const block=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);
      const event=block.split('\n').find(line=>line.startsWith('event:'))?.slice(6).trim();
      const text=block.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
      if(!text)continue;
      let value;try{value=JSON.parse(text);}catch{continue;}
      if(event==='input'&&typeof value.kind==='string'){
        const allowed=['keyDown','keyUp','mouseDown','mouseUp','mouseMove','mouseWheel','privacyTyping'];
        if(allowed.includes(value.kind)){
          const p=phase(),counts=p.events;counts[value.kind]=(counts[value.kind]??0)+1;
          const classified=observedPrivacy?p.privateEvents:p.publicEvents;
          classified[value.kind]=(classified[value.kind]??0)+1;
          if(observedPrivacy&&['keyDown','keyUp'].includes(value.kind))report.rawKeyDuringPrivacy=true;
          if(value.kind==='privacyTyping'&&Object.keys(value).some(key=>key!=='kind'))report.privacyPulseHasExtraFields=true;
        }
      }else if(event==='characterState')display(value);
      else if(event==='state'){privacy(value.privacy===true);display(value.characterState);}
      else if(event==='privacy')privacy(value===true);
    }
    fs.writeFileSync(reportPath,JSON.stringify(report,null,2));
  }
}catch(error){if(error.name!=='AbortError'){report.error=String(error);process.exitCode=1;}}
finally{
  clearInterval(timer);clearTimeout(limit);
  fs.writeFileSync(reportPath,JSON.stringify(report,null,2));
  console.log(JSON.stringify({phases:Object.keys(report.phases),rawDisplayFieldDetected:report.rawDisplayFieldDetected,recordsRawInput:false}));
}
