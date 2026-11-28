import type { CatSkinConfig } from '../catSkins';

export const castIds = ['black', 'siamese', 'ragdoll', 'orange-tabby', 'calico', 'tuxedo'] as const;
export type CastId = (typeof castIds)[number];
export const castContact = .72;
export const castDuration = 5;

export function isCastSkin(skin: CatSkinConfig | null | undefined): skin is CatSkinConfig & { id: CastId } {
  return skin?.builtin === true && castIds.some(id => id === skin.id);
}
