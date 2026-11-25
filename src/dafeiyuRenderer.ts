import idleUrl from './assets/dafeiyu/notail_idle.png';
import blinkUrl from './assets/dafeiyu/notail_blink.png';
import shyUrl from './assets/dafeiyu/notail_shy.png';
import happyUrl from './assets/dafeiyu/notail_happy2.png';

import referenceJson from '../src-tauri/protocol/dafeiyu-motion-2d.json?raw';
import type { Motion2d } from './characterMotion2d';
import { ProceduralCharacterRenderer, type ProceduralLayout } from './proceduralCharacterRenderer';
export type DaFeiYuLayout = ProceduralLayout;
export const dafeiyuMotion = JSON.parse(referenceJson) as Motion2d;

/** Built-in adapter; all animation and drawing logic lives in the shared player. */
export class DaFeiYuRenderer extends ProceduralCharacterRenderer {
  constructor() {
    const image = (src: string) => { const img = new Image(); img.src = src; return img; };
    super(dafeiyuMotion, { idle: image(idleUrl), blink: image(blinkUrl), shy: image(shyUrl), happy: image(happyUrl) });
  }
}
