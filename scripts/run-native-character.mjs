import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
const output=path.resolve('tmp/native-validation');
const sessionFile=path.join(output,'desktop-session.json');
let previousSession=null;
if(fs.existsSync(sessionFile)){
  const previous=JSON.parse(fs.readFileSync(sessionFile,'utf8'));
  let alive=false;try{process.kill(previous.pid,0);alive=true;}catch{}
  if(alive)throw new Error(`An existing recorded desktop process is still live: ${previous.pid}`);
  previousSession=previous;
}
const latest=JSON.parse(fs.readFileSync(path.join(output,'stdio-latest.json'),'utf8'));
const report=JSON.parse(fs.readFileSync(latest.report,'utf8'));
if(!report.nativeStdioTested||report.checks.length<8)throw new Error('Run the real stdio regression first');
const resume=process.argv.includes('--resume');
if(resume&&!previousSession)throw new Error('No recorded desktop session to resume');
const root=resume?previousSession.root:path.join(os.tmpdir(),'kurocat-native-validation',`desktop-${Date.now()}-${process.pid}`);
fs.mkdirSync(root,{recursive:true});
const appdata=path.join(root,'appdata');
if(!resume)fs.cpSync(path.join(report.isolatedRoot,'appdata'),appdata,{recursive:true});
const settingsFile=path.join(appdata,'kuro-cat-pet/settings.json');
const settings=JSON.parse(fs.readFileSync(settingsFile,'utf8'));
Object.assign(settings,{mcpPort:37420,mcpEnabled:true,obsPort:37421,obsEnabled:true,obsHidePet:false,
  renderMode:'2d',autostart:false,alwaysOnTop:true,clickThroughLocked:false});
if(!resume)Object.assign(settings,{scale:1,x:100,y:100});
fs.writeFileSync(settingsFile,JSON.stringify(settings,null,2));
for(const name of ['localappdata','temp','webview2'])fs.mkdirSync(path.join(root,name),{recursive:true});
const executable=path.resolve(process.argv.slice(2).find(arg=>arg!=='--resume')??'tmp/native-validation/target/x86_64-pc-windows-msvc/debug/KuroCat.exe');
const child=spawn(executable,[],{windowsHide:true,env:{...process.env,APPDATA:appdata,LOCALAPPDATA:path.join(root,'localappdata'),
  TMP:path.join(root,'temp'),TEMP:path.join(root,'temp'),WEBVIEW2_USER_DATA_FOLDER:path.join(root,'webview2'),
  WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:'--remote-debugging-port=9225 --remote-debugging-address=127.0.0.1'},stdio:['ignore','pipe','pipe']});
const session={pid:child.pid,executable,root,appdata,mcpPort:37420,obsPort:37421,debugPort:9225};
fs.writeFileSync(sessionFile,JSON.stringify(session,null,2));
const log=fs.createWriteStream(path.join(output,'desktop.log'),{flags:'w'});
child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
child.on('error',error=>{console.error(error);log.end();process.exitCode=1;});
child.on('exit',(code,signal)=>{log.end();console.log(JSON.stringify({exited:true,pid:child.pid,code,signal}));process.exitCode=code??1;});
console.log(JSON.stringify(session));
