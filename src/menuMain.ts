import './style.css';
import { syncDeskOptions } from './deskOptions';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { DEFAULT_TAIL_KEY_IDS, type KeyboardOrientation, type TailKeyMode } from './tailKeyTypes';
import { DEFAULT_BUILTIN_CATS, type CatSkinConfig } from './catSkins';
import type { TreatFlavor } from './treatTypes';
import { isKeyboardLayoutId, normalizeKeyboardLayout, type KeyboardLayoutId } from './keyboardLayout';
import {
  applyDomTranslations,
  isMacPlatform,
  localizeBreedName,
  normalizeLanguageSetting,
  setActiveLocale,
  t,
} from './i18n';

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
  obsEnabled: boolean;
  obsPort: number;
  obsHidePet: boolean;
  liveCaptureEnabled?: boolean;
  liveChromaColor?: 'blue' | 'green' | 'magenta';
  liveHidePet?: boolean;
  renderMode?: '2d' | '3d';
  collarColor?: 'none' | 'red' | 'blue' | 'pink' | 'green';
  headphoneMode?: 'auto' | 'on' | 'off';
  tabletMode?: 'auto' | 'mouse' | 'tablet';
  gamepadMode?: 'auto' | 'off' | 'on';
  eyeGazeMode?: 'screen' | 'window';
  fpsCap?: number;
  language?: string;
  treatFlavor?: TreatFlavor;
  treatFedCount?: number;
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
  stage: 'checking' | 'available' | 'up_to_date' | 'downloading' | 'verifying' | 'installing' | 'error';
  message: string;
  info?: UpdateInfo | null;
}

interface AdminStatus {
  supported: boolean;
  elevated: boolean;
  macInputDiag?: boolean;
}

type MenuTabId = 'appearance' | 'interact' | 'system';
type InteractSectionId = 'keyboard' | 'peripherals' | 'emotions' | 'companion';

const BREED_COLLAPSED_STORAGE_KEY = 'kurocat_breed_collapsed';
const INTERACT_COLLAPSED_STORAGE_KEY = 'kurocat_interact_collapsed_v2';

const DEFAULT_INTERACT_COLLAPSED: Record<InteractSectionId, boolean> = {
  keyboard: true,
  peripherals: true,
  emotions: true,
  companion: false,
};

