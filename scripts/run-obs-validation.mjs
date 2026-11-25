import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
const output=path.resolve('tmp/native-validation');
const profile=JSON.parse(fs.readFileSync(path.join(output,'obs-profile.json'),'utf8'));
const executable=path.join(profile.root,'bin/64bit/obs64.exe');
const sessionPath=path.join(output,'obs-session.json');
if(fs.existsSync(sessionPath)){
  const previous=JSON.parse(fs.readFileSync(sessionPath,'utf8'));
  let alive=false;try{process.kill(previous.pid,0);alive=true;}catch{}
  if(alive)throw new Error(`Recorded portable OBS is already running: ${previous.pid}`);
}
const dataRoot=path.join(output,'obs-user-data');
for(const directory of ['appdata','localappdata','temp'])fs.mkdirSync(path.join(dataRoot,directory),{recursive:true});
const args=['--portable','--disable-updater','--only-bundled-plugins'];
const child=spawn(executable,args,{cwd:path.dirname(executable),windowsHide:false,env:{...process.env,
  APPDATA:path.join(dataRoot,'appdata'),LOCALAPPDATA:path.join(dataRoot,'localappdata'),TMP:path.join(dataRoot,'temp'),TEMP:path.join(dataRoot,'temp')},stdio:['ignore','pipe','pipe']});
fs.writeFileSync(sessionPath,JSON.stringify({pid:child.pid,executable,cwd:path.dirname(executable),args,dataRoot,portableRoot:profile.root},null,2));
const log=fs.createWriteStream(path.join(output,'obs-launch.log'));
child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
child.on('error',error=>{console.error(error);log.end();process.exitCode=1;});
child.on('exit',(code,signal)=>{log.end();console.log(JSON.stringify({exited:true,code,signal,pid:child.pid}));process.exitCode=code??1;});
console.log(JSON.stringify({pid:child.pid,portable:true,cwd:path.dirname(executable),onlyBrowserScene:true}));
