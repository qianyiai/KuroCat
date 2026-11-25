import {KuroCatEngine} from './catEngine';
import {CharacterLoader,type ActiveCharacter} from './characterLoader';
const root='/src/assets/dafeiyu/';
const assetUrl=(asset:string)=>root+asset.split('/').pop();
type Manifest=ActiveCharacter['manifest']&{id:string;name:string;version:string};
type Slot={engine:KuroCatEngine;loader:CharacterLoader;canvas:HTMLCanvasElement;id:string};
const status=document.getElementById('status')!,loadStatus=document.getElementById('load-status')!;
let ready=false,privacy=false;
function fail(error:unknown){ready=false;status.className='error';status.textContent=String(error);}
window.addEventListener('error',event=>fail(event.message));window.addEventListener('unhandledrejection',event=>fail(event.reason));
const response=await fetch('/scripts/fixtures/dafeiyu-package.json',{cache:'no-store'});if(!response.ok)throw new Error('角色包配置不可用');
const text=await response.text(),manifest=JSON.parse(text) as Manifest,files=new Map<string,ArrayBuffer>();
for(const outfit of manifest.outfits){
  if(!outfit.bodySprites||!outfit.motion2d)throw new Error('测试配置缺少完整程序式素材/动作');
  for(const asset of Object.values(outfit.bodySprites)){
    if(!asset.endsWith('.png')||files.has(asset))continue;
    const reply=await fetch(assetUrl(asset),{cache:'no-store'});if(!reply.ok)throw new Error('角色素材不可用：'+asset);
    files.set(asset,await reply.arrayBuffer());
  }
}
const chunks=[new TextEncoder().encode(text),...[...files].sort(([a],[b])=>a.localeCompare(b)).flatMap(([path,bytes])=>[new TextEncoder().encode(path),new Uint8Array(bytes)])];
const bytes=new Uint8Array(chunks.reduce((sum,chunk)=>sum+chunk.length,0));let offset=0;
for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
const revision=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
function select(id:string){return (document.getElementById(id) as HTMLSelectElement).value;}
const slots:Slot[]=[];
for(const id of ['primary','selected']){
  const canvas=document.getElementById(id) as HTMLCanvasElement,engine=new KuroCatEngine(canvas,{embedded:true});
  const loader=new CharacterLoader({
    active:async()=>({entry:{id:manifest.id,name:manifest.name,revision},outfitId:id==='primary'?'primary':select('outfit'),manifest}),
    asset:async(characterId,expectedRevision,path)=>{
      if(characterId!==manifest.id||expectedRevision!==revision||!files.has(path))throw new Error('素材修订或路径不匹配');
      return files.get(path)!.slice(0);
    },
  },actor=>{engine.setProceduralCharacter(actor);if(!actor)engine.setCatAppearance('black');
    engine.setKeyboardConfig(select('layout') as '65'|'108',select('orientation') as 'cat'|'viewer');
    loadStatus.textContent='';
  },error=>{loadStatus.textContent=`加载失败，暂时显示备用猫咪：${String(error)}`;});
  slots.push({id,canvas,engine,loader});engine.start();
}
await Promise.all(slots.map(slot=>slot.loader.sync(true)));
if(slots.some(slot=>!slot.loader.identity))throw new Error('角色资源未完成加载');
ready=true;
const timers=new Set<ReturnType<typeof setTimeout>>(),held=new Set<number>();
function all(action:(engine:KuroCatEngine)=>void){for(const slot of slots)action(slot.engine);}
function later(delay:number,action:()=>void){const timer=setTimeout(()=>{timers.delete(timer);action();},delay);timers.add(timer);}
function key(vk:number,down:boolean,repeat=false){if(down)held.add(vk);else held.delete(vk);all(engine=>down?engine.onKeyDown(vk,repeat):engine.onKeyUp(vk));}
function release(){for(const timer of timers)clearTimeout(timer);timers.clear();for(const vk of [...held])key(vk,false);
  all(engine=>{engine.onMouseUp('left');engine.onMouseUp('right');engine.onMouseUp('middle');});}