function loadBreedCollapsed(): boolean {
  try {
    return window.localStorage.getItem(BREED_COLLAPSED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function saveBreedCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(BREED_COLLAPSED_STORAGE_KEY, collapsed ? '1' : '0');
  } catch {
    // ignore storage errors
  }
}

function loadInteractCollapsed(): Record<InteractSectionId, boolean> {
  const out: Record<InteractSectionId, boolean> = { ...DEFAULT_INTERACT_COLLAPSED };
  try {
    const raw = window.localStorage.getItem(INTERACT_COLLAPSED_STORAGE_KEY);
    if (!raw) return out;
    const parsed = JSON.parse(raw) as Partial<Record<InteractSectionId, unknown>>;
    (Object.keys(out) as InteractSectionId[]).forEach((k) => {
      if (typeof parsed[k] === 'boolean') {
        out[k] = parsed[k] as boolean;
      }
    });
  } catch {
    // ignore storage errors
  }
  return out;
}

function saveInteractCollapsed(state: Record<InteractSectionId, boolean>): void {
  try {
    window.localStorage.setItem(INTERACT_COLLAPSED_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore storage errors
  }
}

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
  autostart: true,
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
  obsEnabled: false,
  obsPort: 27421,
  obsHidePet: false,
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
let resolvedBackendLocale: string | null = null;
let sliderDragging = false;
let opacitySliderDragging = false;
let volumeSliderDragging = false;
let currentAppVersion = '5.1.5';
let cachedUpdateInfo: UpdateInfo | null = null;
let updateBusy = false;
let activeTab: MenuTabId = 'appearance';
let breedCollapsed = loadBreedCollapsed();
let interactCollapsed: Record<InteractSectionId, boolean> = loadInteractCollapsed();
let shouldScrollActiveBreed = true;
let settingsPatchSeq = 0;
let padUnavailable = false;
let adminStatus: AdminStatus = { supported: false, elevated: false, macInputDiag: false };
let pauseHotkeyStatus: 'active' | 'conflict' | 'disabled' = 'active';
let recordingPauseHotkey = false;

const menuEl = document.getElementById('context-menu') as HTMLDivElement;
const tabBodyEl = document.getElementById('menu-tab-body') as HTMLDivElement | null;
const breedCardEl = document.getElementById('breed-card') as HTMLElement | null;
const btnBreedCollapseEl = document.getElementById('btn-breed-collapse') as HTMLButtonElement | null;
const breedActivePreviewEl = document.getElementById('breed-active-preview') as HTMLSpanElement | null;
const breedPillsEl = document.getElementById('breed-pills') as HTMLDivElement;
const breedCountEl = document.getElementById('breed-count') as HTMLSpanElement | null;
const scaleSliderEl = document.getElementById('scale-slider') as HTMLInputElement;
const scaleValueEl = document.getElementById('scale-value') as HTMLButtonElement;
const opacitySliderEl = document.getElementById('opacity-slider') as HTMLInputElement | null;
const opacityValueEl = document.getElementById('opacity-value') as HTMLButtonElement | null;
const volumeSliderEl = document.getElementById('volume-slider') as HTMLInputElement | null;
const volumeValueEl = document.getElementById('volume-value') as HTMLButtonElement | null;
const btnVolumeMuteEl = document.getElementById('btn-volume-mute') as HTMLButtonElement | null;
const btnHeaderMuteEl = document.getElementById('btn-header-mute') as HTMLButtonElement | null;
const tailModeBadgeEl = document.getElementById('tail-mode-badge') as HTMLSpanElement;
const tailKeysCountEl = document.getElementById('tail-keys-count') as HTMLSpanElement;
const kbSummaryPillEl = document.getElementById('kb-summary-pill') as HTMLSpanElement | null;
const peripheralsSummaryPillEl = document.getElementById('peripherals-summary-pill') as HTMLSpanElement | null;
const emotionsSummaryPillEl = document.getElementById('emotions-summary-pill') as HTMLSpanElement | null;
const treatFedBadgeEl = document.getElementById('treat-fed-badge') as HTMLSpanElement | null;
const btnOpenTailPickerEl = document.getElementById('btn-open-tail-picker') as HTMLButtonElement | null;
const langSelectEl = document.getElementById('lang-select') as HTMLSelectElement | null;
const btnHeaderAdminEl = document.getElementById('btn-header-admin') as HTMLButtonElement | null;
const btnRestartAdminEl = document.getElementById('btn-restart-admin') as HTMLButtonElement | null;
const adminRestartLabelEl = document.getElementById('admin-restart-label') as HTMLSpanElement | null;
const swAutostartEl = document.getElementById('sw-autostart') as HTMLButtonElement | null;
const autostartAdminWrapEl = document.getElementById('autostart-admin-wrap') as HTMLDivElement | null;
const swAutostartAdminEl = document.getElementById('sw-autostart-admin') as HTMLButtonElement | null;
const btnMacInputDiagEl = document.getElementById('btn-mac-input-diag') as HTMLButtonElement | null;
const macInputDiagLabelEl = document.getElementById('mac-input-diag-label') as HTMLSpanElement | null;
const btnHeaderLockEl = document.getElementById('btn-header-lock') as HTMLButtonElement | null;
const mcpCardBodyEl = document.getElementById('mcp-card-body') as HTMLDivElement | null;
const obsCardBodyEl = document.getElementById('obs-card-body') as HTMLDivElement | null;
const obsPortPillEl = document.getElementById('obs-port-pill') as HTMLSpanElement | null;
const liveCardBodyEl = document.getElementById('live-card-body') as HTMLDivElement | null;
const btnCheckUpdateEl = document.getElementById('btn-check-update') as HTMLButtonElement | null;
const lockKbdEl = document.getElementById('lock-kbd') as HTMLElement | null;
const emotionHotkeysKbdEl = document.getElementById('emotion-hotkeys-kbd') as HTMLElement | null;
const btnPauseHotkeyEl = document.getElementById('btn-pause-hotkey') as HTMLButtonElement | null;
const btnPauseHotkeyClearEl = document.getElementById('btn-pause-hotkey-clear') as HTMLButtonElement | null;
const pauseHotkeyHintEl = document.getElementById('pause-hotkey-hint') as HTMLDivElement | null;

const STANDALONE_HOTKEY_CODES = new Set([
  'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12', 'Pause', 'ScrollLock',
]);

function normalizeKeyboardEventToPauseHotkey(e: KeyboardEvent): string | null {
  const code = e.code || '';
  if (
    !code ||
    code.startsWith('Control') ||
    code.startsWith('Alt') ||
    code.startsWith('Shift') ||
    code.startsWith('Meta') ||
    code === 'OSLeft' ||
    code === 'OSRight'
  ) {
    return null;
  }

  let keyPart: string | null = null;
  if (/^Key[A-Z]$/.test(code)) {
    keyPart = code.slice(3);
  } else if (/^Digit[0-9]$/.test(code)) {
    keyPart = code.slice(5);
  } else if (/^F([1-9]|1[0-2])$/.test(code)) {
    keyPart = code;
  } else if (
    code === 'Pause' ||
    code === 'ScrollLock' ||
    code === 'Insert' ||
    code === 'Delete' ||
    code === 'Home' ||
    code === 'End' ||
    code === 'PageUp' ||
    code === 'PageDown' ||
    code === 'Space' ||
    code === 'Backquote' ||
    code === 'Minus' ||
    code === 'Equal' ||
    code === 'BracketLeft' ||
    code === 'BracketRight' ||
    code === 'Semicolon' ||
    code === 'Quote' ||
    code === 'Comma' ||
    code === 'Period' ||
    code === 'Slash' ||
    code === 'Backslash'
  ) {
    keyPart = code;
  }
  if (!keyPart) return null;

  const hasCtrl = e.ctrlKey || e.metaKey;
  const hasAlt = e.altKey;
  const hasShift = e.shiftKey;
  if (!STANDALONE_HOTKEY_CODES.has(keyPart) && !hasCtrl && !hasAlt && !hasShift) {
    return null;
  }

  const parts: string[] = [];
  if (hasCtrl) parts.push('Ctrl');
  if (hasAlt) parts.push('Alt');
  if (hasShift) parts.push('Shift');
  parts.push(keyPart);
  return parts.join('+');
}

function renderPauseHotkeyUI(): void {
  const spec = (settings.pauseHotkey ?? '').trim();
  if (btnPauseHotkeyEl) {
    btnPauseHotkeyEl.classList.toggle('is-recording', recordingPauseHotkey);
    btnPauseHotkeyEl.classList.toggle('is-unset', !recordingPauseHotkey && !spec);
    btnPauseHotkeyEl.classList.toggle(
      'is-conflict',
      !recordingPauseHotkey && Boolean(spec) && pauseHotkeyStatus === 'conflict',
    );
    if (recordingPauseHotkey) {
      btnPauseHotkeyEl.textContent = t('menu.pause_hotkey_recording');
    } else if (spec) {
      btnPauseHotkeyEl.textContent = isMacPlatform()
        ? spec.replace(/Ctrl/g, '⌃').replace(/Alt/g, '⌥').replace(/Shift/g, '⇧')
        : spec;
    } else {
      btnPauseHotkeyEl.textContent = t('menu.pause_hotkey_unset');
    }
  }
  if (btnPauseHotkeyClearEl) {
    btnPauseHotkeyClearEl.classList.toggle('hidden', !spec && !recordingPauseHotkey);
    btnPauseHotkeyClearEl.setAttribute('aria-label', t('menu.pause_hotkey_clear'));
  }
  if (pauseHotkeyHintEl) {
    const showConflict = !recordingPauseHotkey && Boolean(spec) && pauseHotkeyStatus === 'conflict';
    pauseHotkeyHintEl.classList.toggle('hidden', !showConflict);
    pauseHotkeyHintEl.textContent = showConflict ? t('menu.pause_hotkey_conflict') : '';
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
  return `${emoji} KuroCat · ${bareName}`;
}

function switchTab(nextTab: MenuTabId): void {
  activeTab = nextTab;
  document.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((btn) => {
    const isActive = btn.dataset.tab === activeTab;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });
  document.querySelectorAll<HTMLElement>('[data-tab-panel]').forEach((panel) => {
    panel.classList.toggle('hidden', panel.dataset.tabPanel !== activeTab);
  });
  if (tabBodyEl) {
    tabBodyEl.scrollTop = 0;
  }
}

function renderFooterUpdateState(customLabel?: string, ready = false): void {
  const hint = document.getElementById('update-hint');
  const isReady = ready || Boolean(cachedUpdateInfo?.hasUpdate);
  if (btnCheckUpdateEl) {
    btnCheckUpdateEl.classList.toggle('update-ready', isReady);
  }
  if (!hint) return;
  if (customLabel) {
    hint.textContent = customLabel;
  } else if (cachedUpdateInfo?.hasUpdate) {
    hint.textContent = `⬆ ${t('menu.update_ready', { ver: cachedUpdateInfo.latestVersion })}`;
  } else {
    hint.textContent = t('menu.check_update', { ver: currentAppVersion });
  }
}

function closeMenu(): void {
  void invoke('close_context_menu');
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
  if (btnHeaderMuteEl) {
    btnHeaderMuteEl.classList.toggle('is-muted', effectivelyMuted);
    btnHeaderMuteEl.setAttribute('aria-pressed', effectivelyMuted ? 'true' : 'false');
  }
}

function renderBreedPills(): void {
  if (!breedPillsEl) return;

  if (breedCountEl) {
    breedCountEl.textContent = String(catList.length);
  }
  if (breedCardEl) {
    breedCardEl.classList.toggle('is-collapsed', breedCollapsed);
  }
  if (btnBreedCollapseEl) {
    btnBreedCollapseEl.setAttribute('aria-expanded', breedCollapsed ? 'false' : 'true');
  }

  const activeCat = catList.find((c) => c.id === settings.catBreed) ?? catList[0];
  if (breedActivePreviewEl) {
    breedActivePreviewEl.textContent = activeCat ? formatBreedPillLabel(activeCat) : '';
    breedActivePreviewEl.classList.toggle('hidden', !breedCollapsed || !activeCat);
  }

  breedPillsEl.innerHTML = '';

  let activeBtn: HTMLButtonElement | null = null;
  for (const cat of catList) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'breed-pill';
    btn.dataset.breed = cat.id;
    const label = formatBreedPillLabel(cat);
    btn.title = label;

    const swatch = document.createElement('span');
    swatch.className = 'breed-swatch';
    swatch.style.background = cat.furColor || cat.accentColor || '#c8f538';
    btn.appendChild(swatch);

    const text = document.createElement('span');
    text.className = 'breed-pill-label';
    text.textContent = label;
    btn.appendChild(text);

    if (cat.builtin === false) {
      const dot = document.createElement('span');
      dot.className = 'breed-custom-dot';
      dot.setAttribute('aria-hidden', 'true');
      dot.textContent = '✦';
      btn.appendChild(dot);
    }

    const accent = cat.accentColor || (cat.id === 'ragdoll' ? '#7ac7ff' : '#c8f538');
    btn.style.setProperty('--pill-accent', accent);
    const isActive = cat.id === settings.catBreed;
    btn.classList.toggle('active', isActive);
    if (isActive) activeBtn = btn;
    breedPillsEl.appendChild(btn);
  }

  if (!breedCollapsed && shouldScrollActiveBreed && activeBtn) {
    shouldScrollActiveBreed = false;
    requestAnimationFrame(() => {
      activeBtn?.scrollIntoView({ block: 'nearest' });
    });
  }
}

function syncInteractCollapseUI(): void {
  const kbLayout: KeyboardLayoutId = normalizeKeyboardLayout(settings.keyboardLayout);
  const kbLabelKey =
    kbLayout === '98'
      ? 'menu.kb_98_short'
      : kbLayout === '108'
        ? 'menu.kb_108_short'
        : kbLayout === 'macbook'
          ? 'menu.kb_macbook'
          : 'menu.kb_65_short';
  const orientKey = settings.keyboardOrientation === 'viewer' ? 'menu.kb_viewer' : 'menu.kb_cat';
  if (kbSummaryPillEl) {
    kbSummaryPillEl.textContent = `${t(kbLabelKey)} · ${t(orientKey)}`;
    kbSummaryPillEl.classList.toggle('hidden', !interactCollapsed.keyboard);
  }

  const tailMode: TailKeyMode =
    settings.tailKeyMode === 'custom' ||
    settings.tailKeyMode === 'edge' ||
    settings.tailKeyMode === 'off'
      ? settings.tailKeyMode
      : 'smart';
  const tailIds = Array.isArray(settings.tailKeyIds) ? settings.tailKeyIds : [...DEFAULT_TAIL_KEY_IDS];
  if (peripheralsSummaryPillEl) {
    peripheralsSummaryPillEl.textContent =
      tailMode === 'custom'
        ? `${t('menu.tail_badge_custom')} · ${t('menu.tail_keys_count', { count: tailIds.length })}`
        : t(`menu.tail_badge_${tailMode}`);
    peripheralsSummaryPillEl.classList.toggle('hidden', !interactCollapsed.peripherals);
  }

  if (emotionsSummaryPillEl) {
    emotionsSummaryPillEl.classList.toggle('hidden', !interactCollapsed.emotions);
  }

  (Object.keys(interactCollapsed) as InteractSectionId[]).forEach((sectionId) => {
    const collapsed = interactCollapsed[sectionId];
    const card = document.querySelector<HTMLElement>(`[data-collapse-card="${sectionId}"]`);
    const btn = document.querySelector<HTMLButtonElement>(`[data-collapse-toggle="${sectionId}"]`);
    if (card) card.classList.toggle('is-collapsed', collapsed);
    if (btn) btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  });
}

function normalizeTreatFlavor(raw: string | undefined): TreatFlavor {
  if (raw === 'chicken' || raw === 'salmon' || raw === 'bonito') return raw;
  return 'tuna';
}

function setToggleSwitch(id: string, on: boolean): void {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.toggle('is-on', on);
  el.setAttribute('aria-checked', on ? 'true' : 'false');
}

function syncUI(): void {
  setActiveLocale(settings.language, resolvedBackendLocale);
  applyDomTranslations();

  if (lockKbdEl) {
    lockKbdEl.textContent = isMacPlatform() ? 'Option' : 'Alt';
  }
  const macModPrefix = isMacPlatform() ? '⌥⇧' : 'Alt+Shift+';
  if (emotionHotkeysKbdEl) {
    emotionHotkeysKbdEl.textContent = `${macModPrefix}1~6`;
  }
  document.querySelectorAll<HTMLButtonElement>('[data-emotion]').forEach((btn) => {
    const key = btn.dataset.hotkey;
    if (key) {
      btn.title = `${macModPrefix}${key}`;
    }
  });

  setToggleSwitch('sw-privacy', settings.privacyPasswordGuard !== false);
  setToggleSwitch('sw-bubbles', settings.showKeyBubbles);
  setToggleSwitch('sw-lock', settings.clickThroughLocked);
  setToggleSwitch('sw-sound', settings.soundEnabled);
  setToggleSwitch('sw-idle-purr', Boolean(settings.idlePurrEnabled));
  setToggleSwitch('sw-typing-sound', Boolean(settings.typingSoundEnabled));
  setToggleSwitch('sw-switch-animation', settings.laoWuHandover !== false);
  setToggleSwitch('sw-emotion-hotkeys', settings.expressionHotkeys !== false);
  setToggleSwitch('sw-top', settings.alwaysOnTop);
  setToggleSwitch('sw-yield-fullscreen', Boolean(settings.yieldOnFullscreen));
  setToggleSwitch('sw-autostart', settings.autostart);
  setToggleSwitch('sw-autostart-admin', Boolean(settings.autostart && settings.autostartAdmin));
  renderPauseHotkeyUI();
  if (autostartAdminWrapEl) {
    autostartAdminWrapEl.classList.toggle('hidden', !adminStatus.supported);
  }
  setToggleSwitch('sw-mcp', settings.mcpEnabled);
  setToggleSwitch('sw-obs', Boolean(settings.obsEnabled));
  setToggleSwitch('sw-obs-hide', Boolean(settings.obsEnabled && settings.obsHidePet));
  setToggleSwitch('sw-live', Boolean(settings.liveCaptureEnabled));
  setToggleSwitch('sw-live-hide', Boolean(settings.liveCaptureEnabled && settings.liveHidePet));

  if (btnHeaderLockEl) {
    btnHeaderLockEl.classList.toggle('is-locked', settings.clickThroughLocked);
    btnHeaderLockEl.setAttribute('aria-pressed', settings.clickThroughLocked ? 'true' : 'false');
  }

  const adminText = t(adminStatus.elevated ? 'menu.admin_ready' : 'menu.admin_restart');
  const macDiagText = t('menu.mac_input_diag');
  const showHeaderShield = adminStatus.supported || Boolean(adminStatus.macInputDiag);
  if (btnHeaderAdminEl) {
    btnHeaderAdminEl.classList.toggle('hidden', !showHeaderShield);
    btnHeaderAdminEl.classList.toggle('is-elevated', adminStatus.supported && adminStatus.elevated);
    btnHeaderAdminEl.disabled = adminStatus.supported && adminStatus.elevated;
    btnHeaderAdminEl.dataset.action = adminStatus.supported ? 'restart-admin' : 'mac-input-diag';
    const headerTip = adminStatus.supported ? adminText : macDiagText;
    btnHeaderAdminEl.title = headerTip;
    btnHeaderAdminEl.setAttribute('aria-label', headerTip);
  }
  if (btnRestartAdminEl) {
    btnRestartAdminEl.classList.toggle('hidden', !adminStatus.supported);
    btnRestartAdminEl.classList.toggle('is-elevated', adminStatus.elevated);
    btnRestartAdminEl.disabled = adminStatus.elevated;
    btnRestartAdminEl.title = adminText;
  }
  if (adminRestartLabelEl) {
    adminRestartLabelEl.textContent = adminText;
  }
  if (btnMacInputDiagEl) {
    btnMacInputDiagEl.classList.toggle('hidden', !adminStatus.macInputDiag);
    btnMacInputDiagEl.title = macDiagText;
  }
  if (macInputDiagLabelEl) {
    macInputDiagLabelEl.textContent = macDiagText;
  }

  // Conditionally reveal MCP, OBS & Live Capture bodies only when enabled
  if (mcpCardBodyEl) {
    mcpCardBodyEl.classList.toggle('hidden', !settings.mcpEnabled);
  }
  if (obsCardBodyEl) {
    obsCardBodyEl.classList.toggle('hidden', !settings.obsEnabled);
  }
  if (obsPortPillEl) {
    obsPortPillEl.textContent = `:${settings.obsPort || 27421}`;
    obsPortPillEl.classList.toggle('hidden', !settings.obsEnabled);
  }
  if (liveCardBodyEl) {
    liveCardBodyEl.classList.toggle('hidden', !settings.liveCaptureEnabled);
  }
  const liveChromaColor =
    settings.liveChromaColor === 'green' || settings.liveChromaColor === 'magenta'
      ? settings.liveChromaColor
      : 'blue';
  document.querySelectorAll<HTMLButtonElement>('[data-livechroma]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.livechroma === liveChromaColor);
  });

  const obsHint = document.getElementById('obs-copy-hint');
  if (obsHint && !obsHint.classList.contains('copied')) {
    obsHint.textContent = t('menu.obs_hint');
  }
  const mcpHint = document.getElementById('mcp-copy-hint');
  if (mcpHint && !mcpHint.classList.contains('copied')) {
    mcpHint.textContent = t('menu.copy_mcp');
  }
  const hooksHint = document.getElementById('hooks-copy-hint');
  if (hooksHint && !hooksHint.classList.contains('copied')) {
    hooksHint.textContent = t('menu.copy_hooks');
  }
  const shortcutHint = document.getElementById('shortcut-hint');
  if (shortcutHint && !shortcutHint.classList.contains('copied')) {
    shortcutHint.textContent = t('menu.desktop_shortcut_short');
  }

  if (!sliderDragging) {
    updateScaleSliderVisual(settings.scale);
  }
  if (!opacitySliderDragging) {
    updateOpacitySliderVisual(settings.opacity);
  }
  if (!volumeSliderDragging) {
    updateVolumeSliderVisual(settings.soundVolume, settings.soundMuted);
  }

  const kbLayout: KeyboardLayoutId = normalizeKeyboardLayout(settings.keyboardLayout);
  const kbOrient: KeyboardOrientation = settings.keyboardOrientation === 'viewer' ? 'viewer' : 'cat';
  syncDeskOptions(settings, isMacPlatform(), padUnavailable);
  document.querySelectorAll<HTMLButtonElement>('[data-kblayout]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.kblayout === kbLayout);
  });
  document.querySelectorAll<HTMLButtonElement>('[data-kborient]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.kborient === kbOrient);
  });

  const fpsCap = settings.fpsCap === 30 ? '30' : '0';
  document.querySelectorAll<HTMLButtonElement>('[data-fpscap]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.fpscap === fpsCap);
  });

  const langSetting = normalizeLanguageSetting(settings.language);
  if (langSelectEl) {
    langSelectEl.value = langSetting;
  }

  const tailMode: TailKeyMode =
    settings.tailKeyMode === 'custom' ||
    settings.tailKeyMode === 'edge' ||
    settings.tailKeyMode === 'off'
      ? settings.tailKeyMode
      : 'smart';
  const tailIds = Array.isArray(settings.tailKeyIds) ? settings.tailKeyIds : [...DEFAULT_TAIL_KEY_IDS];
  document.querySelectorAll<HTMLButtonElement>('[data-tailmode]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tailmode === tailMode);
  });
  if (tailModeBadgeEl) {
    tailModeBadgeEl.textContent = t(`menu.tail_badge_${tailMode}`);
  }
  if (tailKeysCountEl) {
    tailKeysCountEl.textContent = t('menu.tail_keys_count', { count: tailIds.length });
  }
  if (btnOpenTailPickerEl) {
    btnOpenTailPickerEl.classList.toggle('hidden', tailMode !== 'custom');
  }

  const treatFlavor = normalizeTreatFlavor(settings.treatFlavor);
  document.querySelectorAll<HTMLButtonElement>('[data-treatflavor]').forEach((btn) => {
    const isActive = btn.dataset.treatflavor === treatFlavor;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-checked', isActive ? 'true' : 'false');
  });
  if (treatFedBadgeEl) {
    const fedCount = typeof settings.treatFedCount === 'number' && Number.isFinite(settings.treatFedCount)
      ? Math.max(0, Math.floor(settings.treatFedCount))
      : 0;
    treatFedBadgeEl.textContent = t('menu.treat_fed_count', { count: fedCount });
    treatFedBadgeEl.classList.toggle('hidden', fedCount <= 0);
  }

  syncInteractCollapseUI();

  const activeCat = catList.find((c) => c.id === settings.catBreed) ?? catList[0];
  renderBreedPills();

  const renderMode = settings.renderMode === '2d' ? '2d' : '3d';
  const collarColor =
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
    const isActive = btn.dataset.collar === collarColor;
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-checked', isActive ? 'true' : 'false');
  });

  const isDafeiyu = settings.catBreed === 'dafeiyu';
  document.getElementById('style-card')?.classList.toggle('hidden', isDafeiyu);
  document.getElementById('render-mode-row')?.classList.toggle('hidden', isDafeiyu);
  document.getElementById('treat-card')?.classList.toggle('hidden', isDafeiyu);
  const collarRowEl = document.getElementById('collar-row');
  if (collarRowEl) {
    collarRowEl.classList.toggle('hidden', renderMode === '2d' || isDafeiyu);
  }

  const headphoneMode =
    settings.headphoneMode === 'auto' || settings.headphoneMode === 'on'
      ? settings.headphoneMode
      : 'off';
  document.querySelectorAll<HTMLButtonElement>('[data-headphonemode]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.headphonemode === headphoneMode);
  });
  const headphoneRowEl = document.getElementById('headphone-row');
  if (headphoneRowEl) {
    headphoneRowEl.classList.toggle('hidden', isDafeiyu);
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
    tabletRowEl.classList.toggle('hidden', isDafeiyu);
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
  document.getElementById('eye-gaze-row')?.classList.toggle('hidden', isDafeiyu);
  document.getElementById('eye-gaze-divider')?.classList.toggle('hidden', isDafeiyu);
  const gamepadRowEl = document.getElementById('gamepad-row');
  if (gamepadRowEl) {
    gamepadRowEl.classList.toggle('hidden', isDafeiyu);
  }

  const headerEl = document.getElementById('menu-header');
  if (headerEl && activeCat) {
    headerEl.textContent = formatHeaderCatName(activeCat);
    headerEl.style.color = activeCat.accentColor || '#c8f538';
  }

  if (!updateBusy) {
    renderFooterUpdateState();
  }
}

