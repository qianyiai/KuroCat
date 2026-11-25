import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {BUILTIN_CHARACTER,CharacterStateReceiver,CharacterStatePublisher,isCharacterStateFrame} from '../src/characterSync.ts';
import {ProceduralCharacterRenderer} from '../src/proceduralCharacterRenderer.ts';
const motion=JSON.parse(readFileSync(new URL('../src-tauri/protocol/dafeiyu-motion-2d.json',import.meta.url)));
const sprites=Object.fromEntries(['idle','blink','shy','happy'].map(role=>[role,{complete:true,naturalWidth:224,naturalHeight:278}]));
const layout={logicalW:420,kbCenterX:234,kbCenterY:353,kbWidth:266,kbHeight:74,kbTiltRad:.059,
  mouseBtnX:72,mouseBtnY:322,mouseNX:.5,mouseLeft:false,mouseRight:false,mouseActiveAt:-10000,
  mouseClickAt:-10000,petEnergy:0,privacyMode:false,privacyTypingAt:-10000,is108:false};
const state=()=>({privacy:false,petEnergy:.7,petInside:true,moodTier:1,typingHeat:.3,blushLevel:.4,
  blinkRemainingMs:0,phaseMs:10000,reaction:{event:'pet',index:0,elapsedMs:100}});
const frame=(sequence=1,epoch='1')=>({version:1,epoch,sequence,capturedAt:1000,identity:{...BUILTIN_CHARACTER},state:state()});
test('wire state rejects private fields, bad values, unsupported shape and privacy leaks',()=>{
  assert.ok(isCharacterStateFrame(frame()));
  for(const mutate of [v=>v.state.rawKeys=[65],v=>v.identity.path='C:/private',v=>v.state.petEnergy=NaN,
    v=>v.sequence=1.5,v=>v.epoch='01',v=>v.epoch='18446744073709551616',v=>v.state.moodTier=3,
    v=>v.state.reaction.index=-1,v=>v.state.privacy=true,v=>delete v.state.reaction]){
    const value=frame();mutate(value);assert.equal(isCharacterStateFrame(value),false);
  }
});
test('different browser clocks carry pet energy, personality progress, mood, blush and blink',()=>{
  let desktopTime=10000,obsTime=75000;
  const desktop=new ProceduralCharacterRenderer(motion,sprites,{clock:()=>desktopTime,random:()=>.1});
  const obs=new ProceduralCharacterRenderer(motion,sprites,{clock:()=>obsTime,random:()=>.9});obs.setFollowing(true);
  for(let i=0;i<12;i++){desktopTime+=20;desktop.onWindowCursor(i%2?.55:.4,.35,true,true,false);desktop.update(.02,desktopTime,layout);}
  const snapshot=desktop.continuousState();snapshot.moodTier=2;snapshot.typingHeat=.8;snapshot.blushLevel=.6;snapshot.blinkRemainingMs=120;
  obs.applyContinuousState(snapshot,50);obs.update(.016,obsTime,layout);
  const mirrored=obs.continuousState();
  assert.ok(Math.abs(mirrored.petEnergy-(snapshot.petEnergy-motion.petting.decayInside*.05))<.001);
  assert.equal(mirrored.moodTier,2);assert.equal(mirrored.typingHeat,.8);assert.equal(mirrored.blushLevel,.6);
  assert.equal(mirrored.blinkRemainingMs,70);assert.equal(mirrored.phaseMs,snapshot.phaseMs+50);
  assert.equal(mirrored.reaction.index,snapshot.reaction.index);assert.equal(mirrored.reaction.elapsedMs,snapshot.reaction.elapsedMs+50);
  obs.onKeyDown(65,{x:140,y:350},layout,false,false);
  assert.equal(obs.continuousState().reaction.event,'pet','local input cannot reroll replicated personality');
});
test('receiver drops out-of-order and pre-privacy epochs, expires stale state and restores after reconnect',()=>{
  let wall=1000,privacy=false,resets=0;const applied=[];
  const receiver=new CharacterStateReceiver({identity:()=>BUILTIN_CHARACTER,privacy:()=>privacy,
    apply:(state,age)=>applied.push({state,age}),reset:()=>resets++},()=>wall);
  assert.ok(receiver.receive(frame(2)));assert.equal(applied.length,1);
  assert.equal(receiver.receive(frame(1)),false);
  receiver.invalidate('2');privacy=true;
  assert.equal(receiver.receive(frame(3)),false);
  const hidden=frame(1,'2');hidden.state={...state(),privacy:true,petEnergy:0,moodTier:0,typingHeat:0,reaction:null};
  assert.ok(receiver.receive(hidden));assert.equal(applied.at(-1).state.privacy,true);
  receiver.invalidate('3');privacy=false;
  assert.equal(receiver.receive(frame(20,'2')),false);
  const latest=frame(1,'3');assert.ok(receiver.receive(latest));
  const count=resets;wall=3101;receiver.tick();assert.ok(resets>count);
  receiver.disconnect();wall=3200;latest.capturedAt=3200;latest.sequence=2;
  assert.ok(receiver.receive(latest));assert.equal(applied.at(-1).age,0);
  assert.equal(receiver.receive({...latest,sequence:3,capturedAt:1000}),false);
  receiver.reconnect();assert.ok(receiver.receive({...latest,epoch:'1',sequence:1}),'new server process can restart epoch numbering');
});
test('pending revision waits for the right decoded actor and clears previous state',()=>{
  let identity={...BUILTIN_CHARACTER},resets=0;const applied=[];
  const receiver=new CharacterStateReceiver({identity:()=>identity,privacy:()=>false,
    apply:value=>applied.push(value),reset:()=>resets++},()=>1000);
  receiver.receive(frame());const before=resets;
  const next=frame(2);next.identity={id:'test-person',revision:'a'.repeat(64),outfitId:'alternate'};
  receiver.receive(next);assert.equal(applied.length,1);assert.ok(resets>before);
  identity=next.identity;receiver.tick();assert.equal(applied.length,2);
});
test('publisher serializes IPC, captures after token resolves, and recovers from a failed send',async()=>{
  let resolveToken,captures=0,fail=true;const sent=[];
  const publisher=new CharacterStatePublisher(()=>new Promise(resolve=>{resolveToken=resolve;}),
    ()=>{captures++;return {identity:BUILTIN_CHARACTER,state:state()};},async value=>{sent.push(value);if(fail)throw new Error('IPC unavailable');});
  const first=publisher.tick();await publisher.tick();assert.equal(captures,0);
  resolveToken('4');await assert.rejects(first);assert.equal(captures,1);
  fail=false;const second=publisher.tick();resolveToken('5');await second;
  assert.equal(sent.length,2);assert.equal(sent[1].epoch,'5');assert.ok(sent[1].sequence>sent[0].sequence);
  assert.ok(isCharacterStateFrame(sent[1]));assert.ok(!JSON.stringify(sent).includes('rawKeys'));
});
