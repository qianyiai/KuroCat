import type { PadPoint } from './trackpad';
import {
  DEFAULT_TAIL_KEY_IDS,
  KuroCatEngine,
  type KeyboardOrientation,
  type TailKeyMode,
} from './catEngine';
import { catAudio } from './audio';
import { AgentCompanionController, type AgentCompanionEvent } from './agentCompanion';
import { applyPetInteraction, type PetInteractionEvent } from './petInteraction';
import { DEFAULT_BUILTIN_CATS, type CatSkinConfig } from './catSkins';
import { isKeyboardLayoutId, normalizeKeyboardLayout, type KeyboardLayoutId } from './keyboardLayout';
import type { CollarColorId, KuroCatEngine3D } from './catEngine3d';
import type { GamepadInputState } from './keyboard3d';

type ObsRenderMode = '2d' | '3d';
type ObsHeadphoneMode = 'auto' | 'on' | 'off';
type LiveChromaColor = 'blue' | 'green' | 'magenta';

const CHROMA_HEX_MAP: Record<LiveChromaColor, string> = {
  blue: '#0047ff',
  green: '#00b140',
  magenta: '#ff00ff',
};

function parseChromaColor(raw: string | null | undefined): LiveChromaColor | null {
  const norm = raw?.trim().toLowerCase();
  if (norm === 'blue' || norm === 'green' || norm === 'magenta') {
    return norm;
  }
  return null;
}

interface ObsAppSettings {
  scale?: number;
  showKeyBubbles?: boolean;
  catBreed?: string;
  laoWuHandover?: boolean;
  keyboardLayout?: KeyboardLayoutId;
  trackpadEnabled?: boolean;
  whiteKeyboard?: boolean;
  keyboardOrientation?: KeyboardOrientation;
  tailKeyMode?: TailKeyMode;
  tailKeyIds?: string[];
  renderMode?: ObsRenderMode;
  collarColor?: CollarColorId;
  headphoneMode?: ObsHeadphoneMode;
  tabletMode?: 'auto' | 'mouse' | 'tablet';
  gamepadMode?: 'auto' | 'off' | 'on';
  liveChromaColor?: LiveChromaColor;
}

type InputEvent =
  | { kind: 'keyDown'; vk: number; scan: number; repeat: boolean }
  | { kind: 'keyUp'; vk: number; scan: number }
  | { kind: 'trackpad'; points: PadPoint[] }
  | { kind: 'mouseDown'; button: string; point?: PadPoint }
  | { kind: 'mouseUp'; button: string }
  | { kind: 'mouseWheel'; delta: number }
  | { kind: 'mouseMove'; x: number; y: number; nx: number; ny: number }
  | { kind: 'privacyTyping' };

interface ObsStateSnapshot {
  settings?: ObsAppSettings;
  cats?: CatSkinConfig[];
  privacy?: boolean;
  gameActive?: boolean;
  tabletActive?: boolean;
  gamepadActive?: boolean;
}

const canvas = document.getElementById('obs-canvas') as HTMLCanvasElement;
const canvas3d = document.getElementById('obs-canvas-3d') as HTMLCanvasElement;
const liveToolbarEl = document.getElementById('live-toolbar') as HTMLDivElement | null;
const liveCloseBtnEl = document.getElementById('live-close-btn') as HTMLButtonElement | null;
const liveSwatchButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>('#live-toolbar [data-chroma]'),
);
const agentBubbleEl = document.getElementById('agent-bubble') as HTMLDivElement | null;
const engine = new KuroCatEngine(canvas);

let engine3d: KuroCatEngine3D | null = null;
let loading3d: Promise<void> | null = null;
let lastPadPoints: readonly PadPoint[] = [];
let active3d = false;
let webglBlocked = false;
let privacyActive = false;
let gameActive = false;
let gpuEcoActive = false;
let tabletActive = false;
let gamepadActive = false;
let appliedObsCatId: string | null = null;
let appliedObsCatSkin: CatSkinConfig | null = null;

const obsAgentCompanion = new AgentCompanionController({
  bubbleEl: agentBubbleEl,
  getTarget: () => (active3d && engine3d ? engine3d : engine),
  is3DTarget: () => Boolean(active3d && engine3d),
  allowSound: () => false,
});

// Mute audio inside OBS Browser Source and Live Companion Capture Window so sounds never double-play on stream
catAudio.setEnabled(false);
catAudio.setTypingSoundEnabled(false);

