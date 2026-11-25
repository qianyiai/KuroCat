import * as THREE from 'three';
import { drawForagingBird } from './birdSprite';
import type { BirdVariation, BirdVisitFrame } from './birdVisit';
import type { KeyboardAndMouse3D } from './keyboard3d';

const SPRITE_WIDTH = 128;
const SPRITE_HEIGHT = 112;
const FOOT_Y = 94;
const TEXTURE_DENSITY = 2;
const MAX_GRAINS = 9;
const CONTACT_OFFSET = 0.004;

function canvasContext(width: number, height: number): CanvasRenderingContext2D {
  const canvas = document.createElement('canvas');
  canvas.width = width * TEXTURE_DENSITY;
  canvas.height = height * TEXTURE_DENSITY;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create the 3D bird texture');
  ctx.scale(TEXTURE_DENSITY, TEXTURE_DENSITY);
  return ctx;
}

function canvasTexture(ctx: CanvasRenderingContext2D): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(ctx.canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  return texture;
}

function drawExhaleTexture(): THREE.CanvasTexture {
  const ctx = canvasContext(48, 28);
  ctx.translate(24, 14);
  ctx.scale(-1, 1);
  ctx.beginPath();
  ctx.moveTo(-20, 8);
  ctx.quadraticCurveTo(-11, 3, -7, 0);
  ctx.bezierCurveTo(-9, -8, -1, -12, 5, -7);
  ctx.bezierCurveTo(11, -13, 21, -7, 17, -1);
  ctx.bezierCurveTo(24, 3, 17, 11, 10, 8);
  ctx.quadraticCurveTo(2, 13, -4, 6);
  ctx.quadraticCurveTo(-11, 4, -20, 8);
  ctx.closePath();
  ctx.fillStyle = '#faffe9';
  ctx.fill();
  ctx.strokeStyle = '#728c7e';
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.stroke();
  return canvasTexture(ctx);
}

