import './style.css';
import type { PadPoint } from './trackpad';
import { syncDeskOptions } from './deskOptions';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  DEFAULT_TAIL_KEY_IDS,
  KuroCatEngine,
  type KeyboardOrientation,
  type PeekEdge,
  type TailKeyMode,
} from './catEngine';
import { catAudio } from './audio';
import { AgentCompanionController, type AgentCompanionEvent } from './agentCompanion';
import { applyPetInteraction, type PetInteractionEvent } from './petInteraction';
import { DEFAULT_BUILTIN_CATS, type CatSkinConfig } from './catSkins';
import {
  getKeyboardLayout,
  isKeyboardLayoutId,
  normalizeKeyboardLayout,
  resolveKeyByVk,
  type KeyboardLayoutDef,
  type KeyboardLayoutId,
  type KeySpec,
} from './keyboardLayout';
import type { CollarColorId, KuroCatEngine3D } from './catEngine3d';
import type { HandoverStageHost } from './handoverStage';
import { TREAT_FLAVORS, type TreatFlavor, type TreatStatusSnapshot } from './treatTypes';
import {
  applyDomTranslations,
  isMacPlatform,
  isWindowsPlatform,
  localizeBreedName,
  normalizeLanguageSetting,
  setActiveLocale,
  t,
} from './i18n';

type DesktopRenderMode = '2d' | '3d';
type HeadphoneMode = 'auto' | 'on' | 'off';

interface AppSettings {
  x: number | null;
  y: number | null;
  scale: number;
  opacity?: number;
  alwaysOnTop: boolean;
  yieldOnFullscreen?: boolean;
  clickThroughLocked: boolean;
  showKeyBubbles: boolean;
  soundEnabled: boolean;
  idlePurrEnabled?: boolean;
  typingSoundEnabled?: boolean;
  soundVolume?: number;
  soundMuted?: boolean;
  expressionHotkeys?: boolean;
  pauseHotkey?: string;
  autostart: boolean;
  autostartAdmin?: boolean;
  catBreed: string;
  laoWuHandover?: boolean;
  mcpEnabled: boolean;
  mcpPort: number;
  keyboardLayout: KeyboardLayoutId;
  trackpadEnabled?: boolean;
  whiteKeyboard?: boolean;
  keyboardOrientation: KeyboardOrientation;
  privacyPasswordGuard: boolean;
  tailKeyMode: TailKeyMode;
  tailKeyIds: string[];
  obsEnabled?: boolean;
  obsPort?: number;
  obsHidePet?: boolean;
  liveCaptureEnabled?: boolean;
  liveChromaColor?: 'blue' | 'green' | 'magenta';
  liveHidePet?: boolean;
  renderMode?: DesktopRenderMode;
  collarColor?: CollarColorId;
  headphoneMode?: HeadphoneMode;
  tabletMode?: 'auto' | 'mouse' | 'tablet';
  gamepadMode?: 'auto' | 'off' | 'on';
  eyeGazeMode?: 'screen' | 'window';
  fpsCap?: number;
  language?: string;
  treatFlavor?: TreatFlavor;
  treatFedCount?: number;
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

interface WindowCursorInfo {
  relX: number;
  relY: number;
  insideWindow: boolean;
  overCat: boolean;
  altOverride?: boolean;
}

interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
  releaseUrl: string;
  assetName: string | null;
  downloadUrl: string | null;
  assetSha256: string | null;
  assetSize: number | null;
  installKind: string;
  notesSummary: string;
}

interface UpdateProgressEvent {
  stage: string;
  message: string;
  info: UpdateInfo | null;
}

const DISMISSED_UPDATE_STORAGE_KEY = 'kurocat_dismissed_update_version';

function loadDismissedVersion(): string | null {
  try {
    const saved = window.localStorage.getItem(DISMISSED_UPDATE_STORAGE_KEY);
    return saved && saved.trim() ? saved.trim() : null;
  } catch {
    return null;
  }
}

function saveDismissedVersion(version: string): void {
  try {
    window.localStorage.setItem(DISMISSED_UPDATE_STORAGE_KEY, version);
  } catch {
    // Ignore storage quota/sandbox errors
  }
}

let appVersion = '5.1.5';
let latestUpdateInfo: UpdateInfo | null = null;
let updateBusy = false;
let dismissedVersion: string | null = loadDismissedVersion();
let currentToastKind: 'update' | 'admin' | 'transient' | null = null;
let toastAutoHideTimer: number | null = null;
const ADMIN_HINT_DISMISSED_KEY = 'kurocat_admin_game_hint_dismissed';
let adminHintShownThisSession = false;
let sliderDragging = false;
let opacitySliderDragging = false;
let volumeSliderDragging = false;
let altOverride = false;
let lastKnownLockState: boolean | null = null;
let syncWin7OverlayFn: ((focusMenu?: boolean) => void) | null = null;
let tailPickerOpen = false;
let tailPickerLoading = false;
let tailPickerSaving = false;
let tailPickerSelection = new Set<string>();
let tailPickerStatusOverride: string | null = null;
let resolvedBackendLocale: string | null = null;
const ARROW_KEY_IDS = new Set(['up', 'down', 'left', 'right']);

let settings: AppSettings = {
  x: null,
  y: null,
  scale: 1,
  opacity: 1,
  alwaysOnTop: true,
  yieldOnFullscreen: false,
  clickThroughLocked: false,
  showKeyBubbles: true,
  soundEnabled: true,
  idlePurrEnabled: false,
  typingSoundEnabled: false,
  soundVolume: 1,
  soundMuted: false,
  expressionHotkeys: true,
  pauseHotkey: 'Alt+Shift+P',
  autostart: false,
  autostartAdmin: false,
  catBreed: 'black',
  laoWuHandover: true,
  mcpEnabled: true,
  mcpPort: 27420,
  keyboardLayout: isMacPlatform() ? 'macbook' : '65',
  trackpadEnabled: false,
  whiteKeyboard: false,
  keyboardOrientation: 'cat',
  privacyPasswordGuard: true,
  tailKeyMode: 'smart',
  tailKeyIds: [...DEFAULT_TAIL_KEY_IDS],
  liveCaptureEnabled: false,
  liveChromaColor: 'blue',
  liveHidePet: false,
  renderMode: '3d',
  collarColor: 'none',
  headphoneMode: 'off',
  tabletMode: 'auto',
  gamepadMode: 'auto',
  eyeGazeMode: 'screen',
  fpsCap: 0,
  language: 'auto',
  treatFlavor: 'tuna',
  treatFedCount: 0,
};

let catList: CatSkinConfig[] = [...DEFAULT_BUILTIN_CATS];

const canvas = document.getElementById('pet-canvas') as HTMLCanvasElement;
let canvas3d = document.getElementById('pet-canvas-3d') as HTMLCanvasElement;
let canvas3dMouseDownListener: ((e: MouseEvent) => void) | null = null;
let canvas3dMouseMoveListener: ((e: MouseEvent) => void) | null = null;
let canvas3dMouseLeaveListener: (() => void) | null = null;
let canvas3dContextMenuListener: ((e: MouseEvent) => void) | null = null;
let canvas3dDblClickListener: (() => void) | null = null;
let canvas3dDirty = false;
let settingsPatchSeq = 0;
const menuEl = document.getElementById('context-menu') as HTMLDivElement;
const breedPillsEl = document.getElementById('breed-pills') as HTMLDivElement;
const scaleSliderEl = document.getElementById('scale-slider') as HTMLInputElement;
const scaleValueEl = document.getElementById('scale-value') as HTMLButtonElement;
const opacitySliderEl = document.getElementById('opacity-slider') as HTMLInputElement | null;
const opacityValueEl = document.getElementById('opacity-value') as HTMLButtonElement | null;
const volumeSliderEl = document.getElementById('volume-slider') as HTMLInputElement | null;
const volumeValueEl = document.getElementById('volume-value') as HTMLButtonElement | null;
const btnVolumeMuteEl = document.getElementById('btn-volume-mute') as HTMLButtonElement | null;
const updateToastEl = document.getElementById('update-toast') as HTMLDivElement;
const updateToastTextEl = document.getElementById('update-toast-text') as HTMLSpanElement;
const btnToastInstallEl = document.getElementById('btn-toast-install') as HTMLButtonElement;
const btnToastUnlockEl = document.getElementById('btn-toast-unlock') as HTMLButtonElement;
const btnToastAdminEl = document.getElementById('btn-toast-admin') as HTMLButtonElement | null;
const btnToastOpenEl = document.getElementById('btn-toast-open') as HTMLButtonElement;
const btnToastCloseEl = document.getElementById('btn-toast-close') as HTMLButtonElement;
const tailPickerBarEl = document.getElementById('tail-picker-bar') as HTMLDivElement;
const tailPickerTitleEl = document.getElementById('tail-picker-title') as HTMLSpanElement;
const tailPresetButtons = tailPickerBarEl.querySelectorAll<HTMLButtonElement>('.tail-picker-presets [data-tailpreset]');
const btnTailDoneEl = document.getElementById('btn-tail-done') as HTMLButtonElement;
const btnTailCancelEl = document.getElementById('btn-tail-cancel') as HTMLButtonElement;
const tailModeBadgeEl = document.getElementById('tail-mode-badge') as HTMLSpanElement;
const tailKeysCountEl = document.getElementById('tail-keys-count') as HTMLSpanElement;
const agentBubbleEl = document.getElementById('agent-bubble') as HTMLDivElement | null;
const treatHudPillEl = document.getElementById('treat-hud-pill') as HTMLDivElement | null;
const treatHudDotEl = document.getElementById('treat-hud-dot') as HTMLSpanElement | null;
const treatHudTextEl = document.getElementById('treat-hud-text') as HTMLSpanElement | null;
const treatHudBarFillEl = document.getElementById('treat-hud-bar-fill') as HTMLSpanElement | null;
const engine = new KuroCatEngine(canvas);
const isTauriRuntime = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
const stageHost: HandoverStageHost | undefined =
  isTauriRuntime && isWindowsPlatform()
    ? {
        begin: (stageId) => invoke('begin_handover_stage', { stageId }),
        end: (stageId) => invoke('end_handover_stage', { stageId }),
      }
    : undefined;
let appliedCatId: string | null = null;
let appliedCatSkin: CatSkinConfig | null = null;
engine.onDeepSleep = () => {
  void invoke('trim_idle_memory').catch(() => {});
};

let lastPetSyncAt = 0;
let lastDragVelSyncAt = 0;
function syncPetInteractionToLive(ev: PetInteractionEvent): void {
  const now = performance.now();
  if (ev.kind === 'pet') {
    if (now - lastPetSyncAt < 140) return;
    lastPetSyncAt = now;
  } else if (ev.kind === 'drag' && (typeof ev.vx === 'number' || typeof ev.vy === 'number')) {
    if (now - lastDragVelSyncAt < 45) return;
    lastDragVelSyncAt = now;
  }
  void invoke('broadcast_pet_interaction', { payload: ev, excludeMain: true }).catch(() => {});
}
engine.onInteractionSync = syncPetInteractionToLive;

let treatModeActive = false;
let treatActiveFlavor: TreatFlavor = 'tuna';
let treatPointerDown = false;
let lastTreatClientX = 0;
let lastTreatClientY = 0;
let lastTreatDomMoveAt = 0;
let lastTreatFedCount2d = 0;
let lastTreatFedCount3d = 0;
let suppressTreatEndSync = false;

function normalizeTreatFlavor(raw: string | undefined): TreatFlavor {
  if (raw === 'chicken' || raw === 'salmon' || raw === 'bonito') return raw;
  return 'tuna';
}

function getActiveTreatEngine(): KuroCatEngine | KuroCatEngine3D {
  return active3d && engine3d ? engine3d : engine;
}

function renderTreatHud(st: TreatStatusSnapshot): void {
  if (!treatHudPillEl) return;
  if (!st.active) {
    if (!treatHudPillEl.classList.contains('hidden')) {
      treatHudPillEl.classList.add('hidden');
      syncWin7OverlayFn?.(false);
    }
    return;
  }

  const spec = TREAT_FLAVORS[st.flavor] ?? TREAT_FLAVORS.tuna;
  const pct = Math.round(Math.max(0, Math.min(1, st.amount)) * 100);
  if (treatHudDotEl) {
    treatHudDotEl.style.background = spec.tubePrimary;
  }
  if (treatHudBarFillEl) {
    treatHudBarFillEl.style.width = `${pct}%`;
    treatHudBarFillEl.style.background = `linear-gradient(90deg, ${spec.tubePrimary}, ${spec.pureeColor})`;
  }
  if (treatHudTextEl) {
    const compact = window.innerWidth < 250;
    if (st.phase === 'licking') {
      treatHudTextEl.textContent = compact ? `😋 ${pct}%` : t('toast.treat_hint_licking', { pct });
    } else if (st.phase === 'impatient') {
      treatHudTextEl.textContent = compact ? '💢' : t('toast.treat_hint_impatient');
    } else if (st.phase === 'afterglow') {
      treatHudTextEl.textContent = compact ? '✨ 💛' : t('toast.treat_hint_afterglow');
    } else {
      treatHudTextEl.textContent = compact ? `${spec.icon} ${pct}%` : t('toast.treat_hint_track');
    }
  }
  treatHudPillEl.dataset.phase = st.phase;
  const wasHidden = treatHudPillEl.classList.contains('hidden');
  treatHudPillEl.classList.remove('hidden');
  if (wasHidden) {
    requestAnimationFrame(() => syncWin7OverlayFn?.(false));
  }
}

function cleanupTreatModeDesktop(stopEngines: boolean): void {
  const wasActive = treatModeActive;
  treatModeActive = false;
  treatPointerDown = false;
  canvas.classList.remove('treat-mode');
  canvas3d.classList.remove('treat-mode');
  if (stopEngines) {
    suppressTreatEndSync = true;
    engine.stopTreatMode();
    engine3d?.stopTreatMode();
    suppressTreatEndSync = false;
  }
  if (treatHudPillEl && !treatHudPillEl.classList.contains('hidden')) {
    treatHudPillEl.classList.add('hidden');
  }
  if (wasActive || stopEngines) {
    void invoke('set_treat_active', { active: false }).catch(() => {});
  }
  syncWin7OverlayFn?.(false);
}

function handleTreatEngineUpdate(source: '2d' | '3d', st: TreatStatusSnapshot): void {
  if (source === '2d' && st.fedCount > lastTreatFedCount2d) {
    lastTreatFedCount2d = st.fedCount;
    void invoke('record_treat_fed', { flavor: st.flavor }).catch(() => {});
  } else if (source === '3d' && st.fedCount > lastTreatFedCount3d) {
    lastTreatFedCount3d = st.fedCount;
    void invoke('record_treat_fed', { flavor: st.flavor }).catch(() => {});
  }

  const activeSource: '2d' | '3d' = active3d && engine3d ? '3d' : '2d';
  if (source !== activeSource) return;

  treatActiveFlavor = st.flavor;
  if (!st.active) {
    if (suppressTreatEndSync) return;
    if (treatModeActive) {
      cleanupTreatModeDesktop(false);
    } else {
      renderTreatHud(st);
    }
    return;
  }
  renderTreatHud(st);
}