async function applySettingsPatch(patch: Partial<AppSettings>): Promise<void> {
  const seq = ++settingsPatchSeq;
  settings = { ...settings, ...patch };
  syncUI();
  try {
    const updated = await invoke<AppSettings>('update_settings', { patch: settings });
    if (seq !== settingsPatchSeq) return;
    settings = updated;
    syncUI();
  } catch (err) {
    console.error('Failed to update settings:', err);
  }
}

let autostartBusy = false;

async function applyAutostartMode(nextAutostart: boolean, nextAdmin: boolean): Promise<void> {
  if (autostartBusy) return;
  autostartBusy = true;
  if (swAutostartEl) swAutostartEl.disabled = true;
  if (swAutostartAdminEl) swAutostartAdminEl.disabled = true;
  try {
    const updated = await invoke<AppSettings>('set_autostart_mode', {
      autostart: nextAutostart,
      autostartAdmin: nextAutostart && nextAdmin,
    });
    settings = { ...settings, ...updated };
    syncUI();
  } catch (err) {
    // UAC cancelled or OS denied: refresh UI from honest backend state
    console.warn('Autostart mode change aborted:', err);
    syncUI();
  } finally {
    autostartBusy = false;
    if (swAutostartEl) swAutostartEl.disabled = false;
    if (swAutostartAdminEl) swAutostartAdminEl.disabled = false;
  }
}

