import {characterFixture} from './character-test-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ProceduralCharacterRenderer } from '../src/proceduralCharacterRenderer.ts';
import { CharacterInteraction } from '../src/characterInteraction.ts';
import { CharacterLoader } from '../src/characterLoader.ts';

const preset = name => JSON.parse(readFileSync(new URL(`../src-tauri/protocol/${name}-motion-2d.json`, import.meta.url)));
const sprites = Object.fromEntries(['idle','blink','shy','happy'].map(label => [label, { label, complete: true, naturalWidth: 224, naturalHeight: 278 }]));
const layout = () => ({ logicalW:420,kbCenterX:234,kbCenterY:353,kbWidth:266,kbHeight:74,kbTiltRad:.059,
  mouseBtnX:72,mouseBtnY:322,mouseNX:.5,mouseLeft:false,mouseRight:false,mouseActiveAt:-10000,
  mouseClickAt:-10000,petEnergy:0,privacyMode:false,privacyTypingAt:-10000,is108:false });
function player(name='dafeiyu') {
  let now = 10000;
  return { actor:new ProceduralCharacterRenderer(preset(name),sprites,{clock:()=>now,random:()=>.1}),
    time: value => { now=value; }, now:()=>now };
}
test('hover alone does not pet; repeated intentional strokes do',()=>{
  const motion=preset('dafeiyu'), state=new CharacterInteraction(motion,()=>.1);
  for(let i=0;i<10;i++) state.cursor(.48,.35,true,true,false,i*50);
  assert.equal(state.energy,0);
  for(let i=0;i<8;i++) state.cursor(i%2 ? .55:.4,.35,true,true,false,500+i*20);
  assert.ok(state.energy>motion.petting.happyThreshold);
  assert.equal(state.pose(650).reaction.motion,'cheer');
  state.reset();
  for(let i=0;i<8;i++) state.cursor(i%2?.55:.4,.35,true,false,false,1000+i*20);
  assert.equal(state.energy,0,'dragging must not count as petting');
});
test('mouse plus keyboard plus tail remain independent; releases clear only their limb',()=>{
  const {actor}=player(), l={...layout(),mouseLeft:true};
  actor.onKeyDown(65,{x:140,y:350},l,false,false);
  actor.onKeyDown(13,{x:340,y:350},l,false,true);
  assert.equal(actor.debugState().rightHeld,1);
  assert.equal(actor.debugState().tailHeld,1);
  actor.onKeyUp(65); assert.equal(actor.debugState().rightHeld,0); assert.equal(actor.debugState().tailHeld,1);
  actor.onKeyUp(13); assert.equal(actor.debugState().tailHeld,0);
});
test('privacy preempts all limbs, personality and input; exit never replays held keys',()=>{
  const {actor,time}=player(); const l=layout();
  actor.onKeyDown(65,{x:140,y:350},l,false,false);
  actor.onKeyDown(13,{x:340,y:350},l,false,true);
  actor.onPrivacyModeChanged(true);
  actor.onKeyDown(66,{x:140,y:350},{...l,privacyMode:true},false,false);
  time(10050);actor.update(.016,10050,{...l,privacyMode:true});
  assert.deepEqual([actor.debugState().leftHeld,actor.debugState().rightHeld,actor.debugState().tailHeld],[0,0,0]);
  assert.equal(actor.debugState().expression,'blink');assert.equal(actor.debugState().particles,0);
  actor.onPrivacyModeChanged(false);time(10100);actor.update(.016,10100,l);
  assert.equal(actor.debugState().petEnergy,0);assert.equal(actor.debugState().rightHeld,0);
});
test('calm personality uses a different gesture and disabled tail never acquires keys',()=>{
  const {actor,time}=player('calm'), l=layout();
  for(let i=0;i<12;i++){time(10000+i*20);actor.onWindowCursor(i%2?.55:.4,.35,true,true,false);actor.update(.02,10000+i*20,l);}
  assert.equal(actor.debugState().reaction,'tilt');
  assert.equal(actor.debugState().expression,'shy');
  actor.onKeyDown(13,{x:340,y:350},l,false,true);assert.equal(actor.debugState().tailHeld,0);
});

