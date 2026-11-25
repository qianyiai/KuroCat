// Samples privacy flags and actor identity only; does not subscribe to input.
import fs from 'node:fs';
const root='tmp/native-validation';
const session=JSON.parse(fs.readFileSync(`${root}/desktop-session.json`,'utf8'));
const reportPath=`${root}/obs-privacy-monitor-report.json`,controlPath=`${root}/obs-privacy-monitor-control.json`;
const report={transitions:[],recordsRawInput:false,inputSubscribed:false,stopped:false};
fs.writeFileSync(controlPath,JSON.stringify({stop:false}));
const deadline=Date.now()+180000;let previous;
try {
  while(Date.now()<deadline&&!JSON.parse(fs.readFileSync(controlPath,'utf8')).stop){
    const response=await fetch(`http://127.0.0.1:${session.obsPort}/obs/state`,{signal:AbortSignal.timeout(4000)});
    if(!response.ok)throw Error(`Snapshot HTTP ${response.status}`);
    const snapshot=await response.json();
    const state={privacy:snapshot.privacy,displayPrivacy:snapshot.characterState?.state.privacy??null,identity:snapshot.characterState?.identity??null};
    const current=JSON.stringify(state);
    if(current!==previous){
      if(previous===undefined)console.log('Privacy snapshot monitor ready; no input subscription.');
      report.transitions.push({at:Date.now(),...state});previous=current;fs.writeFileSync(reportPath,JSON.stringify(report,null,2));
    }
    await new Promise(resolve=>setTimeout(resolve,200));
  }
}catch(error){report.error=String(error);process.exitCode=1;}
finally{report.stopped=true;fs.writeFileSync(reportPath,JSON.stringify(report,null,2));console.log(JSON.stringify({stopped:true,transitions:report.transitions.length,recordsRawInput:false}));}
