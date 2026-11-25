import {KuroCatEngine} from './catEngine';
import {ProceduralCharacterRenderer,type SpriteSet} from './proceduralCharacterRenderer';
import {dafeiyuMotion} from './dafeiyuRenderer';
import calmJson from '../src-tauri/protocol/calm-motion-2d.json?raw';
import {BUILTIN_CHARACTER,CharacterStatePublisher,CharacterStateReceiver,identityKey,isCharacterStateFrame,
  type CharacterIdentity,type CharacterStateFrame} from './characterSync';
import idle from './assets/dafeiyu/notail_idle.png';
import blink from './assets/dafeiyu/notail_blink.png';
import shy from './assets/dafeiyu/notail_shy.png';
import happy from './assets/dafeiyu/notail_happy2.png';
const status=document.getElementById('status')!;
let ready=false,connected=true,privacy=false,epoch=1,connection=0,loadGeneration=0,accepted=0;
let sourceIdentity:CharacterIdentity=BUILTIN_CHARACTER,replicaIdentity:CharacterIdentity=BUILTIN_CHARACTER;
let cached:CharacterStateFrame|null=null;
const desktop=new KuroCatEngine(document.getElementById('desktop') as HTMLCanvasElement,{embedded:true});
const replica=new KuroCatEngine(document.getElementById('replica') as HTMLCanvasElement,{embedded:true});
desktop.setCatAppearance('dafeiyu');replica.setCatAppearance('dafeiyu');replica.setCharacterFollower(true);
const receiver=new CharacterStateReceiver({identity:()=>replicaIdentity,privacy:()=>privacy,
  apply:(state,age)=>{replica.applyCharacterState(state,age);accepted++;},reset:()=>replica.resetCharacterInput()});
function latency(){return Number((document.getElementById('latency') as HTMLSelectElement).value);}
function transmit(action:()=>void){if(!connected)return;const current=connection;setTimeout(()=>{
  if(connected&&current===connection)action();
},latency());}
const publisher=new CharacterStatePublisher(async()=>String(epoch),()=>({identity:sourceIdentity,state:desktop.getCharacterState()!}),async frame=>{
  if(!isCharacterStateFrame(frame)||frame.epoch!==String(epoch)||identityKey(frame.identity)!==identityKey(sourceIdentity)
    ||frame.state.privacy!==privacy)return;
  cached=JSON.parse(JSON.stringify(frame));transmit(()=>receiver.receive(frame));
});
const timers=new Set<ReturnType<typeof setTimeout>>(),held=new Set<number>();
function later(delay:number,action:()=>void){const timer=setTimeout(()=>{timers.delete(timer);action();},delay);timers.add(timer);}
function input(action:(engine:KuroCatEngine)=>void){action(desktop);transmit(()=>action(replica));}
function key(vk:number,down:boolean,repeat=false){if(down)held.add(vk);else held.delete(vk);input(engine=>down?engine.onKeyDown(vk,repeat):engine.onKeyUp(vk));}
function release(){for(const timer of timers)clearTimeout(timer);timers.clear();for(const vk of [...held])key(vk,false);
  input(engine=>{engine.onMouseUp('left');engine.onMouseUp('right');engine.onMouseUp('middle');});}
function boundary(){epoch++;cached=null;receiver.invalidate(String(epoch));}
function fail(message:string){ready=false;status.className='error';status.textContent=message;}
window.addEventListener('error',event=>fail(event.message));window.addEventListener('unhandledrejection',event=>fail(String(event.reason)));
const sprites=Object.fromEntries(await Promise.all(Object.entries({idle,blink,shy,happy}).map(async([role,url])=>{
  const image=new Image();image.src=url;await image.decode();return [role,image];}))) as SpriteSet;
