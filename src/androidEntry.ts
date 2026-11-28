import { KuroCatEngine } from './catEngine';
import type { CollarColorId, KuroCatEngine3D } from './catEngine3d';
import { DEFAULT_TAIL_KEY_IDS, type KeyboardOrientation, type TailKeyMode } from './tailKeyTypes';
import type { GamepadInputState } from './gamepadTypes';
import { BUILTIN_WEB_CATS } from '../website/src/builtinCats';
import { catAudio } from './audio';
import {
  getKeyboardLayout,
  normalizeKeyboardLayout,
  resolveKeyByVk,
  type KeyboardLayoutId,
} from './keyboardLayout';
import type { TreatFlavor } from './treatTypes';

function normalizeTreatFlavor(raw: unknown): TreatFlavor {
  return raw === 'chicken' || raw === 'salmon' || raw === 'bonito' ? raw : 'tuna';
}

type RenderMode = '2d' | '3d' | '3d-flat';
type ToggleAutoMode = 'auto' | 'on' | 'off';

interface AndroidSettingsPayload {
  catBreed?: string;
  renderMode?: RenderMode;
  collarColor?: CollarColorId;
  laoWuHandover?: boolean;
  keyboardLayout?: KeyboardLayoutId;
  keyboardOrientation?: KeyboardOrientation;
  opacity?: number;
  showKeyBubbles?: boolean;
  soundEnabled?: boolean;
  typingSoundEnabled?: boolean;
  privacyMode?: boolean;
  headphones?: boolean;
  tabletMode?: 'on' | 'off';
  gamepadMode?: ToggleAutoMode;
  tailKeyMode?: TailKeyMode;
  fpsCap?: number;
  showMouse?: boolean;
  treatFlavor?: TreatFlavor;
}

const canvas = document.getElementById('pet-canvas') as HTMLCanvasElement;
let canvas3d = document.getElementById('pet-canvas-3d') as HTMLCanvasElement;
const engine = new KuroCatEngine(canvas, { embedded: true });
engine.setRenderScale(1.0);
engine.start();

let engine3d: KuroCatEngine3D | null = null;
let loading3dPromise: Promise<void> | null = null;
let webgl3dUnavailable = false;
let active3d = false;

// Natural alternating left/right home-row + occasional space/enter/backspace VKs
// used when Android Accessibility reports IME text-change deltas without physical keycodes.
const LEFT_HAND_VKS = [0x41, 0x53, 0x44, 0x46, 0x47, 0x51, 0x57, 0x45, 0x52, 0x54, 0x5a, 0x58, 0x43, 0x56];
const RIGHT_HAND_VKS = [0x48, 0x4a, 0x4b, 0x4c, 0x59, 0x55, 0x49, 0x4f, 0x50, 0x42, 0x4e, 0x4d];
const TAIL_TAILSLAP_VKS = [0x0d, 0x08, 0x20];

let burstStep = 0;
let petResetTimer: number | null = null;
let petAnimRaf: number | null = null;
let lastBreedId: string | null = null;
let lastLayout: KeyboardLayoutId | null = null;
let lastOrient: KeyboardOrientation | null = null;
let lastTailKeyMode: TailKeyMode | null = null;
let currentRenderMode: RenderMode = '2d';
let currentCollar: CollarColorId = 'none';
let currentLaoWuHandover = true;
let currentTailKeyMode: TailKeyMode = 'smart';
let currentHeadphones = false;
let currentTabletOn = false;
let currentGamepadMode: ToggleAutoMode = 'auto';
let liveGamepadActive = false;
let currentShowMouse = true;
let currentFpsCap = 0;
let currentPrivacyMode = false;
let currentShowBubbles = true;
let currentTreatFlavor: TreatFlavor = 'tuna';
let treatActive = false;
let currentSkin = BUILTIN_WEB_CATS[0];

function shouldUseGamepadNow(): boolean {
  if (currentSkin.id === 'dafeiyu') return false;
  if (currentGamepadMode === 'on') return true;
  if (currentGamepadMode === 'off') return false;
  return liveGamepadActive;
}

function normalizeCollar(raw: unknown): CollarColorId {
  return raw === 'red' || raw === 'blue' || raw === 'pink' || raw === 'green' ? raw : 'none';
}