// Optional query overrides for streamers (e.g. /obs?mode=3d&collar=red&scale=1.15&bubbles=0&breed=ragdoll&layout=108&orient=viewer&bg=blue)
const params = new URLSearchParams(window.location.search);
const isLiveMode = params.get('live') === '1' || params.get('live') === 'true';
const isTauriRuntime = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
const overrideBg = parseChromaColor(params.get('bg'));
const overrideBreed = params.get('breed')?.trim() || null;
const overrideModeRaw = params.get('mode')?.trim().toLowerCase() || null;
const overrideMode: ObsRenderMode | null =
  overrideModeRaw === '3d' || overrideModeRaw === '3d-flat'
    ? '3d'
    : overrideModeRaw === '2d'
      ? '2d'
      : null;
const overrideCollarRaw = params.get('collar')?.trim().toLowerCase() || null;
const overrideCollar: CollarColorId | null =
  overrideCollarRaw === 'none' ||
  overrideCollarRaw === 'red' ||
  overrideCollarRaw === 'blue' ||
  overrideCollarRaw === 'pink' ||
  overrideCollarRaw === 'green'
    ? overrideCollarRaw
    : null;
const overrideHeadphoneRaw = params.get('headphones')?.trim().toLowerCase() || null;
const overrideHeadphones: ObsHeadphoneMode | null =
  overrideHeadphoneRaw === 'auto' || overrideHeadphoneRaw === 'on' || overrideHeadphoneRaw === 'off'
    ? overrideHeadphoneRaw
    : null;
const overrideTabletRaw = params.get('tablet')?.trim().toLowerCase() || null;
const overrideTablet: 'auto' | 'mouse' | 'tablet' | null =
  overrideTabletRaw === 'auto' || overrideTabletRaw === 'mouse' || overrideTabletRaw === 'tablet'
    ? overrideTabletRaw
    : null;
const overrideGamepadRaw = params.get('gamepad')?.trim().toLowerCase() || null;
const overrideGamepad: 'auto' | 'off' | 'on' | null =
  overrideGamepadRaw === 'auto' || overrideGamepadRaw === 'off' || overrideGamepadRaw === 'on'
    ? overrideGamepadRaw
    : null;
const overrideLayoutRaw = params.get('layout');
const overrideLayout: KeyboardLayoutId | null = isKeyboardLayoutId(overrideLayoutRaw)
  ? overrideLayoutRaw
  : null;
const overrideOrient = params.get('orient') === 'viewer' ? 'viewer' : params.get('orient') === 'cat' ? 'cat' : null;
const overrideBubbles = params.has('bubbles') ? params.get('bubbles') !== '0' && params.get('bubbles') !== 'false' : null;
const rawScaleParam = params.get('scale');
const overrideScale =
  rawScaleParam !== null && Number.isFinite(Number(rawScaleParam))
    ? Math.max(0.2, Math.min(2.0, Number(rawScaleParam)))
    : null;

let activeChromaColor: LiveChromaColor = overrideBg ?? 'blue';
let hasLocalChromaOverride = overrideBg !== null;
let fullSettings: Record<string, unknown> | null = null;
let settingsPatchSeq = 0;

let tauriInvokeFn: (<T>(cmd: string, args?: Record<string, unknown>) => Promise<T>) | null = null;
let tauriCloseFallbackFn: (() => Promise<void>) | null = null;
let resolveTauriInit!: () => void;
const tauriInitPromise = new Promise<void>((resolve) => {
  resolveTauriInit = resolve;
});

let catList: CatSkinConfig[] = [...DEFAULT_BUILTIN_CATS];
let currentSettings: ObsAppSettings = {
  scale: 1,
  showKeyBubbles: true,
  catBreed: 'black',
  keyboardLayout: '65',
  keyboardOrientation: 'cat',
  tailKeyMode: 'smart',
  tailKeyIds: [...DEFAULT_TAIL_KEY_IDS],
  renderMode: '3d',
  collarColor: 'none',
  headphoneMode: 'off',
  tabletMode: 'auto',
  liveChromaColor: 'blue',
};

function getActiveChromaHex(): string | null {
  if (isLiveMode) {
    return CHROMA_HEX_MAP[activeChromaColor];
  }
  if (overrideBg) {
    return CHROMA_HEX_MAP[overrideBg];
  }
  return null;
}

