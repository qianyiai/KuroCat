import type { AccessoryHead } from './accessories';

export function installActors(
  loadArt: (name: string) => Promise<HTMLImageElement | HTMLCanvasElement>,
  loadData: (name: string) => Promise<unknown>,
): {
  prepareResident(): Promise<unknown>;
  prepareGuest(): Promise<unknown>;
  drawResident(ctx: CanvasRenderingContext2D, seconds: number, behind?: (head: AccessoryHead) => void): { pose: string; head?: AccessoryHead };
  drawGuest(ctx: CanvasRenderingContext2D, seconds: number, behind?: (head: AccessoryHead) => void): { pose: string; head: AccessoryHead } | undefined;
};

