import type { AccessoryHead } from './accessories';

export interface GuestState {
  pose: string;
  paw: [number, number];
  nose: [number, number];
  mouthOpen: number;
  mouthAnchor: null;
  head: { x: number; y: number; width: number; yaw: number; pitch: number; tension?: number; native?: boolean };
}

export function prepareCastGuest(
  id: string,
  loadArt: (name: string) => Promise<HTMLImageElement>,
  loadData: (name: string) => Promise<unknown>,
  nativeBody: CanvasImageSource,
  restBody?: CanvasImageSource,
): Promise<(ctx: CanvasRenderingContext2D, seconds: number, behind?: (head: AccessoryHead) => void) => GuestState>;
