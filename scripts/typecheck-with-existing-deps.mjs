// Read-only reuse of an explicitly supplied node_modules; no installation or emitted files.
import { createRequire } from 'node:module';
import path from 'node:path';
const modules=process.argv[2];
if(!modules)throw new Error('Usage: node scripts/typecheck-with-existing-deps.mjs <existing-node_modules>');
const existing=path.resolve(modules), require=createRequire(import.meta.url);
const ts=require(path.join(existing,'typescript/lib/typescript.js'));
const config=ts.readConfigFile('tsconfig.json',ts.sys.readFile);
if(config.error)throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText,'\n'));
const parsed=ts.parseJsonConfigFileContent(config.config,ts.sys,process.cwd());
const options={...parsed.options,noEmit:true,incremental:false};
const host=ts.createCompilerHost(options);
const referenceFile=path.join(path.dirname(existing),'__read_only_typecheck__.ts');
host.resolveModuleNames=(names,containing)=>names.map(name=>
  ts.resolveModuleName(name,containing,options,host).resolvedModule
  ?? (!name.startsWith('.') ? ts.resolveModuleName(name,referenceFile,options,host).resolvedModule : undefined));
host.resolveTypeReferenceDirectives=(names,containing)=>names.map(value=>{
  const name=typeof value==='string'?value:value.fileName;
  return ts.resolveTypeReferenceDirective(name,containing,options,host).resolvedTypeReferenceDirective
    ?? ts.resolveTypeReferenceDirective(name,referenceFile,options,host).resolvedTypeReferenceDirective;
});
host.writeFile=()=>{throw new Error('noEmit check attempted a write');};
const focused=process.argv.includes('--2d');
const roots=focused ? parsed.fileNames.filter(file=>['catEngine.ts','characterInteraction.ts','proceduralCharacterRenderer.ts','characterLoader.ts','dafeiyuRenderer.ts','characterMotion2d.ts','characterMenu.ts','visual2dPreview.ts','visual2dSyncPreview.ts','visualCharacterPack.ts','visual2dModules.d.ts','vite-env.d.ts'].includes(path.basename(file))) : parsed.fileNames;
const program=ts.createProgram(roots,options,host);
const diagnostics=[...parsed.errors,...ts.getPreEmitDiagnostics(program)];
for(const diagnostic of diagnostics){
  const pos=diagnostic.file&&diagnostic.start!==undefined?diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start):null;
  console.log(`${diagnostic.file?.fileName??''}${pos?`:${pos.line+1}:${pos.character+1}`:''} TS${diagnostic.code}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText,'\n')}`);
}
console.log(`TypeScript ${ts.version}; ${roots.length} ${focused?'2D roots':'project source files'}; ${diagnostics.length} diagnostics; no emit.`);
process.exitCode=diagnostics.length?1:0;
