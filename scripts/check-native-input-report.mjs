import fs from 'node:fs';
import assert from 'node:assert/strict';
const root='tmp/native-validation';
const name=process.argv[2]??'input-monitor';
if(!/^[a-z][a-z0-9-]{0,47}$/.test(name))throw new Error('Expected a portable monitor name');
const reportPath=`${root}/${name}-report.json`;
const verificationPath=`${root}/${name==='input-monitor'?'input':name}-verification.json`;
const report=JSON.parse(fs.readFileSync(reportPath,'utf8'));
assert.ok(!report.error,report.error);
const phases=Object.values(report.phases);
const sum=(field,event)=>phases.reduce((total,p)=>total+(p[field]?.[event]??0),0);
assert.ok(sum('publicEvents','keyDown')>0&&sum('publicEvents','keyUp')>0,'real ordinary keyboard events observed');
assert.ok(sum('privateEvents','privacyTyping')>0,'password focus emits anonymous input pulses');
assert.equal(sum('privateEvents','keyDown')+sum('privateEvents','keyUp'),0,'no ordinary keyboard events during privacy');
assert.ok(report.privacyTransitions>=2,'password focus enters and exits privacy');
assert.ok(phases.reduce((n,p)=>n+p.privacyFrames,0)>0,'desktop publishes privacy display frames');
for(const field of ['rawDisplayFieldDetected','privacyPulseHasExtraFields','rawKeyDuringPrivacy','privacyDisplayStateViolation'])assert.equal(report[field],false,field);
assert.equal(report.recordsRawInput,false);
const state=await(await fetch('http://127.0.0.1:37421/obs/state')).json();
assert.equal(state.privacy,false);assert.equal(state.characterState?.state.privacy,false);
const summary={sourceReport:reportPath,ordinaryKeyDown:sum('publicEvents','keyDown'),ordinaryKeyUp:sum('publicEvents','keyUp'),
  anonymousPrivatePulses:sum('privateEvents','privacyTyping'),privateKeyEvents:0,privacyTransitions:report.privacyTransitions,
  privacyFrames:phases.reduce((n,p)=>n+p.privacyFrames,0),restoredNonPrivacy:true,recordsRawInput:false,
  countScope:'global hook during the user-led interval; may include other input and repeats',
  visualConfirmation:'record separately from the user; this data checker cannot prove rendered gestures'};
fs.writeFileSync(verificationPath,JSON.stringify(summary,null,2));
console.log(JSON.stringify(summary));
