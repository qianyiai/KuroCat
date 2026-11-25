import { KuroCatEngine } from './catEngine';
import { KuroCatEngine as OriginalEngine } from 'virtual:original-catEngine';
import { ProceduralCharacterRenderer, type SpriteSet } from './proceduralCharacterRenderer';
import { dafeiyuMotion } from './dafeiyuRenderer';
import calmJson from '../src-tauri/protocol/calm-motion-2d.json?raw';
import type { Motion2d } from './characterMotion2d';
import idle from './assets/dafeiyu/notail_idle.png';
import blink from './assets/dafeiyu/notail_blink.png';
import shy from './assets/dafeiyu/notail_shy.png';
import happy from './assets/dafeiyu/notail_happy2.png';

// This isolated page owns its clock. Overrides are synchronous and always restored.
let now=10000, paused=false, privacy=false, ready=false;
const nativeNow=performance.now.bind(performance), nativeRandom=Math.random;
const status=document.querySelector<HTMLParagraphElement>('#status')!;
function showError(message:string){paused=true;ready=false;status.className='error';status.textContent=`预览错误：${message}`;}
window.addEventListener('error',event=>showError(event.message));
window.addEventListener('unhandledrejection',event=>showError(String(event.reason)));
type ManualEngine={update(dt:number,now:number):void;render():void;getViewportTransform():{offsetX:number;offsetY:number;uniformScale:number};dafeiyu:{sprites:SpriteSet;debugState?:()=>unknown};petEnergy:number};
type Slot={id:string;engine:KuroCatEngine;manual:ManualEngine;canvas:HTMLCanvasElement;seed:number};
const slots:Slot[]=[];
function run<T>(slot:{seed:number},action:()=>T):T {
  const descriptor=Object.getOwnPropertyDescriptor(performance,'now');
  Object.defineProperty(performance,'now',{configurable:true,value:()=>now});
  Math.random=()=>{slot.seed=(Math.imul(slot.seed,1664525)+1013904223)>>>0;return slot.seed/4294967296;};
  try{return action();}finally{Math.random=nativeRandom;if(descriptor)Object.defineProperty(performance,'now',descriptor);else Reflect.deleteProperty(performance,'now');}
}
const pending:Array<{at:number;action:()=>void}>=[];
const held=new Set<number>();let mouseHeld=false;
function all(action:(engine:KuroCatEngine,slot:Slot)=>void){for(const slot of slots)run(slot,()=>action(slot.engine,slot));}
function schedule(delay:number,action:()=>void){pending.push({at:now+delay,action});pending.sort((a,b)=>a.at-b.at);}
function key(vk:number,down:boolean,repeat=false){if(down)held.add(vk);else held.delete(vk);all(engine=>down?engine.onKeyDown(vk,repeat):engine.onKeyUp(vk));}
function release(){pending.length=0;for(const vk of [...held])key(vk,false);for(const button of ['left','right','middle'] as const)all(engine=>engine.onMouseUp(button));mouseHeld=false;}
function pet(x:number,y:number){all(engine=>engine.onWindowCursor(x,y,true));}
function render(){for(const slot of slots)run(slot,()=>{
  slot.manual.render();
  document.getElementById(`${slot.id}-state`)!.textContent=JSON.stringify(slot.manual.dafeiyu.debugState?.()??{petEnergy:Number(slot.manual.petEnergy.toFixed(3)),privacy},null,1);
});status.textContent=`素材就绪 · ${paused?'已暂停':'播放中'} · 模拟时间 ${((now-10000)/1000).toFixed(2)} 秒${privacy?' · 隐私中':''}`;}
function advance(){now+=1000/60;while(pending.length&&pending[0].at<=now)pending.shift()!.action();all((_engine,slot)=>slot.manual.update(1/60,now));render();}
function configure(){release();all(engine=>{engine.setKeyboardConfig(select('layout') as '65'|'108',select('orientation') as 'cat'|'viewer');engine.setRenderScale(Number(select('scale')));});render();}
function select(id:string){return (document.getElementById(id) as HTMLSelectElement).value;}
function button(id:string,action:()=>void){document.getElementById(id)!.addEventListener('click',()=>{if(ready){action();render();}});}
const sprites=Object.fromEntries(await Promise.all(Object.entries({idle,blink,shy,happy}).map(async([key,src])=>{
  const image=new Image();image.src=src;await image.decode();return [key,image];}))) as SpriteSet;