function actor(calm:boolean){return new ProceduralCharacterRenderer(calm?JSON.parse(calmJson):structuredClone(dafeiyuMotion),sprites);}
// Use the decoded sprites on both ends; this page has no browser-image mocks.
desktop.setProceduralCharacter(actor(false));replica.setProceduralCharacter(actor(false));
desktop.start();replica.start();ready=true;
function button(id:string,action:()=>void){document.getElementById(id)!.addEventListener('click',()=>{if(ready)action();});}
button('typing',()=>{release();for(let i=0;i<36;i++){const vk=[65,83,68,70,74,75,76,13][i%8];later(i*100,()=>key(vk,true));later(i*100+75,()=>key(vk,false));}});
button('pet',()=>{release();for(let i=0;i<36;i++)later(i*50,()=>desktop.onWindowCursor(i%2?.55:.4,.35,true));});
button('release',release);
button('privacy',()=>{release();privacy=!privacy;desktop.setPrivacyMode(privacy);replica.setPrivacyMode(privacy);boundary();
  document.getElementById('privacy')!.setAttribute('aria-pressed',String(privacy));});
button('disconnect',()=>{connected=!connected;connection++;receiver.disconnect();
  document.getElementById('disconnect')!.textContent=connected?'断开连接':'重新连接';
  document.getElementById('disconnect')!.setAttribute('aria-pressed',String(!connected));
  if(connected){receiver.reconnect();if(cached)transmit(()=>{if(cached)receiver.receive(cached);});}});
document.getElementById('preset')!.addEventListener('change',()=>{
  release();boundary();const generation=++loadGeneration;
  const calm=(document.getElementById('preset') as HTMLSelectElement).value==='calm';
  sourceIdentity={id:'preview-person',revision:(calm?'c':'d').repeat(64),outfitId:calm?'calm':'lively'};
  desktop.setProceduralCharacter(actor(calm));
  // Simulates asynchronous outfit loading; receiver keeps only fresh state for the matching identity.
  const selected=sourceIdentity;setTimeout(()=>{if(generation!==loadGeneration)return;
    replicaIdentity=selected;replica.setProceduralCharacter(actor(calm));receiver.tick();
  },latency()+300);
});
const canvas=document.getElementById('desktop') as HTMLCanvasElement;
canvas.addEventListener('keydown',event=>{if(event.key==='Tab')return;event.preventDefault();key(event.keyCode,true,event.repeat);});
canvas.addEventListener('keyup',event=>{if(event.key==='Tab')return;event.preventDefault();key(event.keyCode,false);});
canvas.addEventListener('pointermove',event=>{
  const point=desktop.characterPointAtClient(event.clientX,event.clientY);if(!point)return;const {x,y}=point;
  desktop.onWindowCursor(x,y,true);input(engine=>engine.onGlobalMouseMove(x,y));
});
canvas.addEventListener('pointerleave',()=>desktop.onWindowCursor(0,0,false));
canvas.addEventListener('pointerdown',event=>{event.preventDefault();canvas.focus();canvas.setPointerCapture(event.pointerId);input(engine=>engine.onMouseDown(event.button===2?'right':'left'));});
canvas.addEventListener('pointerup',()=>input(engine=>{engine.onMouseUp('left');engine.onMouseUp('right');}));
canvas.addEventListener('contextmenu',event=>event.preventDefault());window.addEventListener('blur',release);
setInterval(()=>{if(!ready)return;void publisher.tick().catch(error=>fail(String(error)));receiver.tick();
  document.getElementById('desktop-state')!.textContent=JSON.stringify(desktop.getCharacterState(),null,1);
  document.getElementById('replica-state')!.textContent=JSON.stringify(replica.getCharacterState(),null,1);
  status.textContent=`${connected?'已连接':'已断开'} · 延迟 ${latency()} 毫秒 · 已应用 ${accepted} 帧 · ${privacy?'隐私中':'普通模式'}`;
},100);
Object.assign(window,{visualSync:{get ready(){return ready;},get connected(){return connected;},get accepted(){return accepted;},
  get frame(){return cached;},get desktopIdentity(){return sourceIdentity;},get replicaIdentity(){return replicaIdentity;}}});