function normalizeRenderMode(raw: unknown): RenderMode {
  return raw === '3d' || raw === '3d-flat' ? raw : '2d';
}

function syncEngine3DState(prevSkinForHandover?: typeof currentSkin): void {
  if (!engine3d) return;
  const style = currentRenderMode === '3d-flat' ? '2d' : '3d';
  engine3d.setRenderStyle(style);
  if (
    prevSkinForHandover &&
    prevSkinForHandover.id !== currentSkin.id &&
    currentLaoWuHandover &&
    style === '3d' &&
    currentSkin.id !== 'dafeiyu' &&
    prevSkinForHandover.id !== 'dafeiyu'
  ) {
    engine3d.transitionToSkin(currentSkin, prevSkinForHandover);
  } else {
    engine3d.setCatSkin(currentSkin);
  }
  engine3d.setCollar(currentCollar);
  engine3d.setKeyboardConfig(lastLayout ?? '65', lastOrient ?? 'cat', false);
  engine3d.showKeyBubbles = currentShowBubbles;
  engine3d.setPrivacyMode(currentPrivacyMode);
  engine3d.setHeadphones(currentHeadphones && currentSkin.id !== 'dafeiyu');
  engine3d.setTabletActive(currentTabletOn && currentSkin.id !== 'dafeiyu');
  engine3d.setGamepadActive(shouldUseGamepadNow());
  engine3d.setTailKeyConfig(currentTailKeyMode, DEFAULT_TAIL_KEY_IDS);
  engine3d.setFpsCap(currentFpsCap === 30 ? 30 : 0);
  engine3d.resize();
}

function activateRenderEngine(prevSkinForHandover?: typeof currentSkin): void {
  const want3d =
    currentRenderMode !== '2d' && currentSkin.id !== 'dafeiyu' && !webgl3dUnavailable;
  if (want3d) {
    if (!engine3d) {
      if (!loading3dPromise) {
        loading3dPromise = import('./catEngine3d')
          .then(({ KuroCatEngine3D: Engine3DCtor }) => {
            loading3dPromise = null;
            if (webgl3dUnavailable) return;
            try {
              engine3d = new Engine3DCtor(canvas3d, { embedded: true });
              engine3d.setRenderScale(1.0);
              engine3d.onTreatUpdate = (st) => {
                if (!st.active && treatActive) {
                  treatActive = false;
                  notifyHostTreatEnded();
                }
              };
              syncEngine3DState();
              activateRenderEngine();
            } catch (err) {
              console.warn('Android 3D WebGL unavailable, falling back to 2D:', err);
              webgl3dUnavailable = true;
              engine3d = null;
              activateRenderEngine();
            }
          })
          .catch((err) => {
            loading3dPromise = null;
            console.warn('Android 3D chunk load failed, falling back to 2D:', err);
            webgl3dUnavailable = true;
            activateRenderEngine();
          });
      }
      return;
    }

    const was3d = active3d;
    active3d = true;
    engine.stop();
    canvas.classList.add('hidden');
    if (canvas.width > 1 || canvas.height > 1) {
      canvas.width = 1;
      canvas.height = 1;
    }
    canvas3d.classList.remove('hidden');
    syncEngine3DState(was3d ? prevSkinForHandover : undefined);
    engine3d.start();
    if (treatActive) {
      engine3d.startTreatMode(currentTreatFlavor);
    }
  } else {
    active3d = false;
    if (engine3d) {
      engine3d.stop();
    }
    canvas3d.classList.add('hidden');
    canvas.classList.remove('hidden');
    engine.resize();
    engine.start();
    if (treatActive) {
      engine.startTreatMode(currentTreatFlavor);
    }
  }
}

function notifyHostTreatEnded(): void {
  try {
    const host = (window as unknown as { KuroAndroidHost?: { onTreatEnded?: () => void } })
      .KuroAndroidHost;
    host?.onTreatEnded?.();
  } catch {
    // optional host bridge
  }
}

engine.onTreatUpdate = (st) => {
  if (!st.active && treatActive) {
    treatActive = false;
    notifyHostTreatEnded();
  }
};