test('typing cadence heats and cools real profiles while repeats stay cold and followers match',()=>{
  const pilot=characterFixture();
  for(const motion of [preset('dafeiyu'),...pilot.outfits.map(outfit=>outfit.motion2d)]){
    let now=10000;
    const actor=new ProceduralCharacterRenderer(motion,sprites,{clock:()=>now,random:()=>.1});
    const follower=new ProceduralCharacterRenderer(motion,sprites,{clock:()=>now+30000,random:()=>.1});
    follower.setFollowing(true);
    const advance=(duration,cadence,repeat=false)=>{
      for(let elapsed=0;elapsed<duration;elapsed+=50){
        now+=50;
        if(cadence&&elapsed%cadence===0){actor.onKeyDown(65,{x:140,y:350},layout(),repeat,false);actor.onKeyUp(65);}
        actor.update(.05,now,layout());
        const state=actor.continuousState();
        follower.applyContinuousState(state,0);follower.update(.05,now+30000,layout());
        assert.equal(follower.continuousState().moodTier,state.moodTier);
        assert.equal(follower.continuousState().typingHeat,state.typingHeat);
        assert.equal(follower.continuousState().blushLevel,state.blushLevel);
      }
    };
    advance(5000,1000);
    assert.equal(actor.continuousState().moodTier,0,'sparse manual test keys must not imply a fast-typing mood');
    assert.equal(actor.continuousState().typingHeat,0);
    advance(9000,50);
    assert.equal(actor.continuousState().moodTier,2,'sustained real key presses reach the hot mood');
    assert.ok(actor.continuousState().typingHeat>.8);
    advance(12000,0);
    assert.equal(actor.continuousState().moodTier,0,'stopping cools down through mood hysteresis');
    assert.ok(actor.continuousState().typingHeat<.02);
    advance(7000,50,true);
    assert.equal(actor.continuousState().moodTier,0,'OS autorepeat cannot inflate typing speed');
    assert.ok(actor.continuousState().typingHeat<.02);
  }
});
test('pet happiness persists while energy remains above threshold after a reaction finishes',()=>{
  const {actor,time}=player();
  for(let i=0;i<12;i++){time(10000+i*20);actor.onWindowCursor(i%2?.55:.4,.35,true,true,false);actor.update(.02,10000+i*20,layout());}
  time(11100);actor.update(.88,11100,layout());
  assert.ok(actor.petEnergy>actor.motion.petting.happyThreshold);
  assert.equal(actor.debugState().expression,'happy');
});
test('real shared drawing path consumes the chosen sprites and per-character colors',()=>{
  const calls=[]; const gradient={addColorStop:(n,c)=>calls.push(['color',c])};
  const context=new Proxy({}, { get:(target,key)=> key==='createLinearGradient'||key==='createRadialGradient' ? ()=>gradient
    : key==='getImageData' ? ()=>({data:new Uint8ClampedArray(102*42*4)})
    : key==='drawImage' ? image=>calls.push(['image',image.label]) : ()=>{},
    set:(target,key,value)=>{calls.push([key,value]);return true;} });
  globalThis.document={createElement:()=>({width:0,height:0,getContext:()=>context})};
  const m=preset('calm');m.hands.style.skin='#123456';
  const actor=new ProceduralCharacterRenderer(m,sprites,{clock:()=>10000,random:()=>.1});
  actor.update(.016,10000,layout());actor.renderBody(context,10000,layout());actor.renderForeground(context,.016,10000,layout());
  assert.ok(calls.some(c=>c[0]==='image'&&c[1]==='idle'));
  assert.ok(calls.some(c=>c[0]==='fillStyle'&&c[1]==='#123456'));
});
test('late selection results never replace the newest decoded actor; ordinary cat settings do not reset it',async()=>{
  globalThis.Image=class {decode(){return Promise.resolve();}};
  const metadata=(id,name)=>({entry:{id,revision:'revision'},outfitId:'default',manifest:{outfits:[{
    id:'default',name:'Default',motion2d:preset(name),bodySprites:{idle:'a',blink:'b',shy:'c',happy:'d'},
  }]}});
  let resolveOld; let calls=0; const applied=[];
  const loader=new CharacterLoader({active:()=>++calls===1 ? new Promise(resolve=>{resolveOld=resolve;}) : Promise.resolve(metadata('new','calm')),
    asset:async()=>new ArrayBuffer(0)},actor=>applied.push(actor),error=>{throw error;});
  const old=loader.sync(true);await loader.sync(true);resolveOld(metadata('old','dafeiyu'));await old;
  assert.equal(applied.length,1);assert.equal(applied[0].motion.personality.id,'calm-precise');
  await loader.sync(true);assert.equal(applied.length,1,'same revision does not rebuild input state');
  await loader.sync(false);await loader.sync(false);assert.equal(applied.length,2);assert.equal(applied[1],null);
});
test('asset failure waits for pending decodes and releases every object URL before completing',async()=>{
  const originalCreate=URL.createObjectURL,originalRevoke=URL.revokeObjectURL;
  const revoked=[],created=[];let finishDecode;
  URL.createObjectURL=()=>{const url=`blob:fixture-${created.length}`;created.push(url);return url;};
  URL.revokeObjectURL=url=>revoked.push(url);
  globalThis.Image=class {decode(){return new Promise(resolve=>{finishDecode=resolve;});}};
  const metadata={entry:{id:'failed',revision:'r'},outfitId:'default',manifest:{outfits:[{
    id:'default',motion2d:preset('calm'),bodySprites:{idle:'a',blink:'b',shy:'c',happy:'d'},
  }]}};
  const applied=[],errors=[];
  const loader=new CharacterLoader({active:async()=>metadata,asset:async(_id,_revision,path)=>{
    if(path!=='a')throw new Error('missing sprite');return new ArrayBuffer(0);
  }},actor=>applied.push(actor),error=>errors.push(error));
  try {
    const pending=loader.sync(true);await new Promise(resolve=>setImmediate(resolve));
    assert.equal(applied.length,0,'never swap a partially decoded actor');assert.equal(revoked.length,0);
    finishDecode();await pending;
    assert.deepEqual(applied,[null]);assert.equal(errors.length,1);assert.deepEqual(revoked,created);
  } finally {URL.createObjectURL=originalCreate;URL.revokeObjectURL=originalRevoke;}
});
test('eye whites use each outfit clip bounds instead of the old BigFish vertical coordinates',()=>{
  const m=preset('dafeiyu');m.rig.hairOcclusion.enabled=false;m.tail.enabled=false;
  for(const eye of m.rig.eyes){eye.center[1]-=25;for(const point of eye.clip)point[1]-=25;}
  let now=10000;const rectangles=[],gradient={addColorStop(){}};
  const context=new Proxy({}, {get:(_target,key)=>key==='createLinearGradient'||key==='createRadialGradient'?()=>gradient
    :key==='fillRect'?(...args)=>rectangles.push(args):()=>{},set:()=>true});
  const actor=new ProceduralCharacterRenderer(m,sprites,{clock:()=>now,random:()=>.1});
  actor.onKeyDown(65,{x:140,y:350},layout(),false,false);now+=100;
  actor.update(.1,now,layout());actor.renderBody(context,now,layout());
  assert.equal(rectangles.length,2,'both moving eyes are rendered');
  assert.ok(rectangles.every(rectangle=>rectangle[1]<110),'eye fill follows the shifted rig');
});