function startTreatModeDesktop(flavor?: string): void {
  if (privacyActive || settings.catBreed === 'dafeiyu') {
    void invoke('set_treat_active', { active: false }).catch(() => {});
    return;
  }
  closeContextMenu();
  if (tailPickerOpen) closeTailPicker();
  if (engine.getPeekEdge() !== 'none' || (engine3d?.getPeekEdge() ?? 'none') !== 'none') {
    engine.setPeekEdge('none');
    engine3d?.setPeekEdge('none');
    void invoke('set_peek_edge', { edge: 'none' }).catch(() => {});
  }

  const resolved = normalizeTreatFlavor(flavor ?? settings.treatFlavor);
  treatActiveFlavor = resolved;
  treatModeActive = true;
  treatPointerDown = false;
  lastTreatDomMoveAt = 0;
  canvas.classList.add('treat-mode');
  canvas3d.classList.add('treat-mode');
  void invoke('set_treat_active', { active: true }).catch(() => {});

  suppressTreatEndSync = true;
  if (active3d && engine3d) {
    engine.stopTreatMode();
    engine3d.startTreatMode(resolved);
  } else {
    engine3d?.stopTreatMode();
    engine.startTreatMode(resolved);
  }
  suppressTreatEndSync = false;
  renderTreatHud(getActiveTreatEngine().getTreatStatus());
}

engine.onTreatUpdate = (st) => handleTreatEngineUpdate('2d', st);

// Lazy-loaded Three.js 3D engine (NEVER imported when user stays in 2D mode -> +0 MB overhead!)
let engine3d: KuroCatEngine3D | null = null;
let loading3dPromise: Promise<void> | null = null;
let dispose3dTimer: number | null = null;
const IDLE_3D_DISPOSE_MS = 8000;
let webgl3dUnavailable = false;
let isWin7Ulw = false;
let lastPadPoints: readonly PadPoint[] = [];
let padUnavailable = false;
let active3d = false;
let privacyActive = false;
let gameActive = false;
let gpuEcoActive = false;
let tabletActive = false;
let gamepadActive = false;

const agentCompanion = new AgentCompanionController({
  bubbleEl: agentBubbleEl,
  getTarget: () => (active3d && engine3d ? engine3d : engine),
  is3DTarget: () => Boolean(active3d && engine3d),
  allowSound: () =>
    settings.soundEnabled !== false &&
    !settings.soundMuted &&
    normalizeVolume(settings.soundVolume) > 0.001,
});

window.addEventListener('resize', () => engine3d?.resize());
window.addEventListener('pagehide', () => engine3d?.cancelHandover());

function bindCanvas3dListeners(el: HTMLCanvasElement): void {
  if (canvas3dMouseDownListener) {
    el.addEventListener('mousedown', canvas3dMouseDownListener);
  }
  if (canvas3dMouseMoveListener) {
    el.addEventListener('mousemove', canvas3dMouseMoveListener);
  }
  if (canvas3dMouseLeaveListener) {
    el.addEventListener('mouseleave', canvas3dMouseLeaveListener);
  }
  if (canvas3dContextMenuListener) {
    el.addEventListener('contextmenu', canvas3dContextMenuListener);
  }
  if (canvas3dDblClickListener) {
    el.addEventListener('dblclick', canvas3dDblClickListener);
  }
  el.addEventListener('webglcontextlost', (ev) => {
    ev.preventDefault();
    if (el !== canvas3d) return;
    canvas3dDirty = true;
    if (engine3d) {
      const dead = engine3d;
      engine3d = null;
      dead.stop();
      if (active3d) {
        active3d = false;
        canvas3d.classList.add('hidden');
        canvas.classList.remove('hidden');
        engine.resize();
        engine.start();
      }
      window.setTimeout(() => {
        if (wants3DNow() && !engine3d && !loading3dPromise) {
          activateRenderEngine();
        }
      }, 300);
    }
  });
}

function replaceCanvas3d(): HTMLCanvasElement {
  const old = canvas3d;
  if (canvas3dMouseDownListener) {
    old.removeEventListener('mousedown', canvas3dMouseDownListener);
  }
  if (canvas3dContextMenuListener) {
    old.removeEventListener('contextmenu', canvas3dContextMenuListener);
  }
  if (canvas3dDblClickListener) {
    old.removeEventListener('dblclick', canvas3dDblClickListener);
  }
  const fresh = document.createElement('canvas');
  fresh.id = 'pet-canvas-3d';
  fresh.className = old.className;
  fresh.style.opacity = old.style.opacity;
  fresh.classList.remove('pet-hover', 'pet-dragging');
  old.replaceWith(fresh);
  canvas3d = fresh;
  canvas3dDirty = false;
  bindCanvas3dListeners(fresh);
  return fresh;
}

function disposeEngine3D(): void {
  if (!engine3d) return;
  const old = engine3d;
  engine3d = null;
  active3d = false;
  old.dispose();
  // Calling forceContextLoss() permanently loses the old <canvas>'s WebGL context per spec;
  // immediately swap in a brand-new <canvas id="pet-canvas-3d"> so switching back to 3D
  // always acquires a fresh WebGL2 context while the old canvas & GPU buffers are GC'd.
  replaceCanvas3d();
  canvas3d.classList.add('hidden');
}

function cancelPending3dDispose(): void {
  if (dispose3dTimer !== null) {
    window.clearTimeout(dispose3dTimer);
    dispose3dTimer = null;
  }
}

function schedule3dDisposeIf2D(): void {
  cancelPending3dDispose();
  if (!engine3d || active3d || tailPickerOpen || wants3DNow()) return;
  dispose3dTimer = window.setTimeout(() => {
    dispose3dTimer = null;
    if (engine3d && !active3d && !tailPickerOpen && !wants3DNow()) {
      disposeEngine3D();
      void invoke('trim_idle_memory').catch(() => {});
    }
  }, IDLE_3D_DISPOSE_MS);
}

function shouldWearHeadphonesNow(): boolean {
  if (settings.catBreed === 'dafeiyu') return false;
  const hm: HeadphoneMode =
    settings.headphoneMode === 'auto' || settings.headphoneMode === 'on'
      ? settings.headphoneMode
      : 'off';
  if (hm === 'on') return true;
  if (hm === 'off') return false;
  return gameActive || gamepadActive;
}

function shouldUseTabletNow(): boolean {
  if (settings.catBreed === 'dafeiyu') return false;
  const tm =
    settings.tabletMode === 'mouse' || settings.tabletMode === 'tablet'
      ? settings.tabletMode
      : 'auto';
  if (tm === 'tablet') return true;
  if (tm === 'mouse') return false;
  return tabletActive;
}

function shouldUseGamepadNow(): boolean {
  if (settings.catBreed === 'dafeiyu') return false;
  const gm =
    settings.gamepadMode === 'off' || settings.gamepadMode === 'on'
      ? settings.gamepadMode
      : 'auto';
  if (gm === 'on') return true;
  if (gm === 'off') return false;
  return gamepadActive;
}

function wants3DNow(): boolean {
  return (
    settings.renderMode !== '2d' &&
    settings.catBreed !== 'dafeiyu' &&
    !tailPickerOpen &&
    !isWin7Ulw &&
    !webgl3dUnavailable
  );
}

function syncEngine3DState(): void {
  if (!engine3d) return;
  const activeCat = catList.find((c) => c.id === settings.catBreed) ?? catList[0];
  const kbLayout: KeyboardLayoutId = normalizeKeyboardLayout(settings.keyboardLayout);
  const kbOrient: KeyboardOrientation = settings.keyboardOrientation === 'viewer' ? 'viewer' : 'cat';
  const tailMode: TailKeyMode =
    settings.tailKeyMode === 'custom' ||
    settings.tailKeyMode === 'edge' ||
    settings.tailKeyMode === 'off'
      ? settings.tailKeyMode
      : 'smart';
  const tailIds = Array.isArray(settings.tailKeyIds) ? settings.tailKeyIds : [...DEFAULT_TAIL_KEY_IDS];
  const collar: CollarColorId =
    settings.collarColor === 'red' ||
    settings.collarColor === 'blue' ||
    settings.collarColor === 'pink' ||
    settings.collarColor === 'green'
      ? settings.collarColor
      : 'none';

  engine3d.showKeyBubbles = settings.showKeyBubbles;
  engine3d.setRenderStyle('3d');
  if (activeCat && !engine3d.isHandoverActive()) {
    engine3d.setCatSkin(activeCat);
  }
  engine3d.setCollar(activeCat?.id === 'dafeiyu' ? 'none' : collar);
  engine3d.setHeadphones(shouldWearHeadphonesNow());
  engine3d.setTabletActive(shouldUseTabletNow());
  engine3d.setGamepadActive(shouldUseGamepadNow());
  engine3d.setGameActive(gameActive || gpuEcoActive);
  if (!settings.trackpadEnabled) lastPadPoints = [];
  engine3d.setTrackpad(settings.trackpadEnabled === true);
  engine3d.onTrackpad(lastPadPoints);
  engine3d.setKeyboardConfig(kbLayout, kbOrient, settings.whiteKeyboard === true);
  engine3d.setTailKeyConfig(tailMode, tailIds);
  engine3d.setPrivacyMode(privacyActive);
  engine3d.setEyeGazeMode(settings.eyeGazeMode === 'window' ? 'window' : 'screen');
  engine3d.setFpsCap(settings.fpsCap === 30 ? 30 : 0);
  engine3d.setPeekEdge(engine.getPeekEdge());
  engine3d.resize();
}

function activateRenderEngine(): void {
  const want3d = wants3DNow();
  if (!want3d) {
    if (active3d) {
      if (treatModeActive) {
        suppressTreatEndSync = true;
        engine3d?.stopTreatMode();
        suppressTreatEndSync = false;
      }
      engine3d?.stop();
      canvas3d.classList.add('hidden');
      canvas.classList.remove('hidden');
      engine.resize();
      engine.start();
      active3d = false;
      if (treatModeActive) {
        suppressTreatEndSync = true;
        engine.startTreatMode(treatActiveFlavor);
        suppressTreatEndSync = false;
        renderTreatHud(engine.getTreatStatus());
      }
    }
    schedule3dDisposeIf2D();
    return;
  }

  cancelPending3dDispose();

  if (engine3d && engine3d.isContextLost()) {
    disposeEngine3D();
  }

  if (engine3d) {
    syncEngine3DState();
    if (!active3d) {
      if (treatModeActive) {
        suppressTreatEndSync = true;
        engine.stopTreatMode();
        suppressTreatEndSync = false;
      }
      engine.stop();
      engine.releaseCachedResources();
      canvas.width = 1;
      canvas.height = 1;
      canvas.classList.add('hidden');
      canvas3d.classList.remove('hidden');
      engine3d.resize();
      engine3d.start();
      active3d = true;
      if (treatModeActive) {
        suppressTreatEndSync = true;
        engine3d.startTreatMode(treatActiveFlavor);
        suppressTreatEndSync = false;
        renderTreatHud(engine3d.getTreatStatus());
      }
    }
    return;
  }

  if (!loading3dPromise) {
    if (canvas3dDirty) {
      replaceCanvas3d();
    }
    loading3dPromise = import('./catEngine3d')
      .then(({ KuroCatEngine3D }) => {
        if (canvas3dDirty) {
          replaceCanvas3d();
        }
        const created = new KuroCatEngine3D(canvas3d, { embedded: false, stageHost });
        if (created.isContextLost()) {
          created.dispose();
          replaceCanvas3d();
          throw new Error('WebGL context lost immediately after creation');
        }
        engine3d = created;
        lastTreatFedCount3d = 0;
        engine3d.onDeepSleep = () => {
          void invoke('trim_idle_memory').catch(() => {});
        };
        engine3d.onInteractionSync = syncPetInteractionToLive;
        engine3d.onTreatUpdate = (st) => handleTreatEngineUpdate('3d', st);
        activateRenderEngine();
      })
      .catch((err) => {
        console.warn('3D WebGL unavailable, keeping 2D mode:', err);
        webgl3dUnavailable = true;
        active3d = false;
        replaceCanvas3d();
        canvas3d.classList.add('hidden');
        canvas.classList.remove('hidden');
        engine.resize();
        engine.start();
      })
      .finally(() => {
        loading3dPromise = null;
      });
  }
}

function formatBreedPillLabel(cat: CatSkinConfig): string {
  const displayName = localizeBreedName(cat.id, cat.name, cat.builtin);
  if (cat.emoji) {
    return displayName.startsWith(cat.emoji) ? displayName : `${cat.emoji} ${displayName}`;
  }
  return `🐱 ${displayName}`;
}

function formatHeaderCatName(cat: CatSkinConfig): string {
  const emoji = cat.emoji || '🐱';
  const displayName = localizeBreedName(cat.id, cat.name, cat.builtin);
  const bareName =
    cat.emoji && displayName.startsWith(cat.emoji)
      ? displayName.slice(cat.emoji.length).trimStart()
      : displayName;
  return `${emoji} KuroCat ${bareName}`;
}

function renderBreedPills(): void {
  if (!breedPillsEl) return;
  breedPillsEl.innerHTML = '';
  for (const cat of catList) {
    const btn = document.createElement('button');
    btn.className = 'breed-pill';
    btn.dataset.breed = cat.id;
    const label = formatBreedPillLabel(cat);
    btn.textContent = label;
    btn.title = label;
    const accent = cat.accentColor || (cat.id === 'ragdoll' ? '#7ac7ff' : '#c8f538');
    btn.style.setProperty('--pill-accent', accent);
    btn.classList.toggle('active', cat.id === settings.catBreed);
    breedPillsEl.appendChild(btn);
  }
}

function updateScaleSliderVisual(scaleVal: number): void {
  const pctNum = Math.round(Math.max(20, Math.min(150, scaleVal * 100)));
  if (scaleSliderEl) {
    scaleSliderEl.value = String(pctNum);
    const fillPct = ((pctNum - 20) / (150 - 20)) * 100;
    scaleSliderEl.style.setProperty('--pct', `${fillPct.toFixed(1)}%`);
  }
  if (scaleValueEl) {
    scaleValueEl.textContent = `${pctNum}%`;
  }
}

function normalizeOpacity(opacityVal: number | undefined): number {
  if (typeof opacityVal !== 'number' || !Number.isFinite(opacityVal)) return 1;
  const normalized = opacityVal >= 10 && opacityVal <= 100 ? opacityVal / 100 : opacityVal;
  return Math.max(0.2, Math.min(1, normalized));
}