function computeKeySoundPan(vk: number): number {
  const kbLayout: KeyboardLayoutId = normalizeKeyboardLayout(engine.keyboardLayout);
  const spec = resolveKeyByVk(vk, kbLayout);
  if (!spec) return 0;
  const layout = getKeyboardLayout(kbLayout);
  const centerU = spec.uStart + spec.uWidth * 0.5;
  const normX = Math.max(0, Math.min(1, centerU / layout.totalUnits));
  return (normX * 2 - 1) * 0.35;
}

function tapVk(vk: number, delayMs: number, holdMs = 82, fromDirectClick = false): void {
  const fire = () => {
    if (!currentPrivacyMode) {
      catAudio.playKeyDown(vk, computeKeySoundPan(vk));
    }
    if (active3d && engine3d) engine3d.onKeyDown(vk, false, fromDirectClick);
    else engine.onKeyDown(vk, false, fromDirectClick);
    window.setTimeout(() => {
      if (!currentPrivacyMode) {
        catAudio.playKeyUp(vk, computeKeySoundPan(vk));
      }
      if (active3d && engine3d) engine3d.onKeyUp(vk);
      engine.onKeyUp(vk);
    }, holdMs);
  };
  if (delayMs <= 0) fire();
  else window.setTimeout(fire, delayMs);
}

function applySettings(payload: AndroidSettingsPayload): void {
  if (!payload || typeof payload !== 'object') return;
  const prevSkin = currentSkin;
  const breedId = payload.catBreed || lastBreedId || 'black';
  const skin = BUILTIN_WEB_CATS.find((c) => c.id === breedId) ?? BUILTIN_WEB_CATS[0];
  currentSkin = skin;
  let needsResize = false;

  if (payload.renderMode !== undefined) {
    const nextMode = normalizeRenderMode(payload.renderMode);
    if (nextMode !== currentRenderMode) {
      currentRenderMode = nextMode;
      if (nextMode !== '2d') webgl3dUnavailable = false;
    }
  }
  if (payload.collarColor !== undefined) {
    currentCollar = normalizeCollar(payload.collarColor);
  }
  if (typeof payload.laoWuHandover === 'boolean') {
    currentLaoWuHandover = payload.laoWuHandover;
  }
  if (payload.treatFlavor !== undefined) {
    currentTreatFlavor = normalizeTreatFlavor(payload.treatFlavor);
  }

  if (skin.id !== lastBreedId) {
    engine.setCatAppearance(skin.id, skin);
    lastBreedId = skin.id;
    needsResize = true;
  }

  const layout: KeyboardLayoutId =
    payload.keyboardLayout !== undefined
      ? normalizeKeyboardLayout(payload.keyboardLayout)
      : (lastLayout ?? '65');
  const orient: KeyboardOrientation =
    payload.keyboardOrientation === 'viewer'
      ? 'viewer'
      : payload.keyboardOrientation === 'cat'
        ? 'cat'
        : (lastOrient ?? 'cat');
  if (layout !== lastLayout || orient !== lastOrient) {
    engine.setKeyboardConfig(layout, orient);
    lastLayout = layout;
    lastOrient = orient;
    needsResize = true;
  }

  if (typeof payload.opacity === 'number' && Number.isFinite(payload.opacity)) {
    const clampedOpacity = Math.max(0.2, Math.min(1.0, payload.opacity));
    const opacityStr = clampedOpacity >= 0.999 ? '' : String(clampedOpacity);
    canvas.style.opacity = opacityStr;
    canvas3d.style.opacity = opacityStr;
  }
  if (typeof payload.showKeyBubbles === 'boolean') {
    currentShowBubbles = payload.showKeyBubbles;
    engine.showKeyBubbles = currentShowBubbles;
  }
  if (typeof payload.soundEnabled === 'boolean') {
    catAudio.setEnabled(payload.soundEnabled);
  }
  if (typeof payload.typingSoundEnabled === 'boolean') {
    catAudio.setTypingSoundEnabled(payload.typingSoundEnabled);
  }
  if (typeof payload.privacyMode === 'boolean' && payload.privacyMode !== currentPrivacyMode) {
    currentPrivacyMode = payload.privacyMode;
    engine.setPrivacyMode(currentPrivacyMode);
    if (currentPrivacyMode && treatActive) {
      treatActive = false;
      engine.stopTreatMode();
      engine3d?.stopTreatMode();
      notifyHostTreatEnded();
    }
  }
  if (typeof payload.headphones === 'boolean') {
    currentHeadphones = payload.headphones;
  }
  engine.setHeadphones(currentHeadphones && skin.id !== 'dafeiyu');

  if (payload.tabletMode !== undefined) {
    currentTabletOn = payload.tabletMode === 'on';
  }
  engine.setTabletActive(currentTabletOn && skin.id !== 'dafeiyu');

  if (payload.gamepadMode !== undefined) {
    currentGamepadMode =
      payload.gamepadMode === 'on' || payload.gamepadMode === 'off' ? payload.gamepadMode : 'auto';
  }
  engine.setGamepadActive(shouldUseGamepadNow());

  if (payload.tailKeyMode !== undefined) {
    const mode: TailKeyMode =
      payload.tailKeyMode === 'custom' ||
      payload.tailKeyMode === 'edge' ||
      payload.tailKeyMode === 'off'
        ? payload.tailKeyMode
        : 'smart';
    currentTailKeyMode = mode;
    if (mode !== lastTailKeyMode) {
      engine.setTailKeyConfig(mode, DEFAULT_TAIL_KEY_IDS);
      lastTailKeyMode = mode;
    }
  } else if (lastTailKeyMode === null) {
    engine.setTailKeyConfig(currentTailKeyMode, DEFAULT_TAIL_KEY_IDS);
    lastTailKeyMode = currentTailKeyMode;
  }

  if (payload.fpsCap !== undefined) {
    currentFpsCap = payload.fpsCap === 30 ? 30 : 0;
    engine.setFpsCap(currentFpsCap);
  }

  if (typeof payload.showMouse === 'boolean' && payload.showMouse !== currentShowMouse) {
    currentShowMouse = payload.showMouse;
    engine.setMouseVisible(currentShowMouse);
    needsResize = true;
  }

  activateRenderEngine(prevSkin);
  if (needsResize && !active3d) {
    engine.resize();
  }
}

