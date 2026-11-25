import { CharacterLoader, type ActiveCharacter } from './characterLoader';
import { BUILTIN_CHARACTER, CharacterStateReceiver } from './characterSync';
import {
  DEFAULT_TAIL_KEY_IDS,
  KuroCatEngine,
  type KeyboardOrientation,
  type TailKeyMode,
} from './catEngine';
import { catAudio } from './audio';
import { DEFAULT_BUILTIN_CATS, type CatSkinConfig } from './catSkins';
import type { KeyboardLayoutId } from './keyboardLayout';
import type { CollarColorId, KuroCatEngine3D } from './catEngine3d';

type ObsRenderMode = '2d' | '3d';
type ObsHeadphoneMode = 'auto' | 'on' | 'off';

interface ObsAppSettings {
  activeCharacterId?: string | null;
  characterOutfits?: Record<string,string>;
  scale?: number;
  showKeyBubbles?: boolean;
  catBreed?: string;
  keyboardLayout?: KeyboardLayoutId;
  keyboardOrientation?: KeyboardOrientation;
  tailKeyMode?: TailKeyMode;
  tailKeyIds?: string[];
  renderMode?: ObsRenderMode;
  collarColor?: CollarColorId;
  headphoneMode?: ObsHeadphoneMode;
}

type InputEvent =
  | { kind: 'keyDown'; vk: number; scan: number; repeat: boolean }
  | { kind: 'keyUp'; vk: number; scan: number }
  | { kind: 'mouseDown'; button: string }
  | { kind: 'mouseUp'; button: string }
  | { kind: 'mouseWheel'; delta: number }
  | { kind: 'mouseMove'; x: number; y: number; nx: number; ny: number }
  | { kind: 'privacyTyping' };

interface ObsStateSnapshot {
  settings?: ObsAppSettings;
  cats?: CatSkinConfig[];
  privacy?: boolean;
  gameActive?: boolean;
  characterState?:unknown;
}

const canvas = document.getElementById('obs-canvas') as HTMLCanvasElement;
const canvas3d = document.getElementById('obs-canvas-3d') as HTMLCanvasElement;
const engine = new KuroCatEngine(canvas);

let engine3d: KuroCatEngine3D | null = null;
let loading3d: Promise<void> | null = null;
let active3d = false;
let webglBlocked = false;
let privacyActive = false;
let gameActive = false;

// Mute audio inside OBS Browser Source so purring never double-plays on stream
catAudio.setEnabled(false);

// Optional query overrides for streamers (e.g. /obs?mode=3d&collar=red&scale=1.15&bubbles=0&breed=ragdoll&layout=108&orient=viewer)
const params = new URLSearchParams(window.location.search);
const overrideBreed = params.get('breed')?.trim() || null;
const followDesktopCharacter=!overrideBreed;
engine.setCharacterFollower(followDesktopCharacter);
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
const overrideLayout = params.get('layout') === '108' ? '108' : params.get('layout') === '65' ? '65' : null;
const overrideOrient = params.get('orient') === 'viewer' ? 'viewer' : params.get('orient') === 'cat' ? 'cat' : null;
const overrideBubbles = params.has('bubbles') ? params.get('bubbles') !== '0' && params.get('bubbles') !== 'false' : null;
const rawScaleParam = params.get('scale');
const overrideScale =
  rawScaleParam !== null && Number.isFinite(Number(rawScaleParam))
    ? Math.max(0.2, Math.min(2.0, Number(rawScaleParam)))
    : null;

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
};

const characterStatus=document.getElementById('obs-character-status')!;
const characterError=document.getElementById('obs-character-error')!;
const characterRetry=document.getElementById('obs-character-retry') as HTMLButtonElement;
async function requireCharacterResponse(response:Response,resource:string):Promise<Response> {
  if(response.ok)return response;
  const failure: {code?:unknown;message?:unknown}|null=await response.json().catch(()=>null);
  const code=typeof failure?.code==='string'?failure.code:`HTTP_${response.status}`;
  throw new Error(`${resource}（${code}）`);
}
const characterLoader = new CharacterLoader({
  active: async()=> {
    const id=currentSettings.activeCharacterId;if(!id)return null;
    const response=await requireCharacterResponse(await fetch(`/characters/${encodeURIComponent(id)}/manifest`,{cache:'no-store'}),'人物配置不可用');
    return response.json() as Promise<ActiveCharacter>;
  },
  asset: async(id,revision,path)=>{
    const response=await requireCharacterResponse(await fetch(`/characters/${id}/${revision}/${path}`,{cache:'no-store'}),'人物素材不可用');
    return response.arrayBuffer();
  },
},actor=>{
  engine.setProceduralCharacter(actor);
  if(!actor){const cat=catList.find(c=>c.id===currentSettings.catBreed)??catList[0];engine.setCatAppearance(cat?.id??'black',cat);}
  engine.setKeyboardConfig(overrideLayout??(currentSettings.keyboardLayout==='108'?'108':'65'),overrideOrient??(currentSettings.keyboardOrientation==='viewer'?'viewer':'cat'));
  characterStatus.hidden=true;characterError.textContent='';
},error=>{
  characterError.textContent=`人物加载失败，暂时显示备用猫咪。${String(error)}。可重试，或在桌面重新导入、选择人物。`;
  characterStatus.hidden=false;
});
characterRetry.addEventListener('click',async()=>{
  characterRetry.disabled=true;
  try {await characterLoader.sync(followDesktopCharacter&&!!currentSettings.activeCharacterId);}
  finally {characterRetry.disabled=false;}
});
const characterReceiver=new CharacterStateReceiver({
  identity:()=>!followDesktopCharacter?null:currentSettings.activeCharacterId?characterLoader.identity
    :currentSettings.catBreed==='dafeiyu'?BUILTIN_CHARACTER:null,
  privacy:()=>privacyActive,
  apply:(state,age)=>engine.applyCharacterState(state,age),
  reset:()=>engine.resetCharacterInput(),
});
setInterval(()=>characterReceiver.tick(),100);