function updateOpacitySliderVisual(opacityVal: number | undefined): void {
  const pctNum = Math.round(normalizeOpacity(opacityVal) * 100);
  if (opacitySliderEl) {
    opacitySliderEl.value = String(pctNum);
    const fillPct = ((pctNum - 20) / (100 - 20)) * 100;
    opacitySliderEl.style.setProperty('--pct', `${fillPct.toFixed(1)}%`);
  }
  if (opacityValueEl) {
    opacityValueEl.textContent = `${pctNum}%`;
  }
}

function normalizeVolume(volumeVal: number | undefined): number {
  if (typeof volumeVal !== 'number' || !Number.isFinite(volumeVal)) return 1;
  const normalized = volumeVal >= 10 && volumeVal <= 100 ? volumeVal / 100 : volumeVal;
  return Math.max(0, Math.min(1, normalized));
}

function updateVolumeSliderVisual(volumeVal: number | undefined, mutedFlag: boolean | undefined): void {
  const norm = normalizeVolume(volumeVal);
  const pctNum = Math.round(norm * 100);
  const effectivelyMuted = Boolean(mutedFlag) || pctNum === 0;
  if (volumeSliderEl) {
    volumeSliderEl.value = String(pctNum);
    volumeSliderEl.style.setProperty('--pct', `${pctNum}%`);
    volumeSliderEl.classList.toggle('is-muted', effectivelyMuted);
  }
  if (volumeValueEl) {
    volumeValueEl.textContent = effectivelyMuted ? t('menu.muted_short') : `${pctNum}%`;
    volumeValueEl.classList.toggle('is-muted', effectivelyMuted);
  }
  if (btnVolumeMuteEl) {
    btnVolumeMuteEl.classList.toggle('is-muted', effectivelyMuted);
    btnVolumeMuteEl.setAttribute('aria-pressed', effectivelyMuted ? 'true' : 'false');
  }
}

function applyPetOpacity(opacityVal: number | undefined): void {
  const clamped = normalizeOpacity(opacityVal);
  // On Win7/8 ULW mode, transparency is composited natively via UpdateLayeredWindow
  // SourceConstantAlpha, so keep the offscreen 2D canvas opaque to preserve alpha precision.
  const cssOpacity = isWin7Ulw ? '1' : clamped.toFixed(3);
  canvas.style.opacity = cssOpacity;
  canvas3d.style.opacity = cssOpacity;
}

let adminStatus: { supported: boolean; elevated: boolean } = { supported: false, elevated: false };

function syncMenuUI(): void {
  setActiveLocale(settings.language, resolvedBackendLocale);
  applyDomTranslations();

  const btnRestartAdmin = document.getElementById('btn-restart-admin') as HTMLButtonElement | null;
  const adminRestartLabel = document.getElementById('admin-restart-label');
  const adminText = t(adminStatus.elevated ? 'menu.admin_ready' : 'menu.admin_restart');
  if (btnRestartAdmin) {
    btnRestartAdmin.classList.toggle('hidden', !adminStatus.supported);
    btnRestartAdmin.disabled = adminStatus.elevated;
  }
  if (adminRestartLabel) {
    adminRestartLabel.textContent = adminText;
  }

  const setCheck = (id: string, on: boolean) => {
    const el = document.getElementById(id);
    if (el) el.textContent = on ? '✓' : '';
  };
  setCheck('chk-privacy', settings.privacyPasswordGuard !== false);
  setCheck('chk-bubbles', settings.showKeyBubbles);
  setCheck('chk-lock', settings.clickThroughLocked);
  setCheck('chk-sound', settings.soundEnabled);
  setCheck('chk-idle-purr', Boolean(settings.idlePurrEnabled));
  setCheck('chk-typing-sound', Boolean(settings.typingSoundEnabled));
  document
    .getElementById('chk-switch-animation')
    ?.setAttribute('aria-checked', String(settings.laoWuHandover !== false));
  setCheck('chk-mute', Boolean(settings.soundMuted) || normalizeVolume(settings.soundVolume) <= 0.001);
  setCheck('chk-top', settings.alwaysOnTop);
  setCheck('chk-yield-fullscreen', Boolean(settings.yieldOnFullscreen));
  setCheck('chk-autostart', settings.autostart);
  setCheck('chk-autostart-admin', Boolean(settings.autostart && settings.autostartAdmin));
  const btnAutostartAdmin = document.getElementById('btn-autostart-admin') as HTMLButtonElement | null;
  if (btnAutostartAdmin) {
    btnAutostartAdmin.classList.toggle('hidden', !adminStatus.supported);
  }
  setCheck('chk-mcp', settings.mcpEnabled);

  if (!sliderDragging) {
    updateScaleSliderVisual(settings.scale);
  }
  if (!opacitySliderDragging) {
    updateOpacitySliderVisual(settings.opacity);
    applyPetOpacity(settings.opacity);
  }
  if (!volumeSliderDragging) {
    updateVolumeSliderVisual(settings.soundVolume, settings.soundMuted);
  }

  const kbLayout: KeyboardLayoutId = normalizeKeyboardLayout(settings.keyboardLayout);
  const kbOrient: KeyboardOrientation = settings.keyboardOrientation === 'viewer' ? 'viewer' : 'cat';
  const tailMode: TailKeyMode =
    settings.tailKeyMode === 'custom' ||
    settings.tailKeyMode === 'edge' ||
    settings.tailKeyMode === 'off'
      ? settings.tailKeyMode
      : 'smart';
  const tailIds = Array.isArray(settings.tailKeyIds) ? settings.tailKeyIds : [...DEFAULT_TAIL_KEY_IDS];

  syncDeskOptions(settings, isMacPlatform(), padUnavailable);
  document.querySelectorAll<HTMLButtonElement>('[data-kblayout]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.kblayout === kbLayout);
  });
  document.querySelectorAll<HTMLButtonElement>('[data-kborient]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.kborient === kbOrient);
  });
  document.querySelectorAll<HTMLButtonElement>('[data-tailmode]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tailmode === tailMode);
  });
  const fpsCapStr = settings.fpsCap === 30 ? '30' : '0';
  document.querySelectorAll<HTMLButtonElement>('[data-fpscap]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.fpscap === fpsCapStr);
  });
  const langSetting = normalizeLanguageSetting(settings.language);
  document.querySelectorAll<HTMLButtonElement>('[data-lang]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.lang === langSetting);
  });
  if (tailModeBadgeEl) {
    tailModeBadgeEl.textContent = t(`menu.tail_badge_${tailMode}`);
  }
  if (tailKeysCountEl) {
    tailKeysCountEl.textContent = t('menu.tail_keys_count', { count: tailIds.length });
  }
  const activeCat = catList.find((c) => c.id === settings.catBreed) ?? catList[0];
  renderBreedPills();

  const renderMode: DesktopRenderMode = settings.renderMode === '2d' ? '2d' : '3d';
  const collarColor: CollarColorId =
    settings.collarColor === 'red' ||
    settings.collarColor === 'blue' ||
    settings.collarColor === 'pink' ||
    settings.collarColor === 'green'
      ? settings.collarColor
      : 'none';
  document.querySelectorAll<HTMLButtonElement>('[data-rendermode]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.rendermode === renderMode);
  });
  document.querySelectorAll<HTMLButtonElement>('[data-collar]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.collar === collarColor);
  });
  const isDafeiyu = settings.catBreed === 'dafeiyu';
  if (isDafeiyu && treatModeActive) {
    cleanupTreatModeDesktop(true);
  }
  const legacyTreatBtnEl = document.getElementById('btn-legacy-feed-treat');
  if (legacyTreatBtnEl) {
    legacyTreatBtnEl.classList.toggle('hidden', isDafeiyu);
  }
  const renderModeRowEl = document.getElementById('render-mode-row');
  if (renderModeRowEl) {
    renderModeRowEl.classList.toggle('hidden', isDafeiyu);
  }
  const collarRowEl = document.getElementById('collar-row');
  if (collarRowEl) {
    collarRowEl.classList.toggle('hidden', renderMode === '2d' || isDafeiyu);
  }

  const headphoneMode: HeadphoneMode =
    settings.headphoneMode === 'auto' || settings.headphoneMode === 'on'
      ? settings.headphoneMode
      : 'off';
  document.querySelectorAll<HTMLButtonElement>('[data-headphonemode]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.headphonemode === headphoneMode);
  });
  const headphoneRowEl = document.getElementById('headphone-row');
  if (headphoneRowEl) {
    headphoneRowEl.classList.toggle('hidden', settings.catBreed === 'dafeiyu');
  }

  const tabletMode =
    settings.tabletMode === 'mouse' || settings.tabletMode === 'tablet'
      ? settings.tabletMode
      : 'auto';
  document.querySelectorAll<HTMLButtonElement>('[data-tabletmode]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tabletmode === tabletMode);
  });
  const tabletRowEl = document.getElementById('tablet-row');
  if (tabletRowEl) {
    tabletRowEl.classList.toggle('hidden', settings.catBreed === 'dafeiyu');
  }

  const gamepadMode =
    settings.gamepadMode === 'off' || settings.gamepadMode === 'on'
      ? settings.gamepadMode
      : 'auto';
  document.querySelectorAll<HTMLButtonElement>('[data-gamepadmode]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.gamepadmode === gamepadMode);
  });

  const eyeGazeMode: 'screen' | 'window' = settings.eyeGazeMode === 'window' ? 'window' : 'screen';
  document.querySelectorAll<HTMLButtonElement>('[data-eyegazemode]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.eyegazemode === eyeGazeMode);
  });
  const eyeGazeRowEl = document.getElementById('eye-gaze-row');
  if (eyeGazeRowEl) {
    eyeGazeRowEl.classList.toggle('hidden', settings.catBreed === 'dafeiyu');
  }
  const gamepadRowEl = document.getElementById('gamepad-row');
  if (gamepadRowEl) {
    gamepadRowEl.classList.toggle('hidden', settings.catBreed === 'dafeiyu');
  }

  const headerEl = document.getElementById('menu-header');
  if (headerEl && activeCat) {
    headerEl.textContent = formatHeaderCatName(activeCat);
    headerEl.style.color = activeCat.accentColor || '#c8f538';
  }

  const updateLabelEl = document.getElementById('update-btn-label');
  if (updateLabelEl) {
    updateLabelEl.textContent = t('menu.check_update', { ver: appVersion }).replace(/\s*v[\d.]+$/i, '');
  }

  const fpsCapNum = settings.fpsCap === 30 ? 30 : 0;
  engine.showKeyBubbles = settings.showKeyBubbles;
  const nextCatId = activeCat?.id || 'black';
  const prevCatId = appliedCatId;
  const prevCatSkin = appliedCatSkin;
  const breedChanged = prevCatId !== null && prevCatId !== nextCatId;
  const draggingNow =
    canvas.classList.contains('pet-dragging') || canvas3d.classList.contains('pet-dragging');
  const peekingNow =
    engine.getPeekEdge() !== 'none' || (engine3d?.getPeekEdge() ?? 'none') !== 'none';
  const allowHandover =
    settings.laoWuHandover !== false &&
    !privacyActive &&
    !tailPickerOpen &&
    !treatModeActive &&
    !draggingNow &&
    !peekingNow;

  engine.setCatAppearance(nextCatId, activeCat);
  if (!allowHandover || !wants3DNow()) {
    engine3d?.cancelHandover();
  } else if (
    breedChanged &&
    active3d &&
    engine3d &&
    !engine3d.isContextLost() &&
    prevCatId !== 'dafeiyu' &&
    activeCat
  ) {
    engine3d.transitionToSkin(activeCat, prevCatSkin ?? undefined);
  }
  appliedCatId = nextCatId;
  appliedCatSkin = activeCat ? { ...activeCat } : null;

  engine.setHeadphones(shouldWearHeadphonesNow());
  engine.setTabletActive(shouldUseTabletNow());
  engine3d?.setTabletActive(shouldUseTabletNow());
  engine.setGamepadActive(shouldUseGamepadNow());
  engine3d?.setGamepadActive(shouldUseGamepadNow());
  if (!settings.trackpadEnabled) lastPadPoints = [];
  engine.setTrackpad(settings.trackpadEnabled === true);
  engine.onTrackpad(lastPadPoints);
  engine.setKeyboardConfig(kbLayout, kbOrient, settings.whiteKeyboard === true);
  engine.setTailKeyConfig(tailMode, tailIds);
  engine.setEyeGazeMode(eyeGazeMode);
  engine3d?.setEyeGazeMode(eyeGazeMode);
  engine.setFpsCap(fpsCapNum);
  engine3d?.setFpsCap(fpsCapNum);
  if (!sliderDragging) {
    engine.setRenderScale(settings.scale);
  }
  catAudio.setMasterVolume(normalizeVolume(settings.soundVolume));
  catAudio.setMuted(Boolean(settings.soundMuted));
  catAudio.setEnabled(settings.soundEnabled);
  catAudio.setIdlePurrEnabled(Boolean(settings.idlePurrEnabled));
  catAudio.setTypingSoundEnabled(Boolean(settings.typingSoundEnabled));
  activateRenderEngine();
  if (tailPickerOpen) syncTailPickerSelection();
}

function syncWindowInteractiveState(): void {
  const open = !menuEl.classList.contains('hidden');
  void invoke('set_menu_open', { open });
}

function syncTailPickerBounds(): void {
  if (!tailPickerOpen) {
    void invoke('set_tail_picker_bounds', { bounds: null });
    return;
  }

  const normalized = (rect: DOMRect) => [
    rect.left / window.innerWidth,
    rect.top / window.innerHeight,
    rect.right / window.innerWidth,
    rect.bottom / window.innerHeight,
  ];
  void invoke('set_tail_picker_bounds', {
    bounds: {
      toolbar: normalized(tailPickerBarEl.getBoundingClientRect()),
      keyboard: normalized(engine.getKeyboardClientBounds()),
      closeButton: normalized(btnTailCancelEl.getBoundingClientRect()),
    },
  });
}

function syncTailPickerSelection(): void {
  const layout = getKeyboardLayout(settings.keyboardLayout);
  const visibleCount = layout.keys.filter(({ id }) => tailPickerSelection.has(id)).length;
  tailPickerTitleEl.textContent =
    tailPickerStatusOverride ?? t('toast.tail_picker_hint', { count: visibleCount });
  for (const button of tailPresetButtons) {
    const presetKeys = getTailPresetKeys(button.dataset.tailpreset ?? '', layout);
    button.setAttribute('aria-pressed', String(isTailPresetSelected(presetKeys)));
  }
  engine.setTailPickerActive(true, tailPickerSelection);
  syncTailPickerBounds();
}

function closeContextMenu(): void {
  if (!menuEl.classList.contains('hidden')) {
    menuEl.classList.add('hidden');
    syncWindowInteractiveState();
    syncWin7OverlayFn?.(false);
  }
  void invoke('close_context_menu');
}