async function copyText(text: string): Promise<void> {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
}

async function copyMcpConfig(): Promise<void> {
  const hint = document.getElementById('mcp-copy-hint');
  try {
    const jsonText = await invoke<string>('get_mcp_config');
    await copyText(jsonText);
    if (hint) {
      hint.textContent = t('menu.copied_hint');
      hint.classList.add('copied');
      setTimeout(() => {
        hint.textContent = t('menu.copy_mcp');
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
    await copyText(jsonText);
    if (hint) {
      hint.textContent = t('menu.copied_hint');
      hint.classList.add('copied');
      setTimeout(() => {
        hint.textContent = t('menu.copy_hooks');
        hint.classList.remove('copied');
      }, 1800);
    }
  } catch (err) {
    console.error('Failed to copy Agent hooks config:', err);
  }
}

async function copyObsUrl(): Promise<void> {
  const hint = document.getElementById('obs-copy-hint');
  try {
    if (!settings.obsEnabled) {
      await applySettingsPatch({ obsEnabled: true });
    }
    const url = await invoke<string>('get_obs_url');
    await copyText(url);
    if (hint) {
      hint.textContent = t('menu.copied_hint');
      hint.classList.add('copied');
      setTimeout(() => {
        hint.classList.remove('copied');
        hint.textContent = t('menu.obs_hint');
      }, 2000);
    }
  } catch (err) {
    console.error('Failed to copy OBS url:', err);
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
        hint.textContent = t('menu.desktop_shortcut_short');
        hint.classList.remove('copied');
      }, 1800);
    }
  } catch (err) {
    console.error('Failed to create shortcut:', err);
    if (hint) {
      hint.textContent = '✕';
      setTimeout(() => {
        hint.textContent = t('menu.desktop_shortcut_short');
      }, 1800);
    }
  }
}

