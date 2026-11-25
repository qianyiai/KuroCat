import {writeCharacterFixture} from './character-test-fixture.mjs';
// Minimal filesystem publication probes. Keeps every fixture; never changes ACLs or retries.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const workspace=fs.realpathSync('.');
const output=path.join(workspace,'tmp/native-validation');
const nonce=`publication-${Date.now()}-${process.pid}`;
const roots=[path.join(output,nonce),path.join(os.tmpdir(),'kurocat-native-validation',nonce)];
const results=[];
for(const root of roots){
  const allowedParent=root===roots[0]?output:path.join(os.tmpdir(),'kurocat-native-validation');
  if(path.dirname(root)!==allowedParent)throw Error('Probe root escaped its intended temporary directory');
  fs.mkdirSync(root,{recursive:true});
  for(const kind of ['file','empty-directory','populated-directory','png-package','png-package-cross-parent']){
    const source=path.join(root,`${kind}-stage`),destination=kind==='png-package-cross-parent'
      ?path.join(root,'characters/motion-fixture','0'.repeat(64)):path.join(root,`${kind}-revision`);
    if(![source,destination].every(target=>{const relative=path.relative(root,target);return relative&&!relative.startsWith('..')&&!path.isAbsolute(relative);}))throw Error('Probe move escaped fixture');
    fs.mkdirSync(path.dirname(destination),{recursive:true});
    if(kind==='file')fs.writeFileSync(source,'owned publication probe',{flag:'wx'});
    else{
      fs.mkdirSync(source);
      if(kind==='populated-directory'){fs.mkdirSync(path.join(source,'assets'));fs.writeFileSync(path.join(source,'assets/sprite.txt'),'owned publication probe',{flag:'wx'});}
      if(kind.startsWith('png-package')){
        const packageRoot=path.join(root,'source-fixture');writeCharacterFixture(packageRoot);
        const manifest=JSON.parse(fs.readFileSync(path.join(packageRoot,'character.json'),'utf8'));
        const names=['character.json',...new Set(manifest.outfits.flatMap(outfit=>['idle','blink','shy','happy'].map(role=>outfit.bodySprites[role])))];
        for(const name of names){
          const target=path.join(source,name);fs.mkdirSync(path.dirname(target),{recursive:true});
          const fd=fs.openSync(target,'wx');
          try{fs.writeFileSync(fd,fs.readFileSync(path.join(packageRoot,name)));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
        }
      }
    }
    let result;
    try{fs.renameSync(source,destination);result={success:true};}
    catch(error){result={success:false,code:error.code,errno:error.errno,syscall:error.syscall};}
    results.push({root,kind,...result,sourceRemains:fs.existsSync(source),destinationExists:fs.existsSync(destination)});
  }
}
fs.writeFileSync(path.join(output,'publication-path-report.json'),JSON.stringify({results,noRetries:true,noAclChanges:true,noCleanup:true},null,2));
console.log(JSON.stringify(results.map(({root,kind,success,code})=>({location:root.startsWith(output)?'workspace':'system-temp',kind,success,code}))));
