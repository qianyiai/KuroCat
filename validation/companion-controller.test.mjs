import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Use the bundler already installed with Vite; no browser/audio device or new runtime dependency.
const require = createRequire(import.meta.url);
const viteRequire = createRequire(require.resolve('vite/package.json'));
const { build } = viteRequire('esbuild');
const bundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/agentCompanion.ts', import.meta.url))],
  bundle: true, platform: 'node', format: 'esm', write: false,
});
const { AgentCompanionController } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

function fixture(run) {
  const previous = globalThis.window;
  const timers = new Map(); let id = 0;
  globalThis.window = {
    setTimeout(fn, ms) { timers.set(++id, { fn, ms }); return id; },
    clearTimeout(key) { timers.delete(key); },
  };
  const classes = new Set();
  const bubble = { dataset: {}, textContent: '', classList: {
    add: name => classes.add(name), remove: name => classes.delete(name),
  } };
  const controller = new AgentCompanionController({
    bubbleEl: bubble, getTarget: () => null, is3DTarget: () => true, allowSound: () => false,
  });
  try { run(controller, timers, bubble, classes); }
  finally { controller.dispose(); if (previous === undefined) delete globalThis.window; else globalThis.window = previous; }
}

test('an explicit long approval event keeps priority until its own TTL expires', () => fixture((c, timers, bubble, classes) => {
  c.handleEvent({ kind: 'status', status: 'waiting', text: 'Explicit approval', ttlMs: 90000, sound: false });
  c.setPassiveStatus('working'); c.clearPassiveStatus();
  assert.equal(c.getStatus(), 'waiting');
  assert(bubble.textContent.includes('Explicit approval'));
  assert(!classes.has('hidden'));
  const [key, timer] = [...timers].find(([, value]) => value.ms === 90000);
  timers.delete(key); timer.fn();
  c.setPassiveStatus('working');
  assert.equal(c.getStatus(), 'working');
}));

test('disabling passive work during password privacy does not resume synthetic typing', () => fixture((c, timers) => {
  c.setPassiveStatus('working'); c.setPrivacyMode(true); c.clearPassiveStatus(); c.setPrivacyMode(false);
  assert.equal(c.getStatus(), 'idle');
  assert.equal(timers.size, 0);
}));

test('disabling an inactive observer leaves an explicit external bubble intact', () => fixture((c, timers, bubble, classes) => {
  c.handleEvent({ kind: 'bubble', text: 'External status', ttlMs: 30000 });
  c.clearPassiveStatus();
  assert(bubble.textContent.includes('External status'));
  assert(!classes.has('hidden'));
  assert([...timers.values()].some(timer => timer.ms === 30000));
}));