test('a failed selection clears its error on legacy cat selection and can subsequently retry',async()=>{
  globalThis.Image=class {async decode(){}};
  const value={entry:{id:'retry',revision:'a'.repeat(64)},outfitId:'default',manifest:{outfits:[{
    id:'default',motion2d:preset('calm'),bodySprites:{idle:'a',blink:'b',shy:'c',happy:'d'},
  }]}};
  let fail=true,status='';const applied=[];
  const loader=new CharacterLoader({active:async()=>value,asset:async()=>{
    if(fail)throw new Error('missing PNG');return new ArrayBuffer(0);
  }},actor=>{applied.push(actor);status='';},error=>{status=String(error);});
  await loader.sync(true);assert.match(status,/missing PNG/);assert.equal(loader.identity,null);
  await loader.sync(false);assert.equal(status,'');assert.deepEqual(applied,[null,null]);
  await loader.sync(false);assert.equal(applied.length,2,'ordinary legacy settings do not reset the engine');
  fail=false;await loader.sync(true);assert.equal(applied.length,3);assert.equal(loader.identity.id,'retry');
});

test('stale resource revision refreshes metadata once without exposing a transient load error',async()=>{
  globalThis.Image=class {async decode(){}};
  let reads=0;const applied=[],failures=[];
  const metadata=revision=>({entry:{id:'fresh',revision},outfitId:'default',manifest:{outfits:[{
    id:'default',motion2d:preset('calm'),bodySprites:{idle:'a',blink:'b',shy:'c',happy:'d'},
  }]}});
  const loader=new CharacterLoader({active:async()=>metadata(++reads===1?'old':'new'),asset:async(_id,revision)=>{
    if(revision==='old')throw new Error('STALE_REVISION');return new ArrayBuffer(0);
  }},actor=>applied.push(actor),error=>failures.push(error));
  await loader.sync(true);assert.equal(reads,2);assert.equal(applied.length,1);
  assert.equal(loader.identity.revision,'new');assert.deepEqual(failures,[]);
  let attempts=0;
  const broken=new CharacterLoader({active:async()=>{attempts++;return metadata('old');},asset:async()=>{throw new Error('STALE_REVISION');}},()=>{},error=>failures.push(error));
  await broken.sync(true);assert.equal(attempts,2,'a perpetually stale endpoint cannot retry forever');assert.equal(failures.length,1);
});
test('an ordinary idle personality pose does not suppress natural blinking',()=>{
  const motion=preset('dafeiyu');motion.blink.firstDelayMs=[100,100];
  let now=10000;const actor=new ProceduralCharacterRenderer(motion,sprites,{clock:()=>now,random:()=>.1});
  actor.update(.016,now,layout());now=10020;actor.update(.02,now,layout());
  assert.equal(actor.debugState().reaction,'settle');now=10110;actor.update(.09,now,layout());
  assert.equal(actor.debugState().expression,'blink');
});
