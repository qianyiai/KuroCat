import type { Motion2d } from './characterMotion2d';
import { ProceduralCharacterRenderer, type SpriteSet } from './proceduralCharacterRenderer.ts';
import type { CharacterIdentity } from './characterSync.ts';

export interface ActiveCharacter {
  entry: { id: string; revision: string; name: string };
  outfitId: string;
  manifest: { outfits: Array<{ id: string; name: string; motion2d?: Motion2d;
    bodySprites?: { idle: string; blink: string; shy: string; happy: string } }> };
}
export interface CharacterTransport {
  active(): Promise<ActiveCharacter | null>;
  asset(id: string, revision: string, path: string): Promise<ArrayBuffer>;
}

/** Swap only after all sprites decode; late results from older selections never become visible. */
export class CharacterLoader {
  private generation = 0;
  private loaded = '';
  private loadFailed = false;
  private selected:CharacterIdentity|null=null;
  get identity():CharacterIdentity|null {return this.selected;}
  private transport: CharacterTransport;
  private apply: (actor: ProceduralCharacterRenderer | null) => void;
  private failed: (error: unknown) => void;
  constructor(transport: CharacterTransport, apply: (actor: ProceduralCharacterRenderer | null) => void,
    failed: (error: unknown) => void) { this.transport=transport;this.apply=apply;this.failed=failed; }
  async sync(selected: boolean, retry = true): Promise<void> {
    const generation = ++this.generation;
    if (!selected) {
      const needsReset=!!this.loaded||this.loadFailed;
      this.loaded='';this.selected=null;this.loadFailed=false;
      if(needsReset)this.apply(null);
      return;
    }
    const urls: string[] = [];
    try {
      const value = await this.transport.active();
      if (generation !== this.generation) return;
      if (!value) { this.loaded = ''; this.selected=null;this.loadFailed=false;this.apply(null); return; }
      const key = `${value.entry.id}/${value.entry.revision}/${value.outfitId}`;
      if (key === this.loaded) return;
      const outfit = value.manifest.outfits.find(o => o.id === value.outfitId);
      if (!outfit?.motion2d || !outfit.bodySprites) throw new Error('角色缺少可播放的 2D 动作或表情素材');
      const results = await Promise.allSettled((['idle','blink','shy','happy'] as const).map(async role => {
        const bytes = await this.transport.asset(value.entry.id, value.entry.revision, outfit.bodySprites![role]);
        const url = URL.createObjectURL(new Blob([bytes], {type:'image/png'})); urls.push(url);
        const image = new Image(); image.src = url; await image.decode(); return [role,image] as const;
      }));
      const failure = results.find(r=>r.status==='rejected');
      if(failure?.status==='rejected') throw failure.reason;
      const images = results.map(r=> { if(r.status==='fulfilled') return r.value; throw new Error('图片加载失败'); });
      if (generation !== this.generation) return;
      this.loadFailed=false;
      this.selected={id:value.entry.id,revision:value.entry.revision,outfitId:value.outfitId};
      this.apply(new ProceduralCharacterRenderer(outfit.motion2d, Object.fromEntries(images) as SpriteSet));
      this.loaded = key;
    } catch (error) {
      if (generation === this.generation) {
        if(retry && String(error).includes('STALE_REVISION')) { await this.sync(true,false); return; }
        this.loaded = ''; this.selected=null;this.apply(null);this.loadFailed=true;this.failed(error);
      }
    } finally { for (const url of urls) URL.revokeObjectURL(url); }
  }
}