function syncChromaAppearance(): void {
  const chromaHex = getActiveChromaHex();
  const pageBg = chromaHex ?? 'transparent';
  document.documentElement.style.background = pageBg;
  document.body.style.background = pageBg;

  engine.setChromaKeyBg(chromaHex);
  engine3d?.setChromaKeyBg(chromaHex);

  if (isLiveMode) {
    for (const btn of liveSwatchButtons) {
      const isActive = btn.dataset.chroma === activeChromaColor;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    }
  }
}

async function persistLiveChromaColor(nextColor: LiveChromaColor): Promise<void> {
  if (!isLiveMode || !isTauriRuntime) return;
  const seq = ++settingsPatchSeq;
  await tauriInitPromise;
  if (!tauriInvokeFn) return;
  try {
    let base = fullSettings;
    if (!base) {
      base = await tauriInvokeFn<Record<string, unknown>>('get_settings');
      fullSettings = { ...base };
    }
    const patchPayload = { ...base, liveChromaColor: nextColor };
    const updated = await tauriInvokeFn<ObsAppSettings & Record<string, unknown>>('update_settings', {
      patch: patchPayload,
    });
    if (seq !== settingsPatchSeq) return;
    if (updated && typeof updated === 'object') {
      fullSettings = { ...updated };
      currentSettings = { ...currentSettings, ...updated };
      const persistedColor = parseChromaColor(updated.liveChromaColor);
      if (persistedColor) {
        activeChromaColor = persistedColor;
      }
      applyState();
    }
  } catch (err) {
    console.warn('[KuroCat Live] Failed to persist chroma color:', err);
  }
}

function setupLiveModeUI(): void {
  if (!isLiveMode) return;
  document.title = 'KuroCat Live';
  document.body.classList.add('live-mode');
  liveToolbarEl?.classList.remove('hidden');

  window.addEventListener('contextmenu', (ev) => {
    ev.preventDefault();
  });

  for (const btn of liveSwatchButtons) {
    btn.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const nextColor = parseChromaColor(btn.dataset.chroma);
      if (!nextColor) return;
      activeChromaColor = nextColor;
      hasLocalChromaOverride = true;
      currentSettings = { ...currentSettings, liveChromaColor: nextColor };
      syncChromaAppearance();
      btn.blur();
      if (isTauriRuntime) {
        void persistLiveChromaColor(nextColor);
      }
    });
  }

  liveCloseBtnEl?.addEventListener('click', (ev) => {
    ev.stopPropagation();
    liveCloseBtnEl.blur();
    if (isTauriRuntime) {
      const doClose = () => {
        if (tauriInvokeFn) {
          void tauriInvokeFn('close_live_capture_window').catch(() => {
            void tauriCloseFallbackFn?.().catch(() => {});
          });
        } else {
          void tauriCloseFallbackFn?.().catch(() => {});
        }
      };
      if (tauriInvokeFn) {
        doClose();
      } else {
        void tauriInitPromise.then(doClose);
      }
    } else {
      window.close();
    }
  });
}

function computeObsHeadphonesOn(activeCat: CatSkinConfig | undefined): boolean {
  if (activeCat?.id === 'dafeiyu') return false;
  const hm: ObsHeadphoneMode =
    overrideHeadphones ||
    (currentSettings.headphoneMode === 'auto' || currentSettings.headphoneMode === 'on'
      ? currentSettings.headphoneMode
      : 'off');
  if (hm === 'on') return true;
  if (hm === 'off') return false;
  return gameActive || gamepadActive;
}

function computeObsTabletOn(activeCat: CatSkinConfig | undefined): boolean {
  if (activeCat?.id === 'dafeiyu') return false;
  const tm =
    overrideTablet ||
    (currentSettings.tabletMode === 'mouse' || currentSettings.tabletMode === 'tablet'
      ? currentSettings.tabletMode
      : 'auto');
  if (tm === 'tablet') return true;
  if (tm === 'mouse') return false;
  return tabletActive;
}

function computeObsGamepadOn(activeCat: CatSkinConfig | undefined): boolean {
  if (activeCat?.id === 'dafeiyu') return false;
  const gm =
    overrideGamepad ||
    (currentSettings.gamepadMode === 'off' || currentSettings.gamepadMode === 'on'
      ? currentSettings.gamepadMode
      : 'auto');
  if (gm === 'on') return true;
  if (gm === 'off') return false;
  return gamepadActive;
}