function cancelPetBurst(): void {
  const hadActive = petAnimRaf !== null || petResetTimer !== null;
  if (petAnimRaf !== null) {
    cancelAnimationFrame(petAnimRaf);
    petAnimRaf = null;
  }
  if (petResetTimer !== null) {
    window.clearTimeout(petResetTimer);
    petResetTimer = null;
  }
  if (hadActive) {
    if (active3d && engine3d) engine3d.onWindowCursor(-1, -1, false);
    else engine.onWindowCursor(-1, -1, false, 'touch');
  }
}

function triggerPetBurst(): void {
  if (petAnimRaf !== null) {
    cancelAnimationFrame(petAnimRaf);
    petAnimRaf = null;
  }
  if (petResetTimer !== null) {
    window.clearTimeout(petResetTimer);
    petResetTimer = null;
  }
  const start = performance.now();
  const duration = 680;
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / duration);
    const wave = Math.sin(t * Math.PI * 4.0) * 0.14;
    if (active3d && engine3d) engine3d.onWindowCursor(0.48 + wave, 0.36, true);
    else engine.onWindowCursor(0.48 + wave, 0.36, true, 'touch');
    if (t < 1) {
      petAnimRaf = requestAnimationFrame(step);
    } else {
      petAnimRaf = null;
      petResetTimer = window.setTimeout(() => {
        petResetTimer = null;
        if (active3d && engine3d) engine3d.onWindowCursor(-1, -1, false);
        else engine.onWindowCursor(-1, -1, false, 'touch');
      }, 320);
    }
  };
  petAnimRaf = requestAnimationFrame(step);
}

