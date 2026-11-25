import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
const root=path.resolve('tmp/native-validation');
const candidate={version:'33.0.3',file:'OBS-Studio-33.0.3-Windows-x64.zip',
  url:'https://github.com/obsproject/obs-studio/releases/download/33.0.3/OBS-Studio-33.0.3-Windows-x64.zip',
  release:'https://github.com/obsproject/obs-studio/releases/tag/33.0.3',
  sha256:'18a68c325adbda6f6082d5281021a8d1e35a6432842800618e8690b71925c107'};
const destination=path.join(root,candidate.file);
async function hashFile(file){const hash=crypto.createHash('sha256');for await(const bytes of fs.createReadStream(file))hash.update(bytes);return hash.digest('hex');}
if(fs.existsSync(destination)){
  if(await hashFile(destination)!==candidate.sha256)throw new Error('Existing archive differs from official digest; retain it for diagnosis, do not overwrite');
  console.log('Reusing the already verified official OBS archive.');
}else{
  const response=await fetch(candidate.url);
  if(!response.ok)throw new Error(`Official OBS archive HTTP ${response.status}`);
  let bytes=0,next=64*1024*1024;
  const counter=new Transform({transform(chunk,_encoding,done){bytes+=chunk.length;if(bytes>=next){console.log(`Downloaded ${Math.round(bytes/1024/1024)} MiB`);next+=64*1024*1024;}done(null,chunk);}});
  await pipeline(Readable.fromWeb(response.body),counter,fs.createWriteStream(destination,{flags:'wx'}));
  const digest=await hashFile(destination);
  if(digest!==candidate.sha256)throw new Error('OBS archive checksum mismatch; retained without extraction or execution');
}
fs.writeFileSync(path.join(root,'obs-archive.json'),JSON.stringify({...candidate,path:destination,bytes:fs.statSync(destination).size,verified:true},null,2));
console.log(JSON.stringify({archive:destination,sha256Verified:true,bytes:fs.statSync(destination).size}));