function wantsObs3D(activeCat: CatSkinConfig | undefined, mode: ObsRenderMode): boolean {
  return mode === '3d' &&
    !webglBlocked &&
    activeCat?.id !== 'dafeiyu';
}

function syncObs3D(
  activeCat: CatSkinConfig | undefined,
  mode: ObsRenderMode,
  collar: CollarColorId,
  layout: KeyboardLayoutId,
  orient: KeyboardOrientation,
  tailMode: TailKeyMode,
  tailIds: string[],
  showBubbles: boolean,
): void {
  if (!wantsObs3D(activeCat, mode)) {
    if (active3d) {
      engine3d?.stop();
      canvas3d.classList.add('hidden');
      canvas.classList.remove('hidden');
      engine.setChromaKeyBg(getActiveChromaHex());
      engine.resize();
      engine.start();
      active3d = false;
    }
    return;
  }

  if (engine3d) {
    engine3d.showKeyBubbles = showBubbles;
    engine3d.setRenderStyle('3d');
    if (activeCat && !engine3d.isHandoverActive()) engine3d.setCatSkin(activeCat);
    engine3d.setCollar(activeCat?.id === 'dafeiyu' ? 'none' : collar);
    engine3d.setHeadphones(computeObsHeadphonesOn(activeCat));
    engine3d.setTabletActive(computeObsTabletOn(activeCat));
    engine3d.setGamepadActive(computeObsGamepadOn(activeCat));
    if (!currentSettings.trackpadEnabled) lastPadPoints = [];
    engine3d.setTrackpad(currentSettings.trackpadEnabled === true);
    engine3d.onTrackpad(lastPadPoints);
    engine3d.setKeyboardConfig(layout, orient, currentSettings.whiteKeyboard === true);
    engine3d.setTailKeyConfig(tailMode, tailIds);
    engine3d.setRenderScale(overrideScale ?? 1.0);
    engine3d.setPrivacyMode(privacyActive);
    engine3d.setGameActive(gameActive || gpuEcoActive);
    engine3d.setChromaKeyBg(getActiveChromaHex());
    if (!active3d) {
      engine.stop();
      canvas.classList.add('hidden');
      canvas3d.classList.remove('hidden');
      engine3d.resize();
      engine3d.start();
      active3d = true;
    }
    return;
  }

  if (!loading3d) {
    loading3d = import('./catEngine3d')
      .then(({ KuroCatEngine3D }) => {
        engine3d = new KuroCatEngine3D(canvas3d, { embedded: false });
        engine3d.setChromaKeyBg(getActiveChromaHex());
        window.addEventListener('resize', () => engine3d?.resize());
        applyState();
      })
      .catch(() => {
        webglBlocked = true;
      })
      .finally(() => {
        loading3d = null;
      });
  }
}