function openContextMenu(clientX: number, clientY: number): void {
  if (treatModeActive) {
    cleanupTreatModeDesktop(true);
  }
  // Always pop the dedicated non-overlapping side menu window beside the cat so it NEVER blocks the pet!
  if (!menuEl.classList.contains('hidden')) {
    menuEl.classList.add('hidden');
    syncWindowInteractiveState();
    syncWin7OverlayFn?.(false);
  }
  void invoke('open_context_menu').catch(() => {
    // Defensive fallback to inline menu if side-window creation ever fails on an unsupported WM
    menuEl.classList.remove('hidden');
    const mw = menuEl.offsetWidth || 236;
    const mh = menuEl.offsetHeight || 360;
    const left = Math.max(8, Math.min(window.innerWidth - mw - 8, clientX));
    const top = Math.max(8, Math.min(window.innerHeight - mh - 8, clientY));
    menuEl.style.left = `${left}px`;
    menuEl.style.top = `${top}px`;
    syncWindowInteractiveState();
    syncWin7OverlayFn?.(true);
  });
}

async function openTailPicker(): Promise<void> {
  if (tailPickerOpen || tailPickerLoading) return;
  if (treatModeActive) {
    cleanupTreatModeDesktop(true);
  }
  tailPickerLoading = true;
  try {
    settings = await invoke<AppSettings>('get_settings');
    tailPickerSelection = new Set(settings.tailKeyIds ?? DEFAULT_TAIL_KEY_IDS);
    tailPickerStatusOverride = null;
    tailPickerOpen = true;
    closeContextMenu();
    tailPickerBarEl.classList.remove('hidden');
    syncMenuUI();
    requestAnimationFrame(() => syncWin7OverlayFn?.(true));
  } catch (error) {
    console.error('加载自定义尾巴按键失败', error);
  } finally {
    tailPickerLoading = false;
  }
}

function closeTailPicker(): void {
  if (!tailPickerOpen || tailPickerSaving) return;
  tailPickerOpen = false;
  tailPickerStatusOverride = null;
  tailPickerSelection.clear();
  tailPickerBarEl.classList.add('hidden');
  canvas.classList.remove('tail-key-hover');
  engine.setTailPickerActive(false);
  syncTailPickerBounds();
  activateRenderEngine();
  syncWin7OverlayFn?.(false);
}

function toggleTailKeyId(specId: string): void {
  if (tailPickerSaving) return;
  if (!tailPickerSelection.delete(specId)) tailPickerSelection.add(specId);
  tailPickerStatusOverride = null;
  syncTailPickerSelection();
}

function getTailPresetKeys(presetKey: string, { keys, totalUnits, totalRows }: KeyboardLayoutDef): KeySpec[] {
  return keys.filter((key) => {
    switch (presetKey) {
      case 'office':
        return key.id === 'enter' || key.id === 'space';
      case 'rightFn':
        return ARROW_KEY_IDS.has(key.id) || key.id === 'numlk' || key.id.startsWith('np_');
      case 'edgeMods': {
        const top = key.rowY ?? key.row;
        const bottom = top + (key.rowSpan ?? 1);
        return key.uStart === 0 || key.uStart + key.uWidth >= totalUnits - 0.001 ||
          top === 0 || bottom >= totalRows - 0.001;
      }
      default:
        return false;
    }
  });
}

function isTailPresetSelected(keys: KeySpec[]): boolean {
  return keys.length > 0 && keys.every(({ id }) => tailPickerSelection.has(id));
}

function applyTailPreset(presetKey: string): void {
  if (tailPickerSaving) return;
  if (presetKey === 'clear') {
    tailPickerSelection.clear();
  } else {
    const presetKeys = getTailPresetKeys(presetKey, getKeyboardLayout(settings.keyboardLayout));
    if (isTailPresetSelected(presetKeys)) {
      for (const { id } of presetKeys) tailPickerSelection.delete(id);
    } else {
      for (const { id } of presetKeys) tailPickerSelection.add(id);
    }
  }
  tailPickerStatusOverride = null;
  syncTailPickerSelection();
}

async function confirmTailPicker(): Promise<void> {
  if (!tailPickerOpen || tailPickerSaving) return;
  tailPickerSaving = true;
  btnTailDoneEl.disabled = true;
  btnTailCancelEl.disabled = true;
  try {
    settings = await invoke<AppSettings>('save_tail_picker_selection', {
      keyIds: [...tailPickerSelection],
    });
  } catch (error) {
    console.error('保存自定义尾巴按键失败', error);
    tailPickerStatusOverride = '保存失败，请重试';
    syncTailPickerSelection();
    return;
  } finally {
    tailPickerSaving = false;
    btnTailDoneEl.disabled = false;
    btnTailCancelEl.disabled = false;
  }
  closeTailPicker();
  syncMenuUI();
}

async function applySettingsPatch(patch: Partial<AppSettings>): Promise<void> {
  if (patch.renderMode === '3d') {
    webgl3dUnavailable = false;
  }
  const seq = ++settingsPatchSeq;
  settings = { ...settings, ...patch };
  syncMenuUI();
  const updated = await invoke<AppSettings>('update_settings', { patch: settings });
  if (seq !== settingsPatchSeq) return;
  settings = updated;
  syncMenuUI();
}

async function copyMcpConfig(): Promise<void> {
  const hint = document.getElementById('mcp-copy-hint');
  try {
    const jsonText = await invoke<string>('get_mcp_config');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(jsonText);
    } else {
      const ta = document.createElement('textarea');
      ta.value = jsonText;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    if (hint) {
      hint.textContent = t('menu.copied_hint');
      hint.classList.add('copied');
      setTimeout(() => {
        hint.textContent = t('menu.mcp_hint');
        hint.classList.remove('copied');
      }, 1800);
    }
  } catch (err) {
    console.error('Failed to copy MCP config:', err);
  }
}

async function copyAgentHooksConfig(): Promise<void> {
  const hint = document.getElementById('hooks-copy-hint');
  try {
    const jsonText = await invoke<string>('get_agent_hooks_config');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(jsonText);
    } else {
      const ta = document.createElement('textarea');
      ta.value = jsonText;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    if (hint) {
      hint.textContent = t('menu.copied_hint');
      hint.classList.add('copied');
      setTimeout(() => {
        hint.textContent = t('menu.hooks_hint');
        hint.classList.remove('copied');
      }, 1800);
    }
  } catch (err) {
    console.error('Failed to copy Agent hooks config:', err);
  }
}

async function createDesktopShortcut(): Promise<void> {
  const hint = document.getElementById('shortcut-hint');
  try {
    await invoke<string>('create_desktop_shortcut');
    if (hint) {
      hint.textContent = t('menu.created_hint');
      hint.classList.add('copied');
      setTimeout(() => {
        hint.textContent = 'KuroCat';
        hint.classList.remove('copied');
      }, 1800);
    }
  } catch (err) {
    console.error('Failed to create desktop shortcut:', err);
  }
}

function setUpdateHint(text: string, mode: 'default' | 'ready' | 'error' = 'default'): void {
  const hint = document.getElementById('update-hint');
  if (!hint) return;
  hint.textContent = text;
  hint.classList.remove('update-ready', 'update-error');
  if (mode === 'ready') hint.classList.add('update-ready');
  else if (mode === 'error') hint.classList.add('update-error');
}

function formatAvailableUpdateText(ver: string): string {
  return window.innerWidth < 250 ? `⬆ v${ver}` : `✨ ${t('toast.available', { ver })}`;
}

function formatLockedToastText(_startup = false): string {
  if (window.innerWidth < 260) {
    return '🔒';
  }
  return isMacPlatform() ? `🔒 ${t('toast.locked_macos')}` : `🔒 ${t('toast.locked_windows')}`;
}

function formatAdminGameToastText(): string {
  if (window.innerWidth < 260) {
    return '🛡️';
  }
  return `🛡️ ${t('toast.game_admin_hint')}`;
}

function isAdminHintDismissed(): boolean {
  try {
    return window.localStorage.getItem(ADMIN_HINT_DISMISSED_KEY) === '1';
  } catch {
    return false;
  }
}

function saveAdminHintDismissed(): void {
  try {
    window.localStorage.setItem(ADMIN_HINT_DISMISSED_KEY, '1');
  } catch {
    // ignore storage errors
  }
}

function showPendingUpdateToast(): boolean {
  if (
    updateBusy ||
    !latestUpdateInfo?.hasUpdate ||
    dismissedVersion === latestUpdateInfo.latestVersion
  ) {
    return false;
  }
  showUpdateToast(formatAvailableUpdateText(latestUpdateInfo.latestVersion), {
    showInstall: Boolean(latestUpdateInfo.downloadUrl),
    showOpen: !latestUpdateInfo.downloadUrl,
    kind: 'update',
  });
  return true;
}

function hideUpdateToast(restorePendingUpdate = false): void {
  if (toastAutoHideTimer !== null) {
    window.clearTimeout(toastAutoHideTimer);
    toastAutoHideTimer = null;
  }
  const prevKind = currentToastKind;
  currentToastKind = null;
  if (restorePendingUpdate && (prevKind === 'transient' || prevKind === 'admin') && showPendingUpdateToast()) {
    return;
  }
  if (!updateToastEl.classList.contains('hidden')) {
    updateToastEl.classList.add('hidden');
    void invoke('set_update_banner_open', { open: false });
    syncWin7OverlayFn?.(false);
  }
}

function showUpdateToast(
  text: string,
  options: {
    showInstall?: boolean;
    showUnlock?: boolean;
    showAdmin?: boolean;
    showOpen?: boolean;
    autoHideMs?: number;
    busy?: boolean;
    kind?: 'update' | 'admin' | 'transient';
  } = {},
): void {
  if (toastAutoHideTimer !== null) {
    window.clearTimeout(toastAutoHideTimer);
    toastAutoHideTimer = null;
  }
  currentToastKind = options.kind ?? 'transient';
  updateToastTextEl.textContent = text;
  btnToastInstallEl.classList.toggle('hidden', !options.showInstall);
  btnToastInstallEl.disabled = Boolean(options.busy);
  btnToastUnlockEl.classList.toggle('hidden', !options.showUnlock);
  btnToastAdminEl?.classList.toggle('hidden', !options.showAdmin);
  btnToastOpenEl.classList.toggle('hidden', !options.showOpen);
  updateToastEl.classList.remove('hidden');
  void invoke('set_update_banner_open', { open: true });
  requestAnimationFrame(() => syncWin7OverlayFn?.(false));

  if (options.autoHideMs && options.autoHideMs > 0) {
    toastAutoHideTimer = window.setTimeout(() => {
      hideUpdateToast(true);
    }, options.autoHideMs);
  }
}

function handleUpdateProgressEvent(ev: UpdateProgressEvent, fromManual = false): void {
  if (ev.info) {
    latestUpdateInfo = ev.info;
    appVersion = ev.info.currentVersion || appVersion;
  }

  switch (ev.stage) {
    case 'checking':
      updateBusy = true;
      setUpdateHint(t('menu.checking_short'));
      showUpdateToast(t('toast.checking'), { busy: true, kind: 'transient' });
      break;
    case 'available':
      updateBusy = false;
      if (latestUpdateInfo?.hasUpdate) {
        const ver = latestUpdateInfo.latestVersion;
        setUpdateHint(`⬆ v${ver}`, 'ready');
        if (fromManual || dismissedVersion !== ver) {
          showUpdateToast(formatAvailableUpdateText(ver), {
            showInstall: Boolean(latestUpdateInfo.downloadUrl),
            showOpen: !latestUpdateInfo.downloadUrl,
            kind: 'update',
          });
        }
      }
      break;
    case 'up_to_date':
      updateBusy = false;
      setUpdateHint(`✓ v${appVersion}`);
      showUpdateToast(`✓ ${t('toast.up_to_date', { ver: appVersion })}`, { autoHideMs: 2600, kind: 'transient' });
      break;
    case 'downloading':
    case 'verifying':
    case 'installing':
      updateBusy = true;
      setUpdateHint(t('menu.checking_short'), 'ready');
      showUpdateToast(`⏳ ${ev.message}`, { busy: true, kind: 'transient' });
      break;
    case 'error':
      updateBusy = false;
      setUpdateHint('⚠', 'error');
      showUpdateToast(`⚠ ${ev.message}`, {
        showOpen: true,
        autoHideMs: 5200,
        kind: 'transient',
      });
      break;
  }
}

async function triggerInstallUpdate(): Promise<void> {
  if (updateBusy || !latestUpdateInfo || !latestUpdateInfo.hasUpdate) return;
  updateBusy = true;
  closeContextMenu();
  showUpdateToast(`⏳ 正在下载 v${latestUpdateInfo.latestVersion}...`, { busy: true });
  setUpdateHint('下载中...', 'ready');
  try {
    await invoke('install_update', { info: latestUpdateInfo });
  } catch (err) {
    updateBusy = false;
    const msg = typeof err === 'string' ? err : String(err);
    setUpdateHint('更新失败', 'error');
    showUpdateToast(`⚠ ${msg}`, { showOpen: true, autoHideMs: 6500 });
  }
}

async function triggerManualUpdateCheck(): Promise<void> {
  if (updateBusy) return;
  // If we already know an update is ready, clicking the menu item immediately starts installing it!
  if (latestUpdateInfo?.hasUpdate && latestUpdateInfo.downloadUrl) {
    await triggerInstallUpdate();
    return;
  }
  updateBusy = true;
  setUpdateHint(t('menu.checking_short'));
  closeContextMenu();
  showUpdateToast(t('toast.checking'), { busy: true });
  try {
    const info = await invoke<UpdateInfo>('check_for_update');
    handleUpdateProgressEvent(
      {
        stage: info.hasUpdate ? 'available' : 'up_to_date',
        message: info.hasUpdate
          ? t('toast.available', { ver: info.latestVersion })
          : t('toast.up_to_date', { ver: info.currentVersion }),
        info,
      },
      true,
    );
  } catch (err) {
    const msg = typeof err === 'string' ? err : String(err);
    handleUpdateProgressEvent({ stage: 'error', message: msg, info: null }, true);
  }
}