function button(id:string,action:()=>void){document.getElementById(id)!.addEventListener('click',()=>{if(ready)action();});}
function configure(){release();all(engine=>{engine.setKeyboardConfig(select('layout') as '65'|'108',select('orientation') as 'cat'|'viewer');engine.setRenderScale(Number(select('scale')));});}
function gallery(){const outfit=manifest.outfits.find(outfit=>outfit.id===select('outfit'))!;
  document.getElementById('selected-title')!.textContent=outfit.name;
  const gallery=document.getElementById('expressions')!;gallery.replaceChildren();
  for(const [role,label] of Object.entries({idle:'待机',blink:'闭眼',shy:'害羞',happy:'开心'})){
    const figure=document.createElement('figure'),image=new Image(),caption=document.createElement('figcaption');
    image.src=assetUrl(outfit.bodySprites![role as 'idle'|'blink'|'shy'|'happy']);image.alt=`${outfit.name} · ${label}`;image.className='stage';
    caption.textContent=label;figure.append(image,caption);gallery.append(figure);
  }
}
gallery();
document.getElementById('outfit')!.addEventListener('change',()=>{release();gallery();void slots[1].loader.sync(true);});
for(const id of ['layout','orientation','scale'])document.getElementById(id)!.addEventListener('change',configure);
button('retry',()=>void slots[1].loader.sync(true));
button('typing',()=>{release();for(let i=0;i<36;i++){const vk=[65,83,68,70,74,75,76,13][i%8];later(i*100,()=>key(vk,true));later(i*100+75,()=>key(vk,false));}});
button('combo',()=>{release();all(engine=>engine.onMouseDown('left'));later(200,()=>{key(65,true);key(74,true);});later(1800,release);});
button('pet',()=>{release();for(let i=0;i<32;i++)later(i*50,()=>all(engine=>engine.onWindowCursor(i%2?.53:.40,.36,true)));});
button('privacy',()=>{release();privacy=!privacy;all(engine=>engine.setPrivacyMode(privacy));document.getElementById('privacy')!.setAttribute('aria-pressed',String(privacy));});
button('release',release);
for(const slot of slots){
  slot.canvas.addEventListener('pointermove',event=>{
    const point=slot.engine.characterPointAtClient(event.clientX,event.clientY);if(!point)return;
    all(engine=>{engine.onWindowCursor(point.x,point.y,true);engine.onGlobalMouseMove(point.x,point.y);});
  });
  slot.canvas.addEventListener('pointerleave',()=>all(engine=>engine.onWindowCursor(0,0,false)));
  slot.canvas.addEventListener('pointerdown',event=>{event.preventDefault();slot.canvas.focus();slot.canvas.setPointerCapture(event.pointerId);all(engine=>engine.onMouseDown(event.button===2?'right':'left'));});
  slot.canvas.addEventListener('pointerup',()=>all(engine=>{engine.onMouseUp('left');engine.onMouseUp('right');}));
  slot.canvas.addEventListener('contextmenu',event=>event.preventDefault());
  slot.canvas.addEventListener('wheel',event=>{event.preventDefault();all(engine=>engine.onMouseWheel());},{passive:false});
  slot.canvas.addEventListener('keydown',event=>{if(event.key==='Tab')return;event.preventDefault();key(event.keyCode,true,event.repeat);});
  slot.canvas.addEventListener('keyup',event=>{if(event.key==='Tab')return;event.preventDefault();key(event.keyCode,false);});
}
window.addEventListener('blur',release);
setInterval(()=>{if(!ready)return;
  for(const slot of slots)document.getElementById(slot.id+'-state')!.textContent=JSON.stringify(slot.engine.getCharacterState(),null,1);
  status.textContent=`已加载真实包：${manifest.name} · 2 套测试配置 · 复用4张原图 · 预览指纹 ${revision.slice(0,12)} · 右栏 ${slots[1].loader.identity?.outfitId??'未激活'}`;
},100);
Object.assign(window,{pilotPreview:{get ready(){return ready;},get identities(){return slots.map(slot=>slot.loader.identity);},
  get states(){return slots.map(slot=>slot.engine.getCharacterState());}}});