function applyState(): void {
  const breedId = overrideBreed || currentSettings.catBreed || 'black';
  const activeCat = catList.find((c) => c.id === breedId) ?? catList[0];
  const layout: KeyboardLayoutId =
    overrideLayout || normalizeKeyboardLayout(currentSettings.keyboardLayout);
  const orient: KeyboardOrientation =
    overrideOrient || (currentSettings.keyboardOrientation === 'viewer' ? 'viewer' : 'cat');
  const tailMode: TailKeyMode =
    currentSettings.tailKeyMode === 'custom' ||
    currentSettings.tailKeyMode === 'edge' ||
    currentSettings.tailKeyMode === 'off'
      ? currentSettings.tailKeyMode
      : 'smart';
  const tailIds = Array.isArray(currentSettings.tailKeyIds)
    ? currentSettings.tailKeyIds
    : [...DEFAULT_TAIL_KEY_IDS];
  const showBubbles =
    overrideBubbles !== null ? overrideBubbles : currentSettings.showKeyBubbles !== false;
  const mode: ObsRenderMode =
    overrideMode || (currentSettings.renderMode === '2d' ? '2d' : '3d');
  const collar: CollarColorId =
    overrideCollar ||
    (currentSettings.collarColor === 'red' ||
    currentSettings.collarColor === 'blue' ||
    currentSettings.collarColor === 'pink' ||
    currentSettings.collarColor === 'green'
      ? currentSettings.collarColor
      : 'none');

  syncChromaAppearance();
  engine.showKeyBubbles = showBubbles;
  const nextObsId = activeCat?.id || 'black';
  const prevObsId = appliedObsCatId;
  const prevObsSkin = appliedObsCatSkin;
  const obsBreedChanged = prevObsId !== null && prevObsId !== nextObsId;
  const allowObsHandover = currentSettings.laoWuHandover !== false && !privacyActive;

  engine.setCatAppearance(nextObsId, activeCat);
  if (!allowObsHandover || mode !== '3d' || nextObsId === 'dafeiyu' || webglBlocked) {
    engine3d?.cancelHandover();
  } else if (
    obsBreedChanged &&
    active3d &&
    engine3d &&
    !engine3d.isContextLost() &&
    prevObsId !== 'dafeiyu' &&
    activeCat
  ) {
    engine3d.transitionToSkin(activeCat, prevObsSkin ?? undefined);
  }
  appliedObsCatId = nextObsId;
  appliedObsCatSkin = activeCat ? { ...activeCat } : null;

  engine.setHeadphones(computeObsHeadphonesOn(activeCat));
  engine.setTabletActive(computeObsTabletOn(activeCat));
  engine.setGamepadActive(computeObsGamepadOn(activeCat));
  if (!currentSettings.trackpadEnabled) lastPadPoints = [];
  engine.setTrackpad(currentSettings.trackpadEnabled === true);
  engine.onTrackpad(lastPadPoints);
  engine.setKeyboardConfig(layout, orient, currentSettings.whiteKeyboard === true);
  engine.setTailKeyConfig(tailMode, tailIds);
  engine.setRenderScale(overrideScale ?? 1.0);
  engine.setGameActive(gameActive || gpuEcoActive);
  syncObs3D(activeCat, mode, collar, layout, orient, tailMode, tailIds, showBubbles);
}

function handleInput(p: InputEvent): void {
  switch (p.kind) {
    case 'keyDown':
      obsAgentCompanion.notifyRealUserInput();
      if (active3d && engine3d) engine3d.onKeyDown(p.vk, p.repeat);
      else engine.onKeyDown(p.vk, p.repeat);
      break;
    case 'keyUp':
      if (active3d && engine3d) engine3d.onKeyUp(p.vk);
      else engine.onKeyUp(p.vk);
      break;
    case 'mouseMove':
      if (active3d && engine3d) {
        engine3d.onGlobalMouseMove(p.nx, p.ny);
        engine3d.onWindowCursor(p.nx, p.ny, false);
      } else {
        engine.onGlobalMouseMove(p.nx, p.ny);
        engine.onWindowCursor(p.nx, p.ny, false);
      }
      break;
    case 'trackpad':
      lastPadPoints = p.points;
      if (active3d && engine3d) engine3d.onTrackpad(p.points);
      else engine.onTrackpad(p.points);
      break;
    case 'mouseDown':
      if (active3d && engine3d) engine3d.onMouseDown(p.button, p.point);
      else engine.onMouseDown(p.button, p.point);
      break;
    case 'mouseUp':
      if (active3d && engine3d) engine3d.onMouseUp(p.button);
      else engine.onMouseUp(p.button);
      break;
    case 'mouseWheel':
      if (active3d && engine3d) engine3d.onMouseWheel();
      else engine.onMouseWheel();
      break;
    case 'privacyTyping':
      if (active3d && engine3d) engine3d.onPrivacyTyping();
      else engine.onPrivacyTyping();
      break;
  }
}

