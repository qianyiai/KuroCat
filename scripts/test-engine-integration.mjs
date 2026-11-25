import {characterFixture} from './character-test-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Resolve existing browser assets and extensionless TS imports in this test process only.
// Canvas recording tests the real event/draw path; it is not a visual browser test.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && context.parentURL) {
      const url = new URL(specifier, context.parentURL);
      if (existsSync(fileURLToPath(url)+'.ts')) return {url:url.href+'.ts',shortCircuit:true};
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if(url.endsWith('?raw'))return {format:'module',source:`export default ${JSON.stringify(readFileSync(fileURLToPath(url),'utf8'))}`,shortCircuit:true};
    if(url.endsWith('.png'))return {format:'module',source:`export default ${JSON.stringify(url)}`,shortCircuit:true};
    return next(url,context);
  },
});

test('real CatEngine forwards protocol-driven BigFish keyboard, petting, privacy and drawing',async(t)=>{
  const draws=[];const frames=[];const gradient={addColorStop(){}};
  const ctx=new Proxy({}, {get:(_target,key)=>key==='createLinearGradient'||key==='createRadialGradient'?()=>gradient
    :key==='getImageData'?()=>({data:new Uint8ClampedArray(102*42*4)})
    :key==='measureText'?()=>({width:24}):key==='drawImage'?image=>{if(image.label)draws.push(image.label);}:()=>{},set:()=>true});
  const canvas={width:420,height:440,clientWidth:420,clientHeight:440,getContext:()=>ctx};
  globalThis.Image=class {complete=true;naturalWidth=224;naturalHeight=278;set src(value){this.label=new URL(value).pathname.split('/').pop().replace('notail_','').replace('.png','');} };
  globalThis.Path2D=class {moveTo(){} lineTo(){} bezierCurveTo(){} quadraticCurveTo(){} closePath(){} ellipse(){} arc(){} addPath(){} };
  globalThis.document={createElement:()=>({...canvas})};
  globalThis.window={innerWidth:420,innerHeight:440,devicePixelRatio:1,addEventListener(){},setTimeout(){return 1;},clearTimeout(){}};
  globalThis.requestAnimationFrame=callback=>{frames.push(callback);return frames.length;};
  globalThis.cancelAnimationFrame=()=>{};
  const {KuroCatEngine}=await import('../src/catEngine.ts');
  const engine=new KuroCatEngine(canvas);engine.setCatAppearance('dafeiyu');engine.start();
  const frame=()=>{const next=frames.shift();assert.ok(next);next(performance.now());};
  engine.onKeyDown(65,false);frame();assert.ok(draws.includes('idle'));
  for(let i=0;i<10;i++)engine.onWindowCursor(i%2?.55:.4,.35,true);
  frame();assert.ok(draws.includes('happy2'),'petting reaches the shared player through the engine');
  engine.setPrivacyMode(true);frame();assert.equal(draws.at(-1),'blink');
  engine.onKeyDown(66,false);frame();assert.equal(draws.at(-1),'blink');
  engine.setPrivacyMode(false);engine.onKeyDown(66,true);frame();assert.equal(draws.at(-1),'idle');
  const {ProceduralCharacterRenderer}=await import('../src/proceduralCharacterRenderer.ts');
  const motion=JSON.parse(readFileSync(new URL('../src-tauri/protocol/dafeiyu-motion-2d.json',import.meta.url)));
  motion.bindings.enterFlourishMs=0;
  const actor=new ProceduralCharacterRenderer(motion,Object.fromEntries(['idle','blink','shy','happy'].map(label=>
    [label,{label:`package-${label}`,complete:true,naturalWidth:224,naturalHeight:278}])));
  engine.onMouseDown('left');engine.setProceduralCharacter(actor);
  engine.onKeyDown(65,false);engine.onKeyUp(65);engine.onKeyDown(13,false);frame();
  assert.equal(actor.debugState().tailHeld,0,'package flourish window replaces the built-in constant');
  assert.ok(draws.includes('package-idle'),'package sprites flow through the real engine');
  engine.resetCharacterInput();engine.onKeyDown(13,true);frame();
  assert.deepEqual([actor.debugState().leftHeld,actor.debugState().rightHeld,actor.debugState().tailHeld],[0,0,0]);
  engine.onKeyDown(65,false);
  assert.ok(actor.debugState().leftHeld+actor.debugState().rightHeld>0);
  engine.setKeyboardConfig('65','viewer');
  assert.deepEqual([actor.debugState().leftHeld,actor.debugState().rightHeld,actor.debugState().tailHeld],[0,0,0],
    'orientation changes cannot keep a hand at the previous projected key');
  engine.onKeyDown(65,true);frame();
  assert.deepEqual([actor.debugState().leftHeld,actor.debugState().rightHeld,actor.debugState().tailHeld],[0,0,0],
    'a repeat arriving after reprojection does not restore the old press');
  const {getKeyboardLayout}=await import('../src/keyboardLayout.ts');
  const pilot=characterFixture();
  let keyCases=0;
  for(const outfit of pilot.outfits)for(const layout of ['65','108'])for(const orientation of ['cat','viewer']) {
    const player=new ProceduralCharacterRenderer(outfit.motion2d,Object.fromEntries(['idle','blink','shy','happy'].map(label=>
      [label,{label:`${outfit.id}-${label}`,complete:true,naturalWidth:224,naturalHeight:278}])));
    engine.setProceduralCharacter(player);engine.setKeyboardConfig(layout,orientation);
    const keys=new Set(getKeyboardLayout(layout).keys.flatMap(key=>key.vkCodes));
    for(const vk of keys){
      engine.onKeyDown(vk,false);
      const state=player.debugState();
      assert.equal(state.leftHeld+state.rightHeld,1,`${outfit.id}/${layout}/${orientation}/${vk}: exactly one hand holds the key`);
      assert.equal(state.tailHeld,0,'test variants never acquire a tail');
      engine.onKeyDown(vk,true);
      assert.equal(player.debugState().leftHeld+player.debugState().rightHeld,1,'system repeat keeps one held key');
      engine.onKeyUp(vk);
      assert.deepEqual([player.debugState().leftHeld,player.debugState().rightHeld,player.debugState().tailHeld],[0,0,0]);
      keyCases++;
    }
    frame();
  }
  t.diagnostic(`${keyCases} mapped VK press/repeat/release cases across both pilot outfits, two layouts and two orientations`);
  engine.setProceduralCharacter(null);engine.setCatAppearance('dafeiyu');
  engine.onKeyDown(65,false);frame();assert.equal(draws.at(-1),'idle','switching back restores built-in assets');
  engine.stop();
});
