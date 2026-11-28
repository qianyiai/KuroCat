export interface HandoverStageGeometry {
  baseWidth: number;
  baseHeight: number;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
}

export interface HandoverStageHost {
  begin(id: number): Promise<HandoverStageGeometry>;
  end(id: number): Promise<void>;
}

let lastStageId = 0;

/** Keeps a pet's normal client coordinates valid through asynchronous native resizes. */
export class HandoverStage {
  private active: { id: number; geometry: HandoverStageGeometry; closing: boolean } | null = null;

  constructor(
    private readonly host: HandoverStageHost,
    private readonly canvas: HTMLCanvasElement,
    private readonly onGeometry: (geometry: HandoverStageGeometry | null) => void,
  ) {}

  public get geometry(): HandoverStageGeometry | null {
    return this.active?.geometry ?? null;
  }

  public owns(id: number): boolean {
    return this.active?.id === id && !this.active.closing;
  }

  public async begin(): Promise<boolean> {
    const previous = this.geometry;
    const rect = this.canvas.getBoundingClientRect();
    const width = previous?.baseWidth ?? rect.width;
    const height = previous?.baseHeight ?? rect.height;
    const id = lastStageId = Math.max(Date.now() * 1000, lastStageId + 1);
    const stage = this.active = {
      id, closing: false,
      geometry: { baseWidth: width, baseHeight: height, width, height, offsetX: 0, offsetY: 0 },
    };
    this.onGeometry(stage.geometry);
    try {
      const geometry = await this.host.begin(id);
      if (!this.owns(id)) return false;
      if (!geometry || ![geometry.baseWidth, geometry.baseHeight, geometry.width, geometry.height].every(n => Number.isFinite(n) && n > 0) ||
          !Number.isFinite(geometry.offsetX) || !Number.isFinite(geometry.offsetY)) throw new Error('Invalid stage geometry');
      stage.geometry = geometry;
      this.onGeometry(geometry);
      // Native IPC can resolve before the webview has applied its new client area.
      for (let i = 0; i < 30 && this.owns(id); i++) {
        const bounds = this.canvas.getBoundingClientRect();
        if (Math.abs(bounds.width - geometry.width) <= 1 && Math.abs(bounds.height - geometry.height) <= 1) return true;
        await new Promise<void>(resolve => window.setTimeout(resolve, 16));
      }
    } catch {
      // Continue the choreography in the original window if expansion was refused.
    }
    if (this.owns(id)) await this.end();
    return false;
  }

  public async end(): Promise<void> {
    const stage = this.active;
    if (!stage || stage.closing) return;
    stage.closing = true;
    try {
      await this.host.end(stage.id);
      // Keep the original framing while the wide window shrinks.
      for (let i = 0; i < 30 && this.active === stage; i++) {
        const rect = this.canvas.getBoundingClientRect();
        const g = stage.geometry;
        if (Math.abs(rect.width - g.baseWidth) <= 1 || Math.abs(rect.width - g.width) > 1 ||
            Math.abs(rect.height - g.height) > 1) break;
        await new Promise<void>(resolve => window.setTimeout(resolve, 16));
      }
    } catch {
      // The desktop window may already have been destroyed.
    } finally {
      if (this.active === stage) {
        this.active = null;
        this.onGeometry(null);
      }
    }
  }
}