async function connectTauriLive(): Promise<void> {
  try {
    const [{ invoke }, { listen }, { getCurrentWindow }] = await Promise.all([
      import('@tauri-apps/api/core'),
      import('@tauri-apps/api/event'),
      import('@tauri-apps/api/window'),
    ]);

    const currentWin = getCurrentWindow();
    tauriInvokeFn = invoke;
    tauriCloseFallbackFn = () => currentWin.close();

    window.addEventListener('mousedown', (ev) => {
      if (ev.button !== 0) return;
      const target = ev.target as HTMLElement | null;
      if (target?.closest('button, .live-swatch, #live-close-btn')) return;
      ev.preventDefault();
      void currentWin.startDragging().catch(() => {});
    });

    const [loadedSettings, loadedCats, loadedGameActive, loadedTabletActive, loadedGamepadActive] = await Promise.all([
      invoke<ObsAppSettings & Record<string, unknown>>('get_settings'),
      invoke<CatSkinConfig[]>('get_cats'),
      invoke<boolean>('get_game_active').catch(() => false),
      invoke<boolean>('get_tablet_active').catch(() => false),
      invoke<boolean>('get_gamepad_active').catch(() => false),
    ]);

    if (loadedSettings && typeof loadedSettings === 'object') {
      fullSettings = { ...loadedSettings };
      currentSettings = { ...currentSettings, ...loadedSettings };
      if (settingsPatchSeq === 0 && !overrideBg) {
        const savedColor = parseChromaColor(loadedSettings.liveChromaColor);
        if (savedColor) {
          activeChromaColor = savedColor;
        }
      }
    }
    if (Array.isArray(loadedCats) && loadedCats.length > 0) {
      catList = loadedCats;
    }
    gameActive = Boolean(loadedGameActive);
    tabletActive = Boolean(loadedTabletActive);
    gamepadActive = Boolean(loadedGamepadActive);
    resolveTauriInit();
    applyState();

    await Promise.all([
      listen<InputEvent>('kuro-input', (ev) => {
        if (ev.payload) handleInput(ev.payload);
      }),
      listen<ObsAppSettings & Record<string, unknown>>('kuro-settings', (ev) => {
        if (!ev.payload || typeof ev.payload !== 'object') return;
        fullSettings = { ...ev.payload };
        currentSettings = { ...currentSettings, ...ev.payload };
        if (!overrideBg) {
          const nextColor = parseChromaColor(ev.payload.liveChromaColor);
          if (nextColor) {
            activeChromaColor = nextColor;
          }
        }
        applyState();
      }),
      listen<CatSkinConfig[]>('kuro-cats', (ev) => {
        if (Array.isArray(ev.payload) && ev.payload.length > 0) {
          catList = ev.payload;
          applyState();
        }
      }),
      listen<boolean>('kuro-privacy', (ev) => {
        privacyActive = Boolean(ev.payload);
        engine.setPrivacyMode(privacyActive);
        engine3d?.setPrivacyMode(privacyActive);
        obsAgentCompanion.setPrivacyMode(privacyActive);
      }),
      listen<boolean | { active?: boolean; gpuEco?: boolean }>('kuro-game-active', (ev) => {
        const parsed = ev.payload;
        gameActive = typeof parsed === 'boolean' ? parsed : Boolean(parsed?.active);
        gpuEcoActive = typeof parsed === 'boolean' ? parsed : Boolean(parsed?.gpuEco) || gameActive;
        applyState();
      }),
      listen<boolean | { active?: boolean }>('kuro-tablet-active', (ev) => {
        const parsed = ev.payload;
        tabletActive = typeof parsed === 'boolean' ? parsed : Boolean(parsed?.active);
        applyState();
      }),
      listen<GamepadInputState>('kuro-gamepad', (ev) => {
        const p = ev.payload;
        if (!p) return;
        const prev = gamepadActive;
        gamepadActive = Boolean(p.active);
        if (gamepadActive !== prev) applyState();
        const breedId = overrideBreed || currentSettings.catBreed || 'black';
        const activeCat = catList.find((c) => c.id === breedId) ?? catList[0];
        if (computeObsGamepadOn(activeCat)) {
          if (active3d && engine3d) engine3d.onGamepadState(p);
          else engine.onGamepadState(p);
        }
      }),
      listen<AgentCompanionEvent>('kuro-agent-event', (ev) => {
        if (ev.payload) obsAgentCompanion.handleEvent(ev.payload);
      }),
      listen<PetInteractionEvent>('kuro-pet-interaction', (ev) => {
        if (!ev.payload || privacyActive) return;
        applyPetInteraction(
          active3d && engine3d ? engine3d : engine,
          Boolean(active3d && engine3d),
          ev.payload,
        );
      }),
    ]);
  } catch (err) {
    resolveTauriInit();
    console.warn('[KuroCat Live] Failed to attach Tauri IPC:', err);
  }
}