async function bootstrap(): Promise<void> {
  engine.start();

  // Hide Windows-only desktop shortcut button on macOS
  if (/Mac/i.test(navigator.platform) || /Macintosh/i.test(navigator.userAgent)) {
    const shortcutBtn = document.getElementById('btn-desktop-shortcut');
    if (shortcutBtn) shortcutBtn.style.display = 'none';
  }

  try {
    const [loadedSettings, loadedCats, loadedVer, resolvedLoc, loadedAdmin] = await Promise.all([
      invoke<AppSettings>('get_settings'),
      invoke<CatSkinConfig[]>('get_cats'),
      invoke<string>('get_app_version'),
      invoke<string>('get_resolved_locale').catch(() => ''),
      invoke<{ supported: boolean; elevated: boolean }>('get_admin_status').catch(() => ({
        supported: false,
        elevated: false,
      })),
    ]);
    settings = loadedSettings;
    adminStatus = loadedAdmin;
    lastKnownLockState = settings.clickThroughLocked;
    if (Array.isArray(loadedCats) && loadedCats.length > 0) {
      catList = loadedCats;
    }
    if (loadedVer) {
      appVersion = loadedVer;
      setUpdateHint(`v${appVersion}`);
    }
    if (resolvedLoc) {
      resolvedBackendLocale = resolvedLoc;
    }
    syncMenuUI();
  } catch (err) {
    console.error('Failed to load settings or cats:', err);
  }

  await listen<UpdateProgressEvent>('kuro-update-status', (ev) => {
    handleUpdateProgressEvent(ev.payload, false);
  });

  btnToastInstallEl.addEventListener('click', (e) => {
    e.stopPropagation();
    void triggerInstallUpdate();
  });

  btnToastUnlockEl.addEventListener('click', (e) => {
    e.stopPropagation();
    hideUpdateToast(false);
    void applySettingsPatch({ clickThroughLocked: false });
  });

  btnToastAdminEl?.addEventListener('click', (e) => {
    e.stopPropagation();
    hideUpdateToast(false);
    void invoke('restart_as_admin');
  });

  btnToastOpenEl.addEventListener('click', (e) => {
    e.stopPropagation();
    const url = latestUpdateInfo?.releaseUrl || 'https://github.com/qianyiai/KuroCat/releases/latest';
    void invoke('open_release_page', { url });
  });

  btnToastCloseEl.addEventListener('click', (e) => {
    e.stopPropagation();
    if (currentToastKind === 'update' && latestUpdateInfo?.hasUpdate) {
      dismissedVersion = latestUpdateInfo.latestVersion;
      saveDismissedVersion(latestUpdateInfo.latestVersion);
      hideUpdateToast(false);
    } else if (currentToastKind === 'admin') {
      saveAdminHintDismissed();
      hideUpdateToast(true);
    } else {
      hideUpdateToast(true);
    }
  });

  window.addEventListener('resize', () => {
    if (
      !updateToastEl.classList.contains('hidden') &&
      currentToastKind === 'update' &&
      latestUpdateInfo?.hasUpdate &&
      !updateBusy
    ) {
      updateToastTextEl.textContent = formatAvailableUpdateText(latestUpdateInfo.latestVersion);
    }
  });

  if (isMacPlatform()) {
    await listen<boolean>('kuro-trackpad-unavailable', (ev) => {
      padUnavailable = ev.payload;
      syncMenuUI();
    });
    padUnavailable = await invoke<boolean>('trackpad_unavailable').catch(() => false);
    syncMenuUI();
  }

  if (scaleSliderEl) {
    scaleSliderEl.addEventListener('pointerdown', () => {
      sliderDragging = true;
    });
    scaleSliderEl.addEventListener('input', () => {
      sliderDragging = true;
      const nextScale = Math.max(0.2, Math.min(1.5, Number(scaleSliderEl.value) / 100));
      updateScaleSliderVisual(nextScale);
      engine.setRenderScale(nextScale);
    });
    const commitSliderScale = () => {
      sliderDragging = false;
      const nextScale = Math.max(0.2, Math.min(1.5, Number(scaleSliderEl.value) / 100));
      void applySettingsPatch({ scale: nextScale });
    };
    scaleSliderEl.addEventListener('change', commitSliderScale);
    scaleSliderEl.addEventListener('pointerup', () => {
      sliderDragging = false;
    });
  }

  if (scaleValueEl) {
    scaleValueEl.addEventListener('click', (e) => {
      e.stopPropagation();
      sliderDragging = false;
      updateScaleSliderVisual(1.0);
      void applySettingsPatch({ scale: 1.0 });
    });
  }

  if (opacitySliderEl) {
    opacitySliderEl.addEventListener('pointerdown', () => {
      opacitySliderDragging = true;
    });
    opacitySliderEl.addEventListener('input', () => {
      opacitySliderDragging = true;
      const nextOpacity = Math.max(0.2, Math.min(1.0, Number(opacitySliderEl.value) / 100));
      updateOpacitySliderVisual(nextOpacity);
      applyPetOpacity(nextOpacity);
      void invoke('preview_opacity', { opacity: nextOpacity }).catch(() => {});
    });
    const commitSliderOpacity = () => {
      opacitySliderDragging = false;
      const nextOpacity = Math.max(0.2, Math.min(1.0, Number(opacitySliderEl.value) / 100));
      void applySettingsPatch({ opacity: nextOpacity });
    };
    opacitySliderEl.addEventListener('change', commitSliderOpacity);
    opacitySliderEl.addEventListener('pointerup', () => {
      opacitySliderDragging = false;
    });
  }

  if (opacityValueEl) {
    opacityValueEl.addEventListener('click', (e) => {
      e.stopPropagation();
      opacitySliderDragging = false;
      updateOpacitySliderVisual(1.0);
      applyPetOpacity(1.0);
      void invoke('preview_opacity', { opacity: 1.0 }).catch(() => {});
      void applySettingsPatch({ opacity: 1.0 });
    });
  }

  if (volumeSliderEl) {
    volumeSliderEl.addEventListener('pointerdown', () => {
      volumeSliderDragging = true;
    });
    volumeSliderEl.addEventListener('input', () => {
      volumeSliderDragging = true;
      const nextVol = Math.max(0, Math.min(1, Number(volumeSliderEl.value) / 100));
      const nextMuted = nextVol <= 0.001;
      updateVolumeSliderVisual(nextVol, nextMuted);
      catAudio.setMasterVolume(nextVol);
      catAudio.setMuted(nextMuted);
    });
    const commitSliderVolume = () => {
      volumeSliderDragging = false;
      const nextVol = Math.max(0, Math.min(1, Number(volumeSliderEl.value) / 100));
      const nextMuted = nextVol <= 0.001;
      void applySettingsPatch({ soundVolume: nextVol, soundMuted: nextMuted });
    };
    volumeSliderEl.addEventListener('change', commitSliderVolume);
    volumeSliderEl.addEventListener('pointerup', () => {
      volumeSliderDragging = false;
    });
  }

  if (volumeValueEl) {
    volumeValueEl.addEventListener('click', (e) => {
      e.stopPropagation();
      volumeSliderDragging = false;
      const curVol = normalizeVolume(settings.soundVolume);
      const currentlyMuted = Boolean(settings.soundMuted) || curVol <= 0.001;
      const nextVol = currentlyMuted ? (curVol <= 0.001 ? 1.0 : curVol) : 1.0;
      updateVolumeSliderVisual(nextVol, false);
      catAudio.setMasterVolume(nextVol);
      catAudio.setMuted(false);
      void applySettingsPatch({ soundVolume: nextVol, soundMuted: false });
    });
  }

  await listen<AppSettings>('kuro-settings', (ev) => {
    const prevLock = lastKnownLockState;
    const prevRenderMode = settings.renderMode;
    settings = ev.payload;
    if (prevRenderMode === '2d' && settings.renderMode !== '2d') {
      webgl3dUnavailable = false;
    }
    lastKnownLockState = settings.clickThroughLocked;
    syncMenuUI();
    if (prevLock !== null && prevLock !== settings.clickThroughLocked) {
      if (settings.clickThroughLocked) {
        showUpdateToast(formatLockedToastText(false), {
          showUnlock: true,
          autoHideMs: 4200,
          kind: 'transient',
        });
      } else {
        showUpdateToast(
          window.innerWidth < 260 ? '🔓' : `🔓 ${t('toast.unlocked')}`,
          { autoHideMs: 2200, kind: 'transient' },
        );
      }
    }
  });

  await listen<CatSkinConfig[]>('kuro-cats', (ev) => {
    if (Array.isArray(ev.payload) && ev.payload.length > 0) {
      catList = ev.payload;
      syncMenuUI();
    }
  });

  await listen('kuro-open-tail-picker', () => {
    void openTailPicker();
  });

  await listen<{ action?: string; flavor?: string }>('kuro-treat-feed', (ev) => {
    if (ev.payload?.action === 'stop') {
      cleanupTreatModeDesktop(true);
    } else {
      startTreatModeDesktop(ev.payload?.flavor);
    }
  });

  window.addEventListener('mousemove', (e) => {
    if (!treatModeActive) return;
    lastTreatDomMoveAt = performance.now();
    lastTreatClientX = e.clientX;
    lastTreatClientY = e.clientY;
    getActiveTreatEngine().setTreatPointer(e.clientX, e.clientY, treatPointerDown);
  });

  window.addEventListener('mouseup', (e) => {
    if (!treatModeActive || e.button !== 0 || !treatPointerDown) return;
    treatPointerDown = false;
    getActiveTreatEngine().setTreatPointer(e.clientX, e.clientY, false);
  });

  await listen<number>('kuro-scale-preview', (ev) => {
    if (typeof ev.payload === 'number' && Number.isFinite(ev.payload)) {
      engine.setRenderScale(Math.max(0.2, Math.min(1.5, ev.payload)));
    }
  });

  await listen<number>('kuro-opacity-preview', (ev) => {
    if (typeof ev.payload === 'number' && Number.isFinite(ev.payload)) {
      applyPetOpacity(ev.payload);
    }
  });

  await listen<{ volume?: number; muted?: boolean }>('kuro-volume-preview', (ev) => {
    if (!ev.payload) return;
    if (typeof ev.payload.volume === 'number' && Number.isFinite(ev.payload.volume)) {
      catAudio.setMasterVolume(normalizeVolume(ev.payload.volume));
    }
    if (typeof ev.payload.muted === 'boolean') {
      catAudio.setMuted(ev.payload.muted);
    }
  });

  btnTailDoneEl.addEventListener('click', (e) => {
    e.stopPropagation();
    void confirmTailPicker();
  });

  btnTailCancelEl.addEventListener('click', (e) => {
    e.stopPropagation();
    closeTailPicker();
  });

  window.addEventListener('resize', () => {
    if (tailPickerOpen) syncTailPickerBounds();
  });
  tailPickerBarEl.addEventListener('animationend', () => {
    if (!tailPickerOpen) return;
    syncTailPickerBounds();
    syncWin7OverlayFn?.(false);
  });

  tailPickerBarEl.addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>('[data-tailpreset]');
    if (!btn) return;
    e.stopPropagation();
    const preset = btn.dataset.tailpreset;
    if (preset) applyTailPreset(preset);
  });

  let lastDragGlobalX: number | null = null;
  let lastDragGlobalY: number | null = null;
  let dragInFlight = false;
  let nativeDragActive = false;
  let cancelPendingTapVsDrag: (() => void) | null = null;
  let completePendingTapOnGlobalMouseUp: (() => void) | null = null;
  let lastCatTapAt = 0;
  let lastAgentMouseInputAt = 0;
  let lastPointerClientX = -1;
  let lastPointerClientY = -1;
  let lastKbKeyHover = false;
  let activeVirtualKeyVk: number | null = null;
  let virtualKeyAutoReleaseTimer: number | null = null;
  let lastVirtualKeyDownAt = 0;
  let suppressGlobalLeftMouseUp = false;

  const syncKeyboardHoverCursor = (overKey: boolean) => {
    if (overKey === lastKbKeyHover) return;
    lastKbKeyHover = overKey;
    canvas.classList.toggle('kb-key-hover', overKey);
    canvas3d.classList.toggle('kb-key-hover', overKey);
  };

  const hitTestClickableKey = (
    clientX: number,
    clientY: number,
    altKey = false,
  ): KeySpec | null => {
    if (
      privacyActive ||
      treatModeActive ||
      tailPickerOpen ||
      nativeDragActive ||
      dragInFlight ||
      shouldUseGamepadNow()
    ) {
      return null;
    }
    if (settings.clickThroughLocked && !altOverride && !altKey) return null;
    if (!Number.isFinite(clientX) || !Number.isFinite(clientY) || clientX < 0 || clientY < 0) {
      return null;
    }
    const hit =
      active3d && engine3d
        ? engine3d.hitTestKeyAtClientPoint(clientX, clientY)
        : engine.hitTestKeyAtClientPoint(clientX, clientY);
    return hit && hit.vkCodes.length > 0 ? hit : null;
  };

  const computeKeySoundPan = (vk: number): number => {
    const kbLayout: KeyboardLayoutId = normalizeKeyboardLayout(settings.keyboardLayout);
    const spec = resolveKeyByVk(vk, kbLayout);
    if (!spec) return 0;
    const layout = getKeyboardLayout(kbLayout);
    const centerU = spec.uStart + spec.uWidth * 0.5;
    const normX = Math.max(0, Math.min(1, centerU / layout.totalUnits));
    return (normX * 2 - 1) * 0.35;
  };

  const releaseVirtualKey = (silent = false) => {
    if (virtualKeyAutoReleaseTimer !== null) {
      window.clearTimeout(virtualKeyAutoReleaseTimer);
      virtualKeyAutoReleaseTimer = null;
    }
    const vk = activeVirtualKeyVk;
    if (vk === null) return;
    activeVirtualKeyVk = null;
    if (!silent && settings.typingSoundEnabled) {
      catAudio.playKeyUp(vk, computeKeySoundPan(vk));
    }
    if (active3d && engine3d) engine3d.onKeyUp(vk);
    engine.onKeyUp(vk);
  };

  const pressVirtualKey = (spec: KeySpec, autoReleaseMs?: number) => {
    const vk = spec.vkCodes[0];
    if (typeof vk !== 'number') return;
    releaseVirtualKey(true);
    activeVirtualKeyVk = vk;
    lastVirtualKeyDownAt = performance.now();
    agentCompanion.notifyRealUserInput();
    if (settings.typingSoundEnabled) {
      catAudio.playKeyDown(vk, computeKeySoundPan(vk));
    }
    if (active3d && engine3d) engine3d.onKeyDown(vk, false, true);
    else engine.onKeyDown(vk, false, true);
    if (typeof autoReleaseMs === 'number' && autoReleaseMs > 0) {
      virtualKeyAutoReleaseTimer = window.setTimeout(() => {
        virtualKeyAutoReleaseTimer = null;
        releaseVirtualKey(false);
      }, autoReleaseMs);
    }
  };

  const fireCatTap = (clientX: number, clientY: number) => {
    const now = performance.now();
    if (now - lastCatTapAt < 140) return;
    lastCatTapAt = now;
    const zone =
      active3d && engine3d
        ? engine3d.onCatTapAtClientPoint(clientX, clientY)
        : engine.onCatTapAtClientPoint(clientX, clientY);
    if (zone && !privacyActive) {
      syncPetInteractionToLive({ kind: 'tap', zone });
    }
  };

  await listen<InputEvent>('kuro-input', (ev) => {
    const p = ev.payload;
    switch (p.kind) {
      case 'keyDown':
        agentCompanion.notifyRealUserInput();
        if (treatModeActive && p.vk === 27) {
          cleanupTreatModeDesktop(true);
          break;
        }
        if (tailPickerOpen) {
          if (!p.repeat) {
            const spec = resolveKeyByVk(p.vk, settings.keyboardLayout);
            if (spec) {
              toggleTailKeyId(spec.id);
            }
          }
          break;
        }
        if (!p.repeat && settings.typingSoundEnabled) {
          catAudio.playKeyDown(p.vk, computeKeySoundPan(p.vk));
        }
        if (active3d && engine3d) engine3d.onKeyDown(p.vk, p.repeat);
        else engine.onKeyDown(p.vk, p.repeat);
        break;
      case 'keyUp':
        if (!tailPickerOpen && settings.typingSoundEnabled) {
          catAudio.playKeyUp(p.vk, computeKeySoundPan(p.vk));
        }
        if (active3d || tailPickerOpen) engine3d?.onKeyUp(p.vk);
        if (!active3d) {
          engine.onKeyUp(p.vk);
        }
        break;
      case 'trackpad':
        lastPadPoints = p.points;
        if (active3d && engine3d) engine3d.onTrackpad(p.points);
        else engine.onTrackpad(p.points);
        break;
      case 'mouseMove': {
        const moveNow = performance.now();
        if (moveNow - lastAgentMouseInputAt >= 180) {
          lastAgentMouseInputAt = moveNow;
          agentCompanion.notifyRealUserInput();
        }
        if (canvas.classList.contains('pet-dragging') || canvas3d.classList.contains('pet-dragging')) {
          const hasPx = Number.isFinite(p.x) && Number.isFinite(p.y);
          const curX = hasPx ? p.x : p.nx;
          const curY = hasPx ? p.y : p.ny;
          const prevX = lastDragGlobalX;
          const prevY = lastDragGlobalY;
          lastDragGlobalX = curX;
          lastDragGlobalY = curY;
          if (prevX !== null && prevY !== null) {
            const vx = hasPx ? (curX - prevX) / 28 : (curX - prevX) * 68;
            const vy = hasPx ? (curY - prevY) / 28 : (curY - prevY) * 40;
            if (active3d && engine3d) engine3d.updateDragVelocity(vx, vy);
            else engine.updateDragVelocity(vx, vy);
            if (!privacyActive) {
              syncPetInteractionToLive({ kind: 'drag', active: true, vx, vy });
            }
          }
        }
        if (active3d && engine3d) engine3d.onGlobalMouseMove(p.nx, p.ny);
        else engine.onGlobalMouseMove(p.nx, p.ny);
        break;
      }
      case 'mouseDown':
        agentCompanion.notifyRealUserInput();
        if (
          p.button === 'left' &&
          hitTestClickableKey(lastPointerClientX, lastPointerClientY, altOverride) !== null
        ) {
          // Clicking KuroCat's own desktop keyboard triggers pure visual/audio key animation
          // without hijacking the cat's left paw onto the desk mouse or double-playing mouse click SFX.
          suppressGlobalLeftMouseUp = true;
          break;
        }
        if (settings.typingSoundEnabled) {
          catAudio.playMouseDown(p.button);
        }
        if (active3d && engine3d) engine3d.onMouseDown(p.button, p.point);
        else engine.onMouseDown(p.button, p.point);
        break;
      case 'mouseUp':
        if (p.button === 'left') {
          if (treatModeActive && treatPointerDown) {
            treatPointerDown = false;
            getActiveTreatEngine().setTreatPointer(lastTreatClientX, lastTreatClientY, false);
          }
          resolveLinuxMouseUp?.();
          // IMPORTANT: Do NOT cancel pending tap here! The global OS hook delivers `mouseUp`
          // BEFORE WebView2/WKWebView dispatches DOM `mouseup`, so cancelling killed every tap.
          // Instead, disarm the drag hold timer and complete the tap if DOM `mouseup` is dropped.
          completePendingTapOnGlobalMouseUp?.();
          if (activeVirtualKeyVk !== null && virtualKeyAutoReleaseTimer === null) {
            releaseVirtualKey(false);
          }
          if (suppressGlobalLeftMouseUp) {
            suppressGlobalLeftMouseUp = false;
            break;
          }
        }
        if (settings.typingSoundEnabled) {
          catAudio.playMouseUp(p.button);
        }
        if (active3d && engine3d) engine3d.onMouseUp(p.button);
        else engine.onMouseUp(p.button);
        break;
      case 'mouseWheel':
        agentCompanion.notifyRealUserInput();
        if (active3d && engine3d) engine3d.onMouseWheel(p.delta);
        else engine.onMouseWheel(p.delta);
        break;
      case 'privacyTyping':
        if (active3d && engine3d) engine3d.onPrivacyTyping();
        else engine.onPrivacyTyping();
        break;
    }
  });

  await listen<{ stageId: number }>('kuro-handover-stage-cancelled', (ev) => {
    engine3d?.onDesktopStageCancelled(ev.payload.stageId);
  });

  await listen<boolean>('kuro-privacy', (ev) => {
    privacyActive = Boolean(ev.payload);
    if (privacyActive) {
      releaseVirtualKey(true);
      syncKeyboardHoverCursor(false);
      if (treatModeActive) {
        cleanupTreatModeDesktop(true);
      }
    }
    engine.setPrivacyMode(privacyActive);
    engine3d?.setPrivacyMode(privacyActive);
    agentCompanion.setPrivacyMode(privacyActive);
  });

  await listen<AgentCompanionEvent>('kuro-agent-event', (ev) => {
    agentCompanion.handleEvent(ev.payload);
  });

  await listen<PetInteractionEvent>('kuro-pet-interaction', (ev) => {
    if (!ev.payload || privacyActive) return;
    applyPetInteraction(active3d && engine3d ? engine3d : engine, Boolean(active3d && engine3d), ev.payload);
  });

  await listen<string>('kuro-peek-edge', (ev) => {
    const raw = ev.payload;
    const edge: PeekEdge = raw === 'left' || raw === 'right' ? raw : 'none';
    engine.setPeekEdge(edge);
    engine3d?.setPeekEdge(edge);
  });

  await listen<string>('kuro-peek-preview', (ev) => {
    const raw = ev.payload;
    const edge: PeekEdge = raw === 'left' || raw === 'right' ? raw : 'none';
    engine.setPeekPreview(edge);
    engine3d?.setPeekPreview(edge);
  });

  await listen<{ clientX?: number; clientY?: number }>('kuro-native-tap', (ev) => {
    if (treatModeActive || tailPickerOpen || nativeDragActive || dragInFlight) return;
    if (settings.clickThroughLocked && !altOverride) return;
    const cx = Number(ev.payload?.clientX);
    const cy = Number(ev.payload?.clientY);
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) return;
    // Wait briefly so any normal DOM mousedown/mouseup runs first; deduplicated cleanly.
    window.setTimeout(() => {
      if (treatModeActive || tailPickerOpen || nativeDragActive || dragInFlight) return;
      if (settings.clickThroughLocked && !altOverride) return;
      if (performance.now() - lastVirtualKeyDownAt < 380) return;
      const keyHit = hitTestClickableKey(cx, cy, altOverride);
      if (keyHit) {
        pressVirtualKey(keyHit, 110);
        return;
      }
      fireCatTap(cx, cy);
    }, 32);
  });

  await listen<boolean>('kuro-native-drag', (ev) => {
    const active = Boolean(ev.payload);
    nativeDragActive = active;
    if (active) {
      // macOS unfocused first-click fallback claimed this drag directly in Rust:
      // cancel any armed JS tap detector and enter scruff-lift + velocity sway seamlessly!
      cancelPendingTapVsDrag?.();
      lastDragGlobalX = null;
      lastDragGlobalY = null;
      canvas.classList.add('pet-dragging');
      canvas3d.classList.add('pet-dragging');
      engine.setPeekPreview('none');
      engine3d?.setPeekPreview('none');
      if (engine.getPeekEdge() !== 'none' || (engine3d?.getPeekEdge() ?? 'none') !== 'none') {
        engine.setPeekEdge('none');
        engine3d?.setPeekEdge('none');
      }
      if (active3d && engine3d) engine3d.setDragging(true);
      else engine.setDragging(true);
      if (!privacyActive) syncPetInteractionToLive({ kind: 'drag', active: true });
    } else if (!dragInFlight) {
      lastDragGlobalX = null;
      lastDragGlobalY = null;
      canvas.classList.remove('pet-dragging');
      canvas3d.classList.remove('pet-dragging');
      engine.setDragging(false);
      engine3d?.setDragging(false);
      engine.onMouseUp('left');
      engine3d?.onMouseUp('left');
      syncPetInteractionToLive({ kind: 'drag', active: false });
    }
  });

  try {
    gameActive = await invoke<boolean>('get_game_active');
    const wearNow = shouldWearHeadphonesNow();
    engine.setGameActive(gameActive);
    engine3d?.setGameActive(gameActive);
    engine.setHeadphones(wearNow);
    engine3d?.setHeadphones(wearNow);
  } catch {
    // non-Tauri or older backend
  }

  try {
    tabletActive = await invoke<boolean>('get_tablet_active');
    const useTablet = shouldUseTabletNow();
    engine.setTabletActive(useTablet);
    engine3d?.setTabletActive(useTablet);
  } catch {
    // non-Tauri or older backend
  }

  await listen<{ active?: boolean; source?: string | null }>('kuro-tablet-active', (ev) => {
    tabletActive = Boolean(ev.payload?.active);
    const useTablet = shouldUseTabletNow();
    engine.setTabletActive(useTablet);
    engine3d?.setTabletActive(useTablet);
  });

  try {
    gamepadActive = await invoke<boolean>('get_gamepad_active');
    const useGp = shouldUseGamepadNow();
    engine.setGamepadActive(useGp);
    engine3d?.setGamepadActive(useGp);
    const wearNow = shouldWearHeadphonesNow();
    engine.setHeadphones(wearNow);
    engine3d?.setHeadphones(wearNow);
  } catch {
    // non-Tauri or older backend
  }

  await listen<{
    active?: boolean;
    lx: number;
    ly: number;
    rx: number;
    ry: number;
    lt: number;
    rt: number;
    buttons: number;
  }>('kuro-gamepad', (ev) => {
    const p = ev.payload;
    if (!p) return;
    const prevActive = gamepadActive;
    gamepadActive = Boolean(p.active);
    if (gamepadActive !== prevActive) {
      const useGp = shouldUseGamepadNow();
      engine.setGamepadActive(useGp);
      engine3d?.setGamepadActive(useGp);
      const wearNow = shouldWearHeadphonesNow();
      engine.setHeadphones(wearNow);
      engine3d?.setHeadphones(wearNow);
    }
    if (shouldUseGamepadNow()) {
      agentCompanion.notifyRealUserInput();
      if (active3d && engine3d) engine3d.onGamepadState(p);
      else engine.onGamepadState(p);
    }
  });

  await listen<{ active?: boolean; gameName?: string | null; needsAdmin?: boolean; gpuEco?: boolean }>('kuro-game-active', (ev) => {
    gameActive = Boolean(ev.payload?.active);
    gpuEcoActive = Boolean(ev.payload?.gpuEco) || gameActive;
    const wearNow = shouldWearHeadphonesNow();
    engine.setGameActive(gameActive || gpuEcoActive);
    engine3d?.setGameActive(gameActive || gpuEcoActive);
    engine.setHeadphones(wearNow);
    engine3d?.setHeadphones(wearNow);

    if (
      isWindowsPlatform() &&
      gameActive &&
      ev.payload?.needsAdmin &&
      !updateBusy &&
      !adminHintShownThisSession &&
      !isAdminHintDismissed()
    ) {
      adminHintShownThisSession = true;
      showUpdateToast(formatAdminGameToastText(), {
        showAdmin: true,
        autoHideMs: 14000,
        kind: 'admin',
      });
    }
  });

  let lastPetHover = false;
  let lastBackendCursorAt = 0;
  await listen<WindowCursorInfo>('kuro-cursor', (ev) => {
    lastBackendCursorAt = performance.now();
    const c = ev.payload;
    altOverride = Boolean(c.altOverride);
    const target = active3d && engine3d ? canvas3d : canvas;
    const rect = target.getBoundingClientRect();
    const hasRect = rect.width >= 4 && rect.height >= 4;
    if (c.insideWindow && hasRect) {
      const cx = rect.left + c.relX * rect.width;
      const cy = rect.top + c.relY * rect.height;
      lastPointerClientX = cx;
      lastPointerClientY = cy;
      if (treatModeActive && performance.now() - lastTreatDomMoveAt > 60) {
        lastTreatClientX = cx;
        lastTreatClientY = cy;
        getActiveTreatEngine().setTreatPointer(cx, cy, treatPointerDown);
      }
      syncKeyboardHoverCursor(hitTestClickableKey(cx, cy, altOverride) !== null);
    } else {
      lastPointerClientX = -1;
      lastPointerClientY = -1;
      syncKeyboardHoverCursor(false);
    }
    if (active3d && engine3d) engine3d.onWindowCursor(c.relX, c.relY, c.overCat);
    else engine.onWindowCursor(c.relX, c.relY, c.overCat);
    const interactive = !settings.clickThroughLocked || altOverride;
    const petHover = c.overCat && interactive;
    if (petHover !== lastPetHover) {
      lastPetHover = petHover;
      canvas.classList.toggle('pet-hover', petHover);
      canvas3d.classList.toggle('pet-hover', petHover);
    }
  });

  // Pure-Wayland / XWayland local pointer fallback: when backend global cursor polling
  // (`kuro-cursor`) is silent for >500ms, keep eye tracking and hover petting responsive via DOM events.
  if (!isWindowsPlatform() && !isMacPlatform()) {
    window.addEventListener('mousemove', (e) => {
      if (tailPickerOpen || performance.now() - lastBackendCursorAt < 500) return;
      const target = active3d && engine3d ? canvas3d : canvas;
      const rect = target.getBoundingClientRect();
      if (rect.width < 4 || rect.height < 4) return;
      const relX = (e.clientX - rect.left) / rect.width;
      const relY = (e.clientY - rect.top) / rect.height;
      const zone =
        active3d && engine3d
          ? engine3d.hitTestCatZoneAtClientPoint(e.clientX, e.clientY)
          : engine.hitTestCatZoneAtClientPoint(e.clientX, e.clientY);
      const interactive = !settings.clickThroughLocked || altOverride || e.altKey;
      const overCat = interactive && zone !== null;
      if (active3d && engine3d) engine3d.onWindowCursor(relX, relY, overCat);
      else engine.onWindowCursor(relX, relY, overCat);
      if (overCat !== lastPetHover) {
        lastPetHover = overCat;
        canvas.classList.toggle('pet-hover', overCat);
        canvas3d.classList.toggle('pet-hover', overCat);
      }
    });
    window.addEventListener('mouseleave', () => {
      if (performance.now() - lastBackendCursorAt < 500) return;
      if (active3d && engine3d) engine3d.onWindowCursor(-1, -1, false);
      else engine.onWindowCursor(-1, -1, false);
      if (lastPetHover) {
        lastPetHover = false;
        canvas.classList.remove('pet-hover');
        canvas3d.classList.remove('pet-hover');
      }
    });
  }

  const handleCanvasMouseMove = (e: MouseEvent) => {
    lastPointerClientX = e.clientX;
    lastPointerClientY = e.clientY;
    if (tailPickerOpen) {
      const hit = engine.hitTestKeyAtClientPoint(e.clientX, e.clientY);
      engine.setTailPickerHover(hit ? hit.id : null);
      canvas.classList.toggle('tail-key-hover', Boolean(hit));
      syncKeyboardHoverCursor(false);
      return;
    }
    syncKeyboardHoverCursor(hitTestClickableKey(e.clientX, e.clientY, e.altKey) !== null);
  };

  const handleCanvasMouseLeave = () => {
    lastPointerClientX = -1;
    lastPointerClientY = -1;
    syncKeyboardHoverCursor(false);
    if (tailPickerOpen) {
      engine.setTailPickerHover(null);
      canvas.classList.remove('tail-key-hover');
    }
  };

  canvas3dMouseMoveListener = handleCanvasMouseMove;
  canvas3dMouseLeaveListener = handleCanvasMouseLeave;
  canvas.addEventListener('mousemove', handleCanvasMouseMove);
  canvas.addEventListener('mouseleave', handleCanvasMouseLeave);

  // Left-click: quick tap (< 4px / < 220ms) pokes nose/tail/chin/head; drag >= 4px enters scruffed drag mode!
  const usesNativeDrag = isWindowsPlatform() || isMacPlatform();
  let resolveLinuxMouseUp: (() => void) | null = null;
  const waitForFallbackMouseUp = (): Promise<void> =>
    new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolveLinuxMouseUp = null;
        window.removeEventListener('mouseup', finish);
        window.removeEventListener('blur', finish);
        window.clearTimeout(timer);
        resolve();
      };
      resolveLinuxMouseUp = finish;
      window.addEventListener('mouseup', finish, { once: true });
      window.addEventListener('blur', finish, { once: true });
      const timer = window.setTimeout(finish, 15000);
    });

  const runPetWindowDrag = async () => {
    if (dragInFlight) return;
    releaseVirtualKey(true);
    syncKeyboardHoverCursor(false);
    engine3d?.cancelHandover();
    dragInFlight = true;
    lastDragGlobalX = null;
    lastDragGlobalY = null;
    canvas.classList.add('pet-dragging');
    canvas3d.classList.add('pet-dragging');
    // Pulling from edge immediately pops out of peek mode into scruffed drag for BOTH cats and dafeiyu!
    // Let backend `start_pet_drag` (Win/macOS) or `wait_linux_drag_end` (Linux X11) atomically read & clear
    // `state.peek_edge` so `pulled_from_edge` suppression has zero IPC race conditions.
    const wasPeeking =
      engine.getPeekEdge() !== 'none' || (engine3d?.getPeekEdge() ?? 'none') !== 'none';
    engine.setPeekPreview('none');
    engine3d?.setPeekPreview('none');
    if (wasPeeking) {
      engine.setPeekEdge('none');
      engine3d?.setPeekEdge('none');
    }
    if (active3d && engine3d) engine3d.setDragging(true);
    else engine.setDragging(true);
    if (!privacyActive) syncPetInteractionToLive({ kind: 'drag', active: true });
    let usedFallbackDrag = false;
    try {
      if (usesNativeDrag) {
        // Both Windows and macOS use native `start_pet_drag`, which coordinates `state.dragging`
        // internally (via atomic `MACOS_NATIVE_DRAG_ACTIVE` on macOS). Do NOT pre-call `set_dragging(true)`
        // beforehand; only call `set_dragging` when falling back to `getCurrentWindow().startDragging()`.
        const nativeHandled = await invoke<boolean>('start_pet_drag').catch(() => false);
        if (!nativeHandled) {
          usedFallbackDrag = true;
          if (wasPeeking) {
            void invoke('set_peek_edge', { edge: 'none' }).catch(() => {});
          }
          void invoke('set_dragging', { dragging: true });
          await getCurrentWindow().startDragging();
        }
      } else {
        usedFallbackDrag = true;
        void invoke('set_dragging', { dragging: true });
        await getCurrentWindow().startDragging();
        // On Linux, GTK `begin_move_drag` resolves immediately (~1ms) before mouse release:
        // wait until the user actually releases Button 1 (with live 200ms edge-peek preview on X11,
        // or falling back to `mouseUp` event on pure Wayland without X11).
        const linuxWaited = await invoke<boolean>('wait_linux_drag_end').catch(() => false);
        if (!linuxWaited) {
          if (wasPeeking) {
            void invoke('set_peek_edge', { edge: 'none' }).catch(() => {});
          }
          await waitForFallbackMouseUp();
        }
      }
    } finally {
      dragInFlight = false;
      lastDragGlobalX = null;
      lastDragGlobalY = null;
      canvas.classList.remove('pet-dragging');
      canvas3d.classList.remove('pet-dragging');
      engine.setDragging(false);
      engine3d?.setDragging(false);
      engine.onMouseUp('left');
      engine3d?.onMouseUp('left');
      syncPetInteractionToLive({ kind: 'drag', active: false });
      if (usedFallbackDrag) {
        void invoke('set_dragging', { dragging: false });
      }
      void invoke<string>('sync_peek_edge_after_drag')
        .then((raw) => {
          const edge: PeekEdge = raw === 'left' || raw === 'right' ? raw : 'none';
          engine.setPeekEdge(edge);
          engine3d?.setPeekEdge(edge);
          return invoke('save_window_pos');
        })
        .catch(() => {
          void invoke('save_window_pos').catch(() => {});
        });
    }
  };

  const handleCanvasMouseDown = async (e: MouseEvent) => {
    if (e.button !== 0) return;
    closeContextMenu();
    if (treatModeActive) {
      e.preventDefault();
      e.stopPropagation();
      treatPointerDown = true;
      lastTreatDomMoveAt = performance.now();
      lastTreatClientX = e.clientX;
      lastTreatClientY = e.clientY;
      getActiveTreatEngine().setTreatPointer(e.clientX, e.clientY, true);
      return;
    }
    if (tailPickerOpen) {
      const hit = engine.hitTestKeyAtClientPoint(e.clientX, e.clientY);
      if (hit) {
        e.preventDefault();
        e.stopPropagation();
        toggleTailKeyId(hit.id);
        return;
      }
    }
    if (settings.clickThroughLocked && !altOverride && !e.altKey) return;
    if (nativeDragActive || dragInFlight) return;

    const downX = e.clientX;
    const downY = e.clientY;
    const downAt = performance.now();

    // Direct desktop keyboard click: animates keycap depression, paw/tail strike, bubble & typing SFX
    // without injecting any real OS keystroke! Moving >= 6px seamlessly transitions into pet drag.
    const clickedKey = hitTestClickableKey(downX, downY, e.altKey);
    if (clickedKey) {
      e.preventDefault();
      pressVirtualKey(clickedKey);
      const DRAG_THRESHOLD_PX = 6;
      let settled = false;
      const cleanupKeyClick = () => {
        window.removeEventListener('mousemove', onKeyMove);
        window.removeEventListener('mouseup', onKeyUp);
        if (cancelPendingTapVsDrag === onKeyCancel) cancelPendingTapVsDrag = null;
        if (completePendingTapOnGlobalMouseUp === onKeyGlobalUp) {
          completePendingTapOnGlobalMouseUp = null;
        }
      };
      const onKeyMove = (ev: MouseEvent) => {
        if (settled) return;
        if (Math.hypot(ev.clientX - downX, ev.clientY - downY) >= DRAG_THRESHOLD_PX) {
          settled = true;
          cleanupKeyClick();
          releaseVirtualKey(true);
          if (!nativeDragActive) void runPetWindowDrag();
        }
      };
      const onKeyUp = () => {
        if (settled) return;
        settled = true;
        cleanupKeyClick();
        releaseVirtualKey(false);
      };
      const onKeyGlobalUp = () => {
        if (settled) return;
        settled = true;
        cleanupKeyClick();
        releaseVirtualKey(false);
      };
      const onKeyCancel = () => {
        if (settled) return;
        settled = true;
        cleanupKeyClick();
        releaseVirtualKey(true);
      };
      cancelPendingTapVsDrag?.();
      cancelPendingTapVsDrag = onKeyCancel;
      completePendingTapOnGlobalMouseUp = onKeyGlobalUp;
      window.addEventListener('mousemove', onKeyMove);
      window.addEventListener('mouseup', onKeyUp);
      return;
    }

    // On Linux, startDragging() fires immediately on mousedown outside the crisp nose/tail hotspots;
    // on nose/tail we still detect >= 6px movement so dragging from the face works while a quick tap boops/pokes!
    if (!usesNativeDrag) {
      const zone =
        active3d && engine3d
          ? engine3d.hitTestCatZoneAtClientPoint(downX, downY)
          : engine.hitTestCatZoneAtClientPoint(downX, downY);
      if (zone !== 'nose' && zone !== 'tail') {
        await runPetWindowDrag();
        return;
      }
      const DRAG_THRESHOLD_PX = 6;
      const TAP_MAX_MS = 320;
      let settled = false;
      let globalUpFallbackTimer: number | null = null;
      const cleanupLinux = () => {
        window.removeEventListener('mousemove', onLinuxMove);
        window.removeEventListener('mouseup', onLinuxUp);
        if (globalUpFallbackTimer !== null) {
          window.clearTimeout(globalUpFallbackTimer);
          globalUpFallbackTimer = null;
        }
        if (cancelPendingTapVsDrag === onLinuxCancel) cancelPendingTapVsDrag = null;
        if (completePendingTapOnGlobalMouseUp === onLinuxGlobalUp) {
          completePendingTapOnGlobalMouseUp = null;
        }
      };
      const onLinuxMove = (ev: MouseEvent) => {
        if (settled) return;
        if (Math.hypot(ev.clientX - downX, ev.clientY - downY) >= DRAG_THRESHOLD_PX) {
          settled = true;
          cleanupLinux();
          void runPetWindowDrag();
        }
      };
      const onLinuxUp = (ev: MouseEvent) => {
        if (settled) return;
        settled = true;
        cleanupLinux();
        const dt = performance.now() - downAt;
        const dist = Math.hypot(ev.clientX - downX, ev.clientY - downY);
        if (dist < DRAG_THRESHOLD_PX && dt <= TAP_MAX_MS) {
          fireCatTap(downX, downY);
        }
      };
      const onLinuxGlobalUp = () => {
        if (settled || globalUpFallbackTimer !== null) return;
        const dt = performance.now() - downAt;
        globalUpFallbackTimer = window.setTimeout(() => {
          globalUpFallbackTimer = null;
          if (settled) return;
          settled = true;
          cleanupLinux();
          if (!nativeDragActive && !dragInFlight && dt <= TAP_MAX_MS) {
            fireCatTap(downX, downY);
          }
        }, 28);
      };
      const onLinuxCancel = () => {
        if (settled) return;
        settled = true;
        cleanupLinux();
      };
      cancelPendingTapVsDrag?.();
      cancelPendingTapVsDrag = onLinuxCancel;
      completePendingTapOnGlobalMouseUp = onLinuxGlobalUp;
      window.addEventListener('mousemove', onLinuxMove);
      window.addEventListener('mouseup', onLinuxUp);
      return;
    }

    // On Windows & macOS (native 120Hz start_pet_drag), wait up to 6px movement or 320ms hold
    // to cleanly separate Tap (boop nose/head or poke tail) vs Scruff Drag!
    const DRAG_THRESHOLD_PX = 6;
    const TAP_MAX_MS = 320;
    let settled = false;
    let holdTimer: number | null = null;
    let globalUpFallbackTimer: number | null = null;

    const cleanup = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (holdTimer !== null) {
        window.clearTimeout(holdTimer);
        holdTimer = null;
      }
      if (globalUpFallbackTimer !== null) {
        window.clearTimeout(globalUpFallbackTimer);
        globalUpFallbackTimer = null;
      }
      if (cancelPendingTapVsDrag === onCancel) {
        cancelPendingTapVsDrag = null;
      }
      if (completePendingTapOnGlobalMouseUp === onGlobalUp) {
        completePendingTapOnGlobalMouseUp = null;
      }
    };

    const beginDrag = () => {
      if (settled) return;
      settled = true;
      cleanup();
      if (nativeDragActive) return;
      void runPetWindowDrag();
    };

    const onMove = (ev: MouseEvent) => {
      if (Math.hypot(ev.clientX - downX, ev.clientY - downY) >= DRAG_THRESHOLD_PX) {
        beginDrag();
      }
    };

    const onUp = (ev: MouseEvent) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (nativeDragActive) return;
      const dt = performance.now() - downAt;
      const dist = Math.hypot(ev.clientX - downX, ev.clientY - downY);
      if (dist < DRAG_THRESHOLD_PX && dt <= TAP_MAX_MS) {
        fireCatTap(downX, downY);
      }
    };

    const onGlobalUp = () => {
      if (settled) return;
      // Left button is already released at OS level: disarm drag hold immediately!
      if (holdTimer !== null) {
        window.clearTimeout(holdTimer);
        holdTimer = null;
      }
      if (globalUpFallbackTimer !== null) return;
      const dt = performance.now() - downAt;
      globalUpFallbackTimer = window.setTimeout(() => {
        globalUpFallbackTimer = null;
        if (settled) return;
        settled = true;
        cleanup();
        if (!nativeDragActive && !dragInFlight && dt <= TAP_MAX_MS) {
          fireCatTap(downX, downY);
        }
      }, 28);
    };

    const onCancel = () => {
      if (settled) return;
      settled = true;
      cleanup();
    };

    cancelPendingTapVsDrag?.();
    cancelPendingTapVsDrag = onCancel;
    completePendingTapOnGlobalMouseUp = onGlobalUp;
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    holdTimer = window.setTimeout(beginDrag, TAP_MAX_MS);
  };
  canvas3dMouseDownListener = handleCanvasMouseDown;
  canvas.addEventListener('mousedown', handleCanvasMouseDown);

  // Right-click opens sleek dark glass settings menu (both 2D & 3D canvases!)
  const handleCanvasContextMenu = (e: MouseEvent) => {
    e.preventDefault();
    if (treatModeActive) {
      cleanupTreatModeDesktop(true);
      return;
    }
    if (tailPickerSaving) return;
    if (tailPickerOpen) {
      closeTailPicker();
    }
    if (settings.clickThroughLocked && !altOverride && !e.altKey) return;
    openContextMenu(e.clientX, e.clientY);
  };
  canvas3dContextMenuListener = handleCanvasContextMenu;
  canvas.addEventListener('contextmenu', handleCanvasContextMenu);
  const handleCanvasDblClick = () => {
    if (engine.getPeekEdge() !== 'none' || (engine3d?.getPeekEdge() ?? 'none') !== 'none') {
      engine.setPeekEdge('none');
      engine3d?.setPeekEdge('none');
      void invoke('set_peek_edge', { edge: 'none' }).catch(() => {});
    }
  };
  canvas3dDblClickListener = handleCanvasDblClick;
  canvas.addEventListener('dblclick', handleCanvasDblClick);
  bindCanvas3dListeners(canvas3d);

  // Side menu window auto-closes on its own focus loss; do NOT close on main blur (clicking the menu blurs main!)
  window.addEventListener('keydown', (e) => {
    if (tailPickerOpen) {
      // Enter and Space can be selected without activating the focused toolbar button.
      e.preventDefault();
    } else if (e.key === 'Escape') {
      if (treatModeActive) {
        cleanupTreatModeDesktop(true);
      } else {
        closeContextMenu();
      }
    }
  });

  menuEl.addEventListener('click', (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>(
      '[data-action], [data-scale], [data-breed], [data-rendermode], [data-collar], [data-headphonemode], [data-tabletmode], [data-gamepadmode], [data-eyegazemode], [data-kblayout], [data-kborient], [data-pointer], [data-finish], [data-tailmode], [data-fpscap], [data-lang]',
    );
    if (!target) return;

    const fpsAttr = target.dataset.fpscap;
    if (fpsAttr === '0' || fpsAttr === '30') {
      void applySettingsPatch({ fpsCap: fpsAttr === '30' ? 30 : 0 });
      return;
    }

    const langAttr = target.dataset.lang;
    if (langAttr) {
      void applySettingsPatch({ language: normalizeLanguageSetting(langAttr) });
      return;
    }

    const headphoneAttr = target.dataset.headphonemode;
    if (headphoneAttr === 'auto' || headphoneAttr === 'on' || headphoneAttr === 'off') {
      void applySettingsPatch({ headphoneMode: headphoneAttr });
      return;
    }

    const tabletAttr = target.dataset.tabletmode;
    if (tabletAttr === 'auto' || tabletAttr === 'mouse' || tabletAttr === 'tablet') {
      void applySettingsPatch({ tabletMode: tabletAttr });
      return;
    }

    const gamepadAttr = target.dataset.gamepadmode;
    if (gamepadAttr === 'auto' || gamepadAttr === 'off' || gamepadAttr === 'on') {
      void applySettingsPatch({ gamepadMode: gamepadAttr });
      return;
    }

    const eyeGazeAttr = target.dataset.eyegazemode;
    if (eyeGazeAttr === 'screen' || eyeGazeAttr === 'window') {
      void applySettingsPatch({ eyeGazeMode: eyeGazeAttr });
      return;
    }

    const renderModeAttr = target.dataset.rendermode;
    if (renderModeAttr === '2d' || renderModeAttr === '3d') {
      void applySettingsPatch({ renderMode: renderModeAttr });
      return;
    }

    const collarAttr = target.dataset.collar;
    if (
      collarAttr === 'none' ||
      collarAttr === 'red' ||
      collarAttr === 'blue' ||
      collarAttr === 'pink' ||
      collarAttr === 'green'
    ) {
      void applySettingsPatch({ collarColor: collarAttr });
      return;
    }

    const pointer = target.dataset.pointer;
    if (pointer === 'mouse' || pointer === 'trackpad') {
      void applySettingsPatch({ trackpadEnabled: pointer === 'trackpad' });
      return;
    }

    const finish = target.dataset.finish;
    if (finish === 'black' || finish === 'white') {
      void applySettingsPatch({ whiteKeyboard: finish === 'white' });
      return;
    }

    const kbLayoutAttr = target.dataset.kblayout;
    if (isKeyboardLayoutId(kbLayoutAttr)) {
      void applySettingsPatch({ keyboardLayout: kbLayoutAttr });
      closeContextMenu();
      return;
    }

    const kbOrientAttr = target.dataset.kborient;
    if (kbOrientAttr === 'cat' || kbOrientAttr === 'viewer') {
      void applySettingsPatch({ keyboardOrientation: kbOrientAttr });
      closeContextMenu();
      return;
    }

    const tailModeAttr = target.dataset.tailmode;
    if (
      tailModeAttr === 'smart' ||
      tailModeAttr === 'custom' ||
      tailModeAttr === 'edge' ||
      tailModeAttr === 'off'
    ) {
      void applySettingsPatch({ tailKeyMode: tailModeAttr });
      return;
    }

    const breedAttr = target.dataset.breed;
    if (breedAttr) {
      void applySettingsPatch({ catBreed: breedAttr });
      closeContextMenu();
      return;
    }

    const scaleAttr = target.dataset.scale;
    if (scaleAttr) {
      void applySettingsPatch({ scale: Number(scaleAttr) });
      closeContextMenu();
      return;
    }

    switch (target.dataset.action) {
      case 'feed-treat':
        closeContextMenu();
        startTreatModeDesktop(settings.treatFlavor);
        break;
      case 'toggle-privacy':
        void applySettingsPatch({ privacyPasswordGuard: !(settings.privacyPasswordGuard !== false) });
        break;
      case 'toggle-bubbles':
        void applySettingsPatch({ showKeyBubbles: !settings.showKeyBubbles });
        break;
      case 'toggle-lock':
        void applySettingsPatch({ clickThroughLocked: !settings.clickThroughLocked });
        closeContextMenu();
        break;
      case 'toggle-sound':
        void applySettingsPatch({ soundEnabled: !settings.soundEnabled });
        break;
      case 'toggle-idle-purr':
        void applySettingsPatch({ idlePurrEnabled: !settings.idlePurrEnabled });
        break;
      case 'toggle-typing-sound':
        void applySettingsPatch({ typingSoundEnabled: !settings.typingSoundEnabled });
        break;
      case 'toggle-switch-animation':
        void applySettingsPatch({ laoWuHandover: settings.laoWuHandover === false });
        break;
      case 'toggle-mute': {
        const curVol = normalizeVolume(settings.soundVolume);
        const currentlyMuted = Boolean(settings.soundMuted) || curVol <= 0.001;
        if (currentlyMuted) {
          const nextVol = curVol <= 0.001 ? 0.5 : curVol;
          void applySettingsPatch({ soundMuted: false, soundVolume: nextVol });
        } else {
          void applySettingsPatch({ soundMuted: true });
        }
        break;
      }
      case 'toggle-top':
        void applySettingsPatch({ alwaysOnTop: !settings.alwaysOnTop });
        break;
      case 'toggle-yield-fullscreen':
        void applySettingsPatch({ yieldOnFullscreen: !settings.yieldOnFullscreen });
        break;
      case 'toggle-autostart':
        void invoke<AppSettings>('set_autostart_mode', {
          autostart: !settings.autostart,
          autostartAdmin: false,
        })
          .then((saved) => {
            settings = { ...settings, ...saved };
            syncMenuUI();
          })
          .catch(() => {
            syncMenuUI();
          });
        break;
      case 'toggle-autostart-admin':
        if (adminStatus.supported) {
          void invoke<AppSettings>('set_autostart_mode', {
            autostart: true,
            autostartAdmin: !(settings.autostart && settings.autostartAdmin),
          })
            .then((saved) => {
              settings = { ...settings, ...saved };
              syncMenuUI();
            })
            .catch(() => {
              syncMenuUI();
            });
        }
        break;
      case 'toggle-mcp':
        void applySettingsPatch({ mcpEnabled: !settings.mcpEnabled });
        break;
      case 'copy-mcp':
        void copyMcpConfig();
        break;
      case 'copy-hooks':
        void copyAgentHooksConfig();
        break;
      case 'restart-admin':
        if (adminStatus.supported && !adminStatus.elevated) {
          closeContextMenu();
          void invoke('restart_as_admin').catch(() => {});
        }
        break;
      case 'desktop-shortcut':
        void createDesktopShortcut();
        break;
      case 'check-update':
        void triggerManualUpdateCheck();
        break;
      case 'open-tail-picker':
        void openTailPicker();
        break;
      case 'reset-pos':
        void invoke('reset_position');
        closeContextMenu();
        break;
      case 'quit':
        void invoke('quit_app');
        break;
    }
  });

  // On Windows 7/8 (where Microsoft WebView2 does not support DirectComposition alpha),
  // stream the live 2D Canvas RGBA pixels via zero-copy binary IPC to a native Win32
  // UpdateLayeredWindow(ULW_ALPHA) presenter window for true 256-level per-pixel anti-aliased
  // transparency (zero white box, zero jagged edges) on both Aero and Win7 Basic desktops.
  try {
    const useWin7Ulw = await invoke<boolean>('is_win7_ulw_mode');
    if (useWin7Ulw) {
      isWin7Ulw = true;
      applyPetOpacity(settings.opacity);
      activateRenderEngine();
      document.documentElement.classList.add('win7-ulw-mode');
      const petCtx = canvas.getContext('2d');
      let win7Visible = true;
      let frameBusy = false;
      let lastPresentMs = 0;
      let lastFrameKey = '';
      let lastOverlayKey = '';

      const syncWin7Overlay = (focusMenu = false) => {
        const dpr = Math.max(window.devicePixelRatio || 1, 1);
        const physW = Math.max(1, Math.round(window.innerWidth * dpr));
        const physH = Math.max(1, Math.round(window.innerHeight * dpr));
        const rects: number[] = [];

        if (menuEl && !menuEl.classList.contains('hidden')) {
          const r = menuEl.getBoundingClientRect();
          if (r.width > 2 && r.height > 2) {
            rects.push(
              Math.max(0, Math.floor(r.left * dpr)),
              Math.max(0, Math.floor(r.top * dpr)),
              Math.min(physW, Math.ceil(r.right * dpr)),
              Math.min(physH, Math.ceil(r.bottom * dpr)),
              Math.round(12 * dpr),
            );
          }
        }
        if (tailPickerBarEl && !tailPickerBarEl.classList.contains('hidden')) {
          const toolbar = tailPickerBarEl.getBoundingClientRect();
          const closeButton = btnTailCancelEl.getBoundingClientRect();
          const pickerRegions = [
            { rect: toolbar, radius: 13 },
            { rect: closeButton, radius: closeButton.width / 2 },
          ];
          for (const { rect, radius } of pickerRegions) {
            if (rect.width <= 2 || rect.height <= 2) continue;
            rects.push(
              Math.max(0, Math.floor(rect.left * dpr)),
              Math.max(0, Math.floor(rect.top * dpr)),
              Math.min(physW, Math.ceil(rect.right * dpr)),
              Math.min(physH, Math.ceil(rect.bottom * dpr)),
              Math.round(radius * dpr),
            );
          }
        }
        if (updateToastEl && !updateToastEl.classList.contains('hidden')) {
          const r = updateToastEl.getBoundingClientRect();
          if (r.width > 2 && r.height > 2) {
            const top = Math.max(0, Math.floor(r.top * dpr));
            const bot = Math.min(physH, Math.ceil(r.bottom * dpr));
            rects.push(
              Math.max(0, Math.floor(r.left * dpr)),
              top,
              Math.min(physW, Math.ceil(r.right * dpr)),
              bot,
              Math.max(8, Math.round((bot - top) / 2)),
            );
          }
        }
        if (treatHudPillEl && !treatHudPillEl.classList.contains('hidden')) {
          const r = treatHudPillEl.getBoundingClientRect();
          if (r.width > 2 && r.height > 2) {
            const top = Math.max(0, Math.floor(r.top * dpr));
            const bot = Math.min(physH, Math.ceil(r.bottom * dpr));
            rects.push(
              Math.max(0, Math.floor(r.left * dpr)),
              top,
              Math.min(physW, Math.ceil(r.right * dpr)),
              bot,
              Math.max(8, Math.round((bot - top) / 2)),
            );
          }
        }

        const key = rects.join(',');
        if (!focusMenu && key === lastOverlayKey) return;
        lastOverlayKey = key;
        void invoke('win7_sync_overlay', { rects, focusMenu });
      };
      syncWin7OverlayFn = syncWin7Overlay;

      await listen<{ x: number; y: number }>('kuro-win7-contextmenu', (ev) => {
        openContextMenu(ev.payload.x, ev.payload.y);
      });
      await listen('kuro-win7-close-menu', () => {
        closeContextMenu();
      });
      await listen<boolean>('kuro-win7-visibility', (ev) => {
        win7Visible = Boolean(ev.payload);
        if (win7Visible) {
          lastFrameKey = '';
        }
      });

      const presentWin7Frame = () => {
        if (!win7Visible || frameBusy || !petCtx) return;
        const now = performance.now();
        if (now - lastPresentMs < 28) return;
        const w = canvas.width;
        const h = canvas.height;
        if (w < 8 || h < 8) return;

        const imgData = petCtx.getImageData(0, 0, w, h);
        const u32 = new Uint32Array(
          imgData.data.buffer,
          imgData.data.byteOffset,
          imgData.data.byteLength >>> 2,
        );
        let hash = 2166136261 >>> 0;
        hash = Math.imul(hash ^ w, 16777619) >>> 0;
        hash = Math.imul(hash ^ h, 16777619) >>> 0;
        for (let i = 0; i < u32.length; i++) {
          hash = Math.imul(hash ^ u32[i], 16777619) >>> 0;
        }
        const key = `${w}x${h}:${hash}`;
        if (key === lastFrameKey) return;

        lastFrameKey = key;
        lastPresentMs = now;
        frameBusy = true;
        const payload = new Uint8Array(
          imgData.data.buffer,
          imgData.data.byteOffset,
          imgData.data.byteLength,
        );
        void invoke('win7_present_frame', payload, {
          headers: { 'x-w': String(w), 'x-h': String(h) },
        }).finally(() => {
          frameBusy = false;
        });
      };

      engine.onAfterRender = presentWin7Frame;
      // Kick initial presentation immediately & keep overlay bounds in sync if toast/menu resizes
      setTimeout(presentWin7Frame, 30);
      setInterval(() => syncWin7Overlay(false), 200);
    }
  } catch {
    // Non-Win7 or unsupported: keep native transparency untouched
  }

  // Issue #41 safety reminder: when click-through lock was persisted across restarts,
  // briefly show a one-click [解锁] toast so users can never feel trapped (even at 20%-36% scale).
  if (
    settings.clickThroughLocked &&
    !(settings.obsEnabled && settings.obsHidePet) &&
    !(settings.liveCaptureEnabled && settings.liveHidePet)
  ) {
    showUpdateToast(formatLockedToastText(true), {
      showUnlock: true,
      autoHideMs: 5200,
      kind: 'transient',
    });
  }

  // If the background updater already discovered a release before the webview finished loading, show it.
  try {
    const cachedUpd = await invoke<UpdateInfo | null>('get_cached_update_info');
    if (cachedUpd?.hasUpdate) {
      latestUpdateInfo = cachedUpd;
      setUpdateHint(`⬆ v${cachedUpd.latestVersion}`, 'ready');
      if (updateToastEl.classList.contains('hidden')) {
        showPendingUpdateToast();
      }
    }
  } catch {
    // Ignore if command unavailable
  }
}

void bootstrap();
