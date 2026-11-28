import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoSnapshot, motorStatus, visibleSessions, rotatingWindow, bubbleRowHeight, bubbleCapacity } from '../src/companionModel.ts';

test('finishing one session does not stop another working session', () => {
  const s = demoSnapshot(); s.sessions[0].activity = 'idle'; s.sessions[0].outcome = 'succeeded';
  assert.equal(motorStatus(s), 'working');
});
test('stale sessions do not synthesize typing', () => {
  const s = demoSnapshot(); s.sessions.forEach(r => r.activity = 'unknown');
  assert.equal(motorStatus(s), 'idle');
});
test('a known ongoing but quiet session stays visible without synthetic typing',()=>{
  const s=demoSnapshot();s.sessions=[{...s.sessions[0],activity:'waiting-update',fresh:false}];
  assert.equal(visibleSessions(s).length,1);assert.equal(motorStatus(s),'idle');
});
test('office activity cannot clear AI work and is a fallback source', () => {
  const s = demoSnapshot(); s.office = 'Excel'; assert.equal(motorStatus(s), 'working');
  s.office = null; assert.equal(motorStatus(s), 'working');
  s.sessions = []; s.office = 'Excel'; assert.equal(motorStatus(s), 'working');
});
test('privacy and master switch hide bubbles and stop animation', () => {
  const s = demoSnapshot(); s.office = 'Excel'; s.paused = true;
  assert.deepEqual(visibleSessions(s), []); assert.equal(motorStatus(s), 'idle');
  s.paused = false; s.settings.enabled = false; assert.equal(motorStatus(s), 'idle');
});
test('completed and unknown sessions are excluded; sorting does not mutate input', () => {
  const s = demoSnapshot(); const before = s.sessions.map(r => r.key);
  s.sessions[0].outcome = 'succeeded'; s.sessions[1].activity = 'waiting-approval';
  assert.equal(visibleSessions(s)[0].key, 'demo-b');
  assert(!visibleSessions(s).some(r => r.key === 'demo-a')); assert.deepEqual(s.sessions.map(r => r.key), before);
});
test('ten running sessions rotate through a six-slot window without duplicates', () => {
  const rows=Array.from({length:10},(_,i)=>i); const seen=new Set();
  for(let tick=0;tick<10;tick++){const selected=rotatingWindow(rows,6,tick*4000);assert.equal(selected.length,6);assert.equal(new Set(selected).size,6);selected.forEach(i=>seen.add(i));}
  assert.equal(seen.size,10);assert.deepEqual(rotatingWindow(rows,6,4000),[1,2,3,4,5,6]);
});
test('rotation does not move an under-capacity list and accepts a smaller screen capacity',()=>{
  assert.deepEqual(rotatingWindow([1,2],6,40000),[1,2]);assert.equal(rotatingWindow([1,2,3,4],2,4000).length,2);
});

test('large multi-line rows reserve enough height for measured wrapped content', () => {
  const cfg = { ...demoSnapshot().settings, fontSize: 20, lines: 4, bubbleWidth: 180 };
  // Browser fixture: two title lines + four progress/project lines measured 348.5px.
  assert(bubbleRowHeight(cfg) >= 349);
});

test('minimal mode rotates all sessions through exactly one slot', () => {
  const cfg = { ...demoSnapshot().settings, layout: 'minimal', maxSessions: 6 };
  const rows = Array.from({ length: 10 }, (_, i) => i);
  const seen = new Set();
  for (let tick = 0; tick < 10; tick++) {
    const selected = rotatingWindow(rows, bubbleCapacity(cfg, 1200), tick * 4000);
    assert.equal(selected.length, 1); seen.add(selected[0]);
  }
  assert.equal(seen.size, 10);
  assert(bubbleRowHeight(cfg) < 40);
  assert.equal(bubbleCapacity({ ...cfg, layout: 'stacked' }, 5000), 6);
});
