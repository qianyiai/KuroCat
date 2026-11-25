// Native development frontend: existing packages only, no installs or renderer substitutes.
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import fs from 'node:fs';
const root=fileURLToPath(new URL('..',import.meta.url));
const modules=path.resolve(process.argv[2]??'');
if(!process.argv[2]||!fs.existsSync(path.join(modules,'@tauri-apps/api/package.json')))
  throw new Error('Provide an existing node_modules containing Vite and @tauri-apps/api');
const {createServer}=await import(pathToFileURL(path.join(modules,'vite/dist/node/index.js')).href);
const server=await createServer({root,configFile:false,cacheDir:path.join(root,'tmp/native-validation/vite-cache'),
  resolve:{alias:{'@tauri-apps/api':path.join(modules,'@tauri-apps/api')}},
  optimizeDeps:{noDiscovery:true,include:[]},
  server:{host:'127.0.0.1',port:1420,strictPort:true,watch:{ignored:['**/tmp/**','**/src-tauri/**','**/outputs/**']},
    proxy:{'/obs/events':'http://127.0.0.1:37421','/characters/':'http://127.0.0.1:37421'}}});
await server.listen();
console.log('Native 2D development frontend: http://127.0.0.1:1420; OBS transport proxy: 37421. Full production/3D build is not validated.');
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await server.close();process.exit(0);});