function drawShadowTexture(): THREE.CanvasTexture {
  const ctx = canvasContext(48, 48);
  const gradient = ctx.createRadialGradient(24, 24, 0, 24, 24, 24);
  gradient.addColorStop(0, 'rgba(81,53,40,0.8)');
  gradient.addColorStop(0.44, 'rgba(81,53,40,0.42)');
  gradient.addColorStop(1, 'rgba(81,53,40,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 48, 48);
  return canvasTexture(ctx);
}

export class BirdVisit3DRenderer {
  private readonly spriteCtx = canvasContext(SPRITE_WIDTH, SPRITE_HEIGHT);
  private readonly spriteTexture = canvasTexture(this.spriteCtx);
  private readonly sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: this.spriteTexture, transparent: true, depthTest: true, depthWrite: false, alphaTest: 0.02,
  }));
  private readonly shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
    map: drawShadowTexture(), transparent: true, depthTest: true, depthWrite: false,
  }));
  private readonly food = new THREE.Group();
  private readonly exhale = new THREE.Sprite(new THREE.SpriteMaterial({
    map: drawExhaleTexture(), transparent: true, depthTest: true, depthWrite: false,
  }));

  private readonly boardPoint = new THREE.Vector3();
  private readonly tablePoint = new THREE.Vector3();
  private readonly tabletopRotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  private readonly boardRotation = new THREE.Quaternion();
  private readonly grains: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>[] = [];

  constructor(scene: THREE.Scene, private readonly desk: KeyboardAndMouse3D) {
    this.sprite.name = 'bird-visit';
    this.sprite.center.set(0.5, 1 - FOOT_Y / SPRITE_HEIGHT);
    this.sprite.visible = false;
    this.shadow.name = 'bird-contact-shadow';
    this.shadow.visible = false;
    this.exhale.name = 'bird-typing-exhale';
    this.exhale.center.set(0.93, 0.35);
    this.exhale.visible = false;
    this.food.name = 'bird-food-grains';
    this.food.visible = false;

    const grainGeometry = new THREE.CircleGeometry(1, 12);
    const grainMaterial = new THREE.MeshBasicMaterial({ color: '#ab8050' });
    for (let i = 0; i < MAX_GRAINS; i++) {
      const grain = new THREE.Mesh(grainGeometry, grainMaterial);
      this.grains.push(grain);
      this.food.add(grain);
    }
    scene.add(this.shadow, this.food, this.sprite, this.exhale);
  }

  /** Current feet position for the cat gaze. The returned vector is owned by the renderer. */
  public get worldPosition(): THREE.Vector3 | null {
    return this.sprite.visible ? this.sprite.position : null;
  }

  public update(frame: BirdVisitFrame | null, variation: BirdVariation | null, camera: THREE.Camera): void {
    const pose = frame?.pose;
    if (!frame || !pose || !variation) {
      this.sprite.visible = false;
      this.shadow.visible = false;
      this.food.visible = false;
      return;
    }

    const fullSize = this.desk.getLayoutId() === '108';
    const unit = fullSize ? 0.0055 : 0.0045;
    const side = variation.route === 'bounce' ? -1 : 1;
    const boardSide = side * this.desk.getBoardWidth() * (fullSize ? 0.265 : 0.158);
    const boardX = side < 0 ? 230 : variation.route === 'sweep' ? 472 : 511;
    const tableX = side < 0 ? 230 : 511;
    const surfaceY = pose.shadowY ?? pose.y;
    const tableBlend = Math.max(
      THREE.MathUtils.smoothstep(surfaceY, 350, 365),
      side < 0 ? (1 - THREE.MathUtils.smoothstep(pose.x, 175, 217)) * THREE.MathUtils.smoothstep(surfaceY, 350, 352) : 0,
    );

    // Interpolate keyboard and tabletop anchors during the approved hop, so feet leave and meet real surfaces.
    this.desk.boardGroup.updateWorldMatrix(true, false);
    this.boardPoint.set(
      boardSide + (pose.x - boardX) * unit,
      this.desk.getBoardTopY() + CONTACT_OFFSET,
      -0.105 + (surfaceY - 339) * 0.00335,
    ).applyMatrix4(this.desk.boardGroup.matrixWorld);
    this.placeOnTable(pose.x, surfaceY, unit, boardSide, tableX, this.tablePoint);
    this.sprite.position.copy(this.boardPoint).lerp(this.tablePoint, tableBlend);
    this.shadow.position.copy(this.sprite.position);

    const lift = Math.max(0, pose.lift ?? 0);
    const visibility = pose.visibility ?? 1;
    this.sprite.position.y += lift * unit;
    this.sprite.scale.set(SPRITE_WIDTH * unit, SPRITE_HEIGHT * unit, 1);
    this.sprite.visible = visibility > 0;

    this.desk.boardGroup.getWorldQuaternion(this.boardRotation).multiply(this.tabletopRotation);
    this.shadow.quaternion.copy(this.boardRotation).slerp(this.tabletopRotation, tableBlend);
    const shadowWidth = (29 + Math.min(lift, 44) * 0.24) * unit;
    this.shadow.scale.set(shadowWidth, shadowWidth * 0.62, 1);
    this.shadow.material.opacity = 0.3 * visibility * (1 - THREE.MathUtils.clamp(lift / 95, 0, 1));
    this.shadow.visible = this.shadow.material.opacity > 0.005;

    camera.updateMatrixWorld();
    const reverseScreenSide = camera.matrixWorld.elements[0] < 0;
    if (this.sprite.visible) {
      const ctx = this.spriteCtx;
      ctx.clearRect(0, 0, SPRITE_WIDTH, SPRITE_HEIGHT);
      // Suppress the baked 2D shadow. The scene projects a contact shadow on the deck or table.
      const facesRight = Boolean(pose.facesRight) !== reverseScreenSide;
      drawForagingBird(ctx, { ...pose, x: SPRITE_WIDTH / 2, y: FOOT_Y, shadowY: -20, facesRight });
      this.spriteTexture.needsUpdate = true;
    }

    this.food.visible = frame.grains.length > 0;
    for (let i = 0; i < this.grains.length; i++) {
      const grain = this.grains[i];
      const seed = frame.grains[i];
      grain.visible = Boolean(seed);
      if (!seed) continue;
      this.placeOnTable(seed.x, seed.y, unit, boardSide, tableX, grain.position);
      grain.rotation.set(-Math.PI / 2, 0, -seed.angle);
      grain.scale.set(seed.size * unit, seed.size * unit * 0.57, 1);
    }
  }

  public updateExhale(progress: number, headWorld: THREE.Vector3): void {
    this.exhale.visible = progress > 0 && progress < 1;
    if (!this.exhale.visible) return;
    this.exhale.position.set(
      headWorld.x - progress * 0.32, headWorld.y + progress * 0.12, headWorld.z + 0.025,
    );
    const size = 0.76 + progress * 0.51;
    this.exhale.scale.set(0.30 * size, 0.175 * size, 1);
    this.exhale.material.opacity = Math.min(progress * 8, (1 - progress) * 2.4, 1);
  }

  private placeOnTable(
    x: number, y: number, unit: number, boardSide: number, tableX: number, out: THREE.Vector3,
  ): void {
    const { boardGroup, deskGroup } = this.desk;
    const frontEdge = boardGroup.position.z + this.desk.getBoardDepth() / 2;
    out.set(
      boardGroup.position.x + boardSide + (x - tableX) * unit,
      deskGroup.position.y + CONTACT_OFFSET,
      frontEdge + 0.06 + (y - 365) * 0.002,
    );
  }
}