const bridge = {
  setSettings(payloadOrJson: AndroidSettingsPayload | string): void {
    try {
      const data =
        typeof payloadOrJson === 'string'
          ? (JSON.parse(payloadOrJson) as AndroidSettingsPayload)
          : payloadOrJson;
      applySettings(data);
    } catch (e) {
      console.error('KuroAndroid.setSettings error', e);
    }
  },

  onTypingBurst(count = 1, kind: 'char' | 'delete' | 'enter' | 'space' = 'char'): void {
    if (currentPrivacyMode) {
      if (active3d && engine3d) engine3d.onPrivacyTyping();
      else engine.onPrivacyTyping();
      return;
    }
    const taps = Math.max(1, Math.min(4, Math.round(count)));
    for (let i = 0; i < taps; i++) {
      let vk: number;
      if (kind === 'delete') {
        vk = 0x08;
      } else if (kind === 'enter') {
        vk = 0x0d;
      } else if (kind === 'space') {
        vk = 0x20;
      } else {
        burstStep++;
        if (currentTailKeyMode !== 'off' && burstStep % 7 === 0) {
          vk = TAIL_TAILSLAP_VKS[burstStep % TAIL_TAILSLAP_VKS.length];
        } else if (burstStep % 2 === 0) {
          vk = LEFT_HAND_VKS[(burstStep * 3) % LEFT_HAND_VKS.length];
        } else {
          vk = RIGHT_HAND_VKS[(burstStep * 5) % RIGHT_HAND_VKS.length];
        }
      }
      tapVk(vk, i * 52, 78);
    }
  },

  onKeyDown(vk: number, repeat = false): void {
    const isRepeat = Boolean(repeat);
    if (currentPrivacyMode) {
      if (!isRepeat) {
        if (active3d && engine3d) engine3d.onPrivacyTyping();
        else engine.onPrivacyTyping();
      }
      return;
    }
    if (!isRepeat) {
      catAudio.playKeyDown(vk, computeKeySoundPan(vk));
    }
    if (active3d && engine3d) engine3d.onKeyDown(vk, isRepeat);
    else engine.onKeyDown(vk, isRepeat);
  },

  onKeyUp(vk: number): void {
    if (!currentPrivacyMode) {
      catAudio.playKeyUp(vk, computeKeySoundPan(vk));
    }
    if (active3d && engine3d) engine3d.onKeyUp(vk);
    engine.onKeyUp(vk);
  },

  onScreenTap(nx = 0.5, ny = 0.5, rightBtn = false): void {
    if (!currentShowMouse) return;
    if (currentPrivacyMode) {
      if (active3d && engine3d) engine3d.onPrivacyTyping();
      else engine.onPrivacyTyping();
      return;
    }
    const clampedX = Number.isFinite(nx) ? Math.max(0, Math.min(1, nx)) : 0.5;
    const clampedY = Number.isFinite(ny) ? Math.max(0, Math.min(1, ny)) : 0.5;
    const btn = rightBtn ? 'right' : 'left';
    if (active3d && engine3d) {
      engine3d.onGlobalMouseMove(clampedX, clampedY);
      catAudio.playMouseDown(btn);
      engine3d.onMouseDown(btn);
      window.setTimeout(() => {
        if (!currentPrivacyMode) catAudio.playMouseUp(btn);
        engine3d?.onMouseUp(btn);
      }, 95);
    } else {
      engine.onGlobalMouseMove(clampedX, clampedY);
      catAudio.playMouseDown(btn);
      engine.onMouseDown(btn);
      window.setTimeout(() => {
        if (!currentPrivacyMode) catAudio.playMouseUp(btn);
        engine.onMouseUp(btn);
      }, 95);
    }
  },

  onGamepadState(payloadOrJson: (GamepadInputState & { active?: boolean }) | string): void {
    try {
      const p =
        typeof payloadOrJson === 'string'
          ? (JSON.parse(payloadOrJson) as GamepadInputState & { active?: boolean })
          : payloadOrJson;
      if (!p) return;
      const nextLive = Boolean(p.active);
      if (nextLive !== liveGamepadActive) {
        liveGamepadActive = nextLive;
        const useGp = shouldUseGamepadNow();
        engine.setGamepadActive(useGp);
        engine3d?.setGamepadActive(useGp);
      }
      if (shouldUseGamepadNow()) {
        if (active3d && engine3d) engine3d.onGamepadState(p);
        else engine.onGamepadState(p);
      }
    } catch (e) {
      console.error('KuroAndroid.onGamepadState error', e);
    }
  },

  startTreat(flavor?: string): void {
    if (currentPrivacyMode || currentSkin.id === 'dafeiyu') return;
    cancelPetBurst();
    currentTreatFlavor = normalizeTreatFlavor(flavor ?? currentTreatFlavor);
    treatActive = true;
    if (active3d && engine3d) {
      engine.stopTreatMode();
      engine3d.startTreatMode(currentTreatFlavor);
    } else {
      engine3d?.stopTreatMode();
      engine.startTreatMode(currentTreatFlavor);
    }
  },

  stopTreat(): void {
    if (!treatActive) return;
    treatActive = false;
    engine.stopTreatMode();
    engine3d?.stopTreatMode();
  },

  setTreatPointer(nx: number, ny: number, pressed: boolean): void {
    if (!treatActive) return;
    const target = active3d && engine3d ? canvas3d : canvas;
    const rect = target.getBoundingClientRect();
    const clampedX = Number.isFinite(nx) ? Math.max(0, Math.min(1, nx)) : 0.5;
    const clampedY = Number.isFinite(ny) ? Math.max(0, Math.min(1, ny)) : 0.5;
    const clientX = rect.left + clampedX * (rect.width || target.clientWidth || 1);
    const clientY = rect.top + clampedY * (rect.height || target.clientHeight || 1);
    if (active3d && engine3d) engine3d.setTreatPointer(clientX, clientY, Boolean(pressed));
    else engine.setTreatPointer(clientX, clientY, Boolean(pressed));
  },

  setPrivacyMode(active: boolean): void {
    currentPrivacyMode = Boolean(active);
    engine.setPrivacyMode(currentPrivacyMode);
    engine3d?.setPrivacyMode(currentPrivacyMode);
    if (currentPrivacyMode && treatActive) {
      treatActive = false;
      engine.stopTreatMode();
      engine3d?.stopTreatMode();
      notifyHostTreatEnded();
    }
  },

  onPrivacyTyping(): void {
    if (active3d && engine3d) engine3d.onPrivacyTyping();
    else engine.onPrivacyTyping();
  },

  tapAt(nx: number, ny: number): void {
    const clampedX = Number.isFinite(nx) ? Math.max(0, Math.min(1, nx)) : 0.5;
    const clampedY = Number.isFinite(ny) ? Math.max(0, Math.min(1, ny)) : 0.5;
    const target = active3d && engine3d ? canvas3d : canvas;
    const rect = target.getBoundingClientRect();
    const clientX = rect.left + clampedX * (rect.width || target.clientWidth || 1);
    const clientY = rect.top + clampedY * (rect.height || target.clientHeight || 1);

    // Direct clickable keyboard on Android (pure visual + audio animation, never injects OS text!)
    if (!currentPrivacyMode && !treatActive && !shouldUseGamepadNow()) {
      const keyHit =
        active3d && engine3d
          ? engine3d.hitTestKeyAtClientPoint(clientX, clientY)
          : engine.hitTestKeyAtClientPoint(clientX, clientY);
      if (keyHit && keyHit.vkCodes.length > 0) {
        cancelPetBurst();
        tapVk(keyHit.vkCodes[0], 0, 115, true);
        return;
      }
    }

    const zone =
      active3d && engine3d
        ? engine3d.onCatTapAtClientPoint(clientX, clientY)
        : engine.onCatTapAtClientPoint(clientX, clientY);
    if (zone === 'head' || zone === null || currentSkin.id === 'dafeiyu') {
      triggerPetBurst();
    } else {
      cancelPetBurst();
    }
  },

  setDragging(dragging: boolean, velX = 0): void {
    const isDragging = Boolean(dragging);
    if (isDragging) {
      cancelPetBurst();
    }
    const vx = Number.isFinite(velX) ? velX : 0;
    if (active3d && engine3d) engine3d.setDragging(isDragging, vx);
    else engine.setDragging(isDragging, vx);
  },

  updateDragVelocity(velX: number, velY = 0): void {
    const vx = Number.isFinite(velX) ? velX : 0;
    const vy = Number.isFinite(velY) ? velY : 0;
    if (active3d && engine3d) engine3d.updateDragVelocity(vx, vy);
    else engine.updateDragVelocity(vx, vy);
  },

  petHead(): void {
    triggerPetBurst();
  },

  petMove(relX: number, relY: number, active: boolean): void {
    if (active3d && engine3d) engine3d.onWindowCursor(relX, relY, Boolean(active));
    else engine.onWindowCursor(relX, relY, Boolean(active), 'touch');
  },

  resize(): void {
    if (active3d && engine3d) engine3d.resize();
    else engine.resize();
  },
};

(window as unknown as { KuroAndroid: typeof bridge }).KuroAndroid = bridge;

const ro = new ResizeObserver(() => {
  if (active3d && engine3d) engine3d.resize();
  else engine.resize();
});
ro.observe(document.documentElement);
