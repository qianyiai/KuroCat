import type { AccessoryHead } from './accessories';

export interface CastResidentPose {
  tail: number[] | null;
  root: number[] | null;
  arch: number;
  pose: 'seated' | 'startle' | 'arch' | 'retreat' | 'offstage';
  eyeAnger: number;
  mouthOpen: number;
  head?: {x: number; y: number; width: number; yaw: number; pitch: number; tension: number};
}

export function prepareCastResident(
  id: string,
  loadArt: (name: string) => Promise<HTMLImageElement>,
  loadData: (name: string) => Promise<unknown>,
  nativeBody: CanvasImageSource,
): Promise<(ctx: CanvasRenderingContext2D, seconds: number, behind?: (head: AccessoryHead) => void) => CastResidentPose>;
