import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DailyKeyCounter } from '../src/dailyKeyCounter.ts';

const day = '2026-11-27';
const area = { x: 110, y: 58, width: 240, height: 280, scale: 1 };
const snapshot = (count, revision, date = day) => ({ count, revision, date });

function render(counter, now) {
  const texts = [];
  let fills = 0;
  const context = {
    save() {}, restore() {}, beginPath() {}, moveTo() {}, arcTo() {}, closePath() {},
    rect() {}, clip() {}, fill() { fills++; },
    measureText() { return { width: 10 }; },
    fillText(text, x, y) { texts.push({ text, x, y }); },
  };
  const bounds = counter.draw(context, area, now);
  return { texts, fills, bounds, text: texts.map(({ text }) => text).join('') };
}

test('stored daily count is static with a backdrop and thousands separators', () => {
  const counter = new DailyKeyCounter();
  counter.accept(snapshot(8_426, 1), false, 0);
  const frame = render(counter, 0);
  assert.equal(frame.text, '8,426');
  assert.equal(frame.fills, 1);
  assert(frame.texts.every(({ y }) => y === area.y));
  assert(frame.bounds.every((value) => value >= 0 && value <= 1));
});

test('decimal carry rolls upward and rapid presses add independent floating labels', () => {
  const counter = new DailyKeyCounter();
  counter.accept(snapshot(999, 1), false, 0);
  counter.accept(snapshot(1_000, 2), true, 20);
  const rolling = render(counter, 80);
  assert.equal(rolling.text, '1,909090+1');
  assert(rolling.texts[2].y < rolling.texts[3].y);
  counter.accept(snapshot(1_001, 3), true, 90);
  counter.accept(snapshot(1_002, 4), true, 130);
  assert.equal(render(counter, 300).text, '1,002+1+1+1');
  assert.equal(render(counter, 800).text, '1,002');
});

test('late snapshots cannot replace newer counts and a new day clears the HUD', () => {
  const counter = new DailyKeyCounter();
  counter.accept(snapshot(7, 2), true, 10);
  assert.equal(counter.accept(snapshot(6, 1), false, 20), false);
  assert.equal(render(counter, 100).text, '7');
  assert.equal(counter.accept(snapshot(0, 3, '2026-11-28'), true, 120), true);
  assert.deepEqual(render(counter, 125), { text: '', texts: [], fills: 0, bounds: undefined });
  counter.accept(snapshot(1, 4, '2026-11-28'), true, 150);
  assert.equal(render(counter, 300).text, '1+1');
});

test('a same-day reset hides the HUD and the next key starts at one', () => {
  const counter = new DailyKeyCounter();
  counter.accept(snapshot(6, 1), false, 0);
  counter.accept(snapshot(7, 2), true, 10);
  counter.accept(snapshot(0, 3), true, 40);
  assert.equal(render(counter, 40).bounds, undefined);
  assert.equal(counter.accept(snapshot(7, 2), false, 45), false);
  counter.accept(snapshot(1, 4), true, 50);
  assert.equal(render(counter, 200).text, '1+1');
});
