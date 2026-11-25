// Verifies the configuration produced by the UI, without touching the clipboard or real user data.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process');const {once}=require('node:events');const {createInterface}=require('node:readline');
const {chromium}=require(path.join(process.argv[2],'playwright'));
const output='tmp/native-validation',session=JSON.parse(fs.readFileSync(path.join(output,'desktop-session.json'),'utf8'));
let child;const checks=[];
(async()=>{
  const native=await chromium.connectOverCDP(`http://127.0.0.1:${session.debugPort}`);
  const page=native.contexts().flatMap(c=>c.pages()).find(p=>p.url()==='http://tauri.localhost/');assert.ok(page);
  const config=JSON.parse(await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke('get_mcp_config'))).mcpServers.kurocat;
  assert.equal(fs.realpathSync(config.command).toLowerCase(),fs.realpathSync(session.executable).toLowerCase());
  assert.deepEqual(config.args,['--mcp']);assert.equal(config.url,`http://127.0.0.1:${session.mcpPort}/mcp`);
  // Fail before spawning unless this child is guaranteed to use the isolated fixture.
  assert.equal(config.env?.APPDATA,session.appdata,'Copied stdio configuration must preserve the running desktop data directory');
  assert.deepEqual(Object.keys(config.env),['APPDATA'],'Export only the data-root environment variable');
  checks.push('UI config points to the exact running executable/HTTP endpoint and pins only its isolated data directory');
  child=spawn(config.command,config.args,{env:{...process.env,...config.env},windowsHide:true,stdio:['pipe','pipe','pipe']});
  let sequence=0;const pending=new Map();let stderr='';child.stderr.on('data',data=>{stderr+=data;});
  createInterface({input:child.stdout}).on('line',line=>{const value=JSON.parse(line);const p=pending.get(value.id);if(p){pending.delete(value.id);clearTimeout(p.timer);p.resolve(value);}});
  const rpc=(method,params)=>new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>reject(Error('Copied-config stdio timeout')),10000);pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
  const tools=await rpc('tools/list',{});assert.ok(tools.result.tools.some(tool=>tool.name==='get_character_package'));
  const settingsWire=await rpc('tools/call',{name:'get_settings',arguments:{}});assert.notEqual(settingsWire.result.isError,true);
  const settings=JSON.parse(settingsWire.result.content[0].text);
  const desktop=await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke('get_settings'));
  assert.equal(settings.activeCharacterId,desktop.activeCharacterId);assert.deepEqual(settings.characterOutfits,desktop.characterOutfits);
  checks.push('a real stdio process launched from the UI configuration exposes character tools and sees the desktop selection/outfit preferences');
  const catalogWire=await rpc('tools/call',{name:'list_characters',arguments:{}});assert.notEqual(catalogWire.result.isError,true);
  const catalog=JSON.parse(catalogWire.result.content[0].text);
  const desktopCatalog=await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke('get_character_list'));
  assert.deepEqual(catalog.characters.map(c=>[c.entry.id,c.entry.revision]),desktopCatalog.characters.map(c=>[c.entry.id,c.entry.revision]));
  const characterId=settings.activeCharacterId??catalog.characters[0]?.entry.id;
  if(characterId){
    const result=await rpc('tools/call',{name:'get_character_package',arguments:{id:characterId}});
    assert.notEqual(result.result.isError,true);assert.equal(JSON.parse(result.result.content[0].text).integrityChecked,true);
    checks.push('the copied-config client sees the desktop catalog revisions and reads an installed package with verified integrity');
  }
  const exited=once(child,'exit');child.stdin.end();const [code]=await exited;assert.equal(code,0,stderr);child=null;
  fs.writeFileSync(path.join(output,'mcp-config-report.json'),JSON.stringify({checks,clipboardChanged:false,realUserDataTouched:false},null,2));
  console.log(JSON.stringify({passed:checks.length}));process.exit(0);
})().catch(async error=>{
  if(child&&child.exitCode===null){const exited=once(child,'exit');child.stdin.end();await exited;}
  fs.writeFileSync(path.join(output,'mcp-config-failure.json'),JSON.stringify({error:String(error),stack:error.stack,checks},null,2));console.error(error);process.exit(1);
});