async function triggerManualUpdateCheck(): Promise<void> {
  if (updateBusy) return;
  if (cachedUpdateInfo?.hasUpdate) {
    if (cachedUpdateInfo.downloadUrl) {
      updateBusy = true;
      renderFooterUpdateState(t('menu.checking_short'), true);
      closeMenu();
      try {
        await invoke('install_update', { info: cachedUpdateInfo });
      } catch {
        updateBusy = false;
        renderFooterUpdateState();
      }
      return;
    }
    if (cachedUpdateInfo.releaseUrl) {
      void invoke('open_release_page', { url: cachedUpdateInfo.releaseUrl });
      closeMenu();
      return;
    }
  }

  updateBusy = true;
  renderFooterUpdateState(t('menu.checking_short'), false);
  try {
    const info = await invoke<UpdateInfo>('check_for_update');
    updateBusy = false;
    if (info.hasUpdate) {
      cachedUpdateInfo = info;
      renderFooterUpdateState(`⬆ ${t('menu.update_ready', { ver: info.latestVersion })}`, true);
    } else {
      cachedUpdateInfo = info;
      renderFooterUpdateState(`✓ v${info.currentVersion}`, false);
      setTimeout(() => {
        renderFooterUpdateState();
      }, 2200);
    }
  } catch {
    updateBusy = false;
    renderFooterUpdateState('⚠ Retry', false);
    setTimeout(() => {
      renderFooterUpdateState();
    }, 2200);
  }
}