function connectStream(): void {
  if (typeof EventSource === 'undefined') return;
  let es: EventSource;
  try {
    es = new EventSource('/obs/events');
  } catch {
    return;
  }

  es.addEventListener('error', () => {
    // In standalone browser preview (?live=1 without OBS HTTP backend), close quietly on fatal error
    if (isLiveMode && es.readyState === EventSource.CLOSED) {
      es.close();
    }
  });

  es.addEventListener('state', (ev) => {
    try {
      const snap = JSON.parse((ev as MessageEvent).data) as ObsStateSnapshot;
      if (Array.isArray(snap.cats) && snap.cats.length > 0) {
        catList = snap.cats;
      }
      if (snap.settings) {
        currentSettings = { ...currentSettings, ...snap.settings };
        if (isLiveMode && !hasLocalChromaOverride) {
          const savedColor = parseChromaColor(snap.settings.liveChromaColor);
          if (savedColor) activeChromaColor = savedColor;
        }
      }
      if (typeof snap.privacy === 'boolean') {
        privacyActive = snap.privacy;
        engine.setPrivacyMode(privacyActive);
        engine3d?.setPrivacyMode(privacyActive);
      }
      if (typeof snap.gameActive === 'boolean') {
        gameActive = snap.gameActive;
      }
      if (typeof snap.tabletActive === 'boolean') {
        tabletActive = snap.tabletActive;
      }
      if (typeof snap.gamepadActive === 'boolean') {
        gamepadActive = snap.gamepadActive;
      }
      applyState();
    } catch {}
  });

  es.addEventListener('settings', (ev) => {
    try {
      const next = JSON.parse((ev as MessageEvent).data) as ObsAppSettings;
      currentSettings = { ...currentSettings, ...next };
      if (isLiveMode && !hasLocalChromaOverride) {
        const savedColor = parseChromaColor(next.liveChromaColor);
        if (savedColor) activeChromaColor = savedColor;
      }
      applyState();
    } catch {}
  });

  es.addEventListener('cats', (ev) => {
    try {
      const next = JSON.parse((ev as MessageEvent).data) as CatSkinConfig[];
      if (Array.isArray(next) && next.length > 0) {
        catList = next;
        applyState();
      }
    } catch {}
  });

  es.addEventListener('privacy', (ev) => {
    try {
      const active = JSON.parse((ev as MessageEvent).data) === true;
      privacyActive = active;
      engine.setPrivacyMode(active);
      engine3d?.setPrivacyMode(active);
      obsAgentCompanion.setPrivacyMode(active);
    } catch {}
  });

  es.addEventListener('agentEvent', (ev) => {
    try {
      const payload = JSON.parse((ev as MessageEvent).data) as AgentCompanionEvent;
      obsAgentCompanion.handleEvent(payload);
    } catch {}
  });

  es.addEventListener('petInteraction', (ev) => {
    try {
      if (privacyActive) return;
      const payload = JSON.parse((ev as MessageEvent).data) as PetInteractionEvent;
      applyPetInteraction(
        active3d && engine3d ? engine3d : engine,
        Boolean(active3d && engine3d),
        payload,
      );
    } catch {}
  });

  es.addEventListener('gameActive', (ev) => {
    try {
      const parsed = JSON.parse((ev as MessageEvent).data) as boolean | { active?: boolean; gpuEco?: boolean };
      gameActive = typeof parsed === 'boolean' ? parsed : Boolean(parsed?.active);
      gpuEcoActive = typeof parsed === 'boolean' ? parsed : Boolean(parsed?.gpuEco) || gameActive;
      applyState();
    } catch {}
  });

  es.addEventListener('tabletActive', (ev) => {
    try {
      const parsed = JSON.parse((ev as MessageEvent).data) as boolean | { active?: boolean };
      tabletActive = typeof parsed === 'boolean' ? parsed : Boolean(parsed?.active);
      applyState();
    } catch {}
  });

  es.addEventListener('gamepad', (ev) => {
    try {
      const parsed = JSON.parse((ev as MessageEvent).data) as GamepadInputState;
      const prev = gamepadActive;
      gamepadActive = Boolean(parsed?.active);
      if (gamepadActive !== prev) applyState();
      const breedId = overrideBreed || currentSettings.catBreed || 'black';
      const activeCat = catList.find((c) => c.id === breedId) ?? catList[0];
      if (computeObsGamepadOn(activeCat)) {
        if (active3d && engine3d) engine3d.onGamepadState(parsed);
        else engine.onGamepadState(parsed);
      }
    } catch {}
  });

  es.addEventListener('input', (ev) => {
    try {
      const payload = JSON.parse((ev as MessageEvent).data) as InputEvent;
      handleInput(payload);
    } catch {}
  });
}

setupLiveModeUI();
applyState();
engine.start();

if (isLiveMode && isTauriRuntime) {
  void connectTauriLive();
} else {
  resolveTauriInit();
  connectStream();
}
