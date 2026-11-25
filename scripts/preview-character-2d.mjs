// Source preview only: reuses an existing Vite, never installs or builds Tauri.
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root=path.resolve(fileURLToPath(new URL('..',import.meta.url)));
const modules=process.argv[2];
if(!modules)throw new Error('Usage: node scripts/preview-character-2d.mjs <existing-node_modules>');
const {createServer,transformWithEsbuild}=await import(pathToFileURL(path.resolve(modules,'vite/dist/node/index.js')).href);
const baseline='20be633d19c50093536f0e429943065254fc6f36';
const originals=new Map(['catEngine','dafeiyuRenderer'].map(name=>[name,execFileSync('git',[
  'show',`${baseline}:src/${name}.ts`],{cwd:root,encoding:'utf8',maxBuffer:1024*1024})]));
const server=await createServer({root,configFile:false,cacheDir:path.join(root,'tmp/visual-preview/vite-cache'),
  server:{host:'127.0.0.1',port:1422,strictPort:true},optimizeDeps:{noDiscovery:true,include:[]},
  plugins:[{name:'readonly-original-bigfish',
    resolveId(id){if(id.startsWith('virtual:original-'))return `\0${id}.ts`;},
    async load(id){if(!id.startsWith('\0virtual:original-'))return;
      const name=id.includes('catEngine')?'catEngine':'dafeiyuRenderer';
      const source=originals.get(name).replace(/(['"])\.\/([^'"]+)\1/g,(_match,quote,file)=>
        `${quote}${file==='dafeiyuRenderer'?'virtual:original-dafeiyuRenderer':`/src/${file}`}${quote}`);
      return (await transformWithEsbuild(source,`${name}.ts`,{loader:'ts',target:'es2022'})).code;
    }}]});
await server.listen();
console.log(`2D preview: http://127.0.0.1:1422/visual-2d.html (baseline ${baseline.slice(0,7)})`);
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await server.close();process.exit(0);});
