import * as THREE from 'three';
import type { ActorScene } from './handoverLite/scene';
import type { CastAccessorySettings } from './handoverLite/accessories';
import { castDuration as duration, type CastId } from './handoverLite/cast';

// The offline capture uses a 1024×768 reference camera and a stationary
// stage. Its ground anchor is the midpoint of the seated cat's hind paws.
const referenceDistance = 8.1;
const elevation = 24.5 * Math.PI / 180;
const referencePixel = 2 * referenceDistance * Math.tan(11 * Math.PI / 180) / 768;
export const handoverStageUnit = referencePixel * 474 / 318;

/** Original hind-paw midpoint in the capture-facing plane, including its depth. */
export function nativeHandoverGround(anchor: THREE.Vector3, orientation: THREE.Quaternion, out: THREE.Vector3): THREE.Vector3 {
  return out.set((502.57 - 512) * referencePixel, (384 - 560) * referencePixel, 0).applyQuaternion(orientation).add(anchor);
}

type PlaybackState = 'pending' | 'playing' | 'failed' | 'ended';

/** Both cats share a transparent surface registered to the original seated pose. */
function actorLayer(resolution: number) {
  const width = 1536, height = 592;
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width * resolution);
  canvas.height = Math.ceil(height * resolution);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D unavailable');
  const sx = canvas.width / width, sy = canvas.height / height;
  ctx.setTransform(sx, 0, 0, sy, 0, 0);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(width * referencePixel, height * referencePixel),
    new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false }),
  );
  plane.position.set((width / 2 - 502.57) * referencePixel,
    (560 - height / 2) * referencePixel, 0);
  return {
    plane, ctx,
    clear() { ctx.clearRect(0, 0, width, height); },
    refresh() { texture.needsUpdate = true; },
    dispose() {
      texture.dispose(); plane.geometry.dispose(); plane.material.dispose(); canvas.width = canvas.height = 1;
    },
  };
}

/** Paint the two actors into the existing scene; the desk and its input handlers stay live. */
export class CastHandover {
  public readonly mesh = new THREE.Group();
  public state: PlaybackState = 'pending';
  private readonly requestedAt = performance.now();
  private cats?: ReturnType<typeof actorLayer>;
  private actorScene?: ActorScene;
  private startedAt?: number;
  private drawnTime = 0;
  private lastFrame = -1;
  private disposed = false;

  public constructor(anchor: THREE.Vector3, from: CastId, to: CastId, pixelsPerWorldUnit: () => number,
    prepareStage?: (player: CastHandover) => Promise<boolean>, accessories?: () => CastAccessorySettings) {
    this.mesh.visible = false;
    this.mesh.rotation.x = -elevation;
    nativeHandoverGround(anchor, this.mesh.quaternion, this.mesh.position);
    void this.prepare(from, to, pixelsPerWorldUnit, prepareStage, accessories);
  }

  private async prepare(from: CastId, to: CastId, pixelsPerWorldUnit: () => number,
    prepareStage?: (player: CastHandover) => Promise<boolean>, accessories?: () => CastAccessorySettings): Promise<void> {
    try {
      const { prepareActorScene } = await import('./handoverLite/scene');
      if (this.disposed || this.state !== 'pending') return;
      const scene = await prepareActorScene(from, to, accessories);
      if (this.disposed || this.state !== 'pending') return;
      if (prepareStage && !(await prepareStage(this))) throw new Error('Stage unavailable');
      if (this.disposed || this.state !== 'pending') return;
      // Cap offscreen handover surface at 1.0x reference pixels (1536x592) to halve transient
      // CPU/GPU texture RAM (~7 MB instead of ~16 MB) while staying razor-sharp on desktop windows.
      const resolution = THREE.MathUtils.clamp(referencePixel * pixelsPerWorldUnit(), .75, 1.0);
      this.cats = actorLayer(resolution);
      this.mesh.add(this.cats.plane);
      this.actorScene = scene;
    } catch {
      if (!this.disposed) this.state = 'failed';
    }
  }

  public get currentTime(): number { return this.drawnTime; }

  public poll(): PlaybackState {
    if (this.disposed || this.state === 'failed' || this.state === 'ended') return this.state;
    if (!this.actorScene || !this.cats) {
      if (performance.now() - this.requestedAt > 8000) this.state = 'failed';
      return this.state;
    }
    const now = performance.now();
    this.startedAt ??= now;
    const time = (now - this.startedAt) / 1000;
    if (time >= duration) { this.state = 'ended'; this.drawnTime = duration; return this.state; }
    const frame = Math.floor(time * 50);
    if (frame !== this.lastFrame) {
      this.lastFrame = frame;
      this.drawnTime = frame / 50;
      this.cats.clear();
      this.actorScene.paintCats(this.cats.ctx, this.drawnTime);
      this.cats.refresh();
    }
    this.state = 'playing';
    return this.state;
  }

  public dispose(): void {
    this.disposed = true;
    this.mesh.removeFromParent();
    this.mesh.clear();
    this.cats?.dispose();
    this.cats = undefined;
    this.actorScene?.dispose();
    this.actorScene = undefined;
  }
}