function computeObsHeadphonesOn(activeCat: CatSkinConfig | undefined): boolean {
  if (activeCat?.id === 'dafeiyu') return false;
  const hm: ObsHeadphoneMode =
    overrideHeadphones ||
    (currentSettings.headphoneMode === 'auto' || currentSettings.headphoneMode === 'on'
      ? currentSettings.headphoneMode
      : 'off');
  if (hm === 'on') return true;
  if (hm === 'off') return false;
  return gameActive;
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
  const want3d = !(followDesktopCharacter&&currentSettings.activeCharacterId) && mode === '3d' && activeCat?.id !== 'dafeiyu' && !webglBlocked;
  if (!want3d) {
    if (active3d) {
      engine3d?.stop();
      canvas3d.classList.add('hidden');
      canvas.classList.remove('hidden');
      engine.resize();
      engine.start();
      active3d = false;
    }
    return;
  }

  if (engine3d) {
    engine3d.showKeyBubbles = showBubbles;
    engine3d.setRenderStyle('3d');
    if (activeCat) engine3d.setCatSkin(activeCat);
    engine3d.setCollar(collar);
    engine3d.setHeadphones(computeObsHeadphonesOn(activeCat));
    engine3d.setKeyboardConfig(layout, orient);
    engine3d.setTailKeyConfig(tailMode, tailIds);
    engine3d.setRenderScale(overrideScale ?? 1.0);
    engine3d.setPrivacyMode(privacyActive);
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
    overrideLayout || (currentSettings.keyboardLayout === '108' ? '108' : '65');
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

  engine.showKeyBubbles = showBubbles;
  if (!(followDesktopCharacter&&currentSettings.activeCharacterId)) engine.setCatAppearance(activeCat?.id || 'black', activeCat);
  void characterLoader.sync(followDesktopCharacter&&!!currentSettings.activeCharacterId);
  engine.setHeadphones(computeObsHeadphonesOn(activeCat));
  engine.setKeyboardConfig(layout, orient);
  if (!(followDesktopCharacter&&currentSettings.activeCharacterId)) engine.setTailKeyConfig(tailMode, tailIds);
  engine.setRenderScale(overrideScale ?? 1.0);
  syncObs3D(activeCat, mode, collar, layout, orient, tailMode, tailIds, showBubbles);
}

function handleInput(p: InputEvent): void {
  switch (p.kind) {
    case 'keyDown':
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
    case 'mouseDown':
      if (active3d && engine3d) engine3d.onMouseDown(p.button);
      else engine.onMouseDown(p.button);
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

function connectStream(): void {
  const es = new EventSource('/obs/events');
  es.addEventListener('open',()=>characterReceiver.reconnect());
  es.addEventListener('error',()=>characterReceiver.disconnect());
  es.addEventListener('characterReset',ev=>{
    try{const value=JSON.parse((ev as MessageEvent).data);if(typeof value.epoch==='string')characterReceiver.invalidate(value.epoch);}catch{}
  });
  es.addEventListener('characterState',ev=>{
    try{characterReceiver.receive(JSON.parse((ev as MessageEvent).data));}catch{}
  });

  es.addEventListener('state', (ev) => {
    try {
      const snap = JSON.parse((ev as MessageEvent).data) as ObsStateSnapshot;
      if (Array.isArray(snap.cats) && snap.cats.length > 0) {
        catList = snap.cats;
      }
      if (snap.settings) {
        currentSettings = { ...currentSettings, ...snap.settings };
      }
      if (typeof snap.privacy === 'boolean') {
        privacyActive = snap.privacy;
        engine.setPrivacyMode(privacyActive);
        engine3d?.setPrivacyMode(privacyActive);
      }
      if (typeof snap.gameActive === 'boolean') {
        gameActive = snap.gameActive;
      }
      applyState();
      if(snap.characterState)characterReceiver.receive(snap.characterState);
    } catch {}
  });

  es.addEventListener('settings', (ev) => {
    try {
      const next = JSON.parse((ev as MessageEvent).data) as ObsAppSettings;
      currentSettings = { ...currentSettings, ...next };
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
    } catch {}
  });

  es.addEventListener('gameActive', (ev) => {
    try {
      const parsed = JSON.parse((ev as MessageEvent).data) as boolean | { active?: boolean };
      gameActive = typeof parsed === 'boolean' ? parsed : Boolean(parsed?.active);
      applyState();
    } catch {}
  });

  es.addEventListener('input', (ev) => {
    try {
      const payload = JSON.parse((ev as MessageEvent).data) as InputEvent;
      handleInput(payload);
    } catch {}
  });
}

applyState();
engine.start();
connectStream();