async function bootstrap(): Promise<void> {
  if (isMacPlatform()) {
    const shortcutBtn = document.getElementById('btn-desktop-shortcut');
    if (shortcutBtn) shortcutBtn.classList.add('hidden');
    const actionRow = document.getElementById('sys-action-row');
    if (actionRow) actionRow.classList.add('single-action');
  }

  let resolveInitReady!: () => void;
  const initReadyPromise = new Promise<void>((resolve) => {
    resolveInitReady = resolve;
  });

  // Register menu click delegation immediately so fast clicks right after side-menu
  // recreation (post 25s idle destroy) are queued behind initial IPC load rather than dropped.
  menuEl.addEventListener('click', (e) => {
    const tabBtn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-tab]');
    if (tabBtn) {
      const next = tabBtn.dataset.tab;
      if (next === 'appearance' || next === 'interact' || next === 'system') {
        switchTab(next);
      }
      return;
    }

    const collapseBtn = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-collapse-toggle]');
    if (collapseBtn) {
      const section = collapseBtn.dataset.collapseToggle as InteractSectionId | undefined;
      if (section && section in interactCollapsed) {
        interactCollapsed[section] = !interactCollapsed[section];
        saveInteractCollapsed(interactCollapsed);
        syncInteractCollapseUI();
      }
      return;
    }

    const target = (e.target as HTMLElement).closest<HTMLElement>(
      '[data-action], [data-emotion], [data-treatflavor], [data-breed], [data-rendermode], [data-collar], [data-headphonemode], [data-tabletmode], [data-gamepadmode], [data-eyegazemode], [data-kblayout], [data-kborient], [data-pointer], [data-finish], [data-tailmode], [data-fpscap], [data-livechroma]',
    );
    if (!target) return;

    void initReadyPromise.then(() => {
      const treatFlavorAttr = target.dataset.treatflavor;
      if (
        treatFlavorAttr === 'tuna' ||
        treatFlavorAttr === 'chicken' ||
        treatFlavorAttr === 'salmon' ||
        treatFlavorAttr === 'bonito'
      ) {
        void applySettingsPatch({ treatFlavor: treatFlavorAttr });
        return;
      }

      const emotionAttr = target.dataset.emotion;
      if (emotionAttr) {
        target.classList.add('is-fired');
        window.setTimeout(() => target.classList.remove('is-fired'), 180);
        void invoke('trigger_pet_emotion', { emotion: emotionAttr }).catch(() => {});
        return;
      }

      const liveChromaAttr = target.dataset.livechroma;
      if (liveChromaAttr === 'blue' || liveChromaAttr === 'green' || liveChromaAttr === 'magenta') {
        void applySettingsPatch({ liveChromaColor: liveChromaAttr });
        return;
      }

      const fpsAttr = target.dataset.fpscap;
      if (fpsAttr === '0' || fpsAttr === '30') {
        void applySettingsPatch({ fpsCap: fpsAttr === '30' ? 30 : 0 });
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
        return;
      }

      const kbOrientAttr = target.dataset.kborient;
      if (kbOrientAttr === 'cat' || kbOrientAttr === 'viewer') {
        void applySettingsPatch({ keyboardOrientation: kbOrientAttr });
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
        return;
      }

      switch (target.dataset.action) {
        case 'toggle-privacy':
          void applySettingsPatch({ privacyPasswordGuard: !(settings.privacyPasswordGuard !== false) });
          break;
        case 'toggle-bubbles':
          void applySettingsPatch({ showKeyBubbles: !settings.showKeyBubbles });
          break;
        case 'toggle-lock':
          void applySettingsPatch({ clickThroughLocked: !settings.clickThroughLocked });
          closeMenu();
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
        case 'toggle-mute': {
          const curVol = normalizeVolume(settings.soundVolume);
          const currentlyMuted = Boolean(settings.soundMuted) || curVol <= 0.001;
          if (currentlyMuted) {
            const nextVol = curVol <= 0.001 ? 0.5 : curVol;
            void invoke('preview_sound_volume', { volume: nextVol, muted: false }).catch(() => {});
            void applySettingsPatch({ soundMuted: false, soundVolume: nextVol });
          } else {
            void invoke('preview_sound_volume', { volume: curVol, muted: true }).catch(() => {});
            void applySettingsPatch({ soundMuted: true });
          }
          break;
        }
        case 'toggle-expression-hotkeys':
          void applySettingsPatch({ expressionHotkeys: !(settings.expressionHotkeys !== false) });
          break;
        case 'toggle-top':
          void applySettingsPatch({ alwaysOnTop: !settings.alwaysOnTop });
          break;
        case 'toggle-yield-fullscreen':
          void applySettingsPatch({ yieldOnFullscreen: !settings.yieldOnFullscreen });
          break;
        case 'toggle-autostart':
          void applyAutostartMode(!settings.autostart, false);
          break;
        case 'toggle-autostart-admin':
          if (adminStatus.supported) {
            void applyAutostartMode(true, !(settings.autostart && settings.autostartAdmin));
          }
          break;
        case 'toggle-obs': {
          const nextObs = !settings.obsEnabled;
          void applySettingsPatch({
            obsEnabled: nextObs,
            obsHidePet: nextObs ? settings.obsHidePet : false,
          });
          break;
        }
        case 'copy-obs':
          void copyObsUrl();
          break;
        case 'toggle-obs-hide': {
          const nextHide = !settings.obsHidePet;
          void applySettingsPatch({ obsHidePet: nextHide });
          if (nextHide) {
            closeMenu();
          }
          break;
        }
        case 'toggle-live-capture': {
          const nextLive = !settings.liveCaptureEnabled;
          void applySettingsPatch({
            liveCaptureEnabled: nextLive,
            liveHidePet: nextLive ? Boolean(settings.liveHidePet) : false,
          });
          break;
        }
        case 'toggle-live-hide': {
          const nextHide = !settings.liveHidePet;
          void applySettingsPatch({ liveHidePet: nextHide });
          if (nextHide) {
            closeMenu();
          }
          break;
        }
        case 'toggle-mcp':
          void applySettingsPatch({ mcpEnabled: !settings.mcpEnabled });
          break;
        case 'toggle-switch-animation':
          void applySettingsPatch({ laoWuHandover: settings.laoWuHandover === false });
          break;
        case 'copy-mcp':
          void copyMcpConfig();
          break;
        case 'copy-hooks':
          void copyAgentHooksConfig();
          break;
        case 'open-tail-picker':
          void invoke('open_tail_picker_from_menu');
          break;
        case 'feed-treat':
          void invoke('start_treat_feed_from_menu', {
            flavor: normalizeTreatFlavor(settings.treatFlavor),
          }).catch(() => {});
          break;
        case 'restart-admin':
          if (adminStatus.supported && !adminStatus.elevated) {
            closeMenu();
            void invoke('restart_as_admin').catch(() => {});
          }
          break;
        case 'mac-input-diag':
          if (adminStatus.macInputDiag) {
            closeMenu();
            void invoke('diagnose_macos_input').catch(() => {});
          }
          break;
        case 'desktop-shortcut':
          void createDesktopShortcut();
          break;
        case 'reset-pos':
          void invoke('reset_position');
          closeMenu();
          break;
        case 'check-update':
          void triggerManualUpdateCheck();
          break;
        case 'quit':
          void invoke('quit_app');
          break;
      }
    });
  });

  if (langSelectEl) {
    langSelectEl.addEventListener('change', () => {
      void initReadyPromise.then(() => {
        void applySettingsPatch({ language: normalizeLanguageSetting(langSelectEl.value) });
      });
    });
  }

  let inTauri = true;
  try {
    const [loadedSettings, loadedCats, ver, cachedUpd, resolvedLoc, loadedAdmin] = await Promise.all([
      invoke<AppSettings>('get_settings'),
      invoke<CatSkinConfig[]>('get_cats'),
      invoke<string>('get_app_version'),
      invoke<UpdateInfo | null>('get_cached_update_info').catch(() => null),
      invoke<string>('get_resolved_locale').catch(() => ''),
      invoke<AdminStatus>('get_admin_status').catch(() => ({ supported: false, elevated: false })),
    ]);
    settings = loadedSettings;
    adminStatus = loadedAdmin;
    if (Array.isArray(loadedCats) && loadedCats.length > 0) {
      catList = loadedCats;
    }
    if (ver) {
      currentAppVersion = ver;
    }
    if (cachedUpd) {
      cachedUpdateInfo = cachedUpd;
    }
    if (resolvedLoc) {
      resolvedBackendLocale = resolvedLoc;
    }
  } catch (err) {
    inTauri = false;
    console.warn('Running menu outside Tauri IPC:', err);
    // Allow static browser layout verification via ?lang=en-US&tab=system&obs=1&tail=custom
    const params = new URLSearchParams(window.location.search);
    const qLang = params.get('lang');
    if (qLang) settings.language = qLang;
    if (params.get('obs') === '1') settings.obsEnabled = true;
    if (params.get('live') === '1') settings.liveCaptureEnabled = true;
    if (params.get('mcp') === '0') settings.mcpEnabled = false;
    const qTail = params.get('tail');
    if (qTail === 'smart' || qTail === 'custom' || qTail === 'edge' || qTail === 'off') {
      settings.tailKeyMode = qTail;
    }
    const qBreed = params.get('breed');
    if (qBreed) settings.catBreed = qBreed;
    const qTab = params.get('tab');
    if (qTab === 'appearance' || qTab === 'interact' || qTab === 'system') activeTab = qTab;
    if (params.get('muted') === '1') settings.soundMuted = true;
    const qVol = params.get('vol');
    if (qVol !== null && Number.isFinite(Number(qVol))) {
      settings.soundVolume = normalizeVolume(Number(qVol));
    }
    if (params.get('collapsed') === '1') breedCollapsed = true;
    if (params.get('admin') === '1') adminStatus = { supported: true, elevated: false };
    const qFed = params.get('fed');
    if (qFed !== null && Number.isFinite(Number(qFed))) {
      settings.treatFedCount = Math.max(0, Math.floor(Number(qFed)));
    }
    // Populate all 7 built-in characters (+ optional ?custom=N for multi-skin layout verification outside Tauri)
    catList = [
      ...DEFAULT_BUILTIN_CATS.slice(0, 2),
      { ...DEFAULT_BUILTIN_CATS[0], id: 'orange-tabby', name: '大橘猫', emoji: '🍊', furColor: '#e89844', accentColor: '#ff9f43', builtin: true },
      { ...DEFAULT_BUILTIN_CATS[0], id: 'calico', name: '三花猫', emoji: '🌸', furColor: '#fbf7f0', accentColor: '#ff7eb3', builtin: true },
      { ...DEFAULT_BUILTIN_CATS[0], id: 'tuxedo', name: '奶牛猫', emoji: '🐄', furColor: '#1a1b1f', accentColor: '#d0d7de', builtin: true },
      { ...DEFAULT_BUILTIN_CATS[0], id: 'siamese', name: '暹罗猫', emoji: '☕', furColor: '#eee5d8', accentColor: '#c9a679', builtin: true },
      DEFAULT_BUILTIN_CATS[2],
    ];
    const customN = Math.max(0, Math.min(24, Number(params.get('custom') || '0') || 0));
    for (let i = 1; i <= customN; i++) {
      catList.push({
        ...DEFAULT_BUILTIN_CATS[0],
        id: `custom-pet-${i}`,
        name: `定制萌宠 ${i}`,
        emoji: i % 2 === 0 ? '🦊' : '🐯',
        furColor: i % 3 === 0 ? '#7ec8e3' : i % 3 === 1 ? '#f4a261' : '#e76f51',
        accentColor: '#c8f538',
        builtin: false,
      });
    }
  }
  syncUI();
  renderFooterUpdateState();
  switchTab(activeTab);
  resolveInitReady();

  if (btnBreedCollapseEl) {
    btnBreedCollapseEl.addEventListener('click', (e) => {
      e.stopPropagation();
      breedCollapsed = !breedCollapsed;
      saveBreedCollapsed(breedCollapsed);
      if (!breedCollapsed) {
        shouldScrollActiveBreed = true;
      }
      renderBreedPills();
    });
  }

  if (inTauri) {
    const [isWin7, hkStatus] = await Promise.all([
      invoke<boolean>('is_win7_ulw_mode').catch(() => false),
      invoke<string>('get_pause_hotkey_status').catch(() => 'active'),
    ]);
    if (hkStatus === 'conflict' || hkStatus === 'disabled' || hkStatus === 'active') {
      pauseHotkeyStatus = hkStatus;
    }
    if (isWin7) {
      document.documentElement.classList.add('win7-ulw-mode');
    }
    syncUI();
    if (isMacPlatform()) {
      await listen<boolean>('kuro-trackpad-unavailable', (ev) => {
        padUnavailable = ev.payload;
        syncUI();
      });
      padUnavailable = await invoke<boolean>('trackpad_unavailable').catch(() => false);
      syncUI();
    }
  }

  document.getElementById('btn-close-menu')?.addEventListener('click', () => closeMenu());

  if (btnPauseHotkeyEl) {
    btnPauseHotkeyEl.addEventListener('click', (e) => {
      e.stopPropagation();
      recordingPauseHotkey = !recordingPauseHotkey;
      renderPauseHotkeyUI();
    });
  }

  if (btnPauseHotkeyClearEl) {
    btnPauseHotkeyClearEl.addEventListener('click', (e) => {
      e.stopPropagation();
      recordingPauseHotkey = false;
      pauseHotkeyStatus = 'disabled';
      void applySettingsPatch({ pauseHotkey: '' });
      renderPauseHotkeyUI();
    });
  }

  window.addEventListener('blur', () => {
    if (recordingPauseHotkey) {
      recordingPauseHotkey = false;
      renderPauseHotkeyUI();
    }
  });

  window.addEventListener('click', (e) => {
    if (
      recordingPauseHotkey &&
      e.target instanceof Node &&
      !btnPauseHotkeyEl?.contains(e.target) &&
      !btnPauseHotkeyClearEl?.contains(e.target)
    ) {
      recordingPauseHotkey = false;
      renderPauseHotkeyUI();
    }
  });

  window.addEventListener('keydown', (e) => {
    if (recordingPauseHotkey) {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') {
        recordingPauseHotkey = false;
        renderPauseHotkeyUI();
        return;
      }
      if ((e.key === 'Backspace' || e.key === 'Delete') && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey) {
        recordingPauseHotkey = false;
        pauseHotkeyStatus = 'disabled';
        void applySettingsPatch({ pauseHotkey: '' });
        renderPauseHotkeyUI();
        return;
      }
      const combo = normalizeKeyboardEventToPauseHotkey(e);
      if (combo) {
        recordingPauseHotkey = false;
        void applySettingsPatch({ pauseHotkey: combo });
        renderPauseHotkeyUI();
      }
      return;
    }
    if (e.key === 'Escape') closeMenu();
  });

  if (scaleSliderEl) {
    scaleSliderEl.addEventListener('pointerdown', () => {
      sliderDragging = true;
    });
    scaleSliderEl.addEventListener('input', () => {
      sliderDragging = true;
      const nextScale = Math.max(0.2, Math.min(1.5, Number(scaleSliderEl.value) / 100));
      updateScaleSliderVisual(nextScale);
      void invoke('preview_scale', { scale: nextScale }).catch(() => {});
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
      void invoke('preview_sound_volume', { volume: nextVol, muted: nextMuted }).catch(() => {});
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
      void invoke('preview_sound_volume', { volume: nextVol, muted: false }).catch(() => {});
      void applySettingsPatch({ soundVolume: nextVol, soundMuted: false });
    });
  }

  if (!inTauri) return;

  await listen<AppSettings>('kuro-settings', (ev) => {
    settings = ev.payload;
    syncUI();
  });

  await listen<string>('kuro-pause-hotkey-status', (ev) => {
    const st = ev.payload;
    if (st === 'active' || st === 'conflict' || st === 'disabled') {
      pauseHotkeyStatus = st;
      renderPauseHotkeyUI();
    }
  });

  await listen<CatSkinConfig[]>('kuro-cats', (ev) => {
    if (Array.isArray(ev.payload) && ev.payload.length > 0) {
      catList = ev.payload;
      syncUI();
    }
  });

  await listen<UpdateProgressEvent>('kuro-update-status', (ev) => {
    if (ev.payload.info) {
      cachedUpdateInfo = ev.payload.info;
    }
    if (ev.payload.stage === 'available' && cachedUpdateInfo?.hasUpdate) {
      updateBusy = false;
      renderFooterUpdateState();
    } else if (
      ev.payload.stage === 'downloading' ||
      ev.payload.stage === 'verifying' ||
      ev.payload.stage === 'installing'
    ) {
      updateBusy = true;
      renderFooterUpdateState(t('menu.checking_short'), true);
    } else if (ev.payload.stage === 'up_to_date' || ev.payload.stage === 'error') {
      updateBusy = false;
      renderFooterUpdateState();
    }
  });

  await listen('kuro-menu-opened', async () => {
    try {
      const [latestSettings, latestCats, cachedUpd, resolvedLoc, hkStatus] = await Promise.all([
        invoke<AppSettings>('get_settings'),
        invoke<CatSkinConfig[]>('get_cats'),
        invoke<UpdateInfo | null>('get_cached_update_info').catch(() => null),
        invoke<string>('get_resolved_locale').catch(() => ''),
        invoke<string>('get_pause_hotkey_status').catch(() => 'active'),
      ]);
      settings = latestSettings;
      recordingPauseHotkey = false;
      if (hkStatus === 'active' || hkStatus === 'conflict' || hkStatus === 'disabled') {
        pauseHotkeyStatus = hkStatus;
      }
      if (Array.isArray(latestCats) && latestCats.length > 0) {
        catList = latestCats;
      }
      if (cachedUpd) {
        cachedUpdateInfo = cachedUpd;
      }
      if (resolvedLoc) {
        resolvedBackendLocale = resolvedLoc;
      }
      syncUI();
      renderFooterUpdateState();
      if (tabBodyEl) tabBodyEl.scrollTop = 0;
    } catch {}
  });
}

void bootstrap();