// Also wait for the original adapter's separate Image instances before declaring readiness.
for(const [index,id] of ['original','shared','person'].entries()){
  const canvas=document.getElementById(id) as HTMLCanvasElement;
  const state={seed:123456};
  const engine=run(state,()=>new (index===0?OriginalEngine:KuroCatEngine)(canvas,{embedded:true}));
  const slot={...state,id,canvas,engine,manual:engine as unknown as ManualEngine};slots.push(slot);
  run(slot,()=>engine.setCatAppearance('dafeiyu'));
}
await Promise.all(slots.flatMap(slot=>Object.values(slot.manual.dafeiyu.sprites).map(image=>image.decode())));
function changePerson(){const slot=slots[2];release();run(slot,()=>{
  const motion=select('personality')==='calm'?JSON.parse(calmJson) as Motion2d:structuredClone(dafeiyuMotion);
  slot.engine.setProceduralCharacter(new ProceduralCharacterRenderer(motion,sprites));
});configure();}
changePerson();ready=true;
for(const id of ['layout','orientation','scale'])document.getElementById(id)!.addEventListener('change',configure);
document.getElementById('personality')!.addEventListener('change',changePerson);
button('typing',()=>{release();for(let i=0;i<32;i++){const vk=[65,83,68,70,74,75,76,13][i%8];schedule(i*110,()=>key(vk,true));schedule(i*110+85,()=>key(vk,false));}});
button('combo',()=>{release();all(engine=>engine.onMouseDown('left'));mouseHeld=true;schedule(220,()=>{key(65,true);key(13,true);});schedule(1800,release);});
button('pet',()=>{release();for(let i=0;i<32;i++)schedule(i*50,()=>pet(i%2?.53:.4,.35));});
button('privacy',()=>{release();privacy=!privacy;all(engine=>engine.setPrivacyMode(privacy));document.getElementById('privacy')!.setAttribute('aria-pressed',String(privacy));});
button('privacy-input',()=>{if(privacy)all(engine=>engine.onPrivacyTyping());});
button('release',release);
button('pause',()=>{paused=!paused;document.getElementById('pause')!.setAttribute('aria-pressed',String(paused));});
button('step',()=>{paused=true;document.getElementById('pause')!.setAttribute('aria-pressed','true');advance();});
button('reset',()=>location.reload());
for(const slot of slots){
  slot.canvas.addEventListener('pointermove',event=>{
    const rect=slot.canvas.getBoundingClientRect(),transform=slot.manual.getViewportTransform();
    const {w,h}=slot.engine.getLogicalSize();
    const x=((event.clientX-rect.left)*slot.canvas.width/rect.width-transform.offsetX)/transform.uniformScale/w;
    const y=((event.clientY-rect.top)*slot.canvas.height/rect.height-transform.offsetY)/transform.uniformScale/h;
    pet(x,y);all(engine=>engine.onGlobalMouseMove(x,y));
  });
  slot.canvas.addEventListener('pointerleave',()=>all(engine=>engine.onWindowCursor(0,0,false)));
  slot.canvas.addEventListener('pointerdown',event=>{event.preventDefault();slot.canvas.focus();slot.canvas.setPointerCapture(event.pointerId);mouseHeld=true;all(engine=>engine.onMouseDown(event.button===2?'right':'left'));});
  slot.canvas.addEventListener('pointerup',()=>{all(engine=>{engine.onMouseUp('left');engine.onMouseUp('right');});mouseHeld=false;});
  slot.canvas.addEventListener('contextmenu',event=>event.preventDefault());
  slot.canvas.addEventListener('wheel',event=>{event.preventDefault();all(engine=>engine.onMouseWheel());},{passive:false});
  slot.canvas.addEventListener('keydown',event=>{if(event.key==='Tab')return;event.preventDefault();key(event.keyCode,true,event.repeat);});
  slot.canvas.addEventListener('keyup',event=>{if(event.key==='Tab')return;event.preventDefault();key(event.keyCode,false);});
}
window.addEventListener('blur',release);
// Engine resize clears its backing store; redraw even while the preview is paused.
window.addEventListener('resize',()=>render());
let last=nativeNow(),accumulator=0;
function frame(){const time=nativeNow();accumulator+=Math.min(100,time-last);last=time;if(paused)accumulator=0;else while(accumulator>=1000/60){advance();accumulator-=1000/60;}requestAnimationFrame(frame);}
render();requestAnimationFrame(frame);
// Small read-only diagnostics for browser smoke checks; interaction stays through visible controls.
Object.assign(window,{visual2d:{get ready(){return ready;},get time(){return now;},get mouseHeld(){return mouseHeld;}}});
